import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class SalaryService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async getAll(tenantID: string, query: any) {
    const dateFrom = query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT u.id as master_id, u.full_name as master_name,
              COALESCE(u.salary_percent, 0) as salary_percent,
              COALESCE(u.product_salary_percent, 0) as product_salary_percent,
              COALESCE(SUM(ch.service_salary_total), 0) as service_earnings,
              COALESCE(SUM(COALESCE(ch.product_salary_total, 0)), 0) as product_earnings,
              COALESCE(SUM(ch.service_salary_total) + SUM(COALESCE(ch.product_salary_total, 0)), 0) as total_earnings,
              COALESCE(SUM(ch.total_revenue), 0) as total_revenue,
              COUNT(ch.id) as check_count
       FROM users u
       LEFT JOIN checks ch ON ch.master_id = u.id
         AND ch.tenant_id = u.tenant_id
         AND ch.date >= $2 AND ch.date <= ($3::date + 1)::timestamptz
         AND ch.is_deferred = false
       WHERE u.tenant_id = $1 AND u.role IN ('master', 'admin')
       GROUP BY u.id, u.full_name, u.salary_percent, u.product_salary_percent
       ORDER BY total_earnings DESC`,
      [tenantID, dateFrom, dateTo],
    );

    return rows.map((r) => ({
      masterId: r.master_id,
      masterName: r.master_name,
      salaryPercent: parseFloat(r.salary_percent) || 0,
      productSalaryPercent: parseFloat(r.product_salary_percent) || 0,
      serviceEarnings: parseFloat(r.service_earnings) || 0,
      productEarnings: parseFloat(r.product_earnings) || 0,
      totalEarnings: parseFloat(r.total_earnings) || 0,
      totalRevenue: parseFloat(r.total_revenue) || 0,
      checkCount: parseInt(r.check_count) || 0,
    }));
  }

  async getMy(tenantID: string, userID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows: userRows } = await this.pool.query(
      'SELECT full_name, COALESCE(salary_percent, 0) as salary_percent, COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id=$1 AND tenant_id=$2',
      [userID, tenantID],
    );
    const user = userRows[0] || { full_name: '', salary_percent: 0, product_salary_percent: 0 };

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as week,
         COALESCE(SUM(CASE WHEN date >= $4 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as month,
         COALESCE(SUM(service_salary_total + COALESCE(product_salary_total, 0)), 0) as total,
         COALESCE(SUM(CASE WHEN date >= $2 THEN service_salary_total END), 0) as today_service,
         COALESCE(SUM(CASE WHEN date >= $2 THEN COALESCE(product_salary_total, 0) END), 0) as today_product,
         COUNT(CASE WHEN date >= $2 THEN 1 END) as today_checks,
         COUNT(CASE WHEN date >= $4 THEN 1 END) as month_checks,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('cash','cash_card') THEN cash_amount END), 0) as today_cash,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('card','cash_card') THEN card_amount END), 0) as today_card,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method = 'warranty' THEN total_revenue END), 0) as today_warranty
       FROM checks
       WHERE master_id = $1 AND is_deferred = false AND tenant_id = $5`,
      [userID, todayStart, weekStart, monthStart, tenantID],
    );

    const r = rows[0];

    // Fetch product commission promotions for this master
    const { rows: promoRows } = await this.pool.query(
      `SELECT pc.percent, p.id as product_id, p.name as product_name,
              p.sell_price, p.cost_price, p.photo
       FROM product_commissions pc
       JOIN products p ON p.id = pc.product_id
       WHERE pc.user_id = $1 AND pc.tenant_id = $2
       ORDER BY pc.percent DESC, p.name`,
      [userID, tenantID],
    );

    const productPromotions = promoRows.map(p => ({
      productId: p.product_id,
      productName: p.product_name,
      percent: parseFloat(p.percent) || 0,
      sellPrice: parseFloat(p.sell_price) || 0,
      costPrice: parseFloat(p.cost_price) || 0,
      photo: p.photo,
      estimatedBonus: Math.round(((parseFloat(p.sell_price) || 0) - (parseFloat(p.cost_price) || 0)) * (parseFloat(p.percent) / 100)),
    }));

    return {
      today: parseFloat(r.today) || 0,
      week: parseFloat(r.week) || 0,
      month: parseFloat(r.month) || 0,
      total: parseFloat(r.total) || 0,
      todayService: parseFloat(r.today_service) || 0,
      todayProduct: parseFloat(r.today_product) || 0,
      masterName: user.full_name,
      salaryPercent: parseFloat(user.salary_percent) || 0,
      productSalaryPercent: parseFloat(user.product_salary_percent) || 0,
      todayChecks: parseInt(r.today_checks) || 0,
      monthChecks: parseInt(r.month_checks) || 0,
      todayCash: parseFloat(r.today_cash) || 0,
      todayCard: parseFloat(r.today_card) || 0,
      todayWarranty: parseFloat(r.today_warranty) || 0,
      productPromotions,
    };
  }
}
