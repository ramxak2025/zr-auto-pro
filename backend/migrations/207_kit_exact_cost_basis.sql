-- Kit-only basis precision. Ordinary catalog unit costs and posted currency
-- amounts retain their existing two-decimal contract.
ALTER TABLE product_assemblies ALTER COLUMN unit_cost TYPE NUMERIC(15,5);
ALTER TABLE products ADD COLUMN assembly_exact_cost NUMERIC(15,5);
ALTER TABLE products ADD CONSTRAINT assembly_exact_cost_scope CHECK(assembly_exact_cost IS NULL OR(assembly_id IS NOT NULL AND assembly_exact_cost>=0));
UPDATE products p SET assembly_exact_cost=a.unit_cost FROM product_assemblies a
  WHERE p.assembly_id=a.id AND p.tenant_id=a.tenant_id;
ALTER TABLE check_product_lines ADD COLUMN kit_exact_unit_cost NUMERIC(15,5);
UPDATE check_product_lines pl SET kit_exact_unit_cost=p.assembly_exact_cost FROM products p
  WHERE pl.product_id=p.id AND p.assembly_exact_cost IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_assembled_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.assembly_id IS NOT NULL AND current_setting('app.kit_operation',true) IS DISTINCT FROM 'true' THEN
    IF NEW.assembly_id IS DISTINCT FROM OLD.assembly_id OR NEW.assembly_revision IS DISTINCT FROM OLD.assembly_revision OR
      NEW.assembly_exact_cost IS DISTINCT FROM OLD.assembly_exact_cost OR NEW.cost_price IS DISTINCT FROM OLD.cost_price OR
      NEW.is_bundle IS DISTINCT FROM OLD.is_bundle OR NEW.bundle_items IS DISTINCT FROM OLD.bundle_items OR
      (NEW.stock IS DISTINCT FROM OLD.stock AND current_setting('app.kit_check_stock',true) IS DISTINCT FROM 'true')
    THEN RAISE EXCEPTION 'ASSEMBLED_KIT_OPERATION_REQUIRED' USING ERRCODE='P0001'; END IF;
    IF NEW.stock<0 THEN RAISE EXCEPTION 'ASSEMBLED_KIT_INSUFFICIENT_STOCK' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
