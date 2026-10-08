-- Employee directions group staff for management, schedule and planning views.
-- Direction ids are tenant-scoped at both the API and database boundaries.
CREATE TABLE IF NOT EXISTS employee_directions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT employee_directions_tenant_id_id_key UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_directions_tenant_name
    ON employee_directions (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_employee_directions_tenant_order
    ON employee_directions (tenant_id, sort_order, name);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS direction_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_direction_tenant_fkey'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_direction_tenant_fkey
            FOREIGN KEY (tenant_id, direction_id)
            REFERENCES employee_directions (tenant_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_direction_requires_tenant_check'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_direction_requires_tenant_check
            CHECK (direction_id IS NULL OR tenant_id IS NOT NULL);
    END IF;
END $$;

ALTER TABLE employee_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_directions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_directions;
CREATE POLICY tenant_isolation ON employee_directions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
