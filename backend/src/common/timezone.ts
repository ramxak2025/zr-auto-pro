import { Pool } from 'pg';
import { ttlCache } from './ttl-cache';

/**
 * Часовой пояс автосервиса (миграция 157, tenants.timezone).
 * --------------------------------------------------------------------------
 * Единственное место, где живут:
 *   • белый список поясов, из которого владелец выбирает свой регион;
 *   • чтение пояса тенанта (с коротким кешем, как auth-cache поверх TtlCache);
 *   • арифметика границ дня/месяца в ПРОИЗВОЛЬНОМ IANA-поясе.
 *
 * ЗАЧЕМ. Сегодня бизнес-границы («сегодня», «этот месяц») считаются по
 * фиксированному сдвигу `MSK_OFFSET_MS = 3ч` (reports/salary/shifts). Для
 * автосервиса во Владивостоке это означает, что «сегодня» начинается в 09:00
 * по местному времени. Хелпер даёт тем же расчётам ту же форму результата
 * (ISO-инстант начала суток), но для любого пояса.
 *
 * ПОЧЕМУ Intl, А НЕ ФИКСИРОВАННЫЙ СДВИГ. Российские пояса перевода часов не
 * знают (с 2014 года), поэтому арифметика «+N часов» для них корректна. Но
 * зашивать таблицу сдвигов руками — значит ошибиться на следующем изменении
 * закона о часовых зонах (Волгоград/Томск/Забайкалье уже двигались). Поэтому
 * сдвиг всегда спрашиваем у `Intl.DateTimeFormat` с `timeZone` для КОНКРЕТНОГО
 * инстанта: это работает и для поясов с летним временем (если список когда-то
 * пополнится не-российскими).
 *
 * ВНИМАНИЕ. Этот файл НИЧЕГО не переписывает в существующих сервисах — они
 * по-прежнему считают по Москве. Перевод бизнес-логики на пояс тенанта —
 * отдельная волна; здесь только инфраструктура и настройка.
 */

/** Пояс по умолчанию — ровно текущее поведение кода (MSK, UTC+3). */
export const DEFAULT_TIMEZONE = 'Europe/Moscow';

/** Один пояс из белого списка: IANA-id + подпись для UI. */
export interface TimezoneOption {
  /** IANA-идентификатор, он же значение в tenants.timezone. */
  id: string;
  /** Человеческая подпись для селектора («Москва»). */
  label: string;
  /** Смещение от UTC в подписи («UTC+3») — постоянное, перевода часов нет. */
  utc: string;
  /** Города-подсказки, чтобы владелец нашёл свой регион («Санкт-Петербург, Казань»). */
  hint: string;
}

/**
 * Белый список российских часовых поясов (МСК−1 … МСК+9), от Калининграда до
 * Камчатки. Порядок — с запада на восток, как в паспорте часовых зон РФ.
 * Значение вне этого списка сервер отклоняет (см. assertSupportedTimezone).
 */
export const RU_TIMEZONES: readonly TimezoneOption[] = [
  { id: 'Europe/Kaliningrad', label: 'Калининград', utc: 'UTC+2', hint: 'Калининградская область' },
  { id: 'Europe/Moscow', label: 'Москва', utc: 'UTC+3', hint: 'Санкт-Петербург, Краснодар, Казань' },
  { id: 'Europe/Samara', label: 'Самара', utc: 'UTC+4', hint: 'Ижевск, Ульяновск, Саратов' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург', utc: 'UTC+5', hint: 'Уфа, Пермь, Челябинск, Тюмень' },
  { id: 'Asia/Omsk', label: 'Омск', utc: 'UTC+6', hint: 'Омская область' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск', utc: 'UTC+7', hint: 'Новосибирск, Кемерово, Барнаул, Томск' },
  { id: 'Asia/Irkutsk', label: 'Иркутск', utc: 'UTC+8', hint: 'Улан-Удэ, Чита' },
  { id: 'Asia/Yakutsk', label: 'Якутск', utc: 'UTC+9', hint: 'Благовещенск, Чита (Забайкалье)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток', utc: 'UTC+10', hint: 'Хабаровск, Южно-Сахалинск' },
  { id: 'Asia/Magadan', label: 'Магадан', utc: 'UTC+11', hint: 'Сахалин (север), Среднеколымск' },
  { id: 'Asia/Kamchatka', label: 'Петропавловск-Камчатский', utc: 'UTC+12', hint: 'Анадырь, Чукотка' },
];

/** Быстрая проверка принадлежности белому списку. */
const RU_TIMEZONE_IDS = new Set<string>(RU_TIMEZONES.map((z) => z.id));

/** Плоский список id — для `@IsIn(...)` в DTO. */
export const SUPPORTED_TIMEZONE_IDS: string[] = RU_TIMEZONES.map((z) => z.id);

/** Результат проверки пояса в ICU кешируем: сама проверка строит форматтер. */
const knownZoneCache = new Map<string, boolean>();

/**
 * Известен ли пояс движку ICU этой сборки Node. Вторая линия обороны после
 * белого списка: если однажды в список попадёт id, которого нет в ICU,
 * форматтер бросил бы RangeError уже в рантайме расчётов.
 */
function isKnownToIntl(tz: string): boolean {
  const cached = knownZoneCache.get(tz);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  knownZoneCache.set(tz, ok);
  return ok;
}

/**
 * Пояс для АРИФМЕТИКИ (в отличие от normalizeTimezone, который сужает значение
 * до белого списка настройки). Расчёты границ обязаны работать в любом
 * валидном IANA-поясе — белый список ограничивает лишь то, что владелец может
 * выбрать в UI. Всё, чего ICU не знает (мусор, пустая строка, undefined),
 * превращается в Europe/Moscow, чтобы расчёт «сегодня» никогда не падал.
 */
function resolveZone(tz: unknown): string {
  if (typeof tz !== 'string') return DEFAULT_TIMEZONE;
  const trimmed = tz.trim();
  return trimmed && isKnownToIntl(trimmed) ? trimmed : DEFAULT_TIMEZONE;
}

/** Поддерживается ли пояс: белый список И ICU этой сборки Node. */
export function isSupportedTimezone(tz: unknown): tz is string {
  return typeof tz === 'string' && RU_TIMEZONE_IDS.has(tz) && isKnownToIntl(tz);
}

/**
 * Привести значение из БД/запроса к рабочему поясу: мусор, NULL и неизвестный
 * id молча становятся Москвой (то же поведение, что до миграции 157).
 * Для ВХОДЯЩИХ данных API молчать нельзя — там используется
 * assertSupportedTimezone.
 */
export function normalizeTimezone(tz: unknown): string {
  if (typeof tz !== 'string') return DEFAULT_TIMEZONE;
  const trimmed = tz.trim();
  return isSupportedTimezone(trimmed) ? trimmed : DEFAULT_TIMEZONE;
}

/**
 * Валидация пояса, пришедшего от клиента. Бросает Error с русским текстом —
 * вызывающий сервис оборачивает его в BadRequestException.
 */
export function assertSupportedTimezone(tz: unknown): string {
  const trimmed = typeof tz === 'string' ? tz.trim() : '';
  if (!isSupportedTimezone(trimmed)) {
    throw new Error(`Неизвестный часовой пояс: ${String(tz)}`);
  }
  return trimmed;
}

// ── Кеш пояса тенанта ───────────────────────────────────────────────────────

const TZ_CACHE_NAMESPACE = 'tenant:timezone:';

/**
 * TTL кеша пояса. Пояс меняется раз в жизни автосервиса, но кеш всё равно
 * короткий: он нужен, чтобы каждый расчёт «сегодня» не ходил лишний раз в БД,
 * а не чтобы держать значение часами. Смена пояса вдобавок сбрасывает ключ
 * явно (invalidateTenantTimezone), поэтому 5 минут — верхняя граница
 * рассинхрона только для теоретического пути, который забыл сбросить кеш.
 */
export const TENANT_TZ_CACHE_TTL_MS = 5 * 60_000;

function tzCacheKey(tenantID: string): string {
  return `${TZ_CACHE_NAMESPACE}${tenantID}`;
}

/**
 * Часовой пояс тенанта из tenants.timezone. Кешируется на TENANT_TZ_CACHE_TTL_MS
 * (TtlCache.wrap схлопывает параллельные промахи в один запрос — см. ttl-cache).
 * Любая ошибка чтения и любое неизвестное значение → Europe/Moscow: расчёт
 * «сегодня» не имеет права падать из-за настройки.
 */
export async function getTenantTimezone(pool: Pool, tenantID: string): Promise<string> {
  if (!tenantID) return DEFAULT_TIMEZONE;
  try {
    return await ttlCache.wrap(tzCacheKey(tenantID), TENANT_TZ_CACHE_TTL_MS, async () => {
      const { rows } = await pool.query('SELECT timezone FROM tenants WHERE id=$1', [tenantID]);
      return normalizeTimezone(rows[0]?.timezone);
    });
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Сбросить кеш пояса тенанта. Вызывается сразу после PATCH /my-company. */
export function invalidateTenantTimezone(tenantID: string): void {
  ttlCache.invalidate(tzCacheKey(tenantID));
}

// ── Границы дня/месяца в произвольном поясе ─────────────────────────────────

/**
 * Форматтеры дорогие в создании (ICU-таблицы), а зовём мы их на каждый расчёт
 * границ — поэтому по одному на пояс, навсегда. Поясов максимум ~11.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** Настенное время в поясе: разобранные компоненты даты/времени. */
export interface ZonedParts {
  year: number;
  /** 1–12 (НЕ 0-based, в отличие от Date.getMonth). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Компоненты настенного времени в поясе `tz` для инстанта `instant`.
 * Реализация — formatToParts вместо парсинга строки: строковый формат
 * локали может меняться между версиями ICU, состав частей — нет.
 */
export function getZonedParts(instant: Date, tz: string): ZonedParts {
  const parts = getFormatter(resolveZone(tz)).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };
  // 'hour: 2-digit' + hour12:false в некоторых ICU отдаёт 24 вместо 0 для
  // полуночи — нормализуем, иначе сутки «поедут» на день вперёд.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Смещение пояса относительно UTC в миллисекундах для КОНКРЕТНОГО инстанта
 * (положительное к востоку: Москва = +3ч). Считается как разница между
 * настенным временем в поясе и тем же моментом в UTC.
 */
export function getZoneOffsetMs(instant: Date, tz: string): number {
  const p = getZonedParts(instant, tz);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Секунды инстанта уже учтены в p.second; миллисекунды отбрасываем — сдвиги
  // поясов кратны минуте.
  const instantWholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asIfUTC - instantWholeSeconds;
}

/**
 * UTC-инстант, соответствующий настенному времени `y-m-d 00:00:00` в поясе.
 *
 * Прямая формула `Date.UTC(...) - offset` требует offset НА ИСКОМЫЙ момент,
 * которого мы ещё не знаем. Поэтому классические два прохода: берём сдвиг по
 * первому приближению и уточняем. Для российских поясов (без перевода часов)
 * второй проход всегда совпадает с первым; проход нужен для корректности на
 * поясах с DST, если список когда-нибудь расширят.
 */
function zonedWallClockToInstant(
  tz: string,
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wallAsUTC = Date.UTC(year, monthIndex, day, hour, minute, second);
  const firstGuessOffset = getZoneOffsetMs(new Date(wallAsUTC), tz);
  const firstGuess = wallAsUTC - firstGuessOffset;
  const refinedOffset = getZoneOffsetMs(new Date(firstGuess), tz);
  return new Date(refinedOffset === firstGuessOffset ? firstGuess : wallAsUTC - refinedOffset);
}

/** Начало суток (00:00 по местному времени) как UTC-инстант. */
export function startOfDayInZone(tz: string, ref: Date = new Date()): Date {
  const zone = resolveZone(tz);
  const p = getZonedParts(ref, zone);
  return zonedWallClockToInstant(zone, p.year, p.month - 1, p.day);
}

/** Начало суток со сдвигом на `days` дней (−1 = вчера, +1 = завтра). */
export function startOfDayInZoneOffset(tz: string, days: number, ref: Date = new Date()): Date {
  const zone = resolveZone(tz);
  const p = getZonedParts(ref, zone);
  // Date.UTC нормализует выход за границы месяца/года сам (день 0 = последний
  // день предыдущего месяца), поэтому ручной арифметики календаря не нужно.
  return zonedWallClockToInstant(zone, p.year, p.month - 1, p.day + days);
}

/** Начало месяца (1-е число, 00:00 по местному) как UTC-инстант. */
export function startOfMonthInZone(tz: string, ref: Date = new Date()): Date {
  const zone = resolveZone(tz);
  const p = getZonedParts(ref, zone);
  return zonedWallClockToInstant(zone, p.year, p.month - 1, 1);
}

/** Начало месяца со сдвигом на `months` месяцев (−1 = прошлый месяц). */
export function startOfMonthInZoneOffset(tz: string, months: number, ref: Date = new Date()): Date {
  const zone = resolveZone(tz);
  const p = getZonedParts(ref, zone);
  return zonedWallClockToInstant(zone, p.year, p.month - 1 + months, 1);
}

/**
 * Границы суток в поясе: `[start, end)` — start включительно, end
 * исключительно (начало следующих суток). Ровно та форма, которую ждут
 * SQL-условия вида `date >= $start AND date < $end`.
 */
export function dayBoundsInZone(tz: string, ref: Date = new Date()): { start: Date; end: Date } {
  return { start: startOfDayInZone(tz, ref), end: startOfDayInZoneOffset(tz, 1, ref) };
}

/** Границы месяца в поясе: `[start, end)`, end — 1-е число следующего месяца. */
export function monthBoundsInZone(tz: string, ref: Date = new Date()): { start: Date; end: Date } {
  return { start: startOfMonthInZone(tz, ref), end: startOfMonthInZoneOffset(tz, 1, ref) };
}

/**
 * Календарная дата в поясе как 'YYYY-MM-DD' — ключ для группировки по дням
 * (движение денег, график смен) и для сравнения с колонками типа `date`.
 */
export function zonedDateKey(instant: Date, tz: string): string {
  const p = getZonedParts(instant, tz);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}
