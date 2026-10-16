// Explicit disposable PostgreSQL 16 fixtures only; never use DATABASE_URL as a fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { ProductsService } = require('../dist/products/products.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
Logger.overrideLogger(false);
const live = process.env.OCT16_INVENTORY_LIVE_DB;
const localUrl = 'postgresql://oct16_fixture@127.0.0.1:60984/autexa_oct16_inventory_test';
const ciUrl = 'postgresql://oct8_fixture:oct8_fixture_only@127.0.0.1:55438/autexa_oct8_test';
const jobs = new AsyncLocalStorage();
const status = (n, code) => (e) => e.getStatus?.() === n && (!code || e.getResponse().code === code);
const options = { skip: !live, timeout: 30000 };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return true;
    await new Promise((done) => setTimeout(done, 10));
  }
  return false;
}

// Pause a real write, observe the second connection waiting in PostgreSQL,
// then release. No SQL is rewritten and no timing-only overlap is assumed.
async function concurrent(f, first, second) {
  const release = deferred();
  let firstPid, secondPid, secondTask, results;
  f.setHook(async ({ stage, sql, job, pid }) => {
    if (job === 'first' && stage === 'after' && /^UPDATE products SET stock=/.test(sql)) {
      firstPid = pid;
      await release.promise;
    }
    if (job === 'second' && stage === 'before' && /pg_advisory_xact_lock/.test(sql)) secondPid = pid;
  });
  const outcome = (job, work) =>
    jobs.run(job, work).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    );
  const firstTask = outcome('first', first);
  try {
    assert.ok(await until(() => firstPid), 'first request must reach the real stock write');
    secondTask = outcome('second', second);
    assert.ok(await until(() => secondPid), 'second request must reach the locking transaction');
    assert.ok(
      await until(
        async () =>
          (await f.q('SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked', [secondPid, firstPid]))[0].blocked,
      ),
      'PostgreSQL must observe the concurrent request blocked',
    );
  } finally {
    release.resolve();
    results = await Promise.all([firstTask, ...(secondTask ? [secondTask] : [])]);
    f.setHook(null);
  }
  return results;
}

function approvedFixture(url) {
  if (url === localUrl)
    return { database: 'autexa_oct16_inventory_test', role: 'oct16_fixture', password: 'oct16_fixture_app_only' };
  if (url === ciUrl) return { database: 'autexa_oct8_test', role: 'oct8_fixture', password: 'oct8_app_fixture_only' };
  throw new Error('Only the explicitly approved local or CI disposable inventory fixture may be mutated');
}

async function fixture(work) {
  const expected = approvedFixture(live);
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = expected.password;
  const admin = new Pool({ connectionString: live, max: 6, statement_timeout: 10000, connectionTimeoutMillis: 3000 });
  const app = new Pool({
    connectionString: appUrl.toString(),
    max: 6,
    statement_timeout: 10000,
    connectionTimeoutMillis: 3000,
  });
  const pool = new TenantAwarePool(admin, app);
  const service = new ProductsService(pool, undefined);
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const tenant = randomUUID(),
    foreign = randomUUID(),
    owner = randomUUID(),
    otherActor = randomUUID();
  const point = randomUUID(),
    otherPoint = randomUUID(),
    warehouse = randomUUID(),
    movedWarehouse = randomUUID();
  const otherWarehouse = randomUUID(),
    foreignWarehouse = randomUUID(),
    foreignActor = randomUUID();
  const run = (fn) => runWithTenant(tenant, fn);
  let verified = false,
    hook = null;
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client),
      release = client.release.bind(client),
      job = jobs.getStore();
    client.query = async (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (hook) await hook({ stage: 'before', sql, job, pid: client.processID, query });
      const result = await query(...args);
      if (hook) await hook({ stage: 'after', sql, job, pid: client.processID, query });
      return result;
    };
    client.release = (...args) => {
      client.query = query;
      release(...args);
    };
    return client;
  };
  const product = async (stock = 10, scope = {}) => {
    const id = randomUUID();
    await q(
      `INSERT INTO products(id,tenant_id,warehouse_id,name,unit,stock,cost_price,sell_price)
      VALUES($1,$2,$3,'Inventory fixture','м',$4,25,50)`,
      [id, scope.tenant ?? tenant, scope.warehouse ?? warehouse, stock],
    );
    return id;
  };
  const input = (more = {}) => ({
    type: 'inventory',
    quantity: 4.5,
    requestId: randomUUID(),
    expectedStock: 10,
    expectedWarehouseId: warehouse,
    ...more,
  });
  const update = (id, dto, actor = owner, sessionPoint = point) =>
    run(() => service.updateStock(id, tenant, dto, actor, sessionPoint));
  const stock = async (id) => Number((await q('SELECT stock FROM products WHERE id=$1', [id]))[0].stock);
  const movements = (id) => q('SELECT * FROM stock_movements WHERE product_id=$1 ORDER BY created_at,id', [id]);
  const receipts = () => q('SELECT * FROM inventory_requests WHERE tenant_id=$1', [tenant]);
  try {
    const identitySql = `SELECT current_database() db,current_user usr,current_setting('server_version_num')::int version,
      rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    const [identity] = await q(identitySql);
    assert.equal(identity.db, expected.database);
    assert.equal(identity.usr, expected.role);
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    assert.equal(identity.rolsuper, true);
    const [appIdentity] = (await app.query(identitySql)).rows;
    assert.equal(appIdentity.db, expected.database);
    assert.equal(appIdentity.usr, 'autexa_app');
    assert.equal(appIdentity.rolsuper, false);
    assert.equal(appIdentity.rolbypassrls, false);
    verified = true;
    await q("INSERT INTO tenants(id,name) VALUES($1,'Inventory fixture'),($2,'Foreign fixture')", [tenant, foreign]);
    for (const [id, tenantId] of [
      [owner, tenant],
      [otherActor, tenant],
      [foreignActor, foreign],
    ])
      await q(
        "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$2,$1::uuid::text,'unused','Fixture','director')",
        [id, tenantId],
      );
    await q("INSERT INTO tenant_points(id,tenant_id,name) VALUES($1,$3,'Point A'),($2,$3,'Point B')", [
      point,
      otherPoint,
      tenant,
    ]);
    for (const [id, tenantId, pointId, kind] of [
      [warehouse, tenant, point, 'main'],
      [movedWarehouse, tenant, point, 'used'],
      [otherWarehouse, tenant, otherPoint, 'main'],
      [foreignWarehouse, foreign, null, 'main'],
    ])
      await q('INSERT INTO warehouses(id,tenant_id,point_id,name,kind) VALUES($1,$2,$3,$4,$5)', [
        id,
        tenantId,
        pointId,
        id,
        kind,
      ]);
    await work({
      q,
      pool,
      admin,
      app,
      service,
      tenant,
      foreign,
      owner,
      otherActor,
      foreignActor,
      point,
      otherPoint,
      warehouse,
      movedWarehouse,
      otherWarehouse,
      foreignWarehouse,
      run,
      product,
      input,
      update,
      stock,
      movements,
      receipts,
      setHook: (next) => {
        hook = next;
      },
    });
  } finally {
    hook = null;
    if (verified) await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
    await pool.end();
  }
}

test('inventory fixture accepts only exact assigned local/CI targets', () => {
  assert.equal(approvedFixture(localUrl).database, 'autexa_oct16_inventory_test');
  assert.equal(approvedFixture(ciUrl).role, 'oct8_fixture');
  for (const url of [
    undefined,
    '',
    localUrl.replace('127.0.0.1', 'remote.example'),
    localUrl.replace('60984', '5432'),
    localUrl.replace('inventory', 'pricing'),
    ciUrl.replace('oct8_fixture:', 'postgres:'),
    ciUrl + '?host=remote.example',
  ])
    assert.throws(() => approvedFixture(url), /explicitly approved/);
});

test('PG16 inventory: stale stock cannot overwrite a sale', options, async () =>
  fixture(async (f) => {
    const id = await f.product();
    const dto = f.input();
    await f.update(id, { type: 'expense', quantity: 2 });
    await assert.rejects(f.update(id, dto), status(409, 'INVENTORY_STOCK_CONFLICT'));
    assert.equal(await f.stock(id), 8);
    assert.equal((await f.movements(id)).length, 1);
    assert.deepEqual(await f.receipts(), []);
  }),
);

test('PG16 inventory: partial guard is refused before a write', options, async () =>
  fixture(async (f) => {
    const id = await f.product();
    await assert.rejects(f.update(id, { type: 'inventory', quantity: 7, requestId: randomUUID() }), status(400));
    assert.equal(await f.stock(id), 10);
    assert.deepEqual(await f.movements(id), []);
  }),
);

test('PG16 inventory: lost ACK retry preserves later stock movements', options, async () =>
  fixture(async (f) => {
    const id = await f.product(),
      dto = f.input();
    const first = await f.update(id, dto);
    await f.update(id, { type: 'expense', quantity: 1 });
    const replay = await f.update(id, dto);
    assert.equal(await f.stock(id), 3.5, 'retry must never restore the earlier physical count');
    assert.deepEqual(replay, first);
    assert.equal(replay.requestId, dto.requestId);
    assert.equal((await f.movements(id)).length, 2);
    assert.equal((await f.receipts()).length, 1);
  }),
);

test(
  'PG16 inventory: dedicated route applies zero, fractional, equal and maximum counts with negative baselines',
  options,
  async () =>
    fixture(async (f) => {
      for (const [before, quantity] of [
        [-0.125, 0],
        [10, 0.001],
        [10, 0.5],
        [0.125, 0.125],
        [-999999999.999, 999999999.999],
      ]) {
        const id = await f.product(before),
          dto = f.input({ expectedStock: before, quantity });
        const receipt = await f.run(() => f.service.updateInventory(id, f.tenant, dto, f.owner, f.point));
        assert.deepEqual(receipt, { stock: quantity, linkedExpenseId: null, requestId: dto.requestId });
        assert.equal(await f.stock(id), quantity);
        const [movement] = await f.movements(id);
        assert.equal(movement.type, 'inventory');
        assert.equal(Number(movement.stock_before), before);
        assert.equal(Number(movement.stock_after), quantity);
        assert.equal(Number(movement.quantity), quantity);
        assert.equal(movement.user_id, f.owner);
        assert.equal(movement.warehouse_id, f.warehouse);
        assert.equal(movement.record_as_expense, false);
      }
      assert.equal((await f.receipts()).length, 5);
      assert.deepEqual(await f.q('SELECT * FROM expenses WHERE tenant_id=$1', [f.tenant]), []);
    }),
);

test('PG16 inventory: changed warehouse, soft-delete and missing warehouse refuse new counts', options, async () =>
  fixture(async (f) => {
    for (const change of ['warehouse_id=$2', 'deleted_at=now()', 'warehouse_id=NULL']) {
      const id = await f.product(),
        dto = f.input();
      await f.q(`UPDATE products SET ${change} WHERE id=$1`, change.includes('$2') ? [id, f.movedWarehouse] : [id]);
      const noPointScope = change === 'warehouse_id=NULL';
      await assert.rejects(
        f.update(id, dto),
        status(noPointScope ? 404 : 409, noPointScope ? undefined : 'INVENTORY_STOCK_CONFLICT'),
      );
      if (noPointScope) await assert.rejects(f.update(id, dto, f.owner, null), status(409, 'INVENTORY_STOCK_CONFLICT'));
      assert.equal(await f.stock(id), 10);
      assert.deepEqual(await f.movements(id), []);
    }
    assert.deepEqual(await f.receipts(), []);
  }),
);

test(
  'PG16 inventory: replay after in-point move or soft-delete returns receipt without UPDATE or INSERT',
  options,
  async () =>
    fixture(async (f) => {
      const id = await f.product(),
        dto = f.input();
      const first = await f.update(id, dto);
      await f.q('UPDATE products SET warehouse_id=$2,deleted_at=now(),stock=2.125 WHERE id=$1', [id, f.movedWarehouse]);
      const writes = [];
      f.setHook(({ stage, sql }) => {
        if (stage === 'before' && /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)) writes.push(sql);
      });
      const replay = await f.update(id, {
        ...dto,
        requestId: dto.requestId.toUpperCase(),
        expectedWarehouseId: dto.expectedWarehouseId.toUpperCase(),
        reason: null,
        recordAsExpense: false,
      });
      f.setHook(null);
      assert.deepEqual(replay, first);
      assert.deepEqual(writes, [], 'recovering the receipt must not touch products or append another movement');
      assert.equal(await f.stock(id), 2.125);
      assert.equal((await f.movements(id)).length, 1);
      assert.equal((await f.receipts()).length, 1);
    }),
);

test(
  'PG16 inventory: reused UUID rejects changed payload/product/actor/point without response disclosure',
  options,
  async () =>
    fixture(async (f) => {
      const id = await f.product(),
        another = await f.product(),
        dto = f.input();
      await f.update(id, dto);
      for (const [target, payload, actor, sessionPoint] of [
        [id, { ...dto, quantity: 7 }],
        [id, { ...dto, expectedStock: 9 }],
        [id, { ...dto, expectedWarehouseId: f.movedWarehouse }],
        [id, { ...dto, reason: 'Changed reason' }],
        [id, { ...dto, recordAsExpense: true }],
        [another, dto],
        [id, dto, f.otherActor],
        [id, dto, f.owner, null],
      ]) {
        await assert.rejects(f.update(target, payload, actor, sessionPoint), (error) => {
          assert.equal(error.getStatus(), 409);
          assert.equal(error.getResponse().code, 'INVENTORY_REQUEST_CONFLICT');
          assert.deepEqual(Object.keys(error.getResponse()).sort(), ['code', 'message']);
          return true;
        });
      }
      assert.equal(await f.stock(id), dto.quantity);
      assert.equal(await f.stock(another), 10);
      assert.equal((await f.movements(id)).length, 1);
      assert.equal((await f.receipts()).length, 1);
    }),
);

test('PG16 inventory: current point and tenant scope apply before replay and new writes', options, async () =>
  fixture(async (f) => {
    const id = await f.product(),
      dto = f.input();
    await f.update(id, dto);
    await f.q('UPDATE products SET warehouse_id=$2 WHERE id=$1', [id, f.otherWarehouse]);
    for (const target of [
      id,
      randomUUID(),
      await f.product(10, { tenant: f.foreign, warehouse: f.foreignWarehouse }),
    ]) {
      await assert.rejects(f.update(target, dto), (error) => {
        assert.equal(error.getStatus(), 404);
        assert.deepEqual(error.getResponse(), { message: 'Товар не найден' });
        return true;
      });
    }
    await assert.rejects(f.update(id, dto, f.owner, f.otherPoint), status(409, 'INVENTORY_REQUEST_CONFLICT'));
    assert.equal((await f.movements(id)).length, 1);
    assert.equal((await f.receipts()).length, 1);
  }),
);

test('PG16 inventory: receipt RLS defaults closed and same UUID in two tenants stays independent', options, async () =>
  fixture(async (f) => {
    const requestId = randomUUID(),
      first = await f.product();
    await f.update(first, f.input({ requestId }));
    const second = await f.product(20, { tenant: f.foreign, warehouse: f.foreignWarehouse });
    const foreignDto = f.input({
      requestId,
      quantity: 7.125,
      expectedStock: 20,
      expectedWarehouseId: f.foreignWarehouse,
    });
    const foreignReceipt = await runWithTenant(f.foreign, () =>
      f.service.updateInventory(second, f.foreign, foreignDto, f.foreignActor, null),
    );
    assert.equal(foreignReceipt.stock, 7.125);
    const own = await f.run(() => f.pool.query('SELECT tenant_id,response FROM inventory_requests'));
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].tenant_id, f.tenant);
    assert.equal(
      (await f.app.query('SELECT * FROM inventory_requests')).rows.length,
      0,
      'no tenant GUC means default deny',
    );
    await assert.rejects(
      f.run(() =>
        f.pool.query(
          "INSERT INTO inventory_requests(tenant_id,request_id,fingerprint,response) VALUES($1,$2,'no','{}')",
          [f.foreign, randomUUID()],
        ),
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      f.run(() => f.service.updateStock(second, f.foreign, foreignDto, f.foreignActor, null)),
      status(404),
    );
    assert.equal(await f.stock(first), 4.5);
    assert.equal(await f.stock(second), 7.125);
    const flags = await f.q(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='inventory_requests'::regclass",
    );
    assert.deepEqual(flags[0], { relrowsecurity: true, relforcerowsecurity: true });
  }),
);

test('PG16 inventory: simultaneous identical UUID applies once and returns identical receipts', options, async () =>
  fixture(async (f) => {
    const id = await f.product(),
      dto = f.input();
    const results = await concurrent(
      f,
      () => f.update(id, dto),
      () => f.update(id, dto),
    );
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled'],
    );
    assert.deepEqual(results[0].value, results[1].value);
    assert.equal((await f.movements(id)).length, 1);
    assert.equal((await f.receipts()).length, 1);
  }),
);

test('PG16 inventory: simultaneous UUID collision across products or changed payload returns 409', options, async () =>
  fixture(async (f) => {
    for (const sameProduct of [true, false]) {
      const first = await f.product(),
        second = sameProduct ? first : await f.product(),
        dto = f.input();
      const results = await concurrent(
        f,
        () => f.update(first, dto),
        () => f.update(second, { ...dto, quantity: 6.125 }),
      );
      assert.deepEqual(
        results.map((r) => r.status),
        ['fulfilled', 'rejected'],
      );
      assert.ok(status(409, 'INVENTORY_REQUEST_CONFLICT')(results[1].reason));
      assert.equal(await f.stock(first), 4.5);
      if (!sameProduct) {
        assert.equal(await f.stock(second), 10);
        assert.deepEqual(await f.movements(second), []);
      }
      assert.equal((await f.movements(first)).length, 1);
    }
    assert.equal((await f.receipts()).length, 2);
  }),
);

test('PG16 inventory: distinct UUIDs with one stale baseline cannot both apply', options, async () =>
  fixture(async (f) => {
    const id = await f.product();
    const results = await concurrent(
      f,
      () => f.update(id, f.input()),
      () => f.update(id, f.input({ quantity: 6.125 })),
    );
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'rejected'],
    );
    assert.ok(status(409, 'INVENTORY_STOCK_CONFLICT')(results[1].reason));
    assert.equal(await f.stock(id), 4.5);
    assert.equal((await f.movements(id)).length, 1);
    assert.equal((await f.receipts()).length, 1);
  }),
);

test('PG16 inventory: concurrent sale/move/delete is checked after acquiring the product row lock', options, async () =>
  fixture(async (f) => {
    for (const [change, values, code] of [
      ['stock=8', [], 409],
      ['warehouse_id=$2', [f.movedWarehouse], 409],
      ['deleted_at=now()', [], 409],
      ['warehouse_id=$2', [f.otherWarehouse], 404],
    ]) {
      const id = await f.product(),
        dto = f.input(),
        holder = await f.admin.connect();
      let waiter, task;
      f.setHook(({ stage, sql, pid }) => {
        if (stage === 'before' && /FROM products[\s\S]*FOR UPDATE/.test(sql)) waiter = pid;
      });
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [id]);
        task = f.update(id, dto).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        assert.ok(await until(() => waiter));
        assert.ok(
          await until(
            async () =>
              (await f.q('SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked', [waiter, holder.processID]))[0]
                .blocked,
          ),
        );
        await holder.query(`UPDATE products SET ${change} WHERE id=$1`, [id, ...values]);
        await holder.query('COMMIT');
        const result = await task;
        assert.ok(status(code, code === 409 ? 'INVENTORY_STOCK_CONFLICT' : undefined)(result.error));
        assert.equal(await f.stock(id), change === 'stock=8' ? 8 : 10);
        assert.deepEqual(await f.movements(id), []);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        if (task) await task;
        f.setHook(null);
      }
    }
    assert.deepEqual(await f.receipts(), []);
  }),
);

test('PG16 inventory: receipt failure rolls back product and movement and leaves retryable UUID', options, async () =>
  fixture(async (f) => {
    const id = await f.product(),
      dto = f.input();
    let injected = false;
    f.setHook(async ({ stage, sql, query }) => {
      if (!injected && stage === 'before' && /^INSERT INTO inventory_requests/.test(sql)) {
        injected = true;
        await query('SELECT 1/0'); // real PostgreSQL failure after stock + movement writes
      }
    });
    await assert.rejects(f.update(id, dto), status(500));
    f.setHook(null);
    assert.equal(injected, true);
    assert.equal(await f.stock(id), 10);
    assert.deepEqual(await f.movements(id), []);
    assert.deepEqual(await f.receipts(), []);
    await f.update(id, dto);
    assert.equal(await f.stock(id), 4.5);
    assert.equal((await f.movements(id)).length, 1);
    assert.equal((await f.receipts()).length, 1);
  }),
);

test(
  'PG16 inventory: lost COMMIT acknowledgement recovers original receipt after a subsequent sale',
  options,
  async () =>
    fixture(async (f) => {
      const id = await f.product(),
        dto = f.input();
      let lost = false;
      f.setHook(({ stage, sql }) => {
        if (!lost && stage === 'after' && sql === 'COMMIT') {
          lost = true;
          throw new Error('Fixture: acknowledgement lost after commit');
        }
      });
      await assert.rejects(f.update(id, dto), status(500));
      f.setHook(null);
      assert.equal(lost, true);
      assert.equal(await f.stock(id), 4.5);
      await f.update(id, { type: 'expense', quantity: 1 });
      assert.deepEqual(await f.update(id, dto), { stock: 4.5, linkedExpenseId: null, requestId: dto.requestId });
      assert.equal(await f.stock(id), 3.5);
      assert.equal((await f.movements(id)).length, 2);
      assert.equal((await f.receipts()).length, 1);
    }),
);

test(
  'PG16 inventory: legacy movements, expense accounting and integration guard remain compatible',
  options,
  async () =>
    fixture(async (f) => {
      const id = await f.product();
      assert.deepEqual(await f.update(id, { type: 'inventory', quantity: 2 }), { stock: 2, linkedExpenseId: null });
      const result = await f.update(id, {
        type: 'writeoff',
        quantity: 0.5,
        recordAsExpense: true,
        reason: 'Fixture writeoff',
      });
      assert.equal(result.stock, 1.5);
      assert.ok(result.linkedExpenseId);
      assert.equal(Object.hasOwn(result, 'requestId'), false);
      const [expense] = await f.q('SELECT * FROM expenses WHERE id=$1', [result.linkedExpenseId]);
      assert.equal(Number(expense.amount), 12.5);
      assert.equal(expense.point_id, f.point);
      assert.equal(expense.user_id, f.owner);
      const integration = (dto, expectedStock, more = {}) =>
        f.run(() =>
          f.service.updateStock(id, f.tenant, dto, f.owner, f.point, {
            expectedStock,
            expectedWarehouseId: f.warehouse,
            requireSufficientStock: true,
            ...more,
          }),
        );
      await assert.rejects(integration({ type: 'expense', quantity: 2 }, 1.5), status(409));
      await assert.rejects(integration({ type: 'income', quantity: 0.5 }, 2), status(409));
      assert.deepEqual(await integration({ type: 'income', quantity: 0.5 }, 1.5), { stock: 2, linkedExpenseId: null });
      await f.q('UPDATE products SET cost_price_is_placeholder=true WHERE id=$1', [id]);
      await assert.rejects(
        f.update(id, { type: 'writeoff', quantity: 1, recordAsExpense: true }),
        status(409, 'PRODUCT_COST_CONFIRMATION_REQUIRED'),
      );
      assert.equal(await f.stock(id), 2);
      assert.equal((await f.movements(id)).length, 3);
      assert.deepEqual(await f.receipts(), []);
    }),
);
