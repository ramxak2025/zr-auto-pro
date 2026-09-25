import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import {
  baseParams,
  dayKey,
  deltaPct,
  eachDay,
  eachWeek,
  expenseApproved,
  expenseBucketDay,
  expenseMembership,
  inPeriod,
  mondayOf,
  num,
  pct,
  previousPeriod,
  round2,
  weekLabel,
} from '../report-sql';
import {
  checkAggregate,
  clientsOwedTotal,
  otherExpensesTotal,
  refundsTotal,
  salaryExtrasTotal,
  salaryPaidTotal,
  suppliersOwedTotal,
} from '../report-shared-queries';

/**
 * Сводный отчёт — главные цифры периода на одном листе.
 *
 * ACCEPTANCE: за календарный месяц KPI выручка / себестоимость / валовая /
 * расходы / зарплата начислено / прибыль после расходов / чеков ОБЯЗАНЫ
 * совпасть с /reports/financial (revenue / productCost / grossProfit /
 * otherExpenses / salaries+premiums+motivation / netProfit / checkCount).
 * Это достигается не похожими формулами, а теми же: checkAggregate,
 * otherExpensesTotal и salaryExtrasTotal повторяют состав строк getFinancial,
 * а «прибыль после расходов» = валовая − ЗП начислено − расходы − убыток по
 * гарантии — ровно netProfit финотчёта.
 */
@Injectable()
export class SummaryBuilder implements ReportBuilder {
  readonly id = 'summary' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const prev = previousPeriod(ctx.dateFrom, ctx.dateTo);
    const prevCtx = { ...ctx, dateFrom: prev.from, dateTo: prev.to };

    const [cur, before, expenses, extras, paid, refunds, newClients, owed, supplierDebt] = await Promise.all([
      checkAggregate(this.pool, ctx),
      checkAggregate(this.pool, prevCtx),
      otherExpensesTotal(this.pool, ctx),
      salaryExtrasTotal(this.pool, ctx),
      salaryPaidTotal(this.pool, ctx),
      refundsTotal(this.pool, ctx),
      this.newClients(ctx),
      clientsOwedTotal(this.pool, ctx.tenantId),
      suppliersOwedTotal(this.pool, ctx.tenantId),
    ]);

    const grossProfit = round2(cur.revenue - cur.productCost);
    const prevGross = round2(before.revenue - before.productCost);
    const salaryAccrued = round2(cur.salaries + extras.total);
    const netProfit = round2(grossProfit - salaryAccrued - expenses - cur.warrantyLoss);
    const avgCheck = cur.checks > 0 ? round2(cur.revenue / cur.checks) : 0;
    const prevAvg = before.checks > 0 ? round2(before.revenue / before.checks) : 0;

    const kpis = [
      {
        key: 'revenue',
        title: 'Выручка',
        value: cur.revenue,
        type: 'money' as const,
        deltaPercent: deltaPct(cur.revenue, before.revenue),
      },
      { key: 'productCost', title: 'Себестоимость товаров', value: cur.productCost, type: 'money' as const },
      {
        key: 'grossProfit',
        title: 'Валовая прибыль',
        value: grossProfit,
        type: 'money' as const,
        hint: 'Выручка − себестоимость проданных товаров',
        deltaPercent: deltaPct(grossProfit, prevGross),
      },
      { key: 'expenses', title: 'Расходы (без зарплаты)', value: expenses, type: 'money' as const },
      {
        key: 'salaryAccrued',
        title: 'Зарплата начислено',
        value: salaryAccrued,
        type: 'money' as const,
        hint: 'Процент с работ и товаров по чекам + премии деньгами + мотивация',
      },
      { key: 'salaryPaid', title: 'Зарплата выплачено', value: paid, type: 'money' as const },
      {
        key: 'netProfit',
        title: 'Прибыль после расходов',
        value: netProfit,
        type: 'money' as const,
        tone: netProfit >= 0 ? ('positive' as const) : ('negative' as const),
        hint: 'Валовая прибыль − расходы без ЗП − ЗП начислено − убыток по гарантии',
      },
      {
        key: 'checks',
        title: 'Чеков',
        value: cur.checks,
        type: 'int' as const,
        deltaPercent: deltaPct(cur.checks, before.checks),
      },
      {
        key: 'avgCheck',
        title: 'Средний чек',
        value: avgCheck,
        type: 'money' as const,
        deltaPercent: deltaPct(avgCheck, prevAvg),
      },
      { key: 'newClients', title: 'Новых клиентов', value: newClients, type: 'int' as const },
      {
        key: 'refunds',
        title: 'Возвраты',
        value: refunds.amount,
        type: 'money' as const,
        hint: `${refunds.count} шт.`,
      },
      {
        key: 'clientsOwe',
        title: 'Нам должны',
        value: owed.total,
        type: 'money' as const,
        hint: `Долги клиентов ${owed.debts.toLocaleString('ru-RU')} ₽ + остаток рассрочек ${owed.installments.toLocaleString('ru-RU')} ₽`,
      },
      { key: 'weOweSuppliers', title: 'Мы должны поставщикам', value: supplierDebt, type: 'money' as const },
    ];
    if (cur.warrantyLoss > 0) {
      kpis.push({
        key: 'warrantyLoss',
        title: 'Гарантия (убыток)',
        value: cur.warrantyLoss,
        type: 'money' as const,
        tone: 'negative' as const,
        hint: 'Запчасти и зарплата мастера по гарантийным чекам — уже вычтены из прибыли после расходов',
      });
    }

    const table = await this.timeline(ctx);
    const sections = await Promise.all([
      this.topMasters(ctx),
      this.topServices(ctx),
      this.topProducts(ctx),
      this.paymentMethods(ctx, cur.revenue),
    ]);

    const notes = [
      'Выручка и прибыль — по проведённым чекам; гарантийные чеки денег не приносят, возвраты уже вычтены из выручки в периоде продажи.',
      'Расходы — одобренные, без категории «Зарплата»; расход «за месяц» входит, только если период покрывает этот месяц целиком.',
      'Зарплата начислено = процент с работ и товаров по чекам + премии деньгами + мотивация. Выплачено — по дате выдачи.',
      'Долги (нам должны / мы должны) — на сегодня и по всей компании: клиенты и поставщики общие для сети.',
      '% к прошлому периоду — сравнение с предыдущим периодом той же длины.',
    ];

    return { kpis, columns: table.columns, rows: table.rows, totals: table.totals, sections, notes };
  }

  /** Новый клиент = его первый проведённый чек попал в период (розничный покупатель не считается). */
  private async newClients(ctx: ReportContext): Promise<number> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `WITH firsts AS (
         SELECT ch.client_id, MIN(ch.date) AS first_date
           FROM checks ch
           JOIN clients c ON c.id = ch.client_id AND c.tenant_id = ch.tenant_id AND COALESCE(c.is_retail, false) = false
          WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ch.client_id IS NOT NULL
          GROUP BY ch.client_id
       )
       SELECT COUNT(*)::int AS cnt
         FROM firsts f
        WHERE ${inPeriod('f.first_date')}
          AND EXISTS (SELECT 1 FROM checks ch
                       WHERE ch.tenant_id = $1 AND ch.client_id = f.client_id
                         AND ${checkMoneyBaseWhere('ch')} AND ${inPeriod('ch.date')}${point})`,
      params,
    );
    return num(rows[0]?.cnt);
  }

  /** Таблица по дням (период ≤ 31 дня) или по неделям: чеки, выручка, валовая прибыль, расходы. */
  private async timeline(
    ctx: ReportContext,
  ): Promise<{ columns: ReportColumn[]; rows: ReportRow[]; totals: ReportRow }> {
    const chParams = baseParams(ctx);
    const chPoint = pointFilterSql('ch', ctx.pointId, chParams);
    const exParams = baseParams(ctx);
    const exPoint = pointFilterSql('e', ctx.pointId, exParams);
    const [{ rows: chRows }, { rows: exRows }] = await Promise.all([
      this.pool.query(
        `SELECT ${dayKey('ch.date')} AS day,
                COUNT(*)::int AS checks,
                COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
                COALESCE(SUM(ch.product_cost_total) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS product_cost
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${chPoint}
          GROUP BY 1`,
        chParams,
      ),
      this.pool.query(
        `SELECT ${expenseBucketDay('e')} AS day, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
          WHERE e.tenant_id = $1 AND ${expenseMembership('e')}
            AND ${expenseApproved('e')} AND COALESCE(ec.name, '') <> 'Зарплата'${exPoint}
          GROUP BY 1`,
        exParams,
      ),
    ]);

    const byWeek = ctx.days > 31;
    const bucketOf = (day: string) => (byWeek ? mondayOf(day) : day);
    const buckets = new Map<string, { checks: number; revenue: number; profit: number; expenses: number }>();
    const keys = byWeek ? eachWeek(ctx.dateFrom, ctx.dateTo) : eachDay(ctx.dateFrom, ctx.dateTo);
    for (const k of keys) buckets.set(k, { checks: 0, revenue: 0, profit: 0, expenses: 0 });
    const get = (day: string) => {
      const k = bucketOf(day);
      let b = buckets.get(k);
      if (!b) {
        b = { checks: 0, revenue: 0, profit: 0, expenses: 0 };
        buckets.set(k, b);
      }
      return b;
    };
    for (const r of chRows) {
      const b = get(String(r.day));
      b.checks += num(r.checks);
      b.revenue += num(r.revenue);
      b.profit += num(r.revenue) - num(r.product_cost);
    }
    for (const r of exRows) get(String(r.day)).expenses += num(r.total);

    const columns: ReportColumn[] = [
      byWeek ? { key: 'period', title: 'Неделя', type: 'text' } : { key: 'period', title: 'Дата', type: 'date' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'profit', title: 'Валовая прибыль', type: 'money', hint: 'Выручка − себестоимость товаров' },
      { key: 'expenses', title: 'Расходы', type: 'money', hint: 'Без зарплаты' },
    ];
    const totals: ReportRow = { period: 'Итого', checks: 0, revenue: 0, profit: 0, expenses: 0 };
    const rows: ReportRow[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, b]) => {
        totals.checks = (totals.checks as number) + b.checks;
        totals.revenue = round2((totals.revenue as number) + b.revenue);
        totals.profit = round2((totals.profit as number) + b.profit);
        totals.expenses = round2((totals.expenses as number) + b.expenses);
        return {
          period: byWeek ? weekLabel(k, ctx.dateFrom, ctx.dateTo) : k,
          checks: b.checks,
          revenue: round2(b.revenue),
          profit: round2(b.profit),
          expenses: round2(b.expenses),
        };
      });
    return { columns, rows, totals };
  }

  private async topMasters(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT ch.master_id, COALESCE(u.full_name, 'Без мастера') AS name,
              COUNT(*)::int AS checks,
              COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
              COALESCE(SUM(${checkRevenueExpr('ch')}) - SUM(ch.product_cost_total) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS profit
         FROM checks ch
         LEFT JOIN users u ON u.id = ch.master_id AND u.tenant_id = ch.tenant_id
        WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${point}
        GROUP BY ch.master_id, u.full_name
        ORDER BY revenue DESC, name
        LIMIT 5`,
      params,
    );
    return {
      key: 'topMasters',
      title: 'Топ-5 мастеров',
      columns: [
        { key: 'name', title: 'Мастер', type: 'text' },
        { key: 'checks', title: 'Чеков', type: 'int' },
        { key: 'revenue', title: 'Выручка', type: 'money' },
        { key: 'profit', title: 'Прибыль', type: 'money', hint: 'Выручка − себестоимость товаров' },
      ],
      rows: rows.map((r) => ({
        _id: r.master_id ?? null,
        name: String(r.name),
        checks: num(r.checks),
        revenue: num(r.revenue),
        profit: round2(num(r.profit)),
      })),
      emptyText: 'За период нет проведённых чеков',
    };
  }

  private async topServices(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT COALESCE(s.name, MIN(sl.name)) AS name,
              COALESCE(SUM(sl.quantity), 0) AS qty,
              COALESCE(SUM(sl.total), 0) AS revenue
         FROM checks ch
         JOIN check_service_lines sl ON sl.check_id = ch.id
         LEFT JOIN services s ON s.id = sl.service_id
        WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}
          AND ch.payment_method IS DISTINCT FROM 'warranty'
          AND NOT (ch.is_returned = true AND ch.return_scope = 'full')${point}
        GROUP BY COALESCE(sl.service_id::text, 'name:' || lower(sl.name)), s.name
        ORDER BY revenue DESC, name
        LIMIT 5`,
      params,
    );
    return {
      key: 'topServices',
      title: 'Топ-5 услуг',
      columns: [
        { key: 'name', title: 'Услуга', type: 'text' },
        { key: 'qty', title: 'Кол-во', type: 'number' },
        { key: 'revenue', title: 'Выручка', type: 'money' },
      ],
      rows: rows.map((r) => ({ name: String(r.name ?? '—'), qty: num(r.qty), revenue: num(r.revenue) })),
      emptyText: 'За период работ не было',
    };
  }

  private async topProducts(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT COALESCE(p.name, MIN(pl.name)) AS name,
              COALESCE(SUM(pl.quantity), 0) AS qty,
              COALESCE(SUM(pl.total_sell), 0) AS revenue,
              COALESCE(SUM(pl.total_sell - pl.total_cost), 0) AS profit
         FROM checks ch
         JOIN check_product_lines pl ON pl.check_id = ch.id
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}
          AND ch.payment_method IS DISTINCT FROM 'warranty'
          AND NOT (ch.is_returned = true AND ch.return_scope = 'full')${point}
        GROUP BY COALESCE(pl.product_id::text, 'name:' || lower(pl.name)), p.name
        ORDER BY revenue DESC, name
        LIMIT 5`,
      params,
    );
    return {
      key: 'topProducts',
      title: 'Топ-5 товаров',
      columns: [
        { key: 'name', title: 'Товар', type: 'text' },
        { key: 'qty', title: 'Кол-во', type: 'number' },
        { key: 'revenue', title: 'Выручка', type: 'money' },
        { key: 'profit', title: 'Прибыль', type: 'money' },
      ],
      rows: rows.map((r) => ({
        name: String(r.name ?? '—'),
        qty: num(r.qty),
        revenue: num(r.revenue),
        profit: round2(num(r.profit)),
      })),
      emptyText: 'За период товары не продавались',
    };
  }

  /**
   * Способы оплаты: нал + карта + долг по рассрочке = выручка (тождество
   * «Движения денег»: cash + card + installmentDebt = total), поэтому доли
   * складываются в 100 %.
   */
  private async paymentMethods(ctx: ReportContext, revenue: number): Promise<ReportSection> {
    const params = baseParams(ctx);
    const point = pointFilterSql('ch', ctx.pointId, params);
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(ch.cash_amount), 0) AS cash,
              COALESCE(SUM(ch.card_amount), 0) AS card,
              COALESCE(SUM(CASE WHEN ch.payment_method = 'installment' THEN GREATEST(ch.total_revenue - ch.cash_amount - ch.card_amount, 0) ELSE 0 END), 0) AS installment_debt,
              COALESCE(SUM(CASE WHEN ch.payment_method = 'warranty' THEN ch.total_revenue ELSE 0 END), 0) AS warranty
         FROM checks ch
        WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${point}`,
      params,
    );
    const r = rows[0] ?? {};
    const cash = num(r.cash);
    const card = num(r.card);
    const debt = num(r.installment_debt);
    const warranty = num(r.warranty);
    const items: ReportRow[] = [
      { method: 'Наличные', amount: cash, share: pct(cash, revenue) },
      { method: 'Карта', amount: card, share: pct(card, revenue) },
    ];
    if (debt > 0) items.push({ method: 'Рассрочка — выдано в долг', amount: debt, share: pct(debt, revenue) });
    if (warranty > 0) items.push({ method: 'Гарантия — справочно', amount: warranty, share: null, _tone: 'warning' });
    return {
      key: 'paymentMethods',
      title: 'Способы оплаты',
      description: 'Смешанная оплата разложена на наличные и карту. Гарантия в выручку не входит.',
      columns: [
        { key: 'method', title: 'Способ', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money' },
        { key: 'share', title: 'Доля', type: 'percent' },
      ],
      rows: items,
      emptyText: 'За период оплат не было',
    };
  }
}
