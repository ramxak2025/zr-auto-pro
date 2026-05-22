-- 038_reminder_settings.sql
CREATE TABLE IF NOT EXISTS reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  months_interval INT NOT NULL DEFAULT 6,
  message_template TEXT NOT NULL DEFAULT 'Уважаемый(ая) {name}, напоминаем, что прошло {months} мес. с последнего визита. Будем рады видеть вас снова!',
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
