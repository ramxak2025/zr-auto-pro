-- 121_roles_system_key_cashflow_scope.sql
-- ============================================================================
-- Роли, волна 3 — БЕЗОПАСНАЯ per-tenant кастомизация СИСТЕМНЫХ ролей
-- (copy-on-write) + новый scope-охват «Движение денег: свои / все».
--
-- Аддитивная, идемпотентная DDL/DML-каталожная миграция. Ни одна уже применённая
-- миграция не редактируется; схема и данные меняются только доложением.
--
-- ── ITEM 5: system_key — стабильный ключ корреляции системной роли ───────────
-- До этой миграции 3 глобальные системные строки (tenant_id IS NULL, is_system,
-- «Мастер»/«Администратор»/«Директор») — ОБЩИЕ для всех тенантов и read-only
-- (RolesService.update/remove → 403). Это защита от того, чтобы правка одной
-- глобальной строки протекла во ВСЕ тенанты.
--
-- Волна 3 даёт директору тенанта настраивать матрицу системной роли ДЛЯ СВОЕГО
-- тенанта через copy-on-write: сервис вставляет ТЕНАНТНУЮ строку-override с тем
-- же system_key и переводит на неё пользователей этого тенанта. Глобальная
-- строка НИКОГДА не изменяется — она остаётся неизменяемым шаблоном. «Директор»
-- не материализуется никогда (полные права, вечно read-only).
--
--   system_key TEXT:
--     • на глобальных строках — 'master' | 'admin' | 'director' (бэкфилл ниже);
--     • на тенантном override — тот же system_key, что у глобального шаблона;
--     • на кастомной роли тенанта (обычный «create/copy») — NULL.
--
-- Уникальные частичные индексы:
--     • roles_global_system_key_uniq  — не более одной ГЛОБАЛЬНОЙ строки на
--       system_key (жёсткость шаблонов);
--     • roles_tenant_system_key_uniq  — у тенанта не более ОДНОГО override на
--       system_key (ловит гонку параллельной материализации → сервис
--       перехватывает 23505 и обновляет существующий override).
--   Кастомные роли (system_key IS NULL) в оба индекса не попадают — обычный
--   «create custom / copy» flow не затронут.
--
-- RLS (миграция 114) не меняется и остаётся в силе: SELECT видит свой тенант +
-- глобальные (tenant_id IS NULL); INSERT/UPDATE/DELETE — строго свой тенант.
-- Новая колонка политикам безразлична (они строятся на tenant_id). Тенант
-- физически не может ни изменить глобальную строку, ни тронуть override чужого
-- тенанта — ни через код (везде WHERE tenant_id), ни через БД (RLS WITH CHECK).
--
-- ── ITEM 6: reports.cashflow — охват «Движение денег» ────────────────────────
-- Новая scope-ячейка матрицы reports.cashflow ('none'|'own'|'all') раскладывается
-- (backend/src/common/role-matrix.ts) в два плоских ключа: cashflow_view (own|all)
-- и cashflow_view_all (all). Enforcement — в ReportsService.getCashFlow: охват
-- 'own' → пользователь видит ТОЛЬКО свои денежные операции (свои чеки + принятые
-- им погашения рассрочки), 'all' → всё по автосервису. Director/admin/superadmin
-- (owner-class) видят всё всегда (строковая роль обходит гейты).
--
-- Бэкфилл матриц системных ролей СОХРАНЯЕТ сегодняшний эффективный доступ
-- (нулевая регрессия — новый fail-closed ключ никого не лишает того, что есть):
--     • «Мастер»       → reports.cashflow = 'none'  (мастера «Движение денег»
--       сегодня НЕ видят — эндпоинт был owner-class; охват свои/все — opt-in);
--     • «Администратор» → reports.cashflow = 'all'   (owner-class видит всё);
--     • «Директор»      → reports.cashflow = 'all'   (owner-class видит всё).
-- Кастомные роли тенантов НЕ бэкфилятся: отсутствующая ячейка читается как
-- 'none' (fail-closed) — cashflow_view раньше не существовал, значит никто через
-- матрицу его и не имел; owner-class по-прежнему видит всё по строковой роли.
-- ============================================================================

-- ── 1. Колонка корреляции ────────────────────────────────────────────────────
ALTER TABLE roles ADD COLUMN IF NOT EXISTS system_key TEXT;

-- ── 2. Бэкфилл system_key на 3 глобальных системных строках ───────────────────
-- Идемпотентно: только строки без system_key (повторный прогон — no-op).
UPDATE roles SET system_key = 'master'
  WHERE tenant_id IS NULL AND is_system = true AND name = 'Мастер' AND system_key IS NULL;
UPDATE roles SET system_key = 'admin'
  WHERE tenant_id IS NULL AND is_system = true AND name = 'Администратор' AND system_key IS NULL;
UPDATE roles SET system_key = 'director'
  WHERE tenant_id IS NULL AND is_system = true AND name = 'Директор' AND system_key IS NULL;

-- ── 3. Уникальность system_key ────────────────────────────────────────────────
-- Не более одной глобальной строки на system_key.
CREATE UNIQUE INDEX IF NOT EXISTS roles_global_system_key_uniq
  ON roles (system_key) WHERE tenant_id IS NULL AND system_key IS NOT NULL;

-- У тенанта — не более одного override на system_key (гонка материализации).
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_system_key_uniq
  ON roles (tenant_id, system_key) WHERE tenant_id IS NOT NULL AND system_key IS NOT NULL;

-- Быстрый поиск override тенанта по system_key (upsert-путь в сервисе).
CREATE INDEX IF NOT EXISTS idx_roles_tenant_system_key
  ON roles (tenant_id, system_key) WHERE system_key IS NOT NULL;

-- ── 4. Бэкфилл reports.cashflow в матрицах системных ролей (аддитивно) ─────────
-- create_missing=true у jsonb_set: у всех трёх сидов секция "reports" есть,
-- добавляем в неё ключ "cashflow". Guard "... IS NULL" делает шаг идемпотентным
-- и не перетирает возможную ручную правку.
UPDATE roles
   SET matrix = jsonb_set(matrix, '{reports,cashflow}', '"none"'::jsonb, true)
 WHERE tenant_id IS NULL AND system_key = 'master'
   AND (matrix -> 'reports' ->> 'cashflow') IS NULL;

UPDATE roles
   SET matrix = jsonb_set(matrix, '{reports,cashflow}', '"all"'::jsonb, true)
 WHERE tenant_id IS NULL AND system_key IN ('admin', 'director')
   AND (matrix -> 'reports' ->> 'cashflow') IS NULL;
