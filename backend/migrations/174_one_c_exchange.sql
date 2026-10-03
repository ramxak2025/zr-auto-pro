-- UNF 3 bridge pilot. No exchange is enabled by migration or connection creation.
CREATE TABLE IF NOT EXISTS one_c_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  point_id UUID NOT NULL REFERENCES tenant_points(id),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused','active')),
  configuration TEXT NOT NULL DEFAULT 'UNF3' CHECK (configuration = 'UNF3'),
  mapping_confirmed BOOLEAN NOT NULL DEFAULT false,
  capabilities JSONB NOT NULL DEFAULT '{}',
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS one_c_mappings (
  connection_id UUID NOT NULL REFERENCES one_c_connections(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('products','stock','clients','purchases','workOrders','payments')),
  external_id TEXT NOT NULL,
  autexa_id UUID NOT NULL,
  revision TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, entity_type, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_c_mapping_entity_unique
  ON one_c_mappings(connection_id, entity_type, autexa_id)
  WHERE entity_type IN ('products','clients','purchases','workOrders','payments');
CREATE TABLE IF NOT EXISTS one_c_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES one_c_connections(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('products','stock','clients','purchases','workOrders','payments')),
  external_id TEXT NOT NULL,
  autexa_id UUID,
  direction TEXT NOT NULL CHECK (direction IN ('import','export')),
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','applied','needs_review','rejected','exported')),
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, direction, event_id)
);
CREATE INDEX IF NOT EXISTS one_c_events_journal ON one_c_events(tenant_id, created_at DESC, id DESC);
-- Explicit tenant policies are defense in depth behind key/JWT guards.
DO $$ DECLARE tab TEXT; BEGIN
  FOREACH tab IN ARRAY ARRAY['one_c_connections','one_c_mappings','one_c_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tab);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tab AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tab);
    END IF;
  END LOOP;
END $$;
