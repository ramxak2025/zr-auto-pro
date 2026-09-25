import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { baseParams, dayKey, eachDay, eachWeek, inPeriod, mondayOf, num, pct, round2, weekLabel } from '../report-sql';

interface DayBucket {
  cash: number;
  card: number;
  paid: number;
  received: number;
}

/**
 * По способам оплаты — те же три выборки, что getCashFlow (чеки по дню,
 * погашения рассрочки по дате платежа, возвраты по дате возврата), с тем же
 * филиальным предикатом (чек — по point_id, погашение — через чек плана,
 * возврат — через чек). Поэтому строки обязаны совпасть с «Движением денег»:
 * наличные = totals.cash, карта = totals.card, платежи по графику =
 * totals.installmentPaid, выдано в долг = totals.installmentDebt, гарантия =
 * totals.warranty, возвраты = totals.refunds, итого = totals.received.
 *
 * Первый взнос рассрочки уже сидит внутри наличных/карты (ноги чека) — строка
 * показана справочно и в итог не входит, иначе деньги задвоились бы.
 */
@Injectable()
export class PaymentsBuilder implements ReportBuilder {
  readonly id = 'payments' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const chParams = baseParams(ctx);
    const chPoint = pointFilterSql('ch', ctx.pointId, chParams);
    const ipParams = baseParams(ctx);
    let ipJoin = '';
    let ipPoint = '';
    if (ctx.pointId) {
      ipParams.push(ctx.pointId);
      ipJoin = 'LEFT JOIN checks ch ON ch.id = pl.check_id AND ch.deleted_at IS NULL';
      ipPoint = ` AND ch.point_id = $${ipParams.length}`;
    }
    const rfParams = baseParams(ctx);
    const rfPoint = pointFilterSql('ch', ctx.pointId, rfParams);

    const [{ rows: chRows }, { rows: ipRows }, { rows: rfRows }] = await Promise.all([
      this.pool.query(
        `SELECT ${dayKey('ch.date')} AS day,
                COALESCE(SUM(ch.cash_amount), 0) AS cash,
                COUNT(*) FILTER (WHERE ch.cash_amount > 0)::int AS cash_checks,
                COALESCE(SUM(ch.card_amount), 0) AS card,
                COUNT(*) FILTER (WHERE ch.card_amount > 0)::int AS card_checks,
                COALESCE(SUM(CASE WHEN ch.payment_method = 'warranty' THEN ch.total_revenue ELSE 0 END), 0) AS warranty,
                COUNT(*) FILTER (WHERE ch.payment_method = 'warranty')::int AS warranty_checks,
                COALESCE(SUM(CASE WHEN ch.payment_method = 'installment' THEN GREATEST(ch.total_revenue - ch.cash_amount - ch.card_amount, 0) ELSE 0 END), 0) AS installment_debt,
                COUNT(*) FILTER (WHERE ch.payment_method = 'installment')::int AS installment_checks,
                COALESCE(SUM(CASE WHEN ch.payment_method = 'installment' THEN ch.cash_amount + ch.card_amount ELSE 0 END), 0) AS installment_down,
                COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS total
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${chPoint}
          GROUP BY 1`,
        chParams,
      ),
      this.pool.query(
        `SELECT ${dayKey('p.paid_at')} AS day,
                COUNT(*)::int AS cnt,
                COALESCE(SUM(p.amount), 0) AS paid,
                COALESCE(SUM(CASE WHEN p.payment_method = 'card' THEN p.amount ELSE 0 END), 0) AS paid_card,
                COALESCE(SUM(CASE WHEN COALESCE(p.payment_method, 'cash') <> 'card' THEN p.amount ELSE 0 END), 0) AS paid_cash
           FROM installment_payments p
           JOIN installment_plans pl ON pl.id = p.plan_id AND pl.tenant_id = $1
           ${ipJoin}
          WHERE p.tenant_id = $1 AND ${inPeriod('p.paid_at')}${ipPoint}
          GROUP BY 1`,
        ipParams,
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(cr.refund_amount), 0) AS refunds
           FROM check_returns cr
           JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = $1 AND ch.deleted_at IS NULL
          WHERE cr.tenant_id = $1 AND ${inPeriod('cr.created_at')}${rfPoint}`,
        rfParams,
      ),
    ]);

    const t = {
      cash: 0,
      cashChecks: 0,
      card: 0,
      cardChecks: 0,
      warranty: 0,
      warrantyChecks: 0,
      installmentDebt: 0,
      installmentChecks: 0,
      installmentDown: 0,
      total: 0,
      paid: 0,
      paidCash: 0,
      paidCard: 0,
      paidCount: 0,
    };
    const byWeek = ctx.days > 62;
    const bucketOf = (day: string) => (byWeek ? mondayOf(day) : day);
    const buckets = new Map<string, DayBucket>();
    for (const k of byWeek ? eachWeek(ctx.dateFrom, ctx.dateTo) : eachDay(ctx.dateFrom, ctx.dateTo)) {
      buckets.set(k, { cash: 0, card: 0, paid: 0, received: 0 });
    }
    const bucket = (day: string): DayBucket => {
      const k = bucketOf(day);
      let b = buckets.get(k);
      if (!b) {
        b = { cash: 0, card: 0, paid: 0, received: 0 };
        buckets.set(k, b);
      }
      return b;
    };
    for (const r of chRows) {
      const b = bucket(String(r.day));
      b.cash += num(r.cash);
      b.card += num(r.card);
      t.cash += num(r.cash);
      t.cashChecks += num(r.cash_checks);
      t.card += num(r.card);
      t.cardChecks += num(r.card_checks);
      t.warranty += num(r.warranty);
      t.warrantyChecks += num(r.warranty_checks);
      t.installmentDebt += num(r.installment_debt);
      t.installmentChecks += num(r.installment_checks);
      t.installmentDown += num(r.installment_down);
      t.total += num(r.total);
    }
    for (const r of ipRows) {
      bucket(String(r.day)).paid += num(r.paid);
      t.paid += num(r.paid);
      t.paidCash += num(r.paid_cash);
      t.paidCard += num(r.paid_card);
      t.paidCount += num(r.cnt);
    }
    for (const b of buckets.values()) b.received = round2(b.cash + b.card + b.paid);
    const received = round2(t.cash + t.card + t.paid);
    const refunds = num(rfRows[0]?.refunds);
    const refundsCount = num(rfRows[0]?.cnt);

    const columns: ReportColumn[] = [
      { key: 'method', title: 'Способ', type: 'text' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'amount', title: 'Сумма', type: 'money' },
      { key: 'share', title: 'Доля', type: 'percent', hint: 'От полученных денег' },
    ];
    const rows: ReportRow[] = [
      { method: 'Наличные', checks: t.cashChecks, amount: round2(t.cash), share: pct(t.cash, received) },
      { method: 'Карта', checks: t.cardChecks, amount: round2(t.card), share: pct(t.card, received) },
      {
        method: 'Рассрочка — платежи по графику',
        checks: t.paidCount,
        amount: round2(t.paid),
        share: pct(t.paid, received),
      },
      {
        method: 'Рассрочка — первый взнос (справочно, уже в наличных и карте)',
        checks: t.installmentChecks,
        amount: round2(t.installmentDown),
        share: null,
        _tone: 'warning',
      },
      {
        method: 'Рассрочка — выдано в долг (справочно)',
        checks: t.installmentChecks,
        amount: round2(t.installmentDebt),
        share: null,
        _tone: 'warning',
      },
      {
        method: 'Гарантия (справочно, денег не приносит)',
        checks: t.warrantyChecks,
        amount: round2(t.warranty),
        share: null,
        _tone: 'warning',
      },
      {
        method: 'Возвраты клиентам (справочно)',
        checks: refundsCount,
        amount: round2(refunds),
        share: null,
        _tone: 'warning',
      },
    ];
    const totals: ReportRow = {
      method: 'Итого получено',
      checks: null,
      amount: received,
      share: received > 0 ? 100 : 0,
    };

    const dailyColumns: ReportColumn[] = [
      byWeek ? { key: 'period', title: 'Неделя', type: 'text' } : { key: 'period', title: 'Дата', type: 'date' },
      { key: 'cash', title: 'Наличные', type: 'money' },
      { key: 'card', title: 'Карта', type: 'money' },
      { key: 'other', title: 'Прочее', type: 'money', hint: 'Платежи по рассрочке' },
      { key: 'total', title: 'Итого', type: 'money' },
    ];
    const dailyTotals: ReportRow = {
      period: 'Итого',
      cash: round2(t.cash),
      card: round2(t.card),
      other: round2(t.paid),
      total: received,
    };
    const daily: ReportSection = {
      key: 'byDay',
      title: byWeek ? 'По неделям' : 'По дням',
      columns: dailyColumns,
      rows: [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, b]) => ({
          period: byWeek ? weekLabel(k, ctx.dateFrom, ctx.dateTo) : k,
          cash: round2(b.cash),
          card: round2(b.card),
          other: round2(b.paid),
          total: b.received,
        })),
      totals: dailyTotals,
      emptyText: 'За период оплат не было',
    };

    return {
      kpis: [
        {
          key: 'received',
          title: 'Получено всего',
          value: received,
          type: 'money',
          hint: 'Наличные + карта + платежи по рассрочке',
        },
        { key: 'cash', title: 'Наличные', value: round2(t.cash), type: 'money' },
        { key: 'card', title: 'Карта', value: round2(t.card), type: 'money' },
        { key: 'installmentPaid', title: 'Платежи по рассрочке', value: round2(t.paid), type: 'money' },
        {
          key: 'installmentDebt',
          title: 'Выдано в рассрочку (долг)',
          value: round2(t.installmentDebt),
          type: 'money',
          tone: t.installmentDebt > 0 ? 'warning' : 'default',
        },
        { key: 'warranty', title: 'Гарантия (справочно)', value: round2(t.warranty), type: 'money' },
      ],
      columns,
      rows,
      totals,
      sections: [daily],
      notes: [
        'Смешанная оплата разложена на наличные и карту. Итого = наличные + карта + платежи по рассрочке — совпадает с «Движением денег».',
        'Первый взнос рассрочки уже входит в наличные и карту; выдано в долг — остаток, который клиент заплатит позже.',
        'Гарантия — чеки без денег, показана справочно и в выручку не входит. Возвраты — по дате возврата; из дня продажи они уже вычтены.',
      ],
    };
  }
}
