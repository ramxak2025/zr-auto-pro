-- This is a baseline observed NOW, never a reconstruction of earlier prices.
ALTER TABLE services
    ADD COLUMN price_type TEXT NOT NULL DEFAULT 'fixed',
    ADD COLUMN min_price NUMERIC(12,2),
    ADD COLUMN max_price NUMERIC(12,2),
    ADD COLUMN price_version INTEGER NOT NULL DEFAULT 1;

UPDATE services SET default_price=COALESCE(default_price, 0),
    min_price=COALESCE(default_price, 0), max_price=COALESCE(default_price, 0);
ALTER TABLE services
    ALTER COLUMN default_price SET NOT NULL,
    ALTER COLUMN min_price SET NOT NULL,
    ALTER COLUMN max_price SET NOT NULL,
    ADD CONSTRAINT services_price_policy CHECK (
        price_type IN ('fixed', 'range') AND price_version > 0
        AND min_price >= 0 AND min_price <> 'NaN'::numeric
        AND max_price >= min_price AND max_price <> 'NaN'::numeric
        AND default_price = min_price
        AND (price_type = 'range' OR min_price = max_price)
    );

CREATE TABLE service_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    price_type TEXT NOT NULL,
    default_price NUMERIC(12,2) NOT NULL,
    min_price NUMERIC(12,2) NOT NULL,
    max_price NUMERIC(12,2) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_by_name TEXT,
    source TEXT NOT NULL CHECK (source IN ('baseline', 'create', 'update')),
    FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (tenant_id, service_id, version)
);
INSERT INTO service_price_history
    (tenant_id, service_id, version, price_type, default_price, min_price, max_price, source)
SELECT tenant_id, id, price_version, price_type, default_price, min_price, max_price, 'baseline'
FROM services;

-- BEFORE normalizes legacy fixed-price writers and stamps the version. AFTER
-- records the exact committed row; a history failure rolls back the mutation.
CREATE FUNCTION stamp_service_price_policy() RETURNS trigger LANGUAGE plpgsql AS $$
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
           IS DISTINCT FROM (OLD.price_type, OLD.default_price, OLD.min_price, OLD.max_price) THEN
            NEW.price_version := OLD.price_version + 1;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION record_service_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
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
         changed_by, changed_by_name, source)
    VALUES (NEW.tenant_id, NEW.id, NEW.price_version, NEW.price_type, NEW.default_price,
            NEW.min_price, NEW.max_price, actor_id, actor_name,
            CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END);
    RETURN NEW;
END $$;
CREATE TRIGGER services_stamp_price BEFORE INSERT OR UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION stamp_service_price_policy();
CREATE TRIGGER services_record_price AFTER INSERT OR UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION record_service_price_history();

ALTER TABLE service_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_price_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_price_history
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
