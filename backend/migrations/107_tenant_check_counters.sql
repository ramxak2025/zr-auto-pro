-- 107_tenant_check_counters.sql
-- Per-tenant check numbering (audit round 7, item 3).
--
-- PROBLEM: checks.number is a single global SERIAL shared by every tenant.
-- Tenant A creating a check bumps the number tenant B sees next — a metadata
-- leak (order volume is inferable from the gaps) and ugly non-consecutive
-- numbering inside each tenant's journal.
--
-- FIX: a tiny per-tenant counter table. ChecksService.create() now allocates
-- the number INSIDE its existing transaction via
--   UPDATE tenant_counters SET next_check_number = next_check_number + 1
--   WHERE tenant_id = $1 RETURNING next_check_number - 1
-- (the row lock serialises concurrent creates per tenant) and writes `number`
-- explicitly in the INSERT instead of relying on the global SERIAL default.
--
-- BACKWARD COMPATIBLE: existing numbers keep their values. Each tenant's
-- counter is seeded from its current MAX(number)+1, so the live tenant's
-- sequence continues without any visible jump — the cross-tenant gaps simply
-- stop appearing from now on. The checks.number column/type/default are left
-- untouched (the SERIAL default keeps backing any legacy INSERT path).
--
-- Idempotent: IF NOT EXISTS everywhere + ON CONFLICT DO NOTHING on the seed.

CREATE TABLE IF NOT EXISTS tenant_counters (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    next_check_number BIGINT NOT NULL
);

-- Seed a counter row for every EXISTING tenant from its current max check
-- number. Re-running never overwrites an already-seeded (possibly advanced)
-- counter. Tenants created after this migration get their row lazily from
-- ChecksService.create() (same MAX(number)+1 seed, race-safe via ON CONFLICT).
INSERT INTO tenant_counters (tenant_id, next_check_number)
SELECT t.id, COALESCE((SELECT MAX(c.number) FROM checks c WHERE c.tenant_id = t.id), 0) + 1
  FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- DB-level backstop: a duplicate (tenant, number) can never be persisted even
-- if two writers raced around the counter. Existing data satisfies this by
-- construction (the old global SERIAL was globally unique, hence per-tenant
-- unique too). NULL tenant_id rows (legacy) don't participate in uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_checks_tenant_number ON checks (tenant_id, number);
