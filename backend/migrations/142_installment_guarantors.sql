-- 142_installment_guarantors.sql
-- ============================================================================
-- ПОРУЧИТЕЛИ РАССРОЧКИ (Round 13 #6): владелец фиксирует на плане рассрочки
-- людей, которые ручаются за должника — ФИО, кем приходится (relation) и
-- телефон, чтобы позвонить/написать, когда сам клиент не отвечает.
--
-- Одна таблица installment_guarantors: N поручителей на план. Чисто учётная
-- запись — деньги/статусы/кассу не двигает. ON DELETE CASCADE от плана:
-- удаление плана (через удаление клиента, 093) уносит и поручителей.
-- created_by — кто добавил (SET NULL при удалении сотрудника, как в 093).
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS + CREATE POLICY (RLS-паттерн 140_check_tags). Не трогает ни одну
-- существующую таблицу. Повторный прогон сходится к тому же состоянию.
-- Никогда не редактируется после применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS installment_guarantors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Денормализованный tenant_id (паттерн 140): RLS-политика работает по
    -- собственной колонке строки, выборки по (tenant_id, plan_id) — по индексу.
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    -- ФИО поручителя, как ввёл владелец. Обязательное.
    full_name TEXT NOT NULL,
    -- «Кем приходится» должнику: брат / сосед / коллега… Свободный текст.
    relation TEXT,
    -- Телефон для «Позвонить» / WhatsApp. NULL/пусто допустимы (R12: телефон
    -- не обязателен).
    phone TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Поручители одного плана (деталка рассрочки / clientLedger).
CREATE INDEX IF NOT EXISTS idx_installment_guarantors_tenant_plan
    ON installment_guarantors (tenant_id, plan_id);

-- ── Row Level Security (в связке с миграцией 112 / dual-pool) ────────────────
-- Чтение и запись идут в request-контексте → роль autexa_app (NOBYPASSRLS);
-- без политики default-deny запретил бы и SELECT, и INSERT.
ALTER TABLE installment_guarantors ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_guarantors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON installment_guarantors;
CREATE POLICY tenant_isolation ON installment_guarantors
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
