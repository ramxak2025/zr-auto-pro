import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext, SECTION_ROW_LIMIT } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { avg, baseParams, dayKey, inPeriod, localDate, num, round2 } from '../report-sql';

/** «Давно не приезжали» — последний визит раньше, чем N дней до опорной даты. */
const LOST_AFTER_DAYS = 90;

/**
 * По клиентам.
 *
 * Новый = первый проведённый чек клиента (по всей компании) попал в период;
 * повторный — чеки были и раньше. Визиты и выручка периода — чеки филиала
 * сессии (деньги режутся точкой), а сама база клиентов, «давно не были» и
 * долги — по всей сети: клиент, обслуженный в соседнем филиале, не потерян,
 * а его долг — долг перед компанией. Розничный покупатель (clients.is_retail)
 * — технический контрагент, в отчёт не входит.
 */
@Injectable()
export class ClientsBuilder implements ReportBuilder {
  readonly id = 'clients' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const [kpi, top, lost, debtors] = await Promise.all([
      this.kpis(ctx),
      this.topClients(ctx),
      this.lostClients(ctx),
      this.debtors(ctx),
    ]);

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Клиент', type: 'text' },
      { key: 'phone', title: 'Телефон', type: 'text' },
      { key: 'visits', title: 'Визитов', type: 'int' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'lastVisit', title: 'Последний визит', type: 'date' },
    ];

    return {
      kpis: [
        { key: 'served', title: 'Обслужено клиентов', value: kpi.served, type: 'int' },
        { key: 'new', title: 'Новых', value: kpi.newClients, type: 'int', hint: 'Первый чек — в этом периоде' },
        { key: 'returning', title: 'Повторных', value: kpi.returning, type: 'int' },
        { key: 'newRevenue', title: 'Выручка от новых', value: kpi.newRevenue, type: 'money' },
        { key: 'returningRevenue', title: 'Выручка от повторных', value: kpi.returningRevenue, type: 'money' },
        { key: 'avgCheck', title: 'Средний чек', value: avg(kpi.revenue, kpi.checks), type: 'money' },
        {
          key: 'lost',
          title: 'Давно не приезжали',
          value: lost.count,
          type: 'int',
          hint: `Последний визит раньше, чем ${LOST_AFTER_DAYS} дней до ${ctx.refDate}`,
          tone: lost.count > 0 ? 'warning' : 'default',
        },
        {
          key: 'debt',
          title: 'Долг клиентов',
          value: debtors.total,
          type: 'money',
          hint: 'Открытые долги + остаток рассрочек',
        },
      ],
      columns,
      rows: top.rows,
      truncated: top.truncated,
      sections: [lost.section, debtors.section],
      notes: [
        'Новый — первый проведённый чек клиента попал в период; повторный — чеки были и до периода. Розничный покупатель не считается.',
        `«Давно не приезжали» — последний визит раньше, чем ${LOST_AFTER_DAYS} дней до конца периода (или до сегодня), по всей компании.`,
        'Долги — открытые долги и остатки рассрочек на сегодня, по всей компании; «просрочено» — остаток по рассрочкам с пропущенной датой платежа.',
      ],
    };
  }

  private async kpis(ctx: ReportContext) {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `WITH pc AS (
         SELECT ch.client_id, ${checkRevenueExpr('ch')} AS revenue
           FROM checks ch
           JOIN clients c ON c.id = ch.client_id AND c.tenant_id = ch.tenant_id AND COALESCE(c.is_retail, false) = false
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}${point}
       ),
       firsts AS (
         SELECT ch.client_id, MIN(ch.date) AS first_date
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ch.client_id IN (SELECT client_id FROM pc)
          GROUP BY ch.client_id
       )
       SELECT COUNT(DISTINCT pc.client_id)::int AS served,
              COUNT(*)::int AS checks,
              COALESCE(SUM(pc.revenue), 0) AS revenue,
              COUNT(DISTINCT pc.client_id) FILTER (WHERE ${inPeriod('f.first_date')})::int AS new_clients,
              COUNT(DISTINCT pc.client_id) FILTER (WHERE NOT (${inPeriod('f.first_date')}))::int AS returning_clients,
              COALESCE(SUM(pc.revenue) FILTER (WHERE ${inPeriod('f.first_date')}), 0) AS new_revenue,
              COALESCE(SUM(pc.revenue) FILTER (WHERE NOT (${inPeriod('f.first_date')})), 0) AS returning_revenue
         FROM pc
         JOIN firsts f ON f.client_id = pc.client_id`,
      params,
    );
    const r = rows[0] ?? {};
    return {
      served: num(r.served),
      checks: num(r.checks),
      revenue: num(r.revenue),
      newClients: num(r.new_clients),
      returning: num(r.returning_clients),
      newRevenue: num(r.new_revenue),
      returningRevenue: num(r.returning_revenue),
    };
  }

  private async topClients(ctx: ReportContext): Promise<{ rows: ReportRow[]; truncated: boolean }> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.full_name, c.phone,
              COUNT(*)::int AS visits,
              COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
              ${dayKey('MAX(ch.date)')} AS last_visit
         FROM checks ch
         JOIN clients c ON c.id = ch.client_id AND c.tenant_id = ch.tenant_id AND COALESCE(c.is_retail, false) = false
        WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}${point}
        GROUP BY c.id, c.full_name, c.phone
        ORDER BY revenue DESC, visits DESC, c.full_name
        LIMIT ${MAIN_ROW_LIMIT + 1}`,
      params,
    );
    const truncated = rows.length > MAIN_ROW_LIMIT;
    const data = truncated ? rows.slice(0, MAIN_ROW_LIMIT) : rows;
    return {
      truncated,
      rows: data.map((r) => ({
        _id: r.id,
        _href: `/clients/${r.id}`,
        name: String(r.full_name ?? '—'),
        phone: r.phone ?? null,
        visits: num(r.visits),
        revenue: num(r.revenue),
        lastVisit: String(r.last_visit),
      })),
    };
  }

  private async lostClients(ctx: ReportContext): Promise<{ count: number; section: ReportSection }> {
    // Период здесь не участвует (последний визит — за всё время), поэтому
    // параметры свои: $1 tenant, $2 пояс, $3 опорная дата. Неиспользованный
    // плейсхолдер Postgres отвергает («could not determine data type»).
    const params = [ctx.tenantId, ctx.tz, ctx.refDate];
    const lastLocal = `(MAX(ch.date) AT TIME ZONE $2::text)::date`;
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT c.id, c.full_name, c.phone,
                to_char(${lastLocal}, 'YYYY-MM-DD') AS last_visit,
                ($3::date - ${lastLocal})::int AS days_ago,
                COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS lifetime_revenue,
                COUNT(*) OVER () AS total_count
           FROM clients c
           JOIN checks ch ON ch.client_id = c.id AND ch.tenant_id = c.tenant_id AND ${checkMoneyBaseWhere('ch')}
          WHERE c.tenant_id = $1 AND COALESCE(c.is_retail, false) = false
          GROUP BY c.id, c.full_name, c.phone
         HAVING ${lastLocal} < ($3::date - ${LOST_AFTER_DAYS})
       ) x
       ORDER BY x.lifetime_revenue DESC, x.days_ago DESC
       LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      count: rows.length > 0 ? num(rows[0].total_count) : 0,
      section: {
        key: 'lost',
        title: 'Давно не приезжали',
        description: `Последний визит больше ${LOST_AFTER_DAYS} дней назад — по всей компании, отсортировано по выручке за всё время.`,
        columns: [
          { key: 'name', title: 'Клиент', type: 'text' },
          { key: 'phone', title: 'Телефон', type: 'text' },
          { key: 'lastVisit', title: 'Последний визит', type: 'date' },
          { key: 'daysAgo', title: 'Дней назад', type: 'int' },
          { key: 'lifetimeRevenue', title: 'Выручка за всё время', type: 'money' },
        ],
        rows: rows.map((r) => ({
          _id: r.id,
          _href: `/clients/${r.id}`,
          name: String(r.full_name ?? '—'),
          phone: r.phone ?? null,
          lastVisit: String(r.last_visit),
          daysAgo: num(r.days_ago),
          lifetimeRevenue: num(r.lifetime_revenue),
        })),
        emptyText: 'Таких клиентов нет',
      },
    };
  }

  private async debtors(ctx: ReportContext): Promise<{ total: number; section: ReportSection }> {
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT c.id, c.full_name, c.phone,
                COALESCE(d.balance, 0) AS debt,
                COALESCE(i.remaining, 0) AS installments,
                COALESCE(i.overdue, 0) AS overdue,
                SUM(COALESCE(d.balance, 0) + COALESCE(i.remaining, 0)) OVER () AS total_debt
           FROM clients c
           LEFT JOIN (
             SELECT cd.client_id, SUM(CASE WHEN cd.type = 'charge' THEN cd.amount ELSE -cd.amount END) AS balance
               FROM client_debts cd WHERE cd.tenant_id = $1 GROUP BY cd.client_id
           ) d ON d.client_id = c.id
           LEFT JOIN (
             SELECT p.client_id, SUM(p.remaining) AS remaining,
                    SUM(CASE WHEN p.next_payment_date IS NOT NULL AND p.next_payment_date < (now() AT TIME ZONE $2::text)::date
                             THEN p.remaining ELSE 0 END) AS overdue
               FROM installment_plans p WHERE p.tenant_id = $1 AND p.status = 'open' GROUP BY p.client_id
           ) i ON i.client_id = c.id
          WHERE c.tenant_id = $1 AND (COALESCE(d.balance, 0) > 0 OR COALESCE(i.remaining, 0) > 0)
       ) x
       ORDER BY (x.debt + x.installments) DESC
       LIMIT ${SECTION_ROW_LIMIT}`,
      [ctx.tenantId, ctx.tz],
    );
    return {
      total: rows.length > 0 ? round2(num(rows[0].total_debt)) : 0,
      section: {
        key: 'debtors',
        title: 'Должники',
        description: 'Открытые долги и остатки рассрочек на сегодня.',
        columns: [
          { key: 'name', title: 'Клиент', type: 'text' },
          { key: 'phone', title: 'Телефон', type: 'text' },
          { key: 'debt', title: 'Долг', type: 'money', hint: 'Долги + остаток рассрочек' },
          { key: 'overdue', title: 'Просрочено по рассрочке', type: 'money' },
        ],
        rows: rows.map((r) => ({
          _id: r.id,
          _href: `/clients/${r.id}`,
          _tone: num(r.overdue) > 0 ? 'negative' : 'default',
          name: String(r.full_name ?? '—'),
          phone: r.phone ?? null,
          debt: round2(num(r.debt) + num(r.installments)),
          overdue: num(r.overdue),
        })),
        emptyText: 'Должников нет',
      },
    };
  }
}
