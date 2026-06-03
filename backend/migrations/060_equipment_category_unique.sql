-- 060_equipment_category_unique.sql
-- Fix #3 — Duplicate «Имущество» expense category under concurrency.
--
-- getOrCreateEquipmentCategory() did a SELECT-then-INSERT with no unique guard,
-- so two concurrent equipment purchases for the same tenant could each miss the
-- SELECT and both INSERT, leaving two reserved «Имущество» categories. This
-- migration adds a PARTIAL unique index scoped to the reserved name only, so the
-- INSERT can be made race-safe with ON CONFLICT DO NOTHING. Unrelated category
-- names are untouched (the index does not constrain them), so this never fails
-- on legitimate non-«Имущество» duplicates.
--
-- Idempotent / additive: column types and existing data are not altered.

-- Pre-dedupe: a partial UNIQUE index can't be created if a tenant already has
-- two or more «Имущество» rows. Keep the oldest row per tenant, re-point any
-- expenses that reference a doomed duplicate to the survivor, then drop the
-- duplicates. No-op when there are no duplicates.
WITH ranked AS (
  SELECT id,
         tenant_id,
         first_value(id) OVER (
           PARTITION BY tenant_id ORDER BY created_at, id
         ) AS keep_id
  FROM expense_categories
  WHERE name = 'Имущество'
)
UPDATE expenses e
SET category_id = r.keep_id
FROM ranked r
WHERE e.category_id = r.id
  AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id ORDER BY created_at, id
         ) AS keep_id
  FROM expense_categories
  WHERE name = 'Имущество'
)
DELETE FROM expense_categories ec
USING ranked r
WHERE ec.id = r.id
  AND r.id <> r.keep_id;

-- One reserved «Имущество» category per tenant. Partial so it only governs the
-- reserved name and never collides with user-created category names.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_imushchestvo
  ON expense_categories(tenant_id)
  WHERE name = 'Имущество';
