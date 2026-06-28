-- 095_motivation_promo_products.sql
-- «Мотивация сотрудников» v1 — акционные товары (employee motivation: promo products).
--
-- ADDITIVE, append-only. Two brand-new tables + indexes. Nothing here drops or
-- rewrites an existing column or table, so every legacy client keeps reading the
-- same response shapes and the existing salary / checks math is untouched.
--
-- WHAT THIS ENABLES
--   The owner (director/admin/superadmin) marks individual PRODUCTS as «акционные»
--   and sets a percent for each (tenant-scoped). When such a product is sold and
--   the заказ-наряд is PAID (closed / not deferred), the employee credited for that
--   sale (= checks.master_id, the SAME attribution payroll already uses for product
--   revenue) earns a bonus:
--
--       bonus = percent × MARGIN,   MARGIN = (sell_price − cost_price) × qty
--
--   computed from the captured check_product_lines (sell/cost are frozen on the
--   line at sale time, so the bonus reflects the real margin of THAT sale). The
--   bonus is written once, at payment, into the motivation_accruals ledger and is
--   summed by the salary report into a NEW «Мотивация» component per employee per
--   period — purely additive to existing salary math.
--
-- WHY A SEPARATE TABLE (not columns on products / not the existing
-- product_commissions): products schema stays clean, promos are trivially
-- listable/clearable, and this is a DIFFERENT concept from 009_product_commissions
-- (which is a PER-MASTER commission baked into checks.product_salary_total at
-- create-time). The two are independent and both additive; this migration touches
-- neither product_commissions nor checks.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS only — a re-run converges to the
-- same state and changes nothing. Runs in the default BEGIN/COMMIT migration mode.
-- Never edited once applied.

-- ── 1. Promo flag + percent per product (tenant-scoped) ─────────────────────
-- UNIQUE (tenant_id, product_id): at most one promo config per product per tenant
-- (the service upserts on this key). `active` lets the owner pause a promo without
-- deleting it; optional starts_at/ends_at give a time window (NULL = unbounded).
CREATE TABLE IF NOT EXISTS motivation_promo_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  percent     NUMERIC(5,2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_motivation_promo_tenant
  ON motivation_promo_products (tenant_id);

-- Fast "is this product an active promo right now" lookup used by the accrual
-- join on the check write path — partial on active=true so the hot path scans
-- only live promos.
CREATE INDEX IF NOT EXISTS idx_motivation_promo_active
  ON motivation_promo_products (tenant_id, product_id)
  WHERE active = true;

-- ── 2. Accruals ledger (one row per promo-product per PAID check) ────────────
-- Written transactionally with the check the moment it becomes paid. employee_id
-- is the credited master (checks.master_id). margin_base / percent / amount are
-- stored for full auditability ("why was this bonus this size"). FKs:
--   • check_id  CASCADE  → deleting/reversing a sale removes its accruals, so
--     salary instantly stops counting bonuses for a sale that no longer exists.
--   • employee_id / product_id SET NULL → never block a user/product delete; the
--     ledger row survives as an (unattributed) audit record.
CREATE TABLE IF NOT EXISTS motivation_accruals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  UUID REFERENCES users(id)    ON DELETE SET NULL,
  check_id     UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  qty          NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin_base  NUMERIC(14,2) NOT NULL DEFAULT 0,
  percent      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  accrued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Salary sums accruals per employee within a period — this is the covering index
-- for that aggregation.
CREATE INDEX IF NOT EXISTS idx_motivation_accruals_tenant_emp
  ON motivation_accruals (tenant_id, employee_id, accrued_at);

-- Lookup / cleanup by check (also the FK-side index for the CASCADE above).
CREATE INDEX IF NOT EXISTS idx_motivation_accruals_check
  ON motivation_accruals (check_id);

-- Idempotency backstop: AT MOST ONE accrual per (tenant, check, product). The
-- service already recomputes by DELETE-then-INSERT inside the check's locked
-- transaction, so this can never actually fire in the normal flow — it is the
-- DB-level guarantee that a re-pay / double-fire can never double-credit a master.
CREATE UNIQUE INDEX IF NOT EXISTS uq_motivation_accrual_check_product
  ON motivation_accruals (tenant_id, check_id, product_id)
  WHERE product_id IS NOT NULL;
