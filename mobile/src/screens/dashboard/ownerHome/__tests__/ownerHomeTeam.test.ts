import type { TodayEarnings, TodayEmployeeStatus } from '../../../../../../shared/types';
import { ownerShiftRoster, ownerTeamRows, ownerTeamToday, ownerTodayEarnings } from '../ownerHomeTeam';

const employee = (id: string, value: Partial<TodayEmployeeStatus> = {}): TodayEmployeeStatus => ({
  userId: id,
  fullName: `Имя ${id}`,
  role: 'master',
  hasSchedule: true,
  isWorking: false,
  isDayOff: false,
  lateMinutes: 0,
  ...value,
});
const data: TodayEarnings = {
  date: '2026-10-30',
  timezone: 'Europe/Moscow',
  pointId: 'p',
  total: 150.5,
  employees: [
    { id: 'paid', name: 'Мастер', avatar: null, earnedAmount: 200.5 },
    { id: 'deduction', name: 'Администратор', avatar: null, earnedAmount: -50 },
    { id: 'zero', name: 'Ноль', avatar: null, earnedAmount: 0 },
  ],
};

test('union retains all returned earnings and known worked staff, sorted active then planned', () => {
  const roster = ownerShiftRoster([
    employee('worked', { actualArrival: '2026-10-30T06:00:00Z' }),
    employee('planned'),
    employee('zero', { isWorking: true }),
    employee('unscheduled', { hasSchedule: false }),
    employee('dayoff', { isDayOff: true }),
    employee('paid', { actualArrival: '2026-10-30T06:00:00Z' }),
  ]);
  const rows = ownerTeamRows(roster, data);
  expect(rows.map((row) => row.id)).toEqual(['zero', 'planned', 'worked', 'paid', 'deduction']);
  expect(rows.map((row) => row.shift)).toEqual(['active', 'planned', 'inactive', 'inactive', 'unknown']);
  expect(rows.map((row) => row.earnedAmount)).toEqual([0, null, null, 200.5, -50]);
  expect(rows.reduce((sum, row) => sum + (row.earnedAmount ?? 0), 0)).toBe(data.total);
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
});

test('working flag outranks day off and planned marks, which never prove an open shift', () => {
  const active = employee('active', { isWorking: true, isDayOff: true, hasSchedule: false });
  const roster = ownerShiftRoster([active, employee('plan'), employee('late', { lateStatus: 'on_time' })]);
  expect(roster?.active).toEqual([active]);
  expect(roster?.planned.map((person) => person.userId)).toEqual(['plan']);
  expect(roster?.worked.map((person) => person.userId)).toEqual(['late']);
});

test('salary-only rows have unknown attendance; missing earnings are null and never fabricated zeros', () => {
  expect(ownerTeamRows(null, data).every((row) => row.shift === 'unknown')).toBe(true);
  const rows = ownerTeamRows(ownerShiftRoster([employee('missing', { isWorking: true })]), null);
  expect(rows[0].earnedAmount).toBeNull();
  expect(rows[0].shift).toBe('active');
});

test('earnings validator checks point, timezone and real ISO dates, preserving the server total and date', () => {
  const context = { pointId: 'p', timezone: 'Europe/Moscow' };
  expect(ownerTodayEarnings(data, context)).toEqual(data);
  expect(ownerTodayEarnings({ ...data, date: '2026-09-30' }, context)?.date).toBe('2026-09-30');
  expect(ownerTodayEarnings({ ...data, pointId: null }, context)).toBeNull();
  expect(ownerTodayEarnings({ ...data, timezone: 'Asia/Tokyo' }, context)).toBeNull();
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-10-30T00:00:00Z']) {
    expect(ownerTodayEarnings({ ...data, date }, context)).toBeNull();
  }
  for (const earnedAmount of [null, undefined, '0', NaN, Infinity]) {
    expect(ownerTodayEarnings({ ...data, employees: [{ ...data.employees[0], earnedAmount }] }, context)).toBeNull();
  }
  expect(ownerTodayEarnings({ ...data, employees: [data.employees[0], data.employees[0]] }, context)).toBeNull();
});

test('tenant date display hint uses tenant timezone even when the device day differs', () => {
  const now = new Date('2026-10-29T17:30:00Z');
  expect(ownerTeamToday('Europe/Moscow', now)).toBe('2026-10-29');
  expect(ownerTeamToday('Asia/Vladivostok', now)).toBe('2026-10-30');
});
