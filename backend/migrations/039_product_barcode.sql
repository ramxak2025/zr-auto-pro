-- 039_product_barcode.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(tenant_id, barcode) WHERE barcode IS NOT NULL;
