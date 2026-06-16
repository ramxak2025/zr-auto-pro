-- 071_section_visibility.sql
-- Feature #14/#15 — per-employee section visibility.
--
-- Owners decide, per user, which top-level sections that employee may see in
-- the app. A section is identified by a stable `section_key` constrained to the
-- five logical groups the UI buckets navigation into:
--   work       — касса / журнал / расписание / клиенты / авто …
--   finance    — зарплата / расходы / движение денег / отчёты …
--   warehouse  — склад / товары / поставщики …
--   marketing  — маркетинг / отзывы / звонки …
--   other      — прочее (имущество, база знаний, настройки …)
--
-- The absence of a row means "use the default" (visible) — the server only
-- persists explicit overrides, so existing tenants/users are unaffected.
--
-- Multi-tenant: every row carries tenant_id (scoped to the JWT tenant) and a
-- user_id; the UNIQUE(tenant_id, user_id, section_key) is the upsert key.
--
-- Idempotent / additive only — CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS. Re-runnable on a partially-applied DB.

CREATE TABLE IF NOT EXISTS section_visibility (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK (section_key IN ('work','finance','warehouse','marketing','other')),
  is_visible  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, section_key)
);

-- The hot read is "all overrides for one user within the tenant" (resolving a
-- user's visible sections). The UNIQUE constraint already leads with
-- (tenant_id, user_id), but a dedicated index keeps the lookup explicit and
-- survives any future change to the unique key.
CREATE INDEX IF NOT EXISTS idx_section_visibility_tenant_user
  ON section_visibility (tenant_id, user_id);
