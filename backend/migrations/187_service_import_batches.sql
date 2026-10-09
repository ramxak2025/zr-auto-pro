-- Tenant-scoped immutable previews and idempotent confirmations for service imports.
CREATE TABLE service_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    request_id UUID,
    preview_rows JSONB NOT NULL,
    preview_result JSONB NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_service_import_batches_request
    ON service_import_batches (tenant_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_service_import_batches_tenant_created
    ON service_import_batches (tenant_id, created_at DESC);

ALTER TABLE service_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_import_batches
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
