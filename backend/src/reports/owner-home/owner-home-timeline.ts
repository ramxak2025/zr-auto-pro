import { PoolClient } from 'pg';
import { profitWindows, profitWindow } from './owner-home-dates';
import { FactWindow, getWindowFacts, loadProfitFacts } from './owner-home-facts';
import { canonicalFactWindows, profitValues, profitResponse } from './owner-home-finance';
import { accrual, rounded } from './owner-home-math';
import { civilOffset, timelineCutoffs, timelineRange } from './owner-home-timeline-dates';
import type { OwnerHomeAccrual, OwnerHomeTimeline, OwnerHomeTimelineBucket } from './owner-home.types';

const fields: (keyof OwnerHomeAccrual)[] = [
  'revenue',
  'checkProfit',
  'plannedFixedAmortized',
  'staffFixedAmortized',
  'staffPctTurnover',
  'staffPctProfit',
  'oneOffExpenses',
  'recurringExcess',
  'salaryExtras',
  'motivation',
  'perVehicleDayExpense',
  'netProfit',
];
const zero = (): OwnerHomeAccrual => Object.fromEntries(fields.map((key) => [key, 0])) as unknown as OwnerHomeAccrual;
const centsDifference = (current: number, previous: number) =>
  (Math.round(current * 100) - Math.round(previous * 100)) / 100;

export async function timelineSnapshot(
  client: PoolClient,
  tenant: string,
  point: string | null,
  tz: string,
  now: Date,
  query: Record<string, unknown>,
): Promise<OwnerHomeTimeline> {
  const w = profitWindows(query.asOf, tz, now);
  const range = timelineRange(query.period, w.current, tz);
  const cutoffs = timelineCutoffs(range, tz);
  const requests: FactWindow[] = canonicalFactWindows(w.current, w.previous);
  cutoffs.forEach((cutoff, i) => requests.push({ id: `point${i}`, window: cutoff.window }));
  if (range.period === 'day') {
    requests.push({ id: 'opening', window: { ...w.current, untilExclusive: w.current.dayStart } });
  } else if (!range.from.endsWith('-01')) {
    requests.push({
      id: 'base',
      window: profitWindow(civilOffset(range.from, -1), tz, new Date(range.start), false),
    });
  }
  const data = await loadProfitFacts(client, tenant, point, tz, requests);
  const facts = (id: string) => getWindowFacts(data, id);
  const current = profitValues(facts('0'), facts('0before'), data.plan, w.current);
  const previous = profitValues(facts('1'), facts('1before'), data.plan, w.previous);
  const footer = profitResponse(point, tz, now, w, { current, previous });
  let opening = zero();
  let totals = zero();
  const cumulative: OwnerHomeAccrual[] = [];
  if (range.period === 'day') {
    const at = (id: string) => {
      const prefix = facts(id);
      // Dates on these costs are not trustworthy event times. Allocate the
      // final eligible day costs (including recurring payments) at opening.
      // Keep the prior-day base; percentage coverage still uses prefix checks.
      return profitValues(
        {
          ...prefix,
          facts: {
            ...prefix.facts,
            expenses: facts('0').facts.expenses,
            oneOff: facts('0').facts.oneOff,
            recurring: facts('0').facts.recurring,
            vehicle: facts('0').facts.vehicle,
          },
        },
        facts('0before'),
        data.plan,
        w.current,
      ).day;
    };
    opening = at('opening');
    cutoffs.forEach((_, i) => cumulative.push(at(`point${i}`)));
    totals = current.day;
  } else {
    let completed = zero();
    let lastInMonth = zero();
    let month = cutoffs[0].window.month;
    let base = data.windows.has('base')
      ? accrual(facts('base').facts, data.plan, Number(range.from.slice(8, 10)) - 1, cutoffs[0].window.daysInMonth)
      : zero();
    for (const [i, cutoff] of cutoffs.entries()) {
      if (cutoff.window.month !== month) {
        completed = lastInMonth;
        base = zero();
        month = cutoff.window.month;
      }
      const raw = accrual(facts(`point${i}`).facts, data.plan, cutoff.window.daysElapsed, cutoff.window.daysInMonth);
      // Keep RAW monthly endpoint differences, including negative capped-cost
      // reversals. Round only after all intersected month segments are summed.
      lastInMonth = zero();
      for (const key of fields) lastInMonth[key] = completed[key] + raw[key] - base[key];
      cumulative.push(rounded(lastInMonth));
    }
    totals = cumulative[cumulative.length - 1];
  }
  let prior = opening;
  const buckets: OwnerHomeTimelineBucket[] = cutoffs.map((cutoff, i) => {
    const value = cumulative[i];
    const bucket = {
      from: cutoff.from,
      untilExclusive: cutoff.untilExclusive,
      localDate: cutoff.localDate,
      revenue: centsDifference(value.revenue, prior.revenue),
      netProfit: centsDifference(value.netProfit, prior.netProfit),
      cumulativeRevenue: value.revenue,
      cumulativeNetProfit: value.netProfit,
    };
    prior = value;
    return bucket;
  });
  return {
    canonicalDate: footer.canonicalDate,
    todayDate: footer.todayDate,
    timezone: tz,
    generatedAt: footer.generatedAt,
    pointId: point,
    basis: footer.basis,
    basisLabel: footer.basisLabel,
    basisDetail: `${footer.basisDetail} Дневной расчёт и итоги периода по-разному распределяют месячные премии. За неделю, месяц и год месячная премия учитывается один раз в назначенном месяце. Поэтому итог периода может отличаться от суммы отдельных дней.`,
    historicalSnapshot: false,
    range,
    rangePolicy: range.period === 'day' ? 'day_legacy' : 'month_accrual_delta',
    intradayPolicy: range.period === 'day' ? 'daily_costs_at_opening' : null,
    allocationDetail:
      range.period === 'day'
        ? 'Дневные расходы отнесены на начало дня: для части расходов точное время не сохраняется. Чеки и начисления учитываются по записанному времени; прибыль пересчитана по текущим данным.'
        : null,
    opening: { at: range.start, revenue: opening.revenue, netProfit: opening.netProfit },
    buckets,
    totals,
    footer,
    visitsRange: { from: range.from, to: range.through },
  };
}
