-- 043_employee_documents_achievements.sql
-- Employee documents (passport, diploma, certificates) + achievements (auto + custom).

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT,
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  expires_at DATE
);
CREATE INDEX IF NOT EXISTS idx_employee_docs_user ON employee_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_docs_tenant ON employee_documents(tenant_id);

CREATE TABLE IF NOT EXISTS employee_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  type TEXT NOT NULL CHECK (type IN ('auto','custom')),
  awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  awarded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_achievements_user ON employee_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_achievements_tenant ON employee_achievements(tenant_id);
