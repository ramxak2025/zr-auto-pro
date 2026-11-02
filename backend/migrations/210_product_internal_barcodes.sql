-- Internal label identifiers never replace a manufacturer's barcode. Codes are
-- reserved for the tenant forever, even when a zero-stock product is purged.
CREATE TABLE product_internal_barcode_allocations (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK(code ~ '^AX[0-9]{8}$'),
  product_id UUID NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,code),UNIQUE(tenant_id,product_id)
);
ALTER TABLE product_internal_barcode_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_internal_barcode_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_internal_barcode_allocations
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE products ADD COLUMN internal_barcode TEXT;
ALTER TABLE products ADD CONSTRAINT products_internal_barcode_shape CHECK(internal_barcode IS NULL OR internal_barcode ~ '^AX[0-9]{8}$');
CREATE UNIQUE INDEX products_internal_barcode_unique ON products(tenant_id,internal_barcode) WHERE internal_barcode IS NOT NULL;

CREATE FUNCTION preserve_internal_barcode_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'INTERNAL_BARCODE_ALLOCATION_IMMUTABLE' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER internal_barcode_allocation_immutable BEFORE UPDATE OR DELETE ON product_internal_barcode_allocations
  FOR EACH ROW EXECUTE FUNCTION preserve_internal_barcode_allocation();

CREATE FUNCTION protect_product_barcodes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='INSERT' OR NEW.internal_barcode IS DISTINCT FROM OLD.internal_barcode THEN
    IF TG_OP='UPDATE' AND OLD.internal_barcode IS NOT NULL THEN
      RAISE EXCEPTION 'INTERNAL_BARCODE_IMMUTABLE' USING ERRCODE='P0001';
    END IF;
    IF NEW.internal_barcode IS NOT NULL AND (
      current_setting('app.internal_barcode_assignment',true) IS DISTINCT FROM 'true' OR
      NOT EXISTS(SELECT 1 FROM product_internal_barcode_allocations a
        WHERE a.tenant_id=NEW.tenant_id AND a.code=NEW.internal_barcode AND a.product_id=NEW.id)
    ) THEN RAISE EXCEPTION 'INTERNAL_BARCODE_REGISTRY_REQUIRED' USING ERRCODE='P0001'; END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.barcode IS DISTINCT FROM OLD.barcode THEN
    IF NULLIF(NEW.barcode,'') IS NOT NULL THEN
      -- Generator takes this same lock AFTER locking all target products. A
      -- factory edit already owns its target row: no namespace->product cycle.
      PERFORM pg_advisory_xact_lock(hashtextextended('internal-barcodes:'||NEW.tenant_id::text,0));
      IF EXISTS(SELECT 1 FROM product_internal_barcode_allocations a
        WHERE a.tenant_id=NEW.tenant_id AND a.code=NEW.barcode AND a.product_id IS DISTINCT FROM NEW.id)
      THEN RAISE EXCEPTION 'BARCODE_RESERVED' USING ERRCODE='P0001'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_barcode_guard BEFORE INSERT OR UPDATE OF barcode,internal_barcode ON products
  FOR EACH ROW EXECUTE FUNCTION protect_product_barcodes();
