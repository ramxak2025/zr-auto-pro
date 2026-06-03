-- 058_expense_storage_item_link.sql
-- Feature #14 — Equipment purchase → auto-expense (+ reversal on delete).
--
-- Traceability link from an expense back to the storage item whose purchase
-- created it. When a storage item is added to the подсобка with a purchase
-- price, the equipment service atomically writes an expense in the reserved
-- «Имущество» category with storage_item_id set. On storage-item delete the
-- caller may opt to reverse (delete) the linked expense — "вернуть деньги в
-- оборот" — or keep it ("расход остаётся").
--
-- Nullable: the vast majority of expenses have no storage link. ON DELETE SET
-- NULL so deleting a storage item by other paths never orphans/blocks an
-- expense row.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS storage_item_id UUID REFERENCES storage_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_storage_item ON expenses(storage_item_id);
