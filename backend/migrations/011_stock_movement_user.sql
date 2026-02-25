ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_user_id ON stock_movements(user_id);
