-- 055_user_visibility_flags.sql
-- Feature #5 — Employee visibility controls.
--
-- Two independent boolean flags on `users`, both default false (no behavior
-- change for existing tenants):
--   hidden_from_schedule — employee is omitted from the Schedule grid and the
--                          attendance Rating. Stays elsewhere (cash, salary…).
--   hidden_everywhere    — employee is hidden from ALL contextual lists: not
--                          shown in Schedule, Rating, Employees, and CANNOT be
--                          selected as a master on a new check. Historic checks
--                          already written against them are NOT hidden.
--
-- Filtering is done on the client by context (the API keeps returning the rows
-- so the FE can still resolve names on historic data); the server only persists
-- and surfaces the flags.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hidden_from_schedule BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_everywhere BOOLEAN NOT NULL DEFAULT false;
