-- 094_account_deletion.sql
-- In-app account deletion (Apple Guideline 5.1.1(v) + Google Play "Data deletion")
-- and the deterministic App-Store / Play review DEMO account.
--
-- Two independent, fully ADDITIVE concerns. Nothing here drops or rewrites an
-- existing column, so legacy mobile builds keep reading the same response shapes.
--
-- 1) Self-service deletion bookkeeping:
--      • tenants.deletion_requested_at  — when the account holder (director)
--        asked to close the whole tenant account. NULL = no request.
--      • tenants.deletion_requested_by  — which user pressed delete (soft FK,
--        SET NULL so purging the user later never blocks).
--      • users.deleted_at               — when an individual user self-deleted
--        (GDPR/App-Store self-service). Distinct from dismissed_at / purged_at,
--        which are OWNER-initiated dismissals from «Уволенные». This column is
--        informational only — the LOGIN/AUTH gate already blocks on
--        is_active=false / purged_at (set by the service), so no auth-path change
--        is needed.
--
-- 2) Demo account for review: a deterministic, ISOLATED tenant + director +
--    realistic read-mostly data, on its own hidden "Demo" plan that grants every
--    feature key so the reviewer can navigate the whole app without paywalls.
--    Multi-tenant isolation means this account can never touch real tenant data.
--    The AccountService treats this exact tenant id as deletion-EXEMPT, so a
--    reviewer can exercise the full in-app delete flow without bricking the
--    credentials for the next review.
--
-- Idempotent: DO-block safe ADD COLUMN (swallow duplicate_column / undefined_table)
-- + CREATE INDEX IF NOT EXISTS + INSERT ... WHERE NOT EXISTS / ON CONFLICT DO
-- NOTHING keyed on fixed UUIDs. Re-running converges to the same state. Never
-- edited after it has been applied.

-- ── 1. Deletion bookkeeping columns ─────────────────────────────────────────
DO $$ BEGIN ALTER TABLE tenants ADD COLUMN deletion_requested_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD COLUMN deletion_requested_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users   ADD COLUMN deleted_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- The daily grace-period purge cron scans for tenants whose deletion request is
-- older than the grace window — a partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_tenants_deletion_requested
  ON tenants (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

-- ── 2. Demo plan (hidden, all features, free) ───────────────────────────────
-- is_active=false → never shows in the public "upgrade" plan list, but
-- getSubscription resolves a tenant's features from its plan_id REGARDLESS of
-- is_active, so the demo tenant still gets the full feature set. monthly_price=0
-- keeps platform MRR clean.
INSERT INTO plans (id, name, monthly_price, description, features, max_users, is_active, sort_order)
SELECT 'de100000-0000-4000-a000-000000000001',
       'Demo (App Review)',
       0,
       'Внутренний тариф для проверки приложения в App Store / Google Play. Скрыт от клиентов.',
       '["checks_view","clients_view","warehouse_view","services_view","suppliers_view","cashflow_view","salary_view","schedule_view","reports_view","users_manage","export_data","check_photos"]'::jsonb,
       20,
       false,
       9999
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE id = 'de100000-0000-4000-a000-000000000001');

-- ── 3. Demo tenant ──────────────────────────────────────────────────────────
INSERT INTO tenants (id, name, phone, address, email, is_active, max_users, plan_id, monthly_price, subscription_end, subscription_note)
SELECT 'de100000-0000-4000-a000-000000000002',
       'Autexa Demo — Автосервис «Профи»',
       '+79000000000',
       'г. Москва, ул. Демонстрационная, 1',
       'demo@autexa.pw',
       true,
       20,
       'de100000-0000-4000-a000-000000000001',
       0,
       '2099-12-31T00:00:00Z',
       'Demo account for App Store / Google Play review'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'de100000-0000-4000-a000-000000000002');

-- ── 4. Demo users (1 director + 2 masters) ──────────────────────────────────
-- Password for the director is the bcrypt hash of "AutexaDemo2026" (cost 10,
-- $2a$ — verified by bcryptjs). Guarded on BOTH id and phone so a pre-existing
-- real account on this reserved number is never duplicated or overwritten.
INSERT INTO users (id, phone, password, full_name, role, salary_percent, is_active, tenant_id, permissions)
SELECT 'de100000-0000-4000-a000-000000000010',
       '+79000000000',
       '$2a$10$lBk.BJE3v8zMK9cKIIQBa.S9vNIMiIU9ao8kNnbTUTwdnYxxkdP2W',
       'Демо Директор',
       'director',
       0,
       true,
       'de100000-0000-4000-a000-000000000002',
       '{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"checks_change_datetime":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true,"schedule_view":true,"salary_view":true,"marketing_access":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 'de100000-0000-4000-a000-000000000010' OR phone = '+79000000000');

INSERT INTO users (id, phone, password, full_name, role, salary_percent, is_active, tenant_id, permissions)
SELECT 'de100000-0000-4000-a000-000000000011',
       '+79001112201',
       '$2a$10$lBk.BJE3v8zMK9cKIIQBa.S9vNIMiIU9ao8kNnbTUTwdnYxxkdP2W',
       'Михаил Мастеров',
       'master',
       40,
       true,
       'de100000-0000-4000-a000-000000000002',
       '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 'de100000-0000-4000-a000-000000000011' OR phone = '+79001112201');

INSERT INTO users (id, phone, password, full_name, role, salary_percent, is_active, tenant_id, permissions)
SELECT 'de100000-0000-4000-a000-000000000012',
       '+79001112202',
       '$2a$10$lBk.BJE3v8zMK9cKIIQBa.S9vNIMiIU9ao8kNnbTUTwdnYxxkdP2W',
       'Павел Слесарев',
       'master',
       40,
       true,
       'de100000-0000-4000-a000-000000000002',
       '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 'de100000-0000-4000-a000-000000000012' OR phone = '+79001112202');

-- ── 5. Demo clients ─────────────────────────────────────────────────────────
INSERT INTO clients (id, full_name, phone, tenant_id) VALUES
  ('de100000-0000-4000-a000-0000000000c1','Иван Петров',      '+79101112233','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000c2','Сергей Смирнов',   '+79202223344','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000c3','Алексей Кузнецов', '+79303334455','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000c4','Дмитрий Соколов',  '+79404445566','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000c5','Андрей Морозов',   '+79505556677','de100000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ── 6. Demo cars (one per client) ───────────────────────────────────────────
INSERT INTO cars (id, plate_number, make_model, client_id, tenant_id) VALUES
  ('de100000-0000-4000-a000-0000000000d1','А123ВС 77','Toyota Camry',    'de100000-0000-4000-a000-0000000000c1','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000d2','В456ЕК 77','Kia Rio',         'de100000-0000-4000-a000-0000000000c2','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000d3','Е789КМ 77','Hyundai Solaris', 'de100000-0000-4000-a000-0000000000c3','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000d4','О012НР 99','Lada Vesta',      'de100000-0000-4000-a000-0000000000c4','de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000d5','Р345СТ 99','Volkswagen Polo', 'de100000-0000-4000-a000-0000000000c5','de100000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ── 7. Demo products (warehouse) ────────────────────────────────────────────
INSERT INTO products (id, name, category, cost_price, sell_price, stock, min_stock, tenant_id) VALUES
  ('de100000-0000-4000-a000-0000000000a1','Масло моторное 5W-40','Расходники', 500, 800, 40, 10,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a2','Тормозные колодки',   'Запчасти',  2200,3500, 12,  4,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a3','Масляный фильтр',     'Расходники', 350, 600, 30, 10,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a4','Воздушный фильтр',    'Расходники', 400, 750, 25,  8,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a5','Свеча зажигания',     'Запчасти',   250, 500, 60, 16,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a6','Антифриз 5л',         'Расходники', 900,1500, 15,  5,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a7','Щётки стеклоочистителя (комплект)','Запчасти', 600,1200, 20, 6,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000a8','Лампа H4',            'Запчасти',   180, 400, 40, 10,'de100000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ── 8. Demo services ────────────────────────────────────────────────────────
INSERT INTO services (id, name, category, default_price, tenant_id) VALUES
  ('de100000-0000-4000-a000-0000000000b1','Замена масла',      'ТО',         1500,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000b2','Компьютерная диагностика','Диагностика',1000,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000b3','Развал-схождение',  'Ходовая',    2500,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000b4','Замена тормозных колодок','Тормоза',2000,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000b5','Шиномонтаж',        'Шины',       2000,'de100000-0000-4000-a000-000000000002'),
  ('de100000-0000-4000-a000-0000000000b6','Замена антифриза',  'ТО',         1200,'de100000-0000-4000-a000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ── 9. Demo checks (order-narjads) — recent, internally consistent ──────────
-- total_revenue = service_total + product_total - discount; profit = total_revenue - total_cost.
INSERT INTO checks (id, date, master_id, client_id, car_id, mileage, payment_method,
                    service_total, product_total, total_revenue, product_cost_total, total_cost, profit,
                    cash_amount, card_amount, tenant_id, created_at) VALUES
  ('de100000-0000-4000-a000-0000000000e1', now() - interval '2 days',
   'de100000-0000-4000-a000-000000000011','de100000-0000-4000-a000-0000000000c1','de100000-0000-4000-a000-0000000000d1',
   84500,'cash', 1500, 3200, 4700, 2000, 2000, 2700, 4700, 0,
   'de100000-0000-4000-a000-000000000002', now() - interval '2 days'),
  ('de100000-0000-4000-a000-0000000000e2', now() - interval '5 days',
   'de100000-0000-4000-a000-000000000012','de100000-0000-4000-a000-0000000000c2','de100000-0000-4000-a000-0000000000d2',
   42100,'card', 3500, 0, 3500, 0, 0, 3500, 0, 3500,
   'de100000-0000-4000-a000-000000000002', now() - interval '5 days'),
  ('de100000-0000-4000-a000-0000000000e3', now() - interval '9 days',
   'de100000-0000-4000-a000-000000000011','de100000-0000-4000-a000-0000000000c3','de100000-0000-4000-a000-0000000000d3',
   119300,'cash', 2000, 3500, 5500, 2200, 2200, 3300, 5500, 0,
   'de100000-0000-4000-a000-000000000002', now() - interval '9 days'),
  ('de100000-0000-4000-a000-0000000000e4', now() - interval '14 days',
   'de100000-0000-4000-a000-000000000012','de100000-0000-4000-a000-0000000000c4','de100000-0000-4000-a000-0000000000d4',
   60750,'card', 1500, 600, 2100, 350, 350, 1750, 0, 2100,
   'de100000-0000-4000-a000-000000000002', now() - interval '14 days')
ON CONFLICT (id) DO NOTHING;

-- ── 10. Demo check line items ───────────────────────────────────────────────
INSERT INTO check_service_lines (id, check_id, service_id, master_id, name, price, quantity, total) VALUES
  ('de100000-0000-4000-a000-00000000f0e1','de100000-0000-4000-a000-0000000000e1','de100000-0000-4000-a000-0000000000b1','de100000-0000-4000-a000-000000000011','Замена масла',1500,1,1500),
  ('de100000-0000-4000-a000-00000000f0e2','de100000-0000-4000-a000-0000000000e2','de100000-0000-4000-a000-0000000000b2','de100000-0000-4000-a000-000000000012','Компьютерная диагностика',1000,1,1000),
  ('de100000-0000-4000-a000-00000000f0e3','de100000-0000-4000-a000-0000000000e2','de100000-0000-4000-a000-0000000000b3','de100000-0000-4000-a000-000000000012','Развал-схождение',2500,1,2500),
  ('de100000-0000-4000-a000-00000000f0e4','de100000-0000-4000-a000-0000000000e3','de100000-0000-4000-a000-0000000000b4','de100000-0000-4000-a000-000000000011','Замена тормозных колодок',2000,1,2000),
  ('de100000-0000-4000-a000-00000000f0e5','de100000-0000-4000-a000-0000000000e4','de100000-0000-4000-a000-0000000000b1','de100000-0000-4000-a000-000000000012','Замена масла',1500,1,1500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO check_product_lines (id, check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost) VALUES
  ('de100000-0000-4000-a000-00000000f1e1','de100000-0000-4000-a000-0000000000e1','de100000-0000-4000-a000-0000000000a1','Масло моторное 5W-40',800,500,4,3200,2000),
  ('de100000-0000-4000-a000-00000000f1e2','de100000-0000-4000-a000-0000000000e3','de100000-0000-4000-a000-0000000000a2','Тормозные колодки',3500,2200,1,3500,2200),
  ('de100000-0000-4000-a000-00000000f1e3','de100000-0000-4000-a000-0000000000e4','de100000-0000-4000-a000-0000000000a3','Масляный фильтр',600,350,1,600,350)
ON CONFLICT (id) DO NOTHING;
