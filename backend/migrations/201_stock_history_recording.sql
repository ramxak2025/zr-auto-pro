-- Occurrence timestamps may be backdated by receipt corrections. Keep a separate
-- insertion timestamp so new rows cannot enter a history traversal's cutoff.
ALTER TABLE stock_movements ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
ALTER TABLE check_product_lines ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
CREATE INDEX stock_movements_history ON stock_movements(tenant_id,product_id,created_at DESC,id DESC);
CREATE INDEX check_product_lines_history ON check_product_lines(product_id,check_id);
