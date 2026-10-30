import { BadRequestException } from '@nestjs/common';
import { getZonedParts, zonedDateKey, zonedMidnight } from '../../common/timezone';
import type { OwnerHomeProfitPeriod } from './owner-home.types';

export function strictDay(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
    throw new BadRequestException('Укажите дату в формате ГГГГ-ММ-ДД');
  const instant = new Date(`${raw}T12:00:00.000Z`);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString().slice(0, 10) !== raw ||
    Number(raw.slice(0, 4)) < 100
  )
    throw new BadRequestException('Такой календарной даты нет');
  return raw;
}

export function dayStart(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return zonedMidnight(tz, y, m - 1, d);
}

export function nextDay(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return zonedMidnight(tz, y, m - 1, d + 1);
}

export interface ProfitWindow extends OwnerHomeProfitPeriod {
  month: string;
  start: string;
  dayStart: string;
}

export function profitWindow(day: string, tz: string, until: Date, partialDay: boolean): ProfitWindow {
  const [y, m, d] = day.split('-').map(Number);
  return {
    from: `${day.slice(0, 7)}-01`,
    through: day,
    month: day.slice(0, 7),
    start: zonedMidnight(tz, y, m - 1, 1).toISOString(),
    dayStart: dayStart(day, tz).toISOString(),
    untilExclusive: until.toISOString(),
    daysElapsed: d,
    daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate(),
    partialDay,
  };
}

/** Civil-day navigation; current and prior month use the same local time today. */
export function profitWindows(raw: unknown, tz: string, now: Date) {
  const todayDate = zonedDateKey(now, tz);
  const selected = raw === undefined ? todayDate : strictDay(raw);
  if (selected > todayDate) throw new BadRequestException('Будущая дата недоступна');
  const [y, m, d] = selected.split('-').map(Number);
  const priorStart = zonedMidnight(tz, y, m - 2, 1);
  const priorParts = getZonedParts(priorStart, tz);
  const priorLength = new Date(Date.UTC(priorParts.year, priorParts.month, 0)).getUTCDate();
  const priorDay = Math.min(d, priorLength);
  const priorMidnight = zonedMidnight(tz, priorParts.year, priorParts.month - 1, priorDay);
  const priorKey = zonedDateKey(priorMidnight, tz);
  const partial = selected === todayDate;
  // Configured tenant zones are the RU whitelist (no DST); preserving time since
  // local midnight also preserves milliseconds and never uses the device zone.
  const priorUntil = partial
    ? new Date(priorMidnight.getTime() + now.getTime() - dayStart(todayDate, tz).getTime())
    : nextDay(priorKey, tz);
  return {
    canonicalDate: selected,
    todayDate,
    clamped: priorDay !== d,
    current: profitWindow(selected, tz, partial ? now : nextDay(selected, tz), partial),
    previous: profitWindow(priorKey, tz, priorUntil, partial),
  };
}

export function visitRange(rawFrom: unknown, rawTo: unknown, tz: string, now: Date) {
  const from = strictDay(rawFrom),
    to = strictDay(rawTo);
  // Compare civil dates, not elapsed UTC hours (leap years and DST included).
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (from > to || days > 366) throw new BadRequestException('Выберите диапазон не более 366 календарных дней');
  if (to > zonedDateKey(now, tz)) throw new BadRequestException('Будущая дата недоступна');
  const end = nextDay(to, tz);
  return {
    from,
    to,
    start: dayStart(from, tz).toISOString(),
    until: new Date(Math.min(end.getTime(), now.getTime())).toISOString(),
  };
}

export function publicPeriod(w: ProfitWindow): OwnerHomeProfitPeriod {
  return {
    from: w.from,
    through: w.through,
    untilExclusive: w.untilExclusive,
    daysElapsed: w.daysElapsed,
    daysInMonth: w.daysInMonth,
    partialDay: w.partialDay,
  };
}
