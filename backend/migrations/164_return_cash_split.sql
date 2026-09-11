-- 164_return_cash_split.sql
-- Наличная часть возврата — отдельной колонкой, чтобы Z-отчёт видел выдачу
-- денег в ДЕНЬ ВОЗВРАТА, а не в день продажи.
--
-- WHY
--   Возврат реверсирует деньги НА ИСХОДНОМ ЧЕКЕ (returns.service: cash_amount
--   уменьшается первым, остаток добивается с карты), а чек датирован ДНЁМ
--   ПРОДАЖИ. Кассовая смена считает наличную выручку окном по checks.date
--   (cash-shifts.computeFigures), поэтому возврат по чеку ПРОШЛОЙ смены уходит
--   вычетом в уже закрытую смену: деньги из ящика выдали сегодня, а ожидаемый
--   остаток сегодняшней смены их не знает. Итог — фантомная НЕДОСТАЧА в
--   Z-отчёте, пуш директору о расхождении и подозрение на честного кассира.
--
--   Чтобы вычесть возврат в день ФАКТА (как это уже делает «Движение денег» —
--   строка refunds по check_returns.created_at), смене нужна именно НАЛИЧНАЯ
--   часть возврата: карту из денежного ящика не выдают. Восстановить её из
--   текущих колонок невозможно — после реверса cash_amount уже уменьшен, а
--   исходное значение нигде не сохранено. Значит, её надо ЗАПИСЫВАТЬ в момент
--   возврата.
--
-- WHAT
--   check_returns.refund_cash_amount NUMERIC(14,2) NOT NULL DEFAULT 0 — та
--   часть refund_amount, которую возврат снял именно с наличных чека
--   (= LEAST(refund_amount, cash_amount ДО реверса)). Остаток возврата ушёл с
--   карты и денежного ящика не касается.
--
-- БЭКФИЛЛ ИСТОРИИ — ПО СПОСОБУ ОПЛАТЫ ЧЕКА, и это ОСОЗНАННОЕ ПРИБЛИЖЕНИЕ.
--   Точного значения для старых строк не существует (см. выше), поэтому:
--     • чек оплачен наличными / смешанно / способ не указан (легаси) →
--       считаем возврат наличным целиком: возврат снимает нал ПЕРВЫМ, и для
--       чисто наличного чека это точное значение, а для смешанного — верхняя
--       граница;
--     • чек оплачен картой / рассрочкой / по гарантии → 0: из ящика не выдавали.
--   Риск приближения ограничен: у ЗАКРЫТЫХ смен ожидаемый остаток заморожен в
--   cash_shifts.expected_amount (Z-отчёт — исторический документ и не
--   пересчитывается), поэтому бэкфилл влияет только на разбивку старых смен и
--   на ОТКРЫТУЮ смену в момент выката.
--
-- IDEMPOTENT: guarded ADD COLUMN (DO-блок глотает duplicate_column /
--   undefined_table), бэкфилл трогает ТОЛЬКО строки с NULL, поэтому повторный
--   прогон не перетирает значения, записанные новым кодом.

-- ── Колонка ─────────────────────────────────────────────────────────────────
-- Добавляем NULLable: NULL здесь — маркер «строка до миграции», по которому
-- бэкфилл ниже отличает историю от значений нового кода.
DO $$ BEGIN ALTER TABLE check_returns ADD COLUMN refund_cash_amount NUMERIC(14,2); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Бэкфилл истории ─────────────────────────────────────────────────────────
DO $$
BEGIN
  UPDATE check_returns cr
     SET refund_cash_amount =
           CASE
             WHEN ch.payment_method IS NULL OR ch.payment_method IN ('cash', 'cash_card')
               THEN cr.refund_amount
             ELSE 0
           END
    FROM checks ch
   WHERE ch.id = cr.check_id
     AND cr.refund_cash_amount IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- Возврат, чей чек уже физически удалён (FK стоит ON DELETE CASCADE, поэтому
-- случай теоретический) — страховка, чтобы SET NOT NULL ниже не упал.
DO $$
BEGIN
  UPDATE check_returns SET refund_cash_amount = 0 WHERE refund_cash_amount IS NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- ── Дефолт + NOT NULL ───────────────────────────────────────────────────────
-- Теперь колонка обязана быть заполнена всегда: денежная строка без наличной
-- части — это снова «неизвестно, сколько выдали из ящика».
DO $$
BEGIN
  ALTER TABLE check_returns ALTER COLUMN refund_cash_amount SET DEFAULT 0;
  ALTER TABLE check_returns ALTER COLUMN refund_cash_amount SET NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- Z-отчёт смены выбирает возвраты окном [opened_at, closed_at] по дате ФАКТА.
-- Индекс (tenant_id, created_at DESC) для этого уже есть (040), отдельный не
-- нужен — колонка только добавляет столбец к той же выборке.

-- ── Индекс под наличные погашения рассрочки в окне смены ────────────────────
-- Z-отчёт ОТКРЫТОЙ смены перечитывается на каждом обновлении экрана кассы,
-- поэтому окно по дате платежа обязано ложиться на индекс. Существующий
-- idx_installment_payments_plan (tenant_id, plan_id) для диапазона по paid_at
-- бесполезен: у тенанта с историей это seq scan на каждое открытие кассы.
CREATE INDEX IF NOT EXISTS idx_installment_payments_tenant_paid
  ON installment_payments (tenant_id, paid_at);
