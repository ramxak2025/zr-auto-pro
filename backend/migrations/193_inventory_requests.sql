-- Additive receipt ledger: no changes to products or historical movements.
-- The response is committed in the SAME transaction as the stock movement.
-- Do not expire receipts: a late retry must never overwrite a later movement.
CREATE TABLE inventory_requests (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    fingerprint TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, request_id)
);

ALTER TABLE inventory_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_requests
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
