-- Price change history for products
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    cost_price_before NUMERIC(12,2),
    cost_price_after NUMERIC(12,2),
    sell_price_before NUMERIC(12,2),
    sell_price_after NUMERIC(12,2),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_tenant ON price_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_history_created ON price_history(created_at DESC);
