import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

export type Period = 'week' | 'month' | 'quarter' | 'year';
export type Urgency = 'critical' | 'now' | 'soon' | 'overstocked';

export interface DeadStockBucket {
  count: number;
  value: number;
}

export interface AbcTier {
  tier: 'A' | 'B' | 'C';
  count: number;
  value: number;
  pct: number;
}

export interface VelocityRow {
  productId: string;
  name: string;
  soldQty: number;
  avgDailySales: number;
  currentStock: number;
  daysOfStock: number;
}

export interface ReorderItem {
  productId: string;
  name: string;
  currentStock: number;
  avgDailySales: number;
  daysOfStock: number;
  urgency: Urgency;
  recommendedOrderQty: number;
}

export interface CategoryMarginRow {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  soldQty: number;
  revenue: number;
  profit: number;
}

export interface WarehouseSummary {
  stockValueStart: number;
  stockValueCurrent: number;
  stockValueDelta: number;
  deltaPct: number;
  itemsCount: number;
  deadStock30: DeadStockBucket;
  deadStock60: DeadStockBucket;
  deadStock90: DeadStockBucket;
  abcAnalysis: AbcTier[];
  avgMargin: number;
  gmroi: number;
  overStocked: { id: string; name: string; stock: number; sales: number }[];
  understocked: { id: string; name: string; stock: number; sales: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function periodDays(period: Period): number {
  switch (period) {
    case 'week':
      return 7;
    case 'quarter':
      return 90;
    case 'year':
      return 365;
    case 'month':
    default:
      return 30;
  }
}

@Injectable()
export class WarehouseAnalyticsService {
  private readonly logger = new Logger('WarehouseAnalyticsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Verify the optional warehouseId belongs to the caller's tenant. Treats
   * undefined / null / "all" as "no filter" so the calling routes don't have
   * to repeat the same guard.
   */
  private async assertWarehouseInTenant(tenantID: string, warehouseId?: string): Promise<string | null> {
    if (!warehouseId || warehouseId === 'all') return null;
    const { rows } = await this.pool.query('SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      warehouseId,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Склад не найден' });
    }
    return rows[0].id;
  }

  /**
   * Compute the daily snapshot for every warehouse in every tenant plus a
   * tenant-wide aggregate row (warehouse_id IS NULL). Idempotent via the
   * unique index uniq_stock_snapshot_per_day, so re-running the same day
   * is a no-op.
   */
  async recomputeDailySnapshots(): Promise<{ written: number }> {
    let written = 0;
    try {
      // Per-warehouse snapshot
      const perWarehouse = await this.pool.query(
        `INSERT INTO stock_value_snapshots (tenant_id, warehouse_id, snapshot_date, total_cost_value, total_sell_value, items_count)
         SELECT
           p.tenant_id,
           p.warehouse_id,
           CURRENT_DATE,
           COALESCE(SUM(p.cost_price * p.stock), 0),
           COALESCE(SUM(p.sell_price * p.stock), 0),
           COUNT(*)
         FROM products p
         WHERE p.deleted_at IS NULL
         GROUP BY p.tenant_id, p.warehouse_id
         ON CONFLICT (tenant_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_date)
         DO UPDATE SET
           total_cost_value = EXCLUDED.total_cost_value,
           total_sell_value = EXCLUDED.total_sell_value,
           items_count = EXCLUDED.items_count`,
      );
      written += perWarehouse.rowCount ?? 0;

      // Tenant aggregate (warehouse_id NULL)
      const aggregate = await this.pool.query(
        `INSERT INTO stock_value_snapshots (tenant_id, warehouse_id, snapshot_date, total_cost_value, total_sell_value, items_count)
         SELECT
           p.tenant_id,
           NULL,
           CURRENT_DATE,
           COALESCE(SUM(p.cost_price * p.stock), 0),
           COALESCE(SUM(p.sell_price * p.stock), 0),
           COUNT(*)
         FROM products p
         WHERE p.deleted_at IS NULL
         GROUP BY p.tenant_id
         ON CONFLICT (tenant_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_date)
         DO UPDATE SET
           total_cost_value = EXCLUDED.total_cost_value,
           total_sell_value = EXCLUDED.total_sell_value,
           items_count = EXCLUDED.items_count`,
      );
      written += aggregate.rowCount ?? 0;
    } catch (err) {
      this.logger.error(`recomputeDailySnapshots failed: ${err}`);
    }
    return { written };
  }

  // ── /summary ──────────────────────────────────────────────────────────────

  async getSummary(tenantID: string, params: { warehouseId?: string; period?: Period }): Promise<WarehouseSummary> {
    const warehouseId = await this.assertWarehouseInTenant(tenantID, params.warehouseId);
    const period = params.period ?? 'month';
    const days = periodDays(period);
    const periodStart = new Date(Date.now() - days * DAY_MS);
    const periodStartIso = periodStart.toISOString();
    const periodStartDate = periodStartIso.slice(0, 10);

    const productFilter = warehouseId ? 'AND p.warehouse_id = $2' : '';
    const productParams: any[] = [tenantID];
    if (warehouseId) productParams.push(warehouseId);

    // Current totals
    const { rows: currentRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(p.cost_price * p.stock), 0) as total_cost_value,
         COALESCE(SUM(p.sell_price * p.stock), 0) as total_sell_value,
         COUNT(*) FILTER (WHERE p.deleted_at IS NULL) as items_count
       FROM products p
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL ${productFilter}`,
      productParams,
    );
    const stockValueCurrent = parseFloat(currentRows[0].total_cost_value) || 0;
    const itemsCount = parseInt(currentRows[0].items_count) || 0;

    // Historical stock value at period start (most recent snapshot on or before periodStartDate)
    const snapshotConds: string[] = ['tenant_id = $1', 'snapshot_date <= $2'];
    const snapshotParams: any[] = [tenantID, periodStartDate];
    if (warehouseId) {
      snapshotConds.push('warehouse_id = $3');
      snapshotParams.push(warehouseId);
    } else {
      snapshotConds.push('warehouse_id IS NULL');
    }
    const { rows: histRows } = await this.pool.query(
      `SELECT total_cost_value FROM stock_value_snapshots
        WHERE ${snapshotConds.join(' AND ')}
        ORDER BY snapshot_date DESC LIMIT 1`,
      snapshotParams,
    );
    const stockValueStart = histRows.length > 0 ? parseFloat(histRows[0].total_cost_value) || 0 : stockValueCurrent;
    const stockValueDelta = stockValueCurrent - stockValueStart;
    const deltaPct = stockValueStart > 0 ? (stockValueDelta / stockValueStart) * 100 : 0;

    // Sales aggregates per product within the period (cost + revenue)
    const salesParams: any[] = [tenantID, periodStartIso];
    let salesFilter = '';
    if (warehouseId) {
      salesParams.push(warehouseId);
      salesFilter = `AND p.warehouse_id = $${salesParams.length}`;
    }
    // round-11 #10 / FIX #3: the check filters (not-returned / not-deferred /
    // not-deleted / in-window) live in the SECOND LEFT JOIN's ON clause, so a
    // non-matching check only NULLs ch.* while the cpl row is retained. We must
    // therefore GATE every summed cpl column on `ch.id IS NOT NULL` (true exactly
    // when the join matched) — otherwise returned/deferred/deleted/out-of-window
    // lines still aggregate into revenue/cost/qty (the previous silent bug). The
    // LEFT JOIN stays a LEFT JOIN so EVERY product is still listed (zero-sales
    // products are needed for stock / ABC / over-/under-stock). MAX(ch.date)
    // ignores the NULLed non-matches on its own.
    const { rows: salesRows } = await this.pool.query(
      `SELECT
         p.id,
         p.name,
         p.stock,
         p.cost_price,
         COALESCE(SUM(CASE WHEN ch.id IS NOT NULL THEN cpl.quantity ELSE 0 END), 0) as sold_qty,
         COALESCE(SUM(CASE WHEN ch.id IS NOT NULL THEN cpl.total_sell ELSE 0 END), 0) as revenue,
         COALESCE(SUM(CASE WHEN ch.id IS NOT NULL THEN cpl.total_cost ELSE 0 END), 0) as cost,
         MAX(ch.date) as last_sold_at
       FROM products p
       LEFT JOIN check_product_lines cpl ON cpl.product_id = p.id
       LEFT JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.is_returned = false AND ch.deleted_at IS NULL AND ch.date >= $2
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL ${salesFilter}
       GROUP BY p.id, p.name, p.stock, p.cost_price`,
      salesParams,
    );

    // Dead-stock buckets — products without any sale movement in N days
    const now = Date.now();
    const dead30: DeadStockBucket = { count: 0, value: 0 };
    const dead60: DeadStockBucket = { count: 0, value: 0 };
    const dead90: DeadStockBucket = { count: 0, value: 0 };

    // To compute "no sales in N days" we need to query the LAST sale per
    // product across the WHOLE history, not just within the analytics window.
    const lastSaleParams: any[] = [tenantID];
    let lastSaleFilter = '';
    if (warehouseId) {
      lastSaleParams.push(warehouseId);
      lastSaleFilter = `AND p.warehouse_id = $${lastSaleParams.length}`;
    }
    const { rows: lastSaleRows } = await this.pool.query(
      `SELECT p.id, p.stock, p.cost_price, MAX(ch.date) as last_sold_at
       FROM products p
       LEFT JOIN check_product_lines cpl ON cpl.product_id = p.id
       LEFT JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL ${lastSaleFilter}
       GROUP BY p.id, p.stock, p.cost_price`,
      lastSaleParams,
    );

    for (const r of lastSaleRows) {
      const stock = parseFloat(r.stock) || 0;
      const cost = parseFloat(r.cost_price) || 0;
      const value = stock * cost;
      if (stock <= 0) continue;
      const lastSold = r.last_sold_at ? new Date(r.last_sold_at).getTime() : 0;
      const daysSince = lastSold === 0 ? Infinity : Math.floor((now - lastSold) / DAY_MS);
      if (daysSince >= 30) {
        dead30.count += 1;
        dead30.value += value;
      }
      if (daysSince >= 60) {
        dead60.count += 1;
        dead60.value += value;
      }
      if (daysSince >= 90) {
        dead90.count += 1;
        dead90.value += value;
      }
    }

    // ABC analysis — sort products by revenue desc, cumulative split 80/15/5
    const sortedByRevenue = [...salesRows]
      .map((r) => ({
        revenue: parseFloat(r.revenue) || 0,
        stock: parseFloat(r.stock) || 0,
        cost: parseFloat(r.cost_price) || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = sortedByRevenue.reduce((sum, r) => sum + r.revenue, 0);
    const abc: { [k in 'A' | 'B' | 'C']: AbcTier } = {
      A: { tier: 'A', count: 0, value: 0, pct: 0 },
      B: { tier: 'B', count: 0, value: 0, pct: 0 },
      C: { tier: 'C', count: 0, value: 0, pct: 0 },
    };
    let cumulative = 0;
    for (const r of sortedByRevenue) {
      const stockValue = r.stock * r.cost;
      cumulative += r.revenue;
      const ratio = totalRevenue > 0 ? cumulative / totalRevenue : 1;
      let tier: 'A' | 'B' | 'C';
      if (ratio <= 0.8) tier = 'A';
      else if (ratio <= 0.95) tier = 'B';
      else tier = 'C';
      abc[tier].count += 1;
      abc[tier].value += stockValue;
    }
    const totalAbcValue = abc.A.value + abc.B.value + abc.C.value;
    for (const tier of ['A', 'B', 'C'] as const) {
      abc[tier].pct = totalAbcValue > 0 ? (abc[tier].value / totalAbcValue) * 100 : 0;
    }

    // Average margin (per-product) and GMROI = gross profit / avg cost value
    let marginSum = 0;
    let marginCount = 0;
    let totalProfit = 0;
    for (const r of salesRows) {
      const revenue = parseFloat(r.revenue) || 0;
      const cost = parseFloat(r.cost) || 0;
      if (revenue > 0) {
        marginSum += ((revenue - cost) / revenue) * 100;
        marginCount += 1;
      }
      totalProfit += revenue - cost;
    }
    const avgMargin = marginCount > 0 ? marginSum / marginCount : 0;
    const avgCostValue = (stockValueStart + stockValueCurrent) / 2;
    const gmroi = avgCostValue > 0 ? totalProfit / avgCostValue : 0;

    // Over- / under-stocked: compute days-of-stock = stock / avgDailySales
    const overStocked: { id: string; name: string; stock: number; sales: number }[] = [];
    const understocked: { id: string; name: string; stock: number; sales: number }[] = [];
    for (const r of salesRows) {
      const stock = parseFloat(r.stock) || 0;
      const soldQty = parseFloat(r.sold_qty) || 0;
      const avgDaily = soldQty / days;
      const daysOfStock = avgDaily > 0 ? stock / avgDaily : Infinity;
      if (stock > 0 && daysOfStock > 180) {
        overStocked.push({ id: r.id, name: r.name, stock, sales: soldQty });
      } else if (avgDaily > 0 && stock > 0 && daysOfStock < 7) {
        understocked.push({ id: r.id, name: r.name, stock, sales: soldQty });
      }
    }
    overStocked.sort((a, b) => b.stock - a.stock);
    understocked.sort((a, b) => b.sales - a.sales);

    return {
      stockValueStart,
      stockValueCurrent,
      stockValueDelta,
      deltaPct,
      itemsCount,
      deadStock30: dead30,
      deadStock60: dead60,
      deadStock90: dead90,
      abcAnalysis: [abc.A, abc.B, abc.C],
      avgMargin,
      gmroi,
      overStocked: overStocked.slice(0, 20),
      understocked: understocked.slice(0, 20),
    };
  }

  // ── /velocity ─────────────────────────────────────────────────────────────

  async getVelocity(tenantID: string, params: { warehouseId?: string; period?: Period }): Promise<VelocityRow[]> {
    const warehouseId = await this.assertWarehouseInTenant(tenantID, params.warehouseId);
    const period = params.period ?? 'month';
    const days = periodDays(period);
    const periodStartIso = new Date(Date.now() - days * DAY_MS).toISOString();

    const conds: string[] = ['p.tenant_id = $1', 'p.deleted_at IS NULL'];
    const sqlParams: any[] = [tenantID, periodStartIso];
    if (warehouseId) {
      conds.push(`p.warehouse_id = $3`);
      sqlParams.push(warehouseId);
    }

    const { rows } = await this.pool.query(
      `SELECT
         p.id,
         p.name,
         p.stock,
         COALESCE(SUM(cpl.quantity), 0) as sold_qty
       FROM products p
       LEFT JOIN check_product_lines cpl ON cpl.product_id = p.id
       LEFT JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL AND ch.date >= $2
       WHERE ${conds.join(' AND ')}
       GROUP BY p.id, p.name, p.stock
       ORDER BY sold_qty DESC NULLS LAST, p.name`,
      sqlParams,
    );

    return rows.map((r) => {
      const soldQty = parseFloat(r.sold_qty) || 0;
      const currentStock = parseFloat(r.stock) || 0;
      const avgDailySales = soldQty / days;
      const daysOfStock = avgDailySales > 0 ? currentStock / avgDailySales : Infinity;
      return {
        productId: r.id,
        name: r.name,
        soldQty,
        avgDailySales,
        currentStock,
        daysOfStock: Number.isFinite(daysOfStock) ? daysOfStock : 9999,
      };
    });
  }

  // ── /reorder-forecast ─────────────────────────────────────────────────────

  async getReorderForecast(tenantID: string, params: { warehouseId?: string }): Promise<ReorderItem[]> {
    const warehouseId = await this.assertWarehouseInTenant(tenantID, params.warehouseId);
    const conds: string[] = ['p.tenant_id = $1', 'p.deleted_at IS NULL'];
    const sqlParams: any[] = [tenantID];
    if (warehouseId) {
      conds.push(`p.warehouse_id = $2`);
      sqlParams.push(warehouseId);
    }

    const days30Iso = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const days60Iso = new Date(Date.now() - 60 * DAY_MS).toISOString();
    const days90Iso = new Date(Date.now() - 90 * DAY_MS).toISOString();
    sqlParams.push(days30Iso, days60Iso, days90Iso);
    const days30Idx = sqlParams.length - 2;
    const days60Idx = sqlParams.length - 1;
    const days90Idx = sqlParams.length;

    // Pull 30/60/90 day sale totals in one go.
    const { rows } = await this.pool.query(
      `SELECT
         p.id,
         p.name,
         p.stock,
         COALESCE(SUM(CASE WHEN ch.date >= $${days30Idx} THEN cpl.quantity ELSE 0 END), 0) as sold_30,
         COALESCE(SUM(CASE WHEN ch.date >= $${days60Idx} THEN cpl.quantity ELSE 0 END), 0) as sold_60,
         COALESCE(SUM(CASE WHEN ch.date >= $${days90Idx} THEN cpl.quantity ELSE 0 END), 0) as sold_90
       FROM products p
       LEFT JOIN check_product_lines cpl ON cpl.product_id = p.id
       LEFT JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
       WHERE ${conds.join(' AND ')}
       GROUP BY p.id, p.name, p.stock`,
      sqlParams,
    );

    const out: ReorderItem[] = [];
    for (const r of rows) {
      const stock = parseFloat(r.stock) || 0;
      const sold30 = parseFloat(r.sold_30) || 0;
      const sold60 = parseFloat(r.sold_60) || 0;
      const sold90 = parseFloat(r.sold_90) || 0;
      // Weighted average — last 30d gets the largest weight, but if 30d is
      // zero we fall back further.
      const avg30 = sold30 / 30;
      const avg60 = sold60 / 60;
      const avg90 = sold90 / 90;
      const candidate = [avg30, avg60, avg90].filter((v) => v > 0);
      const avgDailySales = candidate.length > 0 ? candidate.reduce((s, v) => s + v, 0) / candidate.length : 0;
      const daysOfStock = avgDailySales > 0 ? stock / avgDailySales : Infinity;

      let urgency: Urgency | null = null;
      if (daysOfStock < 3) urgency = 'critical';
      else if (daysOfStock < 7) urgency = 'now';
      else if (daysOfStock < 14) urgency = 'soon';
      else if (daysOfStock > 180) urgency = 'overstocked';

      if (!urgency) continue;
      const recommendedOrderQty = urgency === 'overstocked' ? 0 : Math.max(0, Math.ceil(avgDailySales * 30 - stock));
      out.push({
        productId: r.id,
        name: r.name,
        currentStock: stock,
        avgDailySales,
        daysOfStock: Number.isFinite(daysOfStock) ? daysOfStock : 9999,
        urgency,
        recommendedOrderQty,
      });
    }
    // Critical first, then now / soon / overstocked
    const order: Record<Urgency, number> = { critical: 0, now: 1, soon: 2, overstocked: 3 };
    out.sort((a, b) => order[a.urgency] - order[b.urgency] || a.daysOfStock - b.daysOfStock);
    return out;
  }

  // ── /category-margin ──────────────────────────────────────────────────────

  async getCategoryMargin(tenantID: string, params: { period?: Period }): Promise<CategoryMarginRow[]> {
    const period = params.period ?? 'month';
    const periodStartIso = new Date(Date.now() - periodDays(period) * DAY_MS).toISOString();

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(p.category, '—') as category,
         COALESCE(SUM(cpl.total_sell), 0) as revenue,
         COALESCE(SUM(cpl.total_cost), 0) as cost
       FROM check_product_lines cpl
       JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.is_returned = false AND ch.deleted_at IS NULL AND ch.date >= $2
       JOIN products p ON p.id = cpl.product_id
       GROUP BY p.category
       ORDER BY revenue DESC`,
      [tenantID, periodStartIso],
    );

    return rows.map((r) => {
      const revenue = parseFloat(r.revenue) || 0;
      const cost = parseFloat(r.cost) || 0;
      const margin = revenue - cost;
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
      return { category: r.category, revenue, cost, margin, marginPct };
    });
  }

  // ── /top-moving ───────────────────────────────────────────────────────────

  async getTopMoving(tenantID: string, params: { period?: Period; limit?: number }): Promise<TopProductRow[]> {
    const period = params.period ?? 'month';
    const limit = Math.max(1, Math.min(parseInt(String(params.limit ?? 10), 10) || 10, 100));
    const periodStartIso = new Date(Date.now() - periodDays(period) * DAY_MS).toISOString();

    const { rows } = await this.pool.query(
      `SELECT
         p.id,
         p.name,
         COALESCE(SUM(cpl.quantity), 0) as sold_qty,
         COALESCE(SUM(cpl.total_sell), 0) as revenue,
         COALESCE(SUM(cpl.total_sell - cpl.total_cost), 0) as profit
       FROM check_product_lines cpl
       JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.is_returned = false AND ch.deleted_at IS NULL AND ch.date >= $2
       JOIN products p ON p.id = cpl.product_id
       GROUP BY p.id, p.name
       ORDER BY sold_qty DESC
       LIMIT $3`,
      [tenantID, periodStartIso, limit],
    );

    return rows.map((r) => ({
      productId: r.id,
      name: r.name,
      soldQty: parseFloat(r.sold_qty) || 0,
      revenue: parseFloat(r.revenue) || 0,
      profit: parseFloat(r.profit) || 0,
    }));
  }

  // ── /top-margin ───────────────────────────────────────────────────────────

  async getTopMargin(tenantID: string, params: { period?: Period; limit?: number }): Promise<TopProductRow[]> {
    const period = params.period ?? 'month';
    const limit = Math.max(1, Math.min(parseInt(String(params.limit ?? 10), 10) || 10, 100));
    const periodStartIso = new Date(Date.now() - periodDays(period) * DAY_MS).toISOString();

    const { rows } = await this.pool.query(
      `SELECT
         p.id,
         p.name,
         COALESCE(SUM(cpl.quantity), 0) as sold_qty,
         COALESCE(SUM(cpl.total_sell), 0) as revenue,
         COALESCE(SUM(cpl.total_sell - cpl.total_cost), 0) as profit
       FROM check_product_lines cpl
       JOIN checks ch ON ch.id = cpl.check_id AND ch.tenant_id = $1 AND ch.is_deferred = false AND ch.is_returned = false AND ch.deleted_at IS NULL AND ch.date >= $2
       JOIN products p ON p.id = cpl.product_id
       GROUP BY p.id, p.name
       ORDER BY profit DESC
       LIMIT $3`,
      [tenantID, periodStartIso, limit],
    );

    return rows.map((r) => ({
      productId: r.id,
      name: r.name,
      soldQty: parseFloat(r.sold_qty) || 0,
      revenue: parseFloat(r.revenue) || 0,
      // round-11 #10 / FIX 4: return the REAL profit (may be negative) so
      // getTopMargin is consistent with getTopMoving / getCategoryMargin, which
      // never clamp. ORDER BY profit DESC still surfaces the top earners first;
      // a loss-making product is now visible instead of silently shown as 0.
      profit: parseFloat(r.profit) || 0,
    }));
  }
}
