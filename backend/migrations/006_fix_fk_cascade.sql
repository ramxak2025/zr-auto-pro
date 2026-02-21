-- Fix foreign key constraints that are missing ON DELETE CASCADE
-- These prevent tenant deletion when related data exists

-- checks.master_id -> users(id)
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_master_id_fkey;
ALTER TABLE checks ADD CONSTRAINT checks_master_id_fkey
  FOREIGN KEY (master_id) REFERENCES users(id) ON DELETE SET NULL;

-- checks.client_id -> clients(id)
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_client_id_fkey;
ALTER TABLE checks ADD CONSTRAINT checks_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- checks.car_id -> cars(id)
ALTER TABLE checks DROP CONSTRAINT IF EXISTS checks_car_id_fkey;
ALTER TABLE checks ADD CONSTRAINT checks_car_id_fkey
  FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE SET NULL;

-- check_service_lines.service_id -> services(id)
ALTER TABLE check_service_lines DROP CONSTRAINT IF EXISTS check_service_lines_service_id_fkey;
ALTER TABLE check_service_lines ADD CONSTRAINT check_service_lines_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;

-- check_service_lines.master_id -> users(id)
ALTER TABLE check_service_lines DROP CONSTRAINT IF EXISTS check_service_lines_master_id_fkey;
ALTER TABLE check_service_lines ADD CONSTRAINT check_service_lines_master_id_fkey
  FOREIGN KEY (master_id) REFERENCES users(id) ON DELETE SET NULL;

-- check_product_lines.product_id -> products(id)
ALTER TABLE check_product_lines DROP CONSTRAINT IF EXISTS check_product_lines_product_id_fkey;
ALTER TABLE check_product_lines ADD CONSTRAINT check_product_lines_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- delivery_items.product_id -> products(id)
ALTER TABLE delivery_items DROP CONSTRAINT IF EXISTS delivery_items_product_id_fkey;
ALTER TABLE delivery_items ADD CONSTRAINT delivery_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
