-- 128_plans_min_team_users.sql
-- App Store 3.1.3(c) «Enterprise Services»: Autexa is a service for
-- «organizations or groups of employees», never for a single (1) user. To keep
-- that positioning provable, NO plan (and no tenant seat cap) may serve fewer
-- than 2 employees — the minimum team is 2.
--
-- This migration RAISES FLOORS ONLY. It never lowers max_users for anyone:
--   • plans.max_users  < 2  → 2   (owner-configured tiers: free / trial / starter)
--   • tenants.max_users < 2  → 2   (belt-and-braces; live tenants default to 10)
-- Every plan/tenant already at ≥2 is left byte-for-byte unchanged, so no existing
-- tenant loses a single seat. `max_users` is a display/metadata number — there is
-- no seat-limit enforcement on user creation anywhere in the backend — so this is
-- a pure «minimum advertised team» change and cannot revoke anyone's access.
--
-- The code default is also floored in plans.service.ts (floorMaxUsers ≥ 2), so a
-- superadmin can never save a 1-seat plan through the editor.
--
-- Idempotent: guarded UPDATEs (WHERE max_users < 2) are no-ops on re-run once the
-- floor holds; the DEFAULT change is unconditional but converges to the same
-- state. Wrapped in DO-blocks that swallow undefined_table so a partially-migrated
-- DB never aborts the runner. Never edited once applied.

-- ── 1. Floor every owner-configured plan tier to a 2-person team ─────────────
DO $$
BEGIN
  UPDATE plans SET max_users = 2 WHERE max_users IS NULL OR max_users < 2;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END $$;

-- ── 2. Floor any tenant seat cap too (defensive; prod tenants are already ≥10) ─
DO $$
BEGIN
  UPDATE tenants SET max_users = 2 WHERE max_users IS NULL OR max_users < 2;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END $$;

-- ── 3. New plans created directly at the SQL layer default to a team, not 1 ───
-- (Belongs-and-braces; the service-layer create() already floors to ≥2.)
DO $$
BEGIN
  ALTER TABLE plans ALTER COLUMN max_users SET DEFAULT 5;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END $$;
