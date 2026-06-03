-- ─────────────────────────────────────────────────────────────────────────
--  062 — drop redundant duplicate indexes on `checks`.
--
--  Over the history of 001 / 013 / 026 / 052 the `checks` table accumulated
--  several overlapping indexes. Every duplicate index is extra work on each
--  INSERT/UPDATE (the касса write-path runs one INSERT into `checks` per
--  sale, plus the stock UPDATE), so trimming exact / fully-covered duplicates
--  speeds up the hot write path with ZERO read-path regression.
--
--  Conservative rule: ONLY drop an index that is fully covered by another
--  surviving index (an exact duplicate, or a left-prefix of a composite, or a
--  partial that the query's own WHERE always satisfies). Anything uncertain is
--  KEPT.
--
--  Runs inside the migration transaction (no CONCURRENTLY) — `DROP INDEX IF
--  EXISTS` is transactional and idempotent, so this file is safe to re-run.
--
--  Surviving canonical indexes on `checks` after this migration:
--    • idx_checks_tenant_date_id  (tenant_id, date DESC, id DESC)  -- list/keyset + tenant + tenant_date
--    • idx_checks_master_id       (master_id)
--    • idx_checks_client_id       (client_id)
--    • idx_checks_car_id          (car_id)
--    • idx_checks_car_id_date     (car_id, date DESC) WHERE car_id IS NOT NULL
--    • idx_checks_date            (date)               -- KEPT: not a left-prefix of any composite
-- ─────────────────────────────────────────────────────────────────────────

-- 1. idx_checks_master (001, master_id) — EXACT duplicate of
--    idx_checks_master_id (013, master_id). Keep the 013 one.
DROP INDEX IF EXISTS idx_checks_master;

-- 2. idx_checks_client (001, client_id) — EXACT duplicate of
--    idx_checks_client_id (013, client_id). Keep the 013 one.
DROP INDEX IF EXISTS idx_checks_client;

-- 3. idx_checks_car_id_v2 (052, car_id) — EXACT duplicate of
--    idx_checks_car_id (013, car_id). 052 only re-created it as an idempotent
--    guard; the original survives. Drop the v2 copy.
DROP INDEX IF EXISTS idx_checks_car_id_v2;

-- 4. idx_checks_car_date_v2 (052, (car_id, date DESC)) — covered by the
--    partial idx_checks_car_id_date (026, (car_id, date DESC) WHERE car_id IS
--    NOT NULL). Every query that uses this index filters `car_id = <uuid>`
--    (car history panel), which implies car_id IS NOT NULL, so the partial
--    index fully serves it. Drop the non-partial v2 copy.
DROP INDEX IF EXISTS idx_checks_car_date_v2;

-- 5. idx_checks_tenant (001, tenant_id) — fully covered by the LEFT-PREFIX
--    (tenant_id) of idx_checks_tenant_date_id (026, (tenant_id, date DESC,
--    id DESC)). A plain tenant_id lookup is served by the composite's leading
--    column. Drop the standalone.
DROP INDEX IF EXISTS idx_checks_tenant;

-- 6. idx_checks_tenant_date (013, (tenant_id, date DESC)) — fully covered by
--    the LEFT-PREFIX (tenant_id, date DESC) of idx_checks_tenant_date_id
--    (026, (tenant_id, date DESC, id DESC)). The 3-col composite serves every
--    (tenant_id) and (tenant_id, date) access pattern. Drop the 2-col one.
DROP INDEX IF EXISTS idx_checks_tenant_date;

-- NOTE — intentionally KEPT (not redundant):
--   • idx_checks_date (001, date): the ONLY index leading with `date`; it is
--     NOT a left-prefix of any surviving composite (all of them lead with
--     tenant_id or car_id), so dropping it could regress a date-only scan.
--   • idx_checks_car_id_date partial stays (serves the car-history panel).

-- Refresh planner stats now that the index set changed.
ANALYZE checks;
