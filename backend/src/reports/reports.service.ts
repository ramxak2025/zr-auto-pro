import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ReportsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async getFinancial(tenantID: string, query: any) {
    const dateFrom = query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
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

  async getCashFlow(tenantID: string, query: any) {
    const dateFrom = query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
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
