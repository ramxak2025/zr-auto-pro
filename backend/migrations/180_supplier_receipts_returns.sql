-- Additive supplier receipt/return ledger. Original invoices/payments stay intact.
ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS sell_price NUMERIC(12,2);
ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS previous_purchase JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_tenant_id_id_uq ON deliveries (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_items_delivery_id_id_uq ON delivery_items (delivery_id, id);

CREATE TABLE IF NOT EXISTS procurement_requests (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);
CREATE TABLE IF NOT EXISTS supplier_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  point_id UUID REFERENCES tenant_points(id),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  UNIQUE (tenant_id, id, delivery_id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES deliveries (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS supplier_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  return_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  delivery_item_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  UNIQUE (return_id, delivery_item_id),
  FOREIGN KEY (tenant_id, return_id, delivery_id) REFERENCES supplier_returns (tenant_id, id, delivery_id),
  FOREIGN KEY (delivery_id, delivery_item_id) REFERENCES delivery_items (delivery_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_returns_scope_date ON supplier_returns (tenant_id, point_id, date DESC);
CREATE INDEX IF NOT EXISTS supplier_returns_delivery ON supplier_returns (delivery_id);
CREATE INDEX IF NOT EXISTS supplier_return_items_source ON supplier_return_items (delivery_item_id);

ALTER TABLE procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_returns FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_items FORCE ROW LEVEL SECURITY;
DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['procurement_requests','supplier_returns','supplier_return_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;
