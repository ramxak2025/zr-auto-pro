-- 133_employee_compensation.sql
-- ============================================================================
-- v3.0.1 ФИЧА 1 — «Реальная чистая прибыль (по начислению)»: часть 2 из 2.
--
-- Мотивация/оплата НЕ-мастерского (и мастерского фикс-) персонала: уборщица,
-- админ, кассир, управляющий. Сегодня такие сотрудники попадают в прибыль ТОЛЬКО
-- в день выплаты (спайк). Владелец хочет размазать их вознаграждение по дням.
--
-- ── Таблица employee_compensation ──────────────────────────────────────────
--   Один КОНФИГ вознаграждения на сотрудника (UNIQUE tenant_id,user_id). type:
--     • 'fixed_monthly' — ОКЛАД (RUB/мес). В accrual-прибыли вычитается
--       амортизированно: amount / дней_в_месяце × прошедших_дней (MTD), полный
--       amount в прогнозе. `amount` = рубли/месяц.
--     • 'pct_turnover'  — % С ОБОРОТА. `amount` = процент (0..100). Начисляется
--       от выручки периода: revenue_MTD × amount/100 (натурально MTD, без
--       амортизации). В прогнозе — от run-rate выручки.
--     • 'pct_profit'    — % С ПРИБЫЛИ. `amount` = процент (0..100). База —
--       прибыль ПО ЧЕКАМ (выручка − запчасти − %мастеру за работу), ДО вычета
--       постоянки и мотиваций (иначе рекурсия). checkProfit_MTD × amount/100.
--
--   ВАЖНО — двойного счёта с per-check %мастеру НЕТ: сдельный процент мастера за
--   работу уже «запечён» в checks.profit (service_salary/product_salary) и
--   участвует в checkProfit. employee_compensation — это ОТДЕЛЬНЫЙ слой (оклад /
--   % с оборота / % с прибыли для ролей, у которых нет сдельного процента, ЛИБО
--   сверх него). Владелец сам решает, кому что назначить.
--
--   Фактические выплаты зарплаты (salary payouts / salary_payments) пишутся в
--   expenses под категорией «Зарплата» (is_recurring, см. 132) и в accrual-прибыль
--   НЕ попадают повторно — только в «Движение денег». Развязка полностью
--   симметрична fixed_costs.
--
-- ── RLS (зеркало 112) ──────────────────────────────────────────────────────
--   Тенант-скоуп, системных строк нет → одна политика tenant_isolation. Инертна
--   без DB_APP_PASSWORD.
--
-- Идемпотентность: CREATE TABLE/INDEX IF NOT EXISTS; UNIQUE через именованный
-- constraint в CREATE TABLE (создаётся вместе с таблицей, повторный прогон видит
-- IF NOT EXISTS и не трогает); ENABLE/FORCE RLS идемпотентны; DROP POLICY IF
-- EXISTS + CREATE. Уже применённый файл НЕ редактируем.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_compensation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'fixed_monthly' | 'pct_turnover' | 'pct_profit' — нормализуется в сервисе.
  type TEXT NOT NULL DEFAULT 'fixed_monthly',
  -- RUB/мес для fixed_monthly; процент 0..100 для pct_*. Валидируется/клампится
  -- в сервисе (>= 0; проценты <= 100).
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Один конфиг вознаграждения на сотрудника (upsert по паре). Комбинации
  -- «оклад + % с прибыли» одному сотруднику в v1 не поддерживаем — сознательное
  -- упрощение модели и математики; при необходимости — отдельная строка-фича v2.
  CONSTRAINT employee_compensation_tenant_user_uniq UNIQUE (tenant_id, user_id)
);

-- Чтение конфига тенанта (join к users в отчёте) + обратный путь по сотруднику.
CREATE INDEX IF NOT EXISTS idx_employee_compensation_tenant ON employee_compensation (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_user ON employee_compensation (user_id);

ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_compensation;
CREATE POLICY tenant_isolation ON employee_compensation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
