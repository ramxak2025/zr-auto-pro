-- 102_subscription_features_and_suspend.sql
-- Superadmin cabinet / subscription / plan-features (#55) — backend foundation.
--
-- Three additive, idempotent, backward-compatible changes:
--
--   1. Explicit per-tenant SUSPEND capability (suspended_at + suspended_reason).
--      A NULL suspended_at == not suspended (every existing tenant). The new
--      superadmin POST /tenants/:id/suspend stamps it (and flips is_active=false
--      so all existing is_active-based logic — MRR, broadcasts — stays coherent);
--      /unsuspend clears it. Subscription `status` is then:
--        suspended  ⇐ suspended_at IS NOT NULL OR is_active = false
--        expired    ⇐ subscription_end IS NOT NULL AND subscription_end < now()
--        active     ⇐ otherwise (subscription_end NULL = no expiry = active)
--      Legacy manually-disabled (is_active=false) tenants therefore read as
--      'suspended' without any data migration.
--
--   2. Backfill the NEW plan feature keys (the sections that shipped after the
--      original feature catalog) onto EVERY existing plan. Today these sections
--      (motivation, installments, cash-shift, work-board, knowledge, purchase
--      orders, loyalty + the marketing integrations) are NOT gated on any client,
--      so they are freely accessible. Adding them to every plan PRESERVES that
--      open access once the client UI wave wraps those screens in FeatureGate —
--      no tenant silently loses a section it uses today. The superadmin can then
--      selectively DISABLE a key on a cheaper tariff to differentiate / upsell.
--      Mirrors the 044_check_photos_all_plans precedent (enable-on-existing).
--      The authoritative key catalog lives in backend/src/plans/feature-catalog.ts
--      and (mirrored) shared/constants/features.ts.
--
-- Idempotent / additive only: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, and a union UPDATE guarded by jsonb containment so a re-run is a no-op.
-- Never edits 001–101.

-- ─── 1. Suspend capability on tenants ───────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- "List currently-suspended tenants" — tiny partial index, only suspended rows.
CREATE INDEX IF NOT EXISTS idx_tenants_suspended
  ON tenants (suspended_at)
  WHERE suspended_at IS NOT NULL;

-- ─── 2. Backfill new feature keys onto every existing plan ──────────────────
-- Union the plan's current feature array with the new keys, de-duplicated. The
-- CASE guards a NULL / non-array `features`; the WHERE containment guard makes
-- the statement a no-op once every key is already present (idempotent re-run).
UPDATE plans p
SET features = (
  SELECT jsonb_agg(DISTINCT key ORDER BY key)
  FROM (
    SELECT jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p.features) = 'array' THEN p.features ELSE '[]'::jsonb END
           ) AS key
    UNION
    SELECT unnest(ARRAY[
      'motivation_view','installments_view','cash_shift_view','work_board_view',
      'knowledge_view','purchase_orders_view','loyalty_view',
      'integration_fiscal','integration_acquiring','integration_messaging','integration_telephony'
    ]) AS key
  ) merged
)
WHERE NOT (COALESCE(p.features, '[]'::jsonb) @> '[
  "motivation_view","installments_view","cash_shift_view","work_board_view",
  "knowledge_view","purchase_orders_view","loyalty_view",
  "integration_fiscal","integration_acquiring","integration_messaging","integration_telephony"
]'::jsonb);
