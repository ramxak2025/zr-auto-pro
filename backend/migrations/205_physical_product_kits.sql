CREATE TABLE kit_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,point_id UUID,version INTEGER NOT NULL DEFAULT 1,components JSONB NOT NULL,
  created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),recipe_id UUID REFERENCES kit_recipes(id),point_id UUID,
  revision INTEGER NOT NULL DEFAULT 1,assembled_quantity INTEGER NOT NULL CHECK(assembled_quantity>0),
  disassembled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(disassembled_quantity>=0),unit_cost NUMERIC(12,2) NOT NULL,
  created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(disassembled_quantity<=assembled_quantity)
);
CREATE TABLE product_assembly_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assembly_id UUID NOT NULL REFERENCES product_assemblies(id),source_product_id UUID NOT NULL,
  source_warehouse_id UUID NOT NULL,source_category TEXT,source_cell_id UUID,
  quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),unit_cost NUMERIC(12,2) NOT NULL CHECK(unit_cost>=0),
  product_snapshot JSONB NOT NULL,UNIQUE(assembly_id,source_product_id)
);
CREATE TABLE kit_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,fingerprint TEXT NOT NULL,kind TEXT NOT NULL,
  check_id UUID,response JSONB NOT NULL,created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,request_id)
);
ALTER TABLE products ADD COLUMN assembly_id UUID REFERENCES product_assemblies(id);
ALTER TABLE products ADD COLUMN assembly_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN restored_from_source_id UUID;
CREATE INDEX products_assembly ON products(tenant_id,assembly_id) WHERE assembly_id IS NOT NULL;
CREATE INDEX products_restored_basis ON products(tenant_id,restored_from_source_id) WHERE restored_from_source_id IS NOT NULL;
ALTER TABLE stock_movements ADD COLUMN kit_operation_id UUID REFERENCES kit_operations(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stock_movements ADD COLUMN assembly_id UUID REFERENCES product_assemblies(id);
ALTER TABLE checks ADD COLUMN kit_splits JSONB NOT NULL DEFAULT '[]';
ALTER TABLE check_product_lines ADD COLUMN kit_source JSONB;

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_chk;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_chk CHECK(type IN (
  'inventory','writeoff','income','expense','defect_transfer','used_transfer','defect_return_to_supplier',
  'point_transfer','customer_return','kit_assembly','kit_disassembly'
));

-- Defense in depth for ordinary PATCH/import/receipt/stock SQL writers.
CREATE FUNCTION protect_assembled_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.assembly_id IS NOT NULL AND current_setting('app.kit_operation',true) IS DISTINCT FROM 'true' THEN
    IF NEW.assembly_id IS DISTINCT FROM OLD.assembly_id OR NEW.assembly_revision IS DISTINCT FROM OLD.assembly_revision OR
      NEW.cost_price IS DISTINCT FROM OLD.cost_price OR NEW.is_bundle IS DISTINCT FROM OLD.is_bundle OR NEW.bundle_items IS DISTINCT FROM OLD.bundle_items OR
      (NEW.stock IS DISTINCT FROM OLD.stock AND current_setting('app.kit_check_stock',true) IS DISTINCT FROM 'true')
    THEN RAISE EXCEPTION 'ASSEMBLED_KIT_OPERATION_REQUIRED' USING ERRCODE='P0001'; END IF;
    IF NEW.stock<0 THEN RAISE EXCEPTION 'ASSEMBLED_KIT_INSUFFICIENT_STOCK' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_assembled_guard BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION protect_assembled_product();
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['kit_recipes','product_assemblies','product_assembly_components','kit_operations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;
