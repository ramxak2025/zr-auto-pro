-- 119_installment_payment_method.sql
-- Способ оплаты погашения рассрочки: наличные / карта.
--
-- Проблема владельца: «мастер принял погашение рассрочки наличными — я нигде
-- не вижу, что у него эти деньги на руках». installment_payments (093) уже
-- пишет created_by (кто принял платёж), но способ оплаты не хранился нигде:
-- касса мастера (salary getMy: today_cash/today_card) погашения не учитывала
-- вовсе, а cashflow не мог разбить «Погашения рассрочки» на нал/карту.
--
-- Эта миграция добавляет installment_payments.payment_method TEXT NOT NULL
-- DEFAULT 'cash' + CHECK ('cash','card').
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА: все существующие (до-миграционные) платежи становятся
-- 'cash' — в автосервисе погашения рассрочки почти всегда принимаются
-- наличными, поэтому дефолт исторических строк в нал даёт минимально
-- искажённую картину. Ретроспективно поправить нельзя (способ никогда не
-- записывался), а 'cash' — честная оценка по факту работы сервиса.
--
-- Идемпотентность (паттерн 093): DO-блок с swallow duplicate_column /
-- undefined_table для ADD COLUMN + DROP/ADD CONSTRAINT для CHECK'а.
-- Повторный прогон сходится к той же форме. Файл никогда не редактируется
-- после применения.

-- ADD COLUMN + DROP/ADD CONSTRAINT берут ACCESS EXCLUSIVE на
-- installment_payments. Как в 117/120: не взяли лок за 5с → миграция быстро
-- падает, транзакция откатывается, сервис перезапускается и повторяет
-- (health-gate не пустит трафик раньше) — вместо зависшего ALTER, за которым
-- выстраиваются все запросы (окно 502/504).
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN ALTER TABLE installment_payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- Домен значений (drop-then-add keeps it idempotent, как status в 093).
ALTER TABLE installment_payments DROP CONSTRAINT IF EXISTS installment_payments_payment_method_check;
ALTER TABLE installment_payments ADD CONSTRAINT installment_payments_payment_method_check CHECK (payment_method IN ('cash', 'card'));
