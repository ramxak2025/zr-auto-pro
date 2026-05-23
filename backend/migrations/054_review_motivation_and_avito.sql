-- ============================================================
-- 054: Reviews — motivational message + Avito platform
-- ============================================================
--
-- Goals:
--   1. Owner can set a single "подарок за отзыв" sentence shown to
--      clients on the public review landing page. It also acts as the
--      {motivation} variable inside SMS / WhatsApp templates.
--   2. Avito becomes a first-class review platform alongside Google /
--      Yandex / 2GIS. Constraint expanded so upsert works.
--
-- All statements idempotent — safe to re-run on existing databases.

-- 1. Motivational message column on review_settings.
ALTER TABLE review_settings
  ADD COLUMN IF NOT EXISTS motivation_message TEXT DEFAULT '';

-- 2. Relax CHECK on review_platform_links to include 'avito'.
ALTER TABLE review_platform_links
  DROP CONSTRAINT IF EXISTS review_platform_links_platform_check;
ALTER TABLE review_platform_links
  ADD CONSTRAINT review_platform_links_platform_check
  CHECK (platform IN ('google','yandex','2gis','avito'));
