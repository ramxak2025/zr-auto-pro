// Run only against the explicitly assigned disposable PostgreSQL database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_OCT13_LIVE_DB;
const jobs = new AsyncLocalStorage();
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return true;
    await new Promise((done) => setTimeout(done, 10));
  }
  return false;
}

async function fixture(work) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55443');
  assert.ok(['/autexa_oct13_fixed', '/autexa_oct13'].includes(url.pathname));
  const appUrl = new URL(url);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.AUTEXA_OCT13_APP_PASSWORD;
  assert.ok(appUrl.password);
  const admin = new Pool({ connectionString: url.toString(), max: 5, statement_timeout: 10000 });
  const app = new Pool({ connectionString: appUrl.toString(), max: 5, statement_timeout: 10000 });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const tenant = randomUUID(),
    owner = randomUUID(),
    service = randomUUID();
  const actor = { tenantID: tenant, userID: owner, role: 'director', permissions: {} };
  const run = (fn) => runWithTenant(tenant, fn);
  const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool));
  const queryErrors = [];
  let hook = null;
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const job = jobs.getStore();
    const query = client.query.bind(client),
      release = client.release.bind(client);
    client.query = async (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (hook) await hook({ stage: 'before', sql, job, pid: client.processID });
      let result;
      try {
        result = await query(...args);
      } catch (error) {
        queryErrors.push(error.code);
        throw error;
      }
      if (hook) await hook({ stage: 'after', sql, job, pid: client.processID });
      return result;
    };
    client.release = (...args) => {
      client.query = query;
      release(...args);
    };
    return client;
  };
  const product = async (cost = 10, stock = 10) => {
    const id = randomUUID();
    await q("INSERT INTO products(id,tenant_id,name,cost_price,sell_price,stock) VALUES($1,$2,'Lock QA', $3,50,$4)", [
      id,
      tenant,
      cost,
      stock,
    ]);
    return { productId: id, name: 'Lock QA', sellPrice: 50, costPrice: 99999, quantity: 1 };
  };
  const create = (products, more = {}) =>
    run(() =>
      checks.create(
        tenant,
        owner,
        'director',
        {
          masterId: owner,
          services: [{ serviceId: service, name: 'Fixed lock QA', price: 100, quantity: 2 }],
          products,
          isDeferred: false,
          paymentMethod: 'cash',
          ...more,
        },
        actor,
      ),
    );
  const edit = (check, products, more = {}) =>
    run(() => checks.update(check.id, tenant, 'director', { products, ...more }, owner, actor));
  const accept = (check) => run(() => checks.acceptPayment(check.id, tenant, 'director', {}, owner, actor));
  const stock = async (line) => Number((await q('SELECT stock FROM products WHERE id=$1', [line.productId]))[0].stock);
  const blocking = async (waiter, holder) =>
    (await q('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked', [waiter, holder]))[0].blocked;

  // Hold the first transaction after its first product row lock. The second
  // either obtains the old compatible SHARE lock or waits on the fixed write
  // lock. Only then release: this reproduces the upgrade/counter cycle without
  // requiring both transactions to pass a barrier that a correct lock prevents.
  const concurrent = async (first, second) => {
    const release = deferred();
    const seen = new Set();
    let secondAcquired = false,
      firstPid,
      secondPid;
    hook = async ({ stage, sql, job, pid }) => {
      if (!job || !/\bFROM products\b[\s\S]*\bFOR (?:SHARE|UPDATE)\b/.test(sql || '')) return;
      if (stage === 'before' && job === 'second' && !secondPid) {
        secondPid = pid;
      }
      if (stage !== 'after' || seen.has(job)) return;
      seen.add(job);
      if (job === 'first') {
        firstPid = pid;
      } else secondAcquired = true;
      await release.promise;
    };
    const outcome = (job, fn) =>
      jobs.run(job, fn).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      );
    const firstTask = outcome('first', first);
    let secondTask,
      results,
      observed = false;
    try {
      assert.ok(await until(() => firstPid), 'first operation must reach a product lock');
      secondTask = outcome('second', second);
      assert.ok(await until(() => secondPid), 'second operation must reach a product lock');
      observed = await until(async () => secondAcquired || (await blocking(secondPid, firstPid)));
    } finally {
      release.resolve();
      results = await Promise.all([firstTask, ...(secondTask ? [secondTask] : [])]);
      hook = null;
    }
    // Surface both the user outcome and the raw PostgreSQL error code.
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled'],
      JSON.stringify({ queryErrors }),
    );
    assert.ok(observed, 'second operation must overlap the held transaction');
    assert.deepEqual(queryErrors, []);
    return results.map((r) => r.value);
  };

  try {
    await q("INSERT INTO tenants(id,name) VALUES($1,'Product lock QA')", [tenant]);
    await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused','QA','director')", [
      owner,
      tenant,
      owner,
    ]);
    await q(
      `INSERT INTO services(id,tenant_id,name,default_price,master_pay_mode,master_fixed_amount)
      VALUES($1,$2,'Fixed lock QA',100,'fixed',30)`,
      [service, tenant],
    );
    await work({
      tenant,
      owner,
      service,
      checks,
      pool,
      admin,
      q,
      run,
      product,
      create,
      edit,
      accept,
      stock,
      blocking,
      concurrent,
      setHook: (next) => {
        hook = next;
      },
    });
  } finally {
    hook = null;
    await q('DELETE FROM tenants WHERE id=$1', [tenant]);
    await pool.end();
  }
}

test('actual PG: two active creates of one confirmed product both commit', { skip: !live, timeout: 30000 }, async () =>
  fixture(async ({ product, create, concurrent, stock }) => {
    const line = await product();
    const checks = await concurrent(
      () => create([line]),
      () => create([line]),
    );
    assert.equal(await stock(line), 8);
    assert.notEqual(checks[0].number, checks[1].number);
    for (const check of checks) {
      assert.equal(check.productCostTotal, 10);
      assert.equal(check.serviceSalaryTotal, 60);
    }
  }),
);

test(
  'actual PG: active and deferred creates lock inverse product orders before the counter',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ product, create, concurrent, stock }) => {
      const a = await product(10, 0),
        b = await product(20, 0);
      const checks = await concurrent(
        () => create([a, b]),
        () => create([b, a], { isDeferred: true }),
      );
      assert.equal(await stock(a), -1, 'confirmed overselling remains allowed');
      assert.equal(await stock(b), -1);
      assert.deepEqual(
        checks.map((check) => check.productCostTotal),
        [30, 30],
      );
      assert.notEqual(checks[0].number, checks[1].number);
    }),
);

test(
  'actual PG: inverse closed edits lock the old and new product union before cost reads',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ product, create, edit, concurrent, stock }) => {
      const a = await product(10),
        b = await product(20);
      const first = await create([a]),
        second = await create([b]);
      const edited = await concurrent(
        () => edit(first, [{ ...b, quantity: 2 }]),
        () => edit(second, [{ ...a, quantity: 3 }]),
      );
      assert.equal(await stock(a), 7);
      assert.equal(await stock(b), 8);
      assert.deepEqual(
        edited.map((check) => check.productCostTotal),
        [40, 30],
      );
      assert.deepEqual(
        edited.map((check) => check.serviceSalaryTotal),
        [60, 60],
      );
    }),
);

for (const route of ['accept', 'full activation', 'mixed activation', 'draft edit', 'closed edit']) {
  test(
    `actual PG: ${route} preserves mixed confirmed and provisional history in inverse order`,
    { skip: !live, timeout: 30000 },
    async () =>
      fixture(async ({ product, create, edit, accept, concurrent, stock, q, service }) => {
        const a = await product(10),
          b = await product(20);
        const isDeferred = route !== 'closed edit';
        const first = await create([a, b], { isDeferred }),
          second = await create([b, a], { isDeferred });
        await q('UPDATE products SET cost_price_is_placeholder=true,cost_price=1 WHERE id=$1', [b.productId]);
        await q("UPDATE services SET master_pay_mode='percent',master_fixed_amount=NULL,master_percent=1 WHERE id=$1", [
          service,
        ]);
        const call = (check, lines, index) => {
          if (route === 'accept' || (route === 'mixed activation' && index === 0)) return accept(check);
          return edit(check, lines, route.includes('activation') ? { isDeferred: false } : {});
        };
        const edited = await concurrent(
          () => call(first, [b, a], 0),
          () => call(second, [a, b], 1),
        );
        const expectedStock = route === 'draft edit' ? 10 : 8;
        assert.equal(await stock(a), expectedStock);
        assert.equal(await stock(b), expectedStock);
        for (const check of edited) {
          assert.equal(check.productCostTotal, 30, 'provisional catalog cost cannot replace the historical 20');
          assert.equal(check.serviceSalaryTotal, 60, 'omitted wages keep their fixed snapshot');
          assert.equal(check.products.find((p) => p.productId === b.productId).costPrice, 20);
        }
        const confirmationRequired = (error) => error.getResponse?.().code === 'PRODUCT_COST_CONFIRMATION_REQUIRED';
        await assert.rejects(create([b]), confirmationRequired);
        await assert.rejects(edit(edited[0], [a, { ...b, quantity: 2 }]), confirmationRequired);
        await assert.rejects(edit(edited[0], [a, b, b]), confirmationRequired);
        assert.equal(await stock(b), expectedStock, 'failed edits roll back stock and historical lines');
      }),
  );
}

test(
  'actual PG: manual lines coexist with retained provisional costs in draft and closed edits',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ product, create, edit, accept, q, stock }) => {
      for (const isDeferred of [true, false]) {
        const line = await product(40);
        const manual = { name: 'Manual consumable', sellPrice: 30, costPrice: 7, quantity: 2 };
        const prior = await create([manual, line], { isDeferred });
        await q('UPDATE products SET cost_price_is_placeholder=true,cost_price=1 WHERE id=$1', [line.productId]);
        const edited = await edit(prior, [manual, { ...line, costPrice: 99999 }]);
        assert.equal(edited.productCostTotal, 54);
        assert.equal(edited.products.length, 2);
        const retainedManual = edited.products.find((p) => !p.productId);
        assert.equal(retainedManual.name, manual.name);
        assert.equal(retainedManual.costPrice, 7);
        assert.equal(retainedManual.quantity, 2);
        assert.equal(edited.products.find((p) => p.productId === line.productId).costPrice, 40);
        if (isDeferred) await accept(edited);
        assert.equal(await stock(line), 9);
      }

      // Historical duplicate occurrences with different costs remain ambiguous;
      // the manual line must neither crash matching nor make an arbitrary cost win.
      const line = await product(40);
      const manual = { name: 'Manual consumable', sellPrice: 30, costPrice: 7, quantity: 2 };
      const prior = await create([manual, line, line]);
      await q(
        `UPDATE check_product_lines SET cost_price=45,total_cost=45 WHERE id=(
        SELECT id FROM check_product_lines WHERE check_id=$1 AND product_id=$2 ORDER BY id LIMIT 1)`,
        [prior.id, line.productId],
      );
      await q(
        'UPDATE checks SET product_cost_total=product_cost_total+5,total_cost=total_cost+5,profit=profit-5 WHERE id=$1',
        [prior.id],
      );
      await q('UPDATE products SET cost_price_is_placeholder=true,cost_price=1 WHERE id=$1', [line.productId]);
      await assert.rejects(
        edit(prior, [manual, line, line]),
        (error) => error.getStatus?.() === 409 && error.getResponse?.().code === 'PRODUCT_COST_CONFIRMATION_REQUIRED',
      );
      assert.equal(
        Number((await q('SELECT product_cost_total FROM checks WHERE id=$1', [prior.id]))[0].product_cost_total),
        99,
      );
      assert.equal(await stock(line), 8);
    }),
);

test(
  'actual PG: confirmation changes wait for the validated cost snapshot and queued checks see the committed flag',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ product, create, checks, admin, q, blocking, setHook, stock }) => {
      const line = await product(40),
        entered = deferred(),
        release = deferred();
      let checkPid,
        updateSettled = false;
      setHook(async ({ stage, pid }) => {
        if (stage === 'before') checkPid = pid;
      });
      const load = checks.loadWarehouseSellPrices.bind(checks);
      checks.loadWarehouseSellPrices = async (...args) => {
        entered.resolve();
        await release.promise;
        return load(...args);
      };
      const creating = create([line]);
      const writer = await admin.connect();
      let updating,
        waiting = false;
      try {
        await entered.promise;
        updating = writer
          .query('UPDATE products SET cost_price_is_placeholder=true,cost_price=1 WHERE id=$1', [line.productId])
          .finally(() => {
            updateSettled = true;
          });
        await until(async () => updateSettled || (waiting = await blocking(writer.processID, checkPid)));
      } finally {
        release.resolve();
        await creating;
        if (updating) await updating;
        writer.release();
        checks.loadWarehouseSellPrices = load;
        setHook(null);
      }
      assert.ok(waiting, 'confirmation flag and cost must be pinned until the check commits');
      assert.equal((await creating).productCostTotal, 40);
      await assert.rejects(
        create([line]),
        (error) => error.getResponse?.().code === 'PRODUCT_COST_CONFIRMATION_REQUIRED',
      );
      assert.equal(await stock(line), 9);

      // A check queued behind confirmation must use the newly confirmed cost.
      const confirmer = await admin.connect();
      let queued, queuedPid;
      try {
        await confirmer.query('BEGIN');
        await confirmer.query('UPDATE products SET cost_price_is_placeholder=false,cost_price=44 WHERE id=$1', [
          line.productId,
        ]);
        setHook(async ({ stage, pid }) => {
          if (stage === 'before') queuedPid = pid;
        });
        queued = create([line]);
        assert.ok(await until(async () => queuedPid && (await blocking(queuedPid, confirmer.processID))));
        await confirmer.query('COMMIT');
        assert.equal((await queued).productCostTotal, 44);
      } finally {
        await confirmer.query('ROLLBACK');
        if (queued) await queued;
        confirmer.release();
        setHook(null);
      }
      assert.equal(
        (await q('SELECT cost_price_is_placeholder FROM products WHERE id=$1', [line.productId]))[0]
          .cost_price_is_placeholder,
        false,
      );
      assert.equal(await stock(line), 8);
    }),
);
