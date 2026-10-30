import { PoolClient } from 'pg';
import { ProfitWindow, profitWindows, publicPeriod } from './owner-home-dates';
import { FactWindow, WindowFacts, getWindowFacts, loadProfitFacts } from './owner-home-facts';
import { AccrualPlan, accrual, daily, delta, rounded, roundMoney } from './owner-home-math';

export function beforeWindow(w: ProfitWindow): ProfitWindow {
  return { ...w, untilExclusive: w.dayStart, daysElapsed: w.daysElapsed - 1 };
}

export function canonicalFactWindows(current: ProfitWindow, previous: ProfitWindow): FactWindow[] {
  return [current, previous].flatMap((w, i) => [
    { id: `${i}`, window: w },
    { id: `${i}before`, window: beforeWindow(w) },
  ]);
}

/** Keep the legacy fact-day cash premium exception, including first-day allocation. */
export function profitValues(end: WindowFacts, start: WindowFacts, plan: AccrualPlan, w: ProfitWindow) {
  const mtd = accrual(end.facts, plan, w.daysElapsed, w.daysInMonth);
  const before = accrual(start.facts, plan, w.daysElapsed - 1, w.daysInMonth);
  const day = daily(mtd, before);
  const dayPremium = w.daysElapsed === 1 ? end.facts.premiums : end.dayPremiums;
  const extras = dayPremium + (w.daysElapsed === 1 ? mtd.motivation : mtd.motivation - before.motivation);
  day.netProfit = roundMoney(mtd.netProfit - before.netProfit + (mtd.salaryExtras - before.salaryExtras) - extras);
  day.salaryExtras = roundMoney(extras);
  return { day, mtd: rounded(mtd) };
}

/** Public signature/results stay compatible; all facts share the caller's snapshot. */
export async function profitSnapshots(
  client: PoolClient,
  tenant: string,
  point: string | null,
  tz: string,
  current: ProfitWindow,
  previous: ProfitWindow,
) {
  const data = await loadProfitFacts(client, tenant, point, tz, canonicalFactWindows(current, previous));
  const values = (w: ProfitWindow, id: string) =>
    profitValues(getWindowFacts(data, id), getWindowFacts(data, `${id}before`), data.plan, w);
  return { current: values(current, '0'), previous: values(previous, '1') };
}

export function profitResponse(
  point: string | null,
  tz: string,
  now: Date,
  w: ReturnType<typeof profitWindows>,
  values: { current: ReturnType<typeof profitValues>; previous: ReturnType<typeof profitValues> },
): import('./owner-home.types').OwnerHomeProfit {
  return {
    canonicalDate: w.canonicalDate,
    todayDate: w.todayDate,
    timezone: tz,
    generatedAt: now.toISOString(),
    pointId: point,
    basis: 'current_plan',
    basisLabel: 'Пересчёт по текущему плану',
    historicalSnapshot: false,
    basisDetail:
      'Чеки, расходы и начисления взяты в текущем сохранённом состоянии. Месячный план, оклады и состав команды — текущие; прежние настройки не сохранялись. Расходы на автомобиль — по ставкам, действовавшим в день визита. Оба периода рассчитаны по одним правилам, это не архивный снимок.',
    current: { period: publicPeriod(w.current), ...values.current },
    comparison: {
      period: publicPeriod(w.previous),
      clamped: w.clamped,
      basis: 'current_plan',
      ...values.previous,
      dayDelta: delta(values.current.day.netProfit, values.previous.day.netProfit),
      mtdDelta: delta(values.current.mtd.netProfit, values.previous.mtd.netProfit),
    },
  };
}
