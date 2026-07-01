-- ─────────────────────────────────────────────────────────────────────────
--  105 — Folders (warehouse_categories) become soft-deletable (#60).
--
--  Before this change folders were HARD-deleted. #60 makes folder delete a
--  reversible soft-delete: WarehouseService.removeCategory now stamps the
--  category row (and subfolders) with `deleted_at` instead of removing it, and
--  a full-folder delete cascades its products to the Корзина. The `deleted_at`
--  column itself already exists (added in 023_soft_delete_products_categories);
--  this migration only fixes the UNIQUENESS so soft-deleted rows behave.
--
--  Problem: the unique index from 032 —
--      (tenant_id, warehouse_id, path) WHERE warehouse_id IS NOT NULL
--  covers deleted rows too. A trashed folder would then block re-creating (or
--  renaming onto) a folder with the same name in the same warehouse.
--
--  Fix: narrow the unique index to LIVE rows only (`deleted_at IS NULL`). A
--  trashed folder no longer participates in uniqueness, so the same name can be
--  re-created (createCategory revives the trashed row) or a rename can reuse it.
--
--  Safe for live data:
--   • Idempotent (DROP … IF EXISTS + CREATE … IF NOT EXISTS).
--   • No categories are soft-deleted yet (folders were always hard-deleted
--     until now), so every existing row has deleted_at IS NULL — the narrowed
--     index covers exactly the same rows it did before → no duplicate-key risk.
--   • Purely an index swap; no data is moved or removed.
-- ─────────────────────────────────────────────────────────────────────────

-- Replace the live-uniqueness index with one scoped to non-deleted rows.
DROP INDEX IF EXISTS warehouse_categories_path_warehouse_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_categories_path_warehouse_uniq
    ON warehouse_categories (tenant_id, warehouse_id, path)
    WHERE warehouse_id IS NOT NULL AND deleted_at IS NULL;

-- Keep the trash-side lookups (revive-on-recreate, future folder-trash views)
-- off a sequential scan on tenants with many trashed folders.
CREATE INDEX IF NOT EXISTS idx_warehouse_categories_trash
    ON warehouse_categories (tenant_id, warehouse_id, path)
    WHERE deleted_at IS NOT NULL;
