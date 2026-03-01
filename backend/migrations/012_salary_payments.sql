CREATE TABLE IF NOT EXISTS salary_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  month_year TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'salary',
  comment TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_tenant ON salary_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_user ON salary_payments(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_month ON salary_payments(tenant_id, month_year);
