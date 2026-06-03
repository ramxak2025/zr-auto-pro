-- 059_cars_no_plate.sql
-- Feature #15 — "Без номера" cars.
--
-- Some cars are registered without a plate (галочка «без номеров» on the add
-- form). We keep `plate_number` NOT NULL for schema stability but allow the
-- empty string '' when no_plate = true. The cars service skips the
-- duplicate-plate check for no_plate cars so multiple plate-less cars can
-- coexist. Foreign plates are stored verbatim (the cars service never applied
-- RU validation), so this migration only needs the no_plate flag.
--
-- Default false → existing cars are unaffected.

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS no_plate BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cars_no_plate ON cars(tenant_id, no_plate);
