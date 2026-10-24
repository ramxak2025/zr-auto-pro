-- Existing rules and posted checks retain their after-discount basis.
ALTER TABLE motivation_rules ADD COLUMN IF NOT EXISTS before_discount BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE check_motivation_snapshots ADD COLUMN IF NOT EXISTS before_discount BOOLEAN NOT NULL DEFAULT false;
