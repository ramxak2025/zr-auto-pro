-- Add receipt/company details fields to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inn TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kpp TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ogrn TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receipt_footer TEXT;
