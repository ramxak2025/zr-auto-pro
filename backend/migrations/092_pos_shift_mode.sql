-- 092_pos_shift_mode.sql
-- «Кассовая смена + роли» — per-tenant POS shift-mode master toggle.
--
-- When false (the default, every existing tenant) the check / payment flow is
-- byte-for-byte unchanged: masters keep creating and closing checks exactly as
-- today. When the owner flips it ON, the backend (ChecksService) starts
-- enforcing the cashier role-gate: a non-cashier (a master WITHOUT the
-- `accept_payment` permission) can only create DEFERRED work-orders and cannot
-- close / take payment — only a cashier (or owner-class role) may close.
--
-- The cashier capability itself is the new `accept_payment` action-permission
-- key. It needs NO schema change: action-permissions live in the existing
-- `users.permissions` JSONB map (set via PATCH /users/:id/permissions). Owner-
-- class roles (director / admin / superadmin) are implicit cashiers in code.
--
-- Mirrors the 070 `shifts_enabled` pattern exactly. Idempotent / additive only
-- (ADD COLUMN IF NOT EXISTS), re-runnable, no data migration, no default change
-- for existing rows (NOT NULL DEFAULT false → every current tenant reads false).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS shift_mode_enabled BOOLEAN NOT NULL DEFAULT false;
