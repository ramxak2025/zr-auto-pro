-- 067_notification_broadcasts.sql
-- Superadmin → director broadcasts, persisted so a missed push can be
-- re-fetched on app open (push is best-effort and never the source of truth).
--
--   notification_broadcasts       — the broadcast itself (title/body + optional
--                                   image + action buttons). Authored by a
--                                   superadmin, fanned out cross-tenant to every
--                                   active director (the автосервис «владелец»).
--   notification_broadcast_seen   — per-user "I have seen this" marker so
--                                   GET /notifications/broadcasts/unseen can skip
--                                   what's already been shown.
--
-- buttons is a JSONB array of { label, action: 'dismiss'|'link', url? } — same
-- shape as the BroadcastButton shared type. JSONB (not jsonb-of-text) so clients
-- read it directly.
--
-- created_by uses ON DELETE SET NULL (a deleted superadmin must not vaporise the
-- broadcast history); the seen rows use ON DELETE CASCADE off both parents.
--
-- Idempotent / additive only — CREATE TABLE / INDEX IF NOT EXISTS, no drops.

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  image_url  TEXT,
  buttons    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first listing of broadcasts.
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_created
  ON notification_broadcasts (created_at DESC);

CREATE TABLE IF NOT EXISTS notification_broadcast_seen (
  broadcast_id UUID        NOT NULL REFERENCES notification_broadcasts(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);

-- Drives the "unseen for this user" query (NOT EXISTS join on user_id) and the
-- per-user seen upsert.
CREATE INDEX IF NOT EXISTS idx_notification_broadcast_seen_user
  ON notification_broadcast_seen (user_id);
