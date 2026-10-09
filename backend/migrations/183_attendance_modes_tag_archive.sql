-- Separate schedule attendance from the employee's self-service attendance mode.
-- Migration 070's opt-in tenants keep working in manual mode; disabled tenants
-- continue to rely on manager-forced schedule attendance.
ALTER TABLE tenants
  ADD COLUMN attendance_mode text NOT NULL DEFAULT 'admin';

UPDATE tenants
SET attendance_mode = CASE WHEN shifts_enabled THEN 'manual' ELSE 'admin' END;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_attendance_mode_check
  CHECK (attendance_mode IN ('admin', 'manual', 'nfc'));

ALTER TABLE attendance_nfc_tags
  ADD COLUMN archived_at timestamptz;

CREATE INDEX attendance_nfc_tags_live_point_idx
  ON attendance_nfc_tags (tenant_id, point_id, created_at DESC, id)
  WHERE archived_at IS NULL;
