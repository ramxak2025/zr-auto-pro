import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

/** Продуктовый дефолт бесплатного лимита минут, если env пуст и строки в БД нет. */
export const DEFAULT_GLOBAL_FREE_VOICE_MINUTES = 10;

/** Глобальные настройки платформы (синглтон platform_settings, миграция 116). */
export interface PlatformSettings {
  /**
   * Бесплатные минуты голосового ввода в месяц для КАЖДОГО тенанта (тест-доступ).
   * Правит супер-админ через PATCH /admin/settings. Формула лимита тенанта —
   * (max(planMinutes, globalFree) + extraMinutes) — см. VoiceService.
   */
  globalFreeVoiceMinutes: number;
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

  /** GET /admin/settings — весь набор глобальных настроек (superadmin). */
  async getSettings(): Promise<PlatformSettings> {
    return { globalFreeVoiceMinutes: await this.getGlobalFreeVoiceMinutes() };
  }

  /**
   * PATCH /admin/settings — обновление супер-админом. UPSERT синглтона: строка
   * создаётся, если её ещё нет. Обновляются только переданные поля; пустой
   * патч — no-op, возвращаем текущее состояние. Значение нормализуется
   * (целое ≥ 0) поверх валидации DTO.
   */
  async updateSettings(patch: { globalFreeVoiceMinutes?: number }): Promise<PlatformSettings> {
    if (patch.globalFreeVoiceMinutes === undefined) {
      return this.getSettings();
    }
    const value = Math.max(0, Math.trunc(Number(patch.globalFreeVoiceMinutes) || 0));
    const { rows } = await this.pool.query(
      `INSERT INTO platform_settings (id, global_free_voice_minutes, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE
          SET global_free_voice_minutes = EXCLUDED.global_free_voice_minutes,
              updated_at = now()
       RETURNING global_free_voice_minutes`,
      [value],
    );
    return { globalFreeVoiceMinutes: parseInt(rows[0].global_free_voice_minutes, 10) || 0 };
  }
}
