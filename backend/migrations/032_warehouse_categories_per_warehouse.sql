-- Per-warehouse folders for the product picker.
--
-- Before this migration `warehouse_categories` was tenant-scoped only —
-- the same folder tree appeared in main / defect / used. The cash screen
-- product picker therefore showed "main" folders even while the user had
-- selected Б/У, polluting the list with products that did not live in
-- that warehouse.
--
-- Schema change: every category now belongs to exactly one warehouse.
-- The migration is idempotent (IF NOT EXISTS guards). The backfill maps
-- every legacy row to the tenant's "main" warehouse — that matches the
-- old implicit behaviour, so reads from existing clients remain stable.
--
-- The column is left NULLABLE on purpose so legacy rows that pre-date
-- the 028_warehouses.sql warehouse seeding do not break the backfill
-- query. New rows are written with an explicit warehouse_id from the
-- service layer (see warehouse.service.ts → createCategory).

ALTER TABLE warehouse_categories
    ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE;

-- Backfill: every existing category goes to the tenant's main warehouse.
-- Skip rows that are already mapped (re-running this migration is a no-op).
UPDATE warehouse_categories wc
   SET warehouse_id = (
       SELECT w.id
         FROM warehouses w
        WHERE w.tenant_id = wc.tenant_id
          AND w.kind = 'main'
        LIMIT 1
   )
 WHERE warehouse_id IS NULL
   AND tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS warehouse_categories_warehouse_idx
    ON warehouse_categories (warehouse_id);

-- The old (tenant_id, path) uniqueness from 003_warehouse_categories.sql
-- is too strict once each warehouse owns its own tree — main and Б/У
-- both legitimately have e.g. "Тормоза". Replace it with a tuple that
-- includes warehouse_id. Drop the old constraint only if it still
-- exists (idempotent).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'warehouse_categories_path_tenant_id_key'
    ) THEN
        ALTER TABLE warehouse_categories
            DROP CONSTRAINT warehouse_categories_path_tenant_id_key;
    END IF;
END$$;

-- Use a partial unique INDEX (not a CONSTRAINT) so the warehouse_id
-- column can stay nullable for legacy rows while still preventing
-- duplicate (path, warehouse_id) pairs for new rows.
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_categories_path_warehouse_uniq
    ON warehouse_categories (tenant_id, warehouse_id, path)
    WHERE warehouse_id IS NOT NULL;
