-- ─────────────────────────────────────────────────────────────────────────
--  «Уволенные» (dismissed employees) — recycle-bin for staff.
--
--  Deleting an employee must NEVER hard-delete the users row: historical
--  checks / shifts / salary / equipment all reference it by FK, and old
--  order-narjads must still resolve the (now-dismissed) master's name.
--
--  We model two soft states on the existing users row instead:
--
--    dismissed_at  — set when an employee is "fired" (moved to the recycle
--                    bin). The row is still resolvable for history, but the
--                    user is hidden from every ACTIVE list and can't log in
--                    work flows. Restorable within the year.
--    purged_at     — set on "delete completely". The row is STILL kept (FKs
--                    stay intact, historical names still resolve) but the user
--                    disappears from the Уволенные list too and can no longer
--                    be restored.
--
--  Derived states:
--    Active            = dismissed_at IS NULL AND purged_at IS NULL
--    Dismissed (bin)   = dismissed_at IS NOT NULL AND purged_at IS NULL
--    Purged (hidden)   = purged_at IS NOT NULL
--
--  All statements are idempotent (IF NOT EXISTS) and additive — no data
--  changes, no drops. Runs inside the MigrationRunner BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS dismissed_at timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purged_at    timestamptz NULL;

-- Drives the Уволенные list (tenant-scoped, dismissed-but-not-purged, newest
-- first) and lets the active-list queries cheaply skip dismissed/purged rows.
CREATE INDEX IF NOT EXISTS idx_users_tenant_dismissed
    ON users (tenant_id, dismissed_at);

ANALYZE users;
