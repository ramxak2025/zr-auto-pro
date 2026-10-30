import { BadRequestException } from '@nestjs/common';
import { dayStart, nextDay, ProfitWindow, profitWindow } from './owner-home-dates';
import type { OwnerHomeTimelineRange } from './owner-home.types';

/** Calendar arithmetic independent of UTC offsets and DST day lengths. */
export function civilOffset(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function timelineRange(raw: unknown, current: ProfitWindow, tz: string): OwnerHomeTimelineRange {
  const period = raw === undefined ? 'day' : raw;
  if (period !== 'day' && period !== 'week' && period !== 'month' && period !== 'year')
    throw new BadRequestException('Выберите день, неделю, месяц или год');
  const day = current.through;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const from =
    period === 'year'
      ? `${day.slice(0, 4)}-01-01`
      : period === 'month'
        ? `${day.slice(0, 7)}-01`
        : period === 'week'
          ? civilOffset(day, 1 - weekday)
          : day;
  return {
    period,
    from,
    through: day,
    start: dayStart(from, tz).toISOString(),
    untilExclusive: current.untilExclusive,
    partialDay: current.partialDay,
    granularity: period === 'year' ? 'month' : period === 'day' ? 'hour' : 'day',
  };
}

export interface TimelineCutoff {
  from: string;
  untilExclusive: string;
  localDate: string;
  window: ProfitWindow;
}

/** Only real elapsed hour/civil boundaries and the exact request cutoff. */
export function timelineCutoffs(range: OwnerHomeTimelineRange, tz: string): TimelineCutoff[] {
  const result: TimelineCutoff[] = [];
  let from = range.start;
  const add = (day: string, until: string) => {
    result.push({
      from,
      untilExclusive: until,
      localDate: day,
      window: profitWindow(day, tz, new Date(until), range.partialDay && until === range.untilExclusive),
    });
    from = until;
  };
  if (range.period === 'day') {
    // Walking real instants retains the repeated DST hour and omits the missing
    // one. A midnight cutoff deliberately keeps a coincident allocation bucket.
    for (let at = Date.parse(from) + 3_600_000; at < Date.parse(range.untilExclusive); at += 3_600_000)
      add(range.through, new Date(at).toISOString());
    add(range.through, range.untilExclusive);
  } else if (range.period === 'year') {
    for (let month = 1; month <= Number(range.through.slice(5, 7)); month++) {
      const first = `${range.through.slice(0, 4)}-${String(month).padStart(2, '0')}-01`;
      const last = civilOffset(first, new Date(Date.UTC(Number(first.slice(0, 4)), month, 0)).getUTCDate() - 1);
      const day = last < range.through ? last : range.through;
      add(day, day === range.through ? range.untilExclusive : nextDay(day, tz).toISOString());
    }
  } else {
    for (let day = range.from; day <= range.through; day = civilOffset(day, 1))
      add(day, day === range.through ? range.untilExclusive : nextDay(day, tz).toISOString());
  }
  return result;
}
