-- 075_bookings.sql
-- Internal staff-side «Записи» (appointments) feature.
-- Staff books a client for a date/time; client optionally gets an SMS/WhatsApp
-- confirmation + reminder; on arrival the cash screen opens prefilled and the
-- resulting check is linked back here (status='converted'). NOT a public flow.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS so a
-- partially-applied / pre-existing table converges to the full shape.

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- Client is always chosen or created before saving the booking.
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    -- Optional car of that client.
    car_id UUID REFERENCES cars(id) ON DELETE SET NULL,
    -- On whom the booking is. NULLABLE (owner decision): a master booking
    -- defaults to self; an admin/owner may assign any master or leave it
    -- unassigned (a "shared" booking visible only to admin/owner until
    -- someone is assigned). Master visibility = master_id = self.
    master_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Who created the booking row.
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','arrived','converted','cancelled','no_show')),
    -- Set on conversion to the check that was created from the «приход» flow.
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    -- Whether the client confirmation message should be sent on create.
    notify_on_create BOOLEAN NOT NULL DEFAULT true,
    -- Set once the reminder has actually been sent (idempotent — never re-sent).
    reminder_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Safe column adds for any pre-existing `bookings` table.
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN car_id UUID REFERENCES cars(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN master_id UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN scheduled_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN comment TEXT; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN check_id UUID REFERENCES checks(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN notify_on_create BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN reminder_sent_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN cancelled_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE bookings ADD COLUMN cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- Indexes (all tenant-scoped to match every query's leading WHERE tenant_id=$1).
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_scheduled ON bookings (tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_master_scheduled ON bookings (tenant_id, master_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_status ON bookings (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_client ON bookings (tenant_id, client_id);
