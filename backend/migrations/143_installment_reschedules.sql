-- 143_installment_reschedules.sql
-- ============================================================================
-- ИСТОРИЯ ПЕРЕНОСОВ ДАТЫ ПЛАТЕЖА (Round 13 #7): каждый ЯВНЫЙ перенос
-- next_payment_date (PATCH /installments/:planId с новой датой) пишет строку
-- «старая дата → новая дата + причина», чтобы владелец видел в таймлайне
-- рассрочки, сколько раз и почему должник двигал платёж.
--
-- ВАЖНО: сдвиг даты, который приходит ВМЕСТЕ с платежом (pay() с
-- nextPaymentDate), сюда НЕ пишется — это рабочий график «заплатил → следующая
-- дата», а не перенос по просьбе должника; иначе история замусорится.
--
-- ON DELETE CASCADE от плана; created_by — кто перенёс (SET NULL при удалении
-- сотрудника, как в 093). reason — свободный текст, NULL допустим (причина
-- опциональна).
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS + CREATE POLICY (RLS-паттерн 140_check_tags). Не трогает ни одну
-- существующую таблицу. Повторный прогон сходится к тому же состоянию.
-- Никогда не редактируется после применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS installment_reschedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Денормализованный tenant_id (паттерн 140): RLS-политика работает по
    -- собственной колонке строки, выборки по (tenant_id, plan_id) — по индексу.
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    -- Какая дата стояла ДО переноса (NULL — платёж был «без даты»).
    old_date DATE,
    -- На какую дату перенесли (NULL — дату сняли).
    new_date DATE,
    -- Причина переноса («клиент попросил до зарплаты»). NULL — без причины.
    reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Переносы одного плана (таймлайн деталки рассрочки / clientLedger).
CREATE INDEX IF NOT EXISTS idx_installment_reschedules_tenant_plan
    ON installment_reschedules (tenant_id, plan_id);

-- ── Row Level Security (в связке с миграцией 112 / dual-pool) ────────────────
ALTER TABLE installment_reschedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_reschedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON installment_reschedules;
CREATE POLICY tenant_isolation ON installment_reschedules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
