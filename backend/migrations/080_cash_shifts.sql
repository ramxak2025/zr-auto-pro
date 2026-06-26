-- 080_cash_shifts.sql
-- Кассовая смена / Z-отчёт / Инкассация (cash shift / Z-report / cash collection).
--
-- ADDITIVE module. Reconciles the PHYSICAL cash drawer against recorded sales
-- and expenses for one open→close shift window. The Z-report is aggregated by
-- READING existing `checks` / `expenses` — this migration NEVER alters their
-- schema or write behaviour. Two new tables only:
--   • cash_shifts      — one row per opened shift (open → closed lifecycle).
--   • cash_collections — инкассация: cash physically pulled from the drawer
--                        mid-shift (handed to the owner / banked).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + safe
-- CREATE INDEX IF NOT EXISTS, so a partially-applied / pre-existing table
-- converges to the full shape on re-run. Never edited once applied.

-- ── cash_shifts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- Who opened the shift (owner-class). NULL-on-delete keeps the historical row.
    opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Cash counted in the drawer at open ("разменная касса" / float).
    opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Close-side fields — all NULL while the shift is open.
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    -- Фактический нал, пересчитанный кассиром при закрытии (what's really there).
    closing_amount NUMERIC(14,2),
    -- Расчётный остаток: opening + наличная выручка − наличные расходы − инкассация.
    expected_amount NUMERIC(14,2),
    -- closing_amount − expected_amount. >0 излишек, <0 недостача. Frozen at close.
    difference NUMERIC(14,2),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Safe column adds for any pre-existing `cash_shifts` table.
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN opened_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN opened_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN closed_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN closed_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN closing_amount NUMERIC(14,2); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN expected_amount NUMERIC(14,2); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN difference NUMERIC(14,2); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN status TEXT NOT NULL DEFAULT 'open'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN note TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_shifts ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── cash_collections (инкассация) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES cash_shifts(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    collected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN shift_id UUID REFERENCES cash_shifts(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN collected_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN collected_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN note TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE cash_collections ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes (all tenant-scoped to match every query's leading WHERE tenant_id=$1) ─
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant_status ON cash_shifts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant_opened ON cash_shifts (tenant_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_collections_tenant_shift ON cash_collections (tenant_id, shift_id);

-- Hard guarantee of the "at most one OPEN shift per tenant" invariant. The
-- service also checks in-app, but this partial unique index makes a concurrent
-- double-open race impossible at the DB level (second INSERT → 23505 → 409).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_one_open_per_tenant
    ON cash_shifts (tenant_id) WHERE status = 'open';
