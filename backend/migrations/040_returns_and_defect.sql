-- 040_returns_and_defect.sql
-- Check returns (full / partial) + defect transfer reason support.

-- Header row: one per return event on a check.
CREATE TABLE IF NOT EXISTS check_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  destination TEXT NOT NULL CHECK (destination IN ('warehouse','defect')),
  reason TEXT,
  refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  scope TEXT NOT NULL CHECK (scope IN ('full','partial')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_check_returns_check ON check_returns(check_id);
CREATE INDEX IF NOT EXISTS idx_check_returns_tenant_date ON check_returns(tenant_id, created_at DESC);

-- Per-line returns (only populated for partial scope).
CREATE TABLE IF NOT EXISTS check_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES check_returns(id) ON DELETE CASCADE,
  product_line_id UUID,
  service_line_id UUID,
  product_id UUID,
  quantity NUMERIC(10,3) DEFAULT 1,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_check_return_lines_return ON check_return_lines(return_id);

-- Mark checks as returned so the journal can render the strikethrough state and the
-- dashboard can quickly count returns for the day without scanning check_returns.
ALTER TABLE checks
  ADD COLUMN IF NOT EXISTS is_returned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_destination TEXT,
  ADD COLUMN IF NOT EXISTS return_scope TEXT;
CREATE INDEX IF NOT EXISTS idx_checks_returned ON checks(tenant_id, is_returned) WHERE is_returned = true;

-- Stock movement reason — used for defect entries and the defect-transfer wrapper.
-- Mostly already present but kept idempotent.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS reason TEXT;
