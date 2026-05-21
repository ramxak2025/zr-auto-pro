-- Marker flag for "Покупка Б/У" stock movements.
--
-- A used-purchase movement is otherwise indistinguishable from a normal
-- 'income' (target = used warehouse + supplier_id set) — but the journal
-- screens need a special label / icon and we don't want to special-case
-- by reading the supplier's `kind` field for every row. A boolean flag
-- on stock_movements keeps the render path O(1).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS is_used_purchase BOOLEAN NOT NULL DEFAULT false;
