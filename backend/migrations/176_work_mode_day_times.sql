-- Optional weekday times. Keys follow week_days: 0 = Sunday, 6 = Saturday.
-- Existing modes retain their base shift_start / shift_end on every working day.
ALTER TABLE work_modes ADD COLUMN IF NOT EXISTS day_times JSONB NOT NULL DEFAULT '{}'::jsonb;
