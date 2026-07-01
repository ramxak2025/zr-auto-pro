-- 104_clients_phone_norm_index.sql
-- Format-agnostic phone matching for client search + duplicate detection
-- (#64 smart phone search, #57 BUG A/B). clients.service now reduces a phone to
-- its last-10 national digits on BOTH the query and the stored value:
--     right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
-- so «+7 (988) 444-44-85», «89884444485», «79884444485» and «9884444485» all
-- resolve to the same client — regardless of how the number was originally
-- saved. Mirrors `phoneSearchKey` in shared/validation/phone.ts and
-- backend/src/common/normalize-phone.ts.
--
-- That expression is not covered by any existing index, so back it with two
-- functional indexes. Purely additive: no schema / column / type changes, no
-- data rewrite. Existing rows (numbers saved in any format) become findable by
-- any format immediately — the normalization is applied at query time.
--
-- pg_trgm already exists (migration 004); re-assert so this file is
-- self-contained and safe to run standalone.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Exact-match lookups — findByPhone (duplicate-warning) and create()'s 409
-- dedup run:
--   WHERE tenant_id = $1 AND right(regexp_replace(phone,'[^0-9]','','g'),10) = $2
-- A btree on (tenant_id, <expr>) turns this into an index probe instead of a
-- per-row seq scan.
CREATE INDEX IF NOT EXISTS idx_clients_phone_core
    ON clients (tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10));

-- Substring search — clients.service.getAll runs:
--   right(regexp_replace(phone,'[^0-9]','','g'),10) LIKE '%<digits>%'
-- A gin_trgm index on the SAME expression lets the planner serve the LIKE
-- without a seq scan (mirrors the 061 expression-trigram approach for the old
-- replace(phone,' ','') form).
CREATE INDEX IF NOT EXISTS idx_clients_phone_core_trgm
    ON clients USING gin (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) gin_trgm_ops);

-- Refresh stats so the planner picks up the new indexes promptly.
ANALYZE clients;
