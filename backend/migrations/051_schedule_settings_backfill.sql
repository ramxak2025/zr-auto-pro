-- 051_schedule_settings_backfill.sql
-- Backfill: every tenant missing a schedule_settings row gets one with the
-- default ["worked","short"] shift_statuses. New tenants going forward are
-- created with the row already in place (handled lazily by
-- ScheduleService.getSettings on first read).
--
-- Note: shift_statuses is JSONB in 041_schedule_settings.sql, not TEXT[];
-- the migration body in the task brief incorrectly named TEXT[]. We honor
-- the existing column type so the existing service code keeps working.

INSERT INTO schedule_settings (tenant_id, shift_statuses)
SELECT t.id, '["worked","short"]'::jsonb
  FROM tenants t
  LEFT JOIN schedule_settings s ON s.tenant_id = t.id
 WHERE s.id IS NULL
ON CONFLICT (tenant_id) DO NOTHING;
