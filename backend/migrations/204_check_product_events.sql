ALTER TABLE checks ADD COLUMN product_history_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE check_product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  point_id UUID,
  check_id UUID NOT NULL,
  check_number INTEGER,
  revision INTEGER NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('sale','sale_correction','sale_annulment','sale_restore','legacy_baseline')),
  quantity NUMERIC(12,3) NOT NULL,
  stock_delta NUMERIC(12,3),
  stock_before NUMERIC(12,3),
  stock_after NUMERIC(12,3),
  warehouse_id UUID,
  category TEXT,
  storage_cell_id UUID,
  actor_id UUID,
  visible_user_ids UUID[] NOT NULL DEFAULT '{}',
  before_lines JSONB NOT NULL DEFAULT '[]',
  after_lines JSONB NOT NULL DEFAULT '[]',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  document_date TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(check_id,revision,product_id)
);
-- Intentionally no check/product FKs: document purge must preserve committed facts.
CREATE INDEX check_product_events_history ON check_product_events(tenant_id,product_id,occurred_at DESC,id DESC);
CREATE INDEX check_product_events_check ON check_product_events(tenant_id,check_id,revision);

CREATE TABLE stock_history_changes (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX stock_history_changes_tenant ON stock_history_changes(tenant_id);
-- Count of committed change rows is the tenant epoch. Appending avoids a shared
-- tenant-row lock and its inversion with the check/product lock order.
CREATE FUNCTION invalidate_legacy_product_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.product_history_version=0 AND (
    NEW.date IS DISTINCT FROM OLD.date OR
    NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.is_deferred IS DISTINCT FROM OLD.is_deferred
  ) THEN INSERT INTO stock_history_changes(tenant_id) VALUES(NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checks_product_history_epoch AFTER UPDATE OF date,deleted_at,is_deferred,product_history_version ON checks
  FOR EACH ROW EXECUTE FUNCTION invalidate_legacy_product_history();

ALTER TABLE stock_movements ADD COLUMN check_id UUID;
ALTER TABLE stock_movements ADD COLUMN return_id UUID;
ALTER TABLE stock_movements ADD COLUMN source_product_id UUID;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['check_product_events','stock_history_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;

CREATE INDEX stock_movements_source_history ON stock_movements(tenant_id,source_product_id,created_at DESC,id DESC) WHERE source_product_id IS NOT NULL;
