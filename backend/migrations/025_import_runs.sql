-- ─────────────────────────────────────────────────────────────────────────
--  Audit table for bulk imports of clients & cars.
--
--  Each successful confirm() creates one row. Stores summary counters and
--  the list of skipped rows / issues so an owner can investigate why some
--  rows were dropped after the fact, without re-uploading the source file.
--
--  No PII beyond what's already in clients/cars; payload is a JSONB that
--  stores per-row issue codes and source row numbers, not raw phones.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,                       -- 'clients_cars' for now
    total_rows INTEGER NOT NULL DEFAULT 0,
    created_clients INTEGER NOT NULL DEFAULT 0,
    reused_clients INTEGER NOT NULL DEFAULT 0,
    created_cars INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_runs_tenant_created
    ON import_runs (tenant_id, created_at DESC);
