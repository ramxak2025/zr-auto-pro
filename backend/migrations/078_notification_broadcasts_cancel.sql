-- 078_notification_broadcasts_cancel.sql
-- Cancellable / revocable broadcasts.
--
-- Before this, a superadmin who fired a mistaken broadcast to every active
-- director had NO way to take it back: GET /notifications/broadcasts/unseen
-- returned every broadcast lacking a per-user "seen" row, so the mistake
-- re-surfaced on every client foreground fetch, forever, for all directors.
--
-- `cancelled_at` is the revoke marker. The unseen query now additionally filters
-- `cancelled_at IS NULL`, so writing this column makes the broadcast vanish for
-- ALL directors at once — filtered at SOURCE, no per-user seen backfill needed.
--   NULL      = live broadcast, still surfaces to unseen directors.
--   timestamp = cancelled at that instant, never surfaces again.
--
-- Idempotent / additive only — ADD COLUMN IF NOT EXISTS, no drops, no data loss.

ALTER TABLE notification_broadcasts ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
