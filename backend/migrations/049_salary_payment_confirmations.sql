-- 049_salary_payment_confirmations.sql
-- The employee can confirm "yes, I received it" on a salary payment so
-- the owner sees a per-payment receipt-acknowledgement timestamp. One
-- confirmation per (payment, user) — re-confirming is idempotent via the
-- unique index.

CREATE TABLE IF NOT EXISTS salary_payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES salary_payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_salary_payment_confirmation
  ON salary_payment_confirmations(payment_id, user_id);

CREATE INDEX IF NOT EXISTS idx_salary_payment_confirmations_user
  ON salary_payment_confirmations(user_id);
