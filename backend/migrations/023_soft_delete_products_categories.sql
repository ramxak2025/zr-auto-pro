-- ─────────────────────────────────────────────────────────────────────────
--  Trash bin — soft-delete for warehouse items.
--
--  Adds nullable `deleted_at` columns. NULL = live, timestamp = in trash.
--
--  Backwards-safe by design:
--   - All existing rows stay visible (NULL means "alive", DEFAULT NULL).
--   - check_product_lines stores a snapshot of the product (name / prices),
--     so soft-deleting a product never breaks historical check rendering.
--   - Indices use partial WHERE deleted_at IS NULL so live queries stay
--     fast on tenants with thousands of trashed items.
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE products ADD COLUMN deleted_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE warehouse_categories ADD COLUMN deleted_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Live products are the dominant query path; partial index keeps existing
-- list queries as fast as before this column was added.
CREATE INDEX IF NOT EXISTS idx_products_live_tenant
  ON products (tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_categories_live_tenant
  ON warehouse_categories (tenant_id) WHERE deleted_at IS NULL;

-- Trash queries are rarer but still need an index to avoid full scans
-- when the trash list is opened.
CREATE INDEX IF NOT EXISTS idx_products_trash_tenant
  ON products (tenant_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
