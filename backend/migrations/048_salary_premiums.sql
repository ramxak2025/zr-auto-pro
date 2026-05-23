-- 048_salary_premiums.sql
-- Cash premiums and percent-bonuses awarded by the owner.
--   type = 'cash'        → fixed amount on top of next salary payment.
--   type = 'rate_bonus'  → temporary additional percent on the master's
--                          salary_percent for the given month.
-- Premium rows are immutable from the employee's side; the awarder can
-- delete a premium if they entered the wrong amount.

CREATE TABLE IF NOT EXISTS salary_premiums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cash','rate_bonus')),
  amount NUMERIC(10,2),
  bonus_percent NUMERIC(5,2),
  reason TEXT NOT NULL,
  period_month_year TEXT,
  awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_premiums_user_month
  ON salary_premiums(user_id, period_month_year);

CREATE INDEX IF NOT EXISTS idx_salary_premiums_tenant
  ON salary_premiums(tenant_id);
