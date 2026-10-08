-- Role-preferred catalog visibility is an interface filter, never an access rule.
-- One tenant-scoped rule targets either one service or one category path.
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_tenant_id_id
    ON services (tenant_id, id);

CREATE TABLE IF NOT EXISTS service_visibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id UUID,
    category_path TEXT,
    visible_role_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT service_visibility_rules_one_target CHECK (
        (service_id IS NOT NULL AND category_path IS NULL)
        OR (service_id IS NULL AND category_path IS NOT NULL AND length(category_path) > 0)
    ),
    CONSTRAINT service_visibility_rules_service_tenant_fkey
        FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_visibility_rules_service
    ON service_visibility_rules (tenant_id, service_id) WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_visibility_rules_category
    ON service_visibility_rules (tenant_id, category_path) WHERE category_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_visibility_rules_tenant
    ON service_visibility_rules (tenant_id);

ALTER TABLE service_visibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_visibility_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_visibility_rules;
CREATE POLICY tenant_isolation ON service_visibility_rules
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
