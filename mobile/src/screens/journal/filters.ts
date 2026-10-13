import { checkDateInstant, checkDateParts } from '../../../../shared/utils/checkDateTime';

export interface JournalFilters {
  dateFrom: string;
  dateTo: string;
  masterId: string;
  amountFrom: string;
  amountTo: string;
  hasDiscount: boolean;
  isReturned: boolean;
  isDeferred: boolean;
}

export const emptyJournalFilters = (): JournalFilters => ({
  dateFrom: '',
  dateTo: '',
  masterId: '',
  amountFrom: '',
  amountTo: '',
  hasDiscount: false,
  isReturned: false,
  isDeferred: false,
});

/** UI accepts Russian decimal commas; API receives finite numbers, including zero. */
export function journalAmount(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim()))
    throw new Error('Введите сумму в рублях и копейках, например 1500,50.');
  const amount = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(amount)) throw new Error('Введите корректную сумму.');
  return amount;
}

export function journalFilterError(filters: JournalFilters): string | null {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
    return 'Дата «От» должна быть не позже даты «До».';
  try {
    const from = journalAmount(filters.amountFrom);
    const to = journalAmount(filters.amountTo);
    if (from !== undefined && to !== undefined && from > to) return 'Сумма «От» должна быть не больше суммы «До».';
  } catch (error) {
    return error instanceof Error ? error.message : 'Проверьте сумму.';
  }
  return null;
}

export function journalDay(instant: Date, timeZone: string): string {
  const { year, month, day } = checkDateParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function journalPickerDate(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return checkDateInstant({ year, month, day: date, hour: 12, minute: 0, second: 0, millisecond: 0 }, timeZone);
}

export function journalPeriod(preset: 'today' | 'week' | 'month', timeZone: string, now = new Date()) {
  const today = journalDay(now, timeZone);
  const [year, month, day] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (preset === 'week') start.setUTCDate(day - 6);
  if (preset === 'month') start.setUTCDate(1);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: today };
}

export const journalDateLabel = (day: string) => day.split('-').reverse().join('.');

export function journalFilterCount(filters: JournalFilters): number {
  return Object.values(filters).filter(Boolean).length;
}

/** Keep positional search at index 1 for persistentCache; append new fields only. */
export function journalQueryKey(search: string, filters: JournalFilters) {
  return [
    'checks-infinite',
    search,
    filters.dateFrom,
    filters.dateTo,
    filters.masterId,
    filters.isDeferred ? 'deferred' : '',
    filters.isReturned ? 'returns' : '',
    journalAmount(filters.amountFrom) ?? '',
    journalAmount(filters.amountTo) ?? '',
    filters.hasDiscount ? 'discount' : '',
  ];
}

export function journalQueryParams(filters: JournalFilters) {
  return {
    ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
    ...(filters.dateTo && { dateTo: filters.dateTo }),
    ...(filters.masterId && { masterId: filters.masterId }),
    ...(filters.amountFrom.trim() && { amountFrom: journalAmount(filters.amountFrom) }),
    ...(filters.amountTo.trim() && { amountTo: journalAmount(filters.amountTo) }),
    ...(filters.hasDiscount && { hasDiscount: true }),
    ...(filters.isDeferred && { isDeferred: true }),
    ...(filters.isReturned && { isReturned: true }),
  };
}
