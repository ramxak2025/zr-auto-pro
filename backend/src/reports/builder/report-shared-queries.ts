/**
 * Денежные запросы, которые нужны нескольким отчётам сразу (сводный, филиалы,
 * поставщики, клиенты). Формулы — только из common/*; здесь лишь состав строк
 * и период, продублированные с reports.service там, где его методы приватны
 * (salaryExtrasForPeriod) — с той же семантикой отнесения к периоду.
 */
import { Pool } from 'pg';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../common/check-money-sql';
import { effectiveMonthMembershipSql } from '../../common/period-membership';
import { pointFilterSql } from '../../common/point-scope';
import { motivationPointFilterSql, premiumCashAmountExpr } from '../../common/salary-extras-sql';
import { ReportContext } from './report-context';
import { TZ_PH, baseParams, expenseApproved, expenseMembership, inPeriod, num, premiumMembership } from './report-sql';

export interface CheckAggregate {
  checks: number;
  revenue: number;
  /** Себестоимость товаров БЕЗ гарантийных чеков (их запчасти — в warrantyLoss). */
  productCost: number;
  /** Зарплатные начисления по чекам без гарантии (услуги + товарная комиссия). */
  salaries: number;
  /** Убыток по гарантии: запчасти + зарплата мастера по гарантийным чекам. */
  warrantyLoss: number;
  clients: number;
}

/**
 * Агрегат по проведённым чекам за период — ТОТ ЖЕ состав колонок, что в
 * reports.getFinancial (revenue / product_cost / salaries / warranty_loss),
 * поэтому сводный отчёт сходится с финотчётом до копейки.
 */
export async function checkAggregate(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz' | 'pointId'>,
): Promise<CheckAggregate> {
  const params = baseParams(ctx);
  const point = pointFilterSql('ch', ctx.pointId, params);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS checks,
            COUNT(DISTINCT ch.client_id)::int AS clients,
            COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
            COALESCE(SUM(ch.product_cost_total) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS product_cost,
            COALESCE(SUM(ch.service_salary_total + COALESCE(ch.product_salary_total, 0)) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS salaries,
            COALESCE(SUM(ch.product_cost_total + ch.service_salary_total + COALESCE(ch.product_salary_total, 0)) FILTER (WHERE ch.payment_method = 'warranty'), 0) AS warranty_loss
       FROM checks ch
      WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${point}`,
    params,
  );
  const r = rows[0] ?? {};
  return {
    checks: num(r.checks),
    clients: num(r.clients),
    revenue: num(r.revenue),
    productCost: num(r.product_cost),
    salaries: num(r.salaries),
    warrantyLoss: num(r.warranty_loss),
  };
}

/**
 * Расходы периода БЕЗ категории «Зарплата», только одобренные, с отнесением
 * по period_month — как reports.getFinancial (otherExpenses).
 */
export async function otherExpensesTotal(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz' | 'pointId'>,
): Promise<number> {
  const params = baseParams(ctx);
  const point = pointFilterSql('e', ctx.pointId, params);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.tenant_id = $1 AND ${expenseMembership('e')}
        AND ${expenseApproved('e')} AND COALESCE(ec.name, '') <> 'Зарплата'${point}`,
    params,
  );
  return num(rows[0]?.total);
}

/**
 * Премии деньгами + мотивация за период — третий вид зарплатного начисления
 * (common/salary-extras-sql.ts). Отнесение к периоду — как в
 * reports.salaryExtrasForPeriod (метод приватный, семантика повторена 1:1).
 */
export async function salaryExtrasTotal(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz' | 'pointId'>,
): Promise<{ premiums: number; motivation: number; total: number }> {
  const premParams = baseParams(ctx);
  const premPoint = pointFilterSql('sp', ctx.pointId, premParams);
  const motParams = baseParams(ctx);
  const motPoint = motivationPointFilterSql('ma', '$1', ctx.pointId, motParams);
  const [{ rows: premRows }, { rows: motRows }] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${premiumCashAmountExpr('sp')}), 0) AS total
         FROM salary_premiums sp
        WHERE sp.tenant_id = $1 AND ${premiumMembership('sp')}${premPoint}`,
      premParams,
    ),
    pool.query(
      `SELECT COALESCE(SUM(ma.amount), 0) AS total
         FROM motivation_accruals ma
        WHERE ma.tenant_id = $1 AND ${inPeriod('ma.accrued_at')}${motPoint}`,
      motParams,
    ),
  ]);
  const premiums = num(premRows[0]?.total);
  const motivation = num(motRows[0]?.total);
  return { premiums, motivation, total: premiums + motivation };
}

/**
 * Выплачено зарплаты за период — принятые выплаты нового flow (salary_payouts,
 * status='accepted') + легаси-выплаты (salary_payments без сторно), по МЕСЯЦУ,
 * «ЗА КОТОРЫЙ» они выданы (правка №3, 2026-09-30): выплата, выданная 3 октября
 * за сентябрь, стоит в сентябре — так же, как на экране «Зарплата» и в отчёте
 * «По зарплатам» (общий helper common/period-membership.ts). Выплата без
 * назначенного месяца (старые строки) — по дате факта. Кассу (ленту «Расходы»,
 * смену, Z-отчёт) это НЕ меняет: там деньги по-прежнему по дате выдачи.
 * Филиал — собственный point_id строки (как в salary.getAll).
 */
export async function salaryPaidTotal(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz' | 'pointId'>,
): Promise<number> {
  const params = baseParams(ctx);
  let payoutPoint = '';
  let legacyPoint = '';
  if (ctx.pointId) {
    params.push(ctx.pointId);
    payoutPoint = ` AND p.point_id = $${params.length}`;
    legacyPoint = ` AND sp.point_id = $${params.length}`;
  }
  const member = (periodCol: string, factCol: string) =>
    effectiveMonthMembershipSql(periodCol, factCol, ctx.dateFrom, ctx.dateTo, TZ_PH);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(x.amount), 0) AS total FROM (
       SELECT p.amount FROM salary_payouts p
        WHERE p.tenant_id = $1 AND p.status = 'accepted' AND ${member('p.period_month', 'p.created_at')}${payoutPoint}
       UNION ALL
       SELECT sp.amount FROM salary_payments sp
        WHERE sp.tenant_id = $1 AND sp.reversed_at IS NULL AND ${member('sp.month_year', 'sp.date')}${legacyPoint}
     ) x`,
    params,
  );
  return num(rows[0]?.total);
}

/**
 * Возвраты клиентам за период — по дате факта возврата (check_returns.created_at),
 * как строка refunds в «Движении денег». Филиал — у чека-источника.
 */
export async function refundsTotal(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'dateFrom' | 'dateTo' | 'tz' | 'pointId'>,
): Promise<{ count: number; amount: number }> {
  const params = baseParams(ctx);
  const point = pointFilterSql('ch', ctx.pointId, params);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(cr.refund_amount), 0) AS total
       FROM check_returns cr
       JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = $1 AND ch.deleted_at IS NULL
      WHERE cr.tenant_id = $1 AND ${inPeriod('cr.created_at')}${point}`,
    params,
  );
  return { count: num(rows[0]?.cnt), amount: num(rows[0]?.total) };
}

/**
 * «Нам должны» на сегодня — открытые долги клиентов (client_debts, только
 * положительные балансы, как DebtsService.debtors) + остатки открытых
 * рассрочек. По всей компании: база клиентов и их долги общие для сети.
 */
export async function clientsOwedTotal(
  pool: Pool,
  tenantId: string,
): Promise<{ debts: number; installments: number; total: number }> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(b.balance), 0) FROM (
          SELECT SUM(CASE WHEN cd.type = 'charge' THEN cd.amount ELSE -cd.amount END) AS balance
            FROM client_debts cd WHERE cd.tenant_id = $1
           GROUP BY cd.client_id
          HAVING SUM(CASE WHEN cd.type = 'charge' THEN cd.amount ELSE -cd.amount END) > 0) b) AS debts,
       (SELECT COALESCE(SUM(remaining), 0) FROM installment_plans WHERE tenant_id = $1 AND status = 'open') AS installments`,
    [tenantId],
  );
  const debts = num(rows[0]?.debts);
  const installments = num(rows[0]?.installments);
  return { debts, installments, total: debts + installments };
}

/**
 * «Мы должны поставщикам» на сегодня — по ЖУРНАЛАМ, а не по suppliers.current_debt:
 * Σ живых поставок − Σ несторнированных платежей (kind 'payment' положителен,
 * 'refund' отрицателен, 'defect_return' положителен — все они двигают долг
 * ровно так, как SuppliersService двигает current_debt). Складываются только
 * положительные сальдо: переплата поставщику долгом не является.
 */
export async function suppliersOwedTotal(pool: Pool, tenantId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(x.balance, 0)), 0) AS total FROM (
       SELECT s.id,
              COALESCE((SELECT SUM(d.total_amount) FROM deliveries d
                         WHERE d.supplier_id = s.id AND d.tenant_id = $1 AND d.deleted_at IS NULL), 0)
            - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp
                         WHERE sp.supplier_id = s.id AND sp.tenant_id = $1 AND sp.reversed_at IS NULL), 0)
            - COALESCE((SELECT SUM(sr.total_amount) FROM supplier_returns sr
                         WHERE sr.supplier_id = s.id AND sr.tenant_id = $1), 0) AS balance
         FROM suppliers s WHERE s.tenant_id = $1) x`,
    [tenantId],
  );
  return num(rows[0]?.total);
}
