-- Drop old simple equipment table and recreate with proper structure
DROP TABLE IF EXISTS equipment CASCADE;

-- Storage room categories (folders in the storage room)
CREATE TABLE IF NOT EXISTS storage_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES storage_categories(id) ON DELETE CASCADE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Storage room items (tools, uniforms, etc. in storage)
CREATE TABLE IF NOT EXISTS storage_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES storage_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    photo TEXT,
    purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'шт',
    service_life_months INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Equipment issued to employees
CREATE TABLE IF NOT EXISTS equipment_issued (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_item_id UUID REFERENCES storage_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    photo TEXT,
    cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    category_type TEXT NOT NULL DEFAULT 'tools' CHECK (category_type IN ('tools', 'uniform', 'other')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_life_months INT,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'replaced', 'trashed')),
    trashed_at TIMESTAMPTZ,
    trash_expires_at TIMESTAMPTZ,
    return_reason TEXT,
    replaced_by UUID REFERENCES equipment_issued(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_categories_tenant ON storage_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_storage_items_tenant ON storage_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_storage_items_category ON storage_items(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_issued_tenant ON equipment_issued(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_issued_user ON equipment_issued(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_issued_status ON equipment_issued(status);
