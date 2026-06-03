-- 056_salary_penalties.sql
-- Feature #9 — Salary penalties (штрафы).
--
-- A penalty is a standalone monetary deduction (amount + description + date)
-- applied to one employee. The salary aggregation subtracts the sum of
-- penalties in the period from the employee's remaining owed amount:
--   remainingAmount = totalEarnings - paidAmount - penaltiesAmount
--
-- Penalties are independent of `salary_payments` / `salary_premiums` and do
-- not write an expenses row (the money was never paid out — it's a reduction
-- of what is owed). Managed by director / admin / superadmin only.

CREATE TABLE IF NOT EXISTS salary_penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_penalties_tenant_user
  ON salary_penalties(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_salary_penalties_date
  ON salary_penalties(tenant_id, date);
