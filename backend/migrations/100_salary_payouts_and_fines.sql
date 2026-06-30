-- 100_salary_payouts_and_fines.sql
-- «Выплаты с подтверждением» + ужесточение штрафов (комментарий обязателен).
-- (Salary payouts-with-confirmation + mandatory-comment fines.)
--
-- WHY
--   ВЫПЛАТА С ПОДТВЕРЖДЕНИЕМ. Раньше владелец «начислял зарплату» через
--   salary_payments — расход в кассу писался СРАЗУ, без участия сотрудника, а
--   salary_payment_confirmations лишь фиксировали факт «получил». Владелец
--   попросил полноценный двусторонний поток: владелец (director + superadmin)
--   выписывает сотруднику ЗП или АВАНС (произвольная сумма + тип) → сотруднику
--   уходит PUSH → сотрудник ПРИНИМАЕТ или ОТКЛОНЯЕТ → владелец видит статус.
--   Расход (expenses, категория «Зарплата») пишется ТОЛЬКО при ПРИНЯТИИ и
--   датируется днём принятия. При ОТКЛОНЕНИИ — ничего не пишется, выплата
--   аннулируется. Это НОВАЯ сущность `salary_payouts`, она НЕ заменяет и НЕ
--   трогает legacy salary_payments / salary_payment_confirmations (их по-прежнему
--   читают текущие сборки web/mobile) — поэтому таблица отдельная, append-only.
--
--   ШТРАФЫ (056_salary_penalties) — это и есть «штрафы» владельца: standalone
--   вычет (amount + описание + дата), уже вычитаемый из «к выплате» в
--   SalaryService.getAll (remainingAmount = totalEarnings − paidAmount −
--   penaltiesAmount). Владелец уточнил: у штрафа КОММЕНТАРИЙ ОБЯЗАТЕЛЕН («за что»).
--   056 хранит причину в колонке `description`, но она NULLABLE. Здесь мы
--   ПЕРЕИСПОЛЬЗУЕМ 056 (без дубль-таблицы) и доводим её до требования владельца:
--   backfill пустых причин + NOT NULL + CHECK на непустую строку.
--
-- WHAT
--   1) Новая таблица salary_payouts (выплата с жизненным циклом pending →
--      accepted | rejected, ссылка на созданный расход expense_id).
--   2) salary_penalties.description → NOT NULL + непустой (CHECK).
--
-- IDEMPOTENT, append-only: CREATE TABLE/INDEX IF NOT EXISTS, guarded ADD COLUMN /
--   ADD CONSTRAINT (DO-блоки глотают duplicate_*), ALTER ... SET NOT NULL —
--   no-op при повторном прогоне. Никогда не редактируется после применения.

-- ── salary_payouts ───────────────────────────────────────────────────────────
-- Одна строка = одна выписанная выплата одному сотруднику.
--   type    — 'salary' (зарплата) | 'advance' (аванс).
--   status  — 'pending' (ждёт решения сотрудника) | 'accepted' | 'rejected'.
--   amount  — произвольная положительная сумма (RUB).
--   comment — необязательная пометка владельца (в отличие от штрафа).
--   created_by — владелец-инициатор (director/superadmin). SET NULL: чистка
--                владельца не рушит историю выплаты.
--   decided_at — момент принятия/отклонения сотрудником.
--   expense_id — расход, созданный ПРИ ПРИНЯТИИ (категория «Зарплата»). SET NULL:
--                удаление расхода не рушит строку выплаты (статус остаётся).
CREATE TABLE IF NOT EXISTS salary_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'salary' CHECK (type IN ('salary', 'advance')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  comment TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL
);

-- Безопасные доборы колонок для уже существующей таблицы (частичное применение).
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN employee_id UUID REFERENCES users(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN type TEXT NOT NULL DEFAULT 'salary'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN amount NUMERIC(12,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN comment TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN decided_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE salary_payouts ADD COLUMN expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- Индексы. Владельческий список по тенанту (+ фильтр по статусу — «на
-- подтверждении»), детализация по сотруднику, выборка за период по created_at.
CREATE INDEX IF NOT EXISTS idx_salary_payouts_tenant_employee
  ON salary_payouts (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payouts_tenant_status
  ON salary_payouts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_payouts_tenant_created
  ON salary_payouts (tenant_id, created_at);
-- Помесячная карточка сотрудника: WHERE tenant_id=$ AND employee_id=$ за период.
CREATE INDEX IF NOT EXISTS idx_salary_payouts_employee_created
  ON salary_payouts (tenant_id, employee_id, created_at);

-- ── salary_penalties.description → обязательный комментарий ───────────────────
-- Штраф владельца обязан нести причину «за что». 056 завёл description NULLABLE;
-- доводим до NOT NULL + непустой строки.
--   1) backfill: NULL / пустые → '—' (плейсхолдер «причина не указана»), чтобы
--      ALTER ... SET NOT NULL и CHECK прошли на существующих строках. Сумма
--      вычета сохраняется — трогаем только текст.
--   2) NOT NULL (идемпотентно — повторный SET NOT NULL это no-op).
--   3) CHECK на непустую (после btrim) строку — отсекает «   ». Через DO-блок,
--      чтобы повторный прогон не падал с duplicate_object.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'salary_penalties') THEN
    UPDATE salary_penalties SET description = '—' WHERE description IS NULL OR btrim(description) = '';
    ALTER TABLE salary_penalties ALTER COLUMN description SET NOT NULL;
  END IF;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE salary_penalties
    ADD CONSTRAINT salary_penalties_description_not_blank CHECK (btrim(description) <> '');
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL;
END $$;
