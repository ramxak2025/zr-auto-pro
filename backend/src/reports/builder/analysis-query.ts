import { Pool } from 'pg';
import { checkMoneyBaseWhere } from '../../common/check-money-sql';
import { pointFilterSql } from '../../common/point-scope';
import { MAIN_ROW_LIMIT, ReportContext } from './report-context';
import { baseParams, dayKey, inPeriod } from './report-sql';

export type AnalysisKind = 'all' | 'products' | 'services';
export type AnalysisBasis = 'revenue' | 'gross';

export interface AnalysisRow {
  key: string;
  name: string;
  kind: 'product' | 'service' | 'adjustment';
  entity_id: string | null;
  category: string | null;
  stock: number | null;
  qty: number;
  revenue: number;
  cost: number | null;
  gross: number | null;
  checks: number;
  unknown_cost: number;
  zero_cost: number;
  value: number | null;
  tier: 'A' | 'B' | 'C' | null;
  share: number | null;
  cumulative: number | null;
}

export interface AnalysisTotals {
  revenue: number;
  cost: number | null;
  gross: number | null;
  product_qty: number;
  service_qty: number;
  checks: number;
  unknown_cost: number;
  zero_cost: number;
  groups: number;
  positive_value: number;
  ranked_count: number;
}

export interface AnalysisData {
  rows: AnalysisRow[];
  totals: AnalysisTotals;
  kinds: Array<{ kind: AnalysisRow['kind']; revenue: number; cost: number | null; gross: number | null }>;
  timeline: Array<{ day: string; revenue: number; cost: number | null; gross: number | null }>;
  tiers: Array<{ tier: 'A' | 'B' | 'C'; count: number; value: number; share: number }>;
  adjustment: { revenue: number; cost: number | null; checks: number };
  warehouse_tiers?: Array<{ tier: 'A' | 'B' | 'C'; count: number; value: number; pct: number }>;
}

export function analysisSelection(groupBy: string | null): { kind: AnalysisKind; basis: AnalysisBasis } {
  const [basis, kind] = (groupBy ?? '').split('-');
  return {
    basis: basis === 'gross' ? 'gross' : 'revenue',
    kind: [kind, groupBy].includes('products') ? 'products' : [kind, groupBy].includes('services') ? 'services' : 'all',
  };
}

/**
 * One bounded query, including full totals and ABC BEFORE the display limit.
 * Money comes from posted check snapshots, never today's catalogue prices.
 * Product-only discount is allocated in cents by cumulative rounding. Returns
 * keep their saved line amounts; a custom/capped refund or historical header
 * mismatch remains an explicit adjustment, never an invented item allocation.
 * A full defect return removes sales/quantity but retains its recorded COGS.
 * NULL costs stay unknown; a recorded zero is shown and flagged for review.
 */
export async function loadAnalysis(
  pool: Pool,
  ctx: Pick<ReportContext, 'tenantId' | 'pointId' | 'dateFrom' | 'dateTo' | 'tz' | 'days'>,
  options: {
    kind?: AnalysisKind;
    basis?: AnalysisBasis;
    byCategory?: boolean;
    /** Warehouse card reuses classification; only its authorised catalogue IDs and exact rolling window. */
    warehouse?: { productIds: string[]; from: string; to: string };
  } = {},
): Promise<AnalysisData> {
  const { kind = 'all', basis = 'revenue', byCategory = false } = options;
  const params = baseParams(ctx);
  const point = pointFilterSql('ch', ctx.pointId, params);
  let selected = kind === 'products' ? "kind = 'product'" : kind === 'services' ? "kind = 'service'" : 'true';
  let period = inPeriod('ch.date');
  let warehouseTiers = '';
  if (options.warehouse) {
    params.push(options.warehouse.productIds);
    const productIds = `$${params.length}::uuid[]`;
    selected += ` AND entity_id = ANY(${productIds})`;
    params[1] = options.warehouse.from;
    params[2] = options.warehouse.to;
    period = 'ch.date >= $2::timestamptz AND ch.date <= $3::timestamptz';
    warehouseTiers = `, 'warehouse_tiers', (SELECT COALESCE(jsonb_agg(w ORDER BY tier), '[]'::jsonb) FROM (
      SELECT *, CASE WHEN SUM(value) OVER () > 0 THEN value / SUM(value) OVER () * 100 ELSE 0 END AS pct FROM (
        SELECT COALESCE(c.tier, 'C') AS tier, COUNT(*)::int AS count,
               COALESCE(SUM(p.stock * p.cost_price), 0) AS value
          FROM products p LEFT JOIN classified c ON c.entity_id = p.id::text
         WHERE p.tenant_id = $1 AND p.id = ANY(${productIds})
         GROUP BY COALESCE(c.tier, 'C')
      ) stock_groups
    ) w)`;
  }
  const groupKey = byCategory ? "'category:' || COALESCE(category, 'Без папки')" : 'key';
  const groupName = byCategory ? "COALESCE(category, 'Без папки')" : 'MIN(name)';
  const timelineDay = ctx.days > 93 ? "to_char(date_trunc('week', day::date), 'YYYY-MM-DD')" : 'day';
  const { rows } = await pool.query<{ data: AnalysisData }>(
    `WITH checks_base AS MATERIALIZED (
       SELECT ch.id, ${dayKey('ch.date')} AS day, ch.total_revenue, ch.product_cost_total,
              ch.discount, ch.product_total, ch.is_returned, ch.return_scope, ch.return_destination
         FROM checks ch
        WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')} AND ${period}
          AND ch.payment_method IS DISTINCT FROM 'warranty'${point}
     ), returned AS (
       SELECT cr.check_id, rl.product_line_id, rl.service_line_id, SUM(rl.quantity) AS qty, SUM(rl.amount) AS amount,
              SUM(rl.quantity) FILTER (WHERE cr.destination = 'warehouse') AS qty_back
         FROM check_returns cr
         JOIN checks_base ch ON ch.id = cr.check_id
         JOIN check_return_lines rl ON rl.return_id = cr.id
        WHERE cr.tenant_id = $1
        GROUP BY cr.check_id, rl.product_line_id, rl.service_line_id
     ), product_base AS (
       SELECT ch.*, pl.id AS line_id, pl.product_id, pl.name, pl.quantity, pl.total_sell, pl.total_cost,
              p.category, p.stock, COALESCE(r.qty, 0) AS returned_qty,
              COALESCE(r.amount, 0) AS returned_amount, COALESCE(r.qty_back, 0) AS qty_back,
              SUM(GREATEST(COALESCE(pl.total_sell, 0), 0)) OVER (PARTITION BY ch.id) AS sell_sum,
              SUM(GREATEST(COALESCE(pl.total_sell, 0), 0)) OVER (PARTITION BY ch.id ORDER BY pl.id) AS sell_through
         FROM checks_base ch
         JOIN check_product_lines pl ON pl.check_id = ch.id
         LEFT JOIN returned r ON r.check_id = ch.id AND r.product_line_id = pl.id AND r.service_line_id IS NULL
         LEFT JOIN products p ON p.id = pl.product_id AND p.tenant_id = $1
     ), product_values AS (
       SELECT id AS check_id, day, 'product'::text AS kind,
              'product:' || COALESCE(product_id::text, 'name:' || lower(btrim(name))) AS key,
              name, product_id AS entity_id, NULLIF(category, '') AS category, stock,
              CASE WHEN is_returned AND return_scope = 'full' THEN 0
                   ELSE GREATEST(COALESCE(quantity, 0) - returned_qty, 0) END AS qty,
              CASE WHEN is_returned AND return_scope = 'full' THEN 0 ELSE
                COALESCE(total_sell, 0) - returned_amount -
                CASE WHEN sell_sum > 0 THEN
                  ROUND(LEAST(GREATEST(COALESCE(discount, 0), 0), sell_sum) * sell_through / sell_sum, 2)
                  - ROUND(LEAST(GREATEST(COALESCE(discount, 0), 0), sell_sum)
                          * (sell_through - GREATEST(COALESCE(total_sell, 0), 0)) / sell_sum, 2)
                  ELSE 0 END END AS revenue,
              CASE WHEN is_returned AND return_scope = 'full' AND return_destination = 'warehouse' THEN 0
                   ELSE total_cost - CASE WHEN quantity > 0
                     THEN ROUND(total_cost * LEAST(qty_back, quantity) / quantity, 2) ELSE 0 END END AS cost
         FROM product_base
     ), service_values AS (
       SELECT ch.id AS check_id, ch.day, 'service'::text AS kind,
              'service:' || COALESCE(sl.service_id::text, 'name:' || lower(btrim(sl.name))) AS key,
              sl.name, sl.service_id AS entity_id, NULL::text AS category, NULL::numeric AS stock,
              CASE WHEN ch.is_returned AND ch.return_scope = 'full'
                     OR COALESCE(r.qty, 0) >= COALESCE(NULLIF(sl.quantity, 0), 1) THEN 0 ELSE 1 END::numeric AS qty,
              CASE WHEN ch.is_returned AND ch.return_scope = 'full' THEN 0
                   ELSE COALESCE(sl.total, 0) - COALESCE(r.amount, 0) END AS revenue,
              0::numeric AS cost
         FROM checks_base ch
         JOIN check_service_lines sl ON sl.check_id = ch.id
         LEFT JOIN returned r ON r.check_id = ch.id AND r.service_line_id = sl.id AND r.product_line_id IS NULL
     ), snapshots AS (
       SELECT * FROM product_values UNION ALL SELECT * FROM service_values
     ), snapshot_totals AS (
       SELECT check_id, SUM(revenue) AS revenue, SUM(cost) AS cost FROM snapshots GROUP BY check_id
     ), adjustments AS (
       SELECT ch.id AS check_id, ch.day, 'adjustment'::text AS kind, 'adjustment'::text AS key,
              'Корректировки чеков'::text AS name, NULL::uuid AS entity_id,
              NULL::text AS category, NULL::numeric AS stock, 0::numeric AS qty,
              COALESCE(ch.total_revenue, 0) - COALESCE(s.revenue, 0) AS revenue,
              ch.product_cost_total - COALESCE(s.cost, 0) AS cost
         FROM checks_base ch LEFT JOIN snapshot_totals s ON s.check_id = ch.id
        WHERE COALESCE(ch.total_revenue, 0) <> COALESCE(s.revenue, 0)
           OR ch.product_cost_total IS NULL OR ch.product_cost_total <> COALESCE(s.cost, 0)
     ), all_lines AS (
       SELECT * FROM snapshots WHERE qty <> 0 OR revenue <> 0 OR cost <> 0 OR cost IS NULL
       UNION ALL SELECT * FROM adjustments
     ), selected AS MATERIALIZED (
       SELECT * FROM all_lines WHERE ${selected}
     ), grouped AS (
       SELECT ${groupKey} AS key, ${groupName} AS name, MIN(kind) AS kind,
              ${byCategory ? 'NULL::text' : 'MIN(entity_id::text)'} AS entity_id,
              MIN(category) AS category, ${byCategory ? 'NULL::numeric' : 'MIN(stock)'} AS stock,
              SUM(qty) AS qty, SUM(revenue) AS revenue,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(cost) END AS cost,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(revenue - cost) END AS gross,
              COUNT(DISTINCT check_id)::int AS checks,
              COUNT(*) FILTER (WHERE cost IS NULL)::int AS unknown_cost,
              COUNT(*) FILTER (WHERE kind = 'product' AND cost = 0 AND qty > 0)::int AS zero_cost
         FROM selected GROUP BY ${groupKey}${byCategory ? ", COALESCE(category, 'Без папки')" : ''}
     ), valued AS (
       SELECT *, CASE WHEN kind = 'adjustment' THEN NULL ELSE ${basis} END AS value FROM grouped
     ), ranked AS (
       SELECT *, COALESCE(SUM(value) FILTER (WHERE value > 0) OVER (), 0) AS positive_total,
              COALESCE(SUM(value) FILTER (WHERE value > 0) OVER
                (ORDER BY value DESC NULLS LAST GROUPS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_value,
              COALESCE(SUM(value) FILTER (WHERE value > 0) OVER
                (ORDER BY value DESC NULLS LAST GROUPS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 0) AS through_value
         FROM valued
     ), classified AS (
       SELECT *, CASE WHEN value > 0 THEN
                       CASE WHEN before_value < positive_total * 0.8 THEN 'A'
                            WHEN before_value < positive_total * 0.95 THEN 'B' ELSE 'C' END ELSE NULL END AS tier,
              CASE WHEN value > 0 THEN ROUND(100 * value / positive_total, 1) ELSE NULL END AS share,
              CASE WHEN value > 0 THEN ROUND(100 * through_value / positive_total, 1) ELSE NULL END AS cumulative
         FROM ranked
     ), totals AS (
       SELECT COALESCE(SUM(revenue), 0) AS revenue,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE COALESCE(SUM(cost), 0) END AS cost,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE COALESCE(SUM(revenue - cost), 0) END AS gross,
              COALESCE(SUM(qty) FILTER (WHERE kind = 'product'), 0) AS product_qty,
              COALESCE(SUM(qty) FILTER (WHERE kind = 'service'), 0) AS service_qty,
              COUNT(DISTINCT check_id)::int AS checks,
              COUNT(*) FILTER (WHERE cost IS NULL)::int AS unknown_cost,
              COUNT(*) FILTER (WHERE kind = 'product' AND cost = 0 AND qty > 0)::int AS zero_cost,
              (SELECT COUNT(*)::int FROM grouped) AS groups,
              (SELECT COALESCE(SUM(value) FILTER (WHERE value > 0), 0) FROM valued) AS positive_value,
              (SELECT COUNT(*)::int FROM valued WHERE value > 0) AS ranked_count
         FROM selected
     ), kind_totals AS (
       SELECT kind, SUM(revenue) AS revenue,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(cost) END AS cost,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(revenue - cost) END AS gross
         FROM selected GROUP BY kind
     ), timeline AS (
       SELECT ${timelineDay} AS day, SUM(revenue) AS revenue,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(cost) END AS cost,
              CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE SUM(revenue - cost) END AS gross
         FROM selected GROUP BY ${timelineDay}
     ), tier_totals AS (
       SELECT tier, COUNT(*)::int AS count, SUM(value) AS value,
              ROUND(100 * SUM(value) / MAX(positive_total), 1) AS share
         FROM classified WHERE tier IS NOT NULL GROUP BY tier
     )
     SELECT jsonb_build_object(
       'rows', COALESCE((SELECT jsonb_agg(x ORDER BY value DESC NULLS LAST, key) FROM
         (SELECT * FROM classified ORDER BY value DESC NULLS LAST, key LIMIT ${MAIN_ROW_LIMIT + 1}) x), '[]'::jsonb),
       'totals', (SELECT to_jsonb(t) FROM totals t),
       'kinds', COALESCE((SELECT jsonb_agg(k ORDER BY kind) FROM kind_totals k), '[]'::jsonb),
       'timeline', COALESCE((SELECT jsonb_agg(t ORDER BY day) FROM timeline t), '[]'::jsonb),
       'tiers', COALESCE((SELECT jsonb_agg(t ORDER BY tier) FROM tier_totals t), '[]'::jsonb),
       'adjustment', (SELECT jsonb_build_object('revenue', COALESCE(SUM(revenue), 0),
         'cost', CASE WHEN BOOL_OR(cost IS NULL) THEN NULL ELSE COALESCE(SUM(cost), 0) END,
         'checks', COUNT(*)::int) FROM adjustments)
       ${warehouseTiers}
     ) AS data`,
    params,
  );
  return rows[0].data;
}
