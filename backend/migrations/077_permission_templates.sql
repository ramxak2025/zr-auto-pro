-- 077_permission_templates.sql
-- Named permission templates («роли»): a tenant defines reusable, named sets of
-- action-permissions, then APPLIES one to an employee — copying the template's
-- map into that user's users.permissions. The template itself is just a saved
-- blueprint; there is no live link back to the users it was applied to (applying
-- is a one-shot copy, exactly like the existing PATCH /users/:id/permissions).
--
-- `permissions` mirrors the shape of users.permissions / UserPermissions
-- (Record<string,boolean>); we keep NO DB CHECK on the keys (the permission
-- vocabulary may grow — same stance as section/item visibility).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + CREATE
-- INDEX IF NOT EXISTS so a partially-applied / pre-existing table converges.

CREATE TABLE IF NOT EXISTS permission_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Safe column adds for any pre-existing `permission_templates` table.
DO $$ BEGIN ALTER TABLE permission_templates ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE permission_templates ADD COLUMN name TEXT NOT NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE permission_templates ADD COLUMN permissions JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE permission_templates ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE permission_templates ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- All reads/writes are tenant-scoped; index the access path.
CREATE INDEX IF NOT EXISTS idx_permission_templates_tenant ON permission_templates (tenant_id);
