import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

/** Продуктовый дефолт бесплатного лимита минут, если env пуст и строки в БД нет. */
export const DEFAULT_GLOBAL_FREE_VOICE_MINUTES = 10;

/**
 * 173 — дефолт потолка дней ОДНОГО бесплатного (пробного) продления, которое
 * может выдать менеджер платформы. Совпадает с DEFAULT колонки
 * platform_settings.manager_max_free_days (миграция 173).
 */
export const DEFAULT_MANAGER_MAX_FREE_DAYS = 30;

/** Глобальные настройки платформы (синглтон platform_settings, миграция 116). */
export interface PlatformSettings {
  /**
   * Бесплатные минуты голосового ввода в месяц для КАЖДОГО тенанта (тест-доступ).
   * Правит супер-админ через PATCH /admin/settings. Формула лимита тенанта —
   * (max(planMinutes, globalFree) + extraMinutes) — см. VoiceService.
   */
  globalFreeVoiceMinutes: number;
  /**
   * 173 — максимум дней ОДНОГО бесплатного (пробного) продления, которое может
   * выдать менеджер платформы своему клиенту. Целое ≥ 1, дефолт 30. Правит
   * супер-админ через PATCH /admin/settings; на самого супер-админа потолок не
   * распространяется.
   */
  managerMaxFreeDays: number;
}

/**
 * Хранилище глобальных (без-тенантных) настроек платформы — единственная
 * строка-синглтон platform_settings (id = 1). Таблица без tenant_id и без RLS:
 * читается роль-агностично (в т.ч. из тенантного app-пула voice.service), а на
 * запись гейтится только superadmin-роутом (RolesGuard) на уровне приложения.
 *
 * Источник правды — БД. env GLOBAL_FREE_VOICE_MINUTES задаёт лишь начальное
 * значение сида (первое чтение/запись на свежей базе) и фолбэк, если строку
 * почему-то не удалось прочитать (например, самый ранний старт до миграции).
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger('PlatformSettingsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /** env GLOBAL_FREE_VOICE_MINUTES → неотрицательное целое; иначе дефолт 10. */
  private envDefault(): number {
    const raw = (process.env.GLOBAL_FREE_VOICE_MINUTES ?? '').trim();
    if (raw === '') return DEFAULT_GLOBAL_FREE_VOICE_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_GLOBAL_FREE_VOICE_MINUTES;
    return Math.trunc(n);
  }

  /**
   * Текущий глобальный бесплатный лимит минут. Есть строка → её значение; нет —
   * лениво сидируем env-значением (idempotent ON CONFLICT DO NOTHING) и его же
   * возвращаем. Любая ошибка чтения → env/дефолт: голосовой ввод не должен
   * падать из-за настроек. Чтение read-mostly (INSERT только на первый вызов).
   */
  async getGlobalFreeVoiceMinutes(): Promise<number> {
    try {
      const { rows } = await this.pool.query(`SELECT global_free_voice_minutes FROM platform_settings WHERE id = 1`);
      if (rows.length > 0) {
        const n = parseInt(rows[0].global_free_voice_minutes, 10);
        return Number.isFinite(n) && n >= 0 ? n : this.envDefault();
      }
      const seed = this.envDefault();
      await this.pool.query(
        `INSERT INTO platform_settings (id, global_free_voice_minutes) VALUES (1, $1)
         ON CONFLICT (id) DO NOTHING`,
        [seed],
      );
      return seed;
    } catch (err) {
      this.logger.warn(`platform_settings read failed, using env/default: ${(err as Error).message}`);
      return this.envDefault();
    }
  }

  /**
   * 173 — потолок дней одного бесплатного продления у менеджера. Читается на
   * КАЖДОЕ продление/создание клиента менеджером, поэтому: нет строки → дефолт
   * без записи (строку сидирует getGlobalFreeVoiceMinutes / PATCH), кривое или
   * < 1 значение → дефолт, ошибка чтения → дефолт (потолок никогда не падает
   * в «без ограничений» и не роняет операцию менеджера).
   */
  async getManagerMaxFreeDays(): Promise<number> {
    try {
      const { rows } = await this.pool.query(`SELECT manager_max_free_days FROM platform_settings WHERE id = 1`);
      if (rows.length === 0) return DEFAULT_MANAGER_MAX_FREE_DAYS;
      const n = parseInt(rows[0].manager_max_free_days, 10);
      return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MANAGER_MAX_FREE_DAYS;
    } catch (err) {
      this.logger.warn(`platform_settings manager_max_free_days read failed, using default: ${(err as Error).message}`);
      return DEFAULT_MANAGER_MAX_FREE_DAYS;
    }
  }

  /** GET /admin/settings — весь набор глобальных настроек (superadmin). */
  async getSettings(): Promise<PlatformSettings> {
    // Порядок важен: getGlobalFreeVoiceMinutes лениво сидирует синглтон, после
    // чего getManagerMaxFreeDays читает уже существующую строку.
    const globalFreeVoiceMinutes = await this.getGlobalFreeVoiceMinutes();
    const managerMaxFreeDays = await this.getManagerMaxFreeDays();
    return { globalFreeVoiceMinutes, managerMaxFreeDays };
  }

  /**
   * PATCH /admin/settings — обновление супер-админом. UPSERT синглтона: строка
   * создаётся, если её ещё нет. Обновляются только переданные поля (непереданное
   * остаётся как есть — COALESCE по текущему значению колонки); пустой патч —
   * no-op, возвращаем текущее состояние. Значения нормализуются (минуты — целое
   * ≥ 0, дни менеджера — целое ≥ 1) поверх валидации DTO.
   */
  async updateSettings(patch: {
    globalFreeVoiceMinutes?: number;
    managerMaxFreeDays?: number;
  }): Promise<PlatformSettings> {
    if (patch.globalFreeVoiceMinutes === undefined && patch.managerMaxFreeDays === undefined) {
      return this.getSettings();
    }
    const minutes =
      patch.globalFreeVoiceMinutes === undefined
        ? null
        : Math.max(0, Math.trunc(Number(patch.globalFreeVoiceMinutes) || 0));
    const managerDays =
      patch.managerMaxFreeDays === undefined
        ? null
        : Math.max(1, Math.trunc(Number(patch.managerMaxFreeDays) || DEFAULT_MANAGER_MAX_FREE_DAYS));
    const { rows } = await this.pool.query(
      `INSERT INTO platform_settings (id, global_free_voice_minutes, manager_max_free_days, updated_at)
       VALUES (1, COALESCE($1::int, $3::int), COALESCE($2::int, $4::int), now())
       ON CONFLICT (id) DO UPDATE
          SET global_free_voice_minutes = COALESCE($1::int, platform_settings.global_free_voice_minutes),
              manager_max_free_days = COALESCE($2::int, platform_settings.manager_max_free_days),
              updated_at = now()
       RETURNING global_free_voice_minutes, manager_max_free_days`,
      [minutes, managerDays, this.envDefault(), DEFAULT_MANAGER_MAX_FREE_DAYS],
    );
    return {
      globalFreeVoiceMinutes: parseInt(rows[0].global_free_voice_minutes, 10) || 0,
      managerMaxFreeDays: parseInt(rows[0].manager_max_free_days, 10) || DEFAULT_MANAGER_MAX_FREE_DAYS,
    };
  }
}
