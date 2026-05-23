-- 053_retail_buyer.sql
-- Pinned tenant-scoped "Розничный покупатель" client used by the cash
-- screen when the sale is OTC and we don't want to attach a real client
-- record (no phone, no follow-up SMS, no marketing). Each tenant gets at
-- most one — enforced by the partial unique index. The bootstrap insert
-- below seeds the row for every existing tenant that doesn't already
-- have one.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_retail BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_retail_per_tenant
  ON clients(tenant_id) WHERE is_retail = true;

CREATE INDEX IF NOT EXISTS idx_clients_retail
  ON clients(tenant_id, is_retail) WHERE is_retail = true;

INSERT INTO clients (id, tenant_id, full_name, phone, is_retail)
SELECT gen_random_uuid(), t.id, 'Розничный покупатель', '', true
  FROM tenants t
  LEFT JOIN clients c ON c.tenant_id = t.id AND c.is_retail = true
 WHERE c.id IS NULL;
