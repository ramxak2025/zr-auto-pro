import { PoolClient } from 'pg';
import { checkMoneyBaseWhere, checkProfitExpr, checkRevenueExpr } from '../../common/check-money-sql';
import { expenseMonthAsOfSql } from '../../common/dashboard-expense-sql';
import { pointFilterSql } from '../../common/point-scope';
import { premiumCashAmountExpr } from '../../common/salary-extras-sql';
import { assignedToPointSql } from '../../users/user-points-sql';
import { ProfitWindow } from './owner-home-dates';
import { AccrualFacts, AccrualPlan } from './owner-home-math';

const windowsSql = `WITH windows AS (
  SELECT * FROM jsonb_to_recordset($2::jsonb) AS w(id text, month text, start timestamptz, until timestamptz, day_start timestamptz, through date)
)`;
type AggregateRow = { id: string } & Record<string, string | null>;
const num = (row: AggregateRow | undefined, key: string) => Number(row?.[key] ?? 0);

export interface FactWindow {
  id: string;
  window: ProfitWindow;
}
export interface WindowFacts {
  facts: AccrualFacts;
  dayPremiums: number;
}
export interface ProfitFacts {
  plan: AccrualPlan;
  windows: Map<string, WindowFacts>;
}

export function getWindowFacts(data: ProfitFacts, id: string): WindowFacts {
  const value = data.windows.get(id);
  if (!value) throw new Error(`Missing owner-home finance cutoff: ${id}`);
  return value;
}

/** Seven aggregate reads regardless of cutoff count. Never returns raw checks. */
export async function loadProfitFacts(
  client: PoolClient,
  tenant: string,
  point: string | null,
  tz: string,
  requested: FactWindow[],
): Promise<ProfitFacts> {
  const windows = requested.map(({ id, window: w }) => ({
    id,
    month: w.month,
    start: w.start,
    until: w.untilExclusive,
    day_start: w.dayStart,
    through: w.through,
  }));
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

  // Same visit/rate rules as common/vehicle-day-costs, batched over all
  // cutoffs. Deduplicate across the tenant BEFORE filtering the point. The
  // native exclusive bound also retains PostgreSQL's final microsecond.
  const vehicleParams: unknown[] = [tenant, JSON.stringify(windows), tz];
  const vehiclePoint = pointFilterSql('v', point, vehicleParams);
  const vehicleRows = (
    await client.query<AggregateRow>(
      `${windowsSql}, visits AS (
        SELECT DISTINCT ON (w.id,ch.car_id,(ch.date AT TIME ZONE $3::text)::date)
          w.id,ch.car_id,ch.point_id,(ch.date AT TIME ZONE $3::text)::date AS day
        FROM windows w JOIN checks ch ON ch.tenant_id=$1
          AND ch.is_deferred=false AND ch.deleted_at IS NULL
          AND ch.client_id IS NOT NULL AND ch.car_id IS NOT NULL
          AND ch.date >= w.start AND ch.date < w.until
          AND ch.date < (w.through + 1)::timestamp AT TIME ZONE $3::text
        ORDER BY w.id,ch.car_id,(ch.date AT TIME ZONE $3::text)::date,ch.date,ch.created_at,ch.id
      )
      SELECT v.id,COALESCE(SUM(h.amount),0) AS vehicle
      FROM visits v
      JOIN fixed_costs fc ON fc.tenant_id=$1 AND fc.mode='per_vehicle_day'
        AND fc.point_id IS NOT DISTINCT FROM v.point_id
      JOIN LATERAL (
        SELECT fh.amount,fh.active,fh.archived FROM fixed_cost_vehicle_history fh
        WHERE fh.tenant_id=$1 AND fh.fixed_cost_id=fc.id AND fh.effective_from<=v.day
        ORDER BY fh.effective_from DESC,fh.revision DESC LIMIT 1
      ) h ON h.active AND NOT h.archived
      WHERE true${vehiclePoint} GROUP BY v.id`,
      vehicleParams,
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
  const index = (rows: AggregateRow[]) => new Map(rows.map((r) => [r.id, r]));
  const money = index(moneyRows),
    expenses = index(expenseRows),
    premiums = index(premiumRows),
    motivation = index(motivationRows),
    vehicle = index(vehicleRows);
  return {
    plan,
    windows: new Map(
      windows.map(({ id }) => [
        id,
        {
          facts: {
            revenue: num(money.get(id), 'revenue'),
            checkProfit: num(money.get(id), 'profit'),
            expenses: num(expenses.get(id), 'expenses'),
            oneOff: num(expenses.get(id), 'oneoff'),
            recurring: num(expenses.get(id), 'recurring'),
            premiums: num(premiums.get(id), 'premiums'),
            motivation: num(motivation.get(id), 'motivation'),
            vehicle: num(vehicle.get(id), 'vehicle'),
          },
          dayPremiums: num(premiums.get(id), 'day_premiums'),
        },
      ]),
    ),
  };
}
