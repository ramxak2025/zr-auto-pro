// Explicit disposable database only. Never use DATABASE_URL or a production fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ChecksService } = require('../dist/checks/checks.service');
const { ReturnsService } = require('../dist/returns/returns.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { UsersService } = require('../dist/users/users.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_RECOVERY_LIVE_DB;
const liveOptions = { skip: !live, timeout: 60000 };
const jobs = new AsyncLocalStorage();
const status = (code) => (error) => error.getStatus?.() === code;
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return true;
    await new Promise((done) => setTimeout(done, 10));
  }
  return false;
}

async function fixture(max, work) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55446');
  assert.equal(url.pathname, '/autexa_oct13_recovery');
  const appUrl = new URL(url);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.AUTEXA_RECOVERY_APP_PASSWORD;
  assert.ok(appUrl.password);
  const admin = new Pool({ connectionString: url.toString(), max: 4, statement_timeout: 8000 });
  const app = new Pool({
    connectionString: appUrl.toString(),
    max,
    connectionTimeoutMillis: 1000,
    statement_timeout: 8000,
  });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, args = []) => (await admin.query(sql, args)).rows;
  const tenant = randomUUID(),
    owner = randomUUID();
  const actor = { userID: owner, tenantID: tenant, role: 'director', permissions: {} };
  const run = (fn) => runWithTenant(tenant, fn);
  const warehouses = new WarehousesService(pool);
  const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool));
  const returns = new ReturnsService(pool, warehouses);
  const users = new UsersService(pool);
  let hook = null,
    number = 10000;
  const errors = [];
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect(),
      job = jobs.getStore();
    const query = client.query.bind(client),
      release = client.release.bind(client);
    client.query = async (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0].text;
      if (hook) await hook({ stage: 'before', sql, job, pid: client.processID });
      let result;
      try {
        result = await query(...args);
      } catch (error) {
        errors.push(error.code || error.message);
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
  const create = (more = {}) =>
    run(() =>
      checks.create(
        tenant,
        owner,
        'director',
        {
          masterId: owner,
          services: [{ name: 'Recovery labour', price: 100, quantity: 1 }],
          products: [],
          isDeferred: false,
          paymentMethod: 'cash',
          ...more,
        },
        actor,
      ),
    );
  const seed = async ({ deferred = false, point = null, percent = false } = {}) => {
    const wh = await run(() => warehouses.resolveByKind(tenant, 'main', point));
    const id = randomUUID(),
      product = randomUUID(),
      productLine = randomUUID(),
      serviceLine = randomUUID();
    await q(
      `INSERT INTO products(id,tenant_id,warehouse_id,name,unit,cost_price,sell_price,stock)
      VALUES($1,$2,$3,$4,'л',10,40,$5)`,
      [product, tenant, wh.id, product, deferred ? 10 : 7.5],
    );
    await q(
      `INSERT INTO checks(id,tenant_id,number,date,master_id,is_deferred,payment_method,cash_amount,card_amount,
      service_total,product_total,total_revenue,product_cost_total,service_salary_total,product_salary_total,total_cost,profit,point_id)
      VALUES($1,$2,$3,'2026-10-13T12:00:00Z',$4,$5,'cash_card',100,200,200,100,300,25,50,20,95,205,$6)`,
      [id, tenant, number++, owner, deferred, point],
    );
    await q(
      `INSERT INTO check_product_lines(id,check_id,product_id,name,quantity,sell_price,cost_price,total_sell,total_cost)
      VALUES($1,$2,$3,'Recovery stock',2.5,40,10,100,25)`,
      [productLine, id, product],
    );
    await q(
      `INSERT INTO check_service_lines(id,check_id,name,master_id,quantity,price,total,salary_amount,salary_mode,salary_fixed_amount)
      VALUES($1,$2,'Recovery labour',$3,2,100,200,50,$4,$5)`,
      [serviceLine, id, owner, percent ? 'percent' : 'fixed', percent ? null : 25],
    );
    return { id, product, productLine, serviceLine, wh: wh.id };
  };
  const returnCheck = (c, dto = {}, who = actor) =>
    run(() =>
      returns.createReturn(
        tenant,
        owner,
        c.id,
        {
          destination: 'warehouse',
          scope: 'full',
          ...dto,
        },
        who,
      ),
    );
  const snapshot = async (c) => ({
    check: (
      await q(
        `SELECT is_returned,total_revenue,cash_amount,card_amount,product_cost_total,service_salary_total,
      product_salary_total,total_cost,profit FROM checks WHERE id=$1`,
        [c.id],
      )
    )[0],
    stock: Number((await q('SELECT stock FROM products WHERE id=$1', [c.product]))[0].stock),
    headers: (await q('SELECT * FROM check_returns WHERE check_id=$1', [c.id])).length,
    movements: (await q('SELECT * FROM stock_movements WHERE product_id=$1', [c.product])).length,
  });
  try {
    await q("INSERT INTO tenants(id,name,timezone) VALUES($1,'Recovery isolated QA','Europe/Moscow')", [tenant]);
    await q(
      `INSERT INTO users(id,tenant_id,phone,password,full_name,role,salary_percent)
      VALUES($1,$2,$3,'unused','Recovery QA','director',25)`,
      [owner, tenant, owner],
    );
    await work({
      tenant,
      owner,
      actor,
      q,
      pool,
      app,
      run,
      checks,
      users,
      warehouses,
      returns,
      create,
      seed,
      returnCheck,
      snapshot,
      errors,
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

test('check create: one-connection RLS pool, lost response retry and transaction rollback', liveOptions, async () => {
  await fixture(1, async ({ create, checks, q, tenant, snapshot, seed }) => {
    const c = await seed();
    const request = randomUUID();
    const payload = {
      clientRequestId: request,
      products: [{ productId: c.product, name: 'Recovery stock', quantity: 1, sellPrice: 40 }],
    };
    const created = await create(payload);
    assert.equal((await create(payload)).id, created.id);
    assert.equal(Number((await q('SELECT stock FROM products WHERE id=$1', [c.product]))[0].stock), 6.5);
    assert.equal(
      (await q('SELECT id FROM checks WHERE tenant_id=$1 AND client_request_id=$2', [tenant, request])).length,
      1,
    );
    const read = checks.getById.bind(checks);
    checks.getById = async () => {
      throw new Error('controlled lost post-commit read');
    };
    const second = randomUUID();
    await assert.rejects(create({ ...payload, clientRequestId: second }), status(500));
    checks.getById = read;
    const recovered = await create({ ...payload, clientRequestId: second });
    assert.ok(recovered.id);
    assert.equal(Number((await q('SELECT stock FROM products WHERE id=$1', [c.product]))[0].stock), 5.5);
    const before = await snapshot(c);
    await assert.rejects(create({ ...payload, clientRequestId: randomUUID(), masterId: randomUUID() }), status(400));
    assert.deepEqual(await snapshot(c), before);
  });
});

test('concurrent request-key losers recover real 23505 without starving a bounded pool', liveOptions, async () => {
  await fixture(2, async ({ create, seed, pool, q, tenant, errors }) => {
    const c = await seed();
    const key = randomUUID(),
      start = gate();
    let arrivals = 0;
    const query = pool.query.bind(pool);
    pool.query = async (...args) => {
      const result = await query(...args);
      if (
        /SELECT id FROM checks WHERE tenant_id = \$1 AND client_request_id = \$2/.test(args[0]) &&
        args[1][1] === key &&
        !result.rows.length
      ) {
        if (++arrivals === 2) start.resolve();
        await start.promise;
      }
      return result;
    };
    const payload = {
      clientRequestId: key,
      products: [{ productId: c.product, name: 'Recovery stock', quantity: 20, sellPrice: 40 }],
    };
    const outcomes = await Promise.allSettled([create(payload), create(payload)]);
    assert.deepEqual(
      outcomes.map((result) => result.status),
      ['fulfilled', 'fulfilled'],
      JSON.stringify(errors),
    );
    assert.equal(outcomes[0].value.id, outcomes[1].value.id);
    assert.ok(errors.includes('23505'), 'test must exercise the unique-violation recovery branch');
    assert.equal(
      (await q('SELECT id FROM checks WHERE tenant_id=$1 AND client_request_id=$2', [tenant, key])).length,
      1,
    );
    assert.equal(
      Number((await q('SELECT stock FROM products WHERE id=$1', [c.product]))[0].stock),
      -12.5,
      'stock decrements once; legitimate negative-stock sales remain allowed',
    );
    await q('UPDATE checks SET deleted_at=now() WHERE id=$1', [outcomes[0].value.id]);
    await assert.rejects(create(payload), status(404), 'a retry must not resurrect a deleted sale');
  });
});

test('23505 recovery preserves a deleted winner as 404 without creating a replacement', liveOptions, async () => {
  await fixture(3, async ({ create, pool, q, tenant, errors }) => {
    const key = randomUUID(),
      start = gate();
    let arrivals = 0;
    const query = pool.query.bind(pool);
    pool.query = async (...args) => {
      const result = await query(...args);
      if (
        /SELECT id FROM checks WHERE tenant_id = \$1 AND client_request_id = \$2/.test(args[0]) &&
        args[1][1] === key
      ) {
        if (!result.rows.length) {
          if (++arrivals === 2) start.resolve();
          await start.promise;
        } else {
          // Concurrent deletion after the winner commits, before the loser
          // builds its recovery response. This is a real persisted winner.
          await q('UPDATE checks SET deleted_at=now() WHERE id=$1', [result.rows[0].id]);
        }
      }
      return result;
    };
    const outcomes = await Promise.allSettled([create({ clientRequestId: key }), create({ clientRequestId: key })]);
    assert.ok(errors.includes('23505'));
    assert.ok(outcomes.some((r) => r.status === 'rejected'));
    for (const result of outcomes) if (result.status === 'rejected') assert.equal(result.reason.getStatus(), 404);
    assert.equal(
      (await q('SELECT id FROM checks WHERE tenant_id=$1 AND client_request_id=$2', [tenant, key])).length,
      1,
    );
  });
});

test('returns resolve and lazily seed warehouses inside the one-connection transaction', liveOptions, async () => {
  await fixture(1, async ({ seed, returnCheck, snapshot, q, tenant }) => {
    const c = await seed();
    const result = await returnCheck(c);
    assert.equal(result.refundAmount, 300);
    const saved = await snapshot(c);
    assert.equal(saved.stock, 10);
    assert.equal(saved.headers, 1);
    assert.equal(saved.check.total_revenue, '0.00');
    assert.equal(saved.check.service_salary_total, '50.00');
    assert.equal(saved.check.product_salary_total, '20.00');
    const defect = await seed();
    await q("DELETE FROM warehouses WHERE tenant_id=$1 AND kind='defect'", [tenant]);
    await returnCheck(defect, { destination: 'defect', reason: 'Проверенный дефект' });
    assert.equal((await snapshot(defect)).stock, 7.5, 'defect returns must not replenish the saleable source');
    const copies = await q(
      `SELECT p.stock FROM products p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.tenant_id=$1 AND p.name=$2 AND w.kind='defect'`,
      [tenant, defect.product],
    );
    assert.equal(copies.length, 1);
    assert.equal(Number(copies[0].stock), 2.5);
  });
});

test(
  'invalid returns are rejected atomically, including repeated and ambiguous line references',
  liveOptions,
  async (t) => {
    await fixture(3, async ({ seed, returnCheck, snapshot }) => {
      const cases = [
        ['deferred check', () => ({}), { deferred: true }],
        [
          'duplicate product',
          (c) => ({
            scope: 'partial',
            lines: [
              { productLineId: c.productLine, quantity: 2.5 },
              { productLineId: c.productLine, quantity: 2.5 },
            ],
          }),
        ],
        [
          'case-insensitive duplicate',
          (c) => ({
            scope: 'partial',
            lines: [
              { productLineId: c.productLine, quantity: 2.5 },
              { productLineId: c.productLine.toUpperCase(), quantity: 2.5 },
            ],
          }),
        ],
        [
          'duplicate service',
          (c) => ({ scope: 'partial', lines: [{ serviceLineId: c.serviceLine }, { serviceLineId: c.serviceLine }] }),
        ],
        [
          'ambiguous reference',
          (c) => ({ scope: 'partial', lines: [{ productLineId: c.productLine, serviceLineId: c.serviceLine }] }),
        ],
        ['empty reference', () => ({ scope: 'partial', lines: [{}] })],
        ['foreign reference', () => ({ scope: 'partial', lines: [{ productLineId: randomUUID() }] })],
        ['non-array lines', () => ({ scope: 'partial', lines: { length: 1 } })],
        ['null line', () => ({ scope: 'partial', lines: [null] })],
        ['invalid reason', () => ({ destination: 'defect', reason: 42 })],
        ['blank defect reason', () => ({ destination: 'defect', reason: '   ' })],
        ...[0, -1, NaN, Infinity, '1junk', '1', null].map((quantity) => [
          `quantity ${String(quantity)}`,
          (c) => ({ scope: 'partial', lines: [{ productLineId: c.productLine, quantity }] }),
        ]),
        ...[-1, NaN, Infinity, '1junk', '1'].map((refundAmount) => [
          `refund ${String(refundAmount)}`,
          () => ({ refundAmount }),
        ]),
      ];
      for (const [name, dto, options] of cases)
        await t.test(name, async () => {
          const c = await seed(options),
            before = await snapshot(c);
          await assert.rejects(returnCheck(c, dto(c)), status(400));
          assert.deepEqual(await snapshot(c), before, 'no header, stock or money may change');
        });
    });
  },
);

test(
  'fractional returns, kopecks, legacy caps, rollback and concurrent retry preserve money and salary',
  liveOptions,
  async (t) => {
    await fixture(3, async ({ seed, returnCheck, snapshot, q, tenant, returns, setHook }) => {
      await t.test('fractional quantity derives proportionate money and costs', async () => {
        const c = await seed();
        const result = await returnCheck(c, {
          scope: 'partial',
          lines: [{ productLineId: c.productLine, quantity: 0.5 }],
        });
        assert.equal(result.refundAmount, 20);
        const saved = await snapshot(c);
        assert.equal(saved.stock, 8);
        assert.equal(saved.check.product_cost_total, '20.00');
        assert.equal(saved.check.total_revenue, '280.00');
        assert.equal(saved.check.profit, '190.00');
        assert.equal(saved.check.service_salary_total, '50.00');
        assert.equal(saved.check.product_salary_total, '20.00');
      });
      await t.test('kopecks are conserved across persisted refund, cash, card and revenue', async () => {
        const c = await seed();
        const result = await returnCheck(c, { refundAmount: 100.255 });
        assert.equal(result.refundAmount, 100.26);
        const saved = await snapshot(c);
        assert.equal(saved.check.total_revenue, '199.74');
        assert.equal(saved.check.cash_amount, '0.00');
        assert.equal(saved.check.card_amount, '199.74');
        assert.equal(
          Number((await q('SELECT refund_amount FROM check_returns WHERE check_id=$1', [c.id]))[0].refund_amount),
          result.refundAmount,
        );
      });
      await t.test('finite positive quantity and refund exceeding the sale preserve legacy caps', async () => {
        const c = await seed();
        const result = await returnCheck(c, {
          scope: 'partial',
          refundAmount: Number.MAX_VALUE,
          lines: [{ productLineId: c.productLine, quantity: 99 }],
        });
        assert.equal(result.refundAmount, 300);
        assert.equal((await snapshot(c)).stock, 10);
      });
      await t.test('a failure after stock changes rolls back the complete return', async () => {
        const c = await seed(),
          before = await snapshot(c);
        setHook(({ stage, sql }) => {
          if (stage === 'before' && /INSERT INTO stock_movements/.test(sql)) throw new Error('injected ledger failure');
        });
        try {
          await assert.rejects(returnCheck(c), status(500));
        } finally {
          setHook(null);
        }
        assert.deepEqual(await snapshot(c), before);
        await returnCheck(c);
        assert.equal((await snapshot(c)).stock, 10);
      });
      await t.test('parallel returns apply exactly once', async () => {
        const c = await seed();
        const results = await Promise.allSettled([returnCheck(c), returnCheck(c)]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.find((r) => r.status === 'rejected').reason.getStatus(), 400);
        const saved = await snapshot(c);
        assert.equal(saved.headers, 1);
        assert.equal(saved.stock, 10);
      });
      await t.test('point and tenant boundaries still reject writes', async () => {
        const point = randomUUID();
        await q("INSERT INTO tenant_points(id,tenant_id,name) VALUES($1,$2,'Recovery branch')", [point, tenant]);
        const c = await seed({ point }),
          before = await snapshot(c);
        await assert.rejects(returnCheck(c, {}, { currentPointId: randomUUID() }), status(404));
        const foreignTenant = randomUUID();
        await q("INSERT INTO tenants(id,name) VALUES($1,'Recovery foreign tenant')", [foreignTenant]);
        try {
          await assert.rejects(
            runWithTenant(foreignTenant, () =>
              returns.createReturn(foreignTenant, randomUUID(), c.id, { destination: 'warehouse', scope: 'full' }),
            ),
            status(404),
          );
        } finally {
          await q('DELETE FROM tenants WHERE id=$1', [foreignTenant]);
        }
        assert.deepEqual(await snapshot(c), before);
      });
    });
  },
);

test(
  'monthly salary recomputation and closed-check edit use check-before-line lock ordering',
  liveOptions,
  async () => {
    await fixture(4, async ({ seed, checks, users, pool, run, actor, tenant, owner, q, errors, setHook }) => {
      const c = await seed({ percent: true });
      const fixedLine = randomUUID();
      await q(
        `INSERT INTO check_service_lines(id,check_id,name,master_id,quantity,price,total,salary_amount,salary_mode,salary_fixed_amount)
      VALUES($1,$2,'Fixed historical',$3,1,100,100,30,'fixed',30)`,
        [fixedLine, c.id, owner],
      );
      const current = await run(() => checks.getById(c.id, tenant, actor));
      const release = gate();
      let editPid,
        ratePid,
        rateHasLines = false;
      setHook(async ({ stage, sql, job, pid }) => {
        if (job === 'edit' && stage === 'after' && /SELECT \* FROM checks[\s\S]*FOR UPDATE/.test(sql) && !editPid) {
          editPid = pid;
          await release.promise;
        }
        if (job === 'rate') {
          ratePid = pid;
          if (stage === 'after' && /UPDATE check_service_lines sl/.test(sql)) {
            rateHasLines = true;
            await release.promise;
          }
        }
      });
      const edit = jobs
        .run('edit', () =>
          run(() =>
            checks.update(
              c.id,
              tenant,
              'director',
              {
                services: current.services.map((line) => ({
                  ...line,
                  price: line.id === c.serviceLine ? 200 : line.price,
                })),
              },
              owner,
              actor,
            ),
          ),
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let rate,
        observed = false,
        results;
      try {
        assert.ok(await until(() => editPid), 'editor must hold the parent check');
        rate = jobs
          .run('rate', () =>
            run(async () => {
              const client = await pool.connect();
              try {
                await client.query('BEGIN');
                await users.recomputeMonthSalary(
                  client,
                  tenant,
                  owner,
                  '2026-10',
                  { servicePct: 40, productPct: 10 },
                  'Europe/Moscow',
                );
                await client.query('COMMIT');
              } catch (error) {
                await client.query('ROLLBACK');
                throw error;
              } finally {
                client.release();
              }
            }),
          )
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
        observed = await until(
          async () =>
            rateHasLines ||
            (ratePid &&
              (await q('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked', [ratePid, editPid]))[0].blocked),
        );
      } finally {
        release.resolve();
        results = await Promise.all([edit, ...(rate ? [rate] : [])]);
        setHook(null);
      }
      assert.ok(observed, 'transactions must overlap at the conflicting resource');
      assert.deepEqual(
        results.map((r) => r.error?.getStatus?.() || r.error?.code || 'ok'),
        ['ok', 'ok'],
        JSON.stringify(errors),
      );
      assert.equal(errors.includes('40P01'), false);
      const rows = await q('SELECT id,salary_amount FROM check_service_lines WHERE check_id=$1', [c.id]);
      assert.equal(Number(rows.find((r) => r.id === fixedLine).salary_amount), 30);
      assert.equal(Number(rows.find((r) => r.id === c.serviceLine).salary_amount), 160);
      const saved = (await q('SELECT service_salary_total FROM checks WHERE id=$1', [c.id]))[0];
      assert.equal(Number(saved.service_salary_total), 190);
    });
  },
);
