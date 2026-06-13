import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';

// Matches a calendar date `YYYY-MM-DD`. Anything else (locale-formatted,
// empty, ISO-with-time, garbage) is rejected so it never reaches a raw
// `$n::date` cast in SQL — an invalid cast surfaces as a deterministic 500
// that no client retry can recover from.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Injectable()
export class ReportsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Normalise a caller-supplied date param to a safe `YYYY-MM-DD` string.
   * A well-formed value is also range-checked (Postgres would reject e.g.
   * `2026-13-40`); anything invalid falls back to `fallback` so the query
   * can never 500 on a bad `::date` cast. Behaviour for valid input is
   * unchanged — every previously-200 request stays 200 with the same shape.
   */
  private safeDate(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return fallback;
    const ts = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(ts)) return fallback;
    // Reject overflow dates that match the regex but aren't real (e.g. 02-30).
    if (new Date(ts).toISOString().slice(0, 10) !== value) return fallback;
    return value;
  }

  private firstOfMonth(): string {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0];
  }

  private todayISO(): string {
    return new Date().toISOString().split('T')[0];
  }

  async getFinancial(tenantID: string, query: any) {
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());

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
    const dateFrom = this.safeDate(query?.from, this.firstOfMonth());
    const dateTo = this.safeDate(query?.to, this.todayISO());

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
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());

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
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());
    // masterId reaches a raw `master_id = $n` (uuid) comparison; a non-uuid
    // value triggers "invalid input syntax for type uuid" → 500. Ignore an
    // invalid filter rather than blow up (an invalid master = no such master,
    // so dropping the filter would over-report — instead force an empty set).
    const rawMaster = query?.masterId;
    const masterId = typeof rawMaster === 'string' && UUID_RE.test(rawMaster) ? rawMaster : null;
    const masterInvalid = !!rawMaster && masterId === null;
    if (masterInvalid) {
      return { days: [], totals: { cash: 0, card: 0, warranty: 0, total: 0 } };
    }

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

  // ──────────────────────────────────────────────────────────────────────
  //  Owner dashboard v2 — richer aggregates (net profit, cash position,
  //  margin, deferred sum, personal records, month forecast).
  //  Cached 30s per tenant.
  // ──────────────────────────────────────────────────────────────────────

  async dashboardV2(tenantID: string, period: 'today' | 'week' | 'month' | 'year' = 'month') {
    return ttlCache.wrap(`reports:dashboard-v2:${tenantID}:${period}`, 30_000, () =>
      this.computeDashboardV2(tenantID, period),
    );
  }

  private async computeDashboardV2(tenantID: string, period: 'today' | 'week' | 'month' | 'year') {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    // Existing dashboard numbers (preserve compatibility — caller sees them too).
    const { rows: baseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN total_revenue END), 0) AS revenue_today,
         COALESCE(COUNT(CASE WHEN date >= $2 THEN 1 END), 0) AS checks_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN total_revenue END), 0) AS revenue_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN profit END), 0) AS profit_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN profit END), 0) AS profit_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN cash_amount END), 0) AS cash_today,
         COALESCE(SUM(CASE WHEN date >= $2 THEN card_amount END), 0) AS card_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='warranty' THEN total_revenue END), 0) AS warranty_today
       FROM checks
       WHERE tenant_id=$1 AND is_deferred=false`,
      [tenantID, todayStart, monthStart],
    );
    const base = baseRows[0];

    // Director-recorded expenses (today, month, last month) — needed for
    // net profit and the spark line.
    const { rows: expenseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN amount END), 0) AS exp_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN amount END), 0) AS exp_month,
         COALESCE(SUM(CASE WHEN date >= $4 AND date < $3 THEN amount END), 0) AS exp_prev_month
       FROM expenses
       WHERE tenant_id=$1`,
      [tenantID, todayStart, monthStart, prevMonthStart],
    );
    const expToday = parseFloat(expenseRows[0]?.exp_today) || 0;
    const expMonth = parseFloat(expenseRows[0]?.exp_month) || 0;
    const expPrevMonth = parseFloat(expenseRows[0]?.exp_prev_month) || 0;

    const profitToday = parseFloat(base.profit_today) || 0;
    const profitMonth = parseFloat(base.profit_month) || 0;
    const revenueToday = parseFloat(base.revenue_today) || 0;
    const revenueMonth = parseFloat(base.revenue_month) || 0;
    const checksToday = parseInt(base.checks_today) || 0;
    const cashToday = parseFloat(base.cash_today) || 0;
    const cardToday = parseFloat(base.card_today) || 0;
    const warrantyToday = parseFloat(base.warranty_today) || 0;

    const netProfitToday = profitToday - expToday;
    const netProfitMonth = profitMonth - expMonth;

    // Previous-period net profit (last month) for marginPctChange.
    const { rows: prevRows } = await this.pool.query(
      `SELECT COALESCE(SUM(total_revenue), 0) AS revenue, COALESCE(SUM(profit), 0) AS profit
         FROM checks
        WHERE tenant_id=$1 AND is_deferred=false
          AND date >= $2 AND date < $3`,
      [tenantID, prevMonthStart, monthStart],
    );
    const prevRevenue = parseFloat(prevRows[0]?.revenue) || 0;
    const prevProfit = parseFloat(prevRows[0]?.profit) || 0;
    const prevNet = prevProfit - expPrevMonth;
    const marginPct = revenueMonth > 0 ? (netProfitMonth / revenueMonth) * 100 : 0;
    const prevMarginPct = prevRevenue > 0 ? (prevNet / prevRevenue) * 100 : 0;
    const marginPctChange = marginPct - prevMarginPct;

    // Spark line: 30-day net profit per day.
    const { rows: sparkRows } = await this.pool.query(
      `SELECT day, COALESCE(profit, 0) AS profit, COALESCE(exp, 0) AS expense
         FROM (
           SELECT generate_series(now()::date - interval '29 days', now()::date, '1 day')::date AS day
         ) d
         LEFT JOIN (
           SELECT date::date AS day, SUM(profit) AS profit
             FROM checks
            WHERE tenant_id=$1 AND is_deferred=false
              AND date >= now() - interval '30 days'
            GROUP BY day
         ) ch USING (day)
         LEFT JOIN (
           SELECT date::date AS day, SUM(amount) AS exp
             FROM expenses
            WHERE tenant_id=$1 AND date >= now() - interval '30 days'
            GROUP BY day
         ) ex USING (day)
         ORDER BY day`,
      [tenantID],
    );
    const marginSpark = sparkRows.map((r) => (parseFloat(r.profit) || 0) - (parseFloat(r.expense) || 0));

    // Cash position: simple — cumulative cash + card on paid checks.
    // We use today's amount; richer interpretation can be wired later.
    const cashPosition = {
      cash: cashToday,
      card: cardToday,
      warranty: warrantyToday,
      total: cashToday + cardToday + warrantyToday,
    };

    // Deferred sum: open drafts (is_deferred=true) totals.
    const { rows: defRows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_revenue), 0) AS sum
         FROM checks WHERE tenant_id=$1 AND is_deferred=true`,
      [tenantID],
    );
    const deferredSum = {
      count: parseInt(defRows[0]?.cnt) || 0,
      sum: parseFloat(defRows[0]?.sum) || 0,
    };

    // Personal record: best day + best month all time.
    const { rows: bestDayRows } = await this.pool.query(
      `SELECT date::date AS day, SUM(total_revenue) AS revenue
         FROM checks WHERE tenant_id=$1 AND is_deferred=false
         GROUP BY day ORDER BY revenue DESC LIMIT 1`,
      [tenantID],
    );
    const { rows: bestMonthRows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS ym, SUM(total_revenue) AS revenue
         FROM checks WHERE tenant_id=$1 AND is_deferred=false
         GROUP BY ym ORDER BY revenue DESC LIMIT 1`,
      [tenantID],
    );
    const personalRecord = {
      bestDay: bestDayRows[0]
        ? {
            date:
              typeof bestDayRows[0].day === 'string'
                ? bestDayRows[0].day.slice(0, 10)
                : new Date(bestDayRows[0].day).toISOString().slice(0, 10),
            value: parseFloat(bestDayRows[0].revenue) || 0,
          }
        : undefined,
      bestMonth: bestMonthRows[0]
        ? {
            ym: bestMonthRows[0].ym as string,
            value: parseFloat(bestMonthRows[0].revenue) || 0,
          }
        : undefined,
    };

    // Month forecast: project current MTD revenue to end of month linearly.
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dayOfMonth = Math.max(today.getDate(), 1);
    const monthForecast = (revenueMonth / dayOfMonth) * daysInMonth;

    return {
      revenueToday,
      revenueMonth,
      checksToday,
      netProfitToday,
      netProfitMonth,
      cashPosition,
      marginPct: Math.round(marginPct * 10) / 10,
      marginPctChange: Math.round(marginPctChange * 10) / 10,
      marginSpark,
      deferredSum,
      personalRecord,
      monthForecast: Math.round(monthForecast),
      period,
    };
  }

  /**
   * "New vs returning" client split for the requested window. New = client's
   * first check falls inside the window; returning = client had a check
   * before the window started.
   */
  async clientsNewVsReturning(tenantID: string, params: { from: string; to: string }) {
    const from = this.safeDate(params?.from, '');
    const to = this.safeDate(params?.to, '');
    if (!from || !to) {
      return {
        newCount: 0,
        returningCount: 0,
        newRevenue: 0,
        returningRevenue: 0,
        period: { from: params?.from ?? '', to: params?.to ?? '' },
      };
    }
    params = { from, to };
    const { rows } = await this.pool.query(
      `WITH first_visits AS (
         SELECT client_id, MIN(date) AS first_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
          GROUP BY client_id
       ),
       window_checks AS (
         SELECT ch.client_id, ch.total_revenue, fv.first_date
           FROM checks ch
           LEFT JOIN first_visits fv ON fv.client_id = ch.client_id
          WHERE ch.tenant_id=$1 AND ch.is_deferred=false
            AND ch.client_id IS NOT NULL
            AND ch.date::date BETWEEN $2::date AND $3::date
       )
       SELECT
         COUNT(DISTINCT CASE WHEN first_date::date BETWEEN $2::date AND $3::date THEN client_id END) AS new_count,
         COUNT(DISTINCT CASE WHEN first_date::date < $2::date THEN client_id END) AS returning_count,
         COALESCE(SUM(CASE WHEN first_date::date BETWEEN $2::date AND $3::date THEN total_revenue END), 0) AS new_revenue,
         COALESCE(SUM(CASE WHEN first_date::date < $2::date THEN total_revenue END), 0) AS returning_revenue
       FROM window_checks`,
      [tenantID, params.from, params.to],
    );
    const r = rows[0];
    return {
      newCount: parseInt(r?.new_count) || 0,
      returningCount: parseInt(r?.returning_count) || 0,
      newRevenue: parseFloat(r?.new_revenue) || 0,
      returningRevenue: parseFloat(r?.returning_revenue) || 0,
      period: { from: params.from, to: params.to },
    };
  }

  /**
   * Top-10 owner alerts derived from existing modules — low stock, low
   * reviews, open warranty claims, late masters today, recent returns.
   * Order: crit → warn → info, then by recency. Cached 30s per tenant.
   */
  async alerts(tenantID: string) {
    return ttlCache.wrap(`reports:alerts:${tenantID}`, 30_000, () => this.computeAlerts(tenantID));
  }

  private async computeAlerts(tenantID: string) {
    const out: Array<{
      type: 'low_stock' | 'low_review' | 'warranty' | 'late_master' | 'pending_return';
      severity: 'info' | 'warn' | 'crit';
      message: string;
      link?: string;
    }> = [];

    // Low-stock items (≤ min_stock AND min_stock > 0).
    const { rows: low } = await this.pool.query(
      `SELECT id, name, stock, min_stock FROM products
        WHERE tenant_id=$1 AND deleted_at IS NULL
          AND stock <= min_stock AND min_stock > 0
        ORDER BY (min_stock - stock) DESC LIMIT 5`,
      [tenantID],
    );
    for (const p of low) {
      const sev = parseFloat(p.stock) <= 0 ? 'crit' : 'warn';
      out.push({
        type: 'low_stock',
        severity: sev,
        message: `${p.name}: ${p.stock}/${p.min_stock}`,
        link: `/products/${p.id}`,
      });
    }

    // Low reviews (≤3 in last 7 days)
    const { rows: lowRev } = await this.pool.query(
      `SELECT rr.id, rr.rating, cl.full_name AS client_name, u.full_name AS employee_name
         FROM review_responses rr
         LEFT JOIN clients cl ON cl.id = rr.client_id
         LEFT JOIN users u ON u.id = rr.employee_id
        WHERE rr.tenant_id=$1
          AND rr.created_at >= now() - interval '7 days'
          AND rr.rating <= 3
        ORDER BY rr.created_at DESC LIMIT 5`,
      [tenantID],
    );
    for (const r of lowRev) {
      out.push({
        type: 'low_review',
        severity: parseInt(r.rating) <= 2 ? 'crit' : 'warn',
        message: `Низкая оценка ${r.rating}★ — ${r.client_name ?? 'клиент'} → ${r.employee_name ?? 'сотрудник'}`,
        link: '/marketing',
      });
    }

    // Open warranty claims (not used + expires within 7 days)
    const { rows: war } = await this.pool.query(
      `SELECT id, item_name, expires_at FROM warranty_claims
        WHERE tenant_id=$1 AND used_at IS NULL
          AND expires_at <= now() + interval '7 days'
          AND expires_at >= now()
        ORDER BY expires_at ASC LIMIT 5`,
      [tenantID],
    );
    for (const w of war) {
      out.push({
        type: 'warranty',
        severity: 'info',
        message: `Гарантия скоро истечёт: ${w.item_name ?? 'позиция'}`,
        link: `/warranty/${w.id}`,
      });
    }

    // Late masters today (schedule_entries with late_status = late_major today)
    const { rows: lateMasters } = await this.pool.query(
      `SELECT u.full_name FROM schedule_entries se
        JOIN users u ON u.id = se.user_id
       WHERE se.tenant_id=$1
         AND se.date = (now() AT TIME ZONE 'Europe/Moscow')::date
         AND se.late_status = 'late_major'
       LIMIT 5`,
      [tenantID],
    );
    for (const m of lateMasters) {
      out.push({
        type: 'late_master',
        severity: 'warn',
        message: `${m.full_name} — опоздал`,
        link: '/schedule',
      });
    }

    // Recent returns (last 24h)
    const { rows: rets } = await this.pool.query(
      `SELECT cr.id, ch.number AS check_number, cr.created_at
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id
        WHERE cr.tenant_id=$1 AND cr.created_at >= now() - interval '1 day'
        ORDER BY cr.created_at DESC LIMIT 5`,
      [tenantID],
    );
    for (const r of rets) {
      out.push({
        type: 'pending_return',
        severity: 'info',
        message: `Возврат по заказ-наряду #${r.check_number}`,
        link: '/returns',
      });
    }

    // Severity sort: crit > warn > info; cap to 10.
    const order: Record<string, number> = { crit: 0, warn: 1, info: 2 };
    out.sort((a, b) => order[a.severity] - order[b.severity]);
    return out.slice(0, 10);
  }

  /** Aggregate revenue by weekday for the period. */
  async bestDayOfWeek(tenantID: string, params: { from: string; to: string }) {
    const from = this.safeDate(params?.from, '');
    const to = this.safeDate(params?.to, '');
    if (!from || !to) {
      return { days: [], best: 0, worst: 0 };
    }
    params = { from, to };
    const { rows } = await this.pool.query(
      `SELECT EXTRACT(DOW FROM date)::int AS weekday,
              COALESCE(SUM(total_revenue), 0) AS revenue,
              COUNT(*) AS cnt
         FROM checks
        WHERE tenant_id=$1 AND is_deferred=false
          AND date::date BETWEEN $2::date AND $3::date
        GROUP BY weekday
        ORDER BY weekday`,
      [tenantID, params.from, params.to],
    );
    const map: Record<number, { weekday: number; revenue: number; count: number }> = {};
    for (let i = 0; i <= 6; i++) map[i] = { weekday: i, revenue: 0, count: 0 };
    for (const r of rows) {
      const wd = parseInt(r.weekday);
      map[wd] = { weekday: wd, revenue: parseFloat(r.revenue) || 0, count: parseInt(r.cnt) || 0 };
    }
    const days = Object.values(map);
    let best = 0,
      worst = 0,
      bestVal = -Infinity,
      worstVal = Infinity;
    for (const d of days) {
      if (d.revenue > bestVal) {
        bestVal = d.revenue;
        best = d.weekday;
      }
      if (d.revenue < worstVal) {
        worstVal = d.revenue;
        worst = d.weekday;
      }
    }
    return { days, best, worst };
  }

  async recentReviews(tenantID: string, limit = 5) {
    const cap = Math.min(Math.max(limit, 1), 50);
    const { rows } = await this.pool.query(
      `SELECT rr.id, rr.rating, rr.comment, rr.created_at,
              cl.full_name AS client_name,
              u.full_name AS employee_name
         FROM review_responses rr
         LEFT JOIN clients cl ON cl.id = rr.client_id
         LEFT JOIN users u ON u.id = rr.employee_id
        WHERE rr.tenant_id=$1
        ORDER BY rr.created_at DESC
        LIMIT $2`,
      [tenantID, cap],
    );
    return rows.map((r) => ({
      id: r.id,
      rating: parseInt(r.rating) || 0,
      comment: r.comment,
      clientName: r.client_name,
      employeeName: r.employee_name,
      createdAt: r.created_at,
    }));
  }

  /**
   * Client retention stats for the requested rolling period (week / month / year).
   * Returns the share of returning clients (i.e. clients who had any earlier
   * check before this window) and average LTV / days between visits.
   */
  async retention(tenantID: string, period: 'week' | 'month' | 'year' = 'month') {
    const interval = period === 'week' ? '7 days' : period === 'year' ? '365 days' : '30 days';
    const { rows } = await this.pool.query(
      `WITH visits AS (
         SELECT client_id, COUNT(*) AS visit_count, SUM(total_revenue) AS ltv,
                MIN(date) AS first_date, MAX(date) AS last_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND date >= now() - interval '${interval}'
            AND client_id IS NOT NULL
       )
       SELECT
         COUNT(*) AS total_in_window,
         COUNT(*) FILTER (WHERE v.visit_count > 1) AS returning,
         COALESCE(AVG(v.ltv), 0) AS avg_ltv,
         COALESCE(AVG(EXTRACT(EPOCH FROM (v.last_date - v.first_date)) / 86400 / NULLIF(v.visit_count - 1, 0)), 0) AS avg_days_between
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id`,
      [tenantID],
    );
    const r = rows[0];
    const total = parseInt(r?.total_in_window) || 0;
    const returning = parseInt(r?.returning) || 0;
    return {
      returningRate: total > 0 ? Math.round((returning / total) * 1000) / 10 : 0,
      avgLtv: Math.round(parseFloat(r?.avg_ltv) || 0),
      avgDaysBetweenVisits: Math.round(parseFloat(r?.avg_days_between) || 0),
    };
  }

  async returnsSummaryForDashboard(tenantID: string) {
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString();
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(refund_amount), 0) AS sum
         FROM check_returns
        WHERE tenant_id=$1 AND created_at >= $2`,
      [tenantID, todayStart],
    );
    return {
      returnsToday: parseInt(rows[0]?.cnt) || 0,
      returnsAmount: parseFloat(rows[0]?.sum) || 0,
    };
  }
}
