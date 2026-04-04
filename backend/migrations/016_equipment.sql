-- Equipment / Property management for employees
CREATE TABLE IF NOT EXISTS equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    photo TEXT,
    cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'new' CHECK (source IN ('warehouse', 'new')),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_life_months INT,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'replaced', 'written_off')),
    replaced_by UUID REFERENCES equipment(id) ON DELETE SET NULL,
    replaced_at TIMESTAMPTZ,
    return_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_tenant ON equipment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_user ON equipment(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
