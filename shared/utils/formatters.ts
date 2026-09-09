/**
 * Format a number as Russian currency: "1 234 ₽"
 */
export function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} \u20BD`;
}

// ── Часовой пояс автосервиса (157) ─────────────────────────────────────────
// Владелец выбирает пояс в «Настройках компании» (tenants.timezone, PATCH
// /my-company). Форматтеры ниже принимают его ОПЦИОНАЛЬНЫМ последним
// аргументом: без него поведение прежнее — время устройства. Так экраны
// переводятся на пояс тенанта по одному, а не все разом.

/** Пояс по умолчанию — совпадает с DEFAULT_TIMEZONE на бэкенде. */
export const DEFAULT_TIMEZONE = 'Europe/Moscow';

/** Один пояс из белого списка: IANA-id + подписи для селектора. */
export interface TimezoneOption {
  /** IANA-идентификатор, он же значение Tenant.timezone. */
  id: string;
  /** Подпись в списке («Москва»). */
  label: string;
  /** Постоянное смещение («UTC+3») — в России перевода часов нет. */
  utc: string;
  /** Города-подсказки, чтобы владелец узнал свой регион. */
  hint: string;
}

/**
 * Российские часовые пояса, с запада на восток. ЗЕРКАЛО белого списка
 * RU_TIMEZONES из backend/src/common/timezone.ts — сервер принимает только эти
 * значения, поэтому списки обязаны совпадать по `id`.
 */
export const RU_TIMEZONES: TimezoneOption[] = [
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

/**
 * Пояс из белого списка по id. Неизвестный/пустой id → Москва (сервер
 * трактует его так же).
 */
export function timezoneOption(tz?: string | null): TimezoneOption {
  const found = RU_TIMEZONES.find((z) => z.id === tz);
  if (found) return found;
  return RU_TIMEZONES.filter((z) => z.id === DEFAULT_TIMEZONE)[0];
}

/** Подпись пояса для UI («Москва»). */
export function timezoneLabel(tz?: string | null): string {
  return timezoneOption(tz).label;
}

/** Компоненты настенного времени в поясе. */
interface ZonedParts {
  year: number;
  /** 1–12, не 0-based. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Разобрать инстант в компоненты настенного времени пояса `timeZone`.
 *
 * Реализация — `Intl.DateTimeFormat(...).formatToParts`, он есть и в Hermes
 * (iOS/Android), и в браузере. Любой сбой (пояс неизвестен ICU, урезанная
 * сборка без Intl) возвращает null, и вызывающий форматтер молча падает на
 * время устройства — прежнее поведение. Дата НИКОГДА не превращается в
 * «Invalid Date» и не роняет экран.
 */
function zonedParts(d: Date, timeZone: string): ZonedParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(d);
    const get = (type: string): number => {
      const p = parts.find((x) => x.type === type);
      return p ? parseInt(p.value, 10) : NaN;
    };
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
    // Некоторые сборки ICU отдают 24 вместо 0 для полуночи — нормализуем,
    // иначе «00:15» превратилось бы в «24:15».
    return { year, month, day, hour: hour % 24, minute };
  } catch {
    return null;
  }
}

/**
 * Format a date string to DD.MM.YYYY
 *
 * `timeZone` (157) — необязательный IANA-пояс автосервиса. Без него — время
 * устройства, как было.
 */
export function formatDateShort(dateStr: string, timeZone?: string | null): string {
  const d = new Date(dateStr);
  if (timeZone) {
    const p = zonedParts(d, timeZone);
    if (p) {
      return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
    }
  }
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format a date string to DD.MM.YY HH:mm
 *
 * `timeZone` (157) — необязательный IANA-пояс автосервиса. Без него — время
 * устройства, как было. Пример использования — CompanySettingsScreen /
 * CompanySettingsPage: подпись «Сейчас в этом поясе: …».
 */
export function formatDateTime(dateStr: string, timeZone?: string | null): string {
  const d = new Date(dateStr);
  const p = timeZone ? zonedParts(d, timeZone) : null;
  const day = String(p ? p.day : d.getDate()).padStart(2, '0');
  const month = String(p ? p.month : d.getMonth() + 1).padStart(2, '0');
  const year = String(p ? p.year : d.getFullYear()).slice(2);
  const hours = String(p ? p.hour : d.getHours()).padStart(2, '0');
  const minutes = String(p ? p.minute : d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Время HH:mm — в поясе автосервиса, если он передан, иначе на устройстве.
 */
export function formatTimeShort(dateStr: string | Date, timeZone?: string | null): string {
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  const p = timeZone ? zonedParts(d, timeZone) : null;
  const hours = String(p ? p.hour : d.getHours()).padStart(2, '0');
  const minutes = String(p ? p.minute : d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Get a time-based greeting in Russian.
 *
 * `timeZone` (157) — необязательный пояс автосервиса: владелец из Владивостока
 * в командировке в Москве всё равно видит приветствие по времени своего
 * сервиса. Без аргумента — время устройства, как было.
 */
export function getGreeting(timeZone?: string | null): string {
  const now = new Date();
  const p = timeZone ? zonedParts(now, timeZone) : null;
  const hour = p ? p.hour : now.getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

/**
 * Payment method labels in Russian.
 */
export const paymentMethodLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
  installment: 'Рассрочка',
};

/**
 * Role labels in Russian.
 */
export const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

/**
 * Check if subscription has expired.
 */
export function isSubscriptionExpired(subscriptionEnd?: string | null): boolean {
  if (!subscriptionEnd) return false;
  return new Date(subscriptionEnd) < new Date();
}
