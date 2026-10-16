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
  baza: {
    code: 'baza',
    name: 'BAZA',
    monthlyPrice: 990,
    includedEmployees: 1,
    extraEmployeeMonthlyPrice: 990,
    includedPoints: null,
    extraPointMonthlyPrice: null,
  },
  pro: {
    code: 'pro',
    name: 'PRO',
    monthlyPrice: 4990,
    includedEmployees: 5,
    extraEmployeeMonthlyPrice: 500,
    includedPoints: null,
    extraPointMonthlyPrice: null,
  },
  max: {
    code: 'max',
    name: 'MAX',
    monthlyPrice: 15000,
    includedEmployees: 50,
    extraEmployeeMonthlyPrice: 500,
    includedPoints: 1,
    extraPointMonthlyPrice: 3000,
  },
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

export interface SubscriptionQuoteInput {
  period: SubscriptionBillingPeriod;
  employees: number;
  points: number;
}

/** Display only: invoice and ledger amounts always use the exact quote.total. */
export function getSubscriptionMonthlyDisplay(quote: Pick<SubscriptionQuote, 'total' | 'serviceMonths'>): {
  amount: number;
  approximate: boolean;
} {
  const totalKopecks = Math.round(quote.total * 100);
  return {
    amount: Math.round(totalKopecks / quote.serviceMonths) / 100,
    approximate: totalKopecks % quote.serviceMonths !== 0,
  };
}

export function calculateSubscriptionQuote(
  pricing: SubscriptionPlanPricing,
  input: SubscriptionQuoteInput,
): SubscriptionQuoteResult {
  if (
    (input.period !== 'monthly' && input.period !== 'yearly') ||
    ![input.employees, input.points].every((count) => Number.isSafeInteger(count) && count >= 1)
  ) {
    return { ok: false, code: 'INVALID_COUNT' };
  }
  const extraEmployees = Math.max(0, input.employees - pricing.includedEmployees);
  const extraPoints = Math.max(0, input.points - (pricing.includedPoints ?? 1));
  if (extraPoints > 0 && pricing.extraPointMonthlyPrice === null) {
    return { ok: false, code: 'UNPRICED_POINTS' };
  }
  const employeesMonthlyAmount = extraEmployees * pricing.extraEmployeeMonthlyPrice;
  const pointsMonthlyAmount = extraPoints * (pricing.extraPointMonthlyPrice ?? 0);
  const monthlyTotal = Math.round((pricing.monthlyPrice + employeesMonthlyAmount + pointsMonthlyAmount) * 100) / 100;
  // Bound money as integer kopecks: no NaN, overflow or imprecise payable amounts.
  if (
    ![
      pricing.monthlyPrice,
      pricing.extraEmployeeMonthlyPrice,
      pricing.extraPointMonthlyPrice ?? 0,
      employeesMonthlyAmount,
      pointsMonthlyAmount,
      monthlyTotal,
    ].every((value) => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100) * 10))
  ) {
    return { ok: false, code: 'INVALID_COUNT' };
  }
  const yearly = input.period === 'yearly';
  const total = Math.round(monthlyTotal * (yearly ? 10 : 1) * 100) / 100;
  // Match the existing payment DTO ceiling; a preview must be payable unchanged.
  if (total > 99999999) return { ok: false, code: 'INVALID_COUNT' };
  return {
    ok: true,
    quote: {
      planCode: pricing.code,
      period: input.period,
      employees: input.employees,
      points: input.points,
      includedEmployees: pricing.includedEmployees,
      extraEmployees,
      includedPoints: pricing.includedPoints,
      extraPoints,
      baseMonthlyAmount: pricing.monthlyPrice,
      employeesMonthlyAmount,
      pointsMonthlyAmount,
      monthlyTotal,
      total,
      serviceMonths: yearly ? 12 : 1,
      chargedMonths: yearly ? 10 : 1,
      currency: 'RUB',
    },
  };
}
