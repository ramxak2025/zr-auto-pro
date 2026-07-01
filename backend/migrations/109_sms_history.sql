-- 109_sms_history.sql
-- Formalise the sms_history table (audit round 7, item 9 — schema drift).
--
-- The table is queried by CallsService.getClientSmsHistory / saveSmsToHistory
-- and by ReportsService.getCallFunnel, but was created by NO migration — it
-- exists on prod only historically (hand-created). A fresh install (or a
-- restore into an empty database) breaks those endpoints with
-- `relation "sms_history" does not exist`.
--
-- Column list mirrors EXACTLY what the code selects/inserts:
--   SELECT id, direction, phone, message, status, provider, created_at  (calls)
--   INSERT (tenant_id, client_id, direction, phone, message, status, provider)
--   SELECT COUNT(*), COUNT(DISTINCT phone) ... WHERE tenant_id/created_at (reports)
--
-- IF NOT EXISTS everywhere → a no-op on prod where the table already lives.
-- client_id deliberately has NO FK: prod's historical table has none, and
-- adding one here would make this migration behave differently on prod vs
-- fresh installs. Orphaned client_ids (client deleted) stay as plain UUIDs —
-- getClientSmsHistory simply returns nothing for them.

CREATE TABLE IF NOT EXISTS sms_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id UUID,
    direction TEXT,
    phone TEXT,
    message TEXT,
    status TEXT,
    provider TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- getCallFunnel scans (tenant_id, created_at); getClientSmsHistory reads
-- (tenant_id, client_id) newest-first.
CREATE INDEX IF NOT EXISTS idx_sms_history_tenant_created
    ON sms_history (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_history_tenant_client_created
    ON sms_history (tenant_id, client_id, created_at DESC);
