const { approvedFixture } = require('./nov01-fixture-identity.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../../dist/common/tenant-pool');
const { runWithTenant } = require('../../dist/common/tenant-context');
const { ProductsService } = require('../../dist/products/products.service');
const { ProductSharingService } = require('../../dist/products/product-sharing.service');
const { UsedIntakeService } = require('../../dist/products/used-intake.service');
const { WarehousesService } = require('../../dist/warehouses/warehouses.service');
const { StockMovementsService } = require('../../dist/stock-movements/stock-movements.service');
Logger.overrideLogger(false);
const live = process.env.NOV01_INVENTORY_LIVE_DB;
const options = { skip: !live, timeout: 30000 };
const status = (n) => (error) => error.getStatus?.() === n;

async function fixture(work, appPoolMax = 5) {
  const expected = approvedFixture(live, 'inventory');
  const admin = new Pool({ connectionString: live, max: 5 });
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.NOV01_INVENTORY_APP_PASSWORD;
  const app = new Pool({ connectionString: appUrl.toString(), max: appPoolMax, connectionTimeoutMillis: 750 });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const tenant = randomUUID(),
    foreign = randomUUID(),
    owner = randomUUID(),
    other = randomUUID();
  const point = randomUUID(),
    secondPoint = randomUUID(),
    main = randomUUID(),
    used = randomUUID(),
    secondWh = randomUUID();
  const actor = { tenantID: tenant, userID: owner, role: 'director', permissions: {}, currentPointId: point };
  const run = (fn) => runWithTenant(tenant, fn);
  const products = new ProductsService(pool, undefined);
  const warehouses = new WarehousesService(pool);
  const movements = new StockMovementsService(pool, warehouses);
  const intake = new UsedIntakeService(pool, products, movements, warehouses);
  const sharing = new ProductSharingService(pool, {});
  const oldEnabled = process.env.INVENTORY_PREVIEW_ENABLED,
    oldTenants = process.env.INVENTORY_PREVIEW_TENANTS;
  process.env.INVENTORY_PREVIEW_ENABLED = 'true';
  process.env.INVENTORY_PREVIEW_TENANTS = tenant;
  const product = async (more = {}) =>
    run(() =>
      products.create(
        tenant,
        { name: 'Шина', warehouseId: main, costPrice: 100, sellPrice: 150, stock: 10, ...more },
        point,
      ),
    );
  let verified = false;
  try {
    const [identity] = await q('SELECT current_database() AS db,current_user AS usr');
    assert.equal(identity.db, expected.database);
    assert.equal(identity.usr, expected.role);
    verified = true;
    assert.equal(
      (await app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0].rolbypassrls,
      false,
    );
    await q("INSERT INTO tenants(id,name) VALUES($1,'Nov01 fixture'),($2,'Nov01 foreign')", [tenant, foreign]);
    await q(
      "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$3::uuid,$1::uuid::text,'unused','Owner','director'),($2::uuid,$3::uuid,$2::uuid::text,'unused','Other','master')",
      [owner, other, tenant],
    );
    await q("INSERT INTO tenant_points(id,tenant_id,name) VALUES($1,$3,'Point A'),($2,$3,'Point B')", [
      point,
      secondPoint,
      tenant,
    ]);
    await q(
      "INSERT INTO warehouses(id,tenant_id,point_id,name,kind) VALUES($1,$4,$5,'Main','main'),($2,$4,$5,'Used','used'),($3,$4,$6,'Other','main')",
      [main, used, secondWh, tenant, point, secondPoint],
    );
    await work({
      q,
      pool,
      tenant,
      foreign,
      owner,
      other,
      point,
      secondPoint,
      main,
      used,
      secondWh,
      actor,
      run,
      products,
      movements,
      intake,
      sharing,
      product,
    });
  } finally {
    if (verified) await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
    await pool.end();
    if (oldEnabled === undefined) delete process.env.INVENTORY_PREVIEW_ENABLED;
    else process.env.INVENTORY_PREVIEW_ENABLED = oldEnabled;
    if (oldTenants === undefined) delete process.env.INVENTORY_PREVIEW_TENANTS;
    else process.env.INVENTORY_PREVIEW_TENANTS = oldTenants;
  }
}

module.exports = { fixture, options, status };
