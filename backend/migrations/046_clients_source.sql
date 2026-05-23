-- 046_clients_source.sql
-- Per-client acquisition source tag + free-form owner notes, plus a
-- tenant-scoped configuration row that holds the editable list of sources
-- the owner can pick from (Яндекс, 2GIS, Авито, ...).
--
-- Why a separate `client_sources` table instead of `source_options TEXT[]`
-- on `tenants`: owners frequently add/remove their own channels (e.g.
-- "Партнёр", "Радио"), and we want the configuration in its own row that
-- can be cached / served independently from the heavy tenants row.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS owner_notes TEXT;

-- Partial index — only rows with a non-null source benefit from the index,
-- the rest is just empty noise.
CREATE INDEX IF NOT EXISTS idx_clients_source
  ON clients(tenant_id, source) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  sources TEXT[] NOT NULL DEFAULT ARRAY[
    'Яндекс','2GIS','Google','Авито','ВКонтакте','Instagram','Мимо проезжал','По рекомендации'
  ],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
