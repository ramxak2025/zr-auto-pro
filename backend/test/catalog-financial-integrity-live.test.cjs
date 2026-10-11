const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { ValidationPipe } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { CreateCheckDto } = require('../dist/checks/dto/create-check.dto');
Logger.overrideLogger(false);
const live = process.env.OCT10_PRICING_LIVE_DB;

async function fixture(work) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55440');
  assert.equal(url.pathname, '/autexa_oct12_integrity');
  const appUrl = new URL(url);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
  assert.ok(appUrl.password);
  const admin = new Pool({ connectionString: url.toString(), max: 5, statement_timeout: 8000 });
  const app = new Pool({ connectionString: appUrl.toString(), max: 5, statement_timeout: 8000 });
  const pool = new TenantAwarePool(admin, app);
  const tenant = randomUUID(),
    foreignTenant = randomUUID(),
    ownerId = randomUUID(),
    staffId = randomUUID(),
    otherId = randomUUID(),
    point = randomUUID();
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const run = (fn) => runWithTenant(tenant, fn);
  const owner = { userID: ownerId, role: 'director', tenantID: tenant, currentPointId: point };
  const staff = { ...owner, userID: staffId, role: 'master', permissions: { warehouse_manage: false } };
  try {
    await q("INSERT INTO tenants(id,name) VALUES($1,'Financial integrity QA'),($2,'Foreign integrity QA')", [
      tenant,
      foreignTenant,
    ]);
    await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,'Main',true)", [point, tenant]);
    for (const actor of [owner, staff, { ...staff, userID: otherId }]) {
      await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused','QA',$4)", [
        actor.userID,
        tenant,
        actor.userID,
        actor.role,
      ]);
    }
    const clients = new ClientsService(pool, undefined);
    await work({
      tenant,
      foreignTenant,
      owner,
      staff,
      otherId,
      pool,
      q,
      run,
      templates: new CheckTemplatesService(pool),
      catalog: new ServicesService(pool, clients),
      checks: new ChecksService(pool, new WarrantyService(pool), clients),
    });
  } finally {
    await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreignTenant]]);
    await pool.end();
  }
}

test(
  'real PG: manual template cost survives employee create, draft/closed edit, copy, whitelist and mixed sources',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ tenant, foreignTenant, owner, staff, otherId, q, run, templates, checks }) => {
      const manual = { name: 'Расходник', sellPrice: 100, costPrice: 40, quantity: 2 };
      const template = await run(() =>
        templates.create(tenant, owner, { name: 'Manual', shared: true, products: [manual] }),
      );
      const list = await run(() => templates.getAll(tenant, staff));
      assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(list)), false);
      const sourceLine = list.find((row) => row.id === template.id).products[0];
      const input = { ...sourceLine, costPrice: 0 };
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const create = async (products, actor = staff, extra = {}) => {
        const body = await pipe.transform(
          { masterId: actor.userID, paymentMethod: 'cash', services: [], products, ...extra },
          { type: 'body', metatype: CreateCheckDto },
        );
        return run(() => checks.create(tenant, actor.userID, actor.role, body, actor));
      };
      const money = async (id) =>
        (await q('SELECT product_cost_total::float AS cost, profit::float AS profit FROM checks WHERE id=$1', [id]))[0];
      const created = await create([input]);
      assert.deepEqual(
        await money(created.id),
        { cost: 80, profit: 120 },
        'hidden manual cost must not become a zero-cost sale',
      );
      const line = (
        await q(
          'SELECT cost_price::float AS cost, total_cost::float AS total FROM check_product_lines WHERE check_id=$1',
          [created.id],
        )
      )[0];
      assert.deepEqual(line, { cost: 40, total: 80 });
      const transformed = await pipe.transform(
        { masterId: staff.userID, products: [input] },
        { type: 'body', metatype: CreateCheckDto },
      );
      assert.deepEqual({ ...transformed.products[0].sourceTemplateProduct }, input.sourceTemplateProduct);
      const editedProducts = [{ ...input, quantity: 1.5, sellPrice: 200, costPrice: 999 }];
      const draft = await create([input], staff, { isDeferred: true });
      await run(() => checks.update(draft.id, tenant, staff.role, { products: editedProducts }, staff.userID, staff));
      assert.deepEqual(await money(draft.id), { cost: 60, profit: 240 });
      await run(() => checks.update(created.id, tenant, owner.role, { products: editedProducts }, owner.userID, owner));
      assert.deepEqual(await money(created.id), { cost: 60, profit: 240 });
      const copied = await run(() => templates.create(tenant, staff, { name: 'Copy', products: editedProducts }));
      assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(copied)), false);
      const copyRaw = (await q('SELECT products FROM check_templates WHERE id=$1', [copied.id]))[0].products;
      assert.equal(copyRaw[0].costPrice, 40);
      assert.equal(copyRaw[0].sourceTemplateProduct, undefined);
      const updatedCopy = await run(() =>
        templates.update(copied.id, tenant, staff, { products: [{ ...copied.products[0], quantity: 3 }] }),
      );
      assert.equal(
        (await q('SELECT products FROM check_templates WHERE id=$1', [copied.id]))[0].products[0].costPrice,
        40,
      );
      const mixed = await create([input, { ...updatedCopy.products[0], costPrice: 0 }]);
      assert.equal((await money(mixed.id)).cost, 200);
      const zero = await run(() =>
        templates.create(tenant, owner, { name: 'Free', shared: true, products: [{ ...manual, costPrice: 0 }] }),
      );
      assert.equal(zero.productCostTotal, 0);
      assert.equal((await money((await create([{ ...zero.products[0], costPrice: 900 }])).id)).cost, 0);
      const missing = await run(() =>
        templates.create(tenant, owner, {
          name: 'Unknown',
          shared: true,
          products: [{ name: 'No cost', sellPrice: 100, quantity: 1 }],
        }),
      );
      const denied = async (products, status) => {
        const before = await q('SELECT id, product_cost_total, profit FROM checks WHERE tenant_id=$1 ORDER BY id', [
          tenant,
        ]);
        const counters = await q('SELECT * FROM tenant_counters WHERE tenant_id=$1', [tenant]);
        const stock = await q('SELECT id,stock FROM products WHERE tenant_id=$1 ORDER BY id', [tenant]);
        await assert.rejects(create(products), (error) => error.getStatus?.() === status);
        assert.deepEqual(
          await q('SELECT id, product_cost_total, profit FROM checks WHERE tenant_id=$1 ORDER BY id', [tenant]),
          before,
        );
        assert.deepEqual(await q('SELECT * FROM tenant_counters WHERE tenant_id=$1', [tenant]), counters);
        assert.deepEqual(await q('SELECT id,stock FROM products WHERE tenant_id=$1 ORDER BY id', [tenant]), stock);
      };
      await denied([{ ...missing.products[0], costPrice: 0 }], 409);
      const privateTemplate = await run(() =>
        templates.create(tenant, { ...staff, userID: otherId }, { name: 'Private', products: [manual] }),
      );
      await denied([{ ...privateTemplate.products[0], costPrice: 0 }], 404);
      const foreignId = randomUUID();
      await q('INSERT INTO check_templates(id,tenant_id,name,products) VALUES($1,$2,$3,$4)', [
        foreignId,
        foreignTenant,
        'Foreign',
        JSON.stringify([manual]),
      ]);
      await denied(
        [{ ...input, sourceTemplateProduct: { ...input.sourceTemplateProduct, templateId: foreignId } }],
        404,
      );
      await denied([{ ...input, sourceTemplateProduct: { ...input.sourceTemplateProduct, productIndex: 99 } }], 400);
      await denied([{ ...input, name: 'Different' }], 400);
      await run(() => templates.update(template.id, tenant, owner, { products: [{ ...manual, costPrice: 70 }] }));
      await denied([input], 409);
      const prior = await money(draft.id);
      await assert.rejects(
        run(() => checks.update(draft.id, tenant, staff.role, { products: [input] }, staff.userID, staff)),
        (error) => error.getStatus?.() === 409,
      );
      assert.deepEqual(await money(draft.id), prior);
      const fresh = (await run(() => templates.getAll(tenant, staff))).find((row) => row.id === template.id);
      assert.equal((await money((await create([{ ...fresh.products[0], costPrice: 0 }])).id)).cost, 140);
      const warehouse = (
        await q("INSERT INTO warehouses(tenant_id,point_id,name,kind) VALUES($1,$2,'QA stock','main') RETURNING id", [
          tenant,
          owner.currentPointId,
        ])
      )[0].id;
      const productId = (
        await q(
          "INSERT INTO products(tenant_id,warehouse_id,name,cost_price,sell_price,stock) VALUES($1,$2,'Linked',10.01,20,100) RETURNING id",
          [tenant, warehouse],
        )
      )[0].id;
      const linked = await run(() =>
        templates.create(tenant, owner, {
          name: 'Linked fractional',
          shared: true,
          products: [
            { productId, name: 'Linked', costPrice: 999, sellPrice: 1, quantity: 1.5 },
            { productId, name: 'Linked', costPrice: 999, sellPrice: 1, quantity: 1.5 },
          ],
        }),
      );
      assert.equal(linked.productCostTotal, 30.04);
      const linkedInput = linked.products.map((product) => ({ ...product, costPrice: 0 }));
      assert.equal((await money((await create(linkedInput)).id)).cost, 30.04);
      await q('UPDATE products SET cost_price=15 WHERE id=$1', [productId]);
      assert.equal(
        (await money((await create(linkedInput)).id)).cost,
        45,
        'current linked cost wins over template/client snapshots',
      );
      await q('UPDATE products SET deleted_at=now() WHERE id=$1', [productId]);
      await denied(linkedInput, 409);
      const unavailable = (await run(() => templates.getAll(tenant, staff))).find((row) => row.id === linked.id);
      await denied(
        unavailable.products.map((product) => ({ ...product, costPrice: 0 })),
        409,
      );
      await q('UPDATE products SET deleted_at=NULL,warehouse_id=NULL WHERE id=$1', [productId]);
      await denied(linkedInput, 409);
    }),
);

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test(
  'real PG: source template revision remains pinned until the check commits',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ tenant, owner, staff, q, run, templates, checks }) => {
      const manual = { name: 'Pinned', costPrice: 40, sellPrice: 100, quantity: 2 };
      const template = await run(() =>
        templates.create(tenant, owner, { name: 'Pinned', shared: true, products: [manual] }),
      );
      const entered = deferred(),
        release = deferred();
      const loadPrices = checks.loadWarehouseSellPrices.bind(checks);
      checks.loadWarehouseSellPrices = async (...args) => {
        entered.resolve();
        await release.promise;
        return loadPrices(...args);
      };
      const creating = run(() =>
        checks.create(
          tenant,
          staff.userID,
          staff.role,
          { masterId: staff.userID, paymentMethod: 'cash', products: [{ ...template.products[0], costPrice: 0 }] },
          staff,
        ),
      );
      await entered.promise;
      let settled = false;
      const updating = run(() =>
        templates.update(template.id, tenant, owner, { products: [{ ...manual, costPrice: 70 }] }),
      ).finally(() => {
        settled = true;
      });
      let waiting = false;
      try {
        for (let attempt = 0; attempt < 100 && !settled; attempt++) {
          const [state] = await q(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE check_templates%') AS waiting",
          );
          if (state.waiting) {
            waiting = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
      } finally {
        release.resolve();
      }
      const created = await creating;
      await updating;
      assert.ok(waiting, 'template edit must wait for the check snapshot');
      assert.equal(
        (await q('SELECT product_cost_total::float AS cost FROM checks WHERE id=$1', [created.id]))[0].cost,
        80,
      );
      assert.equal((await run(() => templates.getAll(tenant, owner)))[0].productCostTotal, 140);
    }),
);
test(
  'real PG interleave: rule PUT/DELETE wait for folder rename/removal and reject old paths; earlier rules move with folder',
  { skip: !live, timeout: 30000 },
  async () =>
    fixture(async ({ tenant, q, run, catalog }) => {
      // Hold the actual folder transaction after its catalog lock and folder read.
      // A competing connection must be blocked on PostgreSQL's advisory lock.
      for (const operation of ['rename', 'remove']) {
        for (const method of ['put', 'delete']) {
          const path = `${operation}-${method}`;
          await run(() => catalog.createFolder(tenant, `${path}/Child`));
          await run(() => catalog.putVisibilityRule(tenant, { categoryPath: path, visibleRoleIds: [] }));
          const entered = deferred(),
            release = deferred();
          const original = catalog.getFolders.bind(catalog);
          let hold = true;
          catalog.getFolders = async (...args) => {
            const result = await original(...args);
            if (hold) {
              hold = false;
              entered.resolve();
              await release.promise;
            }
            return result;
          };
          const moving = run(() =>
            operation === 'rename'
              ? catalog.renameFolder(tenant, path, `${path}-new`)
              : catalog.removeFolder(tenant, path),
          );
          await entered.promise;
          let settled = false;
          const writing = run(() =>
            method === 'put'
              ? catalog.putVisibilityRule(tenant, { categoryPath: path, visibleRoleIds: [] })
              : catalog.deleteVisibilityRule(tenant, { categoryPath: path }),
          )
            .then(
              (value) => ({ value }),
              (error) => ({ error }),
            )
            .finally(() => {
              settled = true;
            });
          let waiting = false;
          try {
            for (let attempt = 0; attempt < 100 && !settled; attempt++) {
              const [state] = await q(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting",
              );
              if (state.waiting) {
                waiting = true;
                break;
              }
              await new Promise((done) => setTimeout(done, 10));
            }
          } finally {
            release.resolve();
            catalog.getFolders = original;
          }
          await moving;
          const result = await writing;
          assert.ok(waiting, `${operation}/${method} must wait on the catalog transaction`);
          assert.equal(result.error?.getStatus?.(), 404);
          const rules = await q('SELECT category_path FROM service_visibility_rules WHERE tenant_id=$1', [tenant]);
          assert.equal(
            rules.some((row) => row.category_path === path),
            false,
          );
          assert.equal(
            rules.some((row) => row.category_path === `${path}-new`),
            operation === 'rename',
          );
        }
      }
      await run(() => catalog.createFolder(tenant, 'Before'));
      await run(() => catalog.putVisibilityRule(tenant, { categoryPath: 'Before', visibleRoleIds: [] }));
      await run(() => catalog.putVisibilityRule(tenant, { categoryPath: 'Before', visibleRoleIds: [] }));
      await run(() => catalog.renameFolder(tenant, 'Before', 'After'));
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM service_visibility_rules WHERE tenant_id=$1 AND category_path='After'",
            [tenant],
          )
        )[0].n,
        1,
      );
      await run(() => catalog.deleteVisibilityRule(tenant, { categoryPath: 'After' }));
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM service_visibility_rules WHERE tenant_id=$1 AND category_path='After'",
            [tenant],
          )
        )[0].n,
        0,
      );
    }),
);
