-- Enums as text checks

-- Plans / Tariffs
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    description TEXT,
    features JSONB DEFAULT '[]',
    max_users INT DEFAULT 5,
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT,
    phone TEXT,
    address TEXT,
    email TEXT,
    description TEXT,
    logo TEXT,
    is_active BOOLEAN DEFAULT true,
    max_users INT DEFAULT 10,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    monthly_price NUMERIC(10,2) DEFAULT 0,
    subscription_end TIMESTAMPTZ,
    subscription_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add new columns to existing tenants table (safe migration)
DO $$ BEGIN
    ALTER TABLE tenants ADD COLUMN plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE tenants ADD COLUMN monthly_price NUMERIC(10,2) DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE tenants ADD COLUMN subscription_end TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE tenants ADD COLUMN subscription_note TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Clean up duplicate slugs before creating unique index (keep oldest tenant for each slug)
DO $$ BEGIN
    UPDATE tenants SET slug = NULL
    WHERE slug IS NOT NULL
      AND id NOT IN (
        SELECT DISTINCT ON (slug) id FROM tenants WHERE slug IS NOT NULL ORDER BY slug, created_at ASC
      );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Unique index on slug to prevent duplicate tenants in seed (safe — won't crash if dupes remain)
DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug_unique ON tenants(slug) WHERE slug IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create unique slug index, continuing without it';
END $$;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'master' CHECK (role IN ('superadmin','director','admin','master')),
    salary_percent NUMERIC(5,2) DEFAULT 0,
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add new columns to existing users table (safe migration for pre-existing DB)
DO $$ BEGIN ALTER TABLE users ADD COLUMN permissions JSONB DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN salary_percent NUMERIC(5,2) DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN username TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    comment TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_number TEXT NOT NULL,
    make_model TEXT NOT NULL,
    comment TEXT,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT,
    default_price NUMERIC(12,2) DEFAULT 0,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT,
    photo TEXT,
    cost_price NUMERIC(12,2) DEFAULT 0,
    sell_price NUMERIC(12,2) DEFAULT 0,
    stock INT DEFAULT 0,
    min_stock INT DEFAULT 0,
    supplier_id UUID,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number SERIAL,
    date TIMESTAMPTZ DEFAULT now(),
    master_id UUID REFERENCES users(id),
    client_id UUID REFERENCES clients(id),
    car_id UUID REFERENCES cars(id),
    mileage INT,
    comment TEXT,
    discount NUMERIC(12,2) DEFAULT 0,
    is_deferred BOOLEAN DEFAULT false,
    payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash','card','warranty','cash_card')),
    service_total NUMERIC(12,2) DEFAULT 0,
    product_total NUMERIC(12,2) DEFAULT 0,
    total_revenue NUMERIC(12,2) DEFAULT 0,
    product_cost_total NUMERIC(12,2) DEFAULT 0,
    service_salary_total NUMERIC(12,2) DEFAULT 0,
    total_cost NUMERIC(12,2) DEFAULT 0,
    profit NUMERIC(12,2) DEFAULT 0,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS check_service_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id UUID REFERENCES checks(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    master_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    price NUMERIC(12,2) DEFAULT 0,
    quantity INT DEFAULT 1,
    total NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS check_product_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id UUID REFERENCES checks(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    name TEXT NOT NULL,
    sell_price NUMERIC(12,2) DEFAULT 0,
    cost_price NUMERIC(12,2) DEFAULT 0,
    quantity INT DEFAULT 1,
    total_sell NUMERIC(12,2) DEFAULT 0,
    total_cost NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    contact_person TEXT,
    comment TEXT,
    total_purchases NUMERIC(12,2) DEFAULT 0,
    total_paid NUMERIC(12,2) DEFAULT 0,
    current_debt NUMERIC(12,2) DEFAULT 0,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    date TIMESTAMPTZ DEFAULT now(),
    total_amount NUMERIC(12,2) DEFAULT 0,
    payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
    comment TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    quantity INT DEFAULT 0,
    price NUMERIC(12,2) DEFAULT 0,
    total NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) DEFAULT 0,
    date TIMESTAMPTZ DEFAULT now(),
    comment TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income','expense','writeoff','inventory')),
    quantity INT DEFAULT 0,
    stock_before INT DEFAULT 0,
    stock_after INT DEFAULT 0,
    reason TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    opened_at TIMESTAMPTZ DEFAULT now(),
    closed_at TIMESTAMPTZ,
    is_auto_closed BOOLEAN DEFAULT false,
    note TEXT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_start TEXT,
    shift_end TEXT,
    is_day_off BOOLEAN DEFAULT false,
    actual_arrival TIMESTAMPTZ,
    late_minutes INT DEFAULT 0,
    late_status TEXT CHECK (late_status IN ('on_time','late_minor','late_major')),
    note TEXT,
    is_manual_override BOOLEAN DEFAULT false,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_modes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT DEFAULT 'rotating' CHECK (type IN ('rotating','weekly')),
    work_days INT DEFAULT 2,
    off_days INT DEFAULT 2,
    week_days JSONB DEFAULT '[]',
    shift_start TEXT DEFAULT '09:00',
    shift_end TEXT DEFAULT '18:00',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cars_tenant ON cars(tenant_id);
CREATE INDEX IF NOT EXISTS idx_checks_tenant ON checks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_checks_date ON checks(date);
CREATE INDEX IF NOT EXISTS idx_checks_master ON checks(master_id);
CREATE INDEX IF NOT EXISTS idx_checks_client ON checks(client_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
