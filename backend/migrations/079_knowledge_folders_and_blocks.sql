-- 079_knowledge_folders_and_blocks.sql
-- «База знаний» redesign extension — backend + API contract only (no UI):
--   1. Category folders / subfolders — knowledge_categories.parent_id, a
--      self-referencing FK with ON DELETE SET NULL: deleting a parent category
--      must NOT cascade-delete its children — they orphan back to the root
--      level instead. Cycles are rejected in the service layer.
--   2. Block-based article content — knowledge_articles.blocks JSONB, an ordered
--      array of interleaved text / heading / image(+caption) / VK-video blocks.
--      The legacy `body` (markdown) column is KEPT for backward compatibility —
--      renderers fall back to it when `blocks` is empty/null. Never dropped.
--
-- Idempotent / additive only: ADD COLUMN IF NOT EXISTS, FK added only when
-- absent (guarded via pg_constraint), CREATE INDEX IF NOT EXISTS. Re-runnable
-- on a partially-applied DB. Never edits an already-applied file (001–078).

-- ─── 1. Category folders / subfolders ───────────────────────────────────────
ALTER TABLE knowledge_categories ADD COLUMN IF NOT EXISTS parent_id UUID;

-- Self-referencing FK. ON DELETE SET NULL — a deleted parent orphans its
-- children to the root, it never cascade-deletes them. Added only if the
-- constraint does not already exist so the migration stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_categories_parent_id_fkey'
  ) THEN
    ALTER TABLE knowledge_categories
      ADD CONSTRAINT knowledge_categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES knowledge_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_tenant_parent
  ON knowledge_categories (tenant_id, parent_id);

-- ─── 2. Block-based article content ─────────────────────────────────────────
-- Ordered JSONB array of blocks (text / heading / image+caption / VK video).
-- NULL or empty → renderers fall back to the markdown `body` (kept, not dropped).
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS blocks JSONB;
