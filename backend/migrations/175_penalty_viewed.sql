-- Recipient read receipts. Existing fines are historical, not fresh alerts.
-- The column guard makes a manual rerun safe for fines issued after rollout.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'salary_penalties' AND column_name = 'viewed_at'
  ) THEN
    -- ADD COLUMN supplies the timestamp to historical rows without an UPDATE
    -- hidden by FORCE ROW LEVEL SECURITY in the migration connection.
    ALTER TABLE salary_penalties ADD COLUMN viewed_at timestamptz DEFAULT now();
    -- Only future fines start unread. The transaction/column guard means a
    -- retry can never mark newly issued fines as read.
    ALTER TABLE salary_penalties ALTER COLUMN viewed_at DROP DEFAULT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS salary_penalties_unviewed_recipient_idx
  ON salary_penalties (tenant_id, user_id, created_at)
  WHERE viewed_at IS NULL;
