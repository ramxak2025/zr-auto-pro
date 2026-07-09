-- 127_moizvonki_sms_toggle.sql
-- ADDITIVE: independent on/off switch for CLIENT SMS sent through a messaging
-- integration, decoupled from the integration's own `is_active` flag.
--
-- Motivation: the «Мои Звонки» (moizvonki) integration is BOTH a call-tracking
-- source (calls.service getCalls) AND a selectable SMS channel (MoiZvonkiAdapter
-- → calls.send_sms). Today turning SMS off means turning the WHOLE integration
-- off (is_active=false), which also stops call sync. The owner wants to keep the
-- calls integration live while independently muting outbound client SMS.
--
-- This column gates ONLY the outbound-SMS path (guardAndLogSend adapter
-- resolution). is_active keeps its existing meaning: whether the integration is
-- connected/usable at all (call listing, being a candidate channel). When
-- sms_notifications_enabled=false the integration stays connected and calls keep
-- syncing, but it is skipped as an SMS sender (treated as "no provider" for that
-- send). DEFAULT true preserves the current behaviour for every existing row.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a safe DO-block backfill for any row
-- created before the DEFAULT existed. Never edited once applied.

ALTER TABLE messaging_integrations
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- Belt-and-braces backfill: any pre-existing NULL (e.g. if the column had been
-- added earlier without the NOT NULL DEFAULT) converges to true = current
-- behaviour preserved. No-op on a freshly-added NOT NULL DEFAULT true column.
DO $$
BEGIN
  UPDATE messaging_integrations SET sms_notifications_enabled = true
   WHERE sms_notifications_enabled IS NULL;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  NULL;
END $$;
