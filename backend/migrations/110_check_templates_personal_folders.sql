-- 110_check_templates_personal_folders.sql
-- Round 8, item 3: personal check templates + personal folders.
--
-- check_templates.user_id:
--   NULL  = «общий» шаблон (legacy rows and owner-created shared ones) —
--           visible to every employee of the tenant. All pre-110 rows keep
--           NULL, so existing behaviour is unchanged (backward-compatible).
--   value = personal template, visible only to its author.
--
-- check_templates.folder_id:
--   Optional link into check_template_folders. Folders are PERSONAL
--   (user_id NOT NULL); общие templates stay folder-less (enforced in
--   service code). No FK on purpose: the folder-delete flow nulls the
--   column for the whole descendant subtree inside one transaction in
--   CheckTemplatesService.removeFolder.
ALTER TABLE check_templates ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE check_templates ADD COLUMN IF NOT EXISTS folder_id UUID;

CREATE TABLE IF NOT EXISTS check_template_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES check_template_folders(id) ON DELETE CASCADE,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_template_folders_tenant_user
  ON check_template_folders(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_check_template_folders_parent
  ON check_template_folders(parent_id);

-- Visibility filter is tenant_id + (user_id IS NULL OR user_id = actor);
-- folder index serves the "null templates out of a deleted subtree" update.
CREATE INDEX IF NOT EXISTS idx_check_templates_tenant_user
  ON check_templates(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_check_templates_folder
  ON check_templates(folder_id);
