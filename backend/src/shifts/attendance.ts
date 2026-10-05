import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { dayStartMsInZone, zonedDateKey, zonedTimeKey } from '../common/timezone';

export type AttendanceStatus = 'on_time' | 'late_minor' | 'late_major';

export interface AttendanceFields {
  shift_start: string | null;
  shift_end: string | null;
  is_day_off: boolean;
  note: string | null;
  late_status: AttendanceStatus | null;
  late_minutes: number;
  actual_arrival: Date | string | null;
  is_manual_override: boolean;
}

export interface AttendanceEntry extends AttendanceFields {
  id: string;
  user_id: string;
  date: string;
  point_id: string | null;
}

export interface ScheduleMutation {
  shiftStart?: string | null;
  shiftEnd?: string | null;
  isDayOff?: boolean;
  note?: string | null;
  lateStatus?: AttendanceStatus | null;
  lateMinutes?: number;
  actualArrival?: string | null;
}

export const EXPLICIT_ATTENDANCE_SQL = `(is_day_off = true OR actual_arrival IS NOT NULL
  OR late_minutes > 0 OR late_status IN ('on_time', 'late_minor', 'late_major') OR note IN ('Прогул', 'Больничный'))`;

export function isWorkingStatus(status: unknown): status is AttendanceStatus {
  return status === 'on_time' || status === 'late_minor' || status === 'late_major';
}

export function plannedStart(value: unknown): string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '09:00';
}

/** Seconds remain in the stored instant; attendance thresholds use whole local minutes. */
export function classifyArrival(instant: Date, timezone: string, start: unknown) {
  const [hour, minute] = zonedTimeKey(instant, timezone).split(':').map(Number);
  const [startHour, startMinute] = plannedStart(start).split(':').map(Number);
  const lateMinutes = Math.max(0, hour * 60 + minute - (startHour * 60 + startMinute));
  const lateStatus: AttendanceStatus = lateMinutes === 0 ? 'on_time' : lateMinutes < 60 ? 'late_minor' : 'late_major';
  return { lateMinutes, lateStatus };
}

/** Serialize both opening paths, including the case where no calendar row exists yet. */
export async function lockAttendanceUser(client: PoolClient, tenantID: string, userID: string) {
  const { rows } = await client.query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
    userID,
    tenantID,
  ]);
  if (rows.length === 0) throw new BadRequestException({ message: 'Сотрудник не найден' });
}

export async function attendanceClock(client: PoolClient, timezone: string) {
  // Read AFTER the employee lock: transaction-start now() may predate a long wait.
  const { rows } = await client.query<{ instant: Date }>('SELECT clock_timestamp() AS instant');
  const instant = rows[0].instant;
  return { instant, today: zonedDateKey(instant, timezone) };
}

export function hasRecordedAttendance(entry: AttendanceFields): boolean {
  return !!(
    entry.actual_arrival ||
    entry.late_status ||
    entry.late_minutes > 0 ||
    entry.is_day_off ||
    entry.note === 'Прогул' ||
    entry.note === 'Больничный'
  );
}

/** Only authorized schedule writes call this; the request cannot assign the override flag. */
export function manualAttendance(
  dto: ScheduleMutation,
  previous: AttendanceFields | undefined,
  date: string,
  clock: { instant: Date; today: string },
  timezone: string,
  firstArrival: Date | string | null = null,
): AttendanceFields {
  for (const time of [dto.shiftStart, dto.shiftEnd]) {
    if (time != null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      throw new BadRequestException({ message: 'Время должно быть в формате ЧЧ:ММ' });
    }
  }
  if (dto.lateStatus != null && !isWorkingStatus(dto.lateStatus)) {
    throw new BadRequestException({ message: 'Неизвестная отметка графика' });
  }
  const result: AttendanceFields = {
    shift_start: dto.shiftStart !== undefined ? dto.shiftStart : (previous?.shift_start ?? null),
    shift_end: dto.shiftEnd !== undefined ? dto.shiftEnd : (previous?.shift_end ?? null),
    is_day_off: dto.isDayOff ?? previous?.is_day_off ?? false,
    note: dto.note !== undefined ? dto.note : (previous?.note ?? null),
    late_status: previous?.late_status ?? null,
    late_minutes: previous?.late_minutes ?? 0,
    actual_arrival: previous?.actual_arrival ?? null,
    is_manual_override: dto.shiftStart !== undefined || dto.shiftEnd !== undefined || !!previous?.is_manual_override,
  };
  if (isWorkingStatus(dto.lateStatus)) {
    result.late_status = dto.lateStatus;
    const minutes =
      typeof dto.lateMinutes === 'number' && Number.isFinite(dto.lateMinutes) ? Math.floor(dto.lateMinutes) : 0;
    result.late_minutes =
      dto.lateStatus === 'on_time'
        ? 0
        : dto.lateStatus === 'late_minor'
          ? Math.min(59, Math.max(1, minutes || 15))
          : Math.max(60, minutes);
    result.is_day_off = false;
    if (result.note === 'Прогул' || result.note === 'Больничный') result.note = '';
    result.shift_start = plannedStart(result.shift_start);
    result.shift_end = result.shift_end || '18:00';
    result.is_manual_override = true;
    if (date === clock.today) {
      result.actual_arrival = previous?.actual_arrival ?? firstArrival ?? clock.instant;
    } else if (date < clock.today) {
      const supplied = dto.actualArrival ?? previous?.actual_arrival;
      if (supplied && !Number.isFinite(new Date(supplied).getTime())) {
        throw new BadRequestException({ message: 'Неверное время прихода' });
      }
      const [hour, minute] = result.shift_start.split(':').map(Number);
      result.actual_arrival =
        supplied ?? new Date(dayStartMsInZone(timezone, date) + (hour * 60 + minute + result.late_minutes) * 60_000);
    }
  } else if (dto.isDayOff === true || dto.note === 'Прогул' || dto.note === 'Больничный') {
    result.is_day_off = dto.note !== 'Прогул';
    if (dto.note === undefined && (result.note === 'Прогул' || result.note === 'Больничный')) result.note = '';
    result.late_status = null;
    result.late_minutes = 0;
    result.actual_arrival = null;
    result.is_manual_override = true;
  } else if (dto.lateStatus === null && dto.actualArrival === null && dto.isDayOff === false) {
    // Explicitly replacing a status with a planned day clears the completed mark.
    // A start/end-only edit never takes this branch and preserves attendance.
    result.late_status = null;
    result.late_minutes = 0;
    result.actual_arrival = null;
    if (result.note === 'Прогул' || result.note === 'Больничный') result.note = '';
    result.is_manual_override = true;
  }
  if (date > clock.today) result.actual_arrival = null;
  return result;
}
