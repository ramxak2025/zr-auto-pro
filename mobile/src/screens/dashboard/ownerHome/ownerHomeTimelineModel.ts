import type { OwnerHomeTimeline, OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';
import { checkDateInstant, checkDateParts } from '../../../../../shared/utils/checkDateTime';
import { ownerClock, ownerDateLabel } from './ownerHomeState';

export interface OwnerTimelinePoint {
  id: string;
  at: string;
  untilExclusive: string;
  timestamp: number;
  localDate: string;
  position: number;
  revenue: number;
  netProfit: number;
  label: string;
}
export interface OwnerTimelineAxisTick {
  id: string;
  label: string;
  localDate: string;
  position: number;
}
export interface OwnerTimelineModel {
  identity: string;
  period: OwnerHomeTimelinePeriod;
  intervalLabel: string;
  points: OwnerTimelinePoint[];
  axis: OwnerTimelineAxisTick[];
  start: number;
  end: number;
}
const hour = 3_600_000;
const day = 86_400_000;
const monthLabels = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const weekdayLabels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const civil = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const civilOffset = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * day).toISOString().slice(0, 10);
const cents = (value: number) => (finite(value) ? Math.round(value * 100) : NaN);

function midnight(date: string, timezone: string): number {
  const [year, month, dateOfMonth] = date.split('-').map(Number);
  return checkDateInstant(
    { year, month, day: dateOfMonth, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  ).getTime();
}

export function ownerOffsetLabel(at: string, timezone: string): string {
  // Hermes may return plain "GMT" for shortOffset even when its zoned civil
  // fields are correct. Derive the offset from the proven picker helper.
  const instant = new Date(at);
  const parts = checkDateParts(instant, timezone);
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  wall.setUTCHours(parts.hour % 24, parts.minute, parts.second, parts.millisecond);
  const minutes = (wall.getTime() - instant.getTime()) / 60_000;
  if (!Number.isInteger(minutes)) return timezone;
  if (minutes === 0) return 'UTC';
  const absolute = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function hourIntervalLabel(from: string, until: string, timezone: string, date: string): string {
  const startClock = ownerClock(from, timezone),
    startOffset = ownerOffsetLabel(from, timezone);
  if (Date.parse(from) === Date.parse(until))
    return `${ownerDateLabel(date, true)} · ${startClock} ${startOffset} · начало дня`;
  const endClock =
    Date.parse(until) === midnight(civilOffset(date, 1), timezone) ? '24:00' : ownerClock(until, timezone);
  const endOffset = ownerOffsetLabel(until, timezone);
  const interval =
    startOffset === endOffset
      ? `${startClock}–${endClock} ${startOffset}`
      : `${startClock} ${startOffset}–${endClock} ${endOffset}`;
  return `${ownerDateLabel(date, true)} · ${interval}`;
}

/** Display server interval amounts; allocate the supplied opening only to the first interval. */
export function ownerTimelineModel(
  data: OwnerHomeTimeline,
  period: OwnerHomeTimelinePeriod,
  asOf?: string,
): OwnerTimelineModel | null {
  try {
    if (
      data.range.period !== period ||
      data.canonicalDate !== (asOf ?? data.todayDate) ||
      !civil(data.canonicalDate) ||
      !civil(data.todayDate) ||
      data.canonicalDate > data.todayDate ||
      !civil(data.range.from) ||
      data.range.through !== data.canonicalDate ||
      data.visitsRange.from !== data.range.from ||
      data.visitsRange.to !== data.range.through ||
      data.range.granularity !== (period === 'day' ? 'hour' : period === 'year' ? 'month' : 'day') ||
      !Array.isArray(data.buckets)
    )
      return null;
    const selected = data.canonicalDate,
      year = Number(selected.slice(0, 4)),
      month = Number(selected.slice(5, 7)),
      monthLength = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weekday = new Date(`${selected}T12:00:00Z`).getUTCDay() || 7;
    const calendarFrom =
      period === 'year'
        ? `${selected.slice(0, 4)}-01-01`
        : period === 'month'
          ? `${selected.slice(0, 7)}-01`
          : period === 'week'
            ? civilOffset(selected, 1 - weekday)
            : selected;
    if (data.range.from !== calendarFrom) return null;
    const start = Date.parse(data.range.start),
      end = Date.parse(data.range.untilExclusive),
      selectedStart = midnight(selected, data.timezone),
      selectedEnd = midnight(civilOffset(selected, 1), data.timezone);
    if (
      !finite(start) ||
      !finite(end) ||
      start !== midnight(calendarFrom, data.timezone) ||
      end < selectedStart ||
      end > selectedEnd ||
      Date.parse(data.opening.at) !== start
    )
      return null;
    const openingRevenue = cents(data.opening.revenue),
      openingProfit = cents(data.opening.netProfit),
      totalRevenue = cents(data.totals.revenue),
      totalProfit = cents(data.totals.netProfit);
    if (![openingRevenue, openingProfit, totalRevenue, totalProfit].every(Number.isSafeInteger)) return null;
    const intervalCount = period === 'year' ? 12 : period === 'month' ? monthLength : period === 'week' ? 7 : 0;
    const elapsedCount =
      period === 'year'
        ? month
        : period === 'day'
          ? Math.max(1, Math.ceil((end - start) / hour))
          : Math.round((Date.parse(`${selected}T12:00:00Z`) - Date.parse(`${calendarFrom}T12:00:00Z`)) / day) + 1;
    // The service emits a zero-duration allocation bucket at exact midnight.
    // An opening-only response at that same instant still contains one real value.
    const buckets =
      !data.buckets.length && start === end
        ? [{ from: data.opening.at, untilExclusive: data.opening.at, localDate: selected, revenue: 0, netProfit: 0 }]
        : data.buckets;
    if (buckets.length !== elapsedCount) return null;
    let revenueSum = openingRevenue,
      profitSum = openingProfit;
    const points: OwnerTimelinePoint[] = [];
    for (const [index, bucket] of buckets.entries()) {
      const intervalFrom =
        period === 'year'
          ? `${selected.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`
          : period === 'day'
            ? selected
            : civilOffset(calendarFrom, index);
      const intervalLast =
        period === 'year'
          ? civilOffset(intervalFrom, new Date(Date.UTC(year, index + 1, 0)).getUTCDate() - 1)
          : intervalFrom;
      const localDate = intervalLast < selected ? intervalLast : selected;
      const expectedFrom = period === 'day' ? start + index * hour : midnight(intervalFrom, data.timezone);
      const expectedUntil =
        index === buckets.length - 1
          ? end
          : period === 'day'
            ? expectedFrom + hour
            : midnight(civilOffset(intervalLast, 1), data.timezone);
      const timestamp = Date.parse(bucket.from),
        until = Date.parse(bucket.untilExclusive),
        revenue = cents(bucket.revenue),
        netProfit = cents(bucket.netProfit);
      if (
        timestamp !== expectedFrom ||
        until !== expectedUntil ||
        until < timestamp ||
        bucket.localDate !== localDate ||
        !Number.isSafeInteger(revenue) ||
        !Number.isSafeInteger(netProfit)
      )
        return null;
      revenueSum += revenue;
      profitSum += netProfit;
      let label =
        period === 'year'
          ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
              new Date(`${intervalFrom}T12:00:00Z`),
            )
          : ownerDateLabel(localDate, true);
      if (period === 'day') label = hourIntervalLabel(bucket.from, bucket.untilExclusive, data.timezone, localDate);
      else {
        if (period === 'year' && localDate !== intervalLast) label += ` · по ${ownerDateLabel(localDate)}`;
        if (index === buckets.length - 1 && until < selectedEnd)
          label += ` · до ${ownerClock(bucket.untilExclusive, data.timezone)} ${ownerOffsetLabel(bucket.untilExclusive, data.timezone)}`;
      }
      points.push({
        id: `${period}:${bucket.from}:${bucket.untilExclusive}`,
        at: bucket.from,
        untilExclusive: bucket.untilExclusive,
        timestamp,
        localDate,
        position:
          period === 'day' ? ((timestamp + until) / 2 - start) / (selectedEnd - start) : (index + 0.5) / intervalCount,
        revenue: (revenue + (index === 0 ? openingRevenue : 0)) / 100,
        netProfit: (netProfit + (index === 0 ? openingProfit : 0)) / 100,
        label,
      });
    }
    if (revenueSum !== totalRevenue || profitSum !== totalProfit) return null;
    // Axis labels describe the full calendar, independently of elapsed data.
    const axis: OwnerTimelineAxisTick[] =
      period === 'day'
        ? [0, 6, 12, 18, 24].map((clockHour) => {
            const at =
              clockHour === 24
                ? selectedEnd
                : checkDateInstant(
                    {
                      year,
                      month,
                      day: Number(selected.slice(8)),
                      hour: clockHour,
                      minute: 0,
                      second: 0,
                      millisecond: 0,
                    },
                    data.timezone,
                  ).getTime();
            return {
              id: `hour:${clockHour}`,
              label: `${String(clockHour).padStart(2, '0')}:00`,
              localDate: selected,
              position: (at - start) / (selectedEnd - start),
            };
          })
        : (period === 'year' ? monthLabels : period === 'week' ? weekdayLabels : ['1', '15', String(monthLength)]).map(
            (label, index) => {
              const calendarIndex = period === 'month' ? Number(label) - 1 : index;
              const localDate =
                period === 'year'
                  ? `${selected.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`
                  : civilOffset(calendarFrom, calendarIndex);
              return { id: localDate, label, localDate, position: (calendarIndex + 0.5) / intervalCount };
            },
          );
    return {
      identity: `${period}:${selected}:${calendarFrom}:${data.range.start}`,
      period,
      intervalLabel: period === 'day' ? 'По часам' : period === 'year' ? 'По месяцам' : 'По дням',
      points,
      axis,
      start,
      end,
    };
  } catch {
    // Unsupported/malformed timestamps must not turn into a plot in the device timezone.
    return null;
  }
}

/** Keep every calendar label; larger type gets additional rows instead of collisions. */
export function ownerTimelineAxisLayout(model: OwnerTimelineModel, width: number, fontScale: number) {
  const fontSize = model.period === 'year' ? 11 : 12;
  const rowHeight = 16 * fontScale + 2;
  const rowEnds: number[] = [];
  const labels = model.axis.map((tick) => {
    const labelWidth = Math.min(width, tick.label.length * fontSize * 0.68 * fontScale + 1);
    const left = Math.max(0, Math.min(width - labelWidth, tick.position * width - labelWidth / 2));
    let row = rowEnds.findIndex((right) => right <= left);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = left + labelWidth;
    return { ...tick, left, width: labelWidth, top: row * rowHeight, row };
  });
  return { labels, fontSize, rowHeight, rows: rowEnds.length, height: rowEnds.length * rowHeight + 11 };
}

export interface OwnerPlotPoint {
  x: number;
  y: number;
}
export interface OwnerPlotPath {
  d: string;
  length: number;
}

/** Endpoint-tangent cubics stay between adjacent actual values; coincident boundaries use a vertical segment. */
export function ownerPlotPath(points: OwnerPlotPoint[]): OwnerPlotPath {
  if (!points.length) return { d: '', length: 0 };
  let d = `M${points[0].x},${points[0].y}`,
    length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    if (a.x === b.x) {
      d += ` L${b.x},${b.y}`;
      length += Math.abs(b.y - a.y);
      continue;
    }
    const mid = (a.x + b.x) / 2;
    d += ` C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`;
    let previous = a;
    for (let step = 1; step <= 12; step++) {
      const t = step / 12,
        u = 1 - t;
      const point = {
        x: u * u * u * a.x + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
      };
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
  }
  return { d, length };
}

export function ownerPlotGeometry(model: OwnerTimelineModel, width: number, height: number) {
  const values = model.points.flatMap((point) => [point.revenue, point.netProfit]);
  const rawMin = Math.min(0, ...values),
    rawMax = Math.max(0, ...values);
  const span = Math.max(rawMax - rawMin, 1);
  const magnitude = 10 ** Math.floor(Math.log10(span / 2));
  const step = Math.max(magnitude, Math.ceil(span / 2 / magnitude) * magnitude);
  const min = Math.floor(rawMin / step) * step;
  const max = Math.max(min + step, Math.ceil(rawMax / step) * step);
  const y = (value: number) => height - ((value - min) / (max - min)) * height;
  const xs = model.points.map((point) => point.position * width);
  const revenue = model.points.map((point, i) => ({ x: xs[i], y: y(point.revenue) }));
  const profit = model.points.map((point, i) => ({ x: xs[i], y: y(point.netProfit) }));
  const ticks =
    rawMin === 0 && rawMax === 0
      ? [0]
      : Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  return {
    xs,
    revenue,
    profit,
    revenuePath: ownerPlotPath(revenue),
    profitPath: ownerPlotPath(profit),
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    zeroY: y(0),
    min,
    max,
  };
}

export function nearestOwnerPoint(xs: readonly number[], x: number): number {
  'worklet';
  let chosen = -1,
    distance = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const next = Math.abs(xs[i] - x);
    if (next <= distance) {
      distance = next;
      chosen = i;
    }
  }
  return chosen;
}

export function ownerAxisUnit(min: number, max: number): { scale: number; label: string } {
  const absolute = Math.max(Math.abs(min), Math.abs(max));
  if (absolute >= 1_000_000_000_000) return { scale: 1_000_000_000_000, label: 'трлн ₽' };
  if (absolute >= 1_000_000_000) return { scale: 1_000_000_000, label: 'млрд ₽' };
  if (absolute >= 1_000_000) return { scale: 1_000_000, label: 'млн ₽' };
  if (absolute >= 1000) return { scale: 1000, label: 'тыс. ₽' };
  return { scale: 1, label: '₽' };
}

export function ownerAxisLabel(value: number, scale: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / scale);
}
