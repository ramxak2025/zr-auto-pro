-- ─────────────────────────────────────────────────────────────────────────
--  072 — perf indexes (additive only, no schema / type / data changes).
--
--  Runs inside the migration transaction (MigrationRunner wraps each file in
--  BEGIN/COMMIT), so NO `CREATE INDEX CONCURRENTLY` — that errors inside a
--  transaction block. Tables are small (single-digit-MB per tenant), so a
--  plain `CREATE INDEX IF NOT EXISTS` is cheap and keeps this file idempotent
--  and re-runnable.
--
--  Scope: only genuinely UNCOVERED hot paths found by reading the SQL in
--  reports / checks / clients / employees / salary services. Verified against
--  every prior migration (esp. 004 / 013 / 015 / 026 / 050 / 061 / 062 / 069)
--  so nothing here duplicates an existing index.
--
--  Deliberately NOT added (already covered — listed so the next pass doesn't
--  re-investigate):
--    • checks(tenant_id,date,is_deferred) dashboard/reports → 026 idx_checks_tenant_date_id + 004 idx_checks_tenant_deferred
--    • checks(master_id,date) salary join + employee profile  → 015 idx_checks_master_date
--    • schedule_entries(tenant_id,date) month grid            → 069 idx_schedule_entries_tenant_date
--    • schedule_entries(user_id,date) my-stats                → 013 idx_schedule_entries_user_date
--    • expenses(tenant_id,date) reports                       → 013 idx_expenses_tenant_date
--    • stock_movements(tenant_id,created_at) reports/journal  → 050 idx_stock_movements_tenant_created
--    • stock_movements(product_id,created_at) product history → 013 idx_stock_movements_product
--    • products(tenant_id[,warehouse_id],name) live list      → 061 / 069
--    • clients(phone) dedupe lookup                           → 015 idx_clients_phone
--    • salary_penalties(tenant_id,date) salary report         → 056 idx_salary_penalties_date
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Dashboard review feed: tenant slice in time order ──────────────────
-- reports.service.ts:531 (low-review alerts) and :657 (recent reviews) both
--   `WHERE rr.tenant_id = $1 [AND rr.rating <= 3] ORDER BY rr.created_at DESC`.
-- Today 007 has SEPARATE single-column idx_review_responses_tenant (tenant_id)
-- and idx_review_responses_created (created_at) — the planner must bitmap-AND
-- or, more often, scan one and Sort the other. A composite reads exactly one
-- tenant's reviews already in created_at order: no Sort, bounded by LIMIT 5.
CREATE INDEX IF NOT EXISTS idx_review_responses_tenant_created
    ON review_responses (tenant_id, created_at DESC);

-- ── 2. Client detail: latest review for a client (LATERAL) ────────────────
-- clients.service.ts:146-152 LATERAL subquery on the client-detail screen:
--   `WHERE client_id = c.id AND tenant_id = c.tenant_id ORDER BY created_at DESC LIMIT 1`.
-- review_responses had NO index on client_id at all (007 only indexed
-- tenant_id / employee_id / created_at), so each client open scanned the table.
CREATE INDEX IF NOT EXISTS idx_review_responses_client
    ON review_responses (client_id)
    WHERE client_id IS NOT NULL;

-- ── 3. Employee profile rating joins by check_id ──────────────────────────
-- employees.service.ts:497 (`LEFT JOIN review_responses rr ON rr.check_id = month_checks.id`)
-- and :710 (`JOIN checks ch ON ch.id = rr.check_id` for the master review feed)
-- both join review_responses on check_id, which had no index. Partial
-- `WHERE check_id IS NOT NULL` keeps it tiny: the FK is nullable and many
-- reviews (public-link, no order attached) carry a NULL check_id, and a NULL
-- can never satisfy an equi-join.
CREATE INDEX IF NOT EXISTS idx_review_responses_check
    ON review_responses (check_id)
    WHERE check_id IS NOT NULL;

-- ── 4. Client visit history: checks for one client, newest first ──────────
-- clients.service.ts:300-304 client-detail history:
--   `WHERE ch.tenant_id = $1 AND ch.client_id = $2 ORDER BY ch.date DESC`.
-- 013's idx_checks_client_id (client_id) answers the filter but NOT the
-- ordering, so Postgres adds a Sort. (client_id, date DESC) serves filter +
-- order in one scan — mirrors the existing car-history idx_checks_car_id_date
-- (026). Partial WHERE client_id IS NOT NULL keeps retail/walk-in checks
-- (NULL client) out of the index; the history query always binds a client_id.
CREATE INDEX IF NOT EXISTS idx_checks_client_date
    ON checks (client_id, date DESC)
    WHERE client_id IS NOT NULL;

-- ── 5. Salary report: premiums in a tenant within a date range ────────────
-- salary.service.ts:89-94 sums premiums for the payroll period:
--   `WHERE sp.tenant_id = $1 AND sp.created_at >= $2 AND sp.created_at <= $3`.
-- 048 only has (user_id, period_month_year) and a bare (tenant_id), so the
-- created_at range fell back to a row filter over the whole tenant's premiums.
-- (tenant_id, created_at) range-scans just the period slice.
CREATE INDEX IF NOT EXISTS idx_salary_premiums_tenant_created
    ON salary_premiums (tenant_id, created_at);

-- ── Refresh planner stats so the new indexes are picked up immediately ─────
ANALYZE review_responses;
ANALYZE checks;
ANALYZE salary_premiums;
