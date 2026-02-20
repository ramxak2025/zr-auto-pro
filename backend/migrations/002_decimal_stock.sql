-- Support decimal stock quantities for units like meters (m), liters (l), kilograms (kg)
ALTER TABLE products ALTER COLUMN stock TYPE NUMERIC(12,2) USING stock::NUMERIC(12,2);
ALTER TABLE products ALTER COLUMN min_stock TYPE NUMERIC(12,2) USING min_stock::NUMERIC(12,2);

ALTER TABLE stock_movements ALTER COLUMN quantity TYPE NUMERIC(12,2) USING quantity::NUMERIC(12,2);
ALTER TABLE stock_movements ALTER COLUMN stock_before TYPE NUMERIC(12,2) USING stock_before::NUMERIC(12,2);
ALTER TABLE stock_movements ALTER COLUMN stock_after TYPE NUMERIC(12,2) USING stock_after::NUMERIC(12,2);

ALTER TABLE check_product_lines ALTER COLUMN quantity TYPE NUMERIC(12,2) USING quantity::NUMERIC(12,2);
ALTER TABLE delivery_items ALTER COLUMN quantity TYPE NUMERIC(12,2) USING quantity::NUMERIC(12,2);
