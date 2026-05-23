-- 045_stock_value_snapshots.sql
-- Daily snapshots of stock value per warehouse (or aggregate per tenant when
-- warehouse_id IS NULL). Powered by the WarehouseAnalyticsScheduler that
-- runs at app start and every 24h, so the analytics module can compute
-- start-of-period vs current deltas without rescanning the full check
-- history.
--
-- Composite "uniqueness per tenant/warehouse/day" is enforced via a
-- COALESCE expression on warehouse_id — Postgres treats NULL as distinct,
-- so a plain UNIQUE (tenant_id, warehouse_id, snapshot_date) would allow
-- multiple aggregate rows per day. Falling back to the all-zeros UUID
-- sentinel lets the unique index recognise NULL warehouse_id as "the
-- tenant-wide aggregate slot".

CREATE TABLE IF NOT EXISTS stock_value_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  snapshot_date DATE NOT NULL,
  total_cost_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_sell_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  items_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshots_tenant_date
  ON stock_value_snapshots(tenant_id, snapshot_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_snapshot_per_day
  ON stock_value_snapshots(
    tenant_id,
    COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
    snapshot_date
  );
