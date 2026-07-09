-- 126_roles_only_cutover.sql
-- ============================================================================
-- ROLE-ONLY (консолидация 2026-07), волна 2 — БЕЗОПАСНЫЙ переход на роли как
-- ЕДИНСТВЕННЫЙ механизм прав, с ПОЛНОЙ ПРЕЗЕРВАЦИЕЙ доступа каждого пользователя.
--
-- Живой тенант (реальные пользователи + закрытые чеки): никто не должен получить
-- или потерять доступ на границе перехода. Поэтому:
--
--   1. Каждому пользователю без role_id проставляем СИСТЕМНУЮ роль по строковой
--      роли (master/admin/director → соответствующий system_key). superadmin —
--      глобальная роль без тенанта, обходит все гейты по строковой роли; ему
--      role_id не нужен (оставляем как есть).
--
--   2. Для каждого пользователя считаем ТЕКУЩИЙ эффективный набор прав ДВУМЯ
--      способами по каждому каноническому ключу:
--        • pre  = userHasPermission(role_string, flatten(role.matrix) ⊕ users.permissions)
--        • post = userHasPermission(role_string, flatten(role.matrix))            (ROLE-ONLY)
--      Если pre и post совпадают по ВСЕМ ключам — персональная роль не нужна
--      (users.permissions ничего не меняли). Если различаются — создаём кастомную
--      per-tenant роль «<Имя> (персональная)», чья матрица воспроизводит pre, и
--      переводим пользователя на неё. Так эффективный доступ остаётся БАЙТ-В-БАЙТ.
--
--   3. jwt.strategy (в коде этого релиза) больше НЕ читает users.permissions —
--      источник прав только матрица роли. Колонку users.permissions НЕ удаляем
--      (историческая, обнуляется в create; оставляем на случай отката кода).
--
-- Идемпотентность: повторный прогон видит, что role_id уже проставлен и (для
-- расходившихся) что персональная роль уже существует → делает no-op. Персональная
-- роль ищется по устойчивому имени в пределах тенанта.
--
-- Транзакционность: весь файл в одном BEGIN/COMMIT (MigrationRunner) — атомарно.
-- ============================================================================

-- ── flatten(role.matrix) → jsonb-карта плоских ключей ────────────────────────
-- Зеркало backend/src/common/role-matrix.ts flattenRoleMatrix. Учитывает
-- «manage ⇒ view/delete» и производные scope-ключи (*_all).
CREATE OR REPLACE FUNCTION _cutover_flatten(m jsonb) RETURNS jsonb AS $$
DECLARE
  checks_view text := COALESCE(m->'checks'->>'view', 'none');
  checks_edit text := COALESCE(m->'checks'->>'edit', 'none');
  salary_view text := COALESCE(m->'salary'->>'view', 'none');
  cashflow    text := COALESCE(m->'reports'->>'cashflow', 'none');
  svc_manage  boolean := (m->'services'->>'manage')::boolean IS TRUE;
  wh_manage   boolean := (m->'warehouse'->>'manage')::boolean IS TRUE;
  sup_manage  boolean := (m->'suppliers'->>'manage')::boolean IS TRUE;
  eq_manage   boolean := (m->'equipment'->>'manage')::boolean IS TRUE;
  b jsonb;
BEGIN
  b := jsonb_build_object(
    'checks_view',            checks_view <> 'none',
    'checks_view_all',        checks_view = 'all',
    'checks_create',          (m->'checks'->>'create')::boolean IS TRUE,
    'checks_edit',            checks_edit <> 'none',
    'checks_edit_all',        checks_edit = 'all',
    'checks_delete',          (m->'checks'->>'delete')::boolean IS TRUE,
    'checks_change_datetime', (m->'checks'->>'changeDatetime')::boolean IS TRUE,
    'edit_closed_check',      (m->'checks'->>'editClosed')::boolean IS TRUE,
    'payment_edit',           (m->'checks'->>'editPayment')::boolean IS TRUE,
    'accept_payment',         (m->'checks'->>'acceptPayment')::boolean IS TRUE,
    'sell_installment',       (m->'checks'->>'sellInstallment')::boolean IS TRUE,
    'services_view',          ((m->'services'->>'view')::boolean IS TRUE) OR svc_manage,
    'services_manage',        svc_manage,
    'warehouse_access',       ((m->'warehouse'->>'view')::boolean IS TRUE) OR wh_manage,
    'warehouse_manage',       wh_manage,
    'warehouse_delete',       ((m->'warehouse'->>'delete')::boolean IS TRUE) OR wh_manage,
    'suppliers_access',       ((m->'suppliers'->>'view')::boolean IS TRUE) OR sup_manage,
    'suppliers_manage',       sup_manage,
    'equipment_view',         ((m->'equipment'->>'view')::boolean IS TRUE) OR eq_manage,
    'equipment_manage',       eq_manage,
    'clients_view',           (m->'clients'->>'view')::boolean IS TRUE,
    'clients_edit',           (m->'clients'->>'edit')::boolean IS TRUE,
    'schedule_view',          (m->'schedule'->>'view')::boolean IS TRUE,
    'bookings_access',        (m->'bookings'->>'view')::boolean IS TRUE,
    'salary_view',            salary_view <> 'none',
    'salary_view_all',        salary_view = 'all',
    'financial_reports',      (m->'reports'->>'view')::boolean IS TRUE,
    'profit_view',            (m->'reports'->>'profit')::boolean IS TRUE,
    'export_data',            (m->'reports'->>'export')::boolean IS TRUE,
    'cashflow_view',          cashflow <> 'none',
    'cashflow_view_all',      cashflow = 'all',
    'can_add_expenses',       (m->'expenses'->>'add')::boolean IS TRUE,
    'marketing_access',       (m->'marketing'->>'view')::boolean IS TRUE,
    'calls_view',             (m->'calls'->>'view')::boolean IS TRUE,
    'calls_listen',           (m->'calls'->>'listen')::boolean IS TRUE,
    'user_management',        (m->'employees'->>'manage')::boolean IS TRUE
  );
  RETURN b;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── Дефолты «Мастера» (зеркало MASTER_PERMISSION_DEFAULTS) ───────────────────
-- Для строковой роли master: если ключ явно не задан в effective-карте,
-- userHasPermission берёт этот дефолт. Owner-class роли (superadmin/director/
-- admin) обходят карту целиком (всё true), поэтому им дефолты не нужны.
CREATE OR REPLACE FUNCTION _cutover_master_defaults() RETURNS jsonb AS $$
  SELECT '{
    "checks_view": true, "checks_create": true, "checks_edit": true,
    "checks_edit_all": false, "checks_delete": false, "checks_change_datetime": false,
    "checks_view_all": false, "payment_edit": false, "accept_payment": false,
    "sell_installment": false, "edit_closed_check": false,
    "services_view": true, "services_manage": false,
    "profit_view": false, "financial_reports": false, "export_data": false,
    "can_add_expenses": false, "salary_view": false, "salary_view_all": false,
    "cashflow_view": false, "cashflow_view_all": false,
    "warehouse_access": true, "warehouse_manage": false, "warehouse_delete": false,
    "suppliers_access": false, "suppliers_manage": false,
    "equipment_view": false, "equipment_manage": false,
    "clients_view": true, "clients_edit": false, "schedule_view": true,
    "bookings_access": false, "marketing_access": false,
    "calls_view": false, "calls_listen": false, "user_management": false
  }'::jsonb;
$$ LANGUAGE sql IMMUTABLE;

-- ── Разрешение одного ключа (зеркало userHasPermission) ──────────────────────
-- role_string owner-class → true; иначе explicit true/false из perms;
-- иначе для master — дефолт; иначе (неизвестная не-owner роль) — false.
CREATE OR REPLACE FUNCTION _cutover_resolve(role_string text, perms jsonb, key text)
RETURNS boolean AS $$
DECLARE
  ev jsonb;
BEGIN
  IF role_string IN ('superadmin', 'director', 'admin') THEN
    RETURN true;
  END IF;
  ev := perms -> key;
  IF ev = 'true'::jsonb THEN RETURN true; END IF;
  IF ev = 'false'::jsonb THEN RETURN false; END IF;
  IF role_string = 'master' THEN
    RETURN COALESCE((_cutover_master_defaults() ->> key)::boolean, false);
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 1) Проставить role_id всем без него, по строковой роли ───────────────────
-- Плоские UPDATE вне DO-блока (там переменная-запись `u` конфликтовала бы с
-- алиасом таблицы). Только пользователи с тенантом; superadmin без тенанта
-- пропускается (обходит гейты по строковой роли).
UPDATE users usr SET role_id = r.id
  FROM roles r
 WHERE usr.role_id IS NULL AND usr.tenant_id IS NOT NULL
   AND usr.role = 'master' AND r.tenant_id IS NULL AND r.system_key = 'master';
UPDATE users usr SET role_id = r.id
  FROM roles r
 WHERE usr.role_id IS NULL AND usr.tenant_id IS NOT NULL
   AND usr.role = 'admin' AND r.tenant_id IS NULL AND r.system_key = 'admin';
UPDATE users usr SET role_id = r.id
  FROM roles r
 WHERE usr.role_id IS NULL AND usr.tenant_id IS NOT NULL
   AND usr.role = 'director' AND r.tenant_id IS NULL AND r.system_key = 'director';

-- ── 2) Персональные роли для расходящихся пользователей ───────────────────────
DO $cutover$
DECLARE
  u RECORD;
  base_flat jsonb;          -- flatten(role.matrix)
  own jsonb;                -- users.permissions (нормализованный объект)
  merged jsonb;             -- base_flat ⊕ own
  pre  jsonb := '{}'::jsonb; -- эффективные права ДО (role_string, merged)
  post jsonb := '{}'::jsonb; -- эффективные права ПОСЛЕ (role_string, base_flat)
  k text;
  keys text[] := ARRAY[
    'checks_view','checks_view_all','checks_create','checks_edit','checks_edit_all',
    'checks_delete','checks_change_datetime','edit_closed_check','payment_edit',
    'accept_payment','sell_installment','services_view','services_manage',
    'warehouse_access','warehouse_manage','warehouse_delete','suppliers_access',
    'suppliers_manage','equipment_view','equipment_manage','clients_view','clients_edit',
    'schedule_view','bookings_access','salary_view','salary_view_all','financial_reports',
    'profit_view','export_data','cashflow_view','cashflow_view_all','can_add_expenses',
    'marketing_access','calls_view','calls_listen','user_management'
  ];
  new_matrix jsonb;
  new_role_id uuid;
  personal_name text;
BEGIN
  -- Пройти по каждому пользователю С ТЕНАНТОМ и назначенной ролью; сравнить
  -- pre/post и, при расхождении, материализовать персональную роль.
  FOR u IN
    SELECT us.id, us.tenant_id, us.role, us.full_name, us.role_id,
           COALESCE(us.permissions, '{}'::jsonb) AS permissions,
           COALESCE(r.matrix, '{}'::jsonb) AS matrix,
           r.system_key
      FROM users us
      JOIN roles r ON r.id = us.role_id
     WHERE us.tenant_id IS NOT NULL
  LOOP
    -- Нормализуем users.permissions в объект (могла быть строкой/NULL).
    own := u.permissions;
    IF jsonb_typeof(own) IS DISTINCT FROM 'object' THEN own := '{}'::jsonb; END IF;

    base_flat := _cutover_flatten(u.matrix);
    merged := base_flat || own;  -- own перекрывает base по совпадающим ключам

    -- Считаем pre/post по каждому каноническому ключу.
    pre := '{}'::jsonb; post := '{}'::jsonb;
    FOREACH k IN ARRAY keys LOOP
      pre  := pre  || jsonb_build_object(k, _cutover_resolve(u.role, merged,   k));
      post := post || jsonb_build_object(k, _cutover_resolve(u.role, base_flat, k));
    END LOOP;

    -- Расхождения нет → персональная роль не нужна.
    CONTINUE WHEN pre = post;

    -- Расхождение есть. Собираем МАТРИЦУ персональной роли так, чтобы
    -- flatten(new_matrix) для не-owner роли давал ровно `pre`. Для owner-class
    -- (director/admin) pre всегда всё-true и совпадёт с post (роль их и так
    -- пускает) → сюда мы для них практически не попадём; но на всякий случай
    -- матрица строится из pre честно.
    --
    -- ВАЖНО: собираем ЦЕЛИКОМ через jsonb_build_object (по секциям), а НЕ
    -- пошаговыми jsonb_set по вложенному пути — jsonb_set не создаёт
    -- отсутствующие ПРОМЕЖУТОЧНЫЕ объекты (двухуровневый путь в пустой {} → no-op).
    new_matrix := jsonb_build_object(
      'checks', jsonb_build_object(
        'view', CASE WHEN (pre->>'checks_view_all')::boolean THEN 'all'
                     WHEN (pre->>'checks_view')::boolean THEN 'own' ELSE 'none' END,
        'edit', CASE WHEN (pre->>'checks_edit_all')::boolean THEN 'all'
                     WHEN (pre->>'checks_edit')::boolean THEN 'own' ELSE 'none' END,
        'create',         (pre->>'checks_create')::boolean,
        'delete',         (pre->>'checks_delete')::boolean,
        'changeDatetime', (pre->>'checks_change_datetime')::boolean,
        'editClosed',     (pre->>'edit_closed_check')::boolean,
        'editPayment',    (pre->>'payment_edit')::boolean,
        'acceptPayment',  (pre->>'accept_payment')::boolean,
        'sellInstallment',(pre->>'sell_installment')::boolean
      ),
      'services', jsonb_build_object(
        'view',   (pre->>'services_view')::boolean,
        'manage', (pre->>'services_manage')::boolean
      ),
      'warehouse', jsonb_build_object(
        'view',   (pre->>'warehouse_access')::boolean,
        'manage', (pre->>'warehouse_manage')::boolean,
        'delete', (pre->>'warehouse_delete')::boolean
      ),
      'suppliers', jsonb_build_object(
        'view',   (pre->>'suppliers_access')::boolean,
        'manage', (pre->>'suppliers_manage')::boolean
      ),
      'equipment', jsonb_build_object(
        'view',   (pre->>'equipment_view')::boolean,
        'manage', (pre->>'equipment_manage')::boolean
      ),
      'clients', jsonb_build_object(
        'view', (pre->>'clients_view')::boolean,
        'edit', (pre->>'clients_edit')::boolean
      ),
      'schedule', jsonb_build_object('view', (pre->>'schedule_view')::boolean),
      'bookings', jsonb_build_object('view', (pre->>'bookings_access')::boolean),
      'salary', jsonb_build_object(
        'view', CASE WHEN (pre->>'salary_view_all')::boolean THEN 'all'
                     WHEN (pre->>'salary_view')::boolean THEN 'own' ELSE 'none' END
      ),
      'reports', jsonb_build_object(
        'view',   (pre->>'financial_reports')::boolean,
        'profit', (pre->>'profit_view')::boolean,
        'export', (pre->>'export_data')::boolean,
        'cashflow', CASE WHEN (pre->>'cashflow_view_all')::boolean THEN 'all'
                         WHEN (pre->>'cashflow_view')::boolean THEN 'own' ELSE 'none' END
      ),
      'expenses',  jsonb_build_object('add',  (pre->>'can_add_expenses')::boolean),
      'marketing', jsonb_build_object('view', (pre->>'marketing_access')::boolean),
      'calls', jsonb_build_object(
        'view',   (pre->>'calls_view')::boolean,
        'listen', (pre->>'calls_listen')::boolean
      ),
      'employees', jsonb_build_object('manage', (pre->>'user_management')::boolean)
    );

    -- Устойчивое имя персональной роли (уникально в тенанте).
    personal_name := COALESCE(NULLIF(trim(u.full_name), ''), 'Сотрудник') || ' (персональная)';

    -- Идемпотентность: если такая роль уже есть (повторный прогон) — берём её id
    -- и лишь переназначаем пользователя; иначе создаём.
    SELECT id INTO new_role_id FROM roles
     WHERE tenant_id = u.tenant_id AND name = personal_name AND system_key IS NULL
     LIMIT 1;

    IF new_role_id IS NULL THEN
      INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort, system_key)
      VALUES (u.tenant_id, personal_name,
              'Автосозданная при переходе на роли (сохранён прежний индивидуальный доступ). Можно переименовать/настроить.',
              false, new_matrix, 100, NULL)
      RETURNING id INTO new_role_id;
    ELSE
      UPDATE roles SET matrix = new_matrix WHERE id = new_role_id;
    END IF;

    UPDATE users SET role_id = new_role_id WHERE id = u.id;
  END LOOP;
END;
$cutover$;

-- ── Уборка хелперов (миграция самодостаточна; функции больше не нужны) ────────
DROP FUNCTION IF EXISTS _cutover_resolve(text, jsonb, text);
DROP FUNCTION IF EXISTS _cutover_master_defaults();
DROP FUNCTION IF EXISTS _cutover_flatten(jsonb);

-- ── Удаление permission_templates (шаблоны прав больше не используются) ───────
-- Модуль permission-templates удалён из кода этого релиза. Таблица (миграция 077)
-- дропается — данные шаблонов не влияли на права напрямую (были одноразовой копией
-- в users.permissions при apply), поэтому презервацию доступа это не затрагивает.
DROP TABLE IF EXISTS permission_templates;
