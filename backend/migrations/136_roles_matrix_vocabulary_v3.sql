-- 136_roles_matrix_vocabulary_v3.sql
-- ============================================================================
-- Словарь матрицы ролей v3 — расширение под полный перевод enforcement
-- с хардкод-@Roles('director','admin','superadmin') на ключи матрицы
-- («права как в Битрикс24»: матрица АВТОРИТЕТНА, admin больше не owner-class).
--
-- Новые ячейки (backend/src/common/role-matrix.ts flattenRoleMatrix, эта же волна):
--   checks.cashShifts         → cash_shifts_manage        (кассовые смены open/close/collect)
--   checks.board              → checks_board_manage       (CRUD колонок доски)
--   clients.delete            → clients_delete            (DELETE /clients/:id)
--   clients.debts             → debts_manage              (долги + рассрочка)
--   schedule.manage           → schedule_manage           (мутации расписания/work-modes)
--   salary.payouts            → salary_payouts_manage     (выплаты/авансы/штрафы; admin=false!)
--   salary.premiums           → salary_premiums_manage    (премии)
--   salary.motivation         → motivation_manage         (акции «Мотивации»)
--   warehouse.analytics       → warehouse_analytics_view  (/warehouse-analytics/*)
--   equipment.permanentDelete → equipment_permanent_delete (admin=false!)
--   employees.approveProfile  → employees_approve_profile (заявки профиля; admin=false!)
--   settings.manage           → settings_manage           (новая секция: интеграции/касса/справочники)
--   settings.company          → company_manage            (/my-company; admin=false!)
--   knowledge.manage          → knowledge_manage          (новая секция: мутации базы знаний)
--
-- ПРЕЗЕРВАЦИЯ 1:1: сиды повторяют СЕГОДНЯШНИЕ @Roles-гейты соответствующих
-- роутов. Где admin сегодня ИСКЛЮЧЁН из @Roles (salary payouts/penalties —
-- OWNER_ROLES=['director','superadmin']; DELETE /equipment/:id; profile
-- change-requests; GET/PATCH /my-company) — сид «Администратора» false.
-- Кастомные роли (system_key IS NULL, включая персональные из 126) НЕ
-- трогаются: отсутствующая ячейка читается сервером как false (fail-closed) —
-- эти роуты и раньше были недоступны их держателям по строковой роли.
--
-- Идемпотентность: секция гарантируется '||'/COALESCE-мержем (jsonb_set не
-- создаёт отсутствующий промежуточный объект), каждая ячейка — jsonb_set под
-- guard'ом «ячейка ещё не задана» (matrix #> path IS NULL) → повторный прогон
-- no-op, ручные правки владельца не перетираются.
--
-- WHERE system_key = '...' покрывает И глобальные шаблоны (tenant_id IS NULL),
-- И тенантные override'ы: до этой миграции поведение держателя override
-- определялось строковой ролью (роуты были @Roles-only), т.е. совпадало с
-- системным сидом — сеять его же корректно.
--
-- RLS (конвенция 131/134): roles под RLS (114). Миграции идут admin-пулом
-- (суперпользователь, RLS обходится); row_security = off — fail-loud страховка
-- от молчаливого no-op, если владельцем таблицы окажется не-суперпользователь.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── 0. Страховка: matrix NULL → '{}' (SELECT_COLUMNS всюду COALESCE'ит, но
--       jsonb_set(NULL, …) вернул бы NULL и молча потерял бы всю матрицу).
UPDATE roles SET matrix = '{}'::jsonb
 WHERE system_key IN ('master', 'admin', 'director') AND matrix IS NULL;

-- ── 1. Гарантировать существование секций на системных ролях и их override'ах
--       (двухуровневый jsonb_set в отсутствующую секцию — no-op). Новые секции
--       settings/knowledge + подстраховка для существующих: override-строки
--       могли быть созданы частичными.
DO $$
DECLARE
  section text;
BEGIN
  FOREACH section IN ARRAY ARRAY[
    'checks', 'clients', 'schedule', 'salary', 'warehouse',
    'equipment', 'employees', 'settings', 'knowledge'
  ]
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], COALESCE(matrix -> %L, ''{}''::jsonb), true)
        WHERE system_key IN (''master'', ''admin'', ''director'') AND matrix -> %L IS NULL',
      '{' || section || '}', section, section);
  END LOOP;
END $$;

-- ── 2. «Мастер» — всё новое false (ни один из этих роутов мастеру сегодня
--       недоступен: все были @Roles(d,a,sa) или строже).
DO $$
DECLARE
  cell text;
BEGIN
  FOREACH cell IN ARRAY ARRAY[
    '{checks,cashShifts}',      '{checks,board}',
    '{clients,delete}',         '{clients,debts}',
    '{schedule,manage}',
    '{salary,payouts}',         '{salary,premiums}',   '{salary,motivation}',
    '{warehouse,analytics}',    '{equipment,permanentDelete}',
    '{employees,approveProfile}',
    '{settings,manage}',        '{settings,company}',
    '{knowledge,manage}'
  ]
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], ''false''::jsonb, true)
        WHERE system_key = ''master'' AND matrix #> %L::text[] IS NULL',
      cell, cell);
  END LOOP;
END $$;

-- ── 3. «Администратор» — true везде, где сегодняшний @Roles включает admin…
DO $$
DECLARE
  cell text;
BEGIN
  FOREACH cell IN ARRAY ARRAY[
    '{checks,cashShifts}', '{checks,board}',
    '{clients,delete}',    '{clients,debts}',
    '{schedule,manage}',
    '{salary,premiums}',   '{salary,motivation}',
    '{warehouse,analytics}',
    '{settings,manage}',   '{knowledge,manage}'
  ]
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], ''true''::jsonb, true)
        WHERE system_key = ''admin'' AND matrix #> %L::text[] IS NULL',
      cell, cell);
  END LOOP;
END $$;

-- …и FALSE в четырёх owner-only действиях, где admin сегодня ИСКЛЮЧЁН:
--   salary.payouts            — POST /salary/payments|payouts, penalties CRUD (OWNER_ROLES без admin);
--   equipment.permanentDelete — DELETE /equipment/:id (@Roles(d,sa));
--   employees.approveProfile  — profile change-requests approve/reject (@Roles(d,sa));
--   settings.company          — GET/PATCH /my-company (@Roles(d,sa)).
DO $$
DECLARE
  cell text;
BEGIN
  FOREACH cell IN ARRAY ARRAY[
    '{salary,payouts}',
    '{equipment,permanentDelete}',
    '{employees,approveProfile}',
    '{settings,company}'
  ]
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], ''false''::jsonb, true)
        WHERE system_key = ''admin'' AND matrix #> %L::text[] IS NULL',
      cell, cell);
  END LOOP;
END $$;

-- ── 4. «Директор» — всё true (owner-class обходит гейты по строковой роли;
--       матрица декоративна для enforcement, но клиентские экраны и редактор
--       ролей показывают её — держим полной).
DO $$
DECLARE
  cell text;
BEGIN
  FOREACH cell IN ARRAY ARRAY[
    '{checks,cashShifts}',      '{checks,board}',
    '{clients,delete}',         '{clients,debts}',
    '{schedule,manage}',
    '{salary,payouts}',         '{salary,premiums}',   '{salary,motivation}',
    '{warehouse,analytics}',    '{equipment,permanentDelete}',
    '{employees,approveProfile}',
    '{settings,manage}',        '{settings,company}',
    '{knowledge,manage}'
  ]
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], ''true''::jsonb, true)
        WHERE system_key = ''director'' AND matrix #> %L::text[] IS NULL',
      cell, cell);
  END LOOP;
END $$;
