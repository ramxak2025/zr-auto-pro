-- 063_knowledge_base.sql
-- «База знаний» (Knowledge Base) — Вариант 2:
--   * searchable KB: categories + articles (markdown body) + attachments
--   * regulations (type='regulation') with per-user acknowledgment
--     ("Ознакомлен" + who-read tracking).
--
-- Multi-tenant: every row carries tenant_id, every query is scoped to the
-- tenant from the JWT.  Categories/articles are lazily seeded per tenant on
-- first read (see KnowledgeService.ensureSeed), like client_sources.
--
-- Idempotent / additive only — CREATE TABLE IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS.  Re-runnable on a partially-applied DB.

-- pg_trgm powers the fast title/body search (ILIKE / similarity).  Already
-- created by migration 004, kept here so this file is self-contained and the
-- GIN indexes below never fail on a fresh DB that somehow skipped 004.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Categories ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT,                       -- an Ionicons name for the UI (nullable)
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_tenant_sort
  ON knowledge_categories (tenant_id, sort_order);

-- ─── Articles & regulations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'article' CHECK (type IN ('article','regulation')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',   -- markdown
  cover_image  TEXT,
  attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of {url,name,size?}
  pinned       BOOLEAN NOT NULL DEFAULT false,
  published    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID,                       -- users.id of the author (nullable, no FK so author deletion never blocks)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tenant_category
  ON knowledge_articles (tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tenant_type
  ON knowledge_articles (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tenant_pinned
  ON knowledge_articles (tenant_id, pinned);

-- Trigram GIN indexes for fast ILIKE / similarity search on title + body.
-- The service searches the raw columns (title ILIKE '%q%' OR body ILIKE '%q%')
-- so the planner can use these GIN indexes — no function wrapping that would
-- defeat them.
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_title_trgm
  ON knowledge_articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_body_trgm
  ON knowledge_articles USING gin (body gin_trgm_ops);

-- ─── Acknowledgments ("Ознакомлен") ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_acknowledgments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id      UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_acks_tenant_user
  ON knowledge_acknowledgments (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_acks_tenant_article
  ON knowledge_acknowledgments (tenant_id, article_id);
