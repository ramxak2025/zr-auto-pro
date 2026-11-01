ALTER TABLE check_product_events ADD COLUMN source_product_id UUID;
CREATE INDEX check_product_events_source_history ON check_product_events(tenant_id,source_product_id,occurred_at DESC,id DESC)
  WHERE source_product_id IS NOT NULL;

ALTER TABLE products ADD CONSTRAINT physical_kit_stock_discrete CHECK (assembly_id IS NULL OR (stock>=0 AND stock=trunc(stock)));
