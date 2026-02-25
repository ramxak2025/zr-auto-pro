-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 009: Product commission for masters
--
-- Adds ability for directors to set product commission (% of profit) per master.
-- Can be set globally for all products or for specific products.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add product_salary_percent to users (global product commission %)
DO $$ BEGIN
    ALTER TABLE users ADD COLUMN product_salary_percent NUMERIC(5,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Product-specific commissions: which products give commission to which masters
CREATE TABLE IF NOT EXISTS product_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_commissions_tenant ON product_commissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_commissions_user ON product_commissions(user_id);

-- Add product_salary_total to checks for tracking
DO $$ BEGIN
    ALTER TABLE checks ADD COLUMN product_salary_total NUMERIC(12,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
