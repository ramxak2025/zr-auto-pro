-- 093_installments.sql
-- Рассрочка (installments) — заменяет ручную «Дебиторку» (client_debts, 081) как
-- основной поток продаж в долг. ADDITIVE: ничего из 081 НЕ удаляется и НЕ
-- меняется — старая таблица остаётся для исторических данных, а новый поток
-- «Рассрочка» становится первичным в UI.
--
-- Модель:
--   • installment_plans      — один план на чек: total / down_payment (первый
--                              взнос) / paid (всё собранное вкл. первый взнос) /
--                              remaining (total − paid) / next_payment_date /
--                              status open|closed / comment.
--   • installment_payments   — частичные оплаты по плану (ledger).
--   • installment_reminder_settings — пер-тенант настройки напоминаний (mode
--                              off|auto|manual), шаблон с {clientName}/{amount}/
--                              {date}. По умолчанию OFF — фича полностью инертна,
--                              пока владелец её не включит.
--
-- НЕ трогает финансовый / checks write-path схемно: связь с checks — это soft FK
-- (план ссылается на чек; чек НЕ ссылается на план). Сам план создаётся внутри
-- транзакции создания чека сервисным кодом, отдельной колонки в `checks` нет.
--
-- Идемпотентность: CREATE TABLE IF NOT EXISTS + DO-block safe ADD COLUMN
-- (swallow duplicate_column / undefined_table) + CREATE INDEX IF NOT EXISTS +
-- DROP/ADD CONSTRAINT для CHECK'ов. Повторный прогон сходится к полной форме.
-- Никогда не редактируется после применения.

-- ── installment_plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Чек, из которого родилась рассрочка. SET NULL (не CASCADE), чтобы удаление
    -- чека НЕ стирало долговую запись — рассрочка остаётся как обязательство.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    -- Кто должен. CASCADE как у client_debts: удаление клиента уносит его планы.
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- Полная сумма (= total_revenue чека на момент продажи).
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Первый взнос (сумма наличными+картой, внесённая в момент продажи).
    down_payment NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Всё собранное по плану ВКЛЮЧАЯ первый взнос (down_payment + Σ платежей).
    paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Остаток долга = total − paid (никогда не отрицательный, клампится в коде).
    remaining NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Дата следующего платежа (для списка/виджета/напоминаний). NULL допустим.
    next_payment_date DATE,
    -- 'open' — есть остаток; 'closed' — погашено.
    status TEXT NOT NULL DEFAULT 'open',
    comment TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- Safe column adds for any pre-existing installment_plans table.
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN total NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN down_payment NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN paid NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN remaining NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN next_payment_date DATE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'open'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN comment TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_plans ADD COLUMN closed_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- status domain (drop-then-add keeps it idempotent).
ALTER TABLE installment_plans DROP CONSTRAINT IF EXISTS installment_plans_status_check;
ALTER TABLE installment_plans ADD CONSTRAINT installment_plans_status_check CHECK (status IN ('open', 'closed'));

-- ── installment_payments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installment_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    comment TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN plan_id UUID REFERENCES installment_plans(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN amount NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN paid_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN comment TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

ALTER TABLE installment_payments DROP CONSTRAINT IF EXISTS installment_payments_amount_check;
ALTER TABLE installment_payments ADD CONSTRAINT installment_payments_amount_check CHECK (amount > 0);

-- ── installment_reminder_settings ────────────────────────────────────────────
-- Один ряд на тенант (mirrors car_ready_settings / reminder_settings). Disabled
-- (mode='off') by default → фича инертна, пока владелец не включит.
CREATE TABLE IF NOT EXISTS installment_reminder_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- 'off'    — напоминания выключены;
    -- 'auto'   — ежедневный cron шлёт по правилам ниже;
    -- 'manual' — владелец шлёт сам из UI (cron не трогает).
    mode TEXT NOT NULL DEFAULT 'off',
    -- За сколько дней до next_payment_date слать пред-напоминание.
    days_before INT NOT NULL DEFAULT 1,
    -- Слать в день платежа (next_payment_date = сегодня).
    on_due BOOLEAN NOT NULL DEFAULT true,
    -- Слать по просроченным (next_payment_date < сегодня, статус open).
    on_overdue BOOLEAN NOT NULL DEFAULT true,
    -- Шаблон: {clientName} / {amount} / {date}.
    template TEXT NOT NULL DEFAULT 'Здравствуйте, {clientName}! Напоминаем: по рассрочке оплата {date} на сумму {amount} ₽. Спасибо!',
    -- Гейт ежедневного прогона (как reminder_settings.last_run_at).
    last_run_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN mode TEXT NOT NULL DEFAULT 'off'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN days_before INT NOT NULL DEFAULT 1; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN on_due BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN on_overdue BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN template TEXT NOT NULL DEFAULT 'Здравствуйте, {clientName}! Напоминаем: по рассрочке оплата {date} на сумму {amount} ₽. Спасибо!'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN last_run_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE installment_reminder_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

ALTER TABLE installment_reminder_settings DROP CONSTRAINT IF EXISTS installment_reminder_settings_mode_check;
ALTER TABLE installment_reminder_settings ADD CONSTRAINT installment_reminder_settings_mode_check CHECK (mode IN ('off', 'auto', 'manual'));

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Список «Рассрочка» (open/closed/overdue) + виджет ведут с tenant_id + status.
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_status ON installment_plans (tenant_id, status);
-- Сортировка/виджет по ближайшей дате платежа.
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_next ON installment_plans (tenant_id, next_payment_date);
-- Планы конкретного клиента (карточка клиента).
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_client ON installment_plans (tenant_id, client_id);
-- Поиск плана по чеку.
CREATE INDEX IF NOT EXISTS idx_installment_plans_check ON installment_plans (check_id);
-- Ledger платежей по плану.
CREATE INDEX IF NOT EXISTS idx_installment_payments_plan ON installment_payments (tenant_id, plan_id);
