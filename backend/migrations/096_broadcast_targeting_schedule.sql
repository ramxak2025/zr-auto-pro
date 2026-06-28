-- 096_broadcast_targeting_schedule.sql
-- Superadmin broadcast cabinet — two additive capabilities (096):
--   1. Targeting (segments) — send to a SUBSET of tenants instead of everyone.
--   2. Scheduled send (отложенная отправка) — queue a broadcast for a future
--      instant; a cron (RUN_BACKGROUND_JOBS leader only) releases it when due.
-- (The MRR-trends endpoint needs NO schema — it is derived from tenants/plans at
--  query time.)
--
-- All additive & idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS / guarded backfill. The 067/078 rows are untouched and keep delivering
-- to every active director exactly as before.

-- ── New columns on notification_broadcasts ──────────────────────────────────

-- Delivery instant. now() for an immediate broadcast, a FUTURE instant for a
-- deferred one. NULL only for legacy rows created before this migration — the
-- backfill below stamps them so the scheduler never re-picks them.
ALTER TABLE notification_broadcasts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- When fan-out actually fired (recipients materialized + push sent). NULL = not
-- yet delivered: a queued scheduled broadcast, or a transient failure awaiting
-- the scheduler's next retry. The director-facing "unseen" query now requires
-- sent_at IS NOT NULL, so a pending scheduled broadcast never surfaces early.
ALTER TABLE notification_broadcasts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- Segment criteria (JSONB) resolved to recipients at SEND time. NULL = no
-- segment = every active tenant (back-compat). Stored for cabinet display/audit.
ALTER TABLE notification_broadcasts ADD COLUMN IF NOT EXISTS segment JSONB;

-- Fast-path flag: true = broadcast to everyone (skip the recipients join),
-- false = segmented (audience is materialized in notification_broadcast_recipients).
ALTER TABLE notification_broadcasts ADD COLUMN IF NOT EXISTS target_all BOOLEAN NOT NULL DEFAULT true;

-- Backfill legacy (067/078) rows: authored under the immediate-send code, so
-- they are already delivered to everyone. Stamp sent_at / scheduled_at =
-- created_at (only where NULL) so the new sent_at visibility gate keeps showing
-- them and the scheduler never re-picks them (scheduled_at <= now() but sent_at
-- already set). target_all defaulted to true above — correct for legacy rows.
UPDATE notification_broadcasts
   SET sent_at      = COALESCE(sent_at, created_at),
       scheduled_at = COALESCE(scheduled_at, created_at)
 WHERE sent_at IS NULL OR scheduled_at IS NULL;

-- ── Frozen per-broadcast audience for SEGMENTED broadcasts ───────────────────
-- Resolved once at send time from `segment`, so the audience is stable even if a
-- tenant's plan / subscription changes afterwards. target_all broadcasts store
-- NO rows here — the read path short-circuits on target_all = true.
CREATE TABLE IF NOT EXISTS notification_broadcast_recipients (
  broadcast_id UUID NOT NULL REFERENCES notification_broadcasts(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (broadcast_id, tenant_id)
);

-- Drives the director-facing unseen query (recipient match on the user's tenant).
CREATE INDEX IF NOT EXISTS idx_notification_broadcast_recipients_tenant
  ON notification_broadcast_recipients (tenant_id);

-- Drives the scheduler's due-pickup scan: pending (sent_at IS NULL), not
-- cancelled, scheduled_at <= now(). Partial predicate keeps the index tiny —
-- it only ever holds the handful of not-yet-delivered rows.
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_due
  ON notification_broadcasts (scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;
