-- 066_notification_preferences.sql
-- Per-user notification preferences — OPT-OUT model.
--
--   * A row in notification_mutes == the user has MUTED that category.
--   * Absence of a row == subscribed (the default).
--
-- This opt-out shape means there is NOTHING to backfill: every existing user is
-- subscribed to everything until they explicitly mute a category. New categories
-- added later are also subscribed-by-default for free, with no data migration.
--
-- `category` is a free-text key validated in the application layer against the
-- canonical NotificationCategory set (shared/types/index.ts) — we deliberately
-- avoid a DB CHECK/enum so adding a category is a code-only change and never a
-- migration. Gating happens at push time:
--   sendToUserCategory(userId, category, …) skips delivery when a matching mute
--   row exists (see push.service.ts).
--
-- Idempotent / additive only — CREATE TABLE IF NOT EXISTS, no drops. Runs inside
-- the MigrationRunner BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS notification_mutes (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

-- The composite PK already indexes (user_id, category) left-to-right, which
-- serves both the per-user preferences read (GET /notifications/preferences)
-- and the NOT EXISTS mute lookup in sendToUserCategory.
