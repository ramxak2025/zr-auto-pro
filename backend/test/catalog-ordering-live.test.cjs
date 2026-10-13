const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ProductsService } = require('../dist/products/products.service');
const { StarterCatalogsService } = require('../dist/starter-catalogs/starter-catalogs.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_RECOVERY_LIVE_DB;
const options = { skip: !live, timeout: 30000 };

async function fixture(work) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55446');
  assert.equal(url.pathname, '/autexa_oct13_recovery');
  const appUrl = new URL(url);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.AUTEXA_RECOVERY_APP_PASSWORD;
  assert.ok(appUrl.password);
  const admin = new Pool({ connectionString: url.toString(), max: 3, statement_timeout: 10000 });
  const app = new Pool({ connectionString: appUrl.toString(), max: 3, statement_timeout: 10000 });
  const pool = new TenantAwarePool(admin, app);
  const tenant = randomUUID(),
    owner = randomUUID(),
    warehouse = randomUUID();
  const actor = { userID: owner, tenantID: tenant, role: 'director', permissions: {} };
  const q = async (sql, args = []) => (await admin.query(sql, args)).rows;
  const run = (fn) => runWithTenant(tenant, fn);
  try {
    await q("INSERT INTO tenants(id,name) VALUES($1,'Catalog ordering isolated QA')", [tenant]);
    await q(
      "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused','Catalog QA','director')",
      [owner, tenant, owner],
    );
    await q("INSERT INTO warehouses(id,tenant_id,name,kind) VALUES($1,$2,'Catalog ordering warehouse','main')", [
      warehouse,
      tenant,
    ]);
    await work({ pool, tenant, owner, warehouse, actor, run, q });
  } finally {
    await q('DELETE FROM tenants WHERE id=$1', [tenant]);
    await pool.end();
  }
}

test('real service catalog pagination returns every equal-name service exactly once', options, async () => {
  await fixture(async ({ pool, tenant, actor, run, q }) => {
    const count = 1205;
    const inserted = await q(
      `INSERT INTO services(tenant_id,name,category,default_price)
      SELECT $1,'Диагностика','Ordering QA/' || n::text,n FROM generate_series(1,$2::int) n RETURNING id`,
      [tenant, count],
    );
    const expected = inserted.map((row) => row.id).sort();
    const services = new ServicesService(pool);
    // The same page sizes used by ServicesScreen/ServicesPage and CheckCreatePage.
    for (const limit of [500, 1000]) {
      const collected = [];
      for (let page = 1; collected.length < count; page++) {
        const result = await run(() => services.getAll(tenant, { page, limit }, actor));
        assert.equal(result.total, count);
        assert.ok(result.data.length > 0);
        collected.push(...result.data.map((row) => row.id));
      }
      assert.equal(
        new Set(collected).size,
        count,
        `limit ${limit}: repeated/missing service IDs despite an unchanged catalog`,
      );
      assert.deepEqual(collected.slice().sort(), expected);
    }
  });
});

test(
  'starter installation and bulk storage-cell removal do not acquire product locks in opposite order',
  options,
  async () => {
    await fixture(async ({ pool, tenant, warehouse, actor, run, q }) => {
      const cell = randomUUID();
      await q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$2,$3,'ORDER-QA')", [
        cell,
        tenant,
        warehouse,
      ]);
      const ids = Array.from({ length: 2000 }, () => randomUUID())
        .sort()
        .reverse();
      await q(
        `INSERT INTO products(id,tenant_id,warehouse_id,storage_cell_id,name,stock,cost_price,sell_price)
      SELECT id,$2,$3,$4,'Ordering QA ' || id::text,10,10,50 FROM unnest($1::uuid[]) id ORDER BY id DESC`,
        [ids, tenant, warehouse, cell],
      );
      const starter = new StarterCatalogsService(pool),
        products = new ProductsService(pool);
      const errors = [];
      const connect = pool.connect.bind(pool);
      let pending;
      pool.connect = async () => {
        const client = await connect(),
          query = client.query.bind(client),
          release = client.release.bind(client);
        client.query = async (...args) => {
          const sql = args[0];
          // Start the real application row-lock queries together. Neither SQL
          // nor its row order is rewritten and no extra row locks are injected.
          if (
            pending &&
            ((/FROM products WHERE tenant_id=\$1 AND warehouse_id=\$2/.test(sql) && /FOR SHARE/.test(sql)) ||
              (/FROM products p/.test(sql) && /ORDER BY p.id FOR UPDATE/.test(sql)))
          ) {
            if (++pending.arrivals === 2) pending.release();
            await pending.promise;
          }
          try {
            return await query(...args);
          } catch (error) {
            errors.push(error.code);
            throw error;
          }
        };
        client.release = (...args) => {
          client.query = query;
          release(...args);
        };
        return client;
      };
      const preview = await run(() =>
        starter.preview(tenant, actor, { directionIds: ['oil_service'], parts: ['services'], warehouseId: warehouse }),
      );
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      const barrier = { arrivals: 0, promise, release };
      pending = barrier;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        release();
      }, 2000);
      let results;
      try {
        results = await Promise.allSettled([
          run(() => starter.install(tenant, actor, { previewId: preview.id })),
          run(() => products.bulkAssignCell(tenant, { productIds: ids, storageCellId: null })),
        ]);
      } finally {
        clearTimeout(timer);
        pending = null;
      }
      assert.equal(timedOut, false, 'both real lock queries must reach the concurrency barrier');
      assert.equal(barrier.arrivals, 2);
      assert.deepEqual(
        results.map((result) => result.status),
        ['fulfilled', 'fulfilled'],
        JSON.stringify(errors),
      );
      assert.equal(errors.includes('40P01'), false);
      assert.equal(results[1].value.updated, ids.length);
      const saved = await q(
        'SELECT storage_cell_id,stock,cost_price,sell_price FROM products WHERE id=ANY($1::uuid[])',
        [ids],
      );
      assert.equal(saved.length, ids.length);
      assert.ok(
        saved.every(
          (row) =>
            row.storage_cell_id === null &&
            Number(row.stock) === 10 &&
            Number(row.cost_price) === 10 &&
            Number(row.sell_price) === 50,
        ),
      );
      const replay = await run(() => starter.install(tenant, actor, { previewId: preview.id }));
      assert.deepEqual(replay, results[0].value);
    });
  },
);
