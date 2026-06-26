-- 085_payments_acquiring.sql
-- Эквайринг + СБП (acquiring + SBP / Faster Payments) — provider-agnostic.
--
-- ADDITIVE module. Adds online-payment support (ЮKassa today, Tinkoff stub) so a
-- tenant can charge a client by card or СБП-QR from the cash screen. Two tables:
--   • payment_integrations — per-tenant provider config (shopId + secret key).
--                            ONE row per tenant (tenant_id is the PK). The secret
--                            key is a SERVER secret: stored as-is, NEVER returned
--                            in full to a client (the API masks it on read).
--   • payments            — the ledger: one row per created payment, its provider
--                            id, amount, method, status lifecycle and the optional
--                            link back to the check it settles.
--
-- INERT until configured: no row in payment_integrations (or enabled=false / no
-- keys) ⇒ POST /payments/create returns 422. Nothing can charge until the owner
-- pastes a real ЮKassa shopId + secretKey in settings.
--
-- This migration NEVER touches `checks` schema or its write path — the link is a
-- nullable FK on `payments` only (ON DELETE SET NULL keeps the ledger if a check
-- is later removed).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS guards +
-- CREATE INDEX IF NOT EXISTS, so a partially-applied / pre-existing table
-- converges to the full shape on re-run. Never edited once applied.

-- ── payment_integrations (per-tenant config — one row per tenant) ───────────
CREATE TABLE IF NOT EXISTS payment_integrations (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Which acquiring provider this tenant uses. 'yookassa' is implemented;
    -- 'tinkoff' is reserved (stub provider throws "not configured").
    provider TEXT NOT NULL DEFAULT 'yookassa' CHECK (provider IN ('yookassa', 'tinkoff')),
    -- Master switch. Even with keys present, nothing charges while enabled=false.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- ЮKassa shopId (магазин). Semi-public identifier; returned to the owner UI.
    shop_id TEXT,
    -- ЮKassa secret key. SERVER SECRET — stored as-is, NEVER returned in full to
    -- any client. The API masks it to '••••1234' on read.
    secret_key TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `payment_integrations` table.
DO $$ BEGIN ALTER TABLE payment_integrations ADD COLUMN provider TEXT NOT NULL DEFAULT 'yookassa'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payment_integrations ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payment_integrations ADD COLUMN shop_id TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payment_integrations ADD COLUMN secret_key TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payment_integrations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── payments (ledger) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'yookassa',
    -- Provider-side payment id (ЮKassa payment.id). NULL only if creation failed
    -- before we got one back (we don't persist such rows, so in practice set).
    provider_payment_id TEXT,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'RUB',
    description TEXT,
    -- How the client pays: 'sbp' (СБП-QR) or 'card'. NULL = provider default.
    method TEXT CHECK (method IN ('sbp', 'card')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'canceled')),
    -- Redirect/QR confirmation URL the client opens to pay (card redirect / SBP).
    confirmation_url TEXT,
    -- Optional link to the заказ-наряд this payment settles. SET NULL keeps the
    -- ledger row intact if the check is later deleted. Does NOT alter checks.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set once the provider confirms the money landed (status → 'succeeded').
    paid_at TIMESTAMPTZ
);

DO $$ BEGIN ALTER TABLE payments ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'yookassa'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN provider_payment_id TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'RUB'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN description TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN method TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN confirmation_url TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE payments ADD COLUMN paid_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Tenant-scoped status filter (ledger lists, "pending" polling).
CREATE INDEX IF NOT EXISTS idx_payments_tenant_status ON payments (tenant_id, status);
-- Webhook lookup: find the ledger row by the provider's payment id.
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments (provider_payment_id);
