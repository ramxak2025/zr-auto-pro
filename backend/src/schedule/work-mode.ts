import { BadRequestException } from '@nestjs/common';

export type DayTimes = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, { shiftStart: string; shiftEnd: string }>>;
export interface WorkModeMutation {
  name?: string;
  type?: 'rotating' | 'weekly';
  workDays?: number;
  offDays?: number;
  weekDays?: number[];
  shiftStart?: string;
  shiftEnd?: string;
  dayTimes?: DayTimes;
}
export interface WorkModeRow {
  id: string;
  tenant_id: string;
  name: string;
  type: 'rotating' | 'weekly';
  work_days: number;
  off_days: number;
  week_days: number[];
  shift_start: string;
  shift_end: string;
  day_times: DayTimes;
}

export function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function workModeFields(dto: WorkModeMutation, previous?: WorkModeRow) {
  const fail = (message: string): never => {
    throw new BadRequestException({ message });
  };
  if (dto.name !== undefined && (typeof dto.name !== 'string' || !dto.name.trim())) fail('Укажите название режима');
  if (!previous && !dto.name) fail('Укажите название режима');
  if (dto.type !== undefined && dto.type !== 'rotating' && dto.type !== 'weekly') fail('Неизвестный тип режима');
  for (const time of [dto.shiftStart, dto.shiftEnd]) {
    if (time !== undefined && !validTime(time)) fail('Время должно быть в формате ЧЧ:ММ');
  }
  for (const [value, minimum] of [
    [dto.workDays, 1],
    [dto.offDays, 0],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) fail('Неверное количество дней');
  }
  if (
    dto.weekDays !== undefined &&
    (!Array.isArray(dto.weekDays) || dto.weekDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    fail('Дни недели должны быть от 0 до 6');
  }
  const type = dto.type ?? previous?.type ?? 'rotating';
  const weekDays = dto.weekDays !== undefined ? [...new Set(dto.weekDays)] : (previous?.week_days ?? []);
  // Legacy empty means every day, including full-form PATCHes that repeat it.
  // New weekly modes and clearing a previously selected list still need a day.
  const keepsLegacyAllDays = previous?.type === 'weekly' && !previous.week_days?.length;
  if (type === 'weekly' && weekDays.length === 0 && !keepsLegacyAllDays) {
    fail('Выберите хотя бы один рабочий день');
  }
  if (dto.dayTimes !== undefined) {
    if (!dto.dayTimes || typeof dto.dayTimes !== 'object' || Array.isArray(dto.dayTimes))
      fail('Неверное время по дням недели');
    for (const [day, pair] of Object.entries(dto.dayTimes)) {
      if (
        !/^[0-6]$/.test(day) ||
        !pair ||
        typeof pair !== 'object' ||
        Array.isArray(pair) ||
        !validTime(pair.shiftStart) ||
        !validTime(pair.shiftEnd) ||
        Object.keys(pair).some((key) => key !== 'shiftStart' && key !== 'shiftEnd')
      ) {
        fail('Для каждого дня укажите начало и конец в формате ЧЧ:ММ');
      }
    }
  }
  return {
    name: dto.name?.trim() ?? previous?.name ?? '',
    type,
    work_days: dto.workDays ?? previous?.work_days ?? 2,
    off_days: dto.offDays ?? previous?.off_days ?? 2,
    week_days: weekDays,
    shift_start: dto.shiftStart ?? previous?.shift_start ?? '09:00',
    shift_end: dto.shiftEnd ?? previous?.shift_end ?? '18:00',
    day_times: dto.dayTimes ?? previous?.day_times ?? {},
  };
}

export function mapWorkMode(row: WorkModeRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.type,
    workDays: row.work_days,
    offDays: row.off_days,
    weekDays: row.week_days ?? [],
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    dayTimes: row.day_times ?? {},
  };
}
