-- 070_tenant_shifts_enabled.sql
-- Feature #4/#7 — per-tenant master toggle for the «Смены» (shifts) subsystem.
--
-- When false (the default), the tenant has the shift-tracking feature OFF: no
-- behavior change for existing tenants. Owners flip it on from Настройки
-- компании; the value travels through the existing PATCH /my-company update
-- (Partial<Tenant>) — no new endpoint.
--
-- Idempotent / additive only — ADD COLUMN IF NOT EXISTS, re-runnable.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS shifts_enabled BOOLEAN NOT NULL DEFAULT false;
