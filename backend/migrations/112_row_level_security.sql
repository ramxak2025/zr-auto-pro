-- 112_row_level_security.sql
-- ============================================================================
-- Второй рубеж изоляции тенантов: Postgres Row Level Security (этап 2, волна B).
--
-- До этой миграции изоляция держалась ТОЛЬКО на ручном `WHERE tenant_id=$1`
-- в сотнях запросов. Теперь на каждой таблице с колонкой tenant_id включён
-- RLS с политикой tenant_isolation: строка видима/записываема только если
-- tenant_id совпадает с GUC `app.tenant_id` текущей сессии/транзакции.
--
-- Как это работает в связке с кодом (dual-mode, см. common/tenant-pool.ts):
--   • DB_APP_PASSWORD не задан  → приложение ходит одним суперпользовательским
--     пулом; суперпользователь обходит RLS ⇒ эта миграция ПОЛНОСТЬЮ инертна,
--     поведение прода не меняется ни на байт.
--   • DB_APP_PASSWORD задан     → тенантный трафик идёт через роль autexa_app
--     (LOGIN, NOSUPERUSER, NOBYPASSRLS — создаётся в MigrationRunner, НЕ здесь,
--     потому что пароль приходит из env и в git ему не место). Для неё политики
--     активны: забытый WHERE tenant_id больше не отдаёт чужие строки.
--
-- Ключевые решения:
--   • current_setting('app.tenant_id', true) → NULL, если GUC не выставлен ⇒
--     сравнение с NULL ложно ⇒ DEFAULT-DENY: без контекста тенанта не видно
--     НИЧЕГО. Это желаемое поведение для не-суперпользовательской роли.
--   • NULLIF(..., '') — обязательная обёртка: после SET LOCAL + COMMIT или
--     RESET кастомный GUC возвращается к reset-значению '' (пустая строка),
--     а ''::uuid — это ошибка 22P02 на КАЖДОЙ строке. NULLIF превращает '' в
--     NULL ⇒ чистый deny вместо ошибки.
--   • FORCE ROW LEVEL SECURITY — политика действует и на владельца таблиц
--     (актуально, если владельцем станет не-суперпользователь). Суперпользователь
--     обходит RLS всегда, FORCE на него не влияет.
--   • DROP POLICY IF EXISTS + CREATE POLICY — идемпотентность: повторный прогон
--     файла сходится к тому же состоянию. ENABLE/FORCE RLS идемпотентны сами.
--   • users — особый случай (4 политики вместо одной): SELECT дополнительно
--     разрешает строки с tenant_id IS NULL (глобальные superadmin-аккаунты),
--     иначе LEFT JOIN users для имени автора/мастера в чеках, созданных
--     superadmin'ом, молча вернул бы NULL. Запись (INSERT/UPDATE/DELETE) —
--     строго свой тенант: из тенантного контекста нельзя ни создать глобального
--     пользователя, ни изменить/удалить superadmin-строку.
--
-- Список таблиц = все 87 таблиц public-схемы с колонкой tenant_id (все uuid).
-- Источник списка: information_schema.columns на живой БД после миграций
-- 001–111 (одноразовый Postgres 16), сверено со статическим grep по файлам
-- миграций. Таблицы БЕЗ tenant_id намеренно не тронуты (обоснование каждой —
-- в отчёте волны): _migrations, admin_audit_log, check_product_lines,
-- check_return_lines, check_service_lines, delivery_items,
-- notification_broadcast_seen, notification_broadcasts, notification_mutes,
-- plans, push_tokens, salary_payment_confirmations, tenants.
--
-- Миграция чисто DDL-каталожная: не переписывает строки, не строит индексы,
-- применяется за миллисекунды и безопасна в любом режиме.
-- ============================================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON booking_settings;
CREATE POLICY tenant_isolation ON booking_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bookings;
CREATE POLICY tenant_isolation ON bookings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calls;
CREATE POLICY tenant_isolation ON calls
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE car_ready_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_ready_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON car_ready_settings;
CREATE POLICY tenant_isolation ON car_ready_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE cars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cars;
CREATE POLICY tenant_isolation ON cars
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_collections;
CREATE POLICY tenant_isolation ON cash_collections
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_shifts;
CREATE POLICY tenant_isolation ON cash_shifts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE check_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_photos;
CREATE POLICY tenant_isolation ON check_photos
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE check_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_returns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_returns;
CREATE POLICY tenant_isolation ON check_returns
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE check_template_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_template_folders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_template_folders;
CREATE POLICY tenant_isolation ON check_template_folders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE check_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_templates;
CREATE POLICY tenant_isolation ON check_templates
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON checks;
CREATE POLICY tenant_isolation ON checks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE client_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_bonuses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_bonuses;
CREATE POLICY tenant_isolation ON client_bonuses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE client_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_debts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_debts;
CREATE POLICY tenant_isolation ON client_debts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE client_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_sources;
CREATE POLICY tenant_isolation ON client_sources
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON clients;
CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deliveries;
CREATE POLICY tenant_isolation ON deliveries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE employee_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_achievements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_achievements;
CREATE POLICY tenant_isolation ON employee_achievements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_documents;
CREATE POLICY tenant_isolation ON employee_documents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE equipment_issued ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_issued FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON equipment_issued;
CREATE POLICY tenant_isolation ON equipment_issued
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expense_categories;
CREATE POLICY tenant_isolation ON expense_categories
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expenses;
CREATE POLICY tenant_isolation ON expenses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE fiscal_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fiscal_integrations;
CREATE POLICY tenant_isolation ON fiscal_integrations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE fiscal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fiscal_receipts;
CREATE POLICY tenant_isolation ON fiscal_receipts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON import_runs;
CREATE POLICY tenant_isolation ON import_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE installment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON installment_payments;
CREATE POLICY tenant_isolation ON installment_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON installment_plans;
CREATE POLICY tenant_isolation ON installment_plans
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE installment_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_reminder_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON installment_reminder_settings;
CREATE POLICY tenant_isolation ON installment_reminder_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE item_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_visibility FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON item_visibility;
CREATE POLICY tenant_isolation ON item_visibility
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_acknowledgments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_acknowledgments;
CREATE POLICY tenant_isolation ON knowledge_acknowledgments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_article_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_article_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_article_feedback;
CREATE POLICY tenant_isolation ON knowledge_article_feedback
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_articles;
CREATE POLICY tenant_isolation ON knowledge_articles
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_categories;
CREATE POLICY tenant_isolation ON knowledge_categories
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_course_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_course_completion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_course_completion;
CREATE POLICY tenant_isolation ON knowledge_course_completion
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_courses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_courses;
CREATE POLICY tenant_isolation ON knowledge_courses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_lesson_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_lesson_progress;
CREATE POLICY tenant_isolation ON knowledge_lesson_progress
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_lessons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_lessons;
CREATE POLICY tenant_isolation ON knowledge_lessons
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_regulation_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_regulation_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_regulation_targets;
CREATE POLICY tenant_isolation ON knowledge_regulation_targets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE knowledge_troubleshooting ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_troubleshooting FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON knowledge_troubleshooting;
CREATE POLICY tenant_isolation ON knowledge_troubleshooting
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON loyalty_settings;
CREATE POLICY tenant_isolation ON loyalty_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE messaging_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messaging_integrations;
CREATE POLICY tenant_isolation ON messaging_integrations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE motivation_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivation_accruals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON motivation_accruals;
CREATE POLICY tenant_isolation ON motivation_accruals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE motivation_promo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivation_promo_products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON motivation_promo_products;
CREATE POLICY tenant_isolation ON motivation_promo_products
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE notification_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_broadcast_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_broadcast_recipients;
CREATE POLICY tenant_isolation ON notification_broadcast_recipients
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE payment_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_integrations;
CREATE POLICY tenant_isolation ON payment_integrations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments;
CREATE POLICY tenant_isolation ON payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE permission_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON permission_templates;
CREATE POLICY tenant_isolation ON permission_templates
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON price_history;
CREATE POLICY tenant_isolation ON price_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE product_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_commissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_commissions;
CREATE POLICY tenant_isolation ON product_commissions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON products;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE profile_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON profile_change_requests;
CREATE POLICY tenant_isolation ON profile_change_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_items;
CREATE POLICY tenant_isolation ON purchase_order_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_orders;
CREATE POLICY tenant_isolation ON purchase_orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reminder_settings;
CREATE POLICY tenant_isolation ON reminder_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_alerts;
CREATE POLICY tenant_isolation ON review_alerts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_jobs;
CREATE POLICY tenant_isolation ON review_jobs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_platform_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_platform_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_platform_links;
CREATE POLICY tenant_isolation ON review_platform_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_responses;
CREATE POLICY tenant_isolation ON review_responses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_settings;
CREATE POLICY tenant_isolation ON review_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE review_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_tokens;
CREATE POLICY tenant_isolation ON review_tokens
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE revoked_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON revoked_tokens;
CREATE POLICY tenant_isolation ON revoked_tokens
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salary_payments;
CREATE POLICY tenant_isolation ON salary_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE salary_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salary_payouts;
CREATE POLICY tenant_isolation ON salary_payouts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE salary_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_penalties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salary_penalties;
CREATE POLICY tenant_isolation ON salary_penalties
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE salary_premiums ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_premiums FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salary_premiums;
CREATE POLICY tenant_isolation ON salary_premiums
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON schedule_entries;
CREATE POLICY tenant_isolation ON schedule_entries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON schedule_settings;
CREATE POLICY tenant_isolation ON schedule_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE section_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_visibility FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON section_visibility;
CREATE POLICY tenant_isolation ON section_visibility
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON services;
CREATE POLICY tenant_isolation ON services
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shifts;
CREATE POLICY tenant_isolation ON shifts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE sms_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sms_history;
CREATE POLICY tenant_isolation ON sms_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_movements;
CREATE POLICY tenant_isolation ON stock_movements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE stock_value_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_value_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_value_snapshots;
CREATE POLICY tenant_isolation ON stock_value_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE storage_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON storage_categories;
CREATE POLICY tenant_isolation ON storage_categories
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE storage_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON storage_items;
CREATE POLICY tenant_isolation ON storage_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_payments;
CREATE POLICY tenant_isolation ON supplier_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON suppliers;
CREATE POLICY tenant_isolation ON suppliers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE telephony_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telephony_integrations;
CREATE POLICY tenant_isolation ON telephony_integrations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tenant_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_counters;
CREATE POLICY tenant_isolation ON tenant_counters
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE wallet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wallet_settings;
CREATE POLICY tenant_isolation ON wallet_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE warehouse_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warehouse_categories;
CREATE POLICY tenant_isolation ON warehouse_categories
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warehouses;
CREATE POLICY tenant_isolation ON warehouses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warranty_claims;
CREATE POLICY tenant_isolation ON warranty_claims
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_board_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_board_columns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON work_board_columns;
CREATE POLICY tenant_isolation ON work_board_columns
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_modes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON work_modes;
CREATE POLICY tenant_isolation ON work_modes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── users: особый случай ────────────────────────────────────────────────────
-- SELECT разрешает и глобальные строки (tenant_id IS NULL — superadmin), чтобы
-- LEFT JOIN users на имя автора не деградировал. Запись — строго свой тенант.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
DROP POLICY IF EXISTS tenant_isolation_select ON users;
DROP POLICY IF EXISTS tenant_isolation_insert ON users;
DROP POLICY IF EXISTS tenant_isolation_update ON users;
DROP POLICY IF EXISTS tenant_isolation_delete ON users;
CREATE POLICY tenant_isolation_select ON users FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR tenant_id IS NULL
  );
CREATE POLICY tenant_isolation_insert ON users FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_update ON users FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_delete ON users FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
