-- Multi-warehouse foundation.
--
-- Every tenant gets exactly three seeded warehouses on creation:
--   main   — основной склад (где живут товары по умолчанию)
--   defect — склад брака (broken / defective stock awaiting return)
--   used   — склад Б/У     (used / second-hand stock)
--
-- The `UNIQUE (tenant_id, kind)` constraint means a tenant can never have
-- two warehouses of the same kind — there's only one "main", one "defect",
-- one "used". Names are user-editable (e.g. rename "Основной склад" to
-- "Главный филиал"), but the `kind` is system-fixed.

CREATE TABLE IF NOT EXISTS warehouses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('main','defect','used')),
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, kind)
);

CREATE INDEX IF NOT EXISTS warehouses_tenant_idx ON warehouses (tenant_id);

-- Seed three warehouses for every existing tenant. Each INSERT is guarded
-- by NOT EXISTS so re-running the migration (or running it on a tenant
-- that already has its set) is a no-op.
INSERT INTO warehouses (tenant_id, name, kind, sort_order)
SELECT t.id, 'Основной склад', 'main', 0
  FROM tenants t
 WHERE NOT EXISTS (
         SELECT 1 FROM warehouses w
          WHERE w.tenant_id = t.id AND w.kind = 'main'
       );

INSERT INTO warehouses (tenant_id, name, kind, sort_order)
SELECT t.id, 'Склад брака', 'defect', 1
  FROM tenants t
 WHERE NOT EXISTS (
         SELECT 1 FROM warehouses w
          WHERE w.tenant_id = t.id AND w.kind = 'defect'
       );

INSERT INTO warehouses (tenant_id, name, kind, sort_order)
SELECT t.id, 'Склад Б/У', 'used', 2
  FROM tenants t
 WHERE NOT EXISTS (
         SELECT 1 FROM warehouses w
          WHERE w.tenant_id = t.id AND w.kind = 'used'
       );
