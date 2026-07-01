-- @no-transaction
-- 108_clients_phone_dedup.sql
-- Client phone dedup: merge existing duplicates + a DB-level unique constraint
-- (audit round 7, item 4).
--
-- PROBLEM: ClientsService.create() dedups with a SELECT-then-INSERT — two
-- concurrent creates with the same phone both pass the pre-check and both
-- insert (TOCTOU). There is no DB constraint to stop the second one.
--
-- FIX (this file, in order):
--   1) MERGE existing duplicates per (tenant, last-10-digit phone key): keep
--      the client with the EARLIEST created_at, repoint every referencing row
--      (cars, checks, review_*, warranty_claims, bookings, client_debts,
--      client_bonuses, installment_plans, calls, sms_history) to the keeper,
--      then delete the dupes. Every statement is idempotent — a re-run finds
--      nothing left to move.
--   2) CREATE UNIQUE INDEX CONCURRENTLY on the SAME normalized-phone
--      expression migration 104 indexed (and clients.service queries):
--        right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
--      Digit-less phones ('' — e.g. the pinned retail client, migration 053)
--      are EXCLUDED by the partial predicate: '' is "no key", it must never
--      dedup (mirrors phoneSearchKey in common/normalize-phone.ts). clients
--      has no soft-delete column, so no deleted-rows predicate is needed.
--
-- ClientsService.create()/update() now catch unique_violation 23505 on this
-- index and return the SAME 409 CLIENT_PHONE_EXISTS contract as the friendly
-- pre-check — so the race loser gets the normal "клиент уже добавлен" flow.
--
-- NO-TRANSACTION MODE: CREATE/DROP INDEX CONCURRENTLY cannot run inside a
-- transaction block, so this file executes statement-by-statement (see
-- MigrationRunner). Every statement below is individually idempotent; a
-- partial failure is retried safely on the next boot.

-- ── 1) Repoint referencing rows from dupes to their keeper ──────────────────
-- Keeper = earliest created_at (id as the deterministic tie-break) within each
-- (tenant_id, phone-key) group. Rows whose phone has no digits are excluded.

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE cars SET client_id = ranked.keeper_id
  FROM ranked
 WHERE cars.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE checks SET client_id = ranked.keeper_id
  FROM ranked
 WHERE checks.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE review_tokens SET client_id = ranked.keeper_id
  FROM ranked
 WHERE review_tokens.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE review_responses SET client_id = ranked.keeper_id
  FROM ranked
 WHERE review_responses.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE review_jobs SET client_id = ranked.keeper_id
  FROM ranked
 WHERE review_jobs.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE review_alerts SET client_id = ranked.keeper_id
  FROM ranked
 WHERE review_alerts.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE warranty_claims SET client_id = ranked.keeper_id
  FROM ranked
 WHERE warranty_claims.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE bookings SET client_id = ranked.keeper_id
  FROM ranked
 WHERE bookings.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE client_debts SET client_id = ranked.keeper_id
  FROM ranked
 WHERE client_debts.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE client_bonuses SET client_id = ranked.keeper_id
  FROM ranked
 WHERE client_bonuses.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE installment_plans SET client_id = ranked.keeper_id
  FROM ranked
 WHERE installment_plans.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
UPDATE calls SET client_id = ranked.keeper_id
  FROM ranked
 WHERE calls.client_id = ranked.id AND ranked.id <> ranked.keeper_id;

-- sms_history exists on prod historically but is only formalised by migration
-- 109 (runs AFTER this file on a fresh database) — guard the repoint so a
-- fresh install doesn't fail on the missing table. No FK → manual repoint.
DO $$
BEGIN
  IF to_regclass('sms_history') IS NOT NULL THEN
    UPDATE sms_history SET client_id = ranked.keeper_id
      FROM (
        SELECT id,
               first_value(id) OVER (
                 PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
                 ORDER BY created_at ASC NULLS LAST, id ASC
               ) AS keeper_id
          FROM clients
         WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
      ) ranked
     WHERE sms_history.client_id = ranked.id AND ranked.id <> ranked.keeper_id;
  END IF;
END $$;

-- ── 2) Delete the (now unreferenced) duplicate client rows ──────────────────
-- Everything above repointed onto the keeper, so the FK cascades have nothing
-- left to touch. Idempotent: a second run finds no non-keeper rows.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS keeper_id
    FROM clients
   WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> ''
)
DELETE FROM clients
 WHERE id IN (SELECT id FROM ranked WHERE id <> keeper_id);

-- ── 3) The unique constraint ─────────────────────────────────────────────────
-- Drop first: a previously FAILED concurrent build leaves an INVALID index
-- whose name would make IF NOT EXISTS skip the rebuild on retry. This DROP
-- only ever runs on a retry of a failed attempt (success marks the migration
-- applied and it never re-runs).
DROP INDEX CONCURRENTLY IF EXISTS uq_clients_tenant_phone_key;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_clients_tenant_phone_key
    ON clients (tenant_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10))
 WHERE COALESCE(right(regexp_replace(phone, '[^0-9]', '', 'g'), 10), '') <> '';
