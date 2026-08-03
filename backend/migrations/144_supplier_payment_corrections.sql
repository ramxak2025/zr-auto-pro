-- 144_supplier_payment_corrections.sql
-- ============================================================================
-- Корректировка платежей поставщикам (Round 14, зона 2, решение владельца):
-- вместо физического удаления — СТОРНО (reversal) + «Возврат от поставщика»
-- (refund). supplier_payments остаётся append-only: строка никогда не
-- удаляется, сторно помечает её reversed_at/reversed_by/reversal_reason, а
-- возврат — это НОВАЯ строка kind='refund' с ОТРИЦАТЕЛЬНОЙ суммой (SUM-
-- потребители остаются корректны без правок формул).
--
-- Новые колонки:
--   kind            — 'payment' (обычный платёж, включая авто-платёж «Оплатить
--                     сразу» из 098) | 'refund' (возврат денег ОТ поставщика,
--                     amount < 0) | 'defect_return' («виртуальный платёж»,
--                     который пишет stock-movements.applyDefectReturn при
--                     возврате брака — его сторнировать НЕЛЬЗЯ, иначе склад
--                     рассинхронизируется с балансом поставщика);
--   reversed_at     — момент сторно (NULL = строка действует);
--   reversed_by     — кто сторнировал (FK users, ON DELETE SET NULL);
--   reversal_reason — причина сторно (свободный текст);
--   created_by      — кто создал строку (аудит; для легаси-строк NULL).
--
-- Бэкфилл kind='defect_return' — ЭВРИСТИКА по комментарию: до этой миграции
-- возвраты брака не имели маркера, единственный отличительный признак —
-- comment, который applyDefectReturn всегда начинает с «Возврат брака»
-- (либо ровно 'Возврат брака поставщику', либо 'Возврат брака: <причина>').
-- НЕТОЧНОСТЬ ЗАДОКУМЕНТИРОВАНА: если владелец руками создал обычный платёж
-- с комментарием, начинающимся на «Возврат брака…», он будет ошибочно помечен
-- как defect_return и станет несторнируемым (fail-safe в сторону запрета —
-- деньги от этого не искажаются, строка продолжает считаться в балансе).
-- Обратной ошибки нет: новые возвраты брака пишутся с явным kind (правка
-- stock-movements.service.ts в этой же волне).
--
-- ИДЕМПОТЕНТНОСТЬ: ADD COLUMN IF NOT EXISTS; CHECK и FK — в DO-guard'ах,
-- глотающих duplicate_object (конвенция 098); бэкфилл сужен WHERE kind =
-- 'payment', поэтому повторный прогон — no-op. Уже применённые миграции не
-- редактируются — это новый файл.
--
-- RLS (конвенция 131/134/137): supplier_payments под RLS (112). Миграции идут
-- admin-пулом (суперпользователь, RLS обходится); row_security = off —
-- fail-loud страховка. Бэкфилл обязан видеть ВСЕ тенанты.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── 1. Колонки ───────────────────────────────────────────────────────────────
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'payment';
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversed_by UUID;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS created_by UUID;

-- ── 2. CHECK на словарь kind (DO-guard как в 098) ───────────────────────────
DO $$ BEGIN
  ALTER TABLE supplier_payments
    ADD CONSTRAINT supplier_payments_kind_check
    CHECK (kind IN ('payment', 'refund', 'defect_return'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. FK на users (ON DELETE SET NULL — история переживает purge юзера) ────
DO $$ BEGIN
  ALTER TABLE supplier_payments
    ADD CONSTRAINT supplier_payments_reversed_by_fkey
    FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_payments
    ADD CONSTRAINT supplier_payments_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- ── 4. Бэкфилл: легаси-возвраты брака (см. оговорку о неточности в шапке) ───
UPDATE supplier_payments
   SET kind = 'defect_return'
 WHERE kind = 'payment'
   AND comment LIKE 'Возврат брака%';
