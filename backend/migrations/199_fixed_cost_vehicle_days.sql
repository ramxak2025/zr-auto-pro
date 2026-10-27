-- New mode only: immutable effective-day snapshots. Monthly rows keep their
-- existing semantics. No check backfill and no synthetic expense/cash records.
ALTER TABLE fixed_costs ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE fixed_costs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='fixed_costs'::regclass AND conname='fixed_costs_mode_check') THEN
    ALTER TABLE fixed_costs ADD CONSTRAINT fixed_costs_mode_check CHECK (mode IN ('monthly','per_vehicle_day'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='fixed_costs'::regclass AND conname='fixed_costs_revision_check') THEN
    ALTER TABLE fixed_costs ADD CONSTRAINT fixed_costs_revision_check CHECK (revision > 0);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_costs_tenant_id_unique ON fixed_costs(tenant_id,id);

CREATE TABLE IF NOT EXISTS fixed_cost_vehicle_history (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fixed_cost_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  effective_from DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0 AND amount <= 100000000),
  active BOOLEAN NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,fixed_cost_id,revision),
  FOREIGN KEY (tenant_id,fixed_cost_id) REFERENCES fixed_costs(tenant_id,id) ON DELETE CASCADE,
  CHECK (NOT archived OR NOT active)
);
CREATE INDEX IF NOT EXISTS fixed_cost_vehicle_effective_idx
  ON fixed_cost_vehicle_history(tenant_id,fixed_cost_id,effective_from DESC,revision DESC);
CREATE TABLE IF NOT EXISTS fixed_cost_requests (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_id)
);
CREATE INDEX IF NOT EXISTS checks_vehicle_days_idx ON checks(tenant_id,date,car_id)
  WHERE is_deferred = false AND deleted_at IS NULL AND client_id IS NOT NULL AND car_id IS NOT NULL;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['fixed_cost_vehicle_history','fixed_cost_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autexa_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO autexa_app', t);
    END IF;
  END LOOP;
END $$;
