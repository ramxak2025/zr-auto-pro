-- Enable trigram extension for ILIKE search acceleration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Performance indexes for common query patterns

-- Composite index: checks filtered by tenant + date (most frequent query)
CREATE INDEX IF NOT EXISTS idx_checks_tenant_date ON checks(tenant_id, date DESC);

-- Composite index: checks filtered by tenant + is_deferred (dashboard/reports)
CREATE INDEX IF NOT EXISTS idx_checks_tenant_deferred ON checks(tenant_id, is_deferred) WHERE is_deferred = false;

-- Foreign key indexes for JOIN performance
CREATE INDEX IF NOT EXISTS idx_cars_client ON cars(client_id);
CREATE INDEX IF NOT EXISTS idx_check_service_lines_check ON check_service_lines(check_id);
CREATE INDEX IF NOT EXISTS idx_check_product_lines_check ON check_product_lines(check_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_product ON delivery_items(product_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_user ON schedule_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_date ON schedule_entries(date);

-- Text search optimization with trigram (pg_trgm) for ILIKE queries
-- Products name search
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Clients name search
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON clients USING gin (full_name gin_trgm_ops);

-- Warehouse categories tenant
CREATE INDEX IF NOT EXISTS idx_warehouse_categories_tenant ON warehouse_categories(tenant_id);
