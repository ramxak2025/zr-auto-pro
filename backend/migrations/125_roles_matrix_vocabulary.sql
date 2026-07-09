-- 125_roles_matrix_vocabulary.sql
-- ============================================================================
-- ROLE-ONLY (консолидация 2026-07), волна 1 — расширение СЛОВАРЯ матрицы роли.
--
-- Добавляет новые ячейки view-vs-manage в матрицы СИСТЕМНЫХ ролей и в тенантные
-- OVERRIDE'ы системных ролей (system_key задан). Кастомные роли (system_key IS
-- NULL) НЕ трогаются — отсутствующая ячейка читается сервером как 'none'/false
-- (fail-closed), т.е. владелец, настроивший роль вручную, ничего «случайно» не
-- получает; enforcement добавленных секций для его роли просто выключен, пока он
-- не включит явно.
--
-- Новые ячейки (backend/src/common/role-matrix.ts flattenRoleMatrix):
--   services.view    → services_view      (manage ⇒ view)
--   services.manage  → services_manage
--   warehouse.manage → warehouse_manage   (manage ⇒ view И delete)
--   suppliers.manage → suppliers_manage   (manage ⇒ view)
--   equipment.view   → equipment_view     (manage ⇒ view)
--   equipment.manage → equipment_manage
--   (checks.edit 'all' → checks_edit_all, salary.view 'all' → salary_view_all —
--    новые ПРОИЗВОДНЫЕ плоские ключи; отдельная ячейка матрицы не нужна, они
--    выводятся из существующих scope-ячеек checks.edit / salary.view.)
--
-- ПРЕЗЕРВАЦИЯ ДОСТУПА (нулевая регрессия):
--   • «Мастер»: services.view=true и warehouse.view=true — раньше чтение услуг и
--     товаров/категорий было ОТКРЫТО (эндпоинты без гейта), теперь эти чтения
--     гейтятся 'services_view' / 'warehouse_access'. Backfill сохраняет ровно тот
--     доступ на чтение, что был. manage/удаление — false (мастер и раньше не мог).
--     equipment.view=false — «своё» имущество (GET /equipment/my) остаётся
--     открытым; справочник всего имущества мастеру в UI не нужен.
--   • «Администратор»/«Директор» (owner-class): manage/view=true везде — они и так
--     видят/делают всё по строковой роли. Backfill приводит матрицу в соответствие.
--
-- Идемпотентность: сначала гарантируем существование секции (jsonb_set не создаёт
-- ОТСУТСТВУЮЩИЙ промежуточный объект — двухуровневый путь в {} был бы no-op),
-- затем per-cell jsonb_set под guard'ом «ячейка ещё не задана» (IS NULL). Повтор —
-- no-op; ручная правка владельца НЕ перетирается.
-- ============================================================================

-- ── 0. Гарантируем существование секций services / equipment на СИСТЕМНЫХ ролях
--       и их тенантных override'ах (иначе per-cell jsonb_set по '{services,...}'
--       в пустую матрицу — no-op). '||' с COALESCE: если секция уже есть, её
--       содержимое сохраняется (пустой merge ничего не портит).
UPDATE roles
   SET matrix = jsonb_set(matrix, '{services}', COALESCE(matrix->'services', '{}'::jsonb), true)
 WHERE system_key IN ('master', 'admin', 'director') AND matrix->'services' IS NULL;
UPDATE roles
   SET matrix = jsonb_set(matrix, '{equipment}', COALESCE(matrix->'equipment', '{}'::jsonb), true)
 WHERE system_key IN ('master', 'admin', 'director') AND matrix->'equipment' IS NULL;

-- ── «Мастер» (system_key = 'master') ─────────────────────────────────────────
-- services.view = true (сохранить чтение услуг); services.manage = false.
UPDATE roles SET matrix = jsonb_set(matrix, '{services,view}', 'true'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'services' ->> 'view') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{services,manage}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'services' ->> 'manage') IS NULL;
-- warehouse.view = true (сохранить чтение товаров/категорий; себестоимость под
-- warehouse.manage). Перекрывает старый seed view=false; и создаёт при отсутствии.
UPDATE roles SET matrix = jsonb_set(matrix, '{warehouse,view}', 'true'::jsonb, true)
 WHERE system_key = 'master' AND COALESCE(matrix -> 'warehouse' ->> 'view', 'false') = 'false';
-- warehouse.manage = false
UPDATE roles SET matrix = jsonb_set(matrix, '{warehouse,manage}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'warehouse' ->> 'manage') IS NULL;
-- suppliers.manage = false
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers,manage}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'suppliers' ->> 'manage') IS NULL;
-- equipment.view = false, equipment.manage = false
UPDATE roles SET matrix = jsonb_set(matrix, '{equipment,view}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'equipment' ->> 'view') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{equipment,manage}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND (matrix -> 'equipment' ->> 'manage') IS NULL;

-- ── «Администратор» / «Директор» (owner-class) ───────────────────────────────
-- Полный доступ во всех новых ячейках (view=manage=true).
UPDATE roles SET matrix = jsonb_set(matrix, '{services,view}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'services' ->> 'view') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{services,manage}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'services' ->> 'manage') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{warehouse,manage}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'warehouse' ->> 'manage') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{suppliers,manage}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'suppliers' ->> 'manage') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{equipment,view}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'equipment' ->> 'view') IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{equipment,manage}', 'true'::jsonb, true)
 WHERE system_key IN ('admin', 'director') AND (matrix -> 'equipment' ->> 'manage') IS NULL;
