-- 068_admin_audit_log.sql
-- Platform-operator (superadmin) audit trail. Every privileged action taken
-- from the SUPERADMIN PLATFORM cabinet against a tenant — toggling active,
-- changing/assigning a plan, extending a subscription, deleting a tenant,
-- impersonating an owner, or sending a broadcast — appends one immutable row
-- here so the owner can answer "who did what, to whom, when".
--
-- Design notes:
--   * actor_name / target_name are DENORMALIZED into the row at write time so
--     GET /admin/audit-log never has to join users/tenants (and so the entry
--     survives the very `tenant_delete` it records — the FK is ON DELETE SET
--     NULL, the human-readable name stays).
--   * detail is a free-form JSONB bag for action-specific context
--     ({days}, {planId, planName}, {tenantId, impersonatedUserId}, …). NOT
--     NULL DEFAULT '{}' so consumers can always read an object.
--   * Writes are best-effort on the application side (a logging failure must
--     never fail the underlying privileged action), hence no extra NOT NULLs
--     beyond `action`.
--
-- Idempotent: CREATE … IF NOT EXISTS for both the table and its index, so
-- re-running the migration (or running it on a DB that already has the table)
-- is a no-op.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,            -- 'tenant_toggle_active' | 'tenant_change_plan' | 'tenant_extend' | 'tenant_delete' | 'impersonate' | 'broadcast'
  target_type   TEXT,                     -- 'tenant' | 'user' | etc.
  target_id     TEXT,
  target_name   TEXT,
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log (created_at DESC);
