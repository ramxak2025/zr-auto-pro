import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow } from '../report-types';
import { avg, baseParams, idsFilter, inPeriod, num, pushPoint, round2 } from '../report-sql';

/**
 * По мастерам.
 *
 * ПРИВЯЗКА ЧЕКА — checks.master_id (решение владельца 2026-07-28: деньги
 * мастера = чеки, где он главный мастер; исполнительство строк — механизм
 * видимости журнала, а не принадлежности денег). Исключение — колонка
 * «начислено ЗП»: она обязана сходиться с отчётом по зарплате, а зарплата за
 * работы начисляется ИСПОЛНИТЕЛЮ строки (COALESCE(sl.master_id, ch.master_id),
 * #56), товарная комиссия — мастеру чека. Поэтому ЗП суммируется из
 * запечённых salary_amount / product_salary_total ровно теми же CTE, что в
 * SalaryService.getAll — формула процента не пересчитывается.
 *
 * Прибыль = выручка − себестоимость товаров (метод из каталога). Гарантийные
 * чеки считаются в «чеках» (визит был), но выручки и себестоимости не дают —
 * их убыток показан в сводном отчёте, иначе сумма по мастерам разошлась бы с
 * валовой прибылью финотчёта.
 */
@Injectable()
export class MastersBuilder implements ReportBuilder {
  readonly id = 'masters' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const params = baseParams(ctx);
    const pointPh = pushPoint(params, ctx.pointId);
    const chPoint = pointPh ? ` AND ch.point_id = ${pointPh}` : '';
    const ids = idsFilter('k.master_id', ctx.ids, params);
    const nonWarranty = `ch.payment_method IS DISTINCT FROM 'warranty'`;

    const { rows } = await this.pool.query(
      `WITH base AS (
         SELECT ch.* FROM checks ch
          WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${chPoint}
       ),
       per AS (
         SELECT ch.master_id,
                COUNT(*)::int AS checks,
                COUNT(DISTINCT ch.client_id)::int AS clients,
                COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
                COALESCE(SUM(ch.service_total) FILTER (WHERE ${nonWarranty}), 0) AS works,
                COALESCE(SUM(ch.product_total) FILTER (WHERE ${nonWarranty}), 0) AS products,
                COALESCE(SUM(LEAST(COALESCE(ch.discount, 0), ch.product_total)) FILTER (WHERE ${nonWarranty}), 0) AS discounts,
                COALESCE(SUM(ch.product_cost_total) FILTER (WHERE ${nonWarranty}), 0) AS product_cost,
                COALESCE(SUM(COALESCE(ch.product_salary_total, 0)), 0) AS product_salary
           FROM base ch
          GROUP BY ch.master_id
       ),
       svc AS (
         SELECT COALESCE(sl.master_id, ch.master_id) AS earner_id,
                COALESCE(SUM(COALESCE(sl.salary_amount, 0)), 0) AS service_salary
           FROM base ch
           JOIN check_service_lines sl ON sl.check_id = ch.id
          GROUP BY COALESCE(sl.master_id, ch.master_id)
       ),
       ret AS (
         SELECT ch.master_id, COUNT(*)::int AS returns_count, COALESCE(SUM(cr.refund_amount), 0) AS returns_amount
           FROM check_returns cr
           JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = $1 AND ch.deleted_at IS NULL
          WHERE cr.tenant_id = $1 AND ${inPeriod('cr.created_at')}${chPoint}
          GROUP BY ch.master_id
       ),
       k AS (
         SELECT master_id FROM per
         UNION SELECT earner_id FROM svc
         UNION SELECT master_id FROM ret
       )
       SELECT k.master_id, COALESCE(u.full_name, 'Без мастера') AS name, u.dismissed_at,
              COALESCE(per.checks, 0) AS checks, COALESCE(per.clients, 0) AS clients,
              COALESCE(per.revenue, 0) AS revenue, COALESCE(per.works, 0) AS works,
              COALESCE(per.products, 0) AS products, COALESCE(per.discounts, 0) AS discounts,
              COALESCE(per.product_cost, 0) AS product_cost,
              COALESCE(per.product_salary, 0) + COALESCE(svc.service_salary, 0) AS salary_accrued,
              COALESCE(ret.returns_count, 0) AS returns_count, COALESCE(ret.returns_amount, 0) AS returns_amount
         FROM k
         LEFT JOIN users u ON u.id = k.master_id AND u.tenant_id = $1
         LEFT JOIN per ON per.master_id IS NOT DISTINCT FROM k.master_id
         LEFT JOIN svc ON svc.earner_id IS NOT DISTINCT FROM k.master_id
         LEFT JOIN ret ON ret.master_id IS NOT DISTINCT FROM k.master_id
        WHERE TRUE${ids}
        ORDER BY revenue DESC, name
        LIMIT ${MAIN_ROW_LIMIT + 1}`,
      params,
    );

    const truncated = rows.length > MAIN_ROW_LIMIT;
    const data = truncated ? rows.slice(0, MAIN_ROW_LIMIT) : rows;

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Мастер', type: 'text' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'clients', title: 'Клиентов', type: 'int' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'works', title: 'Работы', type: 'money' },
      { key: 'products', title: 'Товары', type: 'money', hint: 'До скидки' },
      { key: 'discounts', title: 'Скидки', type: 'money' },
      { key: 'productCost', title: 'Себестоимость товаров', type: 'money' },
      { key: 'profit', title: 'Прибыль', type: 'money', hint: 'Выручка − себестоимость товаров' },
      { key: 'avgCheck', title: 'Средний чек', type: 'money' },
      { key: 'returnsCount', title: 'Возвратов', type: 'int' },
      { key: 'returnsAmount', title: 'Возвраты', type: 'money' },
      {
        key: 'salaryAccrued',
        title: 'Начислено ЗП',
        type: 'money',
        hint: 'Процент с работ (исполнителю строки) и с товаров (мастеру чека)',
      },
    ];

    const totals: ReportRow = {
      name: 'Итого',
      checks: 0,
      clients: 0,
      revenue: 0,
      works: 0,
      products: 0,
      discounts: 0,
      productCost: 0,
      profit: 0,
      avgCheck: 0,
      returnsCount: 0,
      returnsAmount: 0,
      salaryAccrued: 0,
    };
    const add = (key: string, v: number) => {
      totals[key] = round2((totals[key] as number) + v);
    };
    const tableRows: ReportRow[] = data.map((r) => {
      const revenue = num(r.revenue);
      const productCost = num(r.product_cost);
      const checks = num(r.checks);
      const row: ReportRow = {
        _id: r.master_id ?? null,
        name: r.dismissed_at ? `${r.name} (уволен)` : String(r.name),
        checks,
        clients: num(r.clients),
        revenue,
        works: num(r.works),
        products: num(r.products),
        discounts: num(r.discounts),
        productCost,
        profit: round2(revenue - productCost),
        avgCheck: avg(revenue, checks),
        returnsCount: num(r.returns_count),
        returnsAmount: num(r.returns_amount),
        salaryAccrued: round2(num(r.salary_accrued)),
      };
      for (const key of [
        'checks',
        'clients',
        'revenue',
        'works',
        'products',
        'discounts',
        'productCost',
        'profit',
        'returnsCount',
        'returnsAmount',
        'salaryAccrued',
      ]) {
        add(key, row[key] as number);
      }
      return row;
    });
    totals.avgCheck = avg(totals.revenue as number, totals.checks as number);

    return {
      kpis: [
        { key: 'revenue', title: 'Выручка', value: totals.revenue as number, type: 'money' },
        {
          key: 'profit',
          title: 'Прибыль',
          value: totals.profit as number,
          type: 'money',
          hint: 'Выручка − себестоимость товаров',
        },
        { key: 'checks', title: 'Чеков', value: totals.checks as number, type: 'int' },
        { key: 'discounts', title: 'Скидки', value: totals.discounts as number, type: 'money' },
      ],
      columns,
      rows: tableRows,
      totals,
      truncated,
      notes: [
        'Чек относится к мастеру, указанному в чеке. Выручка — без гарантийных чеков, возвраты уже вычтены в периоде продажи.',
        'Скидка в чеке действует на товары: «Товары» показаны до скидки, выручка — после.',
        'Начислено ЗП считается так же, как в отчёте по зарплате: процент с работ — исполнителю строки, с товаров — мастеру чека; премии и мотивация сюда не входят.',
        'Возвраты — по дате оформления возврата в периоде.',
        '«Клиентов» — в скоупе колонки итога уникальность не суммируется: итог складывает строки.',
      ],
    };
  }
}
