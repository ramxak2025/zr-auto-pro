-- 117_payment_method_installment.sql
-- CHECK-констрейнт checks.payment_method не знает про 'installment'.
--
-- 001_init.sql:140 создал inline-CHECK (авто-имя checks_payment_method_check)
-- на список ('cash','card','warranty','cash_card'). Рассрочка (093,
-- payment_method='installment') в этот список не входит — на проде констрейнт
-- правился руками, т.е. прод-БД расходится со схемой из миграций. Эта миграция
-- кодифицирует правильное состояние: полный список значений — ровно те, что
-- пишет backend и объявляет shared enum PaymentMethod
-- (shared/types/index.ts): 'cash','card','warranty','cash_card','installment'.
--
-- Механика (важно: MigrationRunner гоняет миграции на СТАРТЕ сервиса, падение
-- здесь = крашлуп деплоя):
--   1) Снимаем ЛЮБОЙ CHECK-констрейнт на payment_method — на проде он мог
--      получить другое имя при ручной правке, поэтому ищем по pg_constraint,
--      а не только по авто-имени.
--   2) ADD CONSTRAINT ... NOT VALID — без скана таблицы, новые строки сразу
--      под контролем, существующие не блокируют деплой.
--   3) VALIDATE CONSTRAINT в DO-блоке: если в проде затесалось неожиданное
--      значение — RAISE WARNING и едем дальше (констрейнт остаётся NOT VALID,
--      но продолжает проверять новые строки). Деплой НЕ падает.
--
-- Идемпотентность: повторный прогон снимает и вешает тот же констрейнт заново
-- и сходится к тому же состоянию (no-op по результату).

-- 0) DROP/ADD CONSTRAINT берут ACCESS EXCLUSIVE на checks — самую горячую
-- таблицу. При two-replica деплое старая реплика продолжает гонять отчётные
-- SELECT'ы: если ALTER повиснет за долгим запросом, ВСЕ новые запросы к
-- checks выстроятся за ним (окно 502/504). lock_timeout: не взяли лок за 5с —
-- миграция падает быстро, транзакция откатывается, сервис перезапускается и
-- повторяет (файл идемпотентный; health-gate не пустит трафик раньше).
-- SET LOCAL — действует до конца транзакции миграции (MigrationRunner гоняет
-- файл в BEGIN/COMMIT), соединение пула не отравляется.
SET LOCAL lock_timeout = '5s';

-- 1) Снять существующий CHECK на payment_method, как бы он ни назывался.
DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'checks'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%payment_method%'
    LOOP
        EXECUTE format('ALTER TABLE checks DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

-- Страховка на случай, если авто-имя есть, но def почему-то не сматчился.
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_payment_method_check;

-- 2) Полный список значений. NOT VALID — без скана существующих строк.
ALTER TABLE checks
    ADD CONSTRAINT checks_payment_method_check
    CHECK (payment_method IN ('cash', 'card', 'warranty', 'cash_card', 'installment'))
    NOT VALID;

-- 3) Валидация исторических строк — best-effort, деплой не роняем.
DO $$
BEGIN
    ALTER TABLE checks VALIDATE CONSTRAINT checks_payment_method_check;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '117_payment_method_installment: VALIDATE не прошёл (в checks есть неожиданное значение payment_method?): %. Констрейнт оставлен NOT VALID — новые строки проверяются.', SQLERRM;
END $$;
