-- 081_client_debts.sql
-- Дебиторка / долги клиентов (client receivables / debts ledger).
--
-- ADDITIVE module. A plain double-sided ledger of what each client owes the
-- shop. Every row is one explicit movement:
--   • type='charge'  — клиент стал должен больше (e.g. work done on credit).
--   • type='payment' — погашение долга (client paid back).
-- Per-client balance is computed plainly as SUM(charge) − SUM(payment); it may
-- go negative (overpayment / client credit) and is never clamped here.
--
-- This migration ONLY adds the `client_debts` table. It NEVER touches `checks`,
-- `clients`, `expenses` or any existing write path — the optional `check_id`
-- link is a soft pointer to the originating check, nulled if that check is
-- deleted, and nothing in the checks write path writes to this table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS (via DO
-- blocks that swallow duplicate_column / undefined_table) + CREATE INDEX IF NOT
-- EXISTS, so a partially-applied / pre-existing table converges to the full
-- shape on re-run. Never edited once applied.

-- ── client_debts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_debts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    -- Positive money amount of this single movement. Direction is in `type`.
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    -- 'charge' = долг вырос, 'payment' = погашение.
    type TEXT NOT NULL CHECK (type IN ('charge', 'payment')),
    -- Free-form reason ("ремонт в долг", "частичная оплата"). NULL allowed.
    reason TEXT,
    -- Soft link to the originating check, if this entry came from one. Nulled
    -- (not deleted) when that check is removed so the ledger stays intact.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    -- Who recorded the entry (owner-class). NULL-on-delete keeps the history row.
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `client_debts` table.
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN type TEXT NOT NULL DEFAULT 'charge'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN reason TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE client_debts ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────
-- Per-client ledger fetch + the debtors GROUP BY both lead with tenant_id.
CREATE INDEX IF NOT EXISTS idx_client_debts_tenant_client ON client_debts (tenant_id, client_id);
-- Newest-first scans / time-window reporting.
CREATE INDEX IF NOT EXISTS idx_client_debts_tenant_created ON client_debts (tenant_id, created_at DESC);
