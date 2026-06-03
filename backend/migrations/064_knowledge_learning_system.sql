-- 064_knowledge_learning_system.sql
-- Expand «База знаний» (Knowledge Base, 063) into a full learning + reference
-- system:
--   A. Учебный центр — courses → lessons → per-user progress + quizzes +
--      course completion.
--   B. Регламенты+ — versioning of articles, mandatory flag, due date, view
--      count, and per-version acknowledgments + per-article helpful feedback.
--   C. Справочник типовых неисправностей (troubleshooting) — symptom → cause →
--      solution reference with fast pg_trgm search.
--   D. Контекстная KB — articles gain an optional car_make tag so the
--      app can surface make-specific articles for a check/car.
--
-- Multi-tenant: every row carries tenant_id, every query is scoped to the
-- tenant from the JWT. Course/troubleshooting starter rows are lazily seeded
-- per tenant on first read (see KnowledgeService.ensureSeed), advisory-locked.
--
-- Idempotent / additive only — CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN
-- IF NOT EXISTS. Re-runnable on a partially-applied DB. Never edits 001–063.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ════════════════════════════════════════════════════════════════════════════
-- A. Учебный центр — courses / lessons / progress / completion
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  cover_image  TEXT,
  category_id  UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL,
  published    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_by   UUID,                       -- users.id of the author (no FK: author deletion never blocks)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_courses_tenant_sort
  ON knowledge_courses (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS knowledge_lessons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id    UUID NOT NULL REFERENCES knowledge_courses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',   -- markdown
  sort_order   INT NOT NULL DEFAULT 0,
  -- quiz: nullable JSONB array of { question, options[], correctIndex }.
  quiz         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_lessons_course_sort
  ON knowledge_lessons (course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_knowledge_lessons_tenant
  ON knowledge_lessons (tenant_id);

CREATE TABLE IF NOT EXISTS knowledge_lesson_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  lesson_id    UUID NOT NULL REFERENCES knowledge_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_lesson_progress_tenant_user
  ON knowledge_lesson_progress (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_lesson_progress_lesson
  ON knowledge_lesson_progress (lesson_id);

CREATE TABLE IF NOT EXISTS knowledge_course_completion (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  course_id    UUID NOT NULL REFERENCES knowledge_courses(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_course_completion_tenant_user
  ON knowledge_course_completion (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_course_completion_course
  ON knowledge_course_completion (course_id);

-- ════════════════════════════════════════════════════════════════════════════
-- B. Регламенты+ — versioning, mandatory, due date, views, feedback
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS version    INT NOT NULL DEFAULT 1;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS mandatory  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS due_date   TIMESTAMPTZ;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;
-- D. Contextual KB: optional car-make tag so an article can be surfaced for a
-- specific make (e.g. «Lada»). NULL = applies to all makes.
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS car_make   TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tenant_car_make
  ON knowledge_articles (tenant_id, car_make);

-- Acks are now per article VERSION: a new version re-requires acknowledgment.
ALTER TABLE knowledge_acknowledgments ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- Per-article helpful / not-helpful feedback. One vote per user per article.
CREATE TABLE IF NOT EXISTS knowledge_article_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  helpful     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_feedback_article
  ON knowledge_article_feedback (article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_article_feedback_tenant
  ON knowledge_article_feedback (tenant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- C. Справочник типовых неисправностей (troubleshooting)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_troubleshooting (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,              -- short symptom headline
  system       TEXT,                       -- e.g. «Двигатель», «Тормоза» (nullable)
  car_make     TEXT,                       -- nullable; applies to all makes when NULL
  symptom      TEXT NOT NULL DEFAULT '',
  cause        TEXT NOT NULL DEFAULT '',
  solution     TEXT NOT NULL DEFAULT '',   -- markdown
  severity     TEXT CHECK (severity IS NULL OR severity IN ('low','med','high')),
  tags         TEXT[] NOT NULL DEFAULT '{}',
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_troubleshooting_tenant_system
  ON knowledge_troubleshooting (tenant_id, system);
CREATE INDEX IF NOT EXISTS idx_knowledge_troubleshooting_tenant_make
  ON knowledge_troubleshooting (tenant_id, car_make);
CREATE INDEX IF NOT EXISTS idx_knowledge_troubleshooting_tags
  ON knowledge_troubleshooting USING gin (tags);

-- Trigram GIN indexes for fast ILIKE search on the searchable text columns.
-- The service searches the raw columns so the planner can use these.
CREATE INDEX IF NOT EXISTS idx_knowledge_ts_title_trgm
  ON knowledge_troubleshooting USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_ts_symptom_trgm
  ON knowledge_troubleshooting USING gin (symptom gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_ts_cause_trgm
  ON knowledge_troubleshooting USING gin (cause gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_ts_solution_trgm
  ON knowledge_troubleshooting USING gin (solution gin_trgm_ops);
