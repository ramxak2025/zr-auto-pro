-- Deduplicate schedule_entries and enforce unique (tenant_id, user_id, date).
-- Root cause: no unique constraint allowed multiple entries per user per day,
-- which caused inflated shift counts in the attendance rating tab
-- (e.g. "Умар-2 — 2 полноценные смены" when only 1 actual shift occurred).

-- 1) Keep only the "best" row per (tenant_id, user_id, date):
--    prefer rows with actualArrival set, then lateStatus set, then newest created_at.
DELETE FROM schedule_entries a
USING schedule_entries b
WHERE a.tenant_id = b.tenant_id
  AND a.user_id  = b.user_id
  AND a.date     = b.date
  AND a.id      <> b.id
  AND (
    -- b has more "information" than a
    (b.actual_arrival IS NOT NULL AND a.actual_arrival IS NULL)
    OR (
      (b.actual_arrival IS NOT NULL) = (a.actual_arrival IS NOT NULL)
      AND (b.late_status IS NOT NULL AND a.late_status IS NULL)
    )
    OR (
      (b.actual_arrival IS NOT NULL) = (a.actual_arrival IS NOT NULL)
      AND (b.late_status IS NOT NULL) = (a.late_status IS NOT NULL)
      AND b.created_at > a.created_at
    )
  );

-- 2) Add unique constraint so this cannot happen again.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_entries_tenant_user_date_unique
  ON schedule_entries (tenant_id, user_id, date);
