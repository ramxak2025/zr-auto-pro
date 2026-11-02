-- Composition metadata only. Inventory, posted costs and saved checks stay intact.
CREATE TABLE kit_recipe_versions (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES kit_recipes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,components JSONB NOT NULL,
  created_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,recipe_id,version)
);
ALTER TABLE kit_recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_recipe_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kit_recipe_versions
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE FUNCTION immutable_kit_recipe_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'KIT_RECIPE_VERSION_IMMUTABLE';
END $$;
CREATE TRIGGER kit_recipe_version_immutable BEFORE UPDATE OR DELETE ON kit_recipe_versions FOR EACH ROW EXECUTE FUNCTION immutable_kit_recipe_version();
INSERT INTO kit_recipe_versions(tenant_id,recipe_id,version,name,components,created_by,created_at)
  SELECT tenant_id,id,version,name,components,created_by,updated_at FROM kit_recipes;
ALTER TABLE product_assemblies ADD COLUMN recipe_version INTEGER;

-- Compare source identity + quantity, independent of array order. Never attach an
-- old batch to a changed current recipe merely because the names match.
CREATE FUNCTION kit_recipe_composition_key(value JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',e->>'productId','quantity',(e->>'quantity')::numeric) ORDER BY e->>'productId'),'[]'::jsonb)
 FROM jsonb_array_elements(value) e
$$;
DO $$ DECLARE a RECORD; composition JSONB; current_recipe RECORD; new_recipe UUID; BEGIN
 FOR a IN SELECT pa.*,p.name FROM product_assemblies pa JOIN products p ON p.id=pa.product_id ORDER BY pa.id LOOP
   SELECT jsonb_agg(jsonb_build_object('productId',source_product_id::text,'quantity',quantity) ORDER BY source_product_id)
     INTO composition FROM product_assembly_components WHERE assembly_id=a.id AND tenant_id=a.tenant_id;
   IF composition IS NULL THEN RAISE EXCEPTION 'KIT_LEGACY_COMPOSITION_MISSING'; END IF;
   SELECT * INTO current_recipe FROM kit_recipes WHERE id=a.recipe_id AND tenant_id=a.tenant_id AND point_id IS NOT DISTINCT FROM a.point_id;
   IF FOUND AND kit_recipe_composition_key(current_recipe.components)=kit_recipe_composition_key(composition) THEN
     UPDATE product_assemblies SET recipe_version=current_recipe.version WHERE id=a.id;
   ELSE
     INSERT INTO kit_recipes(tenant_id,point_id,name,components,created_by)
       VALUES(a.tenant_id,a.point_id,a.name,composition,a.created_by) RETURNING id INTO new_recipe;
     INSERT INTO kit_recipe_versions(tenant_id,recipe_id,version,name,components,created_by)
       VALUES(a.tenant_id,new_recipe,1,a.name,composition,a.created_by);
     UPDATE product_assemblies SET recipe_id=new_recipe,recipe_version=1 WHERE id=a.id;
   END IF;
 END LOOP;
END $$;
ALTER TABLE product_assemblies ALTER COLUMN recipe_id SET NOT NULL;
ALTER TABLE product_assemblies ALTER COLUMN recipe_version SET NOT NULL;
ALTER TABLE product_assemblies ADD CONSTRAINT assembly_recipe_version FOREIGN KEY(tenant_id,recipe_id,recipe_version)
  REFERENCES kit_recipe_versions(tenant_id,recipe_id,version);
CREATE INDEX assembly_recipe_batches ON product_assemblies(tenant_id,recipe_id,recipe_version,product_id);

-- Replace only physical-batch template bindings; normal and legacy metadata-only
-- bundles keep their existing semantics. No fabricated historical recipe version.
UPDATE check_templates t SET products=(
 SELECT jsonb_agg(CASE WHEN a.id IS NOT NULL THEN jsonb_build_object(
   'kind','kitRecipe','kitRecipeId',a.recipe_id,'kitRecipeVersion',a.recipe_version,
   'name',line->>'name','quantity',COALESCE(line->'quantity','1'::jsonb)) ELSE line END ORDER BY ordinal)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.products)='array' THEN t.products ELSE '[]'::jsonb END) WITH ORDINALITY AS lines(line,ordinal)
 LEFT JOIN product_assemblies a ON a.tenant_id=t.tenant_id AND a.product_id::text=line->>'productId'
),updated_at=now()
WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.products)='array' THEN t.products ELSE '[]'::jsonb END) line JOIN product_assemblies a
  ON a.tenant_id=t.tenant_id AND a.product_id::text=line->>'productId');

-- A resolved recipe template carries a concrete selected batch revision through
-- drafts/activation. No money or cost fields are accepted from this metadata.
ALTER TABLE check_product_lines ADD COLUMN template_kit_batch JSONB;
