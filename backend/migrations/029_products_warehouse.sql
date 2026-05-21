-- Products now live IN a warehouse, and may have a warranty period in days.
-- Services also gain warranty_days (e.g. installation work covered for 60 days).
--
-- For backwards compatibility every existing product is auto-assigned to its
-- tenant's "main" warehouse. New products without warehouseId fall back to
-- main at the service layer.

ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_days INT;

-- Backfill warehouse_id for legacy products → tenant's main warehouse.
UPDATE products p
   SET warehouse_id = (
         SELECT w.id FROM warehouses w
          WHERE w.tenant_id = p.tenant_id AND w.kind = 'main'
          LIMIT 1
       )
 WHERE warehouse_id IS NULL;

CREATE INDEX IF NOT EXISTS products_warehouse_idx ON products (warehouse_id);

ALTER TABLE services ADD COLUMN IF NOT EXISTS warranty_days INT;
