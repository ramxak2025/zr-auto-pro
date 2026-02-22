-- ============================================================
-- 007: Marketing — Reputation Management System
-- ============================================================

-- Messaging provider integrations per tenant
CREATE TABLE IF NOT EXISTS messaging_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('whatsapp','sms','email')),
    api_key TEXT NOT NULL,
    sender_name TEXT,
    sender_phone TEXT,
    webhook_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Review platform links per tenant (Google Maps, Yandex, 2GIS)
CREATE TABLE IF NOT EXISTS review_platform_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('google','yandex','2gis')),
    url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, platform)
);

-- Tenant review settings
CREATE TABLE IF NOT EXISTS review_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    send_time TEXT DEFAULT '20:00',
    feedback_delay_hours INTEGER DEFAULT 2,
    auto_send_enabled BOOLEAN DEFAULT true,
    message_template TEXT DEFAULT 'Здравствуйте, {clientName}! Спасибо за визит в {tenantName}. Оцените качество обслуживания: {reviewLink}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Review tokens (secure links sent to customers)
CREATE TABLE IF NOT EXISTS review_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Review responses (customer feedback)
CREATE TABLE IF NOT EXISTS review_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    check_id UUID REFERENCES checks(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    redirected_to TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Scheduled review jobs (PG-based job queue)
CREATE TABLE IF NOT EXISTS review_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    client_phone TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','skipped')),
    attempts INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(check_id)
);

-- Review alerts (negative feedback alerts for owner)
CREATE TABLE IF NOT EXISTS review_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('consecutive_negative','churn_risk')),
    details JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messaging_integrations_tenant ON messaging_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_platform_links_tenant ON review_platform_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_tokens_token ON review_tokens(token);
CREATE INDEX IF NOT EXISTS idx_review_tokens_tenant ON review_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_tenant ON review_responses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_employee ON review_responses(employee_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_created ON review_responses(created_at);
CREATE INDEX IF NOT EXISTS idx_review_jobs_status ON review_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_review_jobs_tenant ON review_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_alerts_tenant ON review_alerts(tenant_id, is_read);
