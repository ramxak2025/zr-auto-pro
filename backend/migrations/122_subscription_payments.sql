-- 122_subscription_payments.sql
-- ============================================================================
-- Subscription payments ledger — учёт ПЛАТНЫХ vs БЕСПЛАТНЫХ продлений подписки
-- для суперадмин-кабинета (аналитика выручки).
--
-- ПРОБЛЕМА: POST /tenants/:id/extend { days } просто двигал subscription_end,
-- НЕ различая платное и бесплатное продление и НЕ оставляя записи о платеже.
-- getStats().mrr суммировал monthly_price всех тенантов одинаково — «выручка»
-- была теоретической (сумма ценников тарифов), а не фактически собранными
-- деньгами. Владельцу нужна аналитика именно по ПЛАТНЫМ подпискам, при этом
-- БЕСПЛАТНЫЕ продления не должны попадать в выручку НИКОГДА.
--
-- РЕШЕНИЕ: append-only реестр каждого продления. Одна строка на действие
-- «продлить»: сумма (0 для бесплатного), флаг is_free, покрытый период
-- (period_from..period_to = новый subscription_end), previous_end для аудита,
-- заметка и id действующего суперадмина. Вся аналитика платной выручки строится
-- как Σ amount WHERE NOT is_free — бесплатные (is_free=true, amount=0) в сумму
-- не входят ни при каких условиях.
--
-- ЗАПИСЬ: только суперадмин через TenantsService.extend, атомарно в одной
-- транзакции с UPDATE tenants.subscription_end. Суперадмин ходит в БД через
-- admin-пул (суперпользователь) — он обходит RLS, поэтому INSERT/SELECT сюда
-- работают независимо от политик ниже.
--
-- created_by → users(id) ON DELETE SET NULL: строка реестра переживает удаление
-- суперадмина (как actor_user_id в admin_audit_log, миграция 068).
-- tenant_id  → tenants(id) ON DELETE CASCADE: при удалении тенанта его реестр
-- уходит вместе с ним (removeInternal удаляет тенанта последним — каскад срабатывает).
--
-- Идемпотентно: CREATE TABLE/INDEX IF NOT EXISTS + DROP/CREATE POLICY.
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,      -- рубли; 0 для бесплатного продления
  is_free       BOOLEAN NOT NULL DEFAULT false,        -- true → бесплатно, никогда не выручка
  period_from   TIMESTAMPTZ,                           -- начало покрытого периода (якорь продления)
  period_to     TIMESTAMPTZ,                           -- новый subscription_end, установленный продлением
  previous_end  TIMESTAMPTZ,                           -- subscription_end ДО продления (аудит)
  note          TEXT,                                  -- свободная заметка суперадмина
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,  -- действующий суперадмин
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Последний платёж тенанта (бейдж «оплачено/бесплатно до …») + помесячная аналитика.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_tenant
  ON subscription_payments (tenant_id, created_at DESC);
-- Помесячные ряды выручки по всем тенантам.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_created
  ON subscription_payments (created_at DESC);
-- Быстрый охват только платных строк (аналитика выручки — Σ WHERE NOT is_free).
CREATE INDEX IF NOT EXISTS idx_subscription_payments_paid
  ON subscription_payments (created_at) WHERE is_free = false;

-- RLS — консистентно с миграцией 112 (каждая таблица с tenant_id получает
-- политику tenant_isolation). Суперадмин пишет/читает этот реестр через
-- admin-пул (суперпользователь), который обходит RLS всегда, так что путь
-- суперадмина политика не трогает. Политика срабатывает ТОЛЬКО если реестр
-- когда-нибудь прочитают из тенантного контекста (app-пул) — тогда строки
-- будут строго скоуплены своим тенантом (второй рубеж от кросс-тенант утечки).
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscription_payments;
CREATE POLICY tenant_isolation ON subscription_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
