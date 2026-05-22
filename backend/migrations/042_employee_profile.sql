-- 042_employee_profile.sql
-- Extra columns on users for the employee profile (hire date, KPI targets,
-- specializations, owner private notes, contact channels).
-- All idempotent. specializations TEXT[] default empty so existing rows
-- behave correctly.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS specializations TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS position_title TEXT,
  ADD COLUMN IF NOT EXISTS custom_title TEXT,
  ADD COLUMN IF NOT EXISTS monthly_kpi_revenue NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS monthly_kpi_checks INT,
  ADD COLUMN IF NOT EXISTS owner_notes TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT;
