-- 162_points_main_repair.sql
-- ============================================================================
-- РЕМОНТ БАЗЫ, НА КОТОРОЙ 160/161 УСПЕЛИ ПРОГНАТЬСЯ В СТАРОЙ РЕДАКЦИИ.
--
-- ЧТО БЫЛО СЛОМАНО. Первая редакция 160 и 161 привязывала всю историю тенанта
-- (чеки, клиентов, смены, расходы, кассовые смены, зарплатные строки) к
-- «ПЕРВОЙ ЖИВОЙ ТОЧКЕ» по порядку sort_order → created_at → id. Понятия
-- основного сервиса в модели не было вовсе.
--
-- ПОЧЕМУ ЭТО КАТАСТРОФА. Владелец годами работал как ZR AUTO, потом открыл
-- второй автосервис ТопГаз — и суперадмин завёл в системе ОДНУ точку,
-- «ТопГаз». «Первая живая точка» в такой базе — ТопГаз, и вся многолетняя
-- история ZR AUTO оказывается помечена филиалом, открытым в прошлом месяце.
-- Обратно различить нечем: до миграции у всех строк точка пустая, признака
-- «чьё это» не существует — деньги, клиенты и зарплата двух РАЗНЫХ
-- автосервисов схлопываются в один необратимо.
--
-- ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Сами 160 и 161 исправлены на месте (ветка не
-- смержена и не запушена, деплоя не было), но MigrationRunner отмечает файл в
-- `_migrations` по ИМЕНИ и повторно его не выполняет. На локальной или
-- тестовой базе, где backend уже стартовал со старой редакцией, новая никогда
-- не отработает — чинить приходится следующим номером.
--
-- ПРИНЦИП РЕМОНТА — единственный надёжный: СТРОКА, СОЗДАННАЯ РАНЬШЕ, ЧЕМ
-- ПОЯВИЛАСЬ САМА ТОЧКА, НЕ МОЖЕТ ЕЙ ПРИНАДЛЕЖАТЬ. Такие строки переносим на
-- ОСНОВНОЙ сервис (tenant_points.is_main). Ничего другого доказать нельзя, и
-- ничего другого мы не трогаем.
--
-- ВТОРАЯ ПОЛОВИНА ФАЙЛА — «ОСИРОТЕВШАЯ» ИСТОРИЯ (блок 3). Она разбирается ТОЙ
-- ЖЕ лестницей доказательств, что и в 161 (блок ATTRIBUTION-BLOCK там —
-- дословная копия этого). Обе миграции обязаны приводить базу к ОДНОМУ
-- состоянию, в каком бы порядке они ни достались конкретной базе; расхождение
-- означало бы, что распределение денег зависит от истории деплоя.
--
-- ЧЕГО РЕМОНТ СОЗНАТЕЛЬНО НЕ ДЕЛАЕТ (лучше не починить сомнительный случай,
-- чем испортить хороший):
--   • НЕ трогает строки, созданные ПОЗЖЕ своей точки. Между заведением точки
--     и прогоном миграции у строк всё ещё был point_id IS NULL, поэтому среди
--     них физически перемешаны работы обоих автосервисов — отличить их нечем,
--     и любое автоматическое решение было бы выдуманным. Они остаются там,
--     куда их привязала старая редакция.
--   • НЕ трогает строки без даты создания (created_at IS NULL у части легаси-
--     строк): доказательства «раньше точки» нет — значит, нет и переноса.
--   • НЕ переносит строки МЕЖДУ филиалами и НЕ снимает строки с основной
--     точки: единственное направление переноса — «филиал → основной сервис».
--   • НЕ трогает тенантов без живых точек: у них скоуп филиала не включён и
--     основного пункта списка быть не должно (иначе мульти-точечный режим
--     включился бы сам собой, без просьбы владельца).
--   • НЕ трогает safe_transactions и cash_collections — у них точки нет и по
--     решению владельца не будет (обоснование в шапке 161).
--   • НЕ трогает users.current_point_id: ремонт ни одной точки не удаляет и не
--     архивирует, поэтому выбранная сотрудником точка остаётся живой строкой.
--
-- ИДЕМПОТЕНТНОСТЬ. Схема — ADD COLUMN / CREATE INDEX IF NOT EXISTS, функции —
-- CREATE OR REPLACE. Основная точка помечается/создаётся только при её
-- отсутствии (NOT EXISTS). Разбор «осиротевшей» истории адресует только
-- point_id IS NULL. Ремонтные UPDATE'ы исключают саму основную точку
-- (p.is_main = false), поэтому уже перенесённые строки во второй прогон не
-- попадают ни при каких обстоятельствах.
-- ============================================================================

-- ── 1. Схема основного сервиса (повтор 160 — на случай, если 160 применилась
--       в старой редакции, где колонки и индекса ещё не было) ────────────────

ALTER TABLE tenant_points ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_points_one_main
    ON tenant_points (tenant_id) WHERE is_main;

-- ── 2. Основной сервис обязан существовать у каждого тенанта с живыми точками
-- Дословно те же два шага, что в 160: сначала пытаемся ПОМЕТИТЬ уже
-- заведённую живую точку с именем компании (дубль «ZR AUTO» рядом с «ZR AUTO»
-- владельцу не объяснить), и только если такой нет — заводим основную из
-- tenants.name.

UPDATE tenant_points tp
   SET is_main = true
  FROM (
        SELECT DISTINCT ON (p.tenant_id) p.tenant_id, p.id
          FROM tenant_points p
          JOIN tenants t ON t.id = p.tenant_id
         WHERE p.is_active
           AND lower(btrim(p.name)) = lower(COALESCE(NULLIF(btrim(t.name), ''), 'Основной'))
           AND NOT EXISTS (SELECT 1 FROM tenant_points m WHERE m.tenant_id = p.tenant_id AND m.is_main)
         ORDER BY p.tenant_id, p.sort_order ASC, p.created_at ASC, p.id ASC
       ) pick
 WHERE tp.id = pick.id;

INSERT INTO tenant_points (tenant_id, name, address, sort_order, is_active, is_main)
SELECT t.id,
       COALESCE(NULLIF(btrim(t.name), ''), 'Основной'),
       NULL,
       COALESCE((SELECT MIN(p2.sort_order) FROM tenant_points p2 WHERE p2.tenant_id = t.id), 1) - 1,
       true,
       true
  FROM tenants t
 WHERE EXISTS (SELECT 1 FROM tenant_points p WHERE p.tenant_id = t.id AND p.is_active)
   AND NOT EXISTS (SELECT 1 FROM tenant_points m WHERE m.tenant_id = t.id AND m.is_main);

-- ── 3. «Осиротевшая» история → её филиал ────────────────────────────────────
-- Спасение для базы, где 160 применилась в старой редакции, а 161 упала на
-- полпути (MigrationRunner в этом случае прерывает старт и НЕ отмечает файл):
-- при следующем деплое 161 идёт уже в новой редакции, основной точки ещё нет,
-- и семь таблиц остаются с point_id IS NULL — то есть невидимыми в любом
-- филиальном срезе. Здесь основная точка уже гарантированно есть.
-- Для нормально прошедшей базы блок — no-op.
--
-- ЧЕКИ И КЛИЕНТЫ — БЕЗ ЛЕСТНИЦЫ. Их point_id завела ещё 156, задолго до этой
-- волны: филиальная строка там УЖЕ помечена филиалом, поэтому оставшийся NULL
-- честно означает «строка старше филиалов» и принадлежит основному сервису.
-- Это дословно правило 160.

UPDATE checks ch
   SET point_id = mp.point_id
  FROM (SELECT tp.tenant_id, tp.id AS point_id FROM tenant_points tp WHERE tp.is_main AND tp.is_active) mp
 WHERE ch.point_id IS NULL AND ch.tenant_id = mp.tenant_id;

UPDATE clients cl
   SET point_id = mp.point_id
  FROM (SELECT tp.tenant_id, tp.id AS point_id FROM tenant_points tp WHERE tp.is_main AND tp.is_active) mp
 WHERE cl.point_id IS NULL AND cl.tenant_id = mp.tenant_id;

-- СЕМЬ ДЕНЕЖНЫХ ТАБЛИЦ — ТОЛЬКО ПО ДОКАЗАТЕЛЬСТВУ. У них колонку заводит 161,
-- поэтому NULL там стоит и у филиальных строк тоже; правило «NULL → основной»
-- увело бы августовскую кассу филиала на счёт основного сервиса. Блок ниже —
-- ДОСЛОВНАЯ копия блока из 161: обе миграции обязаны приводить базу к ОДНОМУ
-- состоянию, в каком бы порядке они ни достались конкретной базе.

-- >>> ATTRIBUTION-BLOCK ─ ДОСЛОВНАЯ КОПИЯ В 161 И 162 ────────────────────────
-- Этот блок ОБЯЗАН быть побайтово одинаковым в 161_points_scoping_modules.sql
-- и 162_points_main_repair.sql. Разъехавшиеся копии = один и тот же тенант
-- приходит к РАЗНОМУ распределению денег в зависимости от того, какая из
-- миграций досталась его базе первой. Сверку делает тест
-- backend/test/points-history-attribution.test.cjs.
--
-- ЗАЧЕМ ВООБЩЕ ДОКАЗАТЕЛЬНАЯ АТРИБУЦИЯ, А НЕ «ВСЁ ОСНОВНОМУ».
-- У чеков и клиентов (160) point_id завела ещё миграция 156: к моменту 160
-- филиальные чеки УЖЕ помечены своим филиалом, и NULL там честно означает
-- «строка старше филиалов» — её и забирает основной сервис.
--
-- У семи денежных таблиц этой волны всё наоборот: колонка point_id заводится
-- ЗДЕСЬ ЖЕ, поэтому NULL в них не значит «строка старше филиалов». NULL там
-- стоит у ВСЕХ строк без исключения — и у доисторических, и у вчерашних
-- кассовых смен филиала. Слепое «NULL → основной сервис» отправило бы
-- августовскую кассу, расходы и зарплату ТопГаза на счёт ZR AUTO — ту же
-- катастрофу, что мы чинили в обратную сторону, просто зеркально.
--
-- ПРИНЦИП: атрибутируем ПО ДОКАЗАТЕЛЬСТВУ, а не по умолчанию. Лестница
-- одинакова у всех семи таблиц и читается сверху вниз (COALESCE берёт первое
-- не-NULL):
--
--   1. ВРЕМЕННОЕ ДОКАЗАТЕЛЬСТВО. Строка родилась раньше, чем появился первый
--      филиал тенанта, — принадлежать филиалу она не может физически.
--      Тенант, у которого филиалов нет вовсе (branch_since IS NULL), целиком
--      закрывается этой же ветвью: одна проверка — и ни одного лишнего
--      подзапроса на всю его историю.
--   2. СВЯЗАННАЯ ОПЕРАЦИЯ. Строка, у которой есть прямая ссылка на уже
--      атрибутированную запись, наследует её филиал (расход ← зарплатная
--      выплата через expense_id).
--   3. СЛЕД В ЧЕКАХ. Чеки — единственные строки, у которых филиал проставлен
--      сервером В МОМЕНТ СОЗДАНИЯ, то есть это не догадка, а факт. Если все
--      чеки нужного окна (день смены / окно кассовой смены / месяц начисления
--      сотрудника) указывают на ОДНУ точку — работа шла там.
--   4. НАЗНАЧЕНИЕ СОТРУДНИКА. Человек приписан ровно к одному филиалу
--      (user_points) — его смены, расходы и зарплатные строки об этом филиале.
--   5. ОСНОВНОЙ СЕРВИС — честный дефолт, когда доказательств нет.
--
-- ЧТО ОСТАЁТСЯ НЕТОЧНЫМ (пишем прямо, чтобы следующий агент не «дочинил»):
--   • строка, родившаяся ПОСЛЕ открытия филиала, без единого чека в окне и без
--     назначений у автора, уходит основному сервису. Пример: владелец сидит в
--     режиме «Все точки», заводит расход «аренда» и нигде не отмечен как
--     сотрудник филиала — про этот расход в базе не написано ничего, кроме
--     суммы. Отдать его основному сервису — не «правильно», а наименее вредно:
--      основной сервис владелец видит и может перенести расход руками, а любая
--      выдумка молча вписала бы деньги в чужой автосервис.
--   • строка без даты создания (created_at у части легаси-таблиц nullable)
--     теряет ступень 1. Такие строки заведомо старые, и ступень 5 отдаёт их
--     основному сервису — то есть ровно туда, куда отдала бы ступень 1.
--   • сотрудник, назначенный на ДВА филиала, ступень 4 не проходит: угадывать,
--     в каком из них он получил премию, нельзя.
--   • «след» списания со склада (stock_movements.linked_expense_id) и покупки
--     имущества (expenses.storage_item_id) собственной точки НЕ добавляет:
--     склад и имущество общие на всю сеть (решение владельца, см. шапку 161).
--     Единственное, что этот след даёт, — автора операции, а он и так лежит в
--     самой строке расхода (user_id / created_by) и работает ступенью 4.

-- ── Свидетели: три функции, общие для 161, 162 и PointsService ──────────────
-- ПОЧЕМУ ФУНКЦИИ, А НЕ ПОВТОРЁННЫЕ ПОДЗАПРОСЫ. Одну и ту же лестницу
-- применяют три места: миграция 161, ремонтная 162 и PointsService (когда
-- суперадмин заводит или разархивирует точку тенанту, которого миграции
-- прошли мимо). Три копии сложного подзапроса разъехались бы на первой же
-- правке, а разъехавшаяся атрибуция — это деньги двух автосервисов в одной
-- куче. CREATE OR REPLACE идемпотентен, повторный прогон — no-op.
--
-- STABLE, а не VOLATILE: функции только читают. SECURITY INVOKER (дефолт) —
-- под RLS они видят ровно то же, что и вызывающий, никакого обхода политик.

-- Единственный филиал, к которому приписан сотрудник (user_points).
-- NULL, если назначений нет вовсе или их больше одного.
--
-- p_born — момент рождения атрибутируемой строки: ФИЛИАЛЫ, заведённые ПОЗЖЕ
-- неё, кандидатами быть не могут. Без этого отсечения 161 могла бы приписать
-- июльскую смену филиалу, открытому в августе, — а ремонтная 162 тут же
-- утащила бы её обратно на основной сервис, и две миграции давали бы РАЗНОЕ
-- состояние одной и той же базы.
--
-- ОСНОВНОЙ СЕРВИС ИЗ ЭТОГО ОТСЕЧЕНИЯ ВЫВЕДЕН (p.is_main OR …). Его строка в
-- tenant_points могла родиться минуту назад — её заводит блок 0 этой же
-- миграции, — но сам автосервис существует со дня основания компании, это и
-- есть тенант. Без исключения основной сервис оказался бы «моложе» ЛЮБОЙ
-- исторической строки и выпал бы из кандидатов: июльская выплата мастеру,
-- приписанному к августовскому филиалу, ушла бы в этот филиал — ровно та
-- ошибка, которую весь блок и предотвращает.
--
-- is_active здесь СОЗНАТЕЛЬНО не проверяется. Сотрудник, приписанный только к
-- заархивированному филиалу, работал именно там; отдать его строки основному
-- сервису значило бы подмешать деньги закрытого автосервиса к живому. В
-- сетевом срезе («Все точки») такая строка видна как и раньше — фильтра там
-- нет вовсе, — а разархивация филиала возвращает её и в филиальный срез.
CREATE OR REPLACE FUNCTION autexa_point_by_assignment(
    p_tenant uuid,
    p_user   uuid,
    p_born   timestamptz
) RETURNS uuid
LANGUAGE sql STABLE AS $autexa$
  SELECT max(x.point_id::text)::uuid
    FROM (
      SELECT DISTINCT up.point_id
        FROM user_points up
        JOIN tenant_points p ON p.id = up.point_id
       WHERE up.tenant_id = p_tenant
         AND up.user_id   = p_user
         AND (p.is_main OR p_born IS NULL OR p.created_at <= p_born)
    ) x
  HAVING count(*) = 1
$autexa$;

-- Единственная точка чеков в окне [p_from, p_to). p_master = NULL — «чьи
-- угодно чеки» (так атрибутируется кассовая смена: в её окне работает весь
-- филиал, а не один мастер).
--
-- ПОЧЕМУ ЧЕКИ — ЛУЧШИЙ СВИДЕТЕЛЬ: их point_id проставлен сервером в момент
-- пробития (156), это не восстановленная задним числом догадка. Удалённые
-- чеки исключены (deleted_at) — от них отказались явно; отложенные оставлены:
-- денег они ещё не принесли, но место работы показывают не хуже прочих.
--
-- Окно ПОЛУОТКРЫТОЕ: чек ровно на верхней границе — событие нулевой меры, а
-- полуоткрытый интервал избавляет от «минус одна микросекунда» в каждом
-- вызове.
CREATE OR REPLACE FUNCTION autexa_point_by_checks(
    p_tenant uuid,
    p_master uuid,
    p_from   timestamptz,
    p_to     timestamptz,
    p_born   timestamptz
) RETURNS uuid
LANGUAGE sql STABLE AS $autexa$
  SELECT max(x.point_id::text)::uuid
    FROM (
      SELECT DISTINCT c.point_id
        FROM checks c
        JOIN tenant_points p ON p.id = c.point_id
       WHERE c.tenant_id  = p_tenant
         AND c.deleted_at IS NULL
         AND (p_master IS NULL OR c.master_id = p_master)
         AND c.date >= p_from
         AND c.date <  p_to
         AND (p.is_main OR p_born IS NULL OR p.created_at <= p_born)
    ) x
  HAVING count(*) = 1
$autexa$;

-- То же по КАЛЕНДАРНОМУ МЕСЯЦУ начисления ('YYYY-MM' в поясе тенанта) — форма,
-- в которой зарплата хранит период (149: COALESCE(period_month, месяц даты
-- факта)). Кривой период (period_month_year в 048 — TEXT без CHECK) не роняет
-- миграцию: не совпал с шаблоном — свидетель просто молчит.
CREATE OR REPLACE FUNCTION autexa_point_by_month(
    p_tenant uuid,
    p_user   uuid,
    p_month  text,
    p_tz     text,
    p_born   timestamptz
) RETURNS uuid
LANGUAGE sql STABLE AS $autexa$
  SELECT autexa_point_by_checks(
           p_tenant,
           p_user,
            to_date(p_month, 'YYYY-MM')::timestamp                      AT TIME ZONE p_tz,
           (to_date(p_month, 'YYYY-MM') + interval '1 month')::timestamp AT TIME ZONE p_tz,
           p_born)
   WHERE p_month ~ '^\d{4}-\d{2}$'
     AND p_tz IS NOT NULL
$autexa$;

-- ── Лестница по семи таблицам ──────────────────────────────────────────────
-- Подзапрос mp — факты тенанта, одна строка на тенанта:
--   main_id      — основной сервис (uq_tenant_points_one_main гарантирует, что
--                  он ровно один, поэтому JOIN не размножает строки);
--   tz           — пояс тенанта (157), в нём считаются календарные месяцы.
--                  Сверяется с pg_timezone_names, а не берётся как есть:
--                  у tenants.timezone нет CHECK'а (157 объясняет почему), а
--                  `AT TIME ZONE 'мусор'` — это 22023, то есть упавшая
--                  миграция и вечный краш-луп backend'а на старте. Значение
--                  вне базы поясов молча читается как Москва — ровно то же
--                  умолчание, что и в колонке;
--   branch_since — когда у тенанта появился ПЕРВЫЙ филиал (архивные тоже
--                  считаются: закрытый филиал когда-то существовал).
--                  NULL = филиалов не было никогда → вся история основному.
--
-- ИДЕМПОТЕНТНОСТЬ: каждый UPDATE адресует ТОЛЬКО `point_id IS NULL`. Повторный
-- прогон не двигает ни одной уже привязанной строки — ни на второй раз, ни при
-- гонке с PointsService.
--
-- ПОРЯДОК ВАЖЕН: expenses идёт ПОСЛЕДНИМ, потому что расход зарплаты
-- наследует филиал своей выплаты (ступень 2), а выплаты атрибутируются выше.

-- Рабочая смена сотрудника: где человек отработал этот день.
UPDATE shifts s
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL
                OR COALESCE(s.created_at, s.opened_at) < mp.branch_since
              THEN mp.main_id END,
         autexa_point_by_checks(s.tenant_id, s.user_id,
                                 s.date::timestamp      AT TIME ZONE mp.tz,
                                (s.date + 1)::timestamp AT TIME ZONE mp.tz,
                                COALESCE(s.created_at, s.opened_at)),
         autexa_point_by_assignment(s.tenant_id, s.user_id, COALESCE(s.created_at, s.opened_at)),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE s.point_id IS NULL
   AND s.tenant_id = mp.tenant_id;

-- Кассовая смена: филиал определяют чеки её собственного окна — ровно те, по
-- которым сходится её Z-отчёт (cash-shifts.computeFigures читает checks.date
-- между opened_at и закрытием). Открытая смена считается до «сейчас».
UPDATE cash_shifts cs
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL
                OR COALESCE(cs.created_at, cs.opened_at) < mp.branch_since
              THEN mp.main_id END,
         autexa_point_by_checks(cs.tenant_id, NULL::uuid,
                                cs.opened_at, COALESCE(cs.closed_at, now()),
                                COALESCE(cs.created_at, cs.opened_at)),
         autexa_point_by_assignment(cs.tenant_id, cs.opened_by, COALESCE(cs.created_at, cs.opened_at)),
         autexa_point_by_assignment(cs.tenant_id, cs.closed_by, COALESCE(cs.created_at, cs.opened_at)),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE cs.point_id IS NULL
   AND cs.tenant_id = mp.tenant_id;

-- Выплата зарплаты: филиал берётся у чеков, из которых сложилось начисление за
-- ТОТ ЖЕ месяц (149: период выплаты — period_month, иначе месяц created_at).
UPDATE salary_payouts sp
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL OR sp.created_at < mp.branch_since THEN mp.main_id END,
         autexa_point_by_month(sp.tenant_id, sp.employee_id,
                               COALESCE(CASE WHEN sp.period_month ~ '^\d{4}-\d{2}$' THEN sp.period_month END,
                                        to_char(sp.created_at AT TIME ZONE mp.tz, 'YYYY-MM')),
                               mp.tz, sp.created_at),
         autexa_point_by_assignment(sp.tenant_id, sp.employee_id, sp.created_at),
         autexa_point_by_assignment(sp.tenant_id, sp.created_by,  sp.created_at),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE sp.point_id IS NULL
   AND sp.tenant_id = mp.tenant_id;

-- Премия: тот же месяц начисления (048 — period_month_year, иначе месяц
-- created_at), тот же порядок свидетелей; автор премии — последняя ступень.
UPDATE salary_premiums pr
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL OR pr.created_at < mp.branch_since THEN mp.main_id END,
         autexa_point_by_month(pr.tenant_id, pr.user_id,
                               COALESCE(CASE WHEN pr.period_month_year ~ '^\d{4}-\d{2}$' THEN pr.period_month_year END,
                                        to_char(pr.created_at AT TIME ZONE mp.tz, 'YYYY-MM')),
                               mp.tz, pr.created_at),
         autexa_point_by_assignment(pr.tenant_id, pr.user_id,    pr.created_at),
         autexa_point_by_assignment(pr.tenant_id, pr.awarded_by, pr.created_at),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE pr.point_id IS NULL
   AND pr.tenant_id = mp.tenant_id;

-- Штраф: собственного периода у него нет, поэтому месяцем начисления считаем
-- месяц даты штрафа (fallback — created_at).
UPDATE salary_penalties pe
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL OR pe.created_at < mp.branch_since THEN mp.main_id END,
         autexa_point_by_month(pe.tenant_id, pe.user_id,
                               to_char(COALESCE(pe.date, pe.created_at) AT TIME ZONE mp.tz, 'YYYY-MM'),
                               mp.tz, pe.created_at),
         autexa_point_by_assignment(pe.tenant_id, pe.user_id,    pe.created_at),
         autexa_point_by_assignment(pe.tenant_id, pe.created_by, pe.created_at),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE pe.point_id IS NULL
   AND pe.tenant_id = mp.tenant_id;

-- Легаси-выплата (012): период лежит в month_year, дата факта — в date.
UPDATE salary_payments spm
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL OR spm.created_at < mp.branch_since THEN mp.main_id END,
         autexa_point_by_month(spm.tenant_id, spm.user_id,
                               COALESCE(CASE WHEN spm.month_year ~ '^\d{4}-\d{2}$' THEN spm.month_year END,
                                        to_char(spm.date AT TIME ZONE mp.tz, 'YYYY-MM')),
                               mp.tz, spm.created_at),
         autexa_point_by_assignment(spm.tenant_id, spm.user_id,    spm.created_at),
         autexa_point_by_assignment(spm.tenant_id, spm.created_by, spm.created_at),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE spm.point_id IS NULL
   AND spm.tenant_id = mp.tenant_id;

-- Расход — ПОСЛЕДНИМ: зарплатный расход наследует филиал своей выплаты
-- (salary_payouts.expense_id / salary_payments.expense_id — 100 и 153), а обе
-- таблицы выплат атрибутированы выше.
UPDATE expenses e
   SET point_id = COALESCE(
         CASE WHEN mp.branch_since IS NULL OR e.created_at < mp.branch_since THEN mp.main_id END,
         (SELECT po.point_id FROM salary_payouts po
           WHERE po.expense_id = e.id AND po.tenant_id = e.tenant_id AND po.point_id IS NOT NULL LIMIT 1),
         (SELECT pm.point_id FROM salary_payments pm
           WHERE pm.expense_id = e.id AND pm.tenant_id = e.tenant_id AND pm.point_id IS NOT NULL LIMIT 1),
         autexa_point_by_assignment(e.tenant_id, e.user_id,    e.created_at),
         autexa_point_by_assignment(e.tenant_id, e.created_by, e.created_at),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE e.point_id IS NULL
   AND e.tenant_id = mp.tenant_id;
-- <<< ATTRIBUTION-BLOCK ─ конец дословной копии ─────────────────────────────

-- ── 4. РЕМОНТ: строка старше своей точки → основной сервис ──────────────────
-- Форма у всех девяти UPDATE'ов одна:
--   p — филиал, к которому строка приписана сейчас (обязательно НЕ основной);
--   m — основной сервис того же тенанта (уникальный индекс из шага 1
--       гарантирует, что он ровно один, поэтому JOIN не размножает строки);
--   условие «дата создания строки СТРОГО меньше даты создания точки» — то
--   самое единственное доказательство, что строка филиалу принадлежать не
--   может.
--
-- m.is_active — страховка: переносить деньги в архивную точку нельзя, она не
-- входит ни в один живой срез, и результат был бы неотличим от их пропажи.
--
-- Дата создания берётся из created_at везде, КРОМЕ cash_shifts: у кассовой
-- смены роль «когда строка появилась» играет opened_at — он NOT NULL с самой
-- 080, тогда как created_at у давно существовавшей таблицы мог не добраться
-- (в 080 он есть только в CREATE TABLE, среди безопасных доборов колонок его
-- нет). Брать заведомо существующую колонку надёжнее, чем уронить старт.

UPDATE checks ch
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE ch.point_id = p.id
   AND ch.tenant_id = p.tenant_id
   AND p.is_main = false
   AND ch.created_at IS NOT NULL
   AND ch.created_at < p.created_at;

UPDATE clients cl
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE cl.point_id = p.id
   AND cl.tenant_id = p.tenant_id
   AND p.is_main = false
   AND cl.created_at IS NOT NULL
   AND cl.created_at < p.created_at;

UPDATE shifts s
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE s.point_id = p.id
   AND s.tenant_id = p.tenant_id
   AND p.is_main = false
   AND s.created_at IS NOT NULL
   AND s.created_at < p.created_at;

UPDATE expenses e
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE e.point_id = p.id
   AND e.tenant_id = p.tenant_id
   AND p.is_main = false
   AND e.created_at IS NOT NULL
   AND e.created_at < p.created_at;

UPDATE cash_shifts cs
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE cs.point_id = p.id
   AND cs.tenant_id = p.tenant_id
   AND p.is_main = false
   AND cs.opened_at IS NOT NULL
   AND cs.opened_at < p.created_at;

UPDATE salary_payouts sp
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE sp.point_id = p.id
   AND sp.tenant_id = p.tenant_id
   AND p.is_main = false
   AND sp.created_at IS NOT NULL
   AND sp.created_at < p.created_at;

UPDATE salary_premiums pr
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE pr.point_id = p.id
   AND pr.tenant_id = p.tenant_id
   AND p.is_main = false
   AND pr.created_at IS NOT NULL
   AND pr.created_at < p.created_at;

UPDATE salary_penalties pe
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE pe.point_id = p.id
   AND pe.tenant_id = p.tenant_id
   AND p.is_main = false
   AND pe.created_at IS NOT NULL
   AND pe.created_at < p.created_at;

UPDATE salary_payments spm
   SET point_id = m.id
  FROM tenant_points p
  JOIN tenant_points m ON m.tenant_id = p.tenant_id AND m.is_main AND m.is_active
 WHERE spm.point_id = p.id
   AND spm.tenant_id = p.tenant_id
   AND p.is_main = false
   AND spm.created_at IS NOT NULL
   AND spm.created_at < p.created_at;
