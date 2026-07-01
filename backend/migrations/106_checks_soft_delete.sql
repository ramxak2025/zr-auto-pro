-- ─────────────────────────────────────────────────────────────────────────
--  106 — Корзина для заказ-нарядов (soft-delete + 30-day restore).
--
--  Until now a check delete was a HARD `DELETE FROM checks` (ChecksService.remove):
--  stock was added back and the row removed, so every DERIVED report (revenue,
--  salary, cash-flow, dashboard, ratings) instantly stopped counting it, and
--  FK CASCADE cleaned up lines / warranty / motivation / returns / photos.
--
--  This makes delete REVERSIBLE for 30 days:
--   • delete  → reverse the materialised footprint (stock back, motivation
--               accruals removed, unused warranty claims removed) and stamp
--               deleted_at / deleted_by. The row STAYS, so every accounting
--               query must now also filter `deleted_at IS NULL` (added in code)
--               to keep a trashed check out of revenue / salary / cash-flow.
--   • restore → re-apply the footprint (re-deduct stock, re-accrue motivation,
--               re-derive warranty) and clear deleted_at / deleted_by. The baked
--               money columns (service_salary_total / product_salary_total /
--               per-line salary_amount / total_revenue / cash_amount / …) are
--               NEVER touched by trash, so a restore is bit-identical to the
--               pre-delete state even if a master's percent changed meanwhile.
--   • purge   → after 30 days a plain `DELETE FROM checks` (the old hard delete),
--               whose FK CASCADE / SET NULL behaviour is unchanged.
--
--  Safe for the LIVE tenant's real closed checks:
--   • Purely additive columns, both nullable, DEFAULT NULL.
--   • Every existing row gets deleted_at IS NULL → every accounting query with
--     the new `deleted_at IS NULL` filter returns byte-for-byte the same rows it
--     did before this migration. Zero behaviour change until a check is trashed.
--   • Idempotent (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
--   • No data is moved, rewritten or removed.
-- ─────────────────────────────────────────────────────────────────────────

-- NULL = live check; a timestamp = in the Корзина (trash), purgeable after 30d.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The user (users.id) who moved the check to the trash. Plain UUID (no FK) so it
-- survives a later user delete and never blocks the soft-delete write; the trash
-- list LEFT JOINs users to resolve the display name.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Trash list is owner-only and rare, but must not seq-scan a big checks table.
-- Partial index over the trashed rows only (mirrors the products/warehouse trash
-- indexes from 023/035); newest-first matches the trash list's ORDER BY.
CREATE INDEX IF NOT EXISTS idx_checks_trash
    ON checks (tenant_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

-- Note: the hot journal / report paths keep using their existing indexes
-- (idx_checks_tenant_date_id, idx_checks_tenant_deferred, …). The added
-- `deleted_at IS NULL` predicate is a cheap heap filter — trashed rows are a
-- tiny minority — so no live index needs rebuilding here.
