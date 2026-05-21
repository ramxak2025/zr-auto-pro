-- Stock movements get the warehouse dimension + transfer + defect-return-to-supplier.
--
-- Columns added:
--   warehouse_id        — the warehouse this movement applies to (target for
--                         single-warehouse moves; for transfers it mirrors
--                         target_warehouse_id for easy filtering)
--   source_warehouse_id — set on transfers (defect_transfer, used_transfer)
--   target_warehouse_id — set on transfers (defect_transfer, used_transfer)
--   supplier_id         — set on defect_return_to_supplier
--   record_as_expense   — for writeoff, indicates we also booked an expense
--   linked_expense_id   — FK to the auto-created expense row (when above true)
--
-- New movement types:
--   defect_transfer            — main → defect (deteriorated goods)
--   used_transfer              — main → used   (downgraded to second-hand)
--   defect_return_to_supplier  — defect → out of stock + debt decrease

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS target_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS record_as_expense BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS linked_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;

-- Backfill warehouse_id on legacy movements → tenant's main warehouse.
UPDATE stock_movements sm
   SET warehouse_id = (
         SELECT w.id FROM warehouses w
          WHERE w.tenant_id = sm.tenant_id AND w.kind = 'main'
          LIMIT 1
       )
 WHERE warehouse_id IS NULL;

-- The original CHECK constraint on `type` was created inline in 001_init.sql
-- without an explicit name, so its actual name depends on the Postgres version.
-- Drop it dynamically, then re-add a named constraint with the expanded set.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'stock_movements'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE stock_movements DROP CONSTRAINT %I', cname);
  END IF;
END$$;

-- Defensive: in case the constraint we just dropped is recreated by a future
-- migration with the same name, IF NOT EXISTS via DO block.
DO $$ BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_type_chk
    CHECK (type IN (
      'inventory',
      'writeoff',
      'income',
      'expense',
      'defect_transfer',
      'used_transfer',
      'defect_return_to_supplier'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS stock_movements_warehouse_idx
    ON stock_movements (tenant_id, warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_supplier_idx
    ON stock_movements (tenant_id, supplier_id, created_at DESC);
