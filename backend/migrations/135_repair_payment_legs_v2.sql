-- 135_repair_payment_legs_v2.sql
-- Ремонт «ног» оплаты, том 2: класс, который 118_repair_payment_legs.sql
-- сознательно пропустила — смешанная оплата ('cash_card') с несведёнными
-- ногами (cash_amount + card_amount <> total_revenue).
--
-- Откуда такие строки (находка C5 cashflow-аудита):
--   • старый (до-OTA) мобильный клиент слал `cashAmount: finalCash || undefined`
--     — нулевая нога НЕ уходила на сервер, выживала одна нога;
--   • POS-режим смен (092): create() принудительно занулял ОБЕ ноги драфта,
--     закрытие кассиром шло голым PATCH {isDeferred:false} — чек с методом
--     'cash_card' навсегда оставался с cash=card=0 при total>0;
--   • editClosedCheck до этой волны не ресинкал ноги при изменении total без
--     dto.paymentMethod.
-- В отчёте «Движение денег» такие строки дают «Итого» ≠ «Наличные + Карта +
-- Рассрочка». Серверная защита (нормализация ног от эффективного метода + 400
-- на несведённую раскладку) добавлена в checks.service.ts той же волной; здесь
-- — ремонт уже накопленного.
--
-- Чиним ТОЛЬКО детерминированно восстановимые строки:
--   1) ровно ОДНА положительная нога, вторая 0/NULL, и нога < total —
--      под инвариантом cash + card = total вторая нога математически
--      однозначна: total − нога (ровно та же формула, которой рантайм доводит
--      единственную пришедшую ногу);
--   2) total_revenue = 0 (полный возврат/нулевой чек) — обе ноги обязаны быть
--      нулевыми.
-- НЕ трогаем (раскладку из БД не восстановить — считаем и оставляем):
--   • обе ноги нулевые при total > 0 (shift-mode класс — реальная раскладка
--     неизвестна);
--   • обе ноги положительные, но сумма ≠ total;
--   • единственная нога > total.
-- Отложенные (is_deferred) не трогаем: нулевые ноги драфта — норма, их
-- доводит закрытие.
--
-- Идемпотентность: после UPDATE условия WHERE перестают матчиться (сумма ног
-- сходится к total_revenue) — повторный прогон = no-op. DO-блок только читает.

-- 1а) Выжила только карточная нога — наличная однозначна: total − card.
UPDATE checks
   SET cash_amount = total_revenue - card_amount
 WHERE deleted_at IS NULL
   AND is_deferred = false
   AND payment_method = 'cash_card'
   AND COALESCE(cash_amount, 0) = 0
   AND card_amount > 0
   AND card_amount < total_revenue;

-- 1б) Симметрично: выжила только наличная нога — карточная = total − cash.
UPDATE checks
   SET card_amount = total_revenue - cash_amount
 WHERE deleted_at IS NULL
   AND is_deferred = false
   AND payment_method = 'cash_card'
   AND COALESCE(card_amount, 0) = 0
   AND cash_amount > 0
   AND cash_amount < total_revenue;

-- 2) Нулевой итог (полный возврат / пустой чек) — денег в кассе нет, обе ноги 0.
UPDATE checks
   SET cash_amount = 0,
       card_amount = 0
 WHERE deleted_at IS NULL
   AND is_deferred = false
   AND payment_method = 'cash_card'
   AND total_revenue = 0
   AND (COALESCE(cash_amount, 0) <> 0 OR COALESCE(card_amount, 0) <> 0);

-- 3) Невосстановимый остаток — не трогаем, только считаем в лог миграции,
--    чтобы масштаб был виден при деплое.
DO $$
DECLARE
  ambiguous_cnt integer;
BEGIN
  SELECT COUNT(*) INTO ambiguous_cnt
    FROM checks
   WHERE deleted_at IS NULL
     AND is_deferred = false
     AND payment_method = 'cash_card'
     AND COALESCE(cash_amount, 0) + COALESCE(card_amount, 0) <> total_revenue;
  IF ambiguous_cnt > 0 THEN
    RAISE NOTICE '135_repair_payment_legs_v2: cash_card-чеков с невосстановимой раскладкой оставлено без изменений: %', ambiguous_cnt;
  END IF;
END $$;
