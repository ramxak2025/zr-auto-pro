-- 090_loyalty_accrual_idempotency.sql
-- Идемпотентность начисления бонусов (loyalty accrual idempotency).
--
-- ADDITIVE, append-only. Guarantees AT MOST ONE cashback accrual per заказ-наряд so
-- a repeated POST /loyalty/accrue for the same check (UI retry, double-tap, re-close)
-- can never double-credit a client. The service also pre-checks and uses
-- ON CONFLICT … DO NOTHING; this migration is the DB-level backstop that makes the
-- guarantee hold even under a concurrent race.
--
-- Scope of the constraint: ONLY check-linked accruals (type='accrual' AND
-- check_id IS NOT NULL). Manual accruals (check_id IS NULL) and ALL redemptions stay
-- unconstrained — they are intentional, key-less movements and may legitimately
-- repeat. This NEVER touches `checks`, `clients`, or any write path outside loyalty.
--
-- Idempotent: a defensive de-dup (step 1) leaves nothing to delete on a clean DB /
-- re-run, and the index is CREATE … IF NOT EXISTS. Runs in the default
-- (BEGIN/COMMIT) migration mode. Never edited once applied.

-- 1) Collapse any pre-existing duplicate cashback accruals created by the
--    double-accrual bug, KEEPING the earliest (legitimate) accrual per
--    (tenant_id, check_id). The duplicates erroneously inflated the balance, so
--    removing them RESTORES the correct balance — this is a correctness fix, not a
--    data loss. A re-run finds no duplicates and deletes nothing.
DELETE FROM client_bonuses cb
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, check_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM client_bonuses
   WHERE type = 'accrual' AND check_id IS NOT NULL
) dups
WHERE cb.id = dups.id
  AND dups.rn > 1;

-- 2) Enforce one cashback accrual per заказ-наряд going forward. Partial UNIQUE
--    index — the arbiter for the service's ON CONFLICT (tenant_id, check_id)
--    WHERE type = 'accrual' AND check_id IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_bonuses_accrual_per_check
  ON client_bonuses (tenant_id, check_id)
  WHERE type = 'accrual' AND check_id IS NOT NULL;
