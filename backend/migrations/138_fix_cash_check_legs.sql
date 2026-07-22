-- 138_fix_cash_check_legs.sql
-- Ремонт «ног» оплаты, том 3: одноканальные чеки ('cash' / 'card'), где
-- записанная нога МЕНЬШЕ суммы чека (cash_amount < total_revenue при методе
-- 'cash', card_amount < total_revenue при методе 'card').
--
-- Откуда такие строки (решение владельца, волна G):
--   • метод оплаты — «наличные» (или «карта»), но мастер записал в ногу МЕНЬШЕ,
--     чем итог чека. По бизнес-смыслу одноканального чека клиент заплатил
--     ПОЛНОСТЬЮ (нал=итог / карта=итог) — это опечатка мастера, а не частичная
--     оплата. В «Движении денег» такие строки давали «Наличные» < «Итого» и
--     цифры не сходились.
--
-- Чиним детерминированно: у одноканального чека вторая нога обязана быть 0/NULL,
-- а единственная нога = total_revenue. Доводим её до total_revenue.
--
-- НЕ трогаем (осознанно, симметрия с 118/135):
--   • cash_card — их несведённые ноги чинит 135 (там раскладка двухканальная);
--   • warranty — денег в кассу не приносит (cash=card=0 — норма);
--   • installment — недоплата = ЛЕГИТИМНЫЙ долг по рассрочке (installment_plans),
--     недобор ноги там ожидаем и не является ошибкой;
--   • is_deferred = true — отложенные драфты (нулевые ноги — норма, доводит
--     закрытие);
--   • deleted_at IS NOT NULL — чеки в корзине;
--   • нога > total_revenue (переплата — не наш класс, раскладку не угадать);
--   • чеки с СВЯЗАННЫМ долгом в client_debts (см. ниже) — там недобор ноги
--     ЛЕГИТИМЕН (частичная оплата в долг, «ремонт в долг»).
--
-- КРИТИЧНО (прод у ВСЕХ тенантов) — исключение легитимных частичных оплат.
-- client_debts (081) — ручной реестр долгов клиента. Строка type='charge' с
-- мягкой ссылкой check_id указывает, что по ЭТОМУ чеку часть суммы осталась в
-- долг (владелец записал «ремонт в долг» с привязкой к чеку). Такой чек — НЕ
-- ошибка мастера, а сознательная частичная оплата: доводить его ногу до итога
-- НЕЛЬЗЯ. Поэтому исключаем любой чек, на который ссылается client_debts-charge.
--
-- ОГРАНИЧЕНИЕ СВЯЗИ (честно): в коде связь чек→долг создаётся ТОЛЬКО вручную
-- через debts.service (recordCharge с опциональным checkId); write-path чеков
-- (checks.service) в client_debts НЕ пишет. Значит недобор ноги, оформленный
-- как долг БЕЗ привязки check_id, здесь не отследить. Мы выбрали максимально
-- КОНСЕРВАТИВНЫЙ фильтр: любой charge со ссылкой на чек защищает чек целиком
-- (тип 'charge', без проверки остатка баланса — closed/unclosed из одной строки
-- достоверно не вывести, а перетереть реальный долг опаснее, чем оставить
-- опечатку). Погашения (type='payment') в debts.service пишутся БЕЗ check_id,
-- поэтому «закрытость» долга по этой ссылке не восстановить — отсюда защита по
-- самому факту наличия charge-ссылки.
--
-- Идемпотентность: после UPDATE нога = total_revenue, предикат `нога < total`
-- перестаёт матчиться → повторный прогон = no-op. DO-блок только читает.
--
-- RLS (конвенция 135/136/137): checks/client_debts под RLS (112/114). Миграции
-- идут admin-пулом (суперпользователь, RLS обходится); row_security = off —
-- fail-loud страховка. lock_timeout — не висеть на блокировке при живом трафике.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- 1) Метод «наличные»: единственная нога — наличная, карта пуста, нал < итог.
--    Клиент заплатил полностью → cash_amount = total_revenue.
UPDATE checks c
   SET cash_amount = c.total_revenue
 WHERE c.payment_method = 'cash'
   AND c.deleted_at IS NULL
   AND c.is_deferred = false
   AND COALESCE(c.card_amount, 0) = 0
   AND COALESCE(c.cash_amount, 0) < c.total_revenue
   AND NOT EXISTS (
     SELECT 1 FROM client_debts cd
      WHERE cd.check_id = c.id
        AND cd.tenant_id = c.tenant_id
        AND cd.type = 'charge'
   );

-- 2) Симметрично для метода «карта»: карта пуста-наоборот (нал=0), карта < итог.
UPDATE checks c
   SET card_amount = c.total_revenue
 WHERE c.payment_method = 'card'
   AND c.deleted_at IS NULL
   AND c.is_deferred = false
   AND COALESCE(c.cash_amount, 0) = 0
   AND COALESCE(c.card_amount, 0) < c.total_revenue
   AND NOT EXISTS (
     SELECT 1 FROM client_debts cd
      WHERE cd.check_id = c.id
        AND cd.tenant_id = c.tenant_id
        AND cd.type = 'charge'
   );

-- 3) Диагностика: сколько одноканальных чеков осталось с недобором ноги из-за
--    защиты client_debts (легитимные частичные оплаты) — чтобы масштаб был виден
--    в логе деплоя и мы понимали, что это НЕ ошибка, а сознательный долг.
DO $$
DECLARE
  protected_cnt integer;
BEGIN
  SELECT COUNT(*) INTO protected_cnt
    FROM checks c
   WHERE c.payment_method IN ('cash', 'card')
     AND c.deleted_at IS NULL
     AND c.is_deferred = false
     AND (
       (c.payment_method = 'cash' AND COALESCE(c.card_amount, 0) = 0 AND COALESCE(c.cash_amount, 0) < c.total_revenue)
       OR
       (c.payment_method = 'card' AND COALESCE(c.cash_amount, 0) = 0 AND COALESCE(c.card_amount, 0) < c.total_revenue)
     )
     AND EXISTS (
       SELECT 1 FROM client_debts cd
        WHERE cd.check_id = c.id AND cd.tenant_id = c.tenant_id AND cd.type = 'charge'
     );
  IF protected_cnt > 0 THEN
    RAISE NOTICE '138_fix_cash_check_legs: одноканальных чеков с недобором ноги оставлено как легитимный долг (client_debts): %', protected_cnt;
  END IF;
END $$;
