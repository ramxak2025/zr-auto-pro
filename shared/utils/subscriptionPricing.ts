export type SubscriptionPlanCode = 'baza' | 'pro' | 'max';
export type SubscriptionBillingPeriod = 'monthly' | 'yearly';

export interface SubscriptionPlanPricing {
  code: SubscriptionPlanCode;
  name: string;
  monthlyPrice: number;
  includedEmployees: number;
  extraEmployeeMonthlyPrice: number;
  includedPoints: number | null;
  extraPointMonthlyPrice: number | null;
}

export const SUBSCRIPTION_PLAN_PRICING: Readonly<Record<SubscriptionPlanCode, SubscriptionPlanPricing>> = {
  baza: { code: 'baza', name: 'БАЗА', monthlyPrice: 990, includedEmployees: 1, extraEmployeeMonthlyPrice: 990, includedPoints: 1, extraPointMonthlyPrice: null },
  pro: { code: 'pro', name: 'ПРО', monthlyPrice: 4990, includedEmployees: 5, extraEmployeeMonthlyPrice: 500, includedPoints: 1, extraPointMonthlyPrice: null },
  max: { code: 'max', name: 'МАКС', monthlyPrice: 15000, includedEmployees: 50, extraEmployeeMonthlyPrice: 500, includedPoints: 1, extraPointMonthlyPrice: 5000 },
};

export interface SubscriptionQuote {
  planCode: SubscriptionPlanCode;
  period: SubscriptionBillingPeriod;
  employees: number;
  points: number;
  includedEmployees: number;
  extraEmployees: number;
  includedPoints: number | null;
  extraPoints: number;
  baseMonthlyAmount: number;
  employeesMonthlyAmount: number;
  pointsMonthlyAmount: number;
  monthlyTotal: number;
  total: number;
  serviceMonths: 1 | 12;
  chargedMonths: 1 | 10;
  currency: 'RUB';
}

export type SubscriptionQuoteResult =
  | { ok: true; quote: SubscriptionQuote }
  | { ok: false; code: 'INVALID_COUNT' | 'UNPRICED_POINTS' };

export function calculateSubscriptionQuote(
  pricing: SubscriptionPlanPricing,
  input: { period: SubscriptionBillingPeriod; employees: number; points: number },
): SubscriptionQuoteResult {
  if (![input.employees, input.points].every((count) => Number.isSafeInteger(count) && count >= 1)) {
    return { ok: false, code: 'INVALID_COUNT' };
  }
  const extraEmployees = Math.max(0, input.employees - pricing.includedEmployees);
  const extraPoints = pricing.includedPoints === null ? 0 : Math.max(0, input.points - pricing.includedPoints);
  if (extraPoints > 0 && pricing.extraPointMonthlyPrice === null) {
    return { ok: false, code: 'UNPRICED_POINTS' };
  }
  const employeesMonthlyAmount = extraEmployees * pricing.extraEmployeeMonthlyPrice;
  const pointsMonthlyAmount = extraPoints * (pricing.extraPointMonthlyPrice ?? 0);
  const monthlyTotal = pricing.monthlyPrice + employeesMonthlyAmount + pointsMonthlyAmount;
  const yearly = input.period === 'yearly';
  return { ok: true, quote: {
    planCode: pricing.code, period: input.period, employees: input.employees, points: input.points,
    includedEmployees: pricing.includedEmployees, extraEmployees, includedPoints: pricing.includedPoints, extraPoints,
    baseMonthlyAmount: pricing.monthlyPrice, employeesMonthlyAmount, pointsMonthlyAmount, monthlyTotal,
    total: monthlyTotal * (yearly ? 10 : 1), serviceMonths: yearly ? 12 : 1, chargedMonths: yearly ? 10 : 1, currency: 'RUB',
  } };
}
