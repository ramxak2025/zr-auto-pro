-- 156_tenant_points.sql
-- ============================================================================
-- Мульти-точки: несколько автосервисов (филиалов) у одного тенанта.
--
--   • tenant_points — точки тенанта (название + адрес). Заводит ТОЛЬКО
--     суперадмин из ЛК (лимит количества точек = сколько создал суперадмин).
--     0 точек = обычный одноточечный тенант, ничего не меняется.
--     DELETE в API = архив (is_active=false), паттерн tenant_locations/146:
--     старые чеки точку сохраняют, пикеры её не предлагают, имя освобождается.
--     НЕ путать с tenant_locations («места» внутри двора: «Бокс 2») — это
--     разные сущности, обе живут параллельно.
--   • user_points — на каких точках может работать сотрудник. ПУСТО для
--     сотрудника = не ограничен (безопасный дефолт внедрения: существующие
--     команды продолжают работать без настройки).
--   • users.current_point_id — выбранная сейчас точка (переключатель в
--     приложении). NULL = не выбрана (одноточечный тенант / владелец «все»).
--   • checks.point_id — на какой точке создан заказ-наряд (штампуется
--     сервером из current_point_id автора; UI показывает при >1 точки).
--   • clients.point_id — точка клиента; используется ТОЛЬКО при
--     tenants.points_shared_clients=false (раздельные базы клиентов).
--     NULL = общий/исторический клиент, виден на всех точках.
--   • tenants.points_shared_clients — выбор тенанта: true (дефолт) = общая
--     база клиентов всех точек, false = у каждой точки своя.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF
-- NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY (конвенция 112/146).
-- Повторный прогон сходится к тому же состоянию. Не редактируется после
-- применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Название точки как ввёл суперадмин (регистр сохраняем для UI).
    name TEXT NOT NULL,
    address TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    -- false = архив: старые чеки точку сохраняют, пикер её не предлагает.
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Дубль имени среди ЖИВЫХ точек тенанта невозможен (case-insensitive);
-- архив освобождает имя (паттерн 146).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_points_tenant_name_active
    ON tenant_points (tenant_id, lower(name)) WHERE is_active;

-- ── RLS (конвенция 112 / dual-pool) ─────────────────────────────────────────
-- Чтение точек идёт и в request-контексте тенанта (autexa_app под RLS);
-- CRUD суперадмина идёт через admin-пул (BYPASSRLS) — политика ему не мешает.
ALTER TABLE tenant_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_points;
CREATE POLICY tenant_isolation ON tenant_points
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Назначение сотрудников на точки ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_points (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    point_id UUID NOT NULL REFERENCES tenant_points(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, point_id)
);

ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_points;
CREATE POLICY tenant_isolation ON user_points
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Привязки ────────────────────────────────────────────────────────────────
ALTER TABLE users   ADD COLUMN IF NOT EXISTS current_point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE checks  ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;

-- Частичные индексы: исторические строки без точки индекс не раздувают.
CREATE INDEX IF NOT EXISTS idx_checks_tenant_point
    ON checks (tenant_id, point_id) WHERE point_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_tenant_point
    ON clients (tenant_id, point_id) WHERE point_id IS NOT NULL;

-- ── Настройка тенанта: общая vs раздельная база клиентов ────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS points_shared_clients BOOLEAN NOT NULL DEFAULT true;
