-- Historical check lines deliberately stay unknown. Today's catalogue cannot
-- establish the price policy that applied when those lines were first saved.
ALTER TABLE check_service_lines
    ADD COLUMN price_snapshot_status TEXT NOT NULL DEFAULT 'legacy_unknown',
    ADD COLUMN catalog_price_type TEXT,
    ADD COLUMN catalog_default_price NUMERIC(12,2),
    ADD COLUMN catalog_min_price NUMERIC(12,2),
    ADD COLUMN catalog_max_price NUMERIC(12,2),
    ADD COLUMN catalog_price_version INTEGER,
    ADD COLUMN price_threshold NUMERIC(12,2),
    ADD COLUMN price_changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN price_changed_at TIMESTAMPTZ,
    ADD COLUMN price_excess NUMERIC GENERATED ALWAYS AS (
        CASE WHEN price_snapshot_status = 'catalog' AND price_threshold IS NOT NULL
             THEN GREATEST(0::numeric, ROUND((price - price_threshold) * COALESCE(NULLIF(quantity, 0), 1), 2))
             ELSE 0::numeric END
    ) STORED,
    ADD CONSTRAINT check_service_price_snapshot CHECK (
        (price_snapshot_status IN ('legacy_unknown', 'no_catalog')
         AND catalog_price_type IS NULL AND catalog_default_price IS NULL
         AND catalog_min_price IS NULL AND catalog_max_price IS NULL
         AND catalog_price_version IS NULL AND price_threshold IS NULL)
        OR (price_snapshot_status = 'catalog' AND catalog_price_type IS NOT NULL AND catalog_price_type IN ('fixed', 'range')
            AND catalog_default_price IS NOT NULL AND catalog_min_price IS NOT NULL
            AND catalog_max_price IS NOT NULL AND catalog_price_version IS NOT NULL
            AND price_threshold IS NOT NULL AND catalog_price_version > 0
            AND catalog_min_price >= 0 AND catalog_min_price <> 'NaN'::numeric
            AND catalog_max_price >= catalog_min_price AND catalog_max_price <> 'NaN'::numeric
            AND catalog_default_price = catalog_min_price
            AND (catalog_price_type = 'range' OR catalog_min_price = catalog_max_price)
            AND price_threshold = CASE WHEN catalog_price_type = 'range' THEN catalog_max_price ELSE catalog_default_price END)
    );
