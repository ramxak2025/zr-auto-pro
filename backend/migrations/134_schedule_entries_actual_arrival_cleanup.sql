-- 134_schedule_entries_actual_arrival_cleanup.sql
-- ============================================================================
-- Чистка «застрявшего» факта прихода (actual_arrival) в schedule_entries —
-- корень жалобы владельца «в расписании 5 смен, в зарплате 10».
--
-- МЕХАНИЗМ: quick-action'ы «Выходной/Больничный/Прогул» не слали
-- actualArrival: null, а PATCH backend'а частичный — у переключённого дня
-- оставался старый actual_arrival. Плюс quick-action «Смена» пришивал факт
-- прихода на БУДУЩИЕ даты. Зарплатный счётчик смен (buildShiftFilter clause
-- 'worked' = actual_arrival IS NOT NULL) считал такие строки отработанными,
-- а экран расписания (note/isDayOff приоритетнее, будущее срезано) — нет.
--
-- Код-фиксы (clause-страж + отсечка будущего + явный actualArrival: null в
-- клиентах) закрывают это для НОВЫХ записей; эта миграция чинит УЖЕ лежащие.
--
-- ИДЕМПОТЕНТНОСТЬ: оба UPDATE фильтруют по actual_arrival IS NOT NULL +
-- условию, которое сами же устраняют — повторный прогон затрагивает 0 строк.
--
-- RLS (та же конвенция, что 131): schedule_entries под FORCE ROW LEVEL
-- SECURITY (112). Миграции идут суперпользовательским пулом (RLS обходится),
-- row_security = off — fail-loud страховка от молчаливого no-op, если
-- владельцем таблицы окажется не-суперпользователь без политики.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- 1) Статусные дни: выходной / больничный / прогул не могут нести факт прихода.
--    Больничный/прогул матчим ТОЧНЫМ лейблом quick-action ('Больничный' /
--    'Прогул'), а не подстрокой ILIKE '%больнич%'/'%прогул%': свободный note
--    реально отработанного дня («оформили больничный клиенту») иначе НЕОБРАТИМО
--    потерял бы факт прихода. Выходной по-прежнему берём из is_day_off.
UPDATE schedule_entries
   SET actual_arrival = NULL
 WHERE actual_arrival IS NOT NULL
   AND (is_day_off = true OR note IN ('Прогул', 'Больничный'));

-- 2) Будущие даты: факт прихода в будущем невозможен.
--    Бизнес-«сегодня» — Europe/Moscow (UTC+3), как в getToday / автозакрытии смен.
UPDATE schedule_entries
   SET actual_arrival = NULL
 WHERE actual_arrival IS NOT NULL
   AND date > (now() AT TIME ZONE 'Europe/Moscow')::date;
