-- 098_purchase_order_supply_link.sql
-- Полный цикл закупки в Поставщиках: Заказ → Поставка → Долг → Платёж.
-- (Full procurement cycle: purchase Order → Supply → Debt → Payment.)
--
-- ADDITIVE, append-only. This migration adds NO new tables — it WIRES the
-- already-existing purchase-order tables (084) to the already-existing supplier
-- ledger (001: deliveries / delivery_items / supplier_payments / suppliers
-- balance). Nothing is dropped or rewritten; every legacy read keeps its shape.
--
-- WHAT IT ENABLES (owner spec v1)
--   • A SUPPLY is a `deliveries` row created when a purchase order is received.
--     It now links back to its order via deliveries.purchase_order_id, and each
--     supply line links to the exact PO line it received via
--     delivery_items.purchase_order_item_id. The supplier «Поставки» tab, debt
--     model (suppliers.total_purchases / current_debt) and «Платежи» tab are all
--     REUSED — no parallel debt is invented.
--   • «Оплатить сразу» auto-creates a supplier_payments row that points back at
--     the supply it settled via supplier_payments.delivery_id (manual payments
--     leave it NULL).
--   • deliveries.received_by records who accepted the supply (audit).
--
-- All FKs use ON DELETE SET NULL: deleting a purchase order (or its lines) never
-- destroys the financial history of a supply/debt/payment — it only unlinks. The
-- supply, its debt and its payment survive as standalone ledger rows.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS for every column; each FK is added in a
-- guarded DO block that swallows duplicate_object / undefined_table /
-- undefined_column, so a partially-applied or pre-existing shape converges on
-- re-run. Indexes use CREATE INDEX IF NOT EXISTS. Runs in the default
-- BEGIN/COMMIT migration mode. Never edited once applied.

-- ── deliveries: link a supply back to its purchase order + who received it ────
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS purchase_order_id UUID;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS received_by UUID;

DO $$ BEGIN
  ALTER TABLE deliveries
    ADD CONSTRAINT deliveries_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE deliveries
    ADD CONSTRAINT deliveries_received_by_fkey
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- ── delivery_items: link a supply line back to the PO line it received ───────
ALTER TABLE delivery_items ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID;

DO $$ BEGIN
  ALTER TABLE delivery_items
    ADD CONSTRAINT delivery_items_purchase_order_item_id_fkey
    FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- ── supplier_payments: link an auto «оплатить сразу» payment to its supply ───
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS delivery_id UUID;

DO $$ BEGIN
  ALTER TABLE supplier_payments
    ADD CONSTRAINT supplier_payments_delivery_id_fkey
    FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- ── Indexes for the new links (partial — only the linked rows) ───────────────
CREATE INDEX IF NOT EXISTS idx_deliveries_purchase_order
  ON deliveries (purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_items_po_item
  ON delivery_items (purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_delivery
  ON supplier_payments (delivery_id) WHERE delivery_id IS NOT NULL;
