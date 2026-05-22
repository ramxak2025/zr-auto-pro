-- 044_check_photos_all_plans.sql
-- Enable "check_photos" feature on every active plan. Originally introduced
-- by 035_check_photos.sql for the highest plan only; opening to all tiers
-- per owner request for testing.

UPDATE plans
SET features = COALESCE(features, '[]'::jsonb) || '["check_photos"]'::jsonb
WHERE is_active = true
  AND NOT (COALESCE(features, '[]'::jsonb) @> '["check_photos"]'::jsonb);
