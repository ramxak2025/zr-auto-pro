-- 137_roles_marketing_knowledge_split.sql
-- ============================================================================
-- Уровень «только смотрит / смотрит и редактирует» для МАРКЕТИНГА и БАЗЫ ЗНАНИЙ
-- (запрос владельца). До этой миграции оба раздела бинарны:
--   • marketing_access гейтил И чтения, И мутации раздела «Маркетинг»;
--   • база знаний — чтения ОТКРЫТЫ всем, мутации на knowledge_manage.
--
-- Новые ячейки (backend/src/common/role-matrix.ts flattenRoleMatrix, эта же волна):
--   marketing.manage → marketing_manage  (все мутации маркетинга: интеграции /
--                      площадки / настройки / car-ready / reminders(+send) /
--                      winback/send / broadcast/send / alerts/:id/read)
--   knowledge.view   → knowledge_view     (гейт GET-чтений базы знаний, которые
--                      раньше были открыты любому аутентифицированному)
--
-- Целевая модель (сиды системных ролей — 1:1 сохранение сегодняшнего поведения):
--   МАРКЕТИНГ: marketing.view = ПРОСМОТР, marketing.manage = УПРАВЛЕНИЕ.
--     • «Мастер»       — marketing.manage = false (сегодня маркетинг мастеру
--                        недоступен вовсе: marketing.view тоже false);
--     • «Администратор» — marketing.manage = true;
--     • «Директор»      — marketing.manage = true.
--   БАЗА ЗНАНИЙ: knowledge.view = ПРОСМОТР, knowledge.manage = УПРАВЛЕНИЕ.
--     • «Мастер»       — knowledge.view = true (сегодня мастер ВИДИТ базу знаний:
--                        чтения были открыты всем), knowledge.manage остаётся false;
--     • «Администратор» — knowledge.view = true;
--     • «Директор»      — knowledge.view = true.
--   Это даёт владельцу И выключить просмотр базы у роли, И уровень «смотрит,
--   но не редактирует».
--
-- Кастомные роли (system_key IS NULL, включая персональные из 126) НЕ трогаются:
-- отсутствующая ячейка читается сервером как false (fail-closed) — для маркетинга
-- это ужесточение отсутствует (marketing.manage у них и так read-as-false), а
-- для базы знаний knowledge.view=false у кастомной роли означает, что владелец
-- сам решит, кому оставить просмотр, задав ячейку в редакторе ролей.
--
-- Идемпотентность: каждая ячейка — jsonb_set под guard'ом «ячейка ещё не задана»
-- (matrix #> path IS NULL) → повторный прогон no-op, ручные правки владельца не
-- перетираются. Секции marketing/knowledge гарантируются '||'/COALESCE-мержем.
--
-- WHERE system_key = '...' покрывает И глобальные шаблоны (tenant_id IS NULL),
-- И тенантные override'ы — до этой миграции поведение держателя override
-- совпадало с системным сидом (маркетинг — по marketing_access, база знаний —
-- открыта всем), т.е. сеять его же корректно.
--
-- RLS (конвенция 131/134/136): roles под RLS (114). Миграции идут admin-пулом
-- (суперпользователь, RLS обходится); row_security = off — fail-loud страховка.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── 0. Страховка: matrix NULL → '{}' (jsonb_set(NULL, …) вернул бы NULL и молча
--       потерял бы всю матрицу).
UPDATE roles SET matrix = '{}'::jsonb
 WHERE system_key IN ('master', 'admin', 'director') AND matrix IS NULL;

-- ── 1. Гарантировать существование секций marketing/knowledge на системных
--       ролях и их override'ах (двухуровневый jsonb_set в отсутствующую секцию —
--       no-op, поэтому сперва создаём саму секцию как {} если её нет).
DO $$
DECLARE
  section text;
BEGIN
  FOREACH section IN ARRAY ARRAY['marketing', 'knowledge']
  LOOP
    EXECUTE format(
      'UPDATE roles SET matrix = jsonb_set(matrix, %L::text[], COALESCE(matrix -> %L, ''{}''::jsonb), true)
        WHERE system_key IN (''master'', ''admin'', ''director'') AND matrix -> %L IS NULL',
      '{' || section || '}', section, section);
  END LOOP;
END $$;

-- ── 2. «Мастер» — marketing.manage = false; knowledge.view = true.
--       (marketing мастеру недоступен → manage false; базу знаний мастер ВИДИТ
--       сегодня → knowledge.view true; knowledge.manage не трогаем — остаётся
--       false из 136.)
UPDATE roles SET matrix = jsonb_set(matrix, '{marketing,manage}', 'false'::jsonb, true)
 WHERE system_key = 'master' AND matrix #> '{marketing,manage}' IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{knowledge,view}', 'true'::jsonb, true)
 WHERE system_key = 'master' AND matrix #> '{knowledge,view}' IS NULL;

-- ── 3. «Администратор» — marketing.manage = true; knowledge.view = true.
UPDATE roles SET matrix = jsonb_set(matrix, '{marketing,manage}', 'true'::jsonb, true)
 WHERE system_key = 'admin' AND matrix #> '{marketing,manage}' IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{knowledge,view}', 'true'::jsonb, true)
 WHERE system_key = 'admin' AND matrix #> '{knowledge,view}' IS NULL;

-- ── 4. «Директор» — marketing.manage = true; knowledge.view = true (owner-class
--       обходит гейты по строковой роли; матрица декоративна, но редактор её
--       показывает — держим полной).
UPDATE roles SET matrix = jsonb_set(matrix, '{marketing,manage}', 'true'::jsonb, true)
 WHERE system_key = 'director' AND matrix #> '{marketing,manage}' IS NULL;
UPDATE roles SET matrix = jsonb_set(matrix, '{knowledge,view}', 'true'::jsonb, true)
 WHERE system_key = 'director' AND matrix #> '{knowledge,view}' IS NULL;
