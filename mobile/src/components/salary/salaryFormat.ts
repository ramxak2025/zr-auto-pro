/**
 * Shared formatting + month-math helpers for the salary surfaces
 * (SalaryScreen owner list + SalaryEmployeeCard full-screen card).
 *
 * Pure, platform-agnostic, no React — kept in one place so the owner list
 * and the per-employee card format money / months identically (single
 * source of truth, no drift between the two screens).
 */
import { colors } from '../../theme';
import type { SalaryMonthDetail } from '../../../../shared/types';

export const RUBLE = '₽';

export const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

export const MONTH_NAMES_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** «125 000 ₽» — grouped thousands + ruble sign. NaN/Infinity → 0. */
export function formatMoney(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    ' ' +
    RUBLE
  );
}

/** Compact money for tight chip rows: ≥100 000 → «125 к ₽», else grouped. */
export function formatMoneyShort(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  if (Math.abs(v) >= 100000) return Math.round(v / 1000).toString() + ' к ' + RUBLE;
  return formatMoney(v);
}

/** First-of-month Date → 'YYYY-MM'. */
export function formatMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** First/last calendar day of the month as 'YYYY-MM-DD'. */
export function monthBounds(d: Date): { dateFrom: string; dateTo: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return { dateFrom: `${y}-${pad(m + 1)}-01`, dateTo: `${y}-${pad(m + 1)}-${pad(last)}` };
}

/** 'YYYY-MM' → first-of-month Date. Invalid → current month. */
export function parseMonthKey(key?: string): Date {
  if (key && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map((s) => parseInt(s, 10));
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      return new Date(y, m - 1, 1);
    }
  }
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

/** First-of-month Date shifted by `delta` months. */
export function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** «Июнь 2026». */
export function monthLabelFull(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** «Июн 2026» — short month chip label. */
export function monthLabelShort(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** 'YYYY-MM-DD' (or ISO) → «14 июня». */
export function formatDayMonth(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]}`;
}

/** 'YYYY-MM-DD' (or ISO) → «14 июня в 09:30». */
export function formatDayMonthTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]} в ${hh}:${mi}`;
}

/** Two-letter initials from a full name. */
export function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

const AVATAR_COLORS: [string, string][] = [
  [colors.primary[500], colors.primary[700]],
  [colors.green[500], colors.green[700]],
  [colors.orange[500], colors.orange[600]],
  [colors.purple[700], colors.indigo[600]],
  [colors.teal[600], colors.green[700]],
  [colors.rose[500], colors.rose[600]],
  [colors.amber[600], colors.orange[600]],
  [colors.blue[500], colors.blue[700]],
];

/** Deterministic gradient pair for an avatar, hashed off the name. */
export function getAvatarColors(name?: string): [string, string] {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Is this first-of-month Date the current calendar month? */
export function isCurrentMonth(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ── Месяц «за который» (правка 2026-09-30) ─────────────────────────────────────
// Выплата и расход относятся к месяцу 'YYYY-MM', который может не совпадать с
// месяцем даты факта: выдал в октябре за сентябрь → в отчётах это сентябрь.

/** Строгая проверка ключа 'YYYY-MM' (в отличие от parseMonthKey не подменяет мусор текущим месяцем). */
export function isMonthKey(key: unknown): key is string {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

/** 'YYYY-MM' → «Сентябрь 2026» (с `withYear = false` — «Сентябрь»); невалидный ключ → ''. */
export function monthKeyLabel(key?: string | null, withYear = true): string {
  if (!isMonthKey(key)) return '';
  const name = MONTH_NAMES[Number(key.slice(5, 7)) - 1];
  return withYear ? `${name} ${key.slice(0, 4)}` : name;
}

/** 'YYYY-MM' → «сентябрь» (с `withYear` — «сентябрь 2026») для бегущего текста: «за сентябрь». */
export function monthKeyInline(key?: string | null, withYear = false): string {
  if (!isMonthKey(key)) return '';
  const name = MONTH_NAMES[Number(key.slice(5, 7)) - 1].toLowerCase();
  return withYear ? `${name} ${key.slice(0, 4)}` : name;
}

/**
 * Заголовок листа выплаты: «Выплата за сентябрь — Иван». Год добавляется, только если месяц
 * не из текущего года (полное «Сентябрь 2026» уже стоит в строке «За какой месяц» формы),
 * иначе заголовок с длинным именем не помещается в шапку Modal.
 */
export function payoutSheetTitle(monthKey: string, employeeName?: string | null, now: Date = new Date()): string {
  const withYear = isMonthKey(monthKey) && monthKey.slice(0, 4) !== String(now.getFullYear());
  const month = monthKeyInline(monthKey, withYear);
  return (month ? 'Выплата за ' + month : 'Выплата') + (employeeName ? ' — ' + employeeName : '');
}

export interface MonthOption {
  key: string;
  label: string;
}

/**
 * Месяцы для пикера «За какой месяц»: текущий и `count - 1` предыдущих, свежие
 * сверху. `include` — ключи, которых может не быть в окне (открыт месяц старше
 * года): их всегда можно выбрать и они остаются в списке.
 */
export function recentMonthOptions(
  count = 13,
  now: Date = new Date(),
  include: ReadonlyArray<string | null | undefined> = [],
): MonthOption[] {
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const keys = new Set<string>();
  for (let i = 0; i < count; i++) keys.add(formatMonthKey(addMonths(current, -i)));
  for (const k of include) if (isMonthKey(k)) keys.add(k);
  return Array.from(keys)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((key) => ({ key, label: monthKeyLabel(key) }));
}

/** 'YYYY-MM-DD' или ISO → 'YYYY-MM' (по локальному времени устройства, как день в ленте); мусор → ''. */
export function monthKeyOfDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  // Чистая дата — берём префикс: new Date('2026-09-01') это UTC-полночь и в поясах западнее UTC даёт август.
  const plain = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr);
  if (plain) return `${plain[1]}-${plain[2]}`;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '' : formatMonthKey(d);
}

/**
 * Бейдж расхода «за сентябрь»: только если месяц «за который» задан и не совпадает
 * с месяцем даты. Год добавляется, когда он отличается от года даты. '' — бейдж не нужен.
 */
export function periodBadgeLabel(periodMonth: string | null | undefined, dateStr: string | null | undefined): string {
  if (!isMonthKey(periodMonth)) return '';
  const dateKey = monthKeyOfDate(dateStr);
  if (!dateKey || dateKey === periodMonth) return '';
  return 'за ' + monthKeyInline(periodMonth, periodMonth.slice(0, 4) !== dateKey.slice(0, 4));
}

export interface CarryOverRow {
  month: string;
  /** Округлённый до рубля остаток: > 0 — долг, < 0 — переплата. */
  amount: number;
}

/**
 * Строки блока «Не выплачено за прошлые месяцы» из `carryOver.months` (порядок
 * контракта — свежие сверху). Остатки, округлившиеся до 0, отбрасываются.
 * Старый backend без `carryOver` — пустой список.
 */
export function carryOverRows(carryOver?: SalaryMonthDetail['carryOver'] | null): CarryOverRow[] {
  const rows: CarryOverRow[] = [];
  for (const m of carryOver?.months ?? []) {
    const amount = Math.round(Number(m.remaining));
    if (isMonthKey(m.month) && Number.isFinite(amount) && amount !== 0) rows.push({ month: m.month, amount });
  }
  return rows;
}

/**
 * Подсказка суммы «К выплате» по месяцам для формы выплаты: остаток открытого
 * месяца + долги прошлых месяцев из `carryOver`. Переплата и нули — не подсказка.
 * Для месяцев, которых здесь нет, сумма неизвестна (подсказка не показывается).
 */
export function buildPayoutSuggestions(
  detail:
    | (Pick<SalaryMonthDetail, 'remainingAmount'> & { carryOver?: SalaryMonthDetail['carryOver'] | null })
    | null
    | undefined,
  openMonthKey: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!detail) return out;
  for (const row of carryOverRows(detail.carryOver)) {
    if (row.amount > 0) out[row.month] = row.amount;
  }
  const open = Math.round(detail.remainingAmount ?? 0);
  if (isMonthKey(openMonthKey) && open > 0) out[openMonthKey] = open;
  return out;
}
