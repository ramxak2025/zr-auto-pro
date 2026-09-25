import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { premiumCashAmountExpr } from '../../../common/salary-extras-sql';
import { BuiltReport, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow } from '../report-types';
import {
  avg,
  baseParams,
  expenseApproved,
  expenseMembership,
  idsFilter,
  inPeriod,
  num,
  premiumMembership,
  round2,
} from '../report-sql';

/**
 * По филиалам — единственный отчёт, который группирует по point_id поверх
 * всего тенанта (филиал сессии игнорируется сознательно). Каждая колонка —
 * та же величина, что в сводном отчёте этого филиала: выручка / себестоимость
 * по чекам точки, расходы точки (без «Зарплаты», по отнесению к месяцу),
 * зарплата начислено = чековые начисления + премии деньгами (по point_id
 * премии) + мотивация (по филиалу чека), убыток по гарантии. Прибыль после
 * расходов = валовая − расходы − ЗП начислено − гарантия — netProfit финотчёта
 * филиала. Долги не делятся по точкам (клиенты и поставщики общие).
 *
 * Архивные филиалы показываются, только если в периоде у них есть цифры —
 * иначе деньги закрытой точки пропали бы из сравнения (как в points.summary).
 */
@Injectable()
export class PointsBuilder implements ReportBuilder {
  readonly id = 'points' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const pParams = baseParams(ctx);
    const pIds = idsFilter('p.id', ctx.ids, pParams);
    const eParams = baseParams(ctx);
    const eIds = idsFilter('e.point_id', ctx.ids, eParams);
    const prParams = baseParams(ctx);
    const prIds = idsFilter('sp.point_id', ctx.ids, prParams);
    const mParams = baseParams(ctx);
    const mIds = idsFilter('mch.point_id', ctx.ids, mParams);

    const [{ rows: pRows }, { rows: eRows }, { rows: prRows }, { rows: mRows }] = await Promise.all([
      this.pool.query(
        `SELECT p.id, p.name, p.is_main, p.is_active,
                COUNT(ch.id)::int AS checks,
                COUNT(DISTINCT ch.client_id)::int AS clients,
                COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
                COALESCE(SUM(ch.product_cost_total) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS product_cost,
                COALESCE(SUM(ch.service_salary_total + COALESCE(ch.product_salary_total, 0)) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS salaries,
                COALESCE(SUM(ch.product_cost_total + ch.service_salary_total + COALESCE(ch.product_salary_total, 0)) FILTER (WHERE ch.payment_method = 'warranty'), 0) AS warranty_loss
           FROM tenant_points p
           LEFT JOIN checks ch ON ch.point_id = p.id AND ch.tenant_id = p.tenant_id
                              AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}
          WHERE p.tenant_id = $1${pIds}
          GROUP BY p.id, p.name, p.is_main, p.is_active, p.sort_order
          ORDER BY p.is_active DESC, p.is_main DESC, p.sort_order ASC, lower(p.name) ASC`,
        pParams,
      ),
      this.pool.query(
        `SELECT e.point_id, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
          WHERE e.tenant_id = $1 AND e.point_id IS NOT NULL AND ${expenseMembership('e')}
            AND ${expenseApproved('e')} AND COALESCE(ec.name, '') <> 'Зарплата'${eIds}
          GROUP BY e.point_id`,
        eParams,
      ),
      this.pool.query(
        `SELECT sp.point_id, COALESCE(SUM(${premiumCashAmountExpr('sp')}), 0) AS total
           FROM salary_premiums sp
          WHERE sp.tenant_id = $1 AND sp.point_id IS NOT NULL AND ${premiumMembership('sp')}${prIds}
          GROUP BY sp.point_id`,
        prParams,
      ),
      this.pool.query(
        `SELECT mch.point_id, COALESCE(SUM(ma.amount), 0) AS total
           FROM motivation_accruals ma
           JOIN checks mch ON mch.id = ma.check_id AND mch.tenant_id = ma.tenant_id
          WHERE ma.tenant_id = $1 AND mch.point_id IS NOT NULL AND ${inPeriod('ma.accrued_at')}${mIds}
          GROUP BY mch.point_id`,
        mParams,
      ),
    ]);

    const expenseByPoint = new Map<string, number>();
    for (const r of eRows) expenseByPoint.set(String(r.point_id), num(r.total));
    const extrasByPoint = new Map<string, number>();
    for (const r of [...prRows, ...mRows]) {
      const id = String(r.point_id);
      extrasByPoint.set(id, (extrasByPoint.get(id) ?? 0) + num(r.total));
    }

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Филиал', type: 'text' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'clients', title: 'Клиентов', type: 'int' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'profit', title: 'Прибыль', type: 'money', hint: 'Выручка − себестоимость товаров' },
      { key: 'expenses', title: 'Расходы', type: 'money', hint: 'Без зарплаты' },
      { key: 'salary', title: 'Зарплата начислено', type: 'money', hint: 'По чекам + премии деньгами + мотивация' },
      { key: 'avgCheck', title: 'Средний чек', type: 'money' },
      {
        key: 'netProfit',
        title: 'Прибыль после расходов',
        type: 'money',
        signed: true,
        hint: 'Прибыль − расходы − зарплата − убыток по гарантии',
      },
    ];
    const totals: ReportRow = {
      name: 'Итого',
      checks: 0,
      clients: 0,
      revenue: 0,
      profit: 0,
      expenses: 0,
      salary: 0,
      avgCheck: 0,
      netProfit: 0,
    };
    const rows: ReportRow[] = [];
    let bestRevenue: { name: string; value: number } | null = null;
    let bestAvg: { name: string; value: number } | null = null;
    for (const r of pRows) {
      const id = String(r.id);
      const checks = num(r.checks);
      const revenue = num(r.revenue);
      const profit = round2(revenue - num(r.product_cost));
      const expenses = round2(expenseByPoint.get(id) ?? 0);
      const salary = round2(num(r.salaries) + (extrasByPoint.get(id) ?? 0));
      const warrantyLoss = num(r.warranty_loss);
      const netProfit = round2(profit - expenses - salary - warrantyLoss);
      const isArchived = r.is_active !== true;
      const empty = checks === 0 && revenue === 0 && expenses === 0 && salary === 0 && netProfit === 0;
      if (isArchived && empty) continue;
      const name = `${r.name}${r.is_main ? ' (основной)' : ''}${isArchived ? ' — закрыт' : ''}`;
      const row: ReportRow = {
        _id: id,
        _tone: netProfit < 0 ? 'negative' : 'default',
        name,
        checks,
        clients: num(r.clients),
        revenue,
        profit,
        expenses,
        salary,
        avgCheck: avg(revenue, checks),
        netProfit,
      };
      rows.push(row);
      for (const key of ['checks', 'clients', 'revenue', 'profit', 'expenses', 'salary', 'netProfit']) {
        totals[key] = round2((totals[key] as number) + (row[key] as number));
      }
      if (!bestRevenue || revenue > bestRevenue.value) bestRevenue = { name: String(r.name), value: revenue };
      const a = avg(revenue, checks);
      if (checks > 0 && (!bestAvg || a > bestAvg.value)) bestAvg = { name: String(r.name), value: a };
    }
    totals.avgCheck = avg(totals.revenue as number, totals.checks as number);

    return {
      kpis: [
        { key: 'revenue', title: 'Выручка сети', value: totals.revenue as number, type: 'money' },
        {
          key: 'bestRevenue',
          title: 'Лучший по выручке',
          value: bestRevenue && bestRevenue.value > 0 ? bestRevenue.name : null,
          type: 'text',
          hint: bestRevenue ? `${bestRevenue.value.toLocaleString('ru-RU')} ₽` : undefined,
        },
        {
          key: 'bestAvgCheck',
          title: 'Лучший по среднему чеку',
          value: bestAvg ? bestAvg.name : null,
          type: 'text',
          hint: bestAvg ? `${bestAvg.value.toLocaleString('ru-RU')} ₽` : undefined,
        },
        {
          key: 'netProfit',
          title: 'Прибыль после расходов',
          value: totals.netProfit as number,
          type: 'money',
          tone: (totals.netProfit as number) < 0 ? 'negative' : 'positive',
        },
      ],
      columns,
      rows,
      totals,
      notes: [
        'Каждый филиал считается по своим чекам, расходам и начислениям за период — те же формулы, что в сводном отчёте филиала.',
        'Прибыль = выручка − себестоимость товаров; после расходов — минус расходы без зарплаты, зарплата начислено и убыток по гарантии.',
        'Клиенты и поставщики общие для сети, поэтому долги здесь не делятся по точкам. Закрытые филиалы показаны, если в периоде у них были цифры.',
      ],
    };
  }
}
