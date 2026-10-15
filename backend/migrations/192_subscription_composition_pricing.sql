-- Additive pricing: legacy assignments, prices, features and ledger remain intact.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS included_employees INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS extra_employee_monthly_price NUMERIC(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS included_points INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS extra_point_monthly_price NUMERIC(10,2);
CREATE UNIQUE INDEX IF NOT EXISTS plans_code_unique ON plans(code) WHERE code IS NOT NULL;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS composition_snapshot JSONB;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_request_unique
  ON subscription_payments(tenant_id, request_id) WHERE request_id IS NOT NULL;

-- Stable independent rows; replay preserves subsequent operator edits.
INSERT INTO plans(id,code,name,monthly_price,max_users,included_employees,extra_employee_monthly_price,
 included_points,extra_point_monthly_price,features,voice_minutes,is_active,sort_order)
VALUES('16100000-0000-4000-a000-000000000001','baza','BAZA',990,1,1,990,NULL,NULL,
 '["cash_shift_view", "cashflow_view", "checks_view", "clients_view", "installments_view", "integration_acquiring", "integration_fiscal", "integration_messaging", "integration_telephony", "motivation_view", "purchase_orders_view", "services_view", "suppliers_view", "users_manage", "warehouse_view", "work_board_view", "salary_view", "reports_view", "export_data"]'::jsonb,0,true,0)
ON CONFLICT DO NOTHING;
INSERT INTO plans(id,code,name,monthly_price,max_users,included_employees,extra_employee_monthly_price,
 included_points,extra_point_monthly_price,features,voice_minutes,is_active,sort_order)
VALUES('16100000-0000-4000-a000-000000000002','pro','PRO',4990,5,5,500,NULL,NULL,
 '["cash_shift_view", "cashflow_view", "checks_view", "clients_view", "export_data", "installments_view", "integration_acquiring", "integration_fiscal", "integration_messaging", "integration_telephony", "motivation_view", "purchase_orders_view", "reports_view", "salary_view", "schedule_view", "services_view", "suppliers_view", "users_manage", "warehouse_view", "work_board_view"]'::jsonb,0,true,1)
ON CONFLICT DO NOTHING;
INSERT INTO plans(id,code,name,monthly_price,max_users,included_employees,extra_employee_monthly_price,
 included_points,extra_point_monthly_price,features,voice_minutes,is_active,sort_order)
VALUES('16100000-0000-4000-a000-000000000003','max','MAX',15000,50,50,500,1,5000,
 '["checks_view", "clients_view", "warehouse_view", "services_view", "cashflow_view", "reports_view", "export_data", "check_photos", "suppliers_view", "salary_view", "schedule_view", "users_manage", "motivation_view", "installments_view", "cash_shift_view", "work_board_view", "knowledge_view", "purchase_orders_view", "loyalty_view", "voice_input", "integration_fiscal", "integration_acquiring", "integration_messaging", "integration_telephony"]'::jsonb,1000,true,2)
ON CONFLICT DO NOTHING;

-- Only the three explicitly replaced offers disappear from the available catalog.
UPDATE plans SET is_active=false WHERE id IN ('738bc6b3-a71b-4afb-9e88-0034519dc6c4','e9d9565c-5de4-41c0-a044-6fc622325aa3','2d463670-883b-45ad-bc9a-64bf5b24ebec') AND is_active=true;
