-- Existing earnings remain percentage snapshots; never infer historical fixed pay from today's catalog.
ALTER TABLE services
  ADD COLUMN master_pay_mode TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN master_fixed_amount NUMERIC(12,2),
  ADD CONSTRAINT services_master_pay CHECK (
    (master_pay_mode = 'percent' AND master_fixed_amount IS NULL) OR
    (master_pay_mode = 'fixed' AND master_fixed_amount IS NOT NULL
      AND master_fixed_amount >= 0 AND master_fixed_amount <> 'NaN'::numeric)
  );
ALTER TABLE check_service_lines
  ADD COLUMN salary_mode TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN salary_fixed_amount NUMERIC(12,2),
  ADD CONSTRAINT check_service_salary_snapshot CHECK (
    (salary_mode = 'percent' AND salary_fixed_amount IS NULL) OR
    (salary_mode = 'fixed' AND salary_fixed_amount IS NOT NULL
      AND salary_fixed_amount >= 0 AND salary_fixed_amount <> 'NaN'::numeric)
  );
