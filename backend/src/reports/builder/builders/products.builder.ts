import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere } from '../../../common/check-money-sql';
import { warehousePointFilterSql } from '../../../common/point-scope';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext, SECTION_ROW_LIMIT } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { baseParams, dayKey, inPeriod, localDate, num, pct, pushPoint, round2 } from '../report-sql';

/**
 * По товарам.
 *
 * Продажи — товарные строки проведённых чеков периода: гарантийные чеки не
 * продажа (выручки нет), чек с полным возвратом снят целиком, частичный
 * возврат вычитается построчно из check_return_lines (количество и сумма;
 * себестоимость возвращается только если товар вернулся на склад, а не в
 * брак — как реверс COGS в returns.service). Остаток и склад — по складам
 * филиала сессии (warehouses.point_id — единственный источник филиала товара).
 */
@Injectable()
export class ProductsBuilder implements ReportBuilder {
  readonly id = 'products' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const byCategory = ctx.groupBy === 'category';
    const [sales, stale, writeoffs] = await Promise.all([
      this.sales(ctx, byCategory),
      this.stale(ctx),
      this.writeoffs(ctx),
    ]);

    const columns: ReportColumn[] = byCategory
      ? [
          { key: 'name', title: 'Папка', type: 'text' },
          { key: 'qty', title: 'Продано', type: 'number' },
          { key: 'revenue', title: 'Выручка', type: 'money' },
          { key: 'cost', title: 'Себестоимость', type: 'money' },
          { key: 'profit', title: 'Прибыль', type: 'money' },
          { key: 'markup', title: 'Наценка', type: 'percent', hint: 'Прибыль ÷ себестоимость' },
        ]
      : [
          { key: 'name', title: 'Товар', type: 'text' },
          { key: 'category', title: 'Папка', type: 'text' },
          { key: 'qty', title: 'Продано', type: 'number' },
          { key: 'revenue', title: 'Выручка', type: 'money' },
          { key: 'cost', title: 'Себестоимость', type: 'money' },
          { key: 'profit', title: 'Прибыль', type: 'money' },
          { key: 'markup', title: 'Наценка', type: 'percent', hint: 'Прибыль ÷ себестоимость' },
          { key: 'stock', title: 'Остаток сейчас', type: 'number' },
        ];

    const totals: ReportRow = { name: 'Итого', qty: 0, revenue: 0, cost: 0, profit: 0, markup: 0 };
    if (!byCategory) {
      totals.category = null;
      totals.stock = null;
    }
    for (const r of sales.rows) {
      totals.qty = round2((totals.qty as number) + (r.qty as number));
      totals.revenue = round2((totals.revenue as number) + (r.revenue as number));
      totals.cost = round2((totals.cost as number) + (r.cost as number));
      totals.profit = round2((totals.profit as number) + (r.profit as number));
    }
    totals.markup = pct(totals.profit as number, totals.cost as number);

    return {
      kpis: [
        { key: 'revenue', title: 'Выручка товаров', value: totals.revenue as number, type: 'money' },
        { key: 'profit', title: 'Прибыль', value: totals.profit as number, type: 'money' },
        { key: 'markup', title: 'Средняя наценка', value: totals.markup as number, type: 'percent' },
        {
          key: 'writeoffs',
          title: 'Списано',
          value: writeoffs.writeoffValue,
          type: 'money',
          hint: 'Списания по себестоимости',
        },
        {
          key: 'staleValue',
          title: 'Залежалось на складе',
          value: stale.value,
          type: 'money',
          hint: `${stale.count} товаров без продаж за период, по себестоимости`,
          tone: stale.value > 0 ? 'warning' : 'default',
        },
      ],
      columns,
      rows: sales.rows,
      totals,
      truncated: sales.truncated,
      sections: [stale.section, writeoffs.section],
      filters: { groupBy: byCategory ? 'category' : 'product', groupByLabel: byCategory ? 'По папкам' : 'По товарам' },
      notes: [
        'Продажи — товарные строки проведённых чеков за период без гарантийных; возвраты вычтены (полный — весь чек, частичный — по строкам).',
        'Прибыль = выручка − себестоимость; наценка = прибыль ÷ себестоимость. Скидка чека здесь не распределяется по товарам.',
        `«Залежались» — есть остаток, продаж в периоде не было; дни без продаж считаются до ${ctx.refDate}.`,
        'Списания и брак — из движений склада за период по текущей себестоимости товара.',
      ],
    };
  }

  private async sales(ctx: ReportContext, byCategory: boolean): Promise<{ rows: ReportRow[]; truncated: boolean }> {
    const params = baseParams(ctx);
    const ph = pushPoint(params, ctx.pointId);
    const chPoint = ph ? ` AND ch.point_id = ${ph}` : '';
    const groupKey = byCategory
      ? `COALESCE(NULLIF(p.category, ''), 'Без папки')`
      : `COALESCE(l.product_id::text, 'name:' || lower(l.name))`;
    const { rows } = await this.pool.query(
      `WITH l AS (
         SELECT pl.id AS line_id, pl.product_id, pl.name, pl.quantity, pl.total_sell, pl.total_cost
           FROM checks ch
           JOIN check_product_lines pl ON pl.check_id = ch.id
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}
            AND ch.payment_method IS DISTINCT FROM 'warranty'
            AND NOT (ch.is_returned = true AND ch.return_scope = 'full')${chPoint}
       ),
       ret AS (
         SELECT rl.product_line_id,
                SUM(rl.quantity) AS qty,
                SUM(rl.amount) AS amount,
                SUM(CASE WHEN cr.destination = 'warehouse' THEN rl.quantity ELSE 0 END) AS qty_back
           FROM check_return_lines rl
           JOIN check_returns cr ON cr.id = rl.return_id AND cr.tenant_id = $1
          WHERE rl.product_line_id IN (SELECT line_id FROM l)
          GROUP BY rl.product_line_id
       )
       SELECT ${groupKey} AS key,
              ${byCategory ? `${groupKey}` : `COALESCE(p.name, MIN(l.name))`} AS name,
              ${byCategory ? `NULL::text` : `MIN(p.category)`} AS category,
              ${byCategory ? `NULL::numeric` : `MIN(p.stock)`} AS stock,
              ${byCategory ? `NULL::text` : `MIN(l.product_id::text)`} AS product_id,
              COALESCE(SUM(l.quantity - COALESCE(r.qty, 0)), 0) AS qty,
              COALESCE(SUM(l.total_sell - COALESCE(r.amount, 0)), 0) AS revenue,
              COALESCE(SUM(l.total_cost - CASE WHEN l.quantity > 0 THEN l.total_cost / l.quantity * COALESCE(r.qty_back, 0) ELSE 0 END), 0) AS cost
         FROM l
         LEFT JOIN ret r ON r.product_line_id = l.line_id
         LEFT JOIN products p ON p.id = l.product_id
        GROUP BY ${groupKey}${byCategory ? '' : ', p.name'}
        ORDER BY revenue DESC, name
        LIMIT ${MAIN_ROW_LIMIT + 1}`,
      params,
    );
    // Строка, обнулившаяся возвратом (продали и целиком вернули), — не продажа:
    // не показываем, иначе в отчёте висят товары с нулями.
    const live = rows.filter((r) => num(r.qty) !== 0 || num(r.revenue) !== 0 || num(r.cost) !== 0);
    const truncated = live.length > MAIN_ROW_LIMIT;
    const data = truncated ? live.slice(0, MAIN_ROW_LIMIT) : live;
    return {
      truncated,
      rows: data.map((r) => {
        const revenue = num(r.revenue);
        const cost = num(r.cost);
        const profit = round2(revenue - cost);
        const row: ReportRow = {
          _id: r.product_id ?? null,
          name: String(r.name ?? '—'),
          qty: num(r.qty),
          revenue,
          cost,
          profit,
          markup: pct(profit, cost),
        };
        if (!byCategory) {
          row.category = r.category ?? null;
          row.stock = r.stock === null || r.stock === undefined ? null : num(r.stock);
        }
        return row;
      }),
    };
  }

  private async stale(ctx: ReportContext): Promise<{ count: number; value: number; section: ReportSection }> {
    const params: unknown[] = [ctx.tenantId, ctx.dateFrom, ctx.dateTo, ctx.tz, ctx.refDate];
    const whPoint = warehousePointFilterSql('p', ctx.pointId, params);
    const chPoint = ctx.pointId ? ` AND ch.point_id = $${params.length}` : '';
    const { rows } = await this.pool.query(
      `WITH sold AS (
         SELECT pl.product_id, MAX(ch.date) AS last_sale, BOOL_OR(${inPeriod('ch.date')}) AS sold_in_period
           FROM checks ch
           JOIN check_product_lines pl ON pl.check_id = ch.id
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND pl.product_id IS NOT NULL${chPoint}
          GROUP BY pl.product_id
       )
       SELECT * FROM (
         SELECT p.id, p.name, p.category, p.stock, p.cost_price,
                p.stock * COALESCE(p.cost_price, 0) AS stock_value,
                ${dayKey('s.last_sale')} AS last_sale,
                ($5::date - COALESCE(${localDate('s.last_sale')}, ${localDate('p.created_at')}))::int AS days_idle,
                COUNT(*) OVER () AS total_count,
                SUM(p.stock * COALESCE(p.cost_price, 0)) OVER () AS total_value
           FROM products p
           LEFT JOIN sold s ON s.product_id = p.id
          WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.stock > 0
            AND COALESCE(s.sold_in_period, false) = false
            -- Склад брака — не товар на продажу: его копии товаров сюда не входят.
            AND NOT EXISTS (SELECT 1 FROM warehouses wd WHERE wd.id = p.warehouse_id AND wd.kind = 'defect')${whPoint}
       ) x
       ORDER BY x.stock_value DESC, x.days_idle DESC
       LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      count: rows.length > 0 ? num(rows[0].total_count) : 0,
      value: rows.length > 0 ? round2(num(rows[0].total_value)) : 0,
      section: {
        key: 'stale',
        title: 'Залежались',
        description: 'Есть остаток, продаж в периоде не было.',
        columns: [
          { key: 'name', title: 'Товар', type: 'text' },
          { key: 'stock', title: 'Остаток', type: 'number' },
          { key: 'value', title: 'Стоимость остатка', type: 'money', hint: 'По себестоимости' },
          { key: 'lastSale', title: 'Последняя продажа', type: 'date' },
          { key: 'daysIdle', title: 'Дней без продаж', type: 'int' },
        ],
        rows: rows.map((r) => ({
          _id: r.id,
          name: String(r.name),
          stock: num(r.stock),
          value: round2(num(r.stock_value)),
          lastSale: r.last_sale ? String(r.last_sale) : null,
          daysIdle: num(r.days_idle),
        })),
        emptyText: 'Залежавшихся товаров нет',
      },
    };
  }

  private async writeoffs(ctx: ReportContext): Promise<{ writeoffValue: number; section: ReportSection }> {
    const params = baseParams(ctx);
    const whPoint = warehousePointFilterSql('sm', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT sm.id, ${dayKey('sm.created_at')} AS day, sm.created_at, p.name, sm.quantity, sm.type, sm.reason,
                sm.quantity * COALESCE(p.cost_price, 0) AS amount,
                SUM(CASE WHEN sm.type = 'writeoff' THEN sm.quantity * COALESCE(p.cost_price, 0) ELSE 0 END) OVER () AS writeoff_value
           FROM stock_movements sm
           JOIN products p ON p.id = sm.product_id
          WHERE sm.tenant_id = $1 AND sm.type IN ('writeoff', 'defect_transfer') AND ${inPeriod('sm.created_at')}${whPoint}
       ) x
       ORDER BY x.created_at DESC
       LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      writeoffValue: rows.length > 0 ? round2(num(rows[0].writeoff_value)) : 0,
      section: {
        key: 'writeoffs',
        title: 'Списания и брак',
        columns: [
          { key: 'date', title: 'Дата', type: 'date' },
          { key: 'name', title: 'Товар', type: 'text' },
          { key: 'qty', title: 'Кол-во', type: 'number' },
          { key: 'amount', title: 'Сумма', type: 'money', hint: 'По себестоимости' },
          { key: 'kind', title: 'Тип', type: 'text' },
          { key: 'reason', title: 'Причина', type: 'text' },
        ],
        rows: rows.map((r) => ({
          _id: r.id,
          date: String(r.day),
          name: String(r.name),
          qty: num(r.quantity),
          amount: round2(num(r.amount)),
          kind: r.type === 'writeoff' ? 'Списание' : 'Брак',
          reason: r.reason ?? null,
        })),
        emptyText: 'За период списаний и брака не было',
      },
    };
  }
}
