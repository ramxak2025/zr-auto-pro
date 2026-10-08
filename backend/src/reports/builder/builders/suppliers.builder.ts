import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext, SECTION_ROW_LIMIT } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { baseParams, dayKey, idsFilter, inPeriod, localDate, num, round2 } from '../report-sql';

/**
 * По поставщикам — сальдо из ЖУРНАЛОВ, а не из suppliers.current_debt.
 *
 * Проводки, двигающие долг (все пути SuppliersService / StockMovementsService /
 * PurchaseOrders пишут ровно их):
 *   • deliveries (deleted_at IS NULL)      → долг +total_amount по дате поступления;
 *   • supplier_payments (reversed_at NULL) → долг −amount по дате платежа:
 *       kind 'payment'       — оплата (amount > 0),
 *       kind 'refund'        — поставщик вернул нам деньги (amount < 0 → долг растёт),
 *       kind 'defect_return' — возврат брака поставщику (amount > 0, долг падает).
 * Долг на конец = долг на начало + поставки − оплаты (нетто с возвратами денег) − возвраты брака.
 * Sanity-проверка при dateTo = сегодня: долг на конец == current_debt — расхождение
 * означало бы правку баланса мимо журналов (описывается в отчёте разработчика).
 *
 * Поставщики общие для сети (POINT_WAREHOUSE_STAFF_2026-09-14): филиалом не
 * режется — долг перед поставщиком принадлежит компании, а не точке.
 */
@Injectable()
export class SuppliersBuilder implements ReportBuilder {
  readonly id = 'suppliers' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const params = baseParams(ctx);
    const ids = idsFilter('s.id', ctx.ids, params);
    const dDate = localDate('d.date');
    const pDate = localDate('sp.date');
    const rDate = localDate('sr.date');
    const { rows } = await this.pool.query(
      `WITH d AS (
         SELECT d.supplier_id,
                COALESCE(SUM(d.total_amount) FILTER (WHERE ${dDate} < $2::date), 0) AS before_sum,
                COUNT(*) FILTER (WHERE ${dDate} BETWEEN $2::date AND $3::date)::int AS cnt,
                COALESCE(SUM(d.total_amount) FILTER (WHERE ${dDate} BETWEEN $2::date AND $3::date), 0) AS in_sum
           FROM deliveries d
          WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND ${dDate} <= $3::date
          GROUP BY d.supplier_id
       ),
       p AS (
         SELECT sp.supplier_id,
                COALESCE(SUM(sp.amount) FILTER (WHERE ${pDate} < $2::date), 0) AS before_sum,
                COALESCE(SUM(sp.amount) FILTER (WHERE ${pDate} BETWEEN $2::date AND $3::date
                                                  AND COALESCE(sp.kind, 'payment') IN ('payment', 'refund')), 0) AS paid_sum,
                COALESCE(SUM(sp.amount) FILTER (WHERE ${pDate} BETWEEN $2::date AND $3::date
                                                  AND sp.kind = 'defect_return'), 0) AS returns_sum
           FROM supplier_payments sp
          WHERE sp.tenant_id = $1 AND sp.reversed_at IS NULL AND ${pDate} <= $3::date
          GROUP BY sp.supplier_id
       )
       , r AS (
         SELECT sr.supplier_id,
                COALESCE(SUM(sr.total_amount) FILTER (WHERE ${rDate} < $2::date),0) AS before_sum,
                COALESCE(SUM(sr.total_amount) FILTER (WHERE ${rDate} BETWEEN $2::date AND $3::date),0) AS in_sum
         FROM supplier_returns sr WHERE sr.tenant_id=$1 AND ${rDate} <= $3::date GROUP BY sr.supplier_id
       )
       SELECT s.id, s.name, s.phone, s.is_system, s.current_debt,
              COALESCE(d.before_sum, 0) - COALESCE(p.before_sum, 0) - COALESCE(r.before_sum, 0) AS debt_start,
              COALESCE(d.cnt, 0) AS deliveries_count,
              COALESCE(d.in_sum, 0) AS deliveries_sum,
              COALESCE(p.paid_sum, 0) AS payments_sum,
              COALESCE(p.returns_sum, 0) + COALESCE(r.in_sum, 0) AS returns_sum
         FROM suppliers s
         LEFT JOIN d ON d.supplier_id = s.id
         LEFT JOIN p ON p.supplier_id = s.id
         LEFT JOIN r ON r.supplier_id = s.id
        WHERE s.tenant_id = $1${ids}
        ORDER BY (COALESCE(d.in_sum, 0)) DESC, lower(s.name)`,
      params,
    );

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Поставщик', type: 'text' },
      {
        key: 'debtStart',
        title: 'Долг на начало',
        type: 'money',
        signed: true,
        hint: 'Плюс — мы должны, минус — переплата',
      },
      { key: 'deliveriesCount', title: 'Поставок', type: 'int' },
      { key: 'deliveries', title: 'Поставки', type: 'money' },
      { key: 'payments', title: 'Оплаты', type: 'money', hint: 'За вычетом денег, возвращённых поставщиком' },
      {
        key: 'returns',
        title: 'Возвраты поставщику',
        type: 'money',
        hint: 'Обычные возвраты и возвраты брака; без движения денег',
      },
      {
        key: 'debtEnd',
        title: 'Долг на конец',
        type: 'money',
        signed: true,
        hint: 'Долг на начало + поставки − оплаты − возвраты',
      },
    ];
    const totals: ReportRow = {
      name: 'Итого',
      debtStart: 0,
      deliveriesCount: 0,
      deliveries: 0,
      payments: 0,
      returns: 0,
      debtEnd: 0,
    };
    let withDebt = 0;
    const all: ReportRow[] = [];
    for (const r of rows) {
      const debtStart = round2(num(r.debt_start));
      const deliveries = num(r.deliveries_sum);
      const payments = num(r.payments_sum);
      const returns = num(r.returns_sum);
      const debtEnd = round2(debtStart + deliveries - payments - returns);
      const deliveriesCount = num(r.deliveries_count);
      if (debtStart === 0 && deliveries === 0 && payments === 0 && returns === 0 && debtEnd === 0) continue;
      if (debtEnd > 0) withDebt += 1;
      all.push({
        _id: r.id,
        _tone: debtEnd > 0 ? 'warning' : 'default',
        name: String(r.name),
        debtStart,
        deliveriesCount,
        deliveries,
        payments,
        returns,
        debtEnd,
      });
      for (const key of ['debtStart', 'deliveries', 'payments', 'returns', 'debtEnd']) {
        totals[key] = round2((totals[key] as number) + (all[all.length - 1][key] as number));
      }
      totals.deliveriesCount = (totals.deliveriesCount as number) + deliveriesCount;
    }
    const truncated = all.length > MAIN_ROW_LIMIT;
    const shown = truncated ? all.slice(0, MAIN_ROW_LIMIT) : all;

    const [deliveriesSection, paymentsSection, returnsSection] = await Promise.all([
      this.deliveries(ctx),
      this.payments(ctx),
      this.returns(ctx),
    ]);

    return {
      kpis: [
        { key: 'deliveries', title: 'Поставки', value: totals.deliveries as number, type: 'money' },
        { key: 'payments', title: 'Оплаты', value: totals.payments as number, type: 'money' },
        {
          key: 'debtEnd',
          title: 'Долг на конец',
          value: totals.debtEnd as number,
          type: 'money',
          tone: (totals.debtEnd as number) > 0 ? 'warning' : 'default',
          hint: 'Плюс — мы должны, минус — переплата',
        },
        { key: 'withDebt', title: 'Поставщиков с долгом', value: withDebt, type: 'int' },
      ],
      columns,
      rows: shown,
      totals,
      sections: [deliveriesSection, paymentsSection, returnsSection],
      truncated,
      notes: [
        'Поставки — по дате поступления, оплаты — по дате платежа; сторнированные платежи и удалённые поставки не считаются.',
        'Долг на конец = долг на начало + поставки − оплаты − возвраты. Плюс — мы должны поставщику, минус — поставщик должен нам.',
        'Поставщики общие для всей компании, поэтому отчёт не делится по филиалам.',
      ],
    };
  }

  private async deliveries(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const ids = idsFilter('d.supplier_id', ctx.ids, params);
    const { rows } = await this.pool.query(
      `SELECT d.id, ${dayKey('d.date')} AS day, s.name AS supplier, d.total_amount, d.comment, d.payment_status,
              po.status AS order_status, d.purchase_order_id
         FROM deliveries d
         JOIN suppliers s ON s.id = d.supplier_id
         LEFT JOIN purchase_orders po ON po.id = d.purchase_order_id
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND ${inPeriod('d.date')}${ids}
        ORDER BY d.date DESC
        LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      key: 'deliveries',
      title: 'Поставки за период',
      columns: [
        { key: 'date', title: 'Дата', type: 'date' },
        { key: 'supplier', title: 'Поставщик', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money' },
        { key: 'status', title: 'Оплата', type: 'text' },
        { key: 'comment', title: 'Комментарий / документ', type: 'text' },
      ],
      rows: rows.map((r) => ({
        _id: r.id,
        date: String(r.day),
        supplier: String(r.supplier),
        amount: num(r.total_amount),
        status: PAYMENT_STATUS_LABELS[String(r.payment_status)] ?? String(r.payment_status ?? '—'),
        comment: [r.purchase_order_id ? 'По заказу поставщику' : null, r.comment].filter(Boolean).join(' · ') || null,
      })),
      emptyText: 'За период поставок не было',
    };
  }

  private async returns(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const ids = idsFilter('r.supplier_id', ctx.ids, params);
    const { rows } = await this.pool.query(
      `SELECT r.id, ${dayKey('r.date')} AS day, s.name AS supplier, r.total_amount, r.reason
      FROM supplier_returns r JOIN suppliers s ON s.id=r.supplier_id AND s.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND ${inPeriod('r.date')}${ids} ORDER BY r.date DESC LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      key: 'returns',
      title: 'Возвраты товара за период',
      columns: [
        { key: 'date', title: 'Дата', type: 'date' },
        { key: 'supplier', title: 'Поставщик', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money' },
        { key: 'reason', title: 'Причина', type: 'text' },
      ],
      rows: rows.map((r) => ({
        _id: r.id,
        date: String(r.day),
        supplier: String(r.supplier),
        amount: num(r.total_amount),
        reason: r.reason ?? null,
      })),
      emptyText: 'За период возвратов не было',
    };
  }

  private async payments(ctx: ReportContext): Promise<ReportSection> {
    const params = baseParams(ctx);
    const ids = idsFilter('sp.supplier_id', ctx.ids, params);
    const { rows } = await this.pool.query(
      `SELECT sp.id, ${dayKey('sp.date')} AS day, s.name AS supplier, sp.amount, sp.comment, COALESCE(sp.kind, 'payment') AS kind
         FROM supplier_payments sp
         JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.tenant_id = $1 AND sp.reversed_at IS NULL AND ${inPeriod('sp.date')}${ids}
        ORDER BY sp.date DESC
        LIMIT ${SECTION_ROW_LIMIT}`,
      params,
    );
    return {
      key: 'payments',
      title: 'Оплаты за период',
      columns: [
        { key: 'date', title: 'Дата', type: 'date' },
        { key: 'supplier', title: 'Поставщик', type: 'text' },
        { key: 'kind', title: 'Тип', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money', signed: true, hint: 'Минус — деньги вернулись от поставщика' },
        { key: 'comment', title: 'Комментарий', type: 'text' },
      ],
      rows: rows.map((r) => ({
        _id: r.id,
        date: String(r.day),
        supplier: String(r.supplier),
        kind: PAYMENT_KIND_LABELS[String(r.kind)] ?? String(r.kind),
        amount: num(r.amount),
        comment: r.comment ?? null,
      })),
      emptyText: 'За период оплат не было',
    };
  }
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Не оплачена',
  partial: 'Частично',
  paid: 'Оплачена',
};

const PAYMENT_KIND_LABELS: Record<string, string> = {
  payment: 'Оплата',
  refund: 'Возврат от поставщика',
  defect_return: 'Возврат брака',
};
