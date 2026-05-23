-- 050_journal_warehouse_docs_index.sql
-- Composite indexes that speed up the unified journal/warehouse-docs
-- endpoint (`GET /journal/warehouse-docs`). The endpoint walks
-- stock_movements + supplier_payments inside a tenant within a date range
-- and emits a unified feed.

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_date
  ON supplier_payments(tenant_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_created
  ON stock_movements(tenant_id, created_at DESC);
