-- 082_checks_work_status.sql
-- Канбан-статус заказ-наряда (work-status board): приёмка → в работе → готов → выдан.
--
-- PURELY ADDITIVE tracking flag, ORTHOGONAL to payment / cash-flow / stock /
-- salary / returns. This migration ONLY adds one nullable column on `checks`
-- (+ a partial index for the board query). It NEVER backfills existing rows:
-- historical checks keep work_status = NULL and simply do not appear on the
-- kanban board (only rows where work_status IS NOT NULL are shown). Nothing in
-- the financial write path reads or writes this column.
--
-- Allowed values (validated at the application layer, not by a DB CHECK so this
-- migration stays a trivially-idempotent ADD COLUMN and the value set can grow
-- without a follow-up DDL migration):
--   'accepted'    — приёмка
--   'in_progress' — в работе
--   'ready'       — готов
--   'delivered'   — выдан
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, so a
-- re-run (or a partially-applied state) converges. Never edited once applied.

ALTER TABLE checks ADD COLUMN IF NOT EXISTS work_status TEXT;

-- Partial index backing GET /checks/board: the board only ever scans the small
-- set of rows that carry a work_status, per tenant, newest-first per column.
-- Partial (WHERE work_status IS NOT NULL) keeps it tiny — the millions of
-- historical NULL rows never enter the index.
CREATE INDEX IF NOT EXISTS idx_checks_tenant_workstatus
  ON checks (tenant_id, work_status)
  WHERE work_status IS NOT NULL;
