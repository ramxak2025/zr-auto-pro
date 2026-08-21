-- 155_cash_shift_safe_and_attribution.sql
-- ============================================================================
-- Крупное обновление режима кассовой смены (требование владельца, 2026-08):
--
-- 1) АТРИБУЦИЯ «КТО ПРИНЯЛ ОПЛАТУ». checks.accepted_by / accepted_at — кто
--    фактически принял деньги (кассир, активировавший отложенный заказ, или
--    автор обычного не-отложенного чека). Заполняется сервисом в единственных
--    точках «рождения денег» (create активного чека / activateDeferred);
--    историю НЕ бэкфиллим — старые чеки атрибутируются по master_id (fallback).
--    Основа для: разбивки Z-отчёта «каждый сдаёт свою сумму», видимости
--    «кто принял» в движении денег.
--
-- 2) СЕЙФ (safe_transactions) — отдельный кошелёк тенанта. При закрытии смены
--    вся сумма или часть переводится в сейф (type='deposit', shift_id указывает
--    на смену-источник); инкассация владельцем из сейфа — type='collection';
--    'adjustment' — ручная корректировка владельцем. Баланс сейфа =
--    Σ deposit + Σ adjustment − Σ collection (adjustment может быть <0).
--    Инкассация из ЯЩИКА остаётся в существующей cash_collections.
--
-- 3) ПЕРЕСМЕНКА. cash_shifts.to_safe_amount — сколько ушло в сейф при закрытии;
--    carryover_amount = closing_amount − to_safe_amount — остаток-«размен»,
--    с которого стартует следующая смена (open() подставляет его дефолтом).
--
-- 4) СДАЧА ПО СОТРУДНИКАМ (cash_shift_settlements) — при закрытии каждый
--    принимавший оплату сдаёт СВОЮ сумму: expected_amount — расчётный нал по
--    его чекам (accepted_by), actual_amount — фактически сданный. Опционально:
--    старые клиенты закрывают смену без разбивки — таблица просто пуста.
--
-- 5) «КТО МОЖЕТ ПРИНИМАТЬ ОПЛАТУ» (tenants.payment_acceptors JSONB) — явный
--    список user id, выбранный владельцем в настройках компании. NULL (дефолт)
--    = прежнее поведение: право accept_payment из матрицы роли. Непустой список
--    = принимают ТОЛЬКО перечисленные (+ owner-class всегда). Санитизацию по
--    активным сотрудникам делает сервис.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN
-- IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY (конвенция 112/140/147).
-- Схему существующих колонок не меняет. Никогда не редактируется после
-- применения.
-- ============================================================================

-- ── 1. Атрибуция принявшего оплату ──────────────────────────────────────────
ALTER TABLE checks ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Разбивка Z-отчёта по принявшим: (tenant, accepted_by) только по размеченным.
CREATE INDEX IF NOT EXISTS idx_checks_accepted_by
    ON checks (tenant_id, accepted_by)
    WHERE accepted_by IS NOT NULL;

-- ── 2. Сейф ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safe_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- deposit: перевод из кассы при закрытии смены (+ к сейфу);
    -- collection: инкассация владельцем из сейфа (− из сейфа);
    -- adjustment: ручная корректировка владельцем (знак в amount).
    type TEXT NOT NULL CHECK (type IN ('deposit', 'collection', 'adjustment')),
    amount NUMERIC(14,2) NOT NULL,
    -- Смена-источник для deposit; NULL для collection/adjustment. SET NULL —
    -- история сейфа переживает удаление смены.
    shift_id UUID REFERENCES cash_shifts(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safe_transactions_tenant_created
    ON safe_transactions (tenant_id, created_at DESC);

ALTER TABLE safe_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE safe_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON safe_transactions;
CREATE POLICY tenant_isolation ON safe_transactions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── 3. Пересменка: перевод в сейф + размен на завтра ────────────────────────
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS to_safe_amount NUMERIC(14,2);
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS carryover_amount NUMERIC(14,2);

-- ── 4. Сдача по сотрудникам при закрытии ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_shift_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
    -- SET NULL: строка сдачи переживает удаление сотрудника (история денег).
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    actual_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_shift_settlements_tenant_shift
    ON cash_shift_settlements (tenant_id, shift_id);

ALTER TABLE cash_shift_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_shift_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_shift_settlements;
CREATE POLICY tenant_isolation ON cash_shift_settlements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── 5. Кто может принимать оплату (allowlist владельца) ─────────────────────
-- JSONB-массив user id (строки-UUID). NULL = режим «по ролям» (accept_payment
-- из матрицы) — прежнее поведение всех существующих тенантов.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_acceptors JSONB;
