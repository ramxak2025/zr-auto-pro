-- Warranty claims — every product or service in a check with
-- warranty_days set spawns one warranty_claims row.
--
-- Lookup directions:
--   "Does THIS client have any active warranties?"   → tenant + client + not expired + not used
--   "Does THIS car have any active warranties?"      → tenant + car    + not expired + not used
--   "List of warranties redeemed in the last month"  → tenant + used_at BETWEEN ...
--
-- When a future check redeems a warranty, we mark used_at + used_check_id.

CREATE TABLE IF NOT EXISTS warranty_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    check_id        UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
    car_id          UUID REFERENCES cars(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('product','service')),
    product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
    service_id      UUID REFERENCES services(id) ON DELETE SET NULL,
    -- Snapshot of the name at sale time so display does not break if the
    -- product / service is later renamed or deleted.
    item_name       TEXT,
    warranty_days   INT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    used_check_id   UUID REFERENCES checks(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warranty_claims_client_idx  ON warranty_claims (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS warranty_claims_car_idx     ON warranty_claims (tenant_id, car_id);
CREATE INDEX IF NOT EXISTS warranty_claims_expires_idx ON warranty_claims (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS warranty_claims_check_idx   ON warranty_claims (tenant_id, check_id);
