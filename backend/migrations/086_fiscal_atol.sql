-- 086_fiscal_atol.sql
-- Онлайн-касса / фискализация 54-ФЗ (online fiscalization) — provider-agnostic.
--
-- ADDITIVE module. Lets a tenant push a закрытый заказ-наряд (check) to a real
-- фискальный накопитель via a cloud OFD operator and get a legal 54-ФЗ receipt
-- back (fiscal document number + fiscal sign + ОФД receipt URL). АТОЛ Онлайн is
-- the implemented provider; the interface is provider-agnostic so a second OFD
-- (Эвотор/Бизнес.Ру/…) is one more adapter class, not a schema change.
--
-- Two tables:
--   • fiscal_integrations — per-tenant provider config (ONE row per tenant,
--                           tenant_id is the PK). `password` is a SERVER secret:
--                           stored as-is, NEVER returned in full to a client (the
--                           API masks it to '••••1234' on read, exactly like the
--                           payments secret_key in 085).
--   • fiscal_receipts     — the ledger: one row per fiscalization attempt, its
--                           АТОЛ uuid, status lifecycle (pending→done/failed),
--                           the fiscal result fields, and the optional link back
--                           to the check it fiscalized.
--
-- INERT until configured: no row in fiscal_integrations (or enabled=false / no
-- login+password+group_code) ⇒ POST /fiscal/fiscalize returns 422. NOTHING is
-- fiscalized until the owner pastes a real АТОЛ login + password + group_code in
-- settings AND flips `enabled` on.
--
-- POLL-BASED, no webhook: АТОЛ is asynchronous — sell returns a uuid, then we
-- poll report/{uuid} for the fiscal result. There is therefore NO public route
-- in this module (unlike payments, which has a webhook controller).
--
-- This migration NEVER touches `checks` schema or its write path — the link is a
-- nullable FK on `fiscal_receipts` only (ON DELETE SET NULL keeps the ledger if a
-- check is later removed). The module only ever READS checks to build the receipt.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS guards +
-- CREATE INDEX IF NOT EXISTS, so a partially-applied / pre-existing table
-- converges to the full shape on re-run. Never edited once applied.

-- ── fiscal_integrations (per-tenant config — one row per tenant) ────────────
CREATE TABLE IF NOT EXISTS fiscal_integrations (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Which OFD/фискализация provider this tenant uses. Only 'atol' is implemented.
    provider TEXT NOT NULL DEFAULT 'atol',
    -- Master switch. Even with credentials present, nothing fiscalizes while false.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- АТОЛ Онлайн API login (учётная запись интеграции). Semi-public; returned to UI.
    login TEXT,
    -- АТОЛ Онлайн API password. SERVER SECRET — stored as-is, NEVER returned in
    -- full to any client. The API masks it to '••••1234' on read.
    password TEXT,
    -- АТОЛ group_code (код группы ККТ) — identifies the cash-register group. Part
    -- of every API path: /possystem/v4/{group_code}/sell. Semi-public; shown in UI.
    group_code TEXT,
    -- Система налогообложения (tax system) reported on every receipt:
    -- 'osn' | 'usn_income' | 'usn_income_outcome' | 'envd' | 'esn' | 'patent'.
    sno TEXT,
    -- ИНН организации (печатается на чеке, сверяется ОФД с ФН).
    inn TEXT,
    -- Адрес расчётов (payment_address) — место установки ККТ / адрес магазина.
    payment_address TEXT,
    -- Email организации-отправителя чека (company.email) — обязателен по 54-ФЗ.
    company_email TEXT,
    -- Ставка НДС по умолчанию для позиций чека: 'none' | 'vat0' | 'vat10' |
    -- 'vat20' | 'vat110' | 'vat120' (АТОЛ vat.type). Большинство автосервисов — 'none'.
    vat TEXT NOT NULL DEFAULT 'none',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `fiscal_integrations` table.
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN provider TEXT NOT NULL DEFAULT 'atol'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN login TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN password TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN group_code TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN sno TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN inn TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN payment_address TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN company_email TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN vat TEXT NOT NULL DEFAULT 'none'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_integrations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── fiscal_receipts (ledger) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'atol',
    -- The заказ-наряд this receipt fiscalizes. SET NULL keeps the ledger row intact
    -- if the check is later deleted. Does NOT alter `checks`.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    -- Our idempotence key (a UUID) sent to АТОЛ as external_id. Retrying the same
    -- logical fiscalization with the same external_id must not double-fiscalize.
    external_id TEXT NOT NULL,
    -- АТОЛ document uuid returned by /sell. NULL only if /sell never returned one.
    provider_uuid TEXT,
    -- Normalized lifecycle: 'pending' (sent, awaiting ФН) | 'done' (фискализован)
    -- | 'failed' (АТОЛ/ФН отказал — see `error`).
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    -- Fiscal result (filled from report/{uuid} once status='done').
    fiscal_doc_number TEXT,          -- ФД — фискальный документ №
    fiscal_sign TEXT,                -- ФП/ФПД — фискальный признак документа
    ofd_receipt_url TEXT,            -- ссылка на чек в ОФД (если выдана оператором)
    error TEXT,                      -- текст ошибки при status='failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    done_at TIMESTAMPTZ              -- момент перехода в done/failed
);

DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN provider TEXT NOT NULL DEFAULT 'atol'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN external_id TEXT NOT NULL DEFAULT gen_random_uuid()::text; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN provider_uuid TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN fiscal_doc_number TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN fiscal_sign TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN ofd_receipt_url TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN error TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fiscal_receipts ADD COLUMN done_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Latest-receipt-for-a-check lookup (GET /fiscal/receipt/:checkId).
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_tenant_check ON fiscal_receipts (tenant_id, check_id);
-- Status filter ("pending" polling / reconciliation sweeps).
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_status ON fiscal_receipts (status);
