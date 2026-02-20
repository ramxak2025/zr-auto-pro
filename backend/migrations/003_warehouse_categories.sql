-- Warehouse categories table for persisting empty folders
CREATE TABLE IF NOT EXISTS warehouse_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(path, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_categories_tenant ON warehouse_categories(tenant_id);
