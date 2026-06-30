/**
 * Shared formatting + month-math helpers for the salary surfaces
 * (SalaryScreen owner list + SalaryEmployeeCard full-screen card).
 *
 * Pure, platform-agnostic, no React — kept in one place so the owner list
 * and the per-employee card format money / months identically (single
 * source of truth, no drift between the two screens).
 */
import { colors } from '../../theme';

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
