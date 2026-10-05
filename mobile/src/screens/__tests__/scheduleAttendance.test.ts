jest.mock(
  'lucide-react',
  () => ({
    AlarmClock: 'Clock',
    AlertTriangle: 'Warning',
    Check: 'Check',
    Clock: 'Clock',
    Moon: 'Moon',
    Thermometer: 'Thermometer',
    X: 'X',
  }),
  { virtual: true },
);

import type { ScheduleEntry, TodayEmployeeStatus } from '../../../../shared/types';
import { getCellDot, getTodayStatusInfo, gridAttendanceCounts } from '../scheduleAttendance';
import { scheduleCellOf, shortTime, todayStatusOf } from '../../../../frontend/src/components/company/scheduleStatus';
import { aggregateAttendance } from '../../../../frontend/src/utils/employeePeriod';

const TODAY = '2026-10-06';
function entry(fields: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'entry',
    userId: 'user',
    tenantId: 'tenant',
    date: TODAY,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    isDayOff: false,
    lateMinutes: 0,
    isManualOverride: false,
    ...fields,
  };
}
function status(fields: Partial<TodayEmployeeStatus> = {}): TodayEmployeeStatus {
  return {
    userId: 'user',
    fullName: 'Мастер',
    role: 'master',
    hasSchedule: true,
    isWorking: false,
    isDayOff: false,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    lateMinutes: 0,
    ...fields,
  };
}

it.each(['2026-10-05', TODAY])('leaves the default unmarked plan blank on %s in both grids', (date) => {
  expect(getCellDot(entry({ date }), TODAY)).toMatchObject({ key: null, icon: null, label: '', hasEntry: false });
  expect(scheduleCellOf(entry({ date }), date, TODAY)).toBe(null);
});

it('shows a custom 14:00 plan today neutrally, without a worked check', () => {
  expect(getCellDot(entry({ shiftStart: '14:00', isManualOverride: true }), TODAY)).toMatchObject({
    key: null,
    icon: null,
    label: '14:00',
  });
  expect(scheduleCellOf(entry({ shiftStart: '14:00' }), TODAY, TODAY)).toEqual({ kind: 'planned', time: '14:00' });
});

it('keeps a future plan distinguishable from recorded attendance', () => {
  expect(getCellDot(entry({ date: '2026-10-07' }), TODAY)).toMatchObject({ key: null, icon: null, label: '09:00' });
  expect(scheduleCellOf(entry({ date: '2026-10-07' }), '2026-10-07', TODAY)).toEqual({
    kind: 'planned',
    time: '09:00',
  });
  expect(getCellDot(entry({ lateStatus: 'on_time' }), TODAY).key).toBe('worked');
});

it.each([
  [{ note: 'Прогул' }, 'Прогул'],
  [{ note: 'Больничный', isDayOff: true }, 'Больничный'],
  [{ isDayOff: true }, 'Выходной'],
])('keeps an explicit nonworking choice foremost with an active shift: %s', (fields, label) => {
  const row = status({ ...fields, isWorking: true, actualArrival: '2026-10-06T00:00:00Z', lateStatus: 'on_time' });
  expect(getTodayStatusInfo(row).label).toBe(label);
  expect(todayStatusOf(row).label).toBe(label);
});

it('does not call an unmarked today row absent and retains legacy minutes as evidence', () => {
  expect(getTodayStatusInfo(status()).label).toBe('Не отмечен');
  expect(todayStatusOf(status())).toEqual({ label: 'Не отмечен', tone: 'neutral' });
  expect(getCellDot(entry({ lateMinutes: 20 }), TODAY).key).toBe('short');
  expect(scheduleCellOf(entry({ lateMinutes: 20 }), TODAY, TODAY)?.kind).toBe('lateMinor');
});

it('formats actual arrival in the service zone while leaving plan clock strings unchanged', () => {
  expect(shortTime('2026-10-05T23:06:45Z', 'Asia/Vladivostok')).toBe('09:06');
  expect(shortTime('14:00', 'Asia/Vladivostok')).toBe('14:00');
});

it('employee period summary counts only explicit absence and includes legacy recorded minutes', () => {
  const summary = aggregateAttendance(
    [
      entry({ date: '2026-10-05' }),
      entry({ date: TODAY, lateMinutes: 20 }),
      entry({ note: 'Прогул', actualArrival: '2026-10-06T00:00:00Z', lateStatus: 'on_time' }),
    ],
    TODAY,
  ).get('user');
  expect(summary).toMatchObject({ scheduled: 3, worked: 1, absent: 1, lateMinor: 1, onTime: 0 });
});

it('employee period summary excludes future marks using the service calendar date', () => {
  const summary = aggregateAttendance(
    [entry({ date: '2026-10-07', lateStatus: 'late_minor', lateMinutes: 15 })],
    TODAY,
  ).get('user');
  expect(summary).toMatchObject({ scheduled: 1, worked: 0, absent: 0, lateMinor: 0 });
});

it('calendar row counter counts recorded work and leaves three unmarked plans out', () => {
  expect(
    gridAttendanceCounts(
      [
        entry({ date: '2026-10-01', actualArrival: '2026-10-01T00:00:00Z' }),
        entry({ date: '2026-10-02' }),
        entry({ date: '2026-10-03', shiftStart: '14:00', isManualOverride: true }),
        entry({ date: TODAY }),
      ],
      TODAY,
    ),
  ).toEqual({ worked: 1, off: 0 });
});

it('calendar row counter excludes absence and future marks, while retaining legacy minutes and days off', () => {
  expect(
    gridAttendanceCounts(
      [
        entry({ date: TODAY, lateMinutes: 20 }),
        entry({ note: 'Прогул', actualArrival: '2026-10-06T00:00:00Z', lateStatus: 'on_time' }),
        entry({ date: '2026-10-07', lateStatus: 'on_time' }),
        entry({ date: '2026-10-08', isDayOff: true }),
      ],
      TODAY,
    ),
  ).toEqual({ worked: 1, off: 1 });
});
