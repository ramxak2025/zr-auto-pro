-- A public request is not a booking until an actual employee slot is reserved.
CREATE TABLE IF NOT EXISTS public_booking_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  point_id UUID REFERENCES tenant_points(id),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  published BOOLEAN NOT NULL DEFAULT false,
  settings JSONB NOT NULL,
  consent_version UUID NOT NULL DEFAULT gen_random_uuid(),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS public_booking_page_point ON public_booking_pages(tenant_id,point_id) WHERE point_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS public_booking_page_no_point ON public_booking_pages(tenant_id) WHERE point_id IS NULL;
CREATE TABLE IF NOT EXISTS public_booking_services (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 5 AND 720),
  PRIMARY KEY(page_id,service_id),
  FOREIGN KEY(tenant_id,page_id) REFERENCES public_booking_pages(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public_booking_resources (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(page_id,user_id),
  FOREIGN KEY(tenant_id,page_id) REFERENCES public_booking_pages(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public_booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  point_id UUID REFERENCES tenant_points(id),
  page_id UUID NOT NULL,
  request_id UUID NOT NULL,
  capability_hash TEXT NOT NULL CHECK(length(capability_hash)=64),
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  selected_services JSONB NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 1440),
  starts_at TIMESTAMPTZ NOT NULL,
  resource_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected')),
  consent_version UUID NOT NULL,
  consent_proof JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,request_id),
  FOREIGN KEY(tenant_id,page_id) REFERENCES public_booking_pages(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS public_booking_requests_scope ON public_booking_requests(tenant_id,point_id,status,starts_at);
CREATE TABLE IF NOT EXISTS booking_operation_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  point_id UUID REFERENCES tenant_points(id),
  actor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,request_id)
);
-- The shared first-point history attacher chunks every ledger by its row id.
ALTER TABLE booking_operation_keys ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS booking_operation_keys_id ON booking_operation_keys(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER CHECK(duration_minutes BETWEEN 5 AND 1440);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS public_request_id UUID;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_public_request_tenant_fk
    FOREIGN KEY(tenant_id,public_request_id) REFERENCES public_booking_requests(tenant_id,id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_public_request_once ON bookings(public_request_id) WHERE public_request_id IS NOT NULL;
DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['public_booking_pages','public_booking_services','public_booking_resources','public_booking_requests','booking_operation_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',tbl);
  END LOOP;
END $$;
