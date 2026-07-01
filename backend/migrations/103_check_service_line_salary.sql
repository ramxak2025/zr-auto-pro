-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 103: per-line service salary amount (fix #56 — attribute service
--                salary to the LINE's executor, not the check creator)
--
-- CONTEXT
-- -------
-- Service salary is BAKED at check-close into checks.service_salary_total, and
-- every salary read (SalaryService.getAll / getMy / getEmployeeMonth) attributes
-- that whole per-check total to checks.master_id (the check CREATOR). But each
-- service line already stores its own executor in check_service_lines.master_id
-- and its salary was computed with THAT master's percent. So the money was
-- computed per-line-correctly but ATTRIBUTED to the wrong person.
--
-- This migration adds a per-line baked salary amount so the reads can sum by the
-- line's executor (COALESCE(line.master_id, check.master_id)). Going forward the
-- app writes salary_amount on every insert; here we BACKFILL existing lines.
--
-- BACKFILL (money-safe, byte-identical for the untouched set)
-- -----------------------------------------------------------
-- We do NOT recompute history from today's percents (a percent may have changed
-- since the check closed — that would silently rewrite a past month's total).
-- Instead we DISTRIBUTE each check's already-baked service_salary_total across
-- its lines, weighted by each line's current percent×total, and put the rounding
-- residual on a single anchor line. Guarantees per check:
--     Σ salary_amount  ==  service_salary_total   (exactly — no money invented/lost)
-- so a check with NO distinct per-line executor (every line's executor = the
-- check master) still funnels the exact same total to the check master → the
-- salary reads stay byte-identical. A check WITH a distinct executor now splits
-- the (unchanged) total between the executors — the retroactive #56 fix.
--
-- Idempotent: adds the column only if missing; the backfill only touches rows
-- whose salary_amount IS NULL (i.e. never-backfilled). The whole file runs inside
-- the migration runner's transaction.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) The per-line baked service-salary amount. NULLABLE with NO default so we can
--    tell "not yet backfilled" (NULL) from a legitimately-zero salary (0). The
--    ADD COLUMN is metadata-only (no table rewrite, no default) → no long lock.
ALTER TABLE check_service_lines ADD COLUMN IF NOT EXISTS salary_amount NUMERIC(12,2);

-- 2) Index the executor so the per-line attribution grouping (salary reads) and
--    the journal "am I an executor here" check (#59) don't seq-scan.
CREATE INDEX IF NOT EXISTS idx_check_service_lines_master ON check_service_lines(master_id);

-- 3) Backfill every existing line (salary_amount IS NULL) by distributing each
--    check's baked service_salary_total across its lines.
WITH base AS (
  SELECT
    sl.id                                   AS line_id,
    sl.check_id                             AS check_id,
    COALESCE(c.service_salary_total, 0)::numeric AS baked,
    COALESCE(sl.total, 0)::numeric          AS line_total,
    -- Current effective percent for the line: a per-service override (services
    -- .master_percent, when set) wins over the line executor's user percent.
    -- Mirrors the precedence in ChecksService.create().
    CASE
      WHEN svc.master_percent IS NOT NULL THEN svc.master_percent
      ELSE COALESCE(lm.salary_percent, 0)
    END::numeric                            AS pct,
    -- Prefer a check-master line as the residual anchor so the leftover cent
    -- stays with the check master (keeps no-per-line-executor checks exact).
    CASE WHEN COALESCE(sl.master_id, c.master_id) = c.master_id THEN 1 ELSE 0 END AS is_master_line
  FROM check_service_lines sl
  JOIN checks c              ON c.id = sl.check_id
  LEFT JOIN services svc     ON svc.id = sl.service_id AND svc.tenant_id = c.tenant_id
  LEFT JOIN users lm         ON lm.id = COALESCE(sl.master_id, c.master_id) AND lm.tenant_id = c.tenant_id
  WHERE sl.salary_amount IS NULL
),
weighted AS (
  SELECT base.*, (base.line_total * base.pct / 100.0) AS raw_share
  FROM base
),
sums AS (
  SELECT check_id,
         SUM(raw_share)  AS sum_raw,
         SUM(line_total) AS sum_total,
         MAX(baked)      AS baked
  FROM weighted
  GROUP BY check_id
),
alloc AS (
  SELECT
    w.line_id,
    w.check_id,
    -- Proportional slice of the baked total: by percent-weight when any line
    -- carries a percent, else by line total, else nothing (residual dumps it
    -- all on the anchor). ROUND to money precision; the residual reconciles.
    ROUND(
      CASE
        WHEN s.sum_raw   > 0 THEN s.baked * w.raw_share  / s.sum_raw
        WHEN s.sum_total > 0 THEN s.baked * w.line_total / s.sum_total
        ELSE 0
      END, 2) AS share,
    ROW_NUMBER() OVER (
      PARTITION BY w.check_id
      ORDER BY w.is_master_line DESC, w.line_total DESC, w.line_id
    ) AS rn
  FROM weighted w
  JOIN sums s ON s.check_id = w.check_id
),
alloc_sums AS (
  SELECT check_id, SUM(share) AS sum_share, MAX(baked) AS baked
  FROM (
    SELECT a.check_id, a.share, s.baked
    FROM alloc a JOIN sums s ON s.check_id = a.check_id
  ) t
  GROUP BY check_id
)
UPDATE check_service_lines t
SET salary_amount = a.share
    + CASE WHEN a.rn = 1 THEN (asum.baked - asum.sum_share) ELSE 0 END
FROM alloc a
JOIN alloc_sums asum ON asum.check_id = a.check_id
WHERE t.id = a.line_id;
