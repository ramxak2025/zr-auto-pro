-- Persist empty folders; service category paths and IDs stay compatible.
CREATE TABLE IF NOT EXISTS service_folders (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (length(btrim(path)) > 0),
  PRIMARY KEY (tenant_id, path)
);
INSERT INTO service_folders (tenant_id,path)
SELECT DISTINCT tenant_id,
  regexp_replace(regexp_replace(regexp_replace(btrim(category), '\s*/\s*', '/', 'g'), '/+', '/', 'g'), '^/|/$', '', 'g')
FROM services WHERE category IS NOT NULL AND regexp_replace(btrim(category), '[\s/]', '', 'g')<>''
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS check_service_lines_service_history_idx ON check_service_lines(service_id,check_id);
ALTER TABLE service_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_folders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
