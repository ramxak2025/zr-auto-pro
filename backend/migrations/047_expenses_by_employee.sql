-- 047_expenses_by_employee.sql
-- Per-employee expense submission with optional daily cap + approval gate.
--
-- Columns added to expenses:
--   created_by      — the user who entered the expense (was previously
--                     overloaded onto user_id; that one stays for the
--                     "связанный сотрудник" semantic — eg salary expenses).
--   source          — 'owner' (default; owner/director/admin created) or
--                     'employee' (a non-privileged user created it). Used
--                     by the FE to render an "Ожидает одобрения" badge.
--   approval_status — 'approved' (default) / 'pending' / 'rejected'. Owner
--                     enforced via /expenses/:id/approve|reject endpoints.
--
-- Columns added to users:
--   can_add_expenses    — permission flag for non-director/admin users to
--                         submit expenses at all. Off by default.
--   daily_expense_limit — when set, any single-day total that crosses the
--                         limit auto-flips the expense to 'pending' (the
--                         submission still saves so the owner sees it).

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved';

-- Backfill source / approval_status for any pre-existing rows so the CHECK
-- constraint never fires on legacy data.
UPDATE expenses SET source = 'owner' WHERE source IS NULL;
UPDATE expenses SET approval_status = 'approved' WHERE approval_status IS NULL;

DO $$ BEGIN
  ALTER TABLE expenses
    ADD CONSTRAINT expenses_source_chk CHECK (source IN ('owner','employee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE expenses
    ADD CONSTRAINT expenses_approval_status_chk
    CHECK (approval_status IN ('approved','pending','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_approval_status ON expenses(tenant_id, approval_status);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_add_expenses BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_expense_limit NUMERIC(10,2);
