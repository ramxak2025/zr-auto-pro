-- 057_expense_category_approval.sql
-- Feature #11 — Expense approval controls.
--
-- Per-category flag. When `approval_required = true`, any expense created in
-- that category by a NON-privileged user (not director/admin/superadmin) is
-- forced to approval_status='pending' regardless of the per-user daily limit.
-- Privileged users always stay 'approved'.
--
-- Default false → no behavior change for existing categories / data. The flag
-- is layered ON TOP of the existing daily-limit gate from 047; either trigger
-- flips a non-privileged expense to 'pending'.

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
