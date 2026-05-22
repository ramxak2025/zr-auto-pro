-- 041_schedule_settings.sql
-- Per-tenant configuration of which attendance statuses count as a real shift.
-- Default = worked + short (so short shifts still count). Owner can enable
-- "dayoff", "sick", "long", "absent" to flip statuses into the shift bucket.

CREATE TABLE IF NOT EXISTS schedule_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  shift_statuses JSONB NOT NULL DEFAULT '["worked","short"]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
