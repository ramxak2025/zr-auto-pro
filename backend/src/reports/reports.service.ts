import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ReportsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async getFinancial(tenantID: string, query: any) {
    const dateFrom =
      query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(total_revenue), 0) as revenue,
         COALESCE(SUM(product_cost_total), 0) as product_cost,
         COALESCE(SUM(service_salary_total) + SUM(COALESCE(product_salary_total, 0)), 0) as salaries,
         COUNT(*) as check_count
       FROM checks
       WHERE tenant_id = $1 AND date >= $2 AND date <= ($3::date + 1)::timestamptz AND is_deferred = false`,
      [tenantID, dateFrom, dateTo],
    );

    const r = rows[0];
    const revenue = parseFloat(r.revenue) || 0;
    const productCost = parseFloat(r.product_cost) || 0;
    const salaries = parseFloat(r.salaries) || 0;
    const grossProfit = revenue - productCost;

    // Get director expenses for the same period
    const { rows: expRows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE tenant_id = $1 AND date >= $2 AND date <= ($3::date + 1)::timestamptz`,
      [tenantID, dateFrom, dateTo],
    );
    const otherExpenses = parseFloat(expRows[0]?.total) || 0;

    const netProfit = grossProfit - salaries - otherExpenses;

    return {
      dateFrom,
      dateTo,
      revenue,
      productCost,
      salaries,
      otherExpenses,
      grossProfit,
      netProfit,
      checkCount: parseInt(r.check_count) || 0,
    };
  }

  /**
   * Aggregate stock_movements rows for the period and return totals for
   * defect transfers (main → defect), writeoffs (with / without expense
   * booking), and supplier returns. Powers the report screen for owners.
   *
   * "Value" columns use `qty * cost_price` from the linked product so we
   * don't have to materialise per-movement amounts in stock_movements.
   * If a product is later soft-deleted the row stays (product table is
   * kept around, only marked deleted_at), so the join still resolves.
   */
  async getDefectWriteoffReport(tenantID: string, query: { from?: string; to?: string }) {
    const dateFrom =
      query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.to || new Date().toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN sm.type = 'defect_transfer' THEN sm.quantity ELSE 0 END), 0) as defect_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_transfer' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as defect_value,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' THEN sm.quantity ELSE 0 END), 0) as writeoff_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as writeoff_value,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' AND sm.record_as_expense = true THEN sm.quantity ELSE 0 END), 0) as writeoff_expensed_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' AND sm.record_as_expense = true THEN sm.quantity * p.cost_price ELSE 0 END), 0) as writeoff_expensed_value,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_return_to_supplier' THEN sm.quantity ELSE 0 END), 0) as returned_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_return_to_supplier' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as returned_value
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.tenant_id = $1
         AND sm.created_at >= $2
         AND sm.created_at <= ($3::date + 1)::timestamptz
         AND sm.type IN ('defect_transfer','writeoff','defect_return_to_supplier')`,
      [tenantID, dateFrom, dateTo],
    );

    const r = rows[0];
    return {
      dateFrom,
      dateTo,
      defectQty: parseFloat(r.defect_qty) || 0,
      defectValue: parseFloat(r.defect_value) || 0,
      writeoffQty: parseFloat(r.writeoff_qty) || 0,
      writeoffValue: parseFloat(r.writeoff_value) || 0,
      writeoffExpensedQty: parseFloat(r.writeoff_expensed_qty) || 0,
      writeoffExpensedValue: parseFloat(r.writeoff_expensed_value) || 0,
      returnedToSupplierQty: parseFloat(r.returned_qty) || 0,
      returnedToSupplierValue: parseFloat(r.returned_value) || 0,
    };
  }

  /**
   * Call funnel report: cross-reference sms_history (which logs inbound/outbound
   * SMS contacts stored persistently in DB) with checks to build a conversion
   * funnel. The external "calls" log (from Moi Zvonki API) is not persisted to
   * DB, so we use sms_history as the tenant contact proxy.
   *
   * For tenants without any SMS integration the query returns zeros — not an
   * error, just an empty funnel.
   */
  async getCallFunnel(tenantID: string, query: { dateFrom?: string; dateTo?: string }) {
    const dateFrom =
      query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];

    // Contact stats from sms_history
    const { rows: contactRows } = await this.pool.query(
      `SELECT
         COUNT(*) AS total_contacts,
         COUNT(DISTINCT phone) AS unique_callers
       FROM sms_history
       WHERE tenant_id = $1
         AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantID, dateFrom, dateTo],
    );

    // Checks created for clients who appear in sms_history during the same period
    const { rows: checkRows } = await this.pool.query(
      `SELECT
         COUNT(DISTINCT ch.client_id) AS arrived_clients,
         COUNT(DISTINCT ch.id) AS created_checks,
         COALESCE(SUM(ch.total_revenue), 0) AS total_revenue
       FROM checks ch
       JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
       WHERE ch.tenant_id = $1
         AND ch.is_deferred = false
         AND ch.date::date BETWEEN $2::date AND $3::date
         AND cl.phone IN (
           SELECT DISTINCT phone FROM sms_history
           WHERE tenant_id = $1
             AND created_at::date BETWEEN $2::date AND $3::date
         )`,
      [tenantID, dateFrom, dateTo],
    );

    // Repeat clients (clients with more than 1 check total for this tenant)
    const { rows: repeatRows } = await this.pool.query(
      `SELECT COUNT(DISTINCT client_id) AS repeat_clients
       FROM (
         SELECT client_id, COUNT(*) AS check_count
         FROM checks
         WHERE tenant_id = $1 AND is_deferred = false AND client_id IS NOT NULL
         GROUP BY client_id
         HAVING COUNT(*) > 1
       ) sub`,
      [tenantID],
    );

    const c = contactRows[0];
    const r = checkRows[0];
    const rp = repeatRows[0];

    const totalCalls = parseInt(c.total_contacts) || 0;
    const uniqueCallers = parseInt(c.unique_callers) || 0;
    const arrivedClients = parseInt(r.arrived_clients) || 0;
    const createdChecks = parseInt(r.created_checks) || 0;
    const totalRevenue = parseFloat(r.total_revenue) || 0;
    const avgCheckValue = createdChecks > 0 ? totalRevenue / createdChecks : 0;
    const repeatClients = parseInt(rp.repeat_clients) || 0;
    const conversionRate = uniqueCallers > 0 ? (arrivedClients / uniqueCallers) * 100 : 0;

    return {
      totalCalls,
      uniqueCallers,
      arrivedClients,
      createdChecks,
      totalRevenue,
      avgCheckValue,
      repeatClients,
      conversionRate: Math.round(conversionRate * 10) / 10,
      period: { from: dateFrom, to: dateTo },
    };
  }

  async getCashFlow(tenantID: string, query: any) {
    const dateFrom =
      query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];
    const masterId = query.masterId || null;

    const params: any[] = [tenantID, dateFrom, dateTo];
    let masterFilter = '';
    if (masterId) {
      params.push(masterId);
      masterFilter = ` AND master_id = $${params.length}`;
    }

    const { rows } = await this.pool.query(
      `SELECT date::date as day,
              COALESCE(SUM(cash_amount), 0) as cash,
              COALESCE(SUM(card_amount), 0) as card,
              COALESCE(SUM(CASE WHEN payment_method = 'warranty' THEN total_revenue ELSE 0 END), 0) as warranty,
              COALESCE(SUM(total_revenue), 0) as total
       FROM checks
       WHERE tenant_id = $1 AND date >= $2 AND date <= ($3::date + 1)::timestamptz AND is_deferred = false${masterFilter}
       GROUP BY date::date
       ORDER BY day`,
      params,
    );

    const days = rows.map((r) => ({
      date: r.day,
      cash: parseFloat(r.cash) || 0,
      card: parseFloat(r.card) || 0,
      warranty: parseFloat(r.warranty) || 0,
      total: parseFloat(r.total) || 0,
    }));

    const totals = { cash: 0, card: 0, warranty: 0, total: 0 };
    for (const d of days) {
      totals.cash += d.cash;
      totals.card += d.card;
      totals.warranty += d.warranty;
      totals.total += d.total;
    }

    return { days, totals };
  }
}
