const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { Module, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PurchaseOrdersController } = require('../dist/purchase-orders/purchase-orders.controller');
const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');

Logger.overrideLogger(false);
process.env.JWT_SECRET = 'isolated-purchase-order-validation-test';

test('purchase order HTTP validation preserves draft, company, branch and permission boundaries', async (t) => {
  const tenant = randomUUID(),
    point = randomUUID();
  let actorTenant = tenant,
    actorPoint = point,
    role = 'director';
  t.beforeEach(() => {
    actorTenant = tenant;
    actorPoint = point;
    role = 'director';
  });
  // Real JWT/role/permission guards; authentication storage is separate from order storage.
  new JwtStrategy({
    query: async (sql) => ({
      rows: /FROM revoked_tokens/.test(sql)
        ? []
        : [
            {
              is_active: true,
              tenant_id: actorTenant,
              role,
              role_matrix: {},
              session_stale: false,
              tenant_has_points: actorPoint !== null,
              point_allowed: true,
            },
          ],
    }),
  });
  const orders = new Map();
  const seed = (tenantId = tenant, pointId = point, status = 'draft') => {
    const id = randomUUID();
    orders.set(id, { id, tenant_id: tenantId, point_id: pointId, status, supplier_id: randomUUID(), total: '12.50' });
    return id;
  };
  const sqlCalls = [];
  let connections = 0,
    serviceCalls = 0;
  const query = async (sql, params = []) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    sqlCalls.push({ sql: flat, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(flat)) return { rows: [] };
    const row = orders.get(params[0]?.toLowerCase());
    const own = row?.tenant_id === params[1];
    if (flat.startsWith('SELECT 1 FROM purchase_orders')) {
      assert.match(flat, /t\.id = \$1 AND t\.tenant_id = \$2 AND t\.point_id = \$3/);
      return { rows: own && row.point_id === params[2] ? [{ ok: 1 }] : [] };
    }
    if (flat.startsWith('SELECT status FROM purchase_orders')) {
      assert.match(flat, /WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE$/);
      return { rows: own ? [{ status: row.status }] : [] };
    }
    if (flat.startsWith('UPDATE purchase_orders')) {
      assert.match(flat, /WHERE id=\$1 AND tenant_id=\$2$/);
      assert.ok(own, 'a foreign company must never be updated');
      row.status = 'ordered';
      return { rows: [] };
    }
    if (flat.startsWith('SELECT po.*')) {
      assert.match(flat, /WHERE po.id=\$1 AND po.tenant_id=\$2$/);
      return { rows: own ? [row] : [] };
    }
    if (flat.startsWith('SELECT * FROM purchase_order_items') || flat.startsWith('SELECT id FROM deliveries'))
      return { rows: [] };
    throw new Error(`Unexpected SQL: ${flat}`);
  };
  const pool = {
    query,
    connect: async () => {
      connections++;
      return { query, release() {} };
    },
  };
  const service = new PurchaseOrdersService(pool, {}, {});
  const markOrdered = service.markOrdered.bind(service);
  service.markOrdered = (...args) => {
    serviceCalls++;
    return markOrdered(...args);
  };
  class TestModule {}
  Module({
    controllers: [PurchaseOrdersController],
    providers: [{ provide: PurchaseOrdersService, useValue: service }],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const post = (id, authenticated = true) =>
    fetch(`${base}/api/purchase-orders/${encodeURIComponent(id)}/order`, {
      method: 'POST',
      headers: authenticated
        ? { Authorization: `Bearer ${jwt.sign({ sub: randomUUID(), jti: randomUUID(), pointId: actorPoint })}` }
        : {},
    });
  try {
    await t.test('malformed IDs return 400 before the service, branch query or transaction', async () => {
      for (const scope of [null, point]) {
        actorPoint = scope;
        for (const id of ['undefined', 'null', '123', 'not-a-uuid', ' ', `${randomUUID()} `, 'g'.repeat(36)]) {
          const response = await post(id);
          assert.equal(response.status, 400, `${scope}: ${JSON.stringify(id)}`);
          assert.equal((await response.json()).message, 'Неверный идентификатор в запросе');
        }
      }
      actorPoint = point;
      assert.equal(serviceCalls, 0);
      assert.equal(connections, 0);
      assert.deepEqual(sqlCalls, []);
    });
    await t.test('valid draft is ordered and the same ID is returned, including uppercase input', async () => {
      const id = seed();
      const response = await post(id.toUpperCase());
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.id, id);
      assert.equal(body.status, 'ordered');
      assert.equal(body.total, 12.5);
      assert.equal(orders.get(id).status, 'ordered');
      assert.ok(sqlCalls.some(({ sql }) => sql === 'COMMIT'));
      assert.equal((await post(id)).status, 400, 'already ordered is not a draft');
    });
    await t.test('foreign company, foreign branch and missing UUID remain 404 without writes', async () => {
      for (const id of [seed(randomUUID()), seed(tenant, randomUUID()), randomUUID()]) {
        const beforeConnections = connections;
        const beforeWrites = sqlCalls.filter(({ sql }) => sql.startsWith('UPDATE')).length;
        const response = await post(id);
        assert.equal(response.status, 404);
        assert.equal((await response.json()).message, 'Заказ не найден');
        assert.equal(connections, beforeConnections, 'branch gate runs before opening a transaction');
        assert.equal(sqlCalls.filter(({ sql }) => sql.startsWith('UPDATE')).length, beforeWrites);
      }
    });
    await t.test('company filter also holds for a company without branches', async () => {
      actorPoint = null;
      const own = seed(tenant, null),
        foreign = seed(randomUUID(), null);
      assert.equal((await post(own)).status, 201);
      assert.equal((await post(foreign)).status, 404);
      assert.equal(orders.get(foreign).status, 'draft');
      actorPoint = point;
    });
    await t.test('non-draft states stay rejected without updates', async () => {
      for (const status of ['ordered', 'received', 'cancelled']) {
        const id = seed(tenant, point, status);
        assert.equal((await post(id)).status, 400);
        assert.equal(orders.get(id).status, status);
      }
    });
    await t.test('authentication and suppliers_manage are still required', async () => {
      const before = serviceCalls,
        id = seed();
      assert.equal((await post(id, false)).status, 401);
      role = 'master';
      assert.equal((await post(id)).status, 403);
      assert.equal(serviceCalls, before);
      assert.equal(orders.get(id).status, 'draft');
    });
  } finally {
    await app.close();
  }
});

const live = process.env.SUPPLIER_LIVE_DB;
test(
  'PostgreSQL 16 / RLS: save and order an existing draft without crossing company or branch',
  { skip: !live },
  async () => {
    const url = new URL(live);
    assert.ok(
      ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55438' && url.pathname === '/autexa_oct8_test',
      'Only the disposable CI PostgreSQL fixture is allowed',
    );
    const { Pool } = require('pg');
    const { TenantAwarePool } = require('../dist/common/tenant-pool');
    const { runWithTenant } = require('../dist/common/tenant-context');
    const admin = new Pool({ connectionString: live, statement_timeout: 8000 });
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.SUPPLIER_LIVE_APP_PASSWORD || 'oct8_app_fixture_only';
    const app = new Pool({ connectionString: appUrl.toString(), statement_timeout: 8000 });
    const pool = new TenantAwarePool(admin, app);
    const service = new PurchaseOrdersService(pool, {}, {});
    const f = Object.fromEntries(
      [
        'tenant',
        'foreignTenant',
        'point',
        'otherPoint',
        'foreignPoint',
        'supplier',
        'foreignSupplier',
        'warehouse',
        'foreignWarehouse',
        'product',
        'foreignProduct',
        'user',
        'foreignUser',
        'otherBranchOrder',
      ].map((key) => [key, randomUUID()]),
    );
    const q = (sql, params = []) => admin.query(sql, params);
    const run = (tenant, fn) => runWithTenant(tenant, fn);
    const status = (code) => (error) => error.getStatus?.() === code;
    try {
      await q("INSERT INTO tenants(id,name) VALUES($1,'Order fixture'),($2,'Foreign order fixture')", [
        f.tenant,
        f.foreignTenant,
      ]);
      await q(
        "INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$4,'Main',true),($2,$4,'Other',false),($3,$5,'Foreign',true)",
        [f.point, f.otherPoint, f.foreignPoint, f.tenant, f.foreignTenant],
      );
      for (const foreign of [false, true]) {
        const tenant = foreign ? f.foreignTenant : f.tenant;
        const point = foreign ? f.foreignPoint : f.point;
        const supplier = foreign ? f.foreignSupplier : f.supplier;
        const warehouse = foreign ? f.foreignWarehouse : f.warehouse;
        const product = foreign ? f.foreignProduct : f.product;
        const user = foreign ? f.foreignUser : f.user;
        await q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Supplier')", [supplier, tenant]);
        await q("INSERT INTO warehouses(id,tenant_id,point_id,name,kind) VALUES($1,$2,$3,'Main stock','main')", [
          warehouse,
          tenant,
          point,
        ]);
        await q(
          "INSERT INTO products(id,tenant_id,warehouse_id,name,stock,cost_price,sell_price) VALUES($1,$2,$3,'Part',10,7,20)",
          [product, tenant, warehouse],
        );
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused','Owner','director')",
          [user, tenant, user],
        );
      }
      const create = (tenant, point, supplier, product, user) =>
        run(tenant, () =>
          service.create(
            tenant,
            user,
            { supplierId: supplier, items: [{ productId: product, quantity: 2, costPrice: 12.5 }] },
            point,
          ),
        );
      const draft = await create(f.tenant, f.point, f.supplier, f.product, f.user);
      const foreignDraft = await create(
        f.foreignTenant,
        f.foreignPoint,
        f.foreignSupplier,
        f.foreignProduct,
        f.foreignUser,
      );
      await q("INSERT INTO purchase_orders(id,tenant_id,supplier_id,point_id,status) VALUES($1,$2,$3,$4,'draft')", [
        f.otherBranchOrder,
        f.tenant,
        f.supplier,
        f.otherPoint,
      ]);
      const role = await run(f.tenant, () => pool.query('SELECT current_user AS role'));
      assert.equal(role.rows[0].role, 'autexa_app', 'service queries use the restricted RLS role');
      const hidden = await run(f.tenant, () =>
        pool.query('SELECT id FROM purchase_orders WHERE id=$1', [foreignDraft.id]),
      );
      assert.deepEqual(hidden.rows, [], 'RLS hides the other company even without a tenant predicate');
      const updated = await run(f.tenant, () =>
        service.update(
          draft.id,
          f.tenant,
          { note: 'Edited draft', items: [{ productId: f.product, quantity: 3, costPrice: 12.5 }] },
          f.point,
        ),
      );
      assert.equal(updated.id, draft.id);
      assert.equal(updated.items[0].quantity, 3);
      for (const id of [foreignDraft.id, f.otherBranchOrder, randomUUID()])
        await assert.rejects(
          run(f.tenant, () => service.markOrdered(id, f.tenant, f.point)),
          status(404),
        );
      const ordered = await run(f.tenant, () => service.markOrdered(updated.id, f.tenant, f.point));
      assert.equal(ordered.id, draft.id);
      assert.equal(ordered.status, 'ordered');
      assert.equal(ordered.note, 'Edited draft');
      assert.equal(ordered.total, 37.5);
      assert.equal(ordered.items[0].quantity, 3);
      await assert.rejects(
        run(f.tenant, () => service.markOrdered(draft.id, f.tenant, f.point)),
        status(400),
      );
      const rows = (
        await q('SELECT id,status,tenant_id,point_id FROM purchase_orders WHERE id=ANY($1::uuid[])', [
          [draft.id, foreignDraft.id, f.otherBranchOrder],
        ])
      ).rows;
      assert.equal(rows.find((r) => r.id === draft.id).point_id, f.point);
      assert.equal(rows.find((r) => r.id === draft.id).tenant_id, f.tenant);
      assert.equal(rows.find((r) => r.id === foreignDraft.id).status, 'draft');
      assert.equal(rows.find((r) => r.id === f.otherBranchOrder).status, 'draft');
      assert.equal(Number((await q('SELECT stock FROM products WHERE id=$1', [f.product])).rows[0].stock), 10);
    } finally {
      await pool.end();
    }
  },
);
