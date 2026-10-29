import type { OwnerHomeAccrual, OwnerHomeProfitDelta } from './owner-home.types';

export interface AccrualFacts {
  revenue: number;
  checkProfit: number;
  expenses: number;
  oneOff: number;
  recurring: number;
  premiums: number;
  motivation: number;
  vehicle: number;
}
export interface AccrualPlan {
  fixed: number;
  staffFixed: number;
  pctTurnover: number;
  pctProfit: number;
}

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Same accrual formula as dashboard-v2, applied to explicit MTD facts. */
export function accrual(f: AccrualFacts, p: AccrualPlan, elapsed: number, days: number): OwnerHomeAccrual {
  if (elapsed === 0)
    return {
      revenue: 0,
      checkProfit: 0,
      plannedFixedAmortized: 0,
      staffFixedAmortized: 0,
      staffPctTurnover: 0,
      staffPctProfit: 0,
      oneOffExpenses: 0,
      recurringExcess: 0,
      salaryExtras: 0,
      motivation: 0,
      perVehicleDayExpense: 0,
      netProfit: 0,
    };
  const hasPlan = p.fixed > 0 || p.staffFixed > 0 || p.pctTurnover > 0 || p.pctProfit > 0;
  const factor = elapsed / days;
  const fixed = p.fixed * factor,
    staff = p.staffFixed * factor;
  const turnover = (f.revenue * p.pctTurnover) / 100;
  const profit = (Math.max(f.checkProfit, 0) * p.pctProfit) / 100;
  const oneOff = hasPlan ? f.oneOff : f.expenses;
  const excess = hasPlan ? Math.max(f.recurring * factor - fixed - staff - turnover - profit, 0) : 0;
  const extras = f.premiums + f.motivation;
  return {
    revenue: f.revenue,
    checkProfit: f.checkProfit,
    plannedFixedAmortized: fixed,
    staffFixedAmortized: staff,
    staffPctTurnover: turnover,
    staffPctProfit: profit,
    oneOffExpenses: oneOff,
    recurringExcess: excess,
    salaryExtras: extras,
    motivation: f.motivation,
    perVehicleDayExpense: f.vehicle,
    netProfit: f.checkProfit - fixed - staff - turnover - profit - oneOff - excess - extras - f.vehicle,
  };
}

export function rounded(value: OwnerHomeAccrual): OwnerHomeAccrual {
  return Object.fromEntries(
    Object.entries(value).map(([key, amount]) => [key, roundMoney(amount)]),
  ) as unknown as OwnerHomeAccrual;
}

/** Derive before rounding, preserving reversals of capped monthly percentages. */
export function daily(current: OwnerHomeAccrual, previous: OwnerHomeAccrual): OwnerHomeAccrual {
  return Object.fromEntries(
    Object.entries(current).map(([key, amount]) => [key, roundMoney(amount - previous[key as keyof OwnerHomeAccrual])]),
  ) as unknown as OwnerHomeAccrual;
}

export function delta(current: number, previous: number): OwnerHomeProfitDelta {
  return {
    amount: roundMoney(current - previous),
    percent: previous > 0 ? roundMoney(((current - previous) / previous) * 100) : null,
  };
}
