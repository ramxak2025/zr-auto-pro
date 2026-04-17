-- Add sort_order to warehouse_categories for custom folder ordering.
DO $$ BEGIN
  ALTER TABLE warehouse_categories ADD COLUMN sort_order INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
