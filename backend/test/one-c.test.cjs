const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { OneCService } = require('../dist/one-c/one-c.service');
const { OneCDomainService, snapshotSql } = require('../dist/one-c/one-c.domain');
const { OneCKeyGuard } = require('../dist/one-c/one-c.guard');
const { digest, capabilities, assertCapability, ENTITY_TYPES } = {
  ...require('../dist/one-c/one-c.rules'),
  ...require('../dist/one-c/one-c.types'),
};
const { ProductsService } = require('../dist/products/products.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');
Logger.overrideLogger(false);

test('1C revisions are stable across object key order; flags default to off', () => {
  assert.equal(digest({ b: [1, 2], a: { d: 4, c: 3 } }), digest({ a: { c: 3, d: 4 }, b: [1, 2] }));
  assert.notEqual(digest({ quantity: 1 }), digest({ quantity: 2 }));
  const caps = capabilities();
  assert.equal(
    Object.values(caps).some((x) => x.export || x.import),
    false,
  );
  caps.stock.import = true;
  assert.throws(
    () => assertCapability({ status: 'active', capabilities: caps, mapping_confirmed: false }, 'stock', 'import'),
    (e) => e.getStatus() === 403,
  );
  assert.throws(
    () => capabilities({ products: { export: true, import: true } }),
    (e) => e.getStatus() === 400,
  );
});

test('1C key guard supplies authenticated tenant and point before global RLS interceptors', async () => {
  const id = randomUUID(),
    tenant = randomUUID(),
    point = randomUUID(),
    owner = randomUUID();
  const req = { headers: { authorization: 'Bearer testing' }, body: { tenantID: randomUUID() } };
  const guard = new OneCKeyGuard({
    authenticate: async (key) => {
      assert.equal(key, 'testing');
      return { id, tenant_id: tenant, point_id: point, created_by: owner };
    },
  });
  await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
  assert.equal(req.user.tenantID, tenant);
  assert.equal(req.user.currentPointId, point);
  assert.equal(req.user.role, 'director');
  await assert.rejects(
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) }),
    (e) => e.getStatus() === 401,
  );
});

test('all six exported resources use tenant and connection point predicates', () => {
  for (const type of ENTITY_TYPES) {
    const sql = snapshotSql(type);
    assert.match(sql, /d\.tenant_id=\$1::uuid/);
    assert.match(sql, /point_id=\$2::uuid/);
    assert.match(sql, /d\.id>\$3::uuid/);
  }
});

const live = process.env.ONE_C_LIVE_DB;
test(
  '1C native domain / PostgreSQL16 integration: isolation, CAS, replay, money, ACK and crash recovery',
  { skip: !live },
  async (t) => {
    const url = new URL(live);
    assert.ok(
      ['127.0.0.1', 'localhost'].includes(url.hostname) && /test/i.test(url.pathname),
      'ONLY an explicitly selected loopback test database is allowed',
    );
    const pool = new Pool({ connectionString: live, max: 12, statement_timeout: 8000 });
    const tenant = randomUUID(),
      otherTenant = randomUUID(),
      point = randomUUID(),
      otherPoint = randomUUID(),
      foreignPoint = randomUUID(),
      owner = randomUUID();
    const errors = [];
    const products = new ProductsService(pool, {});
    const clients = new ClientsService(pool, {});
    const warranty = { listForCheck: async () => [], createFromCheckLines: async () => {} };
    const checks = new ChecksService(pool, warranty, clients);
    const purchases = new PurchaseOrdersService(pool, {}, {});
    const domain = new OneCDomainService(pool, products, clients, purchases, checks);
    const originalApply = domain.apply.bind(domain);
    domain.apply = async (...args) => {
      try {
        return await originalApply(...args);
      } catch (e) {
        errors.push(e);
        throw e;
      }
    };
    const service = new OneCService(pool, domain);
    const user = { userID: owner, tenantID: tenant, role: 'director', currentPointId: point, permissions: {} };
    let connection, apiKey, productId, clientId;
    const event = (entityType, externalId, payload, extra = {}) => ({
      eventId: randomUUID(),
      entityType,
      externalId,
      payload,
      ...extra,
    });
    const applied = async (input) => {
      errors.length = 0;
      const result = await service.import(connection, input);
      assert.equal(result.status, 'applied', errors.map((e) => e.stack).join('\n') || JSON.stringify(result));
      return result;
    };
    try {
      await pool.query('INSERT INTO tenants(id,name,points_shared_clients) VALUES($1,$2,false),($3,$4,false)', [
        tenant,
        'OneC synthetic A',
        otherTenant,
        'OneC synthetic B',
      ]);
      await pool.query(
        'INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,$3,true),($4,$2,$5,false),($6,$7,$8,true)',
        [point, tenant, 'OneC A1', otherPoint, 'OneC A2', foreignPoint, otherTenant, 'OneC B'],
      );
      await pool.query('INSERT INTO users(id,phone,password,full_name,role,tenant_id) VALUES($1,$2,$3,$4,$5,$6)', [
        owner,
        `test-${owner}`,
        'synthetic-not-a-login',
        'Synthetic owner',
        'director',
        tenant,
      ]);

      await t.test('creation is paused; no secret readback; owner/point/rotation gates', async () => {
        await assert.rejects(service.create({ ...user, role: 'superadmin' }, point), (e) => e.getStatus() === 403);
        ({ apiKey } = await service.create(user, point));
        const settings = await service.settings(user);
        assert.equal(settings.connection.status, 'paused');
        assert.equal(JSON.stringify(settings).includes(apiKey), false);
        assert.equal(
          Object.values(settings.connection.capabilities).some((x) => x.import),
          false,
        );
        await assert.rejects(service.authenticate(apiKey), (e) => e.getStatus() === 403);
        await assert.rejects(service.configure(user, { pointId: foreignPoint }), (e) => e.getStatus() === 400);
        await assert.rejects(service.settings({ ...user, role: 'master' }), (e) => e.getStatus() === 403);
        const caps = Object.fromEntries(ENTITY_TYPES.map((type) => [type, { import: true, export: true }]));
        await assert.rejects(
          service.configure(user, { status: 'active', capabilities: caps }),
          (e) => e.getStatus() === 400,
        );
        const noMapping = await service.configure(user, { capabilities: caps });
        assert.equal(noMapping.capabilities.payments.import, false);
        assert.equal(noMapping.capabilities.stock.import, false);
        await service.configure(user, { status: 'active', mappingConfirmed: true, capabilities: caps });
        connection = await service.authenticate(apiKey);
        const rotated = await service.rotateKey(user);
        await assert.rejects(service.authenticate(apiKey), (e) => e.getStatus() === 401);
        apiKey = rotated.apiKey;
        connection = await service.authenticate(apiKey);
      });

      await t.test('native create is replay safe; event-id body collision is rejected', async () => {
        const input = event('products', 'product-1', {
          name: 'Synthetic filter',
          category: 'Расходники/Фильтры',
          sellPrice: 100,
          costPrice: 40,
          unit: 'шт',
        });
        const first = await applied(input);
        productId = first.autexaId;
        assert.deepEqual(await service.import(connection, input), first);
        await assert.rejects(
          service.import(connection, { ...input, payload: { name: 'Different' } }),
          (e) => e.getStatus() === 409,
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM products WHERE tenant_id=$1', [tenant])).rows[0].n,
          1,
        );
        assert.equal((await domain.snapshot(connection, 'products', productId)).payload.category, 'Расходники/Фильтры');
        const result = await applied(
          event('clients', 'client-1', { fullName: 'Synthetic client', phone: '', comment: 'test' }),
        );
        clientId = result.autexaId;
      });

      await t.test('CAS uses a real row lock; price history and client edits are native', async () => {
        const snapshot = await domain.snapshot(connection, 'products', productId);
        const hold = await pool.connect();
        await hold.query('BEGIN');
        await hold.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]);
        const waiting = service.import(
          connection,
          event('products', 'product-1', { sellPrice: 110 }, { baseRevision: digest(snapshot.payload) }),
        );
        await hold.query('UPDATE products SET sell_price=120 WHERE id=$1', [productId]);
        await hold.query('COMMIT');
        hold.release();
        assert.equal((await waiting).status, 'needs_review');
        assert.equal(
          Number((await pool.query('SELECT sell_price FROM products WHERE id=$1', [productId])).rows[0].sell_price),
          120,
        );
        const fresh = await domain.snapshot(connection, 'products', productId);
        await applied(
          event(
            'products',
            'product-1',
            { sellPrice: 130, category: 'Расходники/Воздушные фильтры' },
            { baseRevision: digest(fresh.payload) },
          ),
        );
        assert.equal(
          (await domain.snapshot(connection, 'products', productId)).payload.category,
          'Расходники/Воздушные фильтры',
        );
        const history = await pool.query('SELECT * FROM price_history WHERE tenant_id=$1 AND product_id=$2', [
          tenant,
          productId,
        ]);
        assert.equal(history.rows.length, 1);
        assert.equal(Number(history.rows[0].sell_price_before), 120);
        const c = await domain.snapshot(connection, 'clients', clientId);
        await applied(
          event('clients', 'client-1', { fullName: 'Changed synthetic client' }, { baseRevision: digest(c.payload) }),
        );
        assert.equal(
          (await domain.snapshot(connection, 'clients', clientId)).payload.fullName,
          'Changed synthetic client',
        );
      });

      await t.test(
        'scope hides foreign tenant and other point; ACK detects changed version and link collision',
        async () => {
          const outsider = await products.create(tenant, { name: 'Other point' }, otherPoint);
          await products.create(otherTenant, { name: 'Other tenant' }, foreignPoint);
          const page = await service.export(connection, 'products');
          assert.equal(page.items.length, 1);
          await assert.rejects(domain.snapshot(connection, 'products', outsider.id), (e) => e.getStatus() === 404);
          const item = page.items[0];
          await products.update(productId, tenant, { name: 'Local concurrent edit' }, owner, point);
          assert.deepEqual(
            await service.ack(connection, { entityType: 'products', items: [{ ...item, externalId: 'product-1' }] }),
            { accepted: 0, needsReview: 1 },
          );
          const fresh = (await service.export(connection, 'products')).items[0];
          assert.deepEqual(
            await service.ack(connection, {
              entityType: 'products',
              items: [{ ...fresh, externalId: 'wrong-duplicate-link' }],
            }),
            { accepted: 0, needsReview: 1 },
          );
          assert.deepEqual(
            await service.ack(connection, { entityType: 'products', items: [{ ...fresh, externalId: 'product-1' }] }),
            { accepted: 1, needsReview: 0 },
          );
          assert.equal((await service.export(connection, 'products')).items.length, 0);
          await assert.rejects(service.configure(user, { pointId: otherPoint }), (e) => e.getStatus() === 409);
        },
      );

      await t.test('crash-marked event is never replayed, even under a fresh eventId', async () => {
        const input = event('stock', 'movement-crashed', { productId, type: 'income', quantity: 5 });
        await pool.query(
          `INSERT INTO one_c_events(connection_id,tenant_id,event_id,entity_type,external_id,direction,payload_hash,status)
        VALUES($1,$2,$3,'stock',$4,'import',$5,'processing')`,
          [connection.id, tenant, input.eventId, input.externalId, digest(input)],
        );
        assert.equal((await service.import(connection, input)).status, 'needs_review');
        assert.equal((await service.import(connection, { ...input, eventId: randomUUID() })).status, 'needs_review');
        assert.equal(
          Number((await pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock),
          0,
        );
      });

      await t.test('native stock movement, draft purchase, deferred work order and exact payment', async () => {
        const stock = await domain.snapshot(connection, 'stock', productId);
        const stockEvent = event('stock', 'movement-good', {
          productId,
          type: 'income',
          quantity: 5,
          expectedStock: 0,
          expectedWarehouseId: stock.payload.warehouseId,
        });
        await applied(stockEvent);
        await applied(stockEvent);
        assert.equal(
          Number((await pool.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock),
          5,
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [tenant])).rows[0].n,
          1,
        );
        const supplier = (
          await pool.query('INSERT INTO suppliers(name,tenant_id) VALUES($1,$2) RETURNING id', [
            'Synthetic supplier',
            tenant,
          ])
        ).rows[0].id;
        const po = await applied(
          event('purchases', 'purchase-1', {
            supplierId: supplier,
            items: [{ productId, quantity: 2, costPrice: 40 }],
          }),
        );
        assert.equal((await domain.snapshot(connection, 'purchases', po.autexaId)).payload.status, 'draft');
        const order = await applied(
          event('workOrders', 'order-1', {
            masterId: owner,
            clientId,
            services: [{ name: 'Synthetic repair', price: 500, quantity: 1 }],
          }),
        );
        assert.equal((await domain.snapshot(connection, 'workOrders', order.autexaId)).payload.isDeferred, true);
        const payment = event('payments', 'payment-1', {
          checkId: order.autexaId,
          paymentMethod: 'cash',
          cashAmount: 500,
          cardAmount: 0,
        });
        await applied(payment);
        await applied(payment);
        assert.equal((await domain.snapshot(connection, 'payments', order.autexaId)).payload.cashAmount, 500);
        const conflictingPayment = await service.import(
          connection,
          event('payments', 'payment-2', { ...payment.payload, cashAmount: 700 }),
        );
        assert.equal(conflictingPayment.status, 'needs_review');
        assert.equal((await domain.snapshot(connection, 'payments', order.autexaId)).payload.cashAmount, 500);
      });

      await t.test(
        'stock expense is exact; stale balance, wrong warehouse and insufficient stock cannot mutate',
        async () => {
          const stock = await domain.snapshot(connection, 'stock', productId);
          const payload = {
            productId,
            type: 'expense',
            quantity: 2.5,
            expectedStock: 5,
            expectedWarehouseId: stock.payload.warehouseId,
          };
          const expense = event('stock', 'expense-good', payload);
          await applied(expense);
          await applied(expense);
          assert.equal((await domain.snapshot(connection, 'stock', productId)).payload.quantity, 2.5);
          const attempts = [
            { ...payload, quantity: 1 },
            { ...payload, expectedStock: 2.5, expectedWarehouseId: randomUUID() },
            { ...payload, expectedStock: 2.5, quantity: 3 },
          ];
          for (const bad of attempts)
            assert.equal((await service.import(connection, event('stock', randomUUID(), bad))).status, 'needs_review');
          assert.equal((await domain.snapshot(connection, 'stock', productId)).payload.quantity, 2.5);
          assert.equal(
            (await pool.query('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [tenant])).rows[0].n,
            2,
          );
          assert.equal(
            (await pool.query('SELECT count(*)::int n FROM expenses WHERE tenant_id=$1', [tenant])).rows[0].n,
            0,
          );
          // Movement links must never be reused as an outbound balance-snapshot ID.
          const exported = (await service.export(connection, 'stock')).items[0];
          assert.equal(exported.externalId, null);
          assert.deepEqual(
            await service.ack(connection, {
              entityType: 'stock',
              items: [{ ...exported, externalId: 'stock-snapshot-product-1' }],
            }),
            { accepted: 1, needsReview: 0 },
          );
          assert.equal((await service.export(connection, 'stock')).items.length, 0);
          await applied(
            event('stock', 'movement-next', { ...payload, type: 'income', quantity: 0.5, expectedStock: 2.5 }),
          );
          assert.equal((await service.export(connection, 'stock')).items[0].externalId, 'stock-snapshot-product-1');
        },
      );

      await t.test('stock CAS compares after the native row lock, including concurrent income', async () => {
        const stock = await domain.snapshot(connection, 'stock', productId);
        const hold = await pool.connect();
        try {
          await hold.query('BEGIN');
          await hold.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]);
          const pending = service.import(
            connection,
            event('stock', 'racing-movement', {
              productId,
              type: 'income',
              quantity: 1,
              expectedStock: 3,
              expectedWarehouseId: stock.payload.warehouseId,
            }),
          );
          await hold.query('UPDATE products SET stock=4 WHERE id=$1', [productId]);
          await hold.query('COMMIT');
          assert.equal((await pending).status, 'needs_review');
        } finally {
          await hold.query('ROLLBACK');
          hold.release();
        }
        assert.equal((await domain.snapshot(connection, 'stock', productId)).payload.quantity, 4);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [tenant])).rows[0].n,
          3,
        );
      });

      await t.test('catalog category is bounded before a native mutation', async () => {
        const current = await domain.snapshot(connection, 'products', productId);
        const invalid = await service.import(
          connection,
          event('products', 'product-1', { category: 'x'.repeat(501) }, { baseRevision: digest(current.payload) }),
        );
        assert.equal(invalid.status, 'needs_review');
        assert.equal(
          (await domain.snapshot(connection, 'products', productId)).payload.category,
          'Расходники/Воздушные фильтры',
        );
      });

      await t.test('migration is idempotent; RLS hides connections without the correct tenant context', async () => {
        const migration = require('node:fs').readFileSync(
          require('node:path').join(__dirname, '../migrations/174_one_c_exchange.sql'),
          'utf8',
        );
        await pool.query(migration);
        const role = `onec_test_${randomUUID().replace(/-/g, '')}`;
        const client = await pool.connect();
        try {
          await client.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
          await client.query(`GRANT SELECT ON one_c_connections TO ${role}`);
          await client.query('BEGIN');
          await client.query(`SET LOCAL ROLE ${role}`);
          assert.equal((await client.query('SELECT * FROM one_c_connections')).rows.length, 0);
          await client.query("SELECT set_config('app.tenant_id',$1,true)", [otherTenant]);
          assert.equal((await client.query('SELECT * FROM one_c_connections')).rows.length, 0);
          await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
          assert.equal((await client.query('SELECT * FROM one_c_connections')).rows.length, 1);
          await client.query('ROLLBACK');
        } finally {
          await client.query('ROLLBACK');
          await client.query(`DROP OWNED BY ${role}`);
          await client.query(`DROP ROLE ${role}`);
          client.release();
        }
      });
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, otherTenant]]);
      await pool.end();
    }
  },
);
