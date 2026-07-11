-- Backfill products that ended up with warehouse_id = NULL.
--
-- Root cause: `importCsv` (CSV product import) INSERTed products WITHOUT a
-- warehouse_id, so imported rows landed with warehouse_id = NULL. The default
-- products list view filters on the tenant's "main" warehouse, so those NULL
-- rows were invisible on the warehouse screen even though the import reported
-- success. Confirmed on prod (tenant 7039b7cf): default total=26 vs
-- warehouseId=all total=2581.
--
-- This assigns every orphaned (NULL warehouse, not soft-deleted) product to its
-- tenant's "main" warehouse — modelled on the backfill in
-- 029_products_warehouse.sql:12-18. Idempotent and safe to re-run: after the
-- first run there are no matching rows, so a second run is a no-op. Tenants
-- without a main warehouse yield NULL from the subquery and stay NULL (they get
-- fixed the next time this runs, once a main warehouse exists).

UPDATE products
   SET warehouse_id = (
         SELECT w.id FROM warehouses w
          WHERE w.tenant_id = products.tenant_id AND w.kind = 'main'
          LIMIT 1
       )
 WHERE warehouse_id IS NULL
   AND deleted_at IS NULL;
