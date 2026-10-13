-- Additive: legacy catalogs remain confirmed and unchanged.
ALTER TABLE services ADD COLUMN price_is_placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE products
 ADD COLUMN sell_price_is_placeholder boolean NOT NULL DEFAULT false,
 ADD COLUMN cost_price_is_placeholder boolean NOT NULL DEFAULT false,
 ADD COLUMN brand text NOT NULL DEFAULT '',
 ADD COLUMN article text NOT NULL DEFAULT '',
 ADD COLUMN packaging text NOT NULL DEFAULT '',
 ADD COLUMN source_url text NOT NULL DEFAULT '';
ALTER TABLE registration_requests ADD COLUMN starter_directions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE service_price_history ADD COLUMN price_is_placeholder boolean NOT NULL DEFAULT false;
CREATE TABLE starter_catalog_memberships (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 scope text NOT NULL, item_key text NOT NULL, kind text NOT NULL,
 resource_id uuid, resource_path text, manifest_version text NOT NULL,
 PRIMARY KEY (tenant_id, scope, item_key)
);
-- No FK to catalog resources: hard deletion must leave an installation tombstone.
CREATE TABLE starter_catalog_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 point_id uuid, selection jsonb NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_result jsonb, completed_request jsonb
);
CREATE INDEX starter_catalog_previews_tenant_idx ON starter_catalog_previews(tenant_id, created_at);
ALTER TABLE starter_catalog_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE starter_catalog_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON starter_catalog_memberships
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE starter_catalog_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE starter_catalog_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON starter_catalog_previews
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION stamp_service_price_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.price_type = 'fixed' THEN
        NEW.min_price := NEW.default_price;
        NEW.max_price := NEW.default_price;
    ELSE
        IF TG_OP = 'UPDATE' THEN
            IF NEW.default_price IS DISTINCT FROM OLD.default_price
               AND NEW.min_price IS NOT DISTINCT FROM OLD.min_price THEN
                NEW.min_price := NEW.default_price;
            END IF;
        END IF;
        NEW.default_price := NEW.min_price;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.price_version := 1;
    ELSE
        NEW.price_version := OLD.price_version;
        IF (NEW.price_type, NEW.default_price, NEW.min_price, NEW.max_price)
           IS DISTINCT FROM (OLD.price_type, OLD.default_price, OLD.min_price, OLD.max_price)
           OR NEW.price_is_placeholder IS DISTINCT FROM OLD.price_is_placeholder THEN
            NEW.price_version := OLD.price_version + 1;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION record_service_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id UUID; actor_name TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.price_version = OLD.price_version THEN RETURN NEW; END IF;
    END IF;
    SELECT id, full_name INTO actor_id, actor_name FROM users
      WHERE id = NULLIF(current_setting('app.service_price_actor', true), '')::uuid
        AND tenant_id = NEW.tenant_id;
    INSERT INTO service_price_history
        (tenant_id, service_id, version, price_type, default_price, min_price, max_price,
         changed_by, changed_by_name, source, price_is_placeholder)
    VALUES (NEW.tenant_id, NEW.id, NEW.price_version, NEW.price_type, NEW.default_price,
            NEW.min_price, NEW.max_price, actor_id, actor_name,
            CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END, NEW.price_is_placeholder);
    RETURN NEW;
END $$;
