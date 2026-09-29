/**
 * Месяц «за который» выдаётся зарплата: строка 'YYYY-MM' (так её принимает и
 * отдаёт API). Календарная арифметика — из reports/periodParams, «сегодня»
 * приходит снаружи (по календарю автосервиса, не браузера).
 */
import type { SelectOption } from '../../ui';
import type { SalaryMonthDetail } from '../../types';
import { RU_MONTHS_NOM, monthOfDay, monthTitle, shiftMonth, type MonthKey } from '../reports/periodParams';

/** На сколько месяцев назад от текущего можно отнести выплату. */
export const PAYOUT_MONTHS_BACK = 12;

/** Остаток за один прошлый месяц: положительный — долг, отрицательный — переплата. */
export type CarryOverMonth = SalaryMonthDetail['carryOver']['months'][number];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthString(value: string | null | undefined): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** MonthKey → 'YYYY-MM'. */
export function monthString(m: MonthKey): string {
  return `${m.year}-${String(m.month0 + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → «Сентябрь 2026». */
export function monthLabel(month: string): string {
  return monthTitle(monthOfDay(month));
}

/** «Сентябрь» для месяца того же года, что и опорный, иначе «Сентябрь 2025». */
export function monthNameLabel(month: string, refMonth: string): string {
  const m = monthOfDay(month);
  return m.year === monthOfDay(refMonth).year ? RU_MONTHS_NOM[m.month0] : monthTitle(m);
}

/** Текущий месяц и 12 предыдущих (новые сверху) + `extra` — выбранный или предвыбранный месяц вне этого окна. */
export function payoutMonthOptions(currentMonth: string, extra: string[] = []): SelectOption[] {
  const current = monthOfDay(currentMonth);
  const values = new Set<string>();
  for (let back = 0; back <= PAYOUT_MONTHS_BACK; back += 1) values.add(monthString(shiftMonth(current, -back)));
  for (const month of extra) if (isMonthString(month)) values.add(month);
  return [...values]
    .sort()
    .reverse()
    .map((value) => ({ value, label: monthLabel(value) }));
}

/** Самый давний месяц с долгом (remaining > 0) — с него начинают гасить; null, если долгов нет. */
export function oldestDebt(months: CarryOverMonth[]): CarryOverMonth | null {
  let oldest: CarryOverMonth | null = null;
  for (const item of months) {
    if (item.remaining > 0 && (oldest === null || item.month < oldest.month)) oldest = item;
  }
  return oldest;
}
