-- ─────────────────────────────────────────────────────────────────────────
--  Strip spaces from existing plate_number values.
--
--  Historical imports stored plates in display form ("Х 807 КС 198"). The
--  app and the UI now expect the canonical compact form ("Х807КС198") so
--  search, dedup and lookup all share the same key.
--
--  Idempotent: rows without spaces are untouched. Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

UPDATE cars
   SET plate_number = REPLACE(plate_number, ' ', '')
 WHERE plate_number LIKE '% %';
