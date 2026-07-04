import {
  Injectable,
  Inject,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { YandexSttAdapter } from './yandex-stt.adapter';
import { YandexGptAdapter } from './yandex-gpt.adapter';
import { PlatformSettingsService } from '../settings/platform-settings.service';

/** Блок списания = блок биллинга Яндекса (0.1626 ₽ за каждые начатые 15 сек). */
export const VOICE_BLOCK_SECONDS = 15;
/** Продуктовый потолок одной записи. */
export const VOICE_MAX_DURATION_SECONDS = 60;
/** Потолок файла (busboy limit в контроллере + sanity здесь). */
export const VOICE_MAX_FILE_BYTES = 2 * 1024 * 1024;
/**
 * Анти-обман: минимальная длительность, которую может занимать файл такого
 * размера. 16 000 байт/сек ≈ 128 kbit/s — потолок реальных голосовых кодеков
 * (opus-речь 4–12 КБ/с, AAC-64k ≈ 8 КБ/с). Клиент, приславший 2 МБ и
 * заявивший «1 секунда», всё равно будет биллиться от размера файла.
 */
const MAX_BYTES_PER_SECOND = 16_000;

/**
 * Период квоты — календарный месяц ПО МОСКВЕ ('YYYY-MM'). МСК = UTC+3 круглый
 * год (DST в РФ отменён), поэтому честный сдвиг на +3 часа без таймзонных
 * библиотек. Экспортирована как чистая функция — тестируется на границе месяца.
 */
export function currentPeriodMsk(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 7);
}

interface TenantVoiceLimits {
  featureEnabled: boolean;
  planMinutes: number;
  /** Глобальный бесплатный лимит платформы (platform_settings), минуты. */
  freeMinutes: number;
  extraMinutes: number;
  limitSeconds: number;
}

export interface TranscribeInput {
  audio: Buffer;
  filename?: string;
  mimeType?: string;
  /** Заявленная клиентом длительность записи, сек (поле формы durationSeconds). */
  durationSeconds?: number;
  /** Явный SpeechKit-формат от клиента (oggopus | lpcm | …) — договорной контракт. */
  format?: string;
  /** Для lpcm: 8000 | 16000 | 48000. */
  sampleRateHertz?: number;
}

/**
 * Голосовой ввод комментария (миграция 115).
 *
 * Пайплайн transcribe: конфиг-гейт (503) → тариф-гейт voice_input (403) →
 * оценка длительности и блоков → АТОМАРНОЕ списание из voice_usage с проверкой
 * лимита в WHERE (гонка на краю квоты пропускает ровно один запрос) → SpeechKit
 * STT (сбой → рефанд блоков) → YandexGPT-полировка (best-effort, сбой → сырой
 * текст) → { text, rawText, billedSeconds, remainingSeconds }.
 *
 * Лимит месяца = (max(planMinutes, globalFreeMinutes) + extraMinutes) × 60, где
 * globalFreeMinutes — глобальный бесплатный лимит платформы (миграция 116,
 * platform_settings, правит супер-админ; дефолт 10). Т.е. бесплатные минуты
 * получают ВСЕ тенанты (тест-доступ); тариф с пакетом (Легенда=1000) даёт
 * бОльшую базу ВМЕСТО free (max, не сумма); индивидуальная надбавка тенанта
 * плюсуется сверху. Пустой результат распознавания НЕ рефандится — Яндекс
 * биллит и тишину, квота зеркалит их счётчик.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger('VoiceService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private readonly stt: YandexSttAdapter,
    private readonly gpt: YandexGptAdapter,
    private readonly settings: PlatformSettingsService,
  ) {}

  // ─── Квота ─────────────────────────────────────────────────────────────────

  private async loadLimits(tenantId: string): Promise<TenantVoiceLimits> {
    // Глобальный бесплатный лимит читаем параллельно с тарифом тенанта — он
    // без-тенантный (platform_settings), общий для всех.
    const [{ rows }, freeMinutes] = await Promise.all([
      this.pool.query(
        `SELECT COALESCE(t.voice_minutes_extra, 0) AS extra_minutes,
                COALESCE(p.voice_minutes, 0)       AS plan_minutes,
                COALESCE(p.features, '[]'::jsonb)  AS plan_features
           FROM tenants t
           LEFT JOIN plans p ON p.id = t.plan_id
          WHERE t.id = $1`,
        [tenantId],
      ),
      this.settings.getGlobalFreeVoiceMinutes(),
    ]);
    if (rows.length === 0) {
      // Тенант исчез из-под живого токена — отвечаем как «фичи нет», без 500.
      // Лимит 0 (free к несуществующему тенанту не применяем: FK всё равно
      // не даст списать).
      return { featureEnabled: false, planMinutes: 0, freeMinutes: 0, extraMinutes: 0, limitSeconds: 0 };
    }
    const r = rows[0];
    const planMinutes = parseInt(r.plan_minutes, 10) || 0;
    const extraMinutes = parseInt(r.extra_minutes, 10) || 0;
    const features: unknown = r.plan_features;
    // База = бОльшее из тарифного пакета и бесплатного лимита (не сумма):
    // пакет ≥ free перекрывает free, пакет < free даёт минимум free.
    const baseMinutes = Math.max(planMinutes, freeMinutes);
    return {
      featureEnabled: Array.isArray(features) && features.includes('voice_input'),
      planMinutes,
      freeMinutes,
      extraMinutes,
      limitSeconds: (baseMinutes + extraMinutes) * 60,
    };
  }

  private async readUsedSeconds(tenantId: string, period: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT seconds_used FROM voice_usage WHERE tenant_id = $1 AND period = $2`,
      [tenantId, period],
    );
    return rows.length > 0 ? parseInt(rows[0].seconds_used, 10) || 0 : 0;
  }

  /**
   * Атомарное списание блоков с проверкой лимита В САМОМ ЗАПРОСЕ.
   *
   * INSERT-источник — SELECT с WHERE billed <= limit (свежая строка месяца не
   * может сразу превысить лимит), конфликтная ветка — DO UPDATE c WHERE
   * used + billed <= limit. Конкурирующие запросы на несуществующей строке
   * сериализуются speculative insertion'ом Postgres: проигравший уходит в
   * ветку DO UPDATE и честно проверяет лимит по УЖЕ записанному значению.
   * 0 строк в ответе = квота исчерпана (в т.ч. гонкой) — Яндекс не вызывается.
   *
   * Возвращает НОВЫЙ суммарный seconds_used или null при отказе.
   */
  private async charge(
    tenantId: string,
    period: string,
    billedSeconds: number,
    limitSeconds: number,
  ): Promise<number | null> {
    const { rows } = await this.pool.query(
      `INSERT INTO voice_usage (tenant_id, period, seconds_used, requests)
       SELECT $1, $2, $3::int, 1 WHERE $3::int <= $4::int
       ON CONFLICT (tenant_id, period) DO UPDATE
          SET seconds_used = voice_usage.seconds_used + EXCLUDED.seconds_used,
              requests     = voice_usage.requests + 1,
              updated_at   = now()
        WHERE voice_usage.seconds_used + EXCLUDED.seconds_used <= $4::int
       RETURNING seconds_used`,
      [tenantId, period, billedSeconds, limitSeconds],
    );
    return rows.length > 0 ? parseInt(rows[0].seconds_used, 10) || 0 : null;
  }

  /**
   * Возврат блоков, если распознавание НЕ состоялось (сеть/5xx/4xx Яндекса) —
   * тенант не должен терять минуты за наш сбой. Best-effort: ошибка рефанда
   * логируется и не маскирует исходную ошибку.
   */
  private async refund(tenantId: string, period: string, seconds: number): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE voice_usage
            SET seconds_used = GREATEST(0, seconds_used - $3),
                requests     = GREATEST(0, requests - 1),
                updated_at   = now()
          WHERE tenant_id = $1 AND period = $2`,
        [tenantId, period, seconds],
      );
    } catch (err) {
      this.logger.warn(`voice refund failed (tenant=${tenantId}, ${seconds}s): ${(err as Error).message}`);
    }
  }

  // ─── Публичные методы ──────────────────────────────────────────────────────

  /**
   * GET /voice/usage — остаток пакета для экрана Подписки и для мастеров на
   * экране записи (сознательно доступно любой роли тенанта: только цифры,
   * ничего чувствительного). Минуты — с шагом 0.25 (блоки по 15 сек).
   */
  async getUsage(user: JwtPayload) {
    const period = currentPeriodMsk();
    const configured = this.stt.isConfigured;
    if (!user.tenantID) {
      // Глобальный superadmin-токен без тенанта — безопасный нулевой ответ.
      return {
        period,
        limitMinutes: 0,
        usedMinutes: 0,
        remainingMinutes: 0,
        planMinutes: 0,
        freeMinutes: 0,
        extraMinutes: 0,
        remainingSeconds: 0,
        featureEnabled: false,
        configured,
      };
    }
    const limits = await this.loadLimits(user.tenantID);
    const usedSeconds = await this.readUsedSeconds(user.tenantID, period);
    const remainingSeconds = Math.max(0, limits.limitSeconds - usedSeconds);
    const toMinutes = (s: number) => Math.round((s / 60) * 100) / 100;
    return {
      period,
      // Итог = max(тариф, бесплатный лимит) + надбавка (см. loadLimits).
      limitMinutes: Math.max(limits.planMinutes, limits.freeMinutes) + limits.extraMinutes,
      usedMinutes: toMinutes(usedSeconds),
      remainingMinutes: toMinutes(remainingSeconds),
      planMinutes: limits.planMinutes,
      freeMinutes: limits.freeMinutes,
      extraMinutes: limits.extraMinutes,
      remainingSeconds,
      featureEnabled: limits.featureEnabled,
      configured,
    };
  }

  /** POST /voice/transcribe — полный пайплайн (см. заголовок класса). */
  async transcribe(user: JwtPayload, input: TranscribeInput) {
    // (0) Dual-mode: без ключей Яндекса фича честно выключена.
    if (!this.stt.isConfigured) {
      throw new ServiceUnavailableException({
        code: 'VOICE_NOT_CONFIGURED',
        message: 'Голосовой ввод не настроен на сервере',
      });
    }
    const tenantId = user.tenantID;
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'VOICE_NO_TENANT',
        message: 'Голосовой ввод доступен только в контексте автосервиса',
      });
    }

    // (a) Гейт доступа. Пускаем, если фича в тарифе (ключ voice_input) ИЛИ есть
    // положительный лимит (глобальные бесплатные минуты / надбавка супер-админа)
    // — иначе 403. Так «бесплатные N минут для ВСЕХ» реально работают даже на
    // тарифе без ключа; при free=0 и без пакета/надбавки лимит 0 ⇒ фича честно
    // закрыта. superadmin обходит гейт (как FeatureGate на клиентах).
    const limits = await this.loadLimits(tenantId);
    if (!limits.featureEnabled && limits.limitSeconds <= 0 && user.role !== 'superadmin') {
      throw new ForbiddenException({
        code: 'VOICE_FEATURE_NOT_IN_PLAN',
        message: 'Голосовой ввод не входит в ваш тариф',
      });
    }

    // (b) Длительность и блоки. Заявленная длительность проверяется на потолок,
    // а к биллингу идёт максимум из заявленной и байтовой оценки (обмануть
    // квоту заниженным полем нельзя; байтовая оценка только ПОДНИМАЕТ счёт,
    // до потолка в 60 сек, — честная запись никогда не отклоняется по ней).
    if (input.audio.length === 0) {
      throw new BadRequestException({ message: 'Пустой аудиофайл' });
    }
    if (input.audio.length > VOICE_MAX_FILE_BYTES) {
      throw new BadRequestException({ message: 'Аудио слишком большое (максимум 2 МБ)' });
    }
    const claimed = Number.isFinite(input.durationSeconds) ? (input.durationSeconds as number) : 0;
    if (claimed > VOICE_MAX_DURATION_SECONDS + 0.5) {
      throw new BadRequestException({
        code: 'VOICE_TOO_LONG',
        message: 'Запись слишком длинная (максимум 60 секунд)',
      });
    }
    // Анти-обман по размеру: клиент не может занизить длительность — байты
    // делятся на МАКСИМАЛЬНЫЙ правдоподобный байт-рейт формата, давая нижнюю
    // границу секунд. Для lpcm рейт ДЕТЕРМИНИРОВАН (частота × 2 байта × моно) —
    // это ТОЧНАЯ длительность, обмануть нельзя, и она НЕ должна раздувать счёт
    // (raw PCM 16кГц = 32000 Б/с, а не 16000 — иначе списывали бы вдвое).
    const isLpcm = (input.format || '').toLowerCase() === 'lpcm';
    const bytesPerSecond = isLpcm ? Math.max(1, input.sampleRateHertz || 16_000) * 2 : MAX_BYTES_PER_SECOND;
    const byteFloorSeconds = input.audio.length / bytesPerSecond;
    const effectiveSeconds = Math.min(VOICE_MAX_DURATION_SECONDS, Math.max(1, claimed, byteFloorSeconds));
    const billedSeconds = Math.ceil(effectiveSeconds / VOICE_BLOCK_SECONDS) * VOICE_BLOCK_SECONDS;

    // (c) Квота: дружелюбный пре-чек + атомарное списание (гонку решает SQL).
    const period = currentPeriodMsk();
    const usedBefore = await this.readUsedSeconds(tenantId, period);
    if (usedBefore + billedSeconds > limits.limitSeconds) {
      throw this.quotaExceeded(limits.limitSeconds, usedBefore);
    }
    const newTotal = await this.charge(tenantId, period, billedSeconds, limits.limitSeconds);
    if (newTotal === null) {
      // Параллельный запрос успел исчерпать квоту между пре-чеком и списанием.
      const used = await this.readUsedSeconds(tenantId, period);
      throw this.quotaExceeded(limits.limitSeconds, used);
    }

    // (d) STT. Любой сбой → рефанд блоков и проброс ошибки.
    let rawText: string;
    try {
      rawText = await this.stt.recognize({
        audio: input.audio,
        format: this.resolveFormat(input),
        sampleRateHertz: input.sampleRateHertz,
      });
    } catch (err) {
      await this.refund(tenantId, period, billedSeconds);
      throw err;
    }

    // (e) Полировка — best-effort; пустой сырой текст полировать нечего.
    const polished = rawText === '' ? null : await this.gpt.polish(rawText);

    // (f) Ответ.
    return {
      text: polished ?? rawText,
      rawText,
      billedSeconds,
      remainingSeconds: Math.max(0, limits.limitSeconds - newTotal),
    };
  }

  private quotaExceeded(limitSeconds: number, usedSeconds: number): HttpException {
    return new HttpException(
      {
        code: 'VOICE_QUOTA_EXCEEDED',
        message: 'Пакет минут голосового ввода на этот месяц исчерпан',
        remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  /**
   * SpeechKit-формат: явное поле клиента (договорной контракт mobile-волны) →
   * серверный дефолт YC_STT_FORMAT (oggopus | lpcm | mp3 | auto) → эвристика по
   * имени/типу файла → 'oggopus' (дефолт SpeechKit v1 sync).
   */
  private resolveFormat(input: TranscribeInput): string {
    if (input.format) return input.format;
    const pinned = (process.env.YC_STT_FORMAT || '').trim().toLowerCase();
    if (pinned && pinned !== 'auto') return pinned;
    const name = (input.filename || '').toLowerCase();
    const mime = (input.mimeType || '').toLowerCase();
    if (name.endsWith('.ogg') || name.endsWith('.opus') || mime.includes('ogg') || mime.includes('opus')) {
      return 'oggopus';
    }
    if (name.endsWith('.wav') || name.endsWith('.pcm') || mime.includes('wav')) return 'lpcm';
    if (name.endsWith('.mp3') || mime.includes('mpeg')) return 'mp3';
    return 'oggopus';
  }
}
