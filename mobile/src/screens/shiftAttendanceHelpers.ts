import type { Shift } from '../../../shared/types';
import { formatDayKey } from '../../../shared/utils/formatters';

/** DATE is a business-day label, not an instant to convert to the device zone. */
export function canonicalShiftDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  if (!match) return null;
  const day = match[1];
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  // Old servers serialized the PostgreSQL DATE as UTC midnight. Preserve its
  // calendar label rather than treating that midnight as an attendance event.
  if (value !== day && Number.isNaN(new Date(value).getTime())) return null;
  return day;
}

export function attendanceCalendarDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}

export function attendanceMonthKey(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultAttendanceDate(month: Date, timeZone: string, now = new Date()): string {
  const monthKey = attendanceMonthKey(month);
  const today = formatDayKey(now, timeZone);
  return today.startsWith(`${monthKey}-`) ? today : `${monthKey}-01`;
}

export function attendanceDays(month: Date): string[] {
  const monthKey = attendanceMonthKey(month);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`);
}

/** No device-time fallback: an unavailable wall-clock time is shown as unknown. */
export function formatShiftTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const hour = part('hour');
    const minute = part('minute');
    const second = part('second');
    if (![hour, minute, second].every(Number.isFinite)) return '—';
    return [hour % 24, minute, second].map((n) => String(n).padStart(2, '0')).join(':');
  } catch {
    return '—';
  }
}

export function attendanceShiftsForDate(value: unknown, day: string): Shift[] {
  if (!Array.isArray(value)) throw new Error('Не удалось прочитать историю смен');
  return value.filter(
    (shift): shift is Shift =>
      !!shift &&
      typeof shift.id === 'string' &&
      typeof shift.userId === 'string' &&
      typeof shift.openedAt === 'string' &&
      canonicalShiftDate(shift.date) === day,
  );
}

export function shiftAttendanceStatus(shift: Pick<Shift, 'closedAt' | 'isAutoClosed'>): string {
  if (!shift.closedAt) return 'Открыта';
  return shift.isAutoClosed ? 'Закрыта автоматически' : 'Закрыта';
}
