-- 101_knowledge_regulation_targets.sql
-- «База знаний» redesign (#54) — regulation TARGETING / audience.
--
-- Owner decision per regulation: «для всех сотрудников» OR a selected subset.
--   * target_all = true  → the regulation concerns EVERY active employee
--     (the historical behaviour — every existing regulation keeps it).
--   * target_all = false → the regulation concerns ONLY the users listed in
--     knowledge_regulation_targets. Non-targeted employees do not see it and are
--     never counted as «должен ознакомиться» (pending ack).
--
-- The «hide an article» capability (#54) is NOT a new column — it reuses the
-- existing `published` flag (063): published=false ⇒ hidden from regular
-- employees, still visible to manager roles, who can un-hide via the existing
-- updateArticle({ published }) toggle. No schema change is needed for hiding.
--
-- target_all defaults to true, so this migration is a no-op for behaviour on
-- every already-existing article/regulation — fully backward compatible.
--
-- Idempotent / additive only: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF
-- NOT EXISTS. Re-runnable on a partially-applied DB. Never edits 001–100.

-- ─── 1. Audience flag on the article ────────────────────────────────────────
-- Consulted only for type='regulation'. true = all employees, false = only the
-- users in knowledge_regulation_targets below.
ALTER TABLE knowledge_articles
  ADD COLUMN IF NOT EXISTS target_all BOOLEAN NOT NULL DEFAULT true;

-- ─── 2. Per-regulation target users ─────────────────────────────────────────
-- One row per (article, user) the regulation is addressed to. Only meaningful
-- when the article's target_all = false. `article_id` is named for consistency
-- with knowledge_acknowledgments.article_id (it references knowledge_articles).
-- ON DELETE CASCADE: deleting the article (or the tenant) drops its targets.
-- No FK to users(id) — same convention as knowledge_acknowledgments.user_id, so
-- removing an employee never blocks; orphan target rows are simply ignored by
-- the audience computation (which joins active, non-superadmin users).
CREATE TABLE IF NOT EXISTS knowledge_regulation_targets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_reg_targets_article
  ON knowledge_regulation_targets (article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_reg_targets_tenant_user
  ON knowledge_regulation_targets (tenant_id, user_id);
