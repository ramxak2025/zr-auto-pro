import { SubscriptionPlanPricing } from './subscription-pricing';

/** Legacy/custom plans have no composable pricing; never infer it from names. */
export function pricingFromPlanRow(row: Record<string, unknown>): SubscriptionPlanPricing | null {
  if (row.code !== 'baza' && row.code !== 'pro' && row.code !== 'max') return null;
  const monthlyPrice = Number(row.monthly_price);
  const includedEmployees = Number(row.included_employees);
  const extraEmployeeMonthlyPrice = Number(row.extra_employee_monthly_price);
  const includedPoints = row.included_points == null ? null : Number(row.included_points);
  const extraPointMonthlyPrice = row.extra_point_monthly_price == null ? null : Number(row.extra_point_monthly_price);
  if (
    row.included_employees == null ||
    row.extra_employee_monthly_price == null ||
    !Number.isSafeInteger(includedEmployees) ||
    includedEmployees < 1 ||
    !Number.isFinite(monthlyPrice) ||
    monthlyPrice < 0 ||
    !Number.isFinite(extraEmployeeMonthlyPrice) ||
    extraEmployeeMonthlyPrice < 0 ||
    (includedPoints !== null && (!Number.isSafeInteger(includedPoints) || includedPoints < 1)) ||
    (extraPointMonthlyPrice !== null && (!Number.isFinite(extraPointMonthlyPrice) || extraPointMonthlyPrice < 0))
  )
    return null;
  return {
    code: row.code,
    name: String(row.name),
    monthlyPrice,
    includedEmployees,
    extraEmployeeMonthlyPrice,
    includedPoints,
    extraPointMonthlyPrice,
  };
}
