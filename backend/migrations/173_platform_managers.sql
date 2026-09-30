-- 173_platform_managers.sql
-- ============================================================================
-- Менеджеры платформы (сотрудники суперадмина) и доля владельца.
-- Спека: docs/specs/2026-09-30-MANAGERS.md (правка №2 от 2026-09-30).
--
-- ЗАПРОС ВЛАДЕЛЬЦА. Владелец заводит менеджеров; менеджер сам создаёт
-- автосервисы, выдаёт пробный доступ и продлевает платные подписки. Деньги за
-- продление менеджер получает от клиента сам, поэтому 60 % (настраивается) от
-- каждой такой оплаты записываются как ДОЛГ менеджера перед владельцем.
-- Владелец фиксирует, сколько менеджер передал (manager_settlements), и
-- передаёт клиентов от одного менеджера другому.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ
--   1. users.role: снимаем inline-CHECK из 001_init.sql и создаём заново с
--      ролью 'manager'. Имя ограничения НЕ хардкодим: ищем его в pg_constraint
--      по conrelid='users'::regclass, contype='c' и определению, где есть
--      'superadmin' (на разных базах имя могло оказаться не users_role_check).
--   2. users.owner_share_percent — доля владельца, только у role='manager'.
--   3. tenants.manager_id — чей это клиент (NULL = клиент владельца).
--      ON DELETE SET NULL: удаление менеджера-строки не удаляет автосервисы.
--   4. subscription_payments: снимок доли на момент оплаты (manager_id,
--      owner_share_percent, owner_share_amount) + снимок тарифа (plan_id,
--      plan_name). Снимок, а не вычисление по tenants.manager_id: при передаче
--      клиента история платежей и долг остаются за тем менеджером, который
--      провёл оплату.
--   5. manager_settlements — расчёты владельца с менеджером (плюс = менеджер
--      передал деньги, минус = корректировка в пользу менеджера).
--      Баланс = Σ owner_share_amount − Σ manager_settlements.amount.
--   6. platform_settings.manager_max_free_days — потолок пробного доступа
--      одним бесплатным продлением у менеджера (по умолчанию 30 дней).
--
-- RLS. manager_settlements — глобальная таблица без tenant_id: RLS НЕ включаем
-- (как admin_audit_log, платформенные plans/tenants/platform_settings). Доступ
-- гейтится на уровне приложения: маршруты /admin/managers/* (@Roles('superadmin'))
-- и /manager/* (@Roles('manager','superadmin')) через admin-пул. subscription_payments
-- остаётся под RLS tenant_isolation (миграция 122) и читается тоже через admin-пул.
-- GRANT'ы роли autexa_app выдаёт MigrationRunner.bootstrapAppRole после миграций.
--
-- Идемпотентно: повторный прогон — no-op (DO-блок проверяет, что CHECK уже
-- содержит 'manager'; всё остальное — IF NOT EXISTS).
-- ============================================================================

-- ── 1. users.role: добавляем 'manager' ──────────────────────────────────────
DO $$
DECLARE
  c RECORD;
  has_manager BOOLEAN := FALSE;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%superadmin%'
  LOOP
    IF c.def LIKE '%''manager''%' THEN
      -- Уже новая версия (повторный прогон) — не трогаем.
      has_manager := TRUE;
    ELSE
      EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;

  IF NOT has_manager THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('superadmin', 'director', 'admin', 'master', 'manager'));
  END IF;
END $$;

-- ── 2. Доля владельца (только у менеджера; у остальных ролей NULL) ──────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_share_percent NUMERIC(5,2);

-- ── 3. Принадлежность клиента менеджеру ─────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_manager
  ON tenants (manager_id) WHERE manager_id IS NOT NULL;

-- ── 4. Снимок доли и тарифа в журнале продлений ─────────────────────────────
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_share_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS owner_share_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_name TEXT;
CREATE INDEX IF NOT EXISTS idx_subscription_payments_manager
  ON subscription_payments (manager_id, created_at DESC) WHERE manager_id IS NOT NULL;

-- ── 5. Расчёты владельца с менеджером (без RLS — см. шапку) ─────────────────
CREATE TABLE IF NOT EXISTS manager_settlements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount <> 0),
  note        TEXT,
  settled_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manager_settlements_manager
  ON manager_settlements (manager_id, created_at DESC);

-- ── 6. Потолок пробного доступа менеджера ───────────────────────────────────
-- Синглтон platform_settings (id = 1) создаётся лениво PlatformSettingsService;
-- если строка уже есть — существующая получает DEFAULT 30.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS manager_max_free_days INT NOT NULL DEFAULT 30;

-- ── 7. Журнал действий одного актора ────────────────────────────────────────
-- Кабинет менеджера показывает «только записи, где актор — я»
-- (GET /manager/audit-log). Единственный индекс admin_audit_log — по created_at
-- (068), без него выборка по актору читает всю таблицу.
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
  ON admin_audit_log (actor_user_id, created_at DESC);
