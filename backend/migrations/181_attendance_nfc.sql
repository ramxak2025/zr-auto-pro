-- Static NDEF tags authenticate an attendance intent, not physical presence.
-- Tokens are one-time disclosures; only SHA-256 digests are retained.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS first_nfc_at TIMESTAMPTZ;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS nfc_closed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS shifts_nfc_last_close ON shifts (tenant_id, user_id, date, nfc_closed_at DESC)
  WHERE nfc_closed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance_nfc_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  point_id UUID REFERENCES tenant_points(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS attendance_nfc_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id UUID REFERENCES tenant_points(id),
  tag_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id),
  FOREIGN KEY (tenant_id, tag_id) REFERENCES attendance_nfc_tags (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS attendance_nfc_tags_scope ON attendance_nfc_tags (tenant_id, point_id, status);
CREATE INDEX IF NOT EXISTS attendance_nfc_requests_user ON attendance_nfc_requests (tenant_id, user_id, created_at DESC);
ALTER TABLE attendance_nfc_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_nfc_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_nfc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_nfc_requests FORCE ROW LEVEL SECURITY;
DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['attendance_nfc_tags','attendance_nfc_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;
