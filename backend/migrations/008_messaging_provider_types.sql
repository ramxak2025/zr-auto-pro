-- ============================================================
-- 008: Add smsru and moizvonki provider types
-- ============================================================

-- Drop old CHECK and add expanded one
ALTER TABLE messaging_integrations DROP CONSTRAINT IF EXISTS messaging_integrations_provider_type_check;
ALTER TABLE messaging_integrations ADD CONSTRAINT messaging_integrations_provider_type_check
  CHECK (provider_type IN ('whatsapp','sms','smsru','moizvonki','email'));
