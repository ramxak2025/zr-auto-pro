-- 114_roles.sql
-- Роли как в Битрикс24 — волна 1 (модель + мост совместимости, БЕЗ переписывания
-- enforcement). Таблица `roles` хранит матрицу «право × охват» (JSONB, секции ×
-- действия; охват — 'none'|'own'|'all' для scope-ключей, boolean для тумблеров).
-- Backend-модуль roles/ раскладывает матрицу в ПЛОСКИЕ булевы ключи, идентичные
-- сегодняшнему словарю PermissionKey (shared/types PERMISSION_GROUPS), — см.
-- backend/src/common/role-matrix.ts. Все guards/сервисы продолжают спрашивать
-- userHasPermission(actor, key); меняется только ИСТОЧНИК actor.permissions
-- (jwt.strategy: база из матрицы роли, поверх — персональные users.permissions).
--
-- users.role_id:
--   NULL  = роль не назначена — поведение байт-в-байт как до этой миграции
--           (дефолты строковой роли master/admin/director/superadmin).
--           В этой волне role_id НЕ проставляется никому — назначение начнётся
--           из UI волны 2, поэтому деплой не меняет ни одного эффективного права.
--   value = назначенная роль: база эффективных прав — flatten(roles.matrix),
--           персональные overrides из users.permissions действуют ПОВЕРХ.
--   FK ON DELETE SET NULL — сознательно: если строка роли исчезает (каскад
--   удаления тенанта; форс-удаление в будущем), пользователь безопасно
--   деградирует к легаси-дефолтам своей строковой роли, а не остаётся с
--   болтающимся id (LEFT JOIN в jwt.strategy никогда не видит полу-состояние).
--   Прикладное правило «нельзя удалить роль, на которой есть сотрудники»
--   живёт в RolesService (400 с count) — FK лишь страховочная сетка.
--
-- roles.tenant_id:
--   NULL  = СИСТЕМНАЯ роль («Мастер», «Администратор», «Директор») — видна всем
--           тенантам, из тенантного контекста НЕ редактируема (403 в сервисе +
--           RLS-политики ниже не пропускают запись в строки с tenant_id IS NULL).
--   value = кастомная роль тенанта.
--
-- Сиды системных ролей: матрицы сгенерированы из ТЕКУЩИХ дефолтов —
-- «Мастер» ↔ MASTER_PERMISSION_DEFAULTS (permissions.guard.ts) ↔
-- ROLE_PERMISSION_DEFAULTS[master] (shared/types); «Администратор» и «Директор» —
-- owner-class (guard всегда отвечает true) ⇒ все 26 ключей true / охват 'all'.
-- flatten(матрицы) == сегодняшним эффективным правам роли без overrides —
-- проверено программно на одноразовом PG16 (см. отчёт волны).
--
-- RLS (зеркало подхода users из 112, dual-mode как там же):
--   • SELECT: свой тенант ИЛИ tenant_id IS NULL (системные читают все);
--   • INSERT/UPDATE/DELETE: строго свой тенант — системную строку из тенантного
--     контекста нельзя ни изменить, ни удалить, ни создать новую системную.
--   Без DB_APP_PASSWORD (admin-пул, суперпользователь) политики инертны —
--   изоляцию, как и везде, держит WHERE tenant_id в сервисе.
--
-- Идемпотентность: IF NOT EXISTS повсюду; сиды — ON CONFLICT DO NOTHING по
-- частичному уникальному индексу имён системных ролей.

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  matrix JSONB NOT NULL DEFAULT '{}',
  sort INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Имя уникально внутри тенанта; у системных (tenant_id IS NULL) — глобально.
-- Два частичных индекса, потому что NULL в обычном UNIQUE не конфликтует сам
-- с собой и «два системных Мастера» иначе прошли бы молча.
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_name_uniq
  ON roles (tenant_id, name) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_system_name_uniq
  ON roles (name) WHERE tenant_id IS NULL;

-- Список ролей тенанта — основной путь чтения CRUD.
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles (tenant_id) WHERE tenant_id IS NOT NULL;

-- users.role_id — назначенная роль (NULL у всех существующих = нулевая регрессия).
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID NULL REFERENCES roles(id) ON DELETE SET NULL;

-- «Кто на этой роли» (guard удаления с count) + обратный путь FK.
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id) WHERE role_id IS NOT NULL;

-- ── RLS (зеркало users из 112: раздельные политики, чтение системных — всем) ──
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles;
DROP POLICY IF EXISTS tenant_isolation_select ON roles;
DROP POLICY IF EXISTS tenant_isolation_insert ON roles;
DROP POLICY IF EXISTS tenant_isolation_update ON roles;
DROP POLICY IF EXISTS tenant_isolation_delete ON roles;
CREATE POLICY tenant_isolation_select ON roles FOR SELECT
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR tenant_id IS NULL
  );
CREATE POLICY tenant_isolation_insert ON roles FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_update ON roles FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_delete ON roles FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ── Сиды системных ролей ─────────────────────────────────────────────────────
-- «Мастер» — матрица ≡ MASTER_PERMISSION_DEFAULTS: касса и свои чеки (view/edit
-- 'own'), клиенты/график видны; финансы, склад, звонки, маркетинг, управление —
-- выключены. Каждая ячейка однозначно соответствует одному PermissionKey
-- (таблица соответствия — в role-matrix.ts и отчёте волны).
INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort)
VALUES (
  NULL,
  'Мастер',
  'Работа с кассой и своими заказ-нарядами. Видит только свои чеки, клиентов и график. Финансы, склад и управление недоступны.',
  true,
  '{
    "checks":    { "view": "own", "create": true, "edit": "own", "delete": false, "changeDatetime": false, "editClosed": false, "editPayment": false, "acceptPayment": false, "sellInstallment": false },
    "warehouse": { "view": false, "delete": false },
    "suppliers": { "view": false },
    "clients":   { "view": true, "edit": false },
    "schedule":  { "view": true },
    "bookings":  { "view": false },
    "salary":    { "view": "none" },
    "reports":   { "view": false, "profit": false, "export": false },
    "expenses":  { "add": false },
    "marketing": { "view": false },
    "calls":     { "view": false, "listen": false },
    "employees": { "manage": false }
  }'::jsonb,
  3
)
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

-- «Администратор» — сегодня owner-class (userHasPermission отвечает true на всё),
-- поэтому матрица — полный доступ, охваты 'all'. Идентична директорской в этой
-- волне; разведение admin/director — отдельное продуктовое решение позже.
INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort)
VALUES (
  NULL,
  'Администратор',
  'Полный доступ ко всем разделам и действиям, включая управление сотрудниками.',
  true,
  '{
    "checks":    { "view": "all", "create": true, "edit": "all", "delete": true, "changeDatetime": true, "editClosed": true, "editPayment": true, "acceptPayment": true, "sellInstallment": true },
    "warehouse": { "view": true, "delete": true },
    "suppliers": { "view": true },
    "clients":   { "view": true, "edit": true },
    "schedule":  { "view": true },
    "bookings":  { "view": true },
    "salary":    { "view": "all" },
    "reports":   { "view": true, "profit": true, "export": true },
    "expenses":  { "add": true },
    "marketing": { "view": true },
    "calls":     { "view": true, "listen": true },
    "employees": { "manage": true }
  }'::jsonb,
  2
)
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

-- «Директор» — owner-class, полный доступ (см. комментарий у «Администратора»).
INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort)
VALUES (
  NULL,
  'Директор',
  'Владелец автосервиса: полный доступ ко всем разделам, финансам и управлению.',
  true,
  '{
    "checks":    { "view": "all", "create": true, "edit": "all", "delete": true, "changeDatetime": true, "editClosed": true, "editPayment": true, "acceptPayment": true, "sellInstallment": true },
    "warehouse": { "view": true, "delete": true },
    "suppliers": { "view": true },
    "clients":   { "view": true, "edit": true },
    "schedule":  { "view": true },
    "bookings":  { "view": true },
    "salary":    { "view": "all" },
    "reports":   { "view": true, "profit": true, "export": true },
    "expenses":  { "add": true },
    "marketing": { "view": true },
    "calls":     { "view": true, "listen": true },
    "employees": { "manage": true }
  }'::jsonb,
  1
)
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;
