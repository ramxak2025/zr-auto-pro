-- 087_messaging_telegram_and_car_ready.sql
-- ADDITIVE: (1) Telegram + WhatsApp Cloud API config for the EXISTING messaging
-- layer (messaging_integrations, 007/008), and (2) the per-tenant «машина
-- готова» (car-ready) auto-notification settings.
--
-- This migration NEVER touches the financial / checks write path. The only link
-- to checks is read-only at runtime (the notification reads number/car/phone to
-- build a message); no column on `checks` is added or changed here.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-ADD, ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS + DO-block safe column adds. Re-running converges.
-- Never edited once applied.

-- ── 1. Telegram as a selectable provider ────────────────────────────────────
-- Widen the existing provider_type CHECK (last set by 008) to also allow
-- 'telegram'. Drop-then-add keeps it idempotent (same pattern as 008). Existing
-- rows ('whatsapp','sms','smsru','moizvonki','email') stay valid.
ALTER TABLE messaging_integrations DROP CONSTRAINT IF EXISTS messaging_integrations_provider_type_check;
ALTER TABLE messaging_integrations ADD CONSTRAINT messaging_integrations_provider_type_check
  CHECK (provider_type IN ('whatsapp','sms','smsru','moizvonki','email','telegram'));

-- ── 2. Extra provider config columns (nullable, inert until set) ─────────────
-- Existing providers ignore these; only the new adapters read them:
--   • telegram_chat_id  — Telegram target chat (owner/staff). Telegram cannot DM
--                         an arbitrary phone, so Telegram notifications go to
--                         this configured chat. NULL ⇒ Telegram adapter is inert.
--   • phone_number_id   — WhatsApp Cloud API phoneNumberId (the {phoneNumberId}
--                         path segment in graph.facebook.com/.../{id}/messages).
--                         The Bearer token reuses the existing `api_key` column.
--                         NULL ⇒ WhatsApp Cloud adapter is inert.
ALTER TABLE messaging_integrations ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE messaging_integrations ADD COLUMN IF NOT EXISTS phone_number_id TEXT;

-- ── 3. «Машина готова» (car-ready) per-tenant notification settings ──────────
-- One row per tenant (mirrors loyalty_settings, 083): a master switch + the
-- message template with {number}/{car} placeholders. Upserted-on-read by the
-- service (a missing row is fine — defaults below apply). Disabled by default,
-- so the feature is fully inert until the owner turns it on.
CREATE TABLE IF NOT EXISTS car_ready_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    -- Master switch. While false, setWorkStatus→'ready' sends nothing.
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- Template sent to the client. {number} = order number, {car} = make/model
    -- + plate. {clientName} also supported.
    message_template TEXT NOT NULL DEFAULT 'Здравствуйте! Ваш автомобиль {car} готов. Заказ-наряд №{number}. Будем рады видеть вас!',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe column adds for any pre-existing car_ready_settings table.
DO $$ BEGIN ALTER TABLE car_ready_settings ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE car_ready_settings ADD COLUMN message_template TEXT NOT NULL DEFAULT 'Здравствуйте! Ваш автомобиль {car} готов. Заказ-наряд №{number}. Будем рады видеть вас!'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE car_ready_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
