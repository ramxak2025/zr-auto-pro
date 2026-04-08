-- Custom master commission percent for specific services
-- If set (NOT NULL), this percent is used instead of user.salary_percent for this service
ALTER TABLE services ADD COLUMN IF NOT EXISTS master_percent NUMERIC(5,2);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);
