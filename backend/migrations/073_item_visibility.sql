-- 073_item_visibility.sql
-- Granular per-employee visibility at the ITEM (sub-section) level.
--
-- This SITS ALONGSIDE 071_section_visibility (group-level) — it does NOT replace
-- it. The «Ещё» menu first drops a wholly-hidden group (071), then within a
-- visible group an owner may additionally hide individual items (073).
--
-- An item is identified by a stable `item_key` matching the menu rows in
-- mobile/src/screens/MoreScreen.tsx (resolved from each row's `screen`):
--   work       — schedule, clients, knowledge-base
--   finance    — cashflow, salary, expenses, reports
--   warehouse  — services, suppliers, equipment, warehouse-analytics
--   marketing  — marketing, calls, mailings, integrations
--   other      — employees, users, company-settings, subscription
--
-- NO CHECK constraint on item_key on purpose: the menu set is expected to grow,
-- and a DB-level enum would force a migration every time a new screen is added.
-- The canonical set is enforced in the application layer (shared ITEM_KEYS).
--
-- The absence of a row means "use the default" (visible) — only explicit
-- overrides are persisted, so existing tenants/users are unaffected.
--
-- Multi-tenant: every row carries tenant_id (scoped to the JWT tenant) and a
-- user_id; UNIQUE(tenant_id, user_id, item_key) is the upsert key.
--
-- Idempotent / additive only — CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS. Re-runnable on a partially-applied DB.

CREATE TABLE IF NOT EXISTS item_visibility (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  is_visible  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, item_key)
);

-- The hot read is "all item overrides for one user within the tenant" (resolving
-- a user's visible menu items). Mirrors the 071 index shape.
CREATE INDEX IF NOT EXISTS idx_item_visibility_tenant_user
  ON item_visibility (tenant_id, user_id);
