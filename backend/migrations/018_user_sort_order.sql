-- Global master sort order for schedule display
ALTER TABLE users ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_sort_order ON users(tenant_id, sort_order);
