-- 035_check_photos.sql
CREATE TABLE IF NOT EXISTS check_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_check_photos_check ON check_photos(check_id);
CREATE INDEX IF NOT EXISTS idx_check_photos_tenant ON check_photos(tenant_id);

-- Add feature to highest-price active plan
UPDATE plans
SET features = COALESCE(features, '[]'::jsonb) || '["check_photos"]'::jsonb
WHERE monthly_price = (SELECT MAX(monthly_price) FROM plans WHERE is_active = true)
  AND NOT (COALESCE(features, '[]'::jsonb) @> '["check_photos"]'::jsonb);
