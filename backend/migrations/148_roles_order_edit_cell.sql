-- 148_roles_order_edit_cell.sql
-- ============================================================================
-- Режим «Кассир» (Round 14, docs/ios-redesign/CASHIER_MODE_SPEC.md), часть 1:
-- новая ячейка матрицы ролей «Изменяет назначенный заказ» (по образцу 136/137).
--
--   {checks, editAssignedOrder} → плоский ключ checks_edit_assigned_order
--
-- Семантика: может ли сотрудник МЕНЯТЬ СОСТАВ (строки услуг/товаров)
-- заказ-наряда, который находится в конвейере режима заказов (is_deferred=true
-- И work_status NOT NULL — карточка стоит на доске). Выключено — мастер только
-- ВЫПОЛНЯЕТ назначенное: двигает карточку по доске (setWorkStatus) и правит
-- комментарий, но строки не трогает (400 в ChecksService.fullUpdate).
--
-- ПРЕЗЕРВАЦИЯ 1:1: сегодня строки конвейерного драфта может править ЛЮБОЙ, кто
-- проходит существующие edit-гейты (мастер — свой драфт), поэтому сид ячейки —
-- TRUE ДЛЯ ВСЕХ существующих ролей, включая кастомные (в отличие от 136, где
-- отсутствующая ячейка означала «роут и раньше был недоступен», здесь
-- отсутствие = false ИЗМЕНИЛО БЫ поведение держателей кастомных ролей).
-- Владелец выключает ячейку сам — в редакторе ролей. Новые роли, созданные
-- редактором после этой волны, материализуют ячейку явно (клиент пишет полную
-- матрицу; пресет «Кассир» — editAssignedOrder=false).
--
-- Зеркала этой волны (тот же коммит): backend/src/common/role-matrix.ts
-- (BOOL_ACTIONS + flattenRoleMatrix), permissions.guard.ts (оба DEFAULTS-
-- фолбэка master/admin = true), shared/types (PermissionKey / PERMISSION_GROUPS
-- / RoleMatrix / ROLE_PERMISSION_DEFAULTS), mobile roleMatrixEditor, web
-- RolesManagement.
--
-- Идемпотентность: каждая ячейка — jsonb_set под guard'ом «ещё не задана»
-- (matrix #> path IS NULL) → повторный прогон no-op, ручные правки владельца
-- не перетираются. Секция гарантируется COALESCE-мержем (jsonb_set не создаёт
-- отсутствующий промежуточный объект).
--
-- RLS (конвенция 131/134/136): roles под RLS (114). Миграции идут admin-пулом
-- (суперпользователь, RLS обходится); row_security = off — fail-loud страховка
-- от молчаливого no-op, если владельцем таблицы окажется не-суперпользователь.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── 0. Страховка: matrix NULL → '{}' (jsonb_set(NULL, …) вернул бы NULL и
--       молча потерял бы всю матрицу).
UPDATE roles SET matrix = '{}'::jsonb WHERE matrix IS NULL;

-- ── 1. Гарантировать секцию checks на КАЖДОЙ роли (двухуровневый jsonb_set в
--       отсутствующую секцию — no-op).
UPDATE roles
   SET matrix = jsonb_set(matrix, '{checks}', COALESCE(matrix -> 'checks', '{}'::jsonb), true)
 WHERE matrix -> 'checks' IS NULL;

-- ── 2. Сид ячейки: TRUE для ВСЕХ ролей, где ячейка ещё не задана (системные
--       master/admin/director, их тенантные override'ы И кастомные роли —
--       см. презервацию 1:1 в шапке). Guard «IS NULL» делает прогон
--       идемпотентным и не перетирает будущие ручные false владельца.
UPDATE roles
   SET matrix = jsonb_set(matrix, '{checks,editAssignedOrder}', 'true'::jsonb, true)
 WHERE matrix #> '{checks,editAssignedOrder}' IS NULL;
