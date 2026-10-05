import type { ScheduleEntry, WorkMode, WorkModeDayTimes } from '../../../shared/types';
import type { CreateScheduleRequest, CreateWorkModeRequest } from '../../../shared/api/types';

/** Storage uses Sunday0; presentation starts on Monday. */
export const SCHEDULE_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export type ScheduleWeekday = (typeof SCHEDULE_WEEKDAYS)[number];
export type ScheduleHours = { shiftStart: string; shiftEnd: string };
export type QuickAttendanceChoice = 'shift' | 'late_minor' | 'late_major' | 'dayoff' | 'sick' | 'absent';

export function manualSchedulePayload(
  choice: QuickAttendanceChoice,
  userId: string,
  date: string,
  today: string,
  entry?: ScheduleEntry,
): CreateScheduleRequest {
  const nonworking = choice === 'dayoff' || choice === 'sick';
  const futurePlan = choice === 'shift' && date > today;
  return {
    userId,
    date,
    shiftStart: nonworking ? null : entry?.shiftStart || '09:00',
    shiftEnd: nonworking ? null : entry?.shiftEnd || '18:00',
    isDayOff: nonworking,
    note: choice === 'sick' ? 'Больничный' : choice === 'absent' ? 'Прогул' : '',
    lateStatus:
      choice === 'shift' && !futurePlan
        ? 'on_time'
        : choice === 'late_minor' || choice === 'late_major'
          ? choice
          : null,
    lateMinutes: choice === 'late_minor' ? 15 : choice === 'late_major' ? 60 : 0,
    // The server records today's real instant and preserves the first arrival.
    // Only nonworking / future choices explicitly clear a cached old arrival.
    ...(nonworking || choice === 'absent' || date > today ? { actualArrival: null } : {}),
  };
}

/** A plan-only write must not assign any attendance fields. */
export function scheduleHoursPayload(hours: ScheduleHours): ScheduleHours {
  return { shiftStart: hours.shiftStart, shiftEnd: hours.shiftEnd };
}

export interface WorkModeDraft extends ScheduleHours {
  name: string;
  weekDays: ScheduleWeekday[];
  dayTimes: WorkModeDayTimes;
  weekDaysEdited: boolean;
}

export function workModeDraft(mode?: WorkMode): WorkModeDraft {
  return {
    name: mode?.name ?? '',
    shiftStart: mode?.shiftStart ?? '09:00',
    shiftEnd: mode?.shiftEnd ?? '18:00',
    weekDays: mode?.weekDays.length
      ? SCHEDULE_WEEKDAYS.filter((d) => mode.weekDays.includes(d))
      : [...SCHEDULE_WEEKDAYS],
    dayTimes: { ...mode?.dayTimes },
    weekDaysEdited: false,
  };
}

export function workModePayload(draft: WorkModeDraft, original?: WorkMode): CreateWorkModeRequest {
  return {
    name: draft.name.trim(),
    type: original?.type ?? 'weekly',
    workDays: original?.workDays ?? 2,
    offDays: original?.offDays ?? 2,
    weekDays:
      original && !draft.weekDaysEdited && (original.type !== 'weekly' || original.weekDays.length)
        ? [...original.weekDays]
        : [...draft.weekDays],
    shiftStart: draft.shiftStart,
    shiftEnd: draft.shiftEnd,
    dayTimes: { ...draft.dayTimes },
  };
}

export function validateScheduleHours(hours: ScheduleHours): string | null {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  return valid.test(hours.shiftStart) && valid.test(hours.shiftEnd) ? null : 'Укажите время в формате ЧЧ:ММ';
}

export function validateWorkModeDraft(draft: WorkModeDraft): string | null {
  if (!draft.name.trim()) return 'Укажите название режима';
  if (!draft.weekDays.length) return 'Выберите хотя бы один рабочий день';
  return validateScheduleHours(draft) ?? Object.values(draft.dayTimes).map(validateScheduleHours).find(Boolean) ?? null;
}
