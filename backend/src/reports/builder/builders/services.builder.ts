import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere } from '../../../common/check-money-sql';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow } from '../report-types';
import { avg, baseParams, inPeriod, num, pct, round2 } from '../report-sql';

/**
 * По услугам — строки услуг проведённых чеков периода (без гарантийных чеков;
 * полный возврат снимает чек, частичный вычитается по строкам возврата).
 * Группировка — по услуге справочника, для «свободных» строк — по названию.
 * «Мастеров выполняло» — исполнитель строки (COALESCE(sl.master_id, ch.master_id)).
 */
@Injectable()
export class ServicesBuilder implements ReportBuilder {
  readonly id = 'services' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `WITH l AS (
         SELECT sl.id AS line_id, sl.service_id, sl.name, sl.quantity, sl.total, ch.id AS check_id,
                COALESCE(sl.master_id, ch.master_id) AS master_id
           FROM checks ch
           JOIN check_service_lines sl ON sl.check_id = ch.id
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}
            AND ch.payment_method IS DISTINCT FROM 'warranty'
            AND NOT (ch.is_returned = true AND ch.return_scope = 'full')${point}
       ),
       ret AS (
         SELECT rl.service_line_id, SUM(rl.quantity) AS qty, SUM(rl.amount) AS amount
           FROM check_return_lines rl
           JOIN check_returns cr ON cr.id = rl.return_id AND cr.tenant_id = $1
          WHERE rl.service_line_id IN (SELECT line_id FROM l)
          GROUP BY rl.service_line_id
       )
       SELECT COALESCE(l.service_id::text, 'name:' || lower(l.name)) AS key,
              COALESCE(s.name, MIN(l.name)) AS name,
              MIN(l.service_id::text) AS service_id,
              COALESCE(SUM(l.quantity - COALESCE(r.qty, 0)), 0) AS qty,
              COALESCE(SUM(l.total - COALESCE(r.amount, 0)), 0) AS revenue,
              COUNT(DISTINCT l.check_id)::int AS checks,
              COUNT(DISTINCT l.master_id)::int AS masters,
              COALESCE(SUM(SUM(l.quantity - COALESCE(r.qty, 0))) OVER (), 0) AS total_qty,
              COALESCE(SUM(SUM(l.total - COALESCE(r.amount, 0))) OVER (), 0) AS total_revenue,
              (SUM(COUNT(DISTINCT l.check_id)) OVER ())::int AS total_checks,
              (COUNT(*) OVER ())::int AS total_groups
         FROM l
         LEFT JOIN ret r ON r.service_line_id = l.line_id
         LEFT JOIN services s ON s.id = l.service_id
        GROUP BY COALESCE(l.service_id::text, 'name:' || lower(l.name)), s.name
        ORDER BY revenue DESC, name
        LIMIT ${MAIN_ROW_LIMIT + 1}`,
      params,
    );
    const truncated = rows.length > MAIN_ROW_LIMIT;
    const data = truncated ? rows.slice(0, MAIN_ROW_LIMIT) : rows;

    // Итоги — оконные агрегаты по ВСЕМ группам периода (окно считается до
    // LIMIT), а не сумма усечённых строк: доли сходятся в 100 %, KPI и «Итого»
    // не худеют, когда услуг больше MAIN_ROW_LIMIT. Пустой результат — нули.
    const first = rows[0];
    const totalRevenue = round2(num(first?.total_revenue));
    const totalQty = round2(num(first?.total_qty));
    const totalChecks = num(first?.total_checks);
    const totalGroups = num(first?.total_groups);

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Услуга', type: 'text' },
      { key: 'qty', title: 'Количество', type: 'number' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'avgPrice', title: 'Средняя цена', type: 'money' },
      { key: 'share', title: 'Доля', type: 'percent', hint: 'От выручки по всем работам периода' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'masters', title: 'Мастеров выполняло', type: 'int' },
    ];
    const tableRows: ReportRow[] = data.map((r) => {
      const revenue = num(r.revenue);
      const qty = num(r.qty);
      return {
        _id: r.service_id ?? null,
        name: String(r.name ?? '—'),
        qty,
        revenue,
        avgPrice: avg(revenue, qty),
        share: pct(revenue, totalRevenue),
        checks: num(r.checks),
        masters: num(r.masters),
      };
    });
    const totals: ReportRow = {
      name: 'Итого',
      qty: totalQty,
      revenue: totalRevenue,
      avgPrice: avg(totalRevenue, totalQty),
      share: totalRevenue > 0 ? 100 : 0,
      checks: totalChecks,
      masters: null,
    };

    return {
      kpis: [
        { key: 'revenue', title: 'Выручка по работам', value: totalRevenue, type: 'money' },
        { key: 'qty', title: 'Работ выполнено', value: totalQty, type: 'number' },
        { key: 'distinct', title: 'Разных услуг', value: totalGroups, type: 'int' },
        { key: 'avgPrice', title: 'Средняя цена', value: avg(totalRevenue, totalQty), type: 'money' },
      ],
      columns,
      rows: tableRows,
      totals,
      truncated,
      notes: [
        'Строки услуг проведённых чеков за период; гарантийные чеки не входят, возвраты вычтены.',
        'Доля — от выручки по всем работам периода; средняя цена = выручка ÷ количество.',
        '«Чеков» в итоге складывает строки — один чек с двумя услугами учтён дважды.',
      ],
    };
  }
}
