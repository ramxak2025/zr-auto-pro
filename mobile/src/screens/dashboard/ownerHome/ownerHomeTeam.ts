import type { TodayEarnings, TodayEmployeeStatus } from '../../../../../shared/types';

export type OwnerShiftRoster = {
  active: TodayEmployeeStatus[];
  planned: TodayEmployeeStatus[];
  worked: TodayEmployeeStatus[];
  employees: TodayEmployeeStatus[];
};

export type OwnerTeamRow = {
  id: string;
  name: string;
  avatar?: string | null;
  shift: 'active' | 'planned' | 'inactive' | 'unknown';
  schedule?: TodayEmployeeStatus;
  earnedAmount: number | null;
};

/** An attendance mark proves work today, never that the shift is still open. */
function workedToday(employee: TodayEmployeeStatus): boolean {
  return !!employee.actualArrival || !!employee.lateStatus || employee.lateMinutes > 0;
}

export function ownerShiftRoster(value: unknown): OwnerShiftRoster | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  const roster: OwnerShiftRoster = { active: [], planned: [], worked: [], employees: [] };
  for (const employee of value) {
    if (
      !employee ||
      typeof employee.userId !== 'string' ||
      !employee.userId.trim() ||
      ids.has(employee.userId) ||
      typeof employee.isWorking !== 'boolean' ||
      typeof employee.hasSchedule !== 'boolean' ||
      typeof employee.isDayOff !== 'boolean' ||
      !Number.isFinite(employee.lateMinutes) ||
      employee.lateMinutes < 0 ||
      (employee.actualArrival != null && typeof employee.actualArrival !== 'string') ||
      (employee.lateStatus != null && !['on_time', 'late_minor', 'late_major'].includes(employee.lateStatus)) ||
      (employee.note != null && typeof employee.note !== 'string')
    )
      return null;
    ids.add(employee.userId);
    roster.employees.push(employee);
    if (employee.isWorking) roster.active.push(employee);
    else if (workedToday(employee)) roster.worked.push(employee);
    else if (employee.hasSchedule && !employee.isDayOff && !/больнич|прогул/i.test(employee.note ?? '')) {
      roster.planned.push(employee);
    }
  }
  return roster;
}

/** A display hint only. The API, not this clock, decides earnings and their period. */
export function ownerTeamToday(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Reject mismatched ownership/calendar metadata; absent amounts must never become zero. */
export function ownerTodayEarnings(
  value: unknown,
  context: { timezone: string; pointId: string | null },
): TodayEarnings | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as TodayEarnings;
  if (
    typeof data.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    !Number.isFinite(Date.parse(`${data.date}T12:00:00Z`)) ||
    new Date(`${data.date}T12:00:00Z`).toISOString().slice(0, 10) !== data.date ||
    data.timezone !== context.timezone ||
    data.pointId !== context.pointId ||
    !Array.isArray(data.employees) ||
    typeof data.total !== 'number' ||
    !Number.isFinite(data.total)
  )
    return null;
  const ids = new Set<string>();
  for (const employee of data.employees) {
    if (
      !employee ||
      typeof employee.id !== 'string' ||
      !employee.id.trim() ||
      ids.has(employee.id) ||
      typeof employee.name !== 'string' ||
      (employee.avatar != null && typeof employee.avatar !== 'string') ||
      typeof employee.earnedAmount !== 'number' ||
      !Number.isFinite(employee.earnedAmount)
    )
      return null;
    ids.add(employee.id);
  }
  return {
    date: data.date,
    timezone: data.timezone,
    pointId: data.pointId,
    total: data.total,
    employees: data.employees.map(({ id, name, avatar, earnedAmount }) => ({ id, name, avatar, earnedAmount })),
  };
}

/** Union by employee identity. Keep every returned earning, including zero and deductions. */
export function ownerTeamRows(roster: OwnerShiftRoster | null, earnings: TodayEarnings | null): OwnerTeamRow[] {
  const rows = new Map<string, OwnerTeamRow>();
  const active = new Set(roster?.active.map((employee) => employee.userId));
  const planned = new Set(roster?.planned.map((employee) => employee.userId));
  const scheduleById = new Map(roster?.employees.map((employee) => [employee.userId, employee]));
  const add = (id: string, earned?: TodayEarnings['employees'][number]) => {
    const schedule = scheduleById.get(id);
    const name = (typeof schedule?.fullName === 'string' && schedule.fullName.trim()) || earned?.name.trim();
    rows.set(id, {
      id,
      name: name || 'Сотрудник',
      avatar: schedule?.avatar ?? earned?.avatar,
      shift: active.has(id) ? 'active' : planned.has(id) ? 'planned' : schedule ? 'inactive' : 'unknown',
      schedule,
      earnedAmount: earned?.earnedAmount ?? null,
    });
  };
  for (const employee of [...(roster?.active ?? []), ...(roster?.planned ?? []), ...(roster?.worked ?? [])]) {
    add(employee.userId);
  }
  for (const employee of earnings?.employees ?? []) add(employee.id, employee);
  const order: Record<OwnerTeamRow['shift'], number> = { active: 0, planned: 1, inactive: 2, unknown: 3 };
  return [...rows.values()].sort((a, b) => order[a.shift] - order[b.shift]);
}
