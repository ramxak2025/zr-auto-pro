-- 052_checks_car_index.sql
-- 013_performance_indexes_fk.sql already created idx_checks_car_id ON checks(car_id)
-- and 026_perf_search_indexes.sql added idx_checks_car_id_date ON checks(car_id, date DESC).
-- This migration only guards both indexes idempotently in case they
-- weren't applied on some older deployments (the CONCURRENTLY variants
-- run outside transaction and can be rolled back in the middle).

CREATE INDEX IF NOT EXISTS idx_checks_car_id_v2 ON checks(car_id);
CREATE INDEX IF NOT EXISTS idx_checks_car_date_v2 ON checks(car_id, date DESC);
