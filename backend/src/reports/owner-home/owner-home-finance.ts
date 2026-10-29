import { Pool, PoolClient } from 'pg';
import { checkMoneyBaseWhere, checkProfitExpr, checkRevenueExpr } from '../../common/check-money-sql';
import { expenseMonthAsOfSql } from '../../common/dashboard-expense-sql';
import { pointFilterSql } from '../../common/point-scope';
import { premiumCashAmountExpr } from '../../common/salary-extras-sql';
import { assignedToPointSql } from '../../users/user-points-sql';
import { sumVehicleDayCosts, vehicleDayCosts } from '../../common/vehicle-day-costs';
import { ProfitWindow } from './owner-home-dates';
import { AccrualFacts, AccrualPlan, accrual, daily, rounded, roundMoney } from './owner-home-math';

const windowsSql = `WITH windows AS (
  SELECT * FROM jsonb_to_recordset($2::jsonb) AS w(id text, month text, start timestamptz, until timestamptz, day_start timestamptz)
)`;
type AggregateRow = { id: string } & Record<string, string | null>;
const num = (row: AggregateRow | undefined, key: string) => Number(row?.[key] ?? 0);

/** Four bounded MTD cutoffs, with all reads on the caller's repeatable-read snapshot. */
export async function profitSnapshots(
  client: PoolClient,
  tenant: string,
  point: string | null,
  tz: string,
  current: ProfitWindow,
  previous: ProfitWindow,
) {
  const windows = [current, previous].flatMap((w, i) => [
    { id: `${i}`, month: w.month, start: w.start, until: w.untilExclusive, day_start: w.dayStart },
    { id: `${i}before`, month: w.month, start: w.start, until: w.dayStart, day_start: w.dayStart },
  ]);
  const parameters: unknown[] = [tenant, JSON.stringify(windows)];
  const pointSql = pointFilterSql('c', point, parameters);
  const moneyRows = (
    await client.query<AggregateRow>(
      `${windowsSql}
    SELECT w.id, COALESCE(SUM(${checkRevenueExpr('c')}),0) AS revenue,
      COALESCE(SUM(${checkProfitExpr('c')}),0) AS profit
    FROM windows w LEFT JOIN checks c ON c.tenant_id=$1 AND ${checkMoneyBaseWhere('c')}
      AND c.date >= w.start AND c.date < w.until${pointSql}
    GROUP BY w.id`,
      parameters,
    )
  ).rows;
  const expParams: unknown[] = [tenant, JSON.stringify(windows), tz];
  const expPoint = pointFilterSql('e', point, expParams);
  const membership = expenseMonthAsOfSql('e', 'w.month', '$3::text', 'w.start', 'w.until');
  const expenseRows = (
    await client.query<AggregateRow>(
      `${windowsSql}
    SELECT w.id,
      COALESCE(SUM(e.amount) FILTER (WHERE COALESCE(ec.name,'') <> 'Зарплата'),0) AS expenses,
      COALESCE(SUM(e.amount) FILTER (WHERE COALESCE(ec.name,'') <> 'Зарплата' AND NOT COALESCE(ec.is_recurring,false)),0) AS oneoff,
      COALESCE(SUM(e.amount) FILTER (WHERE COALESCE(ec.name,'') <> 'Зарплата' AND COALESCE(ec.is_recurring,false)),0) AS recurring
    FROM windows w LEFT JOIN expenses e ON e.tenant_id=$1
      AND COALESCE(e.approval_status,'approved')='approved' AND ${membership}${expPoint}
    LEFT JOIN expense_categories ec ON ec.id=e.category_id AND ec.tenant_id=e.tenant_id
    GROUP BY w.id`,
      expParams,
    )
  ).rows;

  const premParams: unknown[] = [tenant, JSON.stringify(windows)];
  const premPoint = pointFilterSql('sp', point, premParams);
  const assigned = `CASE WHEN sp.period_month_year ~ '^\\d{4}-\\d{2}$' THEN sp.period_month_year END`;
  const premiumRows = (
    await client.query<AggregateRow>(
      `${windowsSql}
    SELECT w.id, COALESCE(SUM(${premiumCashAmountExpr('sp')}),0) AS premiums,
      COALESCE(SUM(${premiumCashAmountExpr('sp')}) FILTER (WHERE sp.created_at >= w.day_start AND sp.created_at < w.until),0) AS day_premiums
    FROM windows w LEFT JOIN salary_premiums sp ON sp.tenant_id=$1 AND (
      (${assigned}) = w.month OR ((${assigned}) IS NULL AND sp.created_at >= w.start AND sp.created_at < w.until)
    )${premPoint}
    GROUP BY w.id`,
      premParams,
    )
  ).rows;

  const motParams: unknown[] = [tenant, JSON.stringify(windows)];
  const motPoint = point
    ? ` AND EXISTS (SELECT 1 FROM checks mc WHERE mc.tenant_id=$1 AND mc.id=ma.check_id AND mc.point_id=$3)`
    : '';
  if (point) motParams.push(point);
  const motivationRows = (
    await client.query<AggregateRow>(
      `${windowsSql}
    SELECT w.id, COALESCE(SUM(ma.amount),0) AS motivation
    FROM windows w LEFT JOIN motivation_accruals ma ON ma.tenant_id=$1
      AND ma.accrued_at >= w.start AND ma.accrued_at < w.until${motPoint}
    GROUP BY w.id`,
      motParams,
    )
  ).rows;

  const fcParams: unknown[] = [tenant];
  const fcPoint = pointFilterSql('fc', point, fcParams);
  const fixed = (
    await client.query<{ amount: string }>(
      `SELECT COALESCE(SUM(fc.monthly_amount),0) AS amount FROM fixed_costs fc
      WHERE fc.tenant_id=$1 AND fc.mode='monthly' AND fc.active=true${fcPoint}`,
      fcParams,
    )
  ).rows[0];
  const compParams: unknown[] = [tenant];
  const compPoint = assignedToPointSql('u', '$1', point, compParams);
  const compensation = (
    await client.query<{ type: string; amount: string }>(
      `SELECT ec.type, COALESCE(SUM(ec.amount),0) AS amount FROM employee_compensation ec
      JOIN users u ON u.id=ec.user_id AND u.tenant_id=ec.tenant_id
      WHERE ec.tenant_id=$1 AND ec.active=true${compPoint} GROUP BY ec.type`,
      compParams,
    )
  ).rows;
  const plan: AccrualPlan = { fixed: Number(fixed.amount), staffFixed: 0, pctTurnover: 0, pctProfit: 0 };
  for (const row of compensation) {
    if (row.type === 'fixed_monthly') plan.staffFixed += Number(row.amount);
    if (row.type === 'pct_turnover') plan.pctTurnover += Number(row.amount);
    if (row.type === 'pct_profit') plan.pctProfit += Number(row.amount);
  }
  const result = [];
  for (const [i, w] of [current, previous].entries()) {
    // Legacy helper only calls .query; keep its public signature/source unchanged
    // while making it use this transaction instead of opening a separate snapshot.
    const vehicle = await vehicleDayCosts(client as unknown as Pool, {
      tenantId: tenant,
      pointId: point,
      tz,
      dateFrom: w.from,
      dateTo: w.through,
      // The legacy helper accepts an inclusive bound. PostgreSQL stores
      // microseconds, so subtract one microsecond, not one millisecond.
      asOf: new Date(new Date(w.untilExclusive).getTime() - 1).toISOString().replace(/Z$/, '999Z'),
    });
    const facts = (id: string, before: boolean): AccrualFacts => {
      const money = moneyRows.find((r) => r.id === id),
        exp = expenseRows.find((r) => r.id === id);
      return {
        revenue: num(money, 'revenue'),
        checkProfit: num(money, 'profit'),
        expenses: num(exp, 'expenses'),
        oneOff: num(exp, 'oneoff'),
        recurring: num(exp, 'recurring'),
        premiums: num(
          premiumRows.find((r) => r.id === id),
          'premiums',
        ),
        motivation: num(
          motivationRows.find((r) => r.id === id),
          'motivation',
        ),
        vehicle: sumVehicleDayCosts(before ? vehicle.filter((v) => v.day < w.through) : vehicle),
      };
    };
    const mtd = accrual(facts(`${i}`, false), plan, w.daysElapsed, w.daysInMonth);
    const before = accrual(facts(`${i}before`, true), plan, w.daysElapsed - 1, w.daysInMonth);
    const day = daily(mtd, before);
    // Preserve dashboard-v2's explicit fact-day premium convention. Allocated
    // monthly premiums are not an MTD difference after the first day.
    const dayPremium =
      w.daysElapsed === 1
        ? facts(`${i}`, false).premiums
        : num(
            premiumRows.find((r) => r.id === `${i}`),
            'day_premiums',
          );
    const extras = dayPremium + (w.daysElapsed === 1 ? mtd.motivation : mtd.motivation - before.motivation);
    day.netProfit = roundMoney(mtd.netProfit - before.netProfit + (mtd.salaryExtras - before.salaryExtras) - extras);
    day.salaryExtras = roundMoney(extras);
    result.push({ day, mtd: rounded(mtd) });
  }
  return { current: result[0], previous: result[1] };
}
