-- 083_loyalty.sql
-- Программа лояльности / бонусы / кешбэк (loyalty / bonus / cashback).
--
-- ADDITIVE module. Per-tenant config + a single-sided bonus ledger per client.
--   • loyalty_settings — one row per tenant: enabled flag + accrual% + redeem cap%.
--   • client_bonuses   — ledger of bonus movements:
--        type='accrual'    — bonus credited (e.g. % of a paid check).
--        type='redemption' — bonus spent (pays part of a check).
--     Per-client balance = SUM(accrual) − SUM(redemption); it is NEVER allowed to
--     go negative — a redemption that would overdraw the balance is rejected (400)
--     in the service layer.
--
-- This migration ONLY adds the two loyalty tables. It NEVER touches `checks`,
-- `clients`, `expenses` or any existing write path — the optional `check_id`
-- link is a soft pointer to the originating check, nulled if that check is
-- deleted, and nothing in the checks write path writes to these tables. Bonus
-- accrual/redemption are EXPLICIT actions invoked by the cash UI, not a side
-- effect of creating a check.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS (via DO
-- blocks that swallow duplicate_column / undefined_table) + CREATE INDEX IF NOT
-- EXISTS, so a partially-applied / pre-existing table converges to the full
-- shape on re-run. Never edited once applied.

-- ── loyalty_settings ────────────────────────────────────────────────────────
-- One row per tenant. Upserted-on-read by the service (default row created the
-- first time a tenant opens the loyalty screen), so a missing row is fine.
CREATE TABLE IF NOT EXISTS loyalty_settings (
    -- One config per tenant → tenant_id is the primary key.
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Master switch. While false, no accrual happens (accrue → 422); existing
    -- balances can still be spent via redeem.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- % of a check total credited as bonus on accrual. NUMERIC(5,2) → 0.00..999.99,
    -- clamped to 0..100 in the DTO.
    accrual_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Max % of a single check that may be paid with bonus on redemption.
    redeem_max_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `loyalty_settings` table.
DO $$ BEGIN ALTER TABLE loyalty_settings ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE loyalty_settings ADD COLUMN accrual_percent NUMERIC(5,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE loyalty_settings ADD COLUMN redeem_max_percent NUMERIC(5,2) NOT NULL DEFAULT 50; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE loyalty_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── client_bonuses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_bonuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    -- Positive money amount of this single movement. Direction is in `type`.
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    -- 'accrual' = бонус начислен, 'redemption' = бонус списан.
    type TEXT NOT NULL CHECK (type IN ('accrual', 'redemption')),
    -- Soft link to the originating check, if this entry came from one. Nulled
    -- (not deleted) when that check is removed so the ledger stays intact.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    -- Free-form reason ("кешбэк за заказ-наряд", "ручная корректировка"). NULL allowed.
    reason TEXT,
    -- Who recorded the entry. NULL-on-delete keeps the history row.
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `client_bonuses` table.
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN type TEXT NOT NULL DEFAULT 'accrual'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN reason TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_bonuses ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────
-- Per-client ledger fetch + balance aggregation both lead with tenant_id.
CREATE INDEX IF NOT EXISTS idx_client_bonuses_tenant_client ON client_bonuses (tenant_id, client_id);
-- Newest-first scans / time-window reporting.
CREATE INDEX IF NOT EXISTS idx_client_bonuses_tenant_created ON client_bonuses (tenant_id, created_at DESC);
