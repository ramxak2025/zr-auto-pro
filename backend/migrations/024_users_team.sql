-- ─────────────────────────────────────────────────────────────────────────
--  Free-text team grouping for users.
--
--  Owners can pin every user into a custom group like "Диагносты",
--  "Мастера", "Администрация", or anything they invent. The frontend
--  uses this column to group cards on the Employees page.
--
--  Stays NULL for legacy users → renders as "Без группы".
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN team TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_tenant_team ON users (tenant_id, team) WHERE team IS NOT NULL;
