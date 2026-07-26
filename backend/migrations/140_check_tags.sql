-- 140_check_tags.sql
-- ============================================================================
-- МЕТКИ ЧЕКОВ (Round 12 #9): владелец автосервиса сам заводит короткие метки
-- («вид работ», который важен именно ему) и вешает их на заказ-наряды в Кассе.
-- Отчёты дают разрез по меткам: сколько чеков, какая выручка и прибыль за
-- период. Метка — ЧИСТО учётная бирка: не двигает деньги, склад, зарплату,
-- статусы; чек без метки — полностью прежний путь.
--
-- ДВЕ таблицы:
--   • check_tag_defs  — справочник меток тенанта. Имя уникально среди ЖИВЫХ
--     (не архивных) меток без учёта регистра: частичный UNIQUE-индекс по
--     (tenant_id, lower(name)) WHERE archived_at IS NULL. Архив (archived_at)
--     вместо DELETE: старые чеки продолжают показывать метку и попадать в
--     отчёты за прошлые периоды, но в пикере Кассы метка больше не предлагается
--     и имя освобождается для повторного использования.
--   • check_tag_links — связка чек ↔ метка (мультивыбор). PK (check_id,
--     tag_id) исключает дубли; ON DELETE CASCADE с обеих сторон — удаление
--     чека (жёсткое, из корзины) или метки уносит только связки. tenant_id
--     денормализован в связку намеренно: отчёт по меткам агрегирует
--     (tenant_id, tag_id) по индексу ниже без JOIN на defs, и RLS-политика
--     работает по собственной колонке строки.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS + CREATE POLICY (паттерн 124_sent_messages). Не трогает ни одну
-- существующую таблицу. Повторный прогон сходится к тому же состоянию.
-- Никогда не редактируется после применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS check_tag_defs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Имя метки как ввёл владелец (регистр сохраняем для UI); уникальность —
    -- по lower(name) среди живых, см. частичный индекс ниже.
    name TEXT NOT NULL,
    -- Hex-акцент чипа (например '#22C55E'); NULL → нейтральный чип в UI.
    color TEXT,
    -- NULL = метка живая (предлагается в Кассе). Timestamp = архив: старые
    -- связки/отчёты живут, новые чеки эту метку получить не могут.
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Дубль имени среди ЖИВЫХ меток тенанта невозможен (case-insensitive).
-- Архивная метка имя освобождает — WHERE archived_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_check_tag_defs_tenant_name_active
    ON check_tag_defs (tenant_id, lower(name)) WHERE archived_at IS NULL;

-- ── Row Level Security (в связке с миграцией 112 / dual-pool) ────────────────
-- CRUD меток и запись связок идут в request-контексте → роль autexa_app
-- (NOBYPASSRLS); без политики default-deny запретил бы и SELECT, и INSERT.
ALTER TABLE check_tag_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_tag_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_tag_defs;
CREATE POLICY tenant_isolation ON check_tag_defs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS check_tag_links (
    check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES check_tag_defs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    PRIMARY KEY (check_id, tag_id)
);

-- Отчёт «по меткам»: агрегация чеков по (tenant_id, tag_id) за период.
CREATE INDEX IF NOT EXISTS idx_check_tag_links_tenant_tag
    ON check_tag_links (tenant_id, tag_id);

ALTER TABLE check_tag_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_tag_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON check_tag_links;
CREATE POLICY tenant_isolation ON check_tag_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
