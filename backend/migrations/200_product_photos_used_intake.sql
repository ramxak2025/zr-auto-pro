-- Ordered product photos; every legacy writer remains compatible through the trigger.
ALTER TABLE products ADD COLUMN photos JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE products SET photos = jsonb_build_array(photo) WHERE NULLIF(btrim(photo), '') IS NOT NULL;
ALTER TABLE products ADD CONSTRAINT products_photos_shape CHECK (
  jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 4
);

CREATE FUNCTION sync_product_photo_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF jsonb_array_length(NEW.photos) = 0 AND NULLIF(btrim(NEW.photo), '') IS NOT NULL THEN
      NEW.photos := jsonb_build_array(btrim(NEW.photo));
    END IF;
  ELSIF NEW.photos IS NOT DISTINCT FROM OLD.photos AND NEW.photo IS DISTINCT FROM OLD.photo THEN
    -- A legacy PATCH changes only the cover, keeping the remaining pictures.
    NEW.photos := COALESCE((SELECT jsonb_agg(value ORDER BY ordinality)
       FROM jsonb_array_elements(OLD.photos) WITH ORDINALITY WHERE ordinality > 1
         AND value IS DISTINCT FROM to_jsonb(NULLIF(btrim(NEW.photo), ''))), '[]'::jsonb);
    IF NULLIF(btrim(NEW.photo), '') IS NOT NULL THEN
      NEW.photos := jsonb_build_array(btrim(NEW.photo)) || NEW.photos;
    END IF;
  END IF;
  NEW.photo := NEW.photos ->> 0;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_photo_cover BEFORE INSERT OR UPDATE OF photo, photos ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_photo_cover();

CREATE TABLE product_share_tokens (
  token_hash TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX product_share_tokens_product ON product_share_tokens(tenant_id, product_id);
ALTER TABLE product_share_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_share_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_share_tokens
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE used_intake_requests (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id)
);
ALTER TABLE used_intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE used_intake_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON used_intake_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
