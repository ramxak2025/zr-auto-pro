/**
 * Helpers for the EmployeesPage period switcher.
 *
 * The page lets the owner flip through Сегодня / Вчера / Эта неделя /
 * Этот месяц / Прошлый месяц. Each option resolves to a [from, to]
 * ISO-date pair and a previous period [prevFrom, prevTo] so the cards
 * can show period-over-period deltas (this month vs last month, etc).
 */

export type PeriodKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth';

export interface PeriodLabel {
  key: PeriodKey;
  label: string;
}

export const PERIOD_OPTIONS: PeriodLabel[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'thisWeek', label: 'Неделя' },
  { key: 'thisMonth', label: 'Месяц' },
  { key: 'lastMonth', label: 'Прошлый месяц' },
];

export interface PeriodRange {
  from: string;
  to: string;
  // Previous, equivalent-length window for delta comparisons.
  prevFrom: string;
  prevTo: string;
}

const fmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday of the given date's ISO week. */
function startOfWeek(d: Date): Date {
  const day = d.getDay() || 7; // Sunday → 7
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function resolvePeriod(period: PeriodKey): PeriodRange {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  switch (period) {
    case 'today': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        from: fmt(now), to: fmt(now),
        prevFrom: fmt(yesterday), prevTo: fmt(yesterday),
      };
    }
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const dayBefore = new Date(now); dayBefore.setDate(dayBefore.getDate() - 2);
      return {
        from: fmt(y), to: fmt(y),
        prevFrom: fmt(dayBefore), prevTo: fmt(dayBefore),
      };
    }
    case 'thisWeek': {
      const monday = startOfWeek(now);
      const lastMonday = new Date(monday); lastMonday.setDate(lastMonday.getDate() - 7);
      const lastSunday = new Date(monday); lastSunday.setDate(lastSunday.getDate() - 1);
      return {
        from: fmt(monday), to: fmt(now),
        prevFrom: fmt(lastMonday), prevTo: fmt(lastSunday),
      };
    }
    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        from: fmt(monthStart), to: fmt(now),
        prevFrom: fmt(prevMonthStart), prevTo: fmt(prevMonthEnd),
      };
    }
    case 'lastMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0);
      return {
        from: fmt(monthStart), to: fmt(monthEnd),
        prevFrom: fmt(prevStart), prevTo: fmt(prevEnd),
      };
    }
  }
}

export interface AttendanceStats {
  scheduled: number;
  worked: number;
  daysOff: number;
  onTime: number;
  lateMinor: number;
  lateMajor: number;
  absent: number;
  avgLateMinutes: number;
}

interface EntryLike {
  userId: string;
  isDayOff?: boolean;
  actualArrival?: string | null;
  lateMinutes?: number;
  lateStatus?: string | null;
}

/**
 * Reduce a list of ScheduleEntry-shaped rows into a per-user summary.
 * Cheaper than hitting a per-user stats endpoint N times — single query
 * to /schedule, then group on the client.
 */
export function aggregateAttendance(entries: EntryLike[]): Map<string, AttendanceStats> {
  const out = new Map<string, AttendanceStats>();
  const lateMins = new Map<string, number[]>();

  for (const e of entries) {
    let s = out.get(e.userId);
    if (!s) {
      s = { scheduled: 0, worked: 0, daysOff: 0, onTime: 0, lateMinor: 0, lateMajor: 0, absent: 0, avgLateMinutes: 0 };
      out.set(e.userId, s);
      lateMins.set(e.userId, []);
    }
    s.scheduled += 1;
    if (e.isDayOff) {
      s.daysOff += 1;
      continue;
    }
    if (e.actualArrival) s.worked += 1;
    if (e.lateStatus === 'on_time') s.onTime += 1;
    else if (e.lateStatus === 'late_minor') s.lateMinor += 1;
    else if (e.lateStatus === 'late_major') s.lateMajor += 1;
    else if (!e.actualArrival) s.absent += 1;

    if ((e.lateMinutes ?? 0) > 0) lateMins.get(e.userId)!.push(e.lateMinutes!);
  }

  for (const [uid, mins] of lateMins.entries()) {
    if (mins.length > 0) {
      const sum = mins.reduce((a, b) => a + b, 0);
      out.get(uid)!.avgLateMinutes = Math.round(sum / mins.length);
    }
  }

  return out;
}

export const PERIOD_LABEL_CASUAL: Record<PeriodKey, string> = {
  today: 'сегодня',
  yesterday: 'вчера',
  thisWeek: 'на этой неделе',
  thisMonth: 'в этом месяце',
  lastMonth: 'в прошлом месяце',
};
