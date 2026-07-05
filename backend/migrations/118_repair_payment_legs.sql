-- 118_repair_payment_legs.sql
-- Разовый ремонт битых «ног» оплаты (cash_amount / card_amount) в checks.
--
-- Откуда битые строки: мобильная правка чека со сменой способа оплаты.
-- CheckCreateScreen.tsx шлёт `cashAmount: finalCash || undefined` — пустая
-- нога НЕ уходит на сервер, а fullUpdate/editClosedCheck пишут ногу только
-- когда dto.* !== undefined (total_revenue при этом перезаписывается всегда).
-- Итог: сменил «наличные» → «картой» — старый cash_amount выжил в БД рядом с
-- новым card_amount, и разбивка (наличные+карта+гарантия) может ПРЕВЫШАТЬ
-- оборот. Серверная защита добавлена в checks.service.ts той же волной; эта
-- миграция чинит уже накопленные строки.
--
-- Второй класс битых строк: POS-режим смен (092). create() принудительно
-- зануляет ОБЕ ноги драфта мастера-без-accept_payment, а закрытие кассиром
-- идёт голым PATCH {isDeferred:false} — ноги не досылались, и каждая такая
-- продажа становилась активным чеком 'cash'/'card' с cash=card=0: разбивка
-- НЕДОБИРАЕТ до оборота. Серверный довод ног при закрытии добавлен в
-- activateDeferred той же волной; здесь — ремонт накопленного.
--
-- Чиним ТОЛЬКО однозначно битые строки — одноканальные методы, у которых
-- нога обязана равняться total_revenue (инвариант держится и после частичных
-- возвратов: реверс в returns.service.ts уменьшает total и ногу синхронно):
--   • 'card'     + cash_amount>0  → cash_amount=0, card_amount=total_revenue;
--   • 'cash'     + card_amount>0  → card_amount=0, cash_amount=total_revenue;
--   • 'warranty' + любая нога >0  → обе ноги в 0 (гарантия — не деньги кассы);
--   • 'cash'/'card' АКТИВНЫЙ с чистой второй ногой, но нога ≠ total (класс
--     092 выше) — довести ногу до total_revenue. Отложенные (is_deferred)
--     НЕ трогаем: нулевые ноги драфта — норма, их доведёт закрытие.
-- 'cash_card' и 'installment' НЕ трогаем: раскладку (доли / первый взнос)
-- знает только клиент, восстановить её из БД нельзя.
--
-- Идемпотентность: после UPDATE условия WHERE перестают матчиться
-- (cash_amount>0 / card_amount>0 обнулены, нога = total_revenue) —
-- повторный прогон = no-op.

-- Оплата картой, но выжила наличная нога от прежнего способа.
UPDATE checks
   SET cash_amount = 0,
       card_amount = total_revenue
 WHERE deleted_at IS NULL
   AND payment_method = 'card'
   AND cash_amount > 0;

-- Оплата наличными, но выжила карточная нога от прежнего способа.
UPDATE checks
   SET card_amount = 0,
       cash_amount = total_revenue
 WHERE deleted_at IS NULL
   AND payment_method = 'cash'
   AND card_amount > 0;

-- Гарантия: денег в кассу не поступало — обе ноги обязаны быть нулевыми.
UPDATE checks
   SET cash_amount = 0,
       card_amount = 0
 WHERE deleted_at IS NULL
   AND payment_method = 'warranty'
   AND (cash_amount > 0 OR card_amount > 0);

-- Класс 092 (после двух UPDATE выше у одноканальных строк вторая нога уже 0):
-- активный 'cash'-чек, у которого наличная нога не сходится к обороту —
-- типично cash=0 после закрытия shift-mode-драфта голым {isDeferred:false}.
-- COALESCE: у древних строк нога могла остаться NULL — SUM её игнорирует,
-- это тот же тихий недобор.
UPDATE checks
   SET cash_amount = total_revenue,
       card_amount = 0
 WHERE deleted_at IS NULL
   AND is_deferred = false
   AND payment_method = 'cash'
   AND COALESCE(card_amount, 0) = 0
   AND (cash_amount IS NULL OR cash_amount <> total_revenue);

-- Симметрично для 'card'.
UPDATE checks
   SET card_amount = total_revenue,
       cash_amount = 0
 WHERE deleted_at IS NULL
   AND is_deferred = false
   AND payment_method = 'card'
   AND COALESCE(cash_amount, 0) = 0
   AND (card_amount IS NULL OR card_amount <> total_revenue);
