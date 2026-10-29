import type { OwnerHomeProfit, OwnerHomeProfitDelta } from '../../../../../shared/types/ownerHome';
import { checkDateInstant } from '../../../../../shared/utils/checkDateTime';
import { formatMoney } from '../../../../../shared/utils/formatters';

export function ownerHomeEnabled(flag: unknown, role: string | undefined): boolean {
  return flag === true && role === 'director';
}

export interface OwnerHomeScope {
  key: readonly (string | number | null)[];
  isCurrent: () => boolean;
}

/** A stale screen must neither start a request in a new session nor retain its response. */
export async function loadOwnerHome<T>(scope: OwnerHomeScope, load: () => Promise<{ data: T }>): Promise<T> {
  if (!scope.isCurrent()) throw new Error('Сессия изменилась');
  const response = await load();
  if (!scope.isCurrent()) throw new Error('Сессия изменилась');
  return response.data;
}

const keyDate = (key: string): Date => new Date(`${key}T12:00:00Z`);
const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

/** Calendar arithmetic only. Financial windows and tenant today always come from the server. */
export function moveOwnerDay(key: string, amount: number): string {
  const date = keyDate(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function moveOwnerMonth(key: string, amount: number, preferredDay = Number(key.slice(8, 10))): string {
  const date = keyDate(key);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount + 1, 0, 12));
  last.setUTCDate(Math.min(preferredDay, last.getUTCDate()));
  return dateKey(last);
}

export function ownerPickerDate(key: string, timezone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return checkDateInstant({ year, month, day, hour: 12, minute: 0, second: 0, millisecond: 0 }, timezone);
}

export function ownerDateLabel(key: string, includeYear = false): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(keyDate(key));
}

export function ownerRangeLabel(from: string, through: string, currentYear?: string): string {
  const label = (date: string) => ownerDateLabel(date, date.slice(0, 4) !== currentYear);
  if (from === through) return label(from);
  if (from.slice(0, 7) === through.slice(0, 7)) {
    return `${Number(from.slice(8))}–${label(through)}`;
  }
  return `${label(from)} — ${label(through)}`;
}

export function ownerClock(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

export function ownerVisitsRange(profit: OwnerHomeProfit, period: 'day' | 'month') {
  return { from: period === 'day' ? profit.canonicalDate : profit.current.period.from, to: profit.canonicalDate };
}

/** Only format the server delta. A nonpositive baseline must never acquire a client-made percentage. */
export function ownerDeltaLabel(delta: OwnerHomeProfitDelta, previous: number): string {
  const amount = `${delta.amount > 0 ? '+' : ''}${formatMoney(delta.amount, 2)}`;
  if (previous <= 0 || delta.percent === null || !Number.isFinite(delta.percent)) return amount;
  return `${amount} · ${delta.percent > 0 ? '+' : ''}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(delta.percent)}%`;
}

/** Display precision only; the server remains the source of every monetary value. */
export function ownerMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ₽`;
}

export function ownerPercentLabel(delta: OwnerHomeProfitDelta, previous: number): string | null {
  if (previous <= 0 || delta.percent === null || !Number.isFinite(delta.percent)) return null;
  return `${delta.percent > 0 ? '+' : ''}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(delta.percent)}%`;
}

/** Chart geometry for two displayed aggregates, never a target, forecast or time series. */
export function ownerComparisonBars(current: number, previous: number): { current: number; previous: number } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || current <= 0 || previous <= 0) return null;
  const maximum = Math.max(current, previous);
  return { current: current / maximum, previous: previous / maximum };
}
