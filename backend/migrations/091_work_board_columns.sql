-- 091_work_board_columns.sql
-- Owner-configurable kanban columns for the заказ-наряд work-board.
--
-- Background: migration 082 added a free-text `checks.work_status` flag and the
-- board hard-coded the 4 columns приёмка→в работе→готов→выдан in app code. This
-- migration makes the columns DATA, one set per tenant, so an owner can rename /
-- recolor / reorder / add / hide / delete board columns. `checks.work_status`
-- still stores the column KEY (slug) — unchanged, no backfill, no FK to keep it
-- decoupled (a deleted column simply nulls the affected checks at the app layer).
--
-- PURELY ADDITIVE & ORTHOGONAL to payment / cash-flow / stock / salary / returns.
-- Nothing in the financial write path reads or writes this table.
--
-- `notify_client` marks the column whose entry fires the «машина готова» client
-- notification (the legacy hard-coded behaviour was: fire on transition INTO
-- 'ready'; now it fires on transition INTO any column with notify_client=true).
--
-- Default columns are NOT seeded by this migration — they are lazily seeded
-- per-tenant on first board/columns read via ChecksService.ensureBoardColumns-
-- Defaults() (INSERT … ON CONFLICT DO NOTHING), so the 4 legacy keys exist the
-- moment any tenant opens the board and historical checks keep mapping.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS +
-- CREATE [UNIQUE] INDEX IF NOT EXISTS, so a re-run (or a partially-applied
-- state) converges. Never edited once applied.

CREATE TABLE IF NOT EXISTS work_board_columns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- Slug stored in checks.work_status. Stable identity of the column.
    key           TEXT NOT NULL,
    -- Display name shown on the board column header.
    label         TEXT NOT NULL,
    -- Hex accent color (e.g. '#22C55E'). Nullable — UI falls back to a neutral.
    color         TEXT,
    -- Left-to-right board order.
    sort_order    INT NOT NULL DEFAULT 0,
    -- Hidden columns stay in the table (and keep their checks' keys) but drop
    -- off the board until re-enabled.
    is_active     BOOLEAN NOT NULL DEFAULT true,
    -- Entry into this column fires the «машина готова» client notification.
    notify_client BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Safe column adds for any pre-existing `work_board_columns` table.
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN key TEXT NOT NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN label TEXT NOT NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN color TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN sort_order INT NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN notify_client BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE work_board_columns ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- One key per tenant. Also the conflict target for the idempotent default seed
-- (INSERT … ON CONFLICT (tenant_id, key) DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_board_columns_tenant_key
  ON work_board_columns (tenant_id, key);

-- Board read orders columns by sort_order within a tenant.
CREATE INDEX IF NOT EXISTS idx_work_board_columns_tenant_sort
  ON work_board_columns (tenant_id, sort_order);
