import type {
  OwnerHomeAccrual,
  OwnerHomeProfit,
  OwnerHomeTimeline,
  OwnerHomeTimelinePeriod,
} from '../../../../../../shared/types/ownerHome';
import { formatDayKey } from '../../../../../../shared/utils/formatters';
export const accrualFixture = (netProfit: number, revenue = 100000): OwnerHomeAccrual => ({
  revenue,
  netProfit,
  checkProfit: netProfit + 3000,
  plannedFixedAmortized: 3000,
  staffFixedAmortized: 0,
  staffPctTurnover: 0,
  staffPctProfit: 0,
  oneOffExpenses: 0,
  recurringExcess: 0,
  salaryExtras: 0,
  motivation: 0,
  perVehicleDayExpense: 0,
});
export const footerFixture: OwnerHomeProfit = {
  canonicalDate: '2026-10-29',
  todayDate: '2026-10-29',
  timezone: 'Europe/Moscow',
  generatedAt: '2026-10-29T11:20:00Z',
  pointId: 'point-A',
  basis: 'current_plan',
  basisLabel: 'По текущему плану расходов',
  basisDetail: 'Исторические результаты пересчитаны по текущему плану.',
  historicalSnapshot: false,
  current: {
    period: {
      from: '2026-10-01',
      through: '2026-10-29',
      untilExclusive: '2026-10-29T11:20:00Z',
      daysElapsed: 29,
      daysInMonth: 31,
      partialDay: true,
    },
    day: accrualFixture(26500),
    mtd: accrualFixture(559500, 2184000),
  },
  comparison: {
    period: {
      from: '2026-09-01',
      through: '2026-09-29',
      untilExclusive: '2026-09-29T11:20:00Z',
      daysElapsed: 29,
      daysInMonth: 30,
      partialDay: true,
    },
    basis: 'current_plan',
    clamped: false,
    day: accrualFixture(20000),
    mtd: accrualFixture(478400, 1800000),
    dayDelta: { amount: 6500, percent: 32.5 },
    mtdDelta: { amount: 81100, percent: 17 },
  },
};
export function timelineFixture(period: OwnerHomeTimelinePeriod = 'day'): OwnerHomeTimeline {
  const date = '2026-10-29',
    from = { day: date, week: '2026-10-26', month: '2026-10-01', year: '2026-01-01' }[period];
  const start = new Date(`${from}T00:00:00+03:00`).toISOString(),
    end = '2026-10-29T11:20:00.000Z';
  const totals =
    period === 'day'
      ? footerFixture.current.day
      : period === 'month'
        ? footerFixture.current.mtd
        : accrualFixture(period === 'week' ? 90000 : 3900000, period === 'week' ? 300000 : 12000000);
  const boundaries: string[] = [];
  let cursor = new Date(start);
  while (cursor.getTime() < Date.parse(end)) {
    const next = new Date(cursor);
    if (period === 'day') next.setUTCHours(next.getUTCHours() + 1);
    else if (period === 'year') {
      const local = new Date(cursor.getTime() + 3 * 3600000);
      local.setUTCMonth(local.getUTCMonth() + 1, 1);
      next.setTime(local.getTime() - 3 * 3600000);
    } else next.setUTCDate(next.getUTCDate() + 1);
    if (next.getTime() >= Date.parse(end)) break;
    boundaries.push(next.toISOString());
    cursor = next;
  }
  boundaries.push(end);
  let previousRevenue = 0,
    previousProfit = -3000,
    previousAt = start;
  const buckets = boundaries.map((untilExclusive, index) => {
    const cumulativeRevenue = Math.round(((totals.revenue * (index + 1)) / boundaries.length) * 100) / 100;
    const cumulativeNetProfit =
      Math.round((-3000 + ((totals.netProfit + 3000) * (index + 1)) / boundaries.length) * 100) / 100;
    const bucket = {
      from: previousAt,
      untilExclusive,
      localDate: formatDayKey(new Date(Date.parse(untilExclusive) - 1), 'Europe/Moscow'),
      revenue: Math.round((cumulativeRevenue - previousRevenue) * 100) / 100,
      netProfit: Math.round((cumulativeNetProfit - previousProfit) * 100) / 100,
      cumulativeRevenue,
      cumulativeNetProfit,
    };
    previousAt = untilExclusive;
    previousRevenue = cumulativeRevenue;
    previousProfit = cumulativeNetProfit;
    return bucket;
  });
  return {
    canonicalDate: date,
    todayDate: date,
    timezone: 'Europe/Moscow',
    generatedAt: end,
    pointId: 'point-A',
    basis: 'current_plan',
    basisLabel: footerFixture.basisLabel,
    basisDetail: footerFixture.basisDetail,
    historicalSnapshot: false,
    range: {
      period,
      from,
      through: date,
      start,
      untilExclusive: end,
      partialDay: true,
      granularity: period === 'day' ? 'hour' : period === 'year' ? 'month' : 'day',
    },
    rangePolicy: period === 'day' ? 'day_legacy' : 'month_accrual_delta',
    intradayPolicy: period === 'day' ? 'daily_costs_at_opening' : null,
    allocationDetail: period === 'day' ? 'Расходы без точного времени распределены на начало дня.' : null,
    opening: { at: start, revenue: 0, netProfit: -3000 },
    buckets,
    totals,
    footer: footerFixture,
    visitsRange: { from, to: date },
  };
}
