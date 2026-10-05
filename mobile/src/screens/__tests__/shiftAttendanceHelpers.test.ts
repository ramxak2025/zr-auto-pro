import type { Shift } from '../../../../shared/types';
import {
  attendanceCalendarDate,
  attendanceDays,
  attendanceMonthKey,
  attendanceShiftsForDate,
  canonicalShiftDate,
  defaultAttendanceDate,
  formatShiftTime,
  shiftAttendanceStatus,
} from '../shiftAttendanceHelpers';

function shift(id: string, date: string, extra: Partial<Shift> = {}): Shift {
  return {
    id,
    tenantId: 'tenant',
    userId: 'employee',
    date,
    openedAt: '2026-10-05T06:03:27.125Z',
    isAutoClosed: false,
    ...extra,
  };
}

describe('attendance business dates', () => {
  it('preserves the DATE label from canonical and legacy PostgreSQL payloads', () => {
    expect(canonicalShiftDate('2026-10-05')).toBe('2026-10-05');
    expect(canonicalShiftDate('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(canonicalShiftDate('2026-10-05T00:00:00.000Z')).not.toBe('2026-10-04');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-10-05Tinvalid', 'garbage', '', null])(
    'rejects invalid calendar dates: %s',
    (value) => expect(canonicalShiftDate(value)).toBeNull(),
  );

  it('uses the tenant day across the device month boundary', () => {
    const now = new Date('2026-09-30T15:00:00Z');
    expect(defaultAttendanceDate(attendanceCalendarDate('2026-10-01'), 'Asia/Vladivostok', now)).toBe('2026-10-01');
    expect(defaultAttendanceDate(attendanceCalendarDate('2026-09-01'), 'Europe/Moscow', now)).toBe('2026-09-30');
  });

  it('starts another month on its first day and preserves date-only selection', () => {
    const month = attendanceCalendarDate('2026-08-31');
    expect(attendanceMonthKey(month)).toBe('2026-08');
    expect(defaultAttendanceDate(month, 'Europe/Moscow', new Date('2026-10-05T10:00:00Z'))).toBe('2026-08-01');
    expect(month.getDate()).toBe(31);
    expect(month.getMonth()).toBe(7);
  });

  it('offers every day, including leap day, without crossing into another month', () => {
    const days = attendanceDays(attendanceCalendarDate('2028-02-01'));
    expect(days).toHaveLength(29);
    expect(days[0]).toBe('2028-02-01');
    expect(days[28]).toBe('2028-02-29');
    expect(attendanceDays(attendanceCalendarDate('2026-02-01'))).toHaveLength(28);
  });
});

describe('daily history response', () => {
  it('does not label other-day legacy rows as openings for the selected day', () => {
    const rows = [shift('a', '2026-10-05'), shift('b', '2026-10-04T00:00:00.000Z')];
    expect(attendanceShiftsForDate(rows, '2026-10-05').map((row) => row.id)).toEqual(['a']);
    expect(attendanceShiftsForDate(rows, '2026-10-03')).toEqual([]);
  });

  it('retains separate openings by the same employee and closed historical rows', () => {
    const rows = [
      shift('first', '2026-10-05', { closedAt: '2026-10-05T09:00:00Z', isAutoClosed: true }),
      shift('second', '2026-10-05', { openedAt: '2026-10-05T10:11:12Z' }),
    ];
    expect(attendanceShiftsForDate(rows, '2026-10-05')).toEqual(rows);
  });

  it('treats a non-array success body as an error, not an empty attendance day', () => {
    expect(() => attendanceShiftsForDate({ message: 'bad gateway' }, '2026-10-05')).toThrow();
    expect(() => attendanceShiftsForDate(undefined, '2026-10-05')).toThrow();
    expect(attendanceShiftsForDate([], '2026-10-05')).toEqual([]);
  });

  it('ignores malformed rows without crashing or introducing false openings', () => {
    expect(attendanceShiftsForDate([null, {}, 1, shift('valid', '2026-10-05')], '2026-10-05')).toEqual([
      shift('valid', '2026-10-05'),
    ]);
  });
});

describe('recorded shift times and state', () => {
  it('shows exact seconds in the service zone, independent of the device zone', () => {
    const instant = '2026-10-05T06:03:27.125Z';
    expect(formatShiftTime(instant, 'Europe/Moscow')).toBe('09:03:27');
    expect(formatShiftTime(instant, 'Asia/Vladivostok')).toBe('16:03:27');
  });

  it('shows tenant midnight as 00, preserving seconds', () => {
    expect(formatShiftTime('2026-10-04T14:00:05Z', 'Asia/Vladivostok')).toBe('00:00:05');
    expect(formatShiftTime('2026-10-04T21:00:00Z', 'Europe/Moscow')).toBe('00:00:00');
  });

  it('does not invent a device-zone opening when timestamp or zone is invalid', () => {
    expect(formatShiftTime('invalid', 'Europe/Moscow')).toBe('—');
    expect(formatShiftTime('2026-10-05T06:03:27Z', 'Mars/Olympus')).toBe('—');
  });

  it('distinguishes open, manual close and automatic close', () => {
    expect(shiftAttendanceStatus({ closedAt: null, isAutoClosed: false })).toBe('Открыта');
    expect(shiftAttendanceStatus({ closedAt: '2026-10-05T18:00:00Z', isAutoClosed: false })).toBe('Закрыта');
    expect(shiftAttendanceStatus({ closedAt: '2026-10-05T21:00:00Z', isAutoClosed: true })).toBe(
      'Закрыта автоматически',
    );
  });
});
