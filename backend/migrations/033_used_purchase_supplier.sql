-- System "Покупка б/у товара" supplier.
--
-- Every tenant gets a pinned supplier that represents the act of buying
-- second-hand goods from a client. Selling them later from the Б/У
-- warehouse goes through the normal cash flow; the inverse leg (buying
-- in) is recorded as a delivery from this synthetic supplier.
--
-- Columns added on `suppliers`:
--   is_system — true for rows the user MUST NOT delete / rename
--   kind      — well-known marker; 'used_purchase' is the only value today,
--               but the column is text + a partial unique index so future
--               system kinds (e.g. 'inventory_adjustment') don't collide.
--
-- The migration is idempotent: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE
-- INDEX IF NOT EXISTS, and the seed uses NOT EXISTS so re-running the
-- migration never creates duplicates.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS kind TEXT;

-- Partial unique index — only enforced when `kind IS NOT NULL`, so the
-- thousands of normal suppliers (kind=NULL) are never affected. Stops a
-- tenant from accidentally ending up with two used_purchase rows even if
-- the seed below is run concurrently with another process.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_kind_idx
    ON suppliers (tenant_id, kind)
    WHERE kind IS NOT NULL;

-- Seed one "Покупка б/у товара" supplier per existing tenant. New
-- tenants get this row inserted from TenantsService.create() so the
-- application path doesn't depend on a migration rerun.
INSERT INTO suppliers (tenant_id, name, is_system, kind)
SELECT t.id, 'Покупка б/у товара', true, 'used_purchase'
  FROM tenants t
 WHERE NOT EXISTS (
     SELECT 1 FROM suppliers s
      WHERE s.tenant_id = t.id AND s.kind = 'used_purchase'
 );
