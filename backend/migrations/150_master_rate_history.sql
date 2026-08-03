-- 150_master_rate_history.sql
-- ============================================================================
-- Round 14, зона 4 (б) — «процент мастера по месяцам».
--
-- ПРОБЛЕМА ВЛАДЕЛЬЦА: сменить мастеру процент «с прошлого месяца» (пересчитав
-- ТОЛЬКО прошлый месяц) или «с будущего», не трогая остальные месяцы. Сегодня
-- users.salary_percent / product_salary_percent — ЕДИНСТВЕННЫЙ текущий процент:
-- начисления запекаются им при проведении чека (мигр. 103), а пересчёт (#62)
-- захардкожен на текущий месяц.
--
-- ЧТО ДОБАВЛЯЕМ: master_rate_history — по строке на (tenant, user, месяц),
-- фиксирует проценты, ДЕЙСТВУЮЩИЕ С этого месяца:
--   • effective-процент месяца M = строка с MAX(month) среди month <= M
--     (лексикографическое сравнение 'YYYY-MM' корректно); NULL-колонка строки
--     или отсутствие строк → fallback users.salary_percent /
--     product_salary_percent (текущие значения). БЕЗ backfill — история
--     ведётся с ПЕРВОЙ смены ставки (сознательно: прошлые месяцы уже запечены
--     историческим процентом в чеках, восстанавливать его в историю не из чего).
--   • сервис пишет строки ПОЛНЫМИ снапшотами (обе колонки заполнены значением,
--     эффективным для месяца), поэтому одна строка = полный ответ; NULL в
--     колонках допускается схемой на случай частичной записи мимо сервиса.
--   • обычная смена ставки в карточке сотрудника (users.update) автоматически
--     upsert-ит строку за ТЕКУЩИЙ месяц — история копится сама.
--
-- UNIQUE (tenant_id, user_id, month) — одна ставка на месяц, повторная смена
-- того же месяца перезаписывает (upsert ON CONFLICT).
--
-- ── RLS (зеркало 133) ──────────────────────────────────────────────────────
--   Тенант-скоуп, системных строк нет → одна политика tenant_isolation.
--   Инертна без DB_APP_PASSWORD.
--
-- Идемпотентность: CREATE TABLE/INDEX IF NOT EXISTS; UNIQUE — именованный
-- constraint в CREATE TABLE; ENABLE/FORCE RLS идемпотентны; DROP POLICY IF
-- EXISTS + CREATE. Уже применённый файл НЕ редактируем.
-- ============================================================================

CREATE TABLE IF NOT EXISTS master_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Месяц, С КОТОРОГО действует ставка ('YYYY-MM', московский календарь).
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  -- Процент за работы (services). NULL → fallback users.salary_percent.
  salary_percent NUMERIC(5,2),
  -- Процент с маржи товаров. NULL → fallback users.product_salary_percent.
  product_salary_percent NUMERIC(5,2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT master_rate_history_tenant_user_month_uniq UNIQUE (tenant_id, user_id, month)
);

-- Резолв effective-процента: WHERE tenant+user AND month <= $ ORDER BY month
-- DESC LIMIT 1 — покрывается составным индексом (уникальный уже почти он же,
-- отдельный не нужен). Обратный путь «вся история сотрудника» — тот же индекс.
CREATE INDEX IF NOT EXISTS idx_master_rate_history_tenant_user_month
  ON master_rate_history (tenant_id, user_id, month DESC);

ALTER TABLE master_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_rate_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON master_rate_history;
CREATE POLICY tenant_isolation ON master_rate_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
