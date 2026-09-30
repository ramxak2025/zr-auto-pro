-- 172_storage_cells.sql
-- ============================================================================
-- Адресное хранение на складе (docs/specs/2026-09-30-STORAGE_CELLS.md), часть 1:
-- справочник ЯЧЕЕК ХРАНЕНИЯ склада + привязка товара к ячейке.
--
--   • storage_cells — ячейка склада («A-3-2», «Стеллаж 1 / полка 4»). Ячейка
--     живёт на конкретном складе (warehouses): основной / брак / Б/У каждого
--     филиала ведут свои адреса. Филиала у ячейки нет — он выводится из
--     warehouses.point_id (один источник правды, как у папок склада).
--     Код хранится в каноническом виде (trim, пробелы в один, верхний регистр —
--     нормализует сервер), уникален в пределах склада БЕЗ учёта регистра:
--     уникальный индекс (warehouse_id, lower(code)). name — необязательное
--     описание («Верхняя полка у окна»).
--   • products.storage_cell_id — где лежит товар; ON DELETE SET NULL: жёсткое
--     удаление строки ячейки не трогает товар (сервис удаления ячейки сам
--     переносит или открепляет товары, FK — только страховка). Одна ячейка
--     держит много товаров, у товара ячейка одна или нет вовсе.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF
-- NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY (конвенция 112/140/146).
-- Повторный прогон сходится к тому же состоянию. Существующие строки products
-- получают storage_cell_id = NULL — «без ячейки». Не редактируется после
-- применения.
-- ============================================================================

CREATE TABLE IF NOT EXISTS storage_cells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    -- Канонический код (верхний регистр, пробелы схлопнуты) — нормализует сервер.
    code TEXT NOT NULL,
    name TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Код уникален в пределах склада без учёта регистра: страховка от гонки двух
-- одновременных POST (сервис ловит 23505 и отвечает 409 STORAGE_CELL_EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_cells_wh_code
    ON storage_cells (warehouse_id, lower(code));

-- Список ячеек склада (GET /storage-cells?warehouseId=) и проверки «ячейка тенанта».
CREATE INDEX IF NOT EXISTS idx_storage_cells_tenant_wh
    ON storage_cells (tenant_id, warehouse_id);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS storage_cell_id UUID REFERENCES storage_cells(id) ON DELETE SET NULL;

-- Частичный: большинство товаров без ячейки, индекс нужен для «товары ячейки»,
-- счётчика productsCount и фильтра storageCellId.
CREATE INDEX IF NOT EXISTS idx_products_storage_cell
    ON products (storage_cell_id) WHERE storage_cell_id IS NOT NULL;

-- RLS по образцу 146: ячейки видны только своему тенанту. GRANT для роли
-- autexa_app выдаёт MigrationRunner.bootstrapAppRole — здесь его нет намеренно.
ALTER TABLE storage_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cells FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON storage_cells;
CREATE POLICY tenant_isolation ON storage_cells
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
