const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
Logger.overrideLogger(false);

test(
  'PATCH omission preserves service identity and product money snapshots in drafts and closed checks',
  {
    skip: !process.env.OCT10_PRICING_LIVE_DB,
    timeout: 30000,
  },
  async () => {
    const url = new URL(process.env.OCT10_PRICING_LIVE_DB);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55438');
    assert.equal(url.pathname, '/autexa_oct8_test');
    const appUrl = new URL(url);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
    assert.ok(appUrl.password);
    const admin = new Pool({ connectionString: url.toString(), max: 4, statement_timeout: 8000 });
    const app = new Pool({ connectionString: appUrl.toString(), max: 4, statement_timeout: 8000 });
    const pool = new TenantAwarePool(admin, app);
    const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool, undefined));
    const services = new ServicesService(pool);
    const tenant = randomUUID(),
      owner = randomUUID(),
      point = randomUUID();
    const actor = {
      userID: owner,
      tenantID: tenant,
      role: 'director',
      permissions: {},
      pointId: point,
      currentPointId: point,
    };
    const run = (fn) => runWithTenant(tenant, fn);
    const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
    const patch = (id, dto) => run(() => checks.update(id, tenant, 'director', dto, owner, actor));
    const productRows = (id) => q('SELECT * FROM check_product_lines WHERE check_id=$1 ORDER BY id', [id]);
    const serviceRows = (id) => q('SELECT * FROM check_service_lines WHERE check_id=$1 ORDER BY id', [id]);
    try {
      await q("INSERT INTO tenants(id,name,timezone) VALUES($1,'PATCH pricing QA','Europe/Moscow')", [tenant]);
      await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,'QA',true)", [point, tenant]);
      await q(
        "INSERT INTO users(id,tenant_id,phone,password,full_name,role,salary_percent,product_salary_percent) VALUES($1,$2,$3,'unused','Owner','director',10,10)",
        [owner, tenant, owner],
      );
      const warehouse = await run(() => new WarehousesService(pool).resolveByKind(tenant, 'main', point));
      for (const isDeferred of [true, false]) {
        const service = await run(() => services.create(tenant, { name: 'Service', defaultPrice: 100 }, owner));
        const product = (
          await q(
            "INSERT INTO products(tenant_id,warehouse_id,name,sell_price,cost_price,stock) VALUES($1,$2,'Product',100,50,100) RETURNING id",
            [tenant, warehouse.id],
          )
        )[0];
        let check = await run(() =>
          checks.create(
            tenant,
            owner,
            'director',
            {
              masterId: owner,
              isDeferred,
              paymentMethod: 'cash',
              services: [{ serviceId: service.id, masterId: owner, name: 'Service', price: 150 }],
              products: [{ productId: product.id, name: 'Product', sellPrice: 100, costPrice: 50, quantity: 2 }],
            },
            actor,
          ),
        );
        const beforeProducts = await productRows(check.id);
        const beforeProductSalary = check.productSalaryTotal;
        const beforeProductCost = check.productCostTotal;
        const stock = Number((await q('SELECT stock FROM products WHERE id=$1', [product.id]))[0].stock);
        await run(() => services.update(service.id, tenant, { defaultPrice: 700 }, owner));
        await q('UPDATE products SET sell_price=900,cost_price=800 WHERE id=$1', [product.id]);
        await q('UPDATE users SET product_salary_percent=90,salary_percent=90 WHERE id=$1', [owner]);
        check = await patch(check.id, { services: check.services.map((line) => ({ ...line, price: 160 })) });
        assert.deepEqual(await productRows(check.id), beforeProducts, 'omitted product rows/ids are untouched');
        assert.equal(check.productSalaryTotal, beforeProductSalary);
        assert.equal(check.productCostTotal, beforeProductCost);
        assert.equal(check.productTotal, 200);
        assert.equal(Number((await q('SELECT stock FROM products WHERE id=$1', [product.id]))[0].stock), stock);
        assert.equal(check.services[0].priceThreshold, 100);
        const beforeServices = await serviceRows(check.id);
        const beforeSalary = check.serviceSalaryTotal;
        check = await patch(check.id, { products: [] });
        assert.deepEqual(
          await serviceRows(check.id),
          beforeServices,
          'omitted services keep the complete historical row',
        );
        assert.equal(check.serviceSalaryTotal, beforeSalary);
        assert.equal(check.serviceTotal, 160);
        assert.equal(check.services[0].priceThreshold, 100);
        assert.equal(check.services[0].priceExcess, 60);
        assert.equal(check.products.length, 0, 'explicit [] clears products');
        if (isDeferred) {
          check = await patch(check.id, { isDeferred: false });
          assert.deepEqual(
            await serviceRows(check.id),
            beforeServices,
            'bare activation leaves original snapshot/id untouched',
          );
        }
        check = await patch(check.id, {
          products: [{ name: 'Manual product', sellPrice: 1, costPrice: 0, quantity: 1 }],
        });
        check = await patch(check.id, { services: [] });
        assert.equal(check.services.length, 0, 'explicit [] clears services');
        assert.equal(check.products.length, 1, 'omitted products survive explicit service removal');
        await q('UPDATE users SET product_salary_percent=10,salary_percent=10 WHERE id=$1', [owner]);
      }
      // Reapply the exact revised migration only in a rolled-back private schema:
      // PostgreSQL CHECK treats NULL as success unless the type is explicit.
      const tx = await admin.connect();
      try {
        await tx.query('BEGIN');
        const schema = 'price_constraint_' + randomUUID().replaceAll('-', '');
        await tx.query(`CREATE SCHEMA ${schema}`);
        await tx.query(`SET LOCAL search_path TO ${schema}, public`);
        await tx.query('CREATE TABLE check_service_lines(id uuid,price numeric(12,2),quantity int)');
        await tx.query(readFileSync(join(__dirname, '../migrations/186_check_service_price_snapshots.sql'), 'utf8'));
        await tx.query('INSERT INTO check_service_lines(id,price,quantity) VALUES($1,150,1)', [randomUUID()]);
        await tx.query('SAVEPOINT invalid_snapshot');
        await assert.rejects(
          tx.query(`UPDATE check_service_lines SET price_snapshot_status='catalog',
        catalog_price_type=NULL,catalog_default_price=100,catalog_min_price=100,catalog_max_price=100,
        catalog_price_version=1,price_threshold=100`),
          (error) => error.code === '23514',
        );
        await tx.query('ROLLBACK TO SAVEPOINT invalid_snapshot');
        await tx.query(`UPDATE check_service_lines SET price_snapshot_status='catalog',
        catalog_price_type='fixed',catalog_default_price=100,catalog_min_price=100,catalog_max_price=100,
        catalog_price_version=1,price_threshold=100`);
        assert.equal(Number((await tx.query('SELECT price_excess FROM check_service_lines')).rows[0].price_excess), 50);
      } finally {
        await tx.query('ROLLBACK');
        tx.release();
      }
    } finally {
      await q('DELETE FROM tenants WHERE id=$1', [tenant]);
      await pool.end();
    }
  },
);
