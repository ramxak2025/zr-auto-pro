-- 088_telephony_mango.sql
-- Телефония (Mango Office) — provider-agnostic call-event ingestion.
--
-- ADDITIVE module. Lets a tenant connect a VPBX (Mango Office today) so that the
-- автосервис sees incoming/missed calls inside the app, matched to a client, with
-- a push the moment the phone rings. Two tables:
--   • telephony_integrations — per-tenant provider config (vpbx api key + sign
--                              salt). ONE row per tenant (tenant_id is the PK).
--                              api_key / api_salt are SERVER SECRETS: stored as-is,
--                              NEVER returned in full to a client (API masks them).
--   • calls                  — persisted call log. The existing CallsService is a
--                              LIVE proxy to the external МоиЗвонки API and stored
--                              nothing; there was no `calls` table. Mango pushes
--                              events to us (no per-request poll), so its calls are
--                              persisted here and surfaced through the SAME
--                              CallsController listing (shape preserved).
--
-- INERT until configured: no row in telephony_integrations (or enabled=false / no
-- keys) ⇒ the webhook is a 200 no-op and nothing is matched, persisted or pushed.
-- Nothing works until the owner pastes the real Mango vpbx api key + salt and flips
-- enabled on.
--
-- This migration NEVER touches `checks`, `clients`, `bookings` or `users` schema —
-- `calls` references them with nullable FKs only (ON DELETE SET NULL / CASCADE on
-- tenant). The existing МоиЗвонки live-proxy listing path is unchanged.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS guards +
-- CREATE INDEX IF NOT EXISTS, so a partially-applied / pre-existing table converges
-- to the full shape on re-run. Never edited once applied.

-- ── telephony_integrations (per-tenant config — one row per tenant) ─────────
CREATE TABLE IF NOT EXISTS telephony_integrations (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Which VPBX provider. 'mango' is implemented; the column is provider-agnostic
    -- so a second provider is one more adapter, not a schema change.
    provider TEXT NOT NULL DEFAULT 'mango' CHECK (provider IN ('mango')),
    -- Master switch. Even with keys present, the webhook is a no-op while false.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- Mango VPBX API key (vpbx_api_key). SERVER SECRET — stored as-is, NEVER
    -- returned in full to any client. The API masks it to '••••1234' on read.
    api_key TEXT,
    -- Mango VPBX sign salt (vpbx_api_salt) used to verify callback signatures:
    -- sign = sha256(api_key + json + api_salt). SERVER SECRET — masked on read.
    api_salt TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `telephony_integrations` table.
DO $$ BEGIN ALTER TABLE telephony_integrations ADD COLUMN provider TEXT NOT NULL DEFAULT 'mango'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE telephony_integrations ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE telephony_integrations ADD COLUMN api_key TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE telephony_integrations ADD COLUMN api_salt TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE telephony_integrations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── calls (persisted call log) ──────────────────────────────────────────────
-- NOTE: there was no `calls` table before this migration (the МоиЗвонки module
-- proxies the provider live). CREATE IF NOT EXISTS + the ADD COLUMN guards below
-- mean that even if some future/older deployment already had a `calls` table, it
-- converges to this shape without dropping anything.
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'mango',
    -- Provider call id (Mango call_id / entry_id). Correlates the "ringing" event
    -- with the later "summary" (call-ended) and "recording" events of the same
    -- call. Unique per tenant so those events upsert onto one row.
    provider_call_id TEXT,
    -- 'inbound' = client → автосервис, 'outbound' = автосервис → client.
    direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
    -- Caller / callee numbers exactly as the provider delivered them (digits).
    from_number TEXT,
    to_number TEXT,
    -- Normalized external party phone (digits) used to match a client.
    client_phone TEXT,
    -- Matched client (tenant-scoped, by normalized phone). NULL when unknown.
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    -- Lifecycle: ringing → answered | missed (set from the summary event).
    status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'answered', 'missed')),
    answered BOOLEAN NOT NULL DEFAULT false,
    duration INTEGER NOT NULL DEFAULT 0,
    -- Provider recording reference (Mango recording_id). Resolving it to a playable
    -- URL needs a separate signed Mango API call — captured here, resolved later.
    recording_url TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN ALTER TABLE calls ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'mango'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN provider_call_id TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN from_number TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN to_number TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN client_phone TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN status TEXT NOT NULL DEFAULT 'ringing'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN answered BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN duration INTEGER NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN recording_url TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN started_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN ended_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE calls ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Upsert key: the "ringing", "summary" and "recording" events of one call share
-- the provider call id and converge onto a single row per tenant. Multiple NULL
-- provider_call_id rows are allowed (NULLs are distinct in a UNIQUE index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_tenant_provider_call ON calls (tenant_id, provider_call_id);
-- Tenant-scoped listing, newest first (CallsController GET /calls).
CREATE INDEX IF NOT EXISTS idx_calls_tenant_started ON calls (tenant_id, started_at);
-- Per-client call history (CallsController GET /calls/client/:id).
CREATE INDEX IF NOT EXISTS idx_calls_tenant_client ON calls (tenant_id, client_id);
