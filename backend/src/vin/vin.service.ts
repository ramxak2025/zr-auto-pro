import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { isValidVin, normalizeVin, vinCheckDigitOk, vinModelYear, vinNeedsCheckDigit } from './vin.util';
import { lookupWmi } from './wmi-table';
import { decodeVinNhtsa, findVinProvider, VIN_PROVIDERS, vinProviderInfo, VinProviderAdapter } from './providers';
import type { VinDecodeResult, VinDecodeSource, VinSettings } from './vin.types';
import { UpdateVinSettingsDto } from './dto/update-vin-settings.dto';

/** Расшифровка VIN неизменна — сутки в памяти по нормализованному VIN. */
const DECODE_CACHE_TTL_MS = 24 * 60 * 60_000;
/** Платный сервис не ответил — результат «ущербный», через 5 минут пробуем снова. */
const DECODE_CACHE_DEGRADED_TTL_MS = 5 * 60_000;
const DECODE_CACHE_MAX_ENTRIES = 5000;
/** Не более 60 расшифровок в минуту на тенанта (кэш-попадания не считаются). */
const DECODE_RATE_LIMIT_PER_MIN = 60;
const RATE_WINDOW_MS = 60_000;
const PAID_TIMEOUT_MS = 6000;
const NHTSA_TIMEOUT_MS = 4000;
/** «Опция включена?» спрашивают cars/clients на каждый поиск — 30 с кэша. */
const ENABLED_CACHE_TTL_MS = 30_000;
const CREDENTIAL_MAX_LEN = 512;

export const VIN_NOTE_PAID_FAILED = 'Платный сервис не ответил — использованы бесплатные источники';
export const VIN_NOTE_PAID_EMPTY = 'Платный сервис не знает этот VIN — использованы бесплатные источники';
export const VIN_NOTE_CHECK_DIGIT = 'Контрольная цифра VIN не сходится — проверьте номер';

interface ProviderConfig {
  provider: VinProviderAdapter;
  credentials: Record<string, string>;
}

interface VinSettingsRow {
  vin_enabled: boolean | null;
  vin_decoder_provider: string | null;
  has_credentials: boolean | null;
}

/**
 * VIN (171, 2026-09-25): расшифровка марки/модели и настройки опции тенанта.
 *
 * ИСТОЧНИКИ ПО ОЧЕРЕДИ (первый давший марку побеждает, модель — лучшая из
 * доступных):
 *   1. платный провайдер тенанта (ключ клиента; см. providers/) — 6 с;
 *      ошибка/пусто → пометка в notes и дальше;
 *   2. NHTSA vPIC (бесплатно, без ключа) — 4 с, любая ошибка молча дальше;
 *   3. офлайн-таблица WMI (wmi-table.ts): первые 3 символа → марка/завод.
 *
 * Год — vinModelYear по 10-й позиции, если источник не дал точнее.
 * Некорректный VIN — это НЕ 400: поле ввода дёргает расшифровку на лету, а
 * «пока не 17 символов» — штатное состояние.
 */
@Injectable()
export class VinService {
  private readonly logger = new Logger('VinService');
  private readonly decodeCache = new Map<string, { value: VinDecodeResult; expiresAt: number }>();
  private readonly rate = new Map<string, { count: number; resetAt: number }>();

  /**
   * Подменяемый fetch для адаптеров — тесты без сети (backend/test/vin-decode).
   * В проде undefined → глобальный fetch.
   */
  fetchImpl: typeof fetch | undefined;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  static enabledCacheKey(tenantId: string): string {
    return `vin:enabled:${tenantId}`;
  }

  // ── Опция тенанта ─────────────────────────────────────────────────────────

  /**
   * Включена ли опция «VIN-код автомобиля» у тенанта. Кэш 30 с (сбрасывается
   * в updateSettings); ошибка чтения → false (fail-closed: без опции VIN
   * просто игнорируется, как и до 171).
   */
  async isEnabled(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
      return await ttlCache.wrap(VinService.enabledCacheKey(tenantId), ENABLED_CACHE_TTL_MS, async () => {
        const { rows } = await this.pool.query('SELECT vin_enabled FROM tenants WHERE id=$1', [tenantId]);
        return rows[0]?.vin_enabled === true;
      });
    } catch (err) {
      this.logger.warn(`vin_enabled lookup failed for tenant ${tenantId}: ${(err as Error)?.message}`);
      return false;
    }
  }

  // ── Настройки ─────────────────────────────────────────────────────────────

  private async loadSettingsRow(tenantId: string): Promise<VinSettingsRow> {
    const { rows } = await this.pool.query(
      `SELECT vin_enabled, vin_decoder_provider,
              (vin_decoder_credentials IS NOT NULL) AS has_credentials
         FROM tenants WHERE id=$1`,
      [tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Компания не найдена' });
    return rows[0] as VinSettingsRow;
  }

  private toSettings(row: VinSettingsRow): VinSettings {
    // Провайдер, которого больше нет в реестре, клиенту не показываем: форма
    // рисуется по providers, и «неизвестный id» сломала бы селект.
    const provider = findVinProvider(row.vin_decoder_provider);
    return {
      enabled: row.vin_enabled === true,
      provider: provider?.id ?? null,
      hasCredentials: !!provider && row.has_credentials === true,
      providers: VIN_PROVIDERS.map(vinProviderInfo),
    };
  }

  async getSettings(tenantId: string): Promise<VinSettings> {
    return this.toSettings(await this.loadSettingsRow(tenantId));
  }

  /**
   * PATCH /vin/settings. credentials: объект — сохранить/заменить (по `fields`
   * провайдера, лишние ключи отбрасываются); null — удалить; undefined — не
   * трогать. Смена провайдера без новых учётных данных сбрасывает сохранённые:
   * они от другого сервиса. Значения секретов не логируются и не возвращаются.
   */
  async updateSettings(tenantId: string, dto: UpdateVinSettingsDto): Promise<VinSettings> {
    const current = await this.loadSettingsRow(tenantId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (dto.enabled !== undefined) {
      sets.push(`vin_enabled=$${idx++}`);
      vals.push(dto.enabled === true);
    }

    let nextProviderId: string | null = findVinProvider(current.vin_decoder_provider)?.id ?? null;
    let providerChanged = false;
    if (dto.provider !== undefined) {
      if (dto.provider === null || dto.provider === '') {
        nextProviderId = null;
      } else {
        const provider = findVinProvider(dto.provider);
        if (!provider) throw new BadRequestException({ message: 'Неизвестный сервис расшифровки VIN' });
        nextProviderId = provider.id;
      }
      providerChanged = nextProviderId !== (current.vin_decoder_provider ?? null);
      if (providerChanged) {
        sets.push(`vin_decoder_provider=$${idx++}`);
        vals.push(nextProviderId);
      }
    }

    if (dto.credentials !== undefined) {
      if (dto.credentials === null) {
        sets.push('vin_decoder_credentials=NULL');
      } else {
        const provider = findVinProvider(nextProviderId);
        if (!provider) throw new BadRequestException({ message: 'Сначала выберите сервис расшифровки VIN' });
        const clean = this.validateCredentials(provider, dto.credentials);
        sets.push(`vin_decoder_credentials=$${idx++}::jsonb`);
        vals.push(JSON.stringify(clean));
      }
    } else if (providerChanged) {
      sets.push('vin_decoder_credentials=NULL');
    }

    if (sets.length === 0) return this.toSettings(current);

    sets.push('updated_at=now()');
    vals.push(tenantId);
    const { rows } = await this.pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id=$${idx}
       RETURNING vin_enabled, vin_decoder_provider, (vin_decoder_credentials IS NOT NULL) AS has_credentials`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Компания не найдена' });
    ttlCache.invalidate(VinService.enabledCacheKey(tenantId));
    return this.toSettings(rows[0] as VinSettingsRow);
  }

  private validateCredentials(provider: VinProviderAdapter, input: Record<string, unknown>): Record<string, string> {
    const allowed = new Map(provider.fields.map((f) => [f.key, f.label] as const));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      const label = allowed.get(key);
      if (!label) continue; // чужие ключи молча отбрасываем — форму рисует клиент по fields
      if (typeof value !== 'string')
        throw new BadRequestException({ message: `Некорректное значение поля «${label}»` });
      const trimmed = value.trim();
      if (trimmed.length > CREDENTIAL_MAX_LEN) {
        throw new BadRequestException({ message: `Слишком длинное значение поля «${label}»` });
      }
      if (trimmed) out[key] = trimmed;
    }
    const missing = provider.fields.filter((f) => !out[f.key]).map((f) => f.label);
    if (missing.length > 0) throw new BadRequestException({ message: `Заполните: ${missing.join(', ')}` });
    return out;
  }

  // ── Расшифровка ───────────────────────────────────────────────────────────

  async decode(tenantId: string, rawVin: string): Promise<VinDecodeResult> {
    const vin = normalizeVin(rawVin);
    if (!isValidVin(vin)) {
      return { vin, valid: false, make: null, model: null, year: null, makeModel: null, source: 'none' };
    }

    const config = await this.loadProviderConfig(tenantId);
    // Ключ кэша включает провайдера: бесплатный результат общий для всех
    // тенантов, платный — общий для тенантов с тем же сервисом (ответ сервиса
    // от ключа не зависит, самих ключей в кэше нет).
    const cacheKey = `${vin}:${config?.provider.id ?? 'free'}`;
    const hit = this.decodeCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    this.assertRateLimit(tenantId);
    const result = await this.decodeUncached(vin, config);
    const degraded = (result.notes ?? []).includes(VIN_NOTE_PAID_FAILED);
    this.remember(cacheKey, result, degraded ? DECODE_CACHE_DEGRADED_TTL_MS : DECODE_CACHE_TTL_MS);
    return result;
  }

  private async loadProviderConfig(tenantId: string): Promise<ProviderConfig | null> {
    if (!tenantId) return null;
    const { rows } = await this.pool.query(
      'SELECT vin_decoder_provider, vin_decoder_credentials FROM tenants WHERE id=$1',
      [tenantId],
    );
    const provider = findVinProvider(rows[0]?.vin_decoder_provider);
    const credentials = rows[0]?.vin_decoder_credentials;
    if (!provider || !credentials || typeof credentials !== 'object') return null;
    return { provider, credentials: credentials as Record<string, string> };
  }

  private async decodeUncached(vin: string, config: ProviderConfig | null): Promise<VinDecodeResult> {
    const notes: string[] = [];
    const result: VinDecodeResult = {
      vin,
      valid: true,
      make: null,
      model: null,
      year: vinModelYear(vin),
      makeModel: null,
      source: 'none',
      bodyType: null,
      engine: null,
      fuel: null,
    };
    if (vinNeedsCheckDigit(vin) && !vinCheckDigitOk(vin)) notes.push(VIN_NOTE_CHECK_DIGIT);

    // 1. Платный провайдер тенанта — по ключу клиента.
    if (config) {
      try {
        const paid = await withDeadline(
          config.provider.decode(vin, config.credentials, { timeoutMs: PAID_TIMEOUT_MS, fetchImpl: this.fetchImpl }),
          PAID_TIMEOUT_MS + 500,
        );
        if (paid?.make) this.absorb(result, paid, 'paid');
        else notes.push(VIN_NOTE_PAID_EMPTY);
      } catch (err) {
        // Текст ошибки адаптер уже пропустил через maskSecrets — ключей в логе нет.
        this.logger.warn(`VIN paid provider ${config.provider.id} failed: ${(err as Error)?.message}`);
        notes.push(VIN_NOTE_PAID_FAILED);
      }
    }

    // 2. NHTSA — когда марки ещё нет или платный не дал модель.
    if (!result.make || !result.model) {
      const free = await decodeVinNhtsa(vin, { timeoutMs: NHTSA_TIMEOUT_MS, fetchImpl: this.fetchImpl });
      if (free?.make) {
        if (!result.make) {
          this.absorb(result, free, 'nhtsa');
        } else if (!result.model && sameMake(result.make, free.make)) {
          result.model = free.model ?? null;
          this.fillExtras(result, free);
        }
      }
    }

    // 3. Офлайн-таблица WMI — марка/завод по первым трём символам.
    if (!result.make) {
      const entry = lookupWmi(vin);
      if (entry) {
        if (entry.make) {
          result.make = entry.make;
          result.source = 'wmi';
        }
        const where = [entry.manufacturer, entry.country].filter(Boolean).join(', ');
        if (where) notes.push(`Производитель по WMI: ${where}`);
        if (entry.ambiguous && entry.ambiguous.length > 0) {
          notes.push(`На этом заводе выпускались также: ${entry.ambiguous.join(', ')} — проверьте марку`);
        }
      }
    }

    result.makeModel = [result.make, result.model].filter(Boolean).join(' ') || null;
    if (notes.length > 0) result.notes = notes;
    return result;
  }

  private absorb(result: VinDecodeResult, partial: Partial<VinDecodeResult>, source: VinDecodeSource): void {
    result.make = partial.make ?? result.make;
    result.model = partial.model ?? null;
    result.source = source;
    if (partial.year) result.year = partial.year;
    this.fillExtras(result, partial);
  }

  private fillExtras(result: VinDecodeResult, partial: Partial<VinDecodeResult>): void {
    if (!result.bodyType && partial.bodyType) result.bodyType = partial.bodyType;
    if (!result.engine && partial.engine) result.engine = partial.engine;
    if (!result.fuel && partial.fuel) result.fuel = partial.fuel;
  }

  // ── Кэш и лимит ───────────────────────────────────────────────────────────

  private remember(key: string, value: VinDecodeResult, ttlMs: number): void {
    if (!this.decodeCache.has(key) && this.decodeCache.size >= DECODE_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.decodeCache) if (v.expiresAt <= now) this.decodeCache.delete(k);
      while (this.decodeCache.size >= DECODE_CACHE_MAX_ENTRIES) {
        const oldest = this.decodeCache.keys().next();
        if (oldest.done) break;
        this.decodeCache.delete(oldest.value);
      }
    }
    this.decodeCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private assertRateLimit(tenantId: string): void {
    const now = Date.now();
    const key = tenantId || 'anon';
    if (this.rate.size > 1000) {
      for (const [k, v] of this.rate) if (v.resetAt <= now) this.rate.delete(k);
    }
    const slot = this.rate.get(key);
    if (!slot || slot.resetAt <= now) {
      this.rate.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return;
    }
    slot.count += 1;
    if (slot.count > DECODE_RATE_LIMIT_PER_MIN) {
      throw new HttpException(
        { message: 'Слишком много расшифровок VIN — подождите минуту' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/** Марки равны с точностью до регистра и небуквенных символов («Skoda» = «ŠKODA»). */
function sameMake(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  return fold(a) === fold(b);
}

/** Жёсткий дедлайн поверх адаптера: даже «зависший» decode не держит запрос дольше. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`таймаут ${ms} мс`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
