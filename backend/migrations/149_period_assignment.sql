-- 149_period_assignment.sql
-- ============================================================================
-- Round 14, зона 4 — «за какой месяц» для денег (period assignment).
--
-- ПРОБЛЕМА ВЛАДЕЛЬЦА: выплата ЗП или платёж поставщику, сделанные в августе
-- ЗА ИЮЛЬ, сегодня режут прибыль АВГУСТА (отчёты относят расход по дате факта
-- e.date). Владелец хочет: ПРИБЫЛЬ — по месяцу, «за который» деньги
-- (period_month), КАССА («Движение денег», список «Расходы») — по дате факта,
-- как и была.
--
-- ЧТО ДОБАВЛЯЕМ (всё NULLABLE, нулевая регрессия):
--   • expenses.period_month        TEXT 'YYYY-MM' — месяц отнесения расхода в
--     P&L (getFinancial / dashboardV2). NULL = «период равен месяцу даты факта»
--     — байт-в-байт прежнее поведение для всех существующих строк.
--   • expenses.recipient_name      TEXT — свободное имя получателя для «выплаты
--     вне программы» (маркетолог, уборщица — люди, не заведённые в users).
--     Показывается строкой расхода. NULL у обычных расходов.
--   • supplier_payments.period_month TEXT 'YYYY-MM' — «за какой месяц» платёж
--     поставщику (справочный отчёт payments-report). NULL = месяц даты факта.
--   • salary_payouts.period_month  TEXT 'YYYY-MM' — «за какой месяц» выплата
--     сотруднику. Помесячная карточка (getEmployeeMonth) и listPayouts относят
--     выплату по COALESCE(period_month, месяц created_at МСК); при принятии
--     выплаты период копируется в созданный expenses-расход.
--
-- СЕМАНТИКА ОТНЕСЕНИЯ (единая для всех потребителей):
--   effective_month = COALESCE(period_month,
--                              to_char(<дата факта> AT TIME ZONE 'Europe/Moscow',
--                                      'YYYY-MM'))
--   Касса (getCashFlow, expenses.getAll) period_month НЕ смотрит — по факту.
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS; CHECK-констрейнты через DO-блок
-- (duplicate_object глотается); CREATE INDEX IF NOT EXISTS. Уже применённый
-- файл НЕ редактируем.
-- ============================================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS period_month TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS period_month TEXT;
ALTER TABLE salary_payouts ADD COLUMN IF NOT EXISTS period_month TEXT;

-- Формат 'YYYY-MM' (NULL разрешён — «месяц даты факта»). Сервис валидирует
-- DTO-ом; CHECK — последний рубеж от кривой записи мимо API.
DO $$ BEGIN
  ALTER TABLE expenses
    ADD CONSTRAINT expenses_period_month_format
    CHECK (period_month IS NULL OR period_month ~ '^\d{4}-\d{2}$');
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE supplier_payments
    ADD CONSTRAINT supplier_payments_period_month_format
    CHECK (period_month IS NULL OR period_month ~ '^\d{4}-\d{2}$');
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE salary_payouts
    ADD CONSTRAINT salary_payouts_period_month_format
    CHECK (period_month IS NULL OR period_month ~ '^\d{4}-\d{2}$');
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL;
END $$;

-- Частичные индексы: period_month задан у МЕНЬШИНСТВА строк (только выплаты
-- задним числом), полный индекс был бы почти целиком NULL-балластом.
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_period_month
  ON expenses (tenant_id, period_month) WHERE period_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_period_month
  ON supplier_payments (tenant_id, period_month) WHERE period_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_salary_payouts_tenant_period_month
  ON salary_payouts (tenant_id, period_month) WHERE period_month IS NOT NULL;
