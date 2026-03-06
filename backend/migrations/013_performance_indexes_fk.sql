-- Migration 013: Add missing indexes on foreign keys for query performance
-- These indexes speed up JOINs and WHERE filters on frequently queried columns.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checks_master_id ON checks (master_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checks_client_id ON checks (client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checks_car_id ON checks (car_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checks_tenant_date ON checks (tenant_id, date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schedule_entries_user_date ON schedule_entries (user_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_salary_payments_user_month ON salary_payments (user_id, month_year);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_tenant_date ON expenses (tenant_id, date DESC);
