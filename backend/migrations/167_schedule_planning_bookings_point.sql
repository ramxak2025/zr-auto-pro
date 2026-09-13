-- 167_schedule_planning_bookings_point.sql
-- ============================================================================
-- ФИЛИАЛ У ГРАФИКА, У ПЛАНА ПОСТОЯННЫХ РАСХОДОВ И У ЗАПИСЕЙ КЛИЕНТОВ.
--
-- ЖАЛОБА ВЛАДЕЛЬЦА (2026-09-13, дословно): «когда переключаюсь между
-- филиалами почему-то данные с основной точки там! а это отдельные
-- автосервисы!!! почему расписание с другого филиала там или постоянные
-- расходы и так далее».
--
-- ЧТО БЫЛО НЕ ТАК. Волна 161 дала филиал ДЕНЕЖНЫМ строкам (чеки, расходы,
-- смены, зарплата, касса), а три раздела оставила без него, выразив филиал
-- «составом команды» — назначениями сотрудников (user_points):
--   • ГРАФИК (schedule_entries): строка дня филиала не имела, сетка филиала =
--     сетка сотрудников, назначенных на филиал. Но по безопасному дефолту 156
--     сотрудник БЕЗ назначений виден ВЕЗДЕ — и у тенанта, который людей по
--     филиалам ещё не расставил (а это ровно ситуация владельца), график
--     обоих автосервисов был ОДНИМ И ТЕМ ЖЕ. Отметка «пришёл», поставленная в
--     филиале, появлялась и в основном сервисе. Для владельца это выглядит как
--     «расписание с другого филиала».
--   • ПЛАН ПОСТОЯННЫХ РАСХОДОВ (fixed_costs — экран «Постоянные расходы»):
--     конфиг тенанта, один на всю сеть. Аренда филиала вычиталась из прибыли
--     основного сервиса, и наоборот; на экране филиала лежал план основного.
--   • ЗАПИСИ (bookings): филиал резолвился через назначения мастера, запись
--     без мастера была видна везде. Тот же дефект, что у графика.
--
-- РЕШЕНИЕ — то же, что у денег: у строки есть СВОЙ point_id, он штампуется
-- ФИЛИАЛОМ СЕССИИ (163) в момент записи и режется СТРОГИМ равенством
-- (common/point-scope.pointFilterSql). Состав команды (user_points) остаётся
-- для того, для чего он и был: кто виден в сетке и в пикерах. Но ЧЕЙ ДЕНЬ,
-- ЧЕЙ ПЛАН и ЧЬЯ ЗАПИСЬ — говорит сама строка.
--
-- ПРИВЯЗКА ИСТОРИИ. Строки без филиала у тенанта С филиалами невидимы ни в
-- одном филиале (строгое равенство), поэтому история разбирается здесь же —
-- по той же лестнице, что 160/161: у тенантов без живых точек не трогается
-- ничего (одноточечный автосервис — поведение байт-в-байт прежнее).
--   • schedule_entries — по ЖИВОМУ назначению сотрудника, если оно ровно
--     одно (мастер филиала → его дни уходят в его филиал), иначе — основному
--     сервису (правило 160: история старше филиалов принадлежит ему);
--   • bookings — проведённая запись наследует филиал СВОЕГО ЧЕКА (это и есть
--     место, где обслужили); иначе живое назначение мастера; иначе основной;
--   • fixed_costs — основному сервису: до этой миграции план был один на
--     тенант и заводился владельцем из основного сервиса.
-- Та же лестница продублирована в PointsService.HISTORY_ATTACH_SQL для
-- тенантов, которым ПЕРВЫЙ филиал заведут ПОСЛЕ прогона этой миграции.
--
-- ПОПУТНО: смена, которую открывает отметка «пришёл» в графике
-- (ScheduleService.ensureShiftOpen), теперь берёт филиал У СТРОКИ ГРАФИКА, а
-- не вычисляет его агрегатом по назначениям. Прежний расчёт использовал
-- MIN(uuid), которого в PostgreSQL 16 не существует, — каждая отметка
-- «пришёл/опоздал» падала с 500, и клиент откатывал её. Функция ниже нужна
-- ТОЛЬКО привязке истории и намеренно обходится без min/max по uuid.
--
-- ИДЕМПОТЕНТНО: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, UPDATE только по `point_id IS NULL`. Повторный
-- прогон сходится к тому же состоянию. Файл не редактируется после применения.
-- ============================================================================

-- ── 0. Единственное ЖИВОЕ назначение сотрудника ─────────────────────────────
-- Возвращает филиал, если сотрудник назначен РОВНО на один живой филиал;
-- иначе NULL (нет назначений / несколько / только на закрытые). Для истории
-- графика и записей это самый сильный свидетель: мастер филиала «ТопГаз»
-- работал в «ТопГазе».
--
-- array_agg вместо min/max: агрегатов min/max для uuid в PostgreSQL 16 нет.
-- HAVING без GROUP BY — одна группа: при count <> 1 строк нет, и скалярный
-- подзапрос отдаёт NULL, что и нужно COALESCE ниже.
CREATE OR REPLACE FUNCTION autexa_point_by_live_assignment(
    p_tenant uuid,
    p_user   uuid
) RETURNS uuid
LANGUAGE sql STABLE AS $autexa$
  SELECT (array_agg(x.point_id))[1]
    FROM (
      SELECT DISTINCT up.point_id
        FROM user_points up
        JOIN tenant_points p ON p.id = up.point_id AND p.tenant_id = up.tenant_id
       WHERE up.tenant_id = p_tenant
         AND up.user_id   = p_user
         AND p.is_active
    ) x
  HAVING count(*) = 1
$autexa$;

-- ── 1. Колонки ──────────────────────────────────────────────────────────────
-- ON DELETE SET NULL, как у всех point_id волны 161: физическое удаление точки
-- в API не существует (только архив), но если строку tenant_points удалить
-- руками, история не должна пропасть вместе с ней.
ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE fixed_costs      ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE bookings         ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;

COMMENT ON COLUMN schedule_entries.point_id IS
  'Филиал дня графика (167). Штампуется филиалом сессии; NULL только у тенантов без филиалов.';
COMMENT ON COLUMN fixed_costs.point_id IS
  'Филиал плановой постоянки (167). План — на каждый автосервис свой; NULL только у тенантов без филиалов.';
COMMENT ON COLUMN bookings.point_id IS
  'Филиал записи клиента (167). Штампуется филиалом сессии; NULL только у тенантов без филиалов.';

-- ── 2. Привязка истории (только тенанты с живой основной точкой) ────────────
-- Основная точка гарантирована 160/162 у любого тенанта с живыми точками.
-- >>> ATTRIBUTION-BLOCK-167
UPDATE schedule_entries se
   SET point_id = COALESCE(
         autexa_point_by_live_assignment(se.tenant_id, se.user_id),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE se.point_id IS NULL
   AND se.tenant_id = mp.tenant_id;

UPDATE bookings b
   SET point_id = COALESCE(
         (SELECT ch.point_id FROM checks ch
           WHERE ch.id = b.check_id AND ch.tenant_id = b.tenant_id AND ch.point_id IS NOT NULL),
         autexa_point_by_live_assignment(b.tenant_id, b.master_id),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE b.point_id IS NULL
   AND b.tenant_id = mp.tenant_id;

UPDATE fixed_costs fc
   SET point_id = mp.main_id
  FROM (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE fc.point_id IS NULL
   AND fc.tenant_id = mp.tenant_id;
-- <<< ATTRIBUTION-BLOCK-167

-- ── 3. Индексы под филиальные срезы ─────────────────────────────────────────
-- Сетка месяца: WHERE tenant_id = $1 AND date BETWEEN $2 AND $3 AND point_id = $4.
CREATE INDEX IF NOT EXISTS idx_schedule_entries_tenant_point_date
  ON schedule_entries (tenant_id, point_id, date);
-- Список записей: WHERE tenant_id = $1 AND point_id = $n ORDER BY scheduled_at.
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_point_scheduled
  ON bookings (tenant_id, point_id, scheduled_at);
-- План филиала: WHERE tenant_id = $1 AND point_id = $2 (десятки строк — индекс
-- скорее документирует ключ доступа, чем ускоряет).
CREATE INDEX IF NOT EXISTS idx_fixed_costs_tenant_point
  ON fixed_costs (tenant_id, point_id);
