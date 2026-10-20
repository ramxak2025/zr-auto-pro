-- Additive revenue motivation. Existing settings/accruals remain margin_v1.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS motivation_assignees_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS motivation_v2_posted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS motivation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('product','folder')),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  category_id UUID REFERENCES warehouse_categories(id) ON DELETE CASCADE,
  percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  active BOOLEAN NOT NULL DEFAULT true,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'product' AND product_id IS NOT NULL AND category_id IS NULL)
      OR (target_kind = 'folder' AND category_id IS NOT NULL AND product_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_motivation_rule_product
  ON motivation_rules(tenant_id, product_id) WHERE target_kind = 'product';
CREATE UNIQUE INDEX IF NOT EXISTS uq_motivation_rule_category
  ON motivation_rules(tenant_id, category_id) WHERE target_kind = 'folder';

CREATE TABLE IF NOT EXISTS motivation_bulk_receipts (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);

-- Decisions include unmatched/paused/legacy products and survive rule deletion.
-- Zero-quantity tombstones prevent re-added historical products being re-resolved.
CREATE TABLE IF NOT EXISTS check_motivation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('revenue_v2','margin_v1','none')),
  rule_id UUID,
  percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  revenue_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  sale_lines JSONB NOT NULL DEFAULT '[]',
  accrued_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, check_id, product_id)
);
ALTER TABLE check_motivation_snapshots ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Narrow archive for explicitly replaced legacy exceptions; trash/restore keeps
-- the original legacy attribution even after its live config has been replaced.
CREATE TABLE IF NOT EXISTS check_motivation_legacy_snapshots (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  percent NUMERIC(5,2) NOT NULL,
  accrued_at TIMESTAMPTZ NOT NULL,
  protected BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,check_id,product_id)
);

ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS scheme TEXT NOT NULL DEFAULT 'margin_v1';
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS revenue_base NUMERIC(14,2);
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS share_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS total_bonus NUMERIC(14,2);
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS rule_id UUID;
-- Immutable identity is independent of nullable current catalog FK.
ALTER TABLE motivation_accruals ADD COLUMN IF NOT EXISTS snapshot_product_id UUID;
UPDATE motivation_accruals SET snapshot_product_id=product_id WHERE scheme='revenue_v2' AND snapshot_product_id IS NULL;
DROP INDEX IF EXISTS uq_motivation_accrual_check_product;
CREATE UNIQUE INDEX IF NOT EXISTS uq_motivation_accrual_legacy
  ON motivation_accruals(tenant_id, check_id, product_id)
  WHERE product_id IS NOT NULL AND scheme = 'margin_v1';
DROP INDEX IF EXISTS uq_motivation_accrual_revenue_employee;
CREATE UNIQUE INDEX IF NOT EXISTS uq_motivation_accrual_revenue_employee
  ON motivation_accruals(tenant_id, check_id, snapshot_product_id, employee_id)
  WHERE scheme = 'revenue_v2' AND snapshot_product_id IS NOT NULL AND employee_id IS NOT NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['motivation_rules','motivation_bulk_receipts','check_motivation_snapshots','check_motivation_legacy_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    -- MigrationRunner also grants new tables to the restricted app role.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autexa_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO autexa_app', t);
    END IF;
  END LOOP;
END $$;
