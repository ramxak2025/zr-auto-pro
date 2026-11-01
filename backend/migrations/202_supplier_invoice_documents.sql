CREATE TABLE supplier_invoice_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  point_id UUID REFERENCES tenant_points(id),
  created_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','processing','review','error','duplicate','confirmed')),
  document_hash TEXT,
  duplicate_of UUID REFERENCES supplier_invoice_documents(id),
  delivery_id UUID UNIQUE REFERENCES deliveries(id),
  result JSONB NOT NULL DEFAULT '{"date":null,"lines":[],"warnings":[]}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  processing_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,supplier_id,document_hash)
);
CREATE TABLE supplier_invoice_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES supplier_invoice_documents(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL CHECK(page_index BETWEEN 0 AND 7),
  stored_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id,page_index), UNIQUE(document_id,sha256)
);
CREATE TABLE supplier_product_aliases (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  alias_key TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  confirmed_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,supplier_id,alias_key)
);
CREATE TABLE supplier_invoice_ocr_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES supplier_invoice_documents(id) ON DELETE CASCADE,
  pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX supplier_invoice_attempt_budget ON supplier_invoice_ocr_attempts(tenant_id,created_at);
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['supplier_invoice_documents','supplier_invoice_pages','supplier_product_aliases','supplier_invoice_ocr_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;
