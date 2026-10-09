import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { BuiltReport, MAIN_ROW_LIMIT, SECTION_ROW_LIMIT, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow, ReportSection, ReportKpi } from '../report-types';
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

    const priceIncreases = await this.priceIncreases(ctx);
    return {
      sections: priceIncreases.sections,
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
        ...priceIncreases.kpis,
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
        'Повышения цен относятся к автору последнего изменения цены, а не к исполнителю. Считаются по дате чека, без черновиков, гарантий и полностью возвращённых услуг; частичный возврат уменьшает количество для суммы превышения. Строки без исторического снимка не сравниваются с сегодняшним каталогом.',
        '«Клиентов» — в скоупе колонки итога уникальность не суммируется: итог складывает строки.',
      ],
    };
  }

  private async priceIncreases(ctx: ReportContext): Promise<{ sections: ReportSection[]; kpis: ReportKpi[] }> {
    const params = baseParams(ctx);
    const point = pushPoint(params, ctx.pointId);
    const selectedActors = idsFilter('sl.price_changed_by', ctx.ids, params);
    const { rows } = await this.pool.query(
      `WITH base AS (
         SELECT sl.*, ch.date, ch.number, ch.master_id AS check_master_id
           FROM checks ch JOIN check_service_lines sl ON sl.check_id=ch.id
          WHERE ch.tenant_id=$1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}
            AND ch.payment_method IS DISTINCT FROM 'warranty'
            AND NOT (ch.is_returned=true AND ch.return_scope='full')
            AND sl.price_snapshot_status='catalog' AND sl.price_excess>0
            ${point ? `AND ch.point_id=${point}` : ''}${selectedActors}
       ), returned AS (
         SELECT rl.service_line_id, SUM(rl.quantity) AS quantity
           FROM check_return_lines rl JOIN check_returns cr ON cr.id=rl.return_id AND cr.tenant_id=$1
          WHERE rl.service_line_id IN (SELECT id FROM base)
          GROUP BY rl.service_line_id
       ), priced AS (
         SELECT b.*, GREATEST(0, COALESCE(NULLIF(b.quantity,0),1)-COALESCE(r.quantity,0)) AS remaining_quantity
           FROM base b LEFT JOIN returned r ON r.service_line_id=b.id
       ), increased AS (
         SELECT p.*, GREATEST(0, ROUND((price-price_threshold)*remaining_quantity,2)) AS excess
           FROM priced p WHERE remaining_quantity>0
       )
       SELECT (SELECT COUNT(*)::int FROM increased WHERE excess>0) AS lines_count,
              (SELECT COUNT(DISTINCT check_id)::int FROM increased WHERE excess>0) AS checks_count,
              (SELECT COALESCE(SUM(excess),0) FROM increased) AS excess_total,
              COALESCE((SELECT json_agg(a) FROM (
                SELECT i.price_changed_by AS actor_id, COALESCE(u.full_name,'Автор неизвестен') AS actor_name,
                       COUNT(*)::int AS lines_count, COUNT(DISTINCT i.check_id)::int AS checks_count,
                       SUM(i.excess) AS excess_total
                  FROM increased i LEFT JOIN users u ON u.id=i.price_changed_by AND u.tenant_id=$1
                 WHERE i.excess>0 GROUP BY i.price_changed_by,u.full_name
                 ORDER BY excess_total DESC,actor_name LIMIT ${SECTION_ROW_LIMIT + 1}
              ) a),'[]'::json) AS actors,
              COALESCE((SELECT json_agg(d) FROM (
                SELECT i.id,i.check_id,i.number,i.date,i.name,i.price_threshold,i.price,
                       i.catalog_price_type,i.remaining_quantity,i.excess,i.price_changed_at,
                       COALESCE(u.full_name,'Автор неизвестен') AS actor_name,
                       COALESCE(m.full_name,'Исполнитель неизвестен') AS executor_name
                  FROM increased i
                  LEFT JOIN users u ON u.id=i.price_changed_by AND u.tenant_id=$1
                  LEFT JOIN users m ON m.id=COALESCE(i.master_id,i.check_master_id) AND m.tenant_id=$1
                 WHERE i.excess>0 ORDER BY i.date DESC,i.check_id,i.id LIMIT ${SECTION_ROW_LIMIT + 1}
              ) d),'[]'::json) AS details`,
      params,
    );
    const row = rows[0];
    const count = num(row?.lines_count),
      checks = num(row?.checks_count),
      excess = num(row?.excess_total);
    const actors: Array<Record<string, unknown>> = row?.actors ?? [];
    const details: Array<Record<string, unknown>> = row?.details ?? [];
    const columns: ReportColumn[] = [
      { key: 'name', title: 'Изменил цену', type: 'text' },
      { key: 'increasedServiceLinesCount', title: 'Услуг с повышением', type: 'int' },
      { key: 'increasedChecksCount', title: 'Чеков с повышением', type: 'int' },
      { key: 'servicePriceExcessTotal', title: 'Сумма превышения', type: 'money' },
    ];
    return {
      kpis: [
        { key: 'increasedServiceLinesCount', title: 'Услуг с повышением', value: count, type: 'int' },
        { key: 'increasedChecksCount', title: 'Чеков с повышением', value: checks, type: 'int' },
        { key: 'servicePriceExcessTotal', title: 'Превышение цен', value: excess, type: 'money' },
      ],
      sections: [
        {
          key: 'servicePriceIncreases',
          title: 'Повышения цен услуг по сотрудникам',
          columns,
          description: 'Автор последнего изменения цены. Итог по чекам считает каждый чек один раз.',
          rows: actors.slice(0, SECTION_ROW_LIMIT).map((a) => ({
            _id: a.actor_id == null ? null : String(a.actor_id),
            name: String(a.actor_name),
            increasedServiceLinesCount: num(a.lines_count),
            increasedChecksCount: num(a.checks_count),
            servicePriceExcessTotal: num(a.excess_total),
          })),
          totals: {
            name: 'Итого',
            increasedServiceLinesCount: count,
            increasedChecksCount: checks,
            servicePriceExcessTotal: excess,
          },
          truncated: actors.length > SECTION_ROW_LIMIT,
          emptyText: 'Повышений цен за период нет',
        },
        {
          key: 'servicePriceIncreaseDetails',
          title: 'Услуги с повышенной ценой',
          description:
            'Порог — сохранённая фиксированная цена или верхняя граница диапазона. Возвраты учтены в оставшемся количестве.',
          columns: [
            { key: 'date', title: 'Дата чека', type: 'datetime' },
            { key: 'checkNumber', title: 'Чек', type: 'int' },
            { key: 'service', title: 'Услуга', type: 'text' },
            { key: 'actor', title: 'Изменил цену', type: 'text' },
            { key: 'executor', title: 'Исполнитель', type: 'text' },
            { key: 'priceThreshold', title: 'Порог цены', type: 'money' },
            { key: 'price', title: 'Цена в чеке', type: 'money' },
            { key: 'quantity', title: 'Количество после возвратов', type: 'number' },
            { key: 'priceExcess', title: 'Превышение', type: 'money' },
            { key: 'priceChangedAt', title: 'Цена изменена', type: 'datetime' },
          ],
          rows: details.slice(0, SECTION_ROW_LIMIT).map((d) => ({
            _id: String(d.id),
            _href: `/checks/${d.check_id}`,
            date: String(d.date),
            checkNumber: num(d.number),
            service: String(d.name),
            actor: String(d.actor_name),
            executor: String(d.executor_name),
            priceThreshold: num(d.price_threshold),
            price: num(d.price),
            quantity: num(d.remaining_quantity),
            priceExcess: num(d.excess),
            priceChangedAt: d.price_changed_at == null ? null : String(d.price_changed_at),
          })),
          truncated: details.length > SECTION_ROW_LIMIT,
          emptyText: 'Повышений цен за период нет',
        },
      ],
    };
  }
}
