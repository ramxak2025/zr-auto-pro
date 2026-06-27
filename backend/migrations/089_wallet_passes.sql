-- 089_wallet_passes.sql
-- Apple Wallet — карта лояльности (.pkpass loyalty card) — per-tenant config.
--
-- ADDITIVE module. Lets a tenant hand a client an Apple Wallet store-card that
-- shows the client's bonus balance (from loyalty/) and a QR encoding the clientId,
-- so staff can scan the card to accrue/redeem bonuses. The .pkpass is generated and
-- PKCS#7-signed SERVER-SIDE (passkit-generator) with the tenant's own Apple Pass
-- Type ID certificate.
--
-- ONE table:
--   • wallet_settings — per-tenant config (ONE row per tenant, tenant_id is the PK).
--                       `cert_pem`, `cert_key_pem`, `cert_key_password`, `wwdr_pem`
--                       are SERVER SECRETS: stored as-is, NEVER returned to any
--                       client. The API returns only boolean "configured" flags for
--                       them (a PEM private key has no meaningful last-4 mask).
--
-- INERT until configured: no row (or enabled=false / missing cert+key+wwdr+
-- passTypeId+teamId) ⇒ GET /wallet/pass/:clientId returns 422. NOTHING produces a
-- usable pass until the owner uploads a real Apple Pass Type ID certificate (+ its
-- private key) and the Apple WWDR intermediate certificate AND flips `enabled` on.
--
-- This migration NEVER touches `clients`, `client_bonuses`, `loyalty_settings` or
-- `checks` — the wallet module only READS the bonus balance and client/shop names.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS guards, so a
-- partially-applied / pre-existing table converges to the full shape on re-run.
-- Never edited once applied.

-- ── wallet_settings (per-tenant config — one row per tenant) ────────────────
CREATE TABLE IF NOT EXISTS wallet_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Master switch. Even with a full cert set present, nothing generates while false.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- Apple Pass Type ID (e.g. 'pass.com.autexa.loyalty'). Semi-public; shown in UI.
    pass_type_id TEXT,
    -- Apple Developer Team ID (10-char). Semi-public; shown in UI.
    team_id TEXT,
    -- Organization name printed on the pass (falls back to the tenant name).
    organization_name TEXT,
    -- Pass Type ID signing certificate (PEM). SERVER SECRET — NEVER returned. The
    -- API exposes only a boolean "stored" flag.
    cert_pem TEXT,
    -- Signing private key (PEM) for the cert above. SERVER SECRET — NEVER returned.
    cert_key_pem TEXT,
    -- Passphrase protecting cert_key_pem (optional). SERVER SECRET — NEVER returned.
    cert_key_password TEXT,
    -- Apple WWDR intermediate certificate (PEM) used to complete the signing chain.
    -- SERVER SECRET-class — NEVER returned (it's public Apple material, but treated
    -- like the rest of the cert bundle: flag only).
    wwdr_pem TEXT,
    -- Optional branding: logo URL + background color hex (e.g. '#1E88E5').
    logo_url TEXT,
    bg_color TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `wallet_settings` table.
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN pass_type_id TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN team_id TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN organization_name TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN cert_pem TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN cert_key_pem TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN cert_key_password TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN wwdr_pem TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN logo_url TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN bg_color TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
