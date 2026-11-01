const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../../dist/common/tenant-pool');
const { runWithTenant } = require('../../dist/common/tenant-context');
const { ProductsService } = require('../../dist/products/products.service');
Logger.overrideLogger(false);
const live = process.env.NOV01_SEARCH_LIVE_DB;
const options = { skip: !live, timeout: 30000 };
const status = (n) => (error) => error.getStatus?.() === n;

async function fixture(work, appPoolMax = 5) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '65480');
  assert.equal(url.pathname, '/autexa_nov01_search_test');
  assert.equal(url.username, 'nov01_search_fixture');
  const admin = new Pool({ connectionString: live, max: 5 });
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.NOV01_SEARCH_APP_PASSWORD;
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
  // Seed catalog rows directly: financial opening/receiving behavior has its own fixture.
  const product = async (more = {}) => {
    const id = randomUUID();
    await q(
      `INSERT INTO products(id,tenant_id,warehouse_id,name,cost_price,sell_price,stock,brand,article,barcode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        tenant,
        more.warehouseId ?? main,
        more.name ?? 'Шина',
        more.costPrice ?? 100,
        more.sellPrice ?? 150,
        more.stock ?? 10,
        more.brand ?? '',
        more.article ?? '',
        more.barcode ?? null,
      ],
    );
    return { id };
  };
  try {
    const [identity] = await q('SELECT current_database() AS db,current_user AS usr');
    assert.equal(identity.db, 'autexa_nov01_search_test');
    assert.equal(identity.usr, 'nov01_search_fixture');
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
      product,
    });
  } finally {
    await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
    await pool.end();
  }
}

module.exports = { fixture, options, status };
