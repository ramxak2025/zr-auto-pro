-- ─────────────────────────────────────────────────────────────────────────
--  Performance: search & list indexes.
--
--  Targets fast `ILIKE '%query%'` lookups on the lists the user actually
--  searches across (cars by plate / model, clients by phone, products by
--  category) and keeps list pagination cursors covered.
--
--  All indexes are CREATE INDEX IF NOT EXISTS and run inside the migration
--  transaction (so no CONCURRENTLY — that fails inside BEGIN/COMMIT, which
--  is the same trap migration 013 already hits).
-- ─────────────────────────────────────────────────────────────────────────

-- pg_trgm should already exist from migration 004; double-check.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── cars: ILIKE search on plate_number & make_model ──────────────────────
CREATE INDEX IF NOT EXISTS idx_cars_plate_trgm
    ON cars USING gin (plate_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cars_make_model_trgm
    ON cars USING gin (make_model gin_trgm_ops);

-- ── clients: phone substring search (full-name trgm already exists) ──────
CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm
    ON clients USING gin (phone gin_trgm_ops);

-- ── products: category list filter (name trgm already exists) ────────────
CREATE INDEX IF NOT EXISTS idx_products_category_trgm
    ON products USING gin (category gin_trgm_ops)
    WHERE category IS NOT NULL;

-- ── List-pagination composites (tenant_id, created_at DESC) ──────────────
-- Postgres can read these in index order without a Sort step, which makes
-- "first page" of every list page-load instant even on tenants with 100k+
-- rows. Live rows only — soft-deleted ones don't appear in the UI.

CREATE INDEX IF NOT EXISTS idx_clients_tenant_created
    ON clients (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cars_tenant_created
    ON cars (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_live_tenant_created
    ON products (tenant_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- ── checks: keyset pagination support ────────────────────────────────────
-- ChecksScreen / ChecksPage scroll by date DESC. The composite (tenant_id,
-- date DESC, id DESC) is the canonical keyset cursor index — gives O(log N)
-- "older than" queries on any offset, even into the millions of rows.
CREATE INDEX IF NOT EXISTS idx_checks_tenant_date_id
    ON checks (tenant_id, date DESC, id DESC);

-- Filter by car (CheckCreateScreen "car history" panel).
CREATE INDEX IF NOT EXISTS idx_checks_car_id_date
    ON checks (car_id, date DESC)
    WHERE car_id IS NOT NULL;

-- ── stat refresh — kick autovacuum to update stats on the new indexes ────
ANALYZE clients;
ANALYZE cars;
ANALYZE products;
ANALYZE checks;
