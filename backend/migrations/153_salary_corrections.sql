-- 153_salary_corrections.sql
-- Round 15 п.2 — корректировки владельцем ошибочных выплат (salary_payouts +
-- legacy salary_payments): отмена/сторно с компенсацией связанного расхода.
--
-- WHY
--   Владелец: «если случайно выдал ошибочно — чтобы мог изменить». До этого:
--   ПРИНЯТУЮ выплату (salary_payouts.accepted, расход уже записан) отменить
--   нельзя; у legacy salary_payments (012, расход пишется сразу при создании)
--   удаления нет вовсе — переплата неоткатываемая. Здесь только КОЛОНКИ;
--   бизнес-логика (транзакции, сторно расхода, аудит) — SalaryService.
--
-- WHAT
--   1) salary_payouts: cancelled_at / cancelled_by / cancel_reason + статус
--      'cancelled' в CHECK. Отменять можно pending И accepted; строка НЕ
--      удаляется (история видна зачёркнутой — решение владельца), суммы
--      «выплачено» считают только status='accepted'.
--   2) salary_payments: reversed_at / reversed_by / reversal_reason — сторно-
--      семантика (строка остаётся, из сумм исключается); expense_id — прямая
--      связь с зеркальным расходом для НОВЫХ выплат (у старых строк связи не
--      было — сторно ищет расход best-effort: категория «Зарплата» + сумма +
--      дата±1с, см. SalaryService.reversePayment). created_by добираем
--      защищённо (в 012 он есть — no-op).
--
-- IDEMPOTENT, append-only: guarded ADD COLUMN (DO-блоки глотают
--   duplicate_column/undefined_table), пересоздание CHECK — DROP IF EXISTS +
--   guarded ADD (повторный прогон — no-op по эффекту). Индексов не добавляем:
--   выборки идут по уже существующим (tenant_id, employee_id/user_id).

-- ── salary_payouts: отмена ───────────────────────────────────────────────────
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN cancelled_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN cancel_reason TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- Статус 'cancelled' в CHECK (100 создал IN ('pending','accepted','rejected')).
-- Имя constraint — автоимя Postgres <table>_<column>_check. Расширение
-- множества значений — существующие строки валидны по построению.
DO $$
BEGIN
  ALTER TABLE salary_payouts DROP CONSTRAINT IF EXISTS salary_payouts_status_check;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE salary_payouts
    ADD CONSTRAINT salary_payouts_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled'));
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL;
END $$;

-- ── salary_payments (legacy): сторно ────────────────────────────────────────
DO $$ BEGIN ALTER TABLE salary_payments ADD COLUMN reversed_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payments ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payments ADD COLUMN reversal_reason TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
-- Прямая связь выплата → зеркальный расход. Заполняется для НОВЫХ выплат
-- (createPayment пишет обе строки в одной транзакции); у исторических строк
-- остаётся NULL. ON DELETE SET NULL — ручное удаление расхода не рушит выплату.
DO $$ BEGIN ALTER TABLE salary_payments ADD COLUMN expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
-- Belt-and-braces: в 012 created_by есть; guard делает повторное добавление no-op.
DO $$ BEGIN ALTER TABLE salary_payments ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
