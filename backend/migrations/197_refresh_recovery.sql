-- Atomic rotation receipt. No bearer or recovery capability is stored here.
-- Old rows stay force-revoked; only new explicit refresh rows are recoverable.
ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS revocation_reason text NOT NULL DEFAULT 'forced';
ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS refresh_key_hash text;
ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS refresh_successor jsonb;
ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS refresh_recover_until timestamptz;
ALTER TABLE revoked_tokens ADD COLUMN IF NOT EXISTS refresh_source_point_id uuid;

COMMENT ON COLUMN revoked_tokens.refresh_key_hash IS 'SHA-256 of secret client recovery UUID; never a bearer';
COMMENT ON COLUMN revoked_tokens.refresh_successor IS 'Immutable signed claims, not a signed credential';
COMMENT ON COLUMN revoked_tokens.refresh_recover_until IS 'Bounded by original and successor exp; never extended on replay';
