import type { OwnerHomeTimeline, OwnerHomeTimelinePeriod } from '../../../../../../shared/types/ownerHome';
import {
  nearestOwnerPoint,
  ownerAxisLabel,
  ownerAxisUnit,
  ownerOffsetLabel,
  ownerPlotGeometry,
  ownerPlotPath,
  ownerTimelineAxisLayout,
  ownerTimelineModel,
} from '../ownerHomeTimelineModel';
import { accrualFixture, timelineFixture } from '../__fixtures__/timeline';

const cents = (value: number) => Math.round(value * 100);
const sum = (data: OwnerHomeTimeline, key: 'revenue' | 'netProfit') =>
  (cents(data.opening[key]) + data.buckets.reduce((total, bucket) => total + cents(bucket[key]), 0)) / 100;

function report(
  period: OwnerHomeTimelinePeriod,
  from: string,
  selected: string,
  start: string,
  boundaries: string[],
  timezone = 'UTC',
  todayDate = selected,
): OwnerHomeTimeline {
  const data = timelineFixture(period);
  data.canonicalDate = selected;
  data.todayDate = todayDate;
  data.timezone = timezone;
  data.visitsRange = { from, to: selected };
  data.range = { ...data.range, from, through: selected, start, untilExclusive: boundaries[boundaries.length - 1] };
  data.opening = { at: start, revenue: 0, netProfit: -3000 };
  let prior = start;
  data.buckets = boundaries.map((untilExclusive, index) => {
    const bucket = {
      from: prior,
      untilExclusive,
      localDate:
        period === 'day' || index === boundaries.length - 1
          ? selected
          : new Date(Date.parse(untilExclusive) - 1).toISOString().slice(0, 10),
      revenue: (index + 1) * 10,
      netProfit: index % 2 ? -5 : 20,
      cumulativeRevenue: 0,
      cumulativeNetProfit: 0,
    };
    prior = untilExclusive;
    return bucket;
  });
  data.totals = accrualFixture(sum(data, 'netProfit'), sum(data, 'revenue'));
  return data;
}

function calendarReport(period: 'week' | 'month' | 'year', selected: string, from: string) {
  const end = new Date(`${selected}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const cursor = new Date(`${from}T00:00:00Z`);
  const boundaries: string[] = [];
  while (cursor < end) {
    if (period === 'year') cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
    boundaries.push(new Date(Math.min(cursor.getTime(), end.getTime())).toISOString());
  }
  return report(period, from, selected, `${from}T00:00:00.000Z`, boundaries, 'UTC', '2029-01-01');
}

function hourlyReport(date: string, start: string, until: string, timezone: string) {
  const boundaries: string[] = [];
  for (let at = Date.parse(start) + 3_600_000; at < Date.parse(until); at += 3_600_000)
    boundaries.push(new Date(at).toISOString());
  boundaries.push(until);
  return report('day', date, date, start, boundaries, timezone);
}

test.each(['day', 'week', 'month', 'year'] as const)(
  '%s uses interval values, includes opening once, and reconciles the sum with header totals',
  (period) => {
    const data = timelineFixture(period),
      model = ownerTimelineModel(data, period)!;
    expect(model).not.toBeNull();
    expect(model.points).toHaveLength(data.buckets.length);
    model.points.forEach((point, index) => {
      expect(cents(point.revenue)).toBe(cents(data.buckets[index].revenue) + (index ? 0 : cents(data.opening.revenue)));
      expect(cents(point.netProfit)).toBe(
        cents(data.buckets[index].netProfit) + (index ? 0 : cents(data.opening.netProfit)),
      );
    });
    expect(model.points.reduce((total, point) => total + cents(point.revenue), 0)).toBe(cents(data.totals.revenue));
    expect(model.points.reduce((total, point) => total + cents(point.netProfit), 0)).toBe(cents(data.totals.netProfit));
    expect(model.points.at(-1)?.revenue).not.toBe(data.totals.revenue);
    expect(model.points.at(-1)?.netProfit).not.toBe(data.totals.netProfit);
  },
);

test('running-total fields never replace interval amounts, and negative deltas remain visible', () => {
  const data = timelineFixture();
  data.buckets[1].netProfit = -4500;
  data.buckets[2].revenue = -230;
  data.buckets.forEach((bucket) => {
    bucket.cumulativeRevenue = 987654;
    bucket.cumulativeNetProfit = 123456;
  });
  data.totals = accrualFixture(sum(data, 'netProfit'), sum(data, 'revenue'));
  const model = ownerTimelineModel(data, 'day')!;
  expect(model.points[1].netProfit).toBe(-4500);
  expect(model.points[2].revenue).toBe(-230);
  expect(model.points[0].netProfit).toBe(-1033.33);
  const geometry = ownerPlotGeometry(model, 290, 120);
  expect(geometry.min).toBeLessThanOrEqual(-4500);
  for (const point of [...geometry.revenue, ...geometry.profit]) {
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(120);
  }
});

test('opening and interval decimal cents reconcile without floating-point drift', () => {
  const data = timelineFixture();
  data.opening = { ...data.opening, revenue: 0.07, netProfit: -0.03 };
  data.buckets.forEach((bucket, index) => {
    bucket.revenue = 0.1;
    bucket.netProfit = index % 2 ? -0.2 : 0.3;
  });
  data.totals = accrualFixture(sum(data, 'netProfit'), sum(data, 'revenue'));
  const model = ownerTimelineModel(data, 'day')!;
  expect(model.points[0].revenue).toBe(0.17);
  expect(model.points[0].netProfit).toBe(0.27);
  expect(model.points[1].netProfit).toBe(-0.2);
  expect(model.points.reduce((total, point) => total + cents(point.netProfit), 0)).toBe(cents(data.totals.netProfit));
});

test('wrong scope, incomplete intervals, mismatched totals and nonfinite amounts are rejected', () => {
  const data = timelineFixture();
  expect(ownerTimelineModel(data, 'year')).toBeNull();
  expect(ownerTimelineModel(data, 'day', '2026-10-28')).toBeNull();
  expect(
    ownerTimelineModel({ ...data, totals: { ...data.totals, netProfit: data.totals.netProfit + 0.01 } }, 'day'),
  ).toBeNull();
  expect(ownerTimelineModel({ ...data, opening: { ...data.opening, netProfit: NaN } }, 'day')).toBeNull();
  expect(
    ownerTimelineModel({ ...data, visitsRange: { from: '2026-10-01', to: data.canonicalDate } }, 'day'),
  ).toBeNull();
  expect(ownerTimelineModel({ ...data, buckets: data.buckets.slice(1) }, 'day')).toBeNull();
  const badBucket = (change: Partial<OwnerHomeTimeline['buckets'][number]>) => ({
    ...data,
    buckets: [{ ...data.buckets[0], ...change }, ...data.buckets.slice(1)],
  });
  expect(ownerTimelineModel(badBucket({ netProfit: Infinity }), 'day')).toBeNull();
  expect(ownerTimelineModel(badBucket({ from: data.buckets[0].untilExclusive }), 'day')).toBeNull();
  expect(ownerTimelineModel(badBucket({ localDate: '2026-10-28' }), 'day')).toBeNull();
});

test('partial week, month and year keep complete calendar axes without future series points', () => {
  for (const [period, points, labels] of [
    ['week', 4, ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']],
    ['month', 29, ['1', '15', '31']],
    ['year', 10, ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']],
  ] as const) {
    const data = timelineFixture(period);
    const model = ownerTimelineModel(data, period)!;
    expect(model.points).toHaveLength(points);
    expect(model.axis.map((tick) => tick.label)).toEqual(labels);
    expect(
      model.points.every((point) => Date.parse(point.untilExclusive) <= Date.parse(data.range.untilExclusive)),
    ).toBe(true);
    const plot = ownerPlotGeometry(model, 300, 120);
    expect(plot.xs.at(-1)).toBeLessThan(model.axis.at(-1)!.position * 300);
    expect(plot.revenue).toHaveLength(points);
    expect(plot.profit).toHaveLength(points);
  }
});

test('a calendar week crossing the year runs Monday through Sunday while data stops on the selected Friday', () => {
  const data = calendarReport('week', '2027-01-01', '2026-12-28');
  const model = ownerTimelineModel(data, 'week', '2027-01-01')!;
  expect(model.axis.map((tick) => tick.localDate)).toEqual([
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  expect(model.points).toHaveLength(5);
  expect(model.points.at(-1)?.label).toContain('1 января 2027');
  expect(model.points[4].position).toBe(model.axis[4].position);
});

test.each([
  ['2024-02-14', '2024-02-01', '29', 14],
  ['2025-02-28', '2025-02-01', '28', 28],
  ['2024-04-30', '2024-04-01', '30', 30],
])('selected past month %s uses its own day count', (selected, from, last, points) => {
  const model = ownerTimelineModel(calendarReport('month', selected, from), 'month', selected)!;
  expect(model.axis.map((tick) => tick.label)).toEqual(['1', '15', last]);
  expect(model.axis.at(-1)?.localDate).toBe(`${from.slice(0, 8)}${last}`);
  expect(model.points).toHaveLength(points);
});

test.each([
  ['2024-03-15', 3],
  ['2025-12-31', 12],
] as const)('selected past year %s keeps January through December of that year', (selected, points) => {
  const data = calendarReport('year', selected, `${selected.slice(0, 4)}-01-01`);
  const model = ownerTimelineModel(data, 'year', selected)!;
  expect(model.points).toHaveLength(points);
  expect(model.axis).toHaveLength(12);
  expect(model.axis[0].localDate).toBe(`${selected.slice(0, 4)}-01-01`);
  expect(model.axis[11].localDate).toBe(`${selected.slice(0, 4)}-12-01`);
  expect(model.points[1].label).toContain(`февраль ${selected.slice(0, 4)}`);
  if (selected === '2024-03-15') {
    expect(model.points[1].localDate).toBe('2024-02-29');
    expect(model.points[2].label).toContain('по 15 марта');
  }
});

test('daily tooltips name the bucket day rather than the next exclusive midnight', () => {
  const model = ownerTimelineModel(timelineFixture('month'), 'month')!;
  expect(model.points[0].label).toContain('1 октября');
  expect(model.points[0].label).not.toContain('2 октября');
  expect(model.points.at(-1)?.label).toContain('до 14:20 UTC+03:00');
});

test.each([false, true])(
  'exact midnight retains only the real opening allocation (opening-only response: %s)',
  (openingOnly) => {
    const data = hourlyReport('2026-10-29', '2026-10-28T21:00:00.000Z', '2026-10-28T21:00:00.000Z', 'Europe/Moscow');
    data.buckets[0].revenue = 0;
    data.buckets[0].netProfit = 0;
    if (openingOnly) data.buckets = [];
    data.totals = accrualFixture(-3000, 0);
    const model = ownerTimelineModel(data, 'day')!;
    expect(model.points).toHaveLength(1);
    expect(model.points[0].netProfit).toBe(-3000);
    expect(model.points[0].label).toContain('00:00 UTC+03:00 · начало дня');
    const plot = ownerPlotGeometry(model, 290, 120);
    expect(plot.xs).toEqual([0]);
    expect(plot.revenuePath.d).not.toMatch(/NaN|Infinity/);
    expect(plot.profitPath.d).not.toMatch(/NaN|Infinity/);
    expect(nearestOwnerPoint(plot.xs, 290)).toBe(0);
  },
);

test.each(['week', 'month', 'year'] as const)(
  '%s preserves a zero-duration current-day allocation without a later point',
  (period) => {
    const selected = '2026-01-01';
    const data = calendarReport(period, selected, period === 'week' ? '2025-12-29' : selected);
    data.range.untilExclusive = '2026-01-01T00:00:00.000Z';
    data.buckets.at(-1)!.untilExclusive = data.range.untilExclusive;
    const model = ownerTimelineModel(data, period, selected)!;
    expect(model.points).toHaveLength(period === 'week' ? 4 : 1);
    expect(model.points.at(-1)?.untilExclusive).toBe(data.range.untilExclusive);
    expect(model.points.at(-1)?.label).toContain('до 00:00 UTC');
    expect(model.points.at(-1)!.position).toBeLessThan(model.axis.at(-1)!.position);
  },
);

test.each([
  ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 23],
  ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 25],
] as const)('DST day %s contains %s to %s actual hourly intervals', (date, start, until, count) => {
  const model = ownerTimelineModel(hourlyReport(date, start, until, 'America/New_York'), 'day')!;
  expect(model.points).toHaveLength(count);
  expect(new Set(model.points.map((point) => point.timestamp)).size).toBe(count);
  expect(model.points.every((point) => Date.parse(point.untilExclusive) - point.timestamp === 3_600_000)).toBe(true);
  expect(model.axis.map((tick) => tick.label)).toEqual(['00:00', '06:00', '12:00', '18:00', '24:00']);
  expect(model.points.at(-1)?.label).toContain('23:00–24:00');
  if (count === 25) {
    expect(model.points[1].label).toContain('01:00 UTC−04:00–01:00 UTC−05:00');
    expect(model.points[2].label).toContain('01:00–02:00 UTC−05:00');
    expect(model.points[1].position).toBeLessThan(model.points[2].position);
  } else {
    expect(model.points[1].label).toContain('01:00 UTC−05:00–03:00 UTC−04:00');
  }
});

test('partial DST hour ends at the exact supplied cutoff without a future hourly point', () => {
  const data = hourlyReport('2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-08T07:12:34.567Z', 'America/New_York');
  const model = ownerTimelineModel(data, 'day')!;
  expect(model.points).toHaveLength(3);
  expect(model.points.at(-1)?.untilExclusive).toBe('2026-03-08T07:12:34.567Z');
  expect(model.points.at(-1)?.label).toContain('03:00–03:12 UTC−04:00');
  expect(model.points[2].position).toBeLessThan(3 / 23);
});

test.each([1, 1.8, 3.1])(
  'all twelve month labels fit the 402pt chart at text scale %s without overlapping',
  (fontScale) => {
    const model = ownerTimelineModel(timelineFixture('year'), 'year')!;
    const plotWidth = 402 - 34 - 28 - Math.max(45, 43 * fontScale) - 8;
    const layout = ownerTimelineAxisLayout(model, plotWidth, fontScale);
    expect(layout.labels).toHaveLength(12);
    expect(layout.fontSize).toBe(11);
    if (fontScale === 1) expect(layout.rows).toBe(1);
    else expect(layout.rows).toBeGreaterThan(1);
    for (const label of layout.labels) {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.left + label.width).toBeLessThanOrEqual(plotWidth + 0.0001);
      for (const next of layout.labels.filter((tick) => tick.row === label.row && tick.position > label.position))
        expect(label.left + label.width).toBeLessThanOrEqual(next.left);
    }
  },
);

test('curve controls stay between adjacent real values and equal-time jumps remain vertical', () => {
  const path = ownerPlotPath([
    { x: 0, y: 90 },
    { x: 100, y: 10 },
    { x: 100, y: 40 },
    { x: 200, y: 110 },
  ]);
  expect(path.d).toBe('M0,90 C50,90 50,10 100,10 L100,40 C150,40 150,110 200,110');
  expect(path.length).toBeGreaterThan(200);
  expect(nearestOwnerPoint([0, 100, 100, 200], 100)).toBe(2);
});

test.each([
  ['2026-10-29T09:00:00.125Z', 'UTC', 'UTC'],
  ['2026-10-29T09:00:00.125Z', 'Europe/Moscow', 'UTC+03:00'],
  ['2026-10-28T21:00:00.000Z', 'Europe/Moscow', 'UTC+03:00'],
  ['2026-10-29T00:00:00.000Z', 'America/New_York', 'UTC−04:00'],
  ['2026-12-29T00:00:00.000Z', 'America/St_Johns', 'UTC−03:30'],
  ['2026-10-29T22:45:00.000Z', 'Asia/Kathmandu', 'UTC+05:45'],
  ['2026-10-29T12:00:00.000Z', 'Pacific/Chatham', 'UTC+13:45'],
  ['2026-06-29T12:00:00.000Z', 'Pacific/Chatham', 'UTC+12:45'],
])('offset at %s in %s is derived from zoned civil fields', (at, timezone, expected) => {
  expect(ownerOffsetLabel(at, timezone)).toBe(expected);
});

test('Hermes plain-GMT shortOffset cannot relabel a real Moscow noon point as UTC', () => {
  const NativeFormatter = Intl.DateTimeFormat;
  const formatter = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => {
    const native = new NativeFormatter(locales, options);
    if (options?.timeZoneName === 'shortOffset') {
      const parts = native.formatToParts.bind(native);
      native.formatToParts = (date) =>
        parts(date).map((part) => (part.type === 'timeZoneName' ? { ...part, value: 'GMT' } : part));
    }
    return native;
  });
  try {
    const instant = '2026-10-29T09:00:00.000Z';
    // Safe reproduction of the previous formatter's reliance on the faulty
    // Hermes display part. The timestamp and the zoned clock remain correct.
    const oldOffset = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')
      ?.value.replace('GMT', 'UTC');
    expect(oldOffset).toBe('UTC');
    const data = timelineFixture();
    const noon = ownerTimelineModel(data, 'day')!.points.find((point) => point.at === instant)!;
    expect(noon.label).toContain('12:00–13:00 UTC+03:00');
    const bucket = data.buckets.find((entry) => entry.from === instant)!;
    expect(noon.revenue).toBe(bucket.revenue);
    expect(noon.netProfit).toBe(bucket.netProfit);
    expect(noon.timestamp).toBe(Date.parse(instant));
  } finally {
    formatter.mockRestore();
  }
});

test('one shared axis unit keeps the negative and positive tick labels compact without changing the domain', () => {
  const ticks = [-50_000, 0, 50_000, 100_000];
  const unit = ownerAxisUnit(ticks[0], ticks[3]);
  expect(unit).toEqual({ scale: 1000, label: 'тыс. ₽' });
  expect(ticks.map((value) => ownerAxisLabel(value, unit.scale))).toEqual(['-50', '0', '50', '100']);
  expect(ownerAxisUnit(-2_000_000, 50_000)).toEqual({ scale: 1_000_000, label: 'млн ₽' });
  expect(ownerAxisUnit(0, 0)).toEqual({ scale: 1, label: '₽' });
  expect(ownerAxisLabel(-500_000, 1_000_000)).toBe('-0,5');
});
