-- 179_shared_check_template_folders.sql
-- Tenant-shared template folders. NULL owner is the shared scope; UUID owner
-- remains a private tree. Existing rows retain their private owner/template
-- visibility, while legacy user_id NULL templates remain shared as before.

ALTER TABLE check_template_folders ALTER COLUMN user_id DROP NOT NULL;

-- Parent links must stay inside a tenant even if a caller supplies a foreign
-- folder UUID. Application checks also enforce private/shared scope ownership.
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_template_folders_id_tenant
  ON check_template_folders(id, tenant_id);
ALTER TABLE check_template_folders
  DROP CONSTRAINT IF EXISTS check_template_folders_parent_id_fkey;
ALTER TABLE check_template_folders
  ADD CONSTRAINT check_template_folders_parent_tenant_fkey
  FOREIGN KEY (parent_id, tenant_id)
  REFERENCES check_template_folders(id, tenant_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_check_template_folders_tenant_shared_parent
  ON check_template_folders(tenant_id, parent_id, sort, name)
  WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_check_templates_tenant_shared_folder
  ON check_templates(tenant_id, folder_id, name)
  WHERE user_id IS NULL;

-- Legacy compatibility is granted only to the system Admin role row. This
-- does not grant access directly to users or custom roles; their explicit
-- role matrix remains the source of the permission.
UPDATE roles SET matrix = '{}'::jsonb WHERE matrix IS NULL;
UPDATE roles
   SET matrix = jsonb_set(matrix, '{templates}', COALESCE(matrix -> 'templates', '{}'::jsonb), true)
 WHERE matrix -> 'templates' IS NULL;
UPDATE roles
   SET matrix = jsonb_set(matrix, '{templates,manageShared}', 'true'::jsonb, true)
 WHERE is_system = true
   AND system_key = 'admin'
   AND matrix #> '{templates,manageShared}' IS NULL;
