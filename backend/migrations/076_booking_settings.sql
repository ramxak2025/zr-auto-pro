-- 076_booking_settings.sql
-- Per-tenant settings for the «Записи» feature. One row per tenant, lazily
-- created with defaults on first read (see BookingsService.getSettings).
--
-- channel: 'auto' = use whatever messaging provider is configured in Маркетинг
-- (messaging_integrations). 'sms' / 'whatsapp' are forward-compat hints; the
-- send path currently uses the active marketing integration regardless.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS booking_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Send the client a «вы записаны» message when a booking is created.
    notify_client_on_create BOOLEAN NOT NULL DEFAULT true,
    -- Send the client a reminder N hours before the appointment.
    reminder_enabled BOOLEAN NOT NULL DEFAULT true,
    reminder_hours INT NOT NULL DEFAULT 2,
    channel TEXT NOT NULL DEFAULT 'auto'
        CHECK (channel IN ('auto','sms','whatsapp')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN notify_client_on_create BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN reminder_enabled BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN reminder_hours INT NOT NULL DEFAULT 2; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN channel TEXT NOT NULL DEFAULT 'auto'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE booking_settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
