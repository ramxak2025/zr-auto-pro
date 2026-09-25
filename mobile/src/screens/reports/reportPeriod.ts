/**
 * reportPeriod — пресеты периода конструктора отчётов.
 *
 * Те же семь пресетов, что в «Финансовом отчёте» (ReportsScreen: сегодня /
 * вчера / неделя / месяц / квартал / год / произвольный) — владелец не должен
 * учить два разных календаря. Вынесено в чистый модуль (без react-native),
 * чтобы границы периодов проверялись тестами: у RU-поясов UTC-срез после
 * местной полуночи давал вчерашний день, поэтому все даты собираются из
 * ЛОКАЛЬНЫХ компонентов (`toLocalISODate`).
 */
import { REPORT_MAX_DAYS } from '../../../../shared/reports/catalog';
import { toLocalISODate } from '../../utils/dates';

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'custom', label: 'Произвольный' },
];

export interface DateRange {
  from: string;
  to: string;
}

export function toDateStr(d: Date): string {
  return toLocalISODate(d);
}

/** 'YYYY-MM-DD' → Date в локальной зоне (без UTC-сдвига, как у new Date(string)). */
export function parseDateStr(s: string): Date {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

/**
 * Месяц из пейджера: прошлые месяцы — календарные целиком, текущий — с 1-го
 * по сегодня (иначе `deltaPercent` сравнивал бы неполный месяц с полным).
 */
export function monthRange(cursor: Date, now: Date = new Date()): DateRange {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const isCurrent = monthIndex(cursor) === monthIndex(now);
  const last = isCurrent ? now : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from: toDateStr(first), to: toDateStr(last) };
}

export function getDateRange(period: Exclude<PeriodKey, 'custom'>, now: Date = new Date()): DateRange {
  const today = toDateStr(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const ys = toDateStr(y);
    return { from: ys, to: ys };
  }
  if (period === 'week') {
    // ISO-неделя: понедельник — начало.
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toDateStr(monday), to: today };
  }
  if (period === 'month') return monthRange(startOfMonth(now), now);
  if (period === 'quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { from: toDateStr(new Date(now.getFullYear(), qStartMonth, 1)), to: today };
  }
  return { from: toDateStr(new Date(now.getFullYear(), 0, 1)), to: today };
}

const RU_MONTHS = [
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
];
const RU_MONTHS_NOM = [
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
];

/** «Сентябрь 2026» — подпись пейджера месяцев. */
export function monthTitle(d: Date): string {
  return `${RU_MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

/** Человекочитаемый период для шапки экрана и PDF («Май 2026», «1 — 30 мая 2026»). */
export function formatPeriodLabel(period: PeriodKey, range: DateRange): string {
  const from = parseDateStr(range.from);
  const to = parseDateStr(range.to);
  if (period === 'today') return `Сегодня · ${from.getDate()} ${RU_MONTHS[from.getMonth()]}`;
  if (period === 'yesterday') return `Вчера · ${from.getDate()} ${RU_MONTHS[from.getMonth()]}`;
  if (period === 'month' && from.getDate() === 1) return `${RU_MONTHS_NOM[to.getMonth()]} ${to.getFullYear()}`;
  if (period === 'year') return `${to.getFullYear()} год`;
  if (period === 'quarter') {
    const q = Math.floor(to.getMonth() / 3) + 1;
    return `${q} квартал ${to.getFullYear()}`;
  }
  if (range.from === range.to) return `${from.getDate()} ${RU_MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (sameMonth) return `${from.getDate()} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
  return `${from.getDate()} ${RU_MONTHS[from.getMonth()]} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

/** Длина периода в днях включительно (1 для одного дня). */
export function rangeDays(range: DateRange): number {
  const from = parseDateStr(range.from);
  const to = parseDateStr(range.to);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * Клиентская проверка ДО запроса — те же правила, что у сервера (400):
 * начало не позже конца, длина ≤ REPORT_MAX_DAYS. null — период валиден.
 */
export function periodError(range: DateRange): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) {
    return 'Укажите обе даты периода';
  }
  const days = rangeDays(range);
  if (days < 1) return 'Дата начала позже даты конца';
  if (days > REPORT_MAX_DAYS) return `Период не длиннее ${REPORT_MAX_DAYS} дней — разбейте его на части`;
  return null;
}
