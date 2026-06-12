-- ─────────────────────────────────────────────────────────────────────────
--  069 — hot-path indexes (additive only, no schema changes).
--
--  Runs inside the migration transaction (MigrationRunner wraps each file in
--  BEGIN/COMMIT), so NO `CREATE INDEX CONCURRENTLY`. Every statement is
--  idempotent (IF NOT EXISTS) and re-runnable.
--
--  Each index below is justified by the exact query it serves:
--
--  1. idx_products_tenant_wh_name_live
--     products.service.ts getAll(): the Склад list + the cash product picker —
--     the hottest list in the app. Filters
--       `p.tenant_id = $1 AND p.deleted_at IS NULL AND p.warehouse_id = $X`
--     and sorts `ORDER BY p.name` (products.service.ts:85-115). The existing
--     idx_products_tenant_name_live (061) is (tenant_id, name) — it walks the
--     WHOLE tenant's live products in name order and row-filters warehouse_id.
--     With several warehouses per tenant this composite reads ONLY the chosen
--     warehouse's slice, already in name order: no Sort node, no wasted heap
--     fetches. 061's index stays — it still serves `warehouseId=all`.
--
--  2. idx_products_barcode_trgm
--     products.service.ts:90 search predicate
--       `(p.name ILIKE $ OR p.barcode ILIKE $)`.
--     name has a trgm GIN (004: idx_products_name_trgm) but barcode only has
--     a btree (039: (tenant_id, barcode)) which is useless for `%q%` ILIKE.
--     An OR can only be answered by a BitmapOr when BOTH branches are
--     indexed — so today every Склад search degrades to a scan. Partial
--     `WHERE barcode IS NOT NULL` is safe: ILIKE is strict, NULL barcodes can
--     never match, and most products have no barcode → tiny index.
--
--  3. idx_schedule_entries_tenant_date
--     schedule.service.ts:165-173 month grid:
--       `WHERE se.tenant_id = $1 AND se.date >= $2 AND se.date <= $3`.
--     Existing indexes lead with user_id (013), bare date across ALL tenants
--     (004), or (tenant_id, user_id, date) (020) where date is 3rd and cannot
--     be range-scanned within a tenant. (tenant_id, date) lets the grid read
--     exactly one tenant-month slice.
-- ─────────────────────────────────────────────────────────────────────────

-- pg_trgm is enabled by 004 / 026 / 061 / 063; assert for fresh replays.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Склад list / cash product picker: tenant + warehouse, name-ordered, live rows.
CREATE INDEX IF NOT EXISTS idx_products_tenant_wh_name_live
    ON products (tenant_id, warehouse_id, name)
    WHERE deleted_at IS NULL;

-- 2. Склад search by barcode substring (pairs with idx_products_name_trgm for BitmapOr).
CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm
    ON products USING gin (barcode gin_trgm_ops)
    WHERE barcode IS NOT NULL;

-- 3. Schedule month grid: one tenant's entries in a date range.
CREATE INDEX IF NOT EXISTS idx_schedule_entries_tenant_date
    ON schedule_entries (tenant_id, date);

-- Refresh planner stats so the new indexes are picked up immediately.
ANALYZE products;
ANALYZE schedule_entries;
