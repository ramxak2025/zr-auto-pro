-- Internal platform CRM. These tables are deliberately NOT tenant app resources.
-- MigrationRunner grants autexa_app access to all tables: FORCE RLS with no
-- policies is the deny-by-default boundary, including when tenant_id matches.
CREATE TABLE IF NOT EXISTS platform_tenant_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Historical author identity and name are immutable snapshots (like audit).
  author_user_id UUID NOT NULL,
  author_name TEXT,
  request_id UUID NOT NULL,
  text TEXT NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (author_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_tenant_notes_page
  ON platform_tenant_notes (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS platform_tenant_followups (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_contact_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_tenant_followups_due
  ON platform_tenant_followups (next_contact_at) WHERE next_contact_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_reminder_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expiry_enabled BOOLEAN NOT NULL DEFAULT true,
  days_before INTEGER[] NOT NULL DEFAULT ARRAY[7,3,1,0],
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(days_before) <= 8 AND array_position(days_before, NULL) IS NULL
    AND days_before <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]),
  CHECK (NOT expiry_enabled OR cardinality(days_before) > 0)
);

-- One delivery ATTEMPT per operator/event; no ambiguous delivery retries.
CREATE TABLE IF NOT EXISTS platform_reminder_claims (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_key)
);

ALTER TABLE platform_tenant_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tenant_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_tenant_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tenant_followups FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reminder_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_reminder_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reminder_claims FORCE ROW LEVEL SECURITY;
