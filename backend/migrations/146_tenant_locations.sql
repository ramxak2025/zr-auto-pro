-- 146_tenant_locations.sql
-- ============================================================================
-- Режим «Кассир» (Round 14, docs/ios-redesign/CASHIER_MODE_SPEC.md), часть 1:
-- справочник МЕСТ автосервиса + привязка заказ-наряда к месту + веха «Выдана».
--
--   • tenant_locations — «места» тенанта («возле задних ворот», «Бокс 2»):
--     владелец заводит их в настройках, админ вешает на заказ при приёмке,
--     мастер видит место на карточке доски. DELETE в API = архив
--     (is_active=false): старые чеки продолжают показывать место, в пикере
--     оно больше не предлагается. Имя уникально среди ЖИВЫХ мест тенанта без
--     учёта регистра — частичный UNIQUE-индекс (tenant_id, lower(name))
--     WHERE is_active (паттерн 140_check_tags: архив освобождает имя).
--   • checks.location_id — привязка чека к месту; ON DELETE SET NULL (жёсткое
--     удаление строки справочника, если оно когда-то случится, не трогает чек).
--   • checks.delivered_at — системная веха «Выдана» конвейера: проставляется
--     сервером при setWorkStatus в колонку key='delivered' (гард: нельзя
--     выдать неоплаченный, is_deferred обязан быть false) и снимается при
--     возврате карточки в другую колонку. Чисто трекинговое поле — денег,
--     склада и зарплаты не двигает.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF
-- NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY (конвенция 112/140).
-- Повторный прогон сходится к тому же состоянию. Не редактируется после
-- применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Имя как ввёл владелец (регистр сохраняем для UI); уникальность — по
    -- lower(name) среди живых, см. частичный индекс ниже.
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    -- false = архив: старые чеки место сохраняют, пикер его не предлагает.
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Дубль имени среди ЖИВЫХ мест тенанта невозможен (case-insensitive);
-- архивное место имя освобождает (WHERE is_active) — иначе «Бокс 1» после
-- архивации нельзя было бы завести заново.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_locations_tenant_name_active
    ON tenant_locations (tenant_id, lower(name)) WHERE is_active;

-- ── Row Level Security (конвенция 112 / dual-pool, паттерн 140) ─────────────
-- CRUD мест идёт в request-контексте → роль autexa_app (NOBYPASSRLS); без
-- политики default-deny запретил бы и SELECT, и INSERT.
ALTER TABLE tenant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_locations;
CREATE POLICY tenant_isolation ON tenant_locations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Привязка чека к месту + веха «Выдана» ───────────────────────────────────
ALTER TABLE checks ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES tenant_locations(id) ON DELETE SET NULL;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Фильтр доски/отчётов по месту: частичный — строки без места (весь
-- исторический массив) индекс не раздувают.
CREATE INDEX IF NOT EXISTS idx_checks_tenant_location
    ON checks (tenant_id, location_id) WHERE location_id IS NOT NULL;
