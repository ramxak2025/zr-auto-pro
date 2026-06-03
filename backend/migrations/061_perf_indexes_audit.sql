-- ─────────────────────────────────────────────────────────────────────────
--  Audit performance pass — additive indexes for the hottest queries.
--
--  Runs inside the migration transaction (MigrationRunner wraps each file in
--  BEGIN/COMMIT), so NO `CREATE INDEX CONCURRENTLY` — that errors inside a
--  transaction block. Tables are still small; plain `CREATE INDEX IF NOT
--  EXISTS` is fine and keeps this file idempotent + re-runnable.
--
--  All statements are idempotent (IF NOT EXISTS) and additive — no schema,
--  type, or data changes.
-- ─────────────────────────────────────────────────────────────────────────

-- Trigram extension is enabled by 004 / 026; assert it so the expression
-- indexes below can be built even on a fresh DB that replays migrations.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. check_product_lines join key ──────────────────────────────────────
-- Every warehouse-analytics endpoint joins check_product_lines on product_id
-- (sales velocity, top products, category margins). 004 only indexed
-- check_id, so product_id was a full scan. This is the single biggest win.
CREATE INDEX IF NOT EXISTS idx_check_product_lines_product
    ON check_product_lines (product_id);

-- ── 2. products list ordering (Склад) ────────────────────────────────────
-- products.service.getAll filters `tenant_id = $ AND deleted_at IS NULL` and
-- `ORDER BY p.name`. A partial composite on (tenant_id, name) lets Postgres
-- read live rows already in name order — removes the Sort node on the list.
CREATE INDEX IF NOT EXISTS idx_products_tenant_name_live
    ON products (tenant_id, name)
    WHERE deleted_at IS NULL;

-- ── 3. client / car compact search (index-friendly) ──────────────────────
-- clients.service.getAll searches with `REPLACE(phone,' ','') ILIKE` and
-- `REPLACE(plate_number,' ','') ILIKE` so users can type a plate/phone with
-- or without spaces. The plain trigram indexes from 004/026 are on the RAW
-- columns (`phone`, `plate_number`), so the REPLACE() expression could NOT
-- use them — every search fell back to a seq scan.
--
-- Lowest-risk fix: add EXPRESSION trigram indexes whose indexed expression is
-- exactly `replace(col,' ','')`. The query keeps its REPLACE() unchanged, so
-- the planner can now match it to these indexes. No column/schema changes, no
-- generated columns, no query rewrite — purely additive.
CREATE INDEX IF NOT EXISTS idx_clients_phone_norm_trgm
    ON clients USING gin (replace(phone, ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cars_plate_norm_trgm
    ON cars USING gin (replace(plate_number, ' ', '') gin_trgm_ops);

-- ── stat refresh so the planner picks up the new indexes promptly ─────────
ANALYZE check_product_lines;
ANALYZE products;
ANALYZE clients;
ANALYZE cars;
