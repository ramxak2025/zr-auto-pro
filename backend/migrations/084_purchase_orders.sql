-- 084_purchase_orders.sql
-- Заказы поставщикам + приёмка (purchase orders + receiving).
--
-- ADDITIVE module. Two tables only — a purchase-order header + its line items.
--   • purchase_orders      — one order to a supplier; lifecycle
--        draft → ordered → received (or → cancelled while not yet received).
--   • purchase_order_items — snapshotted line items (name + ordered qty + cost),
--        with received_quantity tracking partial receipts.
--
-- Receiving NEVER duplicates stock math: the service calls
-- StockMovementsService.applyIncomeTx() inside ONE transaction so the PO status
-- flip and every per-item `income` stock_movement commit (or roll back)
-- together — exactly the same income path manual receiving uses. This migration
-- only adds the two PO tables; it NEVER touches products / stock_movements /
-- suppliers / any existing write path.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS (via DO
-- blocks that swallow duplicate_column / undefined_table) + CREATE INDEX IF NOT
-- EXISTS, so a partially-applied / pre-existing table converges to the full
-- shape on re-run. Never edited once applied.

-- ── purchase_orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- CASCADE mirrors `deliveries.supplier_id` — deleting a supplier wipes its
    -- order history rather than blocking the delete with RESTRICT.
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
    note TEXT,
    -- Σ(quantity * cost_price) over the items, maintained by the service.
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Who created the order. NULL-on-delete keeps the history row.
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ordered_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `purchase_orders` table.
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN note TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN total NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN ordered_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN received_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_orders ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── purchase_order_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    -- NOT NULL FK to products (no SET NULL) so receiving always has a real SKU to
    -- credit stock to. Matches `delivery_items.product_id`. The `name` snapshot
    -- below preserves a readable label even after the product is renamed.
    product_id UUID REFERENCES products(id),
    name TEXT NOT NULL,
    quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- How much of `quantity` has actually been received so far (partial receipts).
    received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing `purchase_order_items` table.
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN product_id UUID REFERENCES products(id); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN quantity NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN cost_price NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- List filtering leads with tenant_id, then status / supplier (the two filters).
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_supplier ON purchase_orders (tenant_id, supplier_id);
-- Newest-first list ordering.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_created ON purchase_orders (tenant_id, created_at DESC);
-- Item lookups by parent order (detail fetch) and tenant guard.
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_tenant ON purchase_order_items (tenant_id);
