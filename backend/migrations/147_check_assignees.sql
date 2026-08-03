-- 147_check_assignees.sql
-- ============================================================================
-- Режим «Кассир» (Round 14, docs/ios-redesign/CASHIER_MODE_SPEC.md), часть 1:
-- НЕСКОЛЬКО исполнителей на заказ-наряд.
--
-- Админ при приёмке назначает одного или нескольких мастеров — заказ падает
-- на доску КАЖДОГО из них. check_assignees — связка чек ↔ исполнитель:
--   • UNIQUE (check_id, user_id) — исполнитель на чеке максимум один раз;
--   • ON DELETE CASCADE с обеих сторон — жёсткое удаление чека (purge из
--     корзины) или пользователя уносит только связки;
--   • tenant_id денормализован намеренно: предикат доски «мои машины» и
--     фильтр владельца по мастеру ходят по индексу (tenant_id, user_id) без
--     JOIN, и RLS-политика работает по собственной колонке строки.
--
-- ЗАРПЛАТНАЯ АТРИБУЦИЯ НЕ МЕНЯЕТСЯ: зарплата по-прежнему считается по строкам
-- услуг (check_service_lines.master_id / salary_amount) и master_id чека —
-- check_assignees чисто про видимость на доске и уведомления, денег не двигает.
--
-- Дефолт набора выводит сервер при create() без явного assigneeIds:
-- distinct master_id строк услуг + главный master_id чека, — поэтому старые
-- клиенты (не шлющие поле) получают осмысленные доски без OTA.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS + CREATE POLICY (конвенция 112/140). Не редактируется после применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS check_assignees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (check_id, user_id)
);

-- «Мои машины» мастера / фильтр владельца по мастеру: (tenant_id, user_id).
CREATE INDEX IF NOT EXISTS idx_check_assignees_tenant_user
    ON check_assignees (tenant_id, user_id);
-- Агрегация исполнителей карточки (getById / getBoard json_agg): по чеку.
CREATE INDEX IF NOT EXISTS idx_check_assignees_check
    ON check_assignees (check_id);

-- ── Row Level Security (конвенция 112 / dual-pool, паттерн 140) ─────────────
ALTER TABLE check_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_assignees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_assignees;
CREATE POLICY tenant_isolation ON check_assignees
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
