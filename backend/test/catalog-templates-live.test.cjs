const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { ClientsService } = require('../dist/clients/clients.service');
const live = process.env.OCT10_PRICING_LIVE_DB;
test(
  'real PG: folder tree writes, current template money, private/shared ACL, RLS, actual execution history and client-point ACL',
  { skip: !live, timeout: 30000 },
  async () => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55440');
    assert.equal(url.pathname, '/autexa_oct12_catalog');
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
    assert.ok(appUrl.password);
    const admin = new Pool({ connectionString: live, max: 4 });
    const app = new Pool({ connectionString: appUrl.toString(), max: 4 });
    const pool = new TenantAwarePool(admin, app);
    const clients = new ClientsService(pool, undefined);
    const catalog = new ServicesService(pool, clients);
    const templates = new CheckTemplatesService(pool);
    const tenant = randomUUID(),
      foreignTenant = randomUUID(),
      ownerId = randomUUID(),
      staffId = randomUUID(),
      otherId = randomUUID(),
      point = randomUUID(),
      otherPoint = randomUUID();
    const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
    const run = (fn) => runWithTenant(tenant, fn);
    const owner = { userID: ownerId, tenantID: tenant, role: 'director', currentPointId: point };
    const staff = {
      userID: staffId,
      tenantID: tenant,
      role: 'master',
      currentPointId: point,
      permissions: { warehouse_manage: false },
    };
    try {
      await q(
        "INSERT INTO tenants(id,name,points_shared_clients) VALUES($1,'Catalog QA',false),($2,'Foreign QA',true)",
        [tenant, foreignTenant],
      );
      await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,'Main',true),($2,$3,'Other',false)", [
        point,
        otherPoint,
        tenant,
      ]);
      for (const [id, role] of [
        [ownerId, 'director'],
        [staffId, 'master'],
        [otherId, 'master'],
      ])
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$2,$1::text,'unused',$3,$4)",
          [id, tenant, id === staffId ? 'Мастер' : 'Коллега', role],
        );
      await run(() => catalog.createFolder(tenant, 'ТО/Масло'));
      await run(() => catalog.createFolder(tenant, 'Пустая'));
      await assert.rejects(
        run(() => catalog.createFolder(tenant, 'ТО')),
        (e) => e.getStatus() === 409,
      );
      const service = await run(() =>
        catalog.create(tenant, { name: 'Замена масла', category: 'ТО/Масло', defaultPrice: 400 }, ownerId),
      );
      const product = (
        await q(
          "INSERT INTO products(tenant_id,name,sell_price,cost_price,stock) VALUES($1,'Масло',100,40,50) RETURNING id",
          [tenant],
        )
      )[0];
      const dto = {
        name: 'ТО',
        shared: true,
        services: [{ serviceId: service.id, name: service.name, price: 1 }],
        products: [{ productId: product.id, name: 'Масло', sellPrice: 1, costPrice: 999, quantity: 2.5 }],
      };
      let tpl = await run(() => templates.create(tenant, owner, dto));
      assert.equal(tpl.productCostTotal, 100);
      assert.equal(tpl.services[0].price, 400);
      const raw = (await q('SELECT services,products FROM check_templates WHERE id=$1', [tpl.id]))[0];
      const snapshotCheck = (
        await q('INSERT INTO checks(tenant_id,master_id,point_id,is_deferred) VALUES($1,$2,$3,true) RETURNING id', [
          tenant,
          ownerId,
          point,
        ])
      )[0].id;
      await q(
        "INSERT INTO check_service_lines(check_id,service_id,master_id,name,price,total) VALUES($1,$2,$3,'Snapshot',400,400)",
        [snapshotCheck, service.id, ownerId],
      );
      await run(() =>
        catalog.update(service.id, tenant, { priceType: 'range', minPrice: 600, maxPrice: 900 }, ownerId),
      );
      await q('UPDATE products SET sell_price=150,cost_price=50 WHERE id=$1', [product.id]);
      tpl = (await run(() => templates.getAll(tenant, owner)))[0];
      assert.equal(tpl.services[0].price, 600);
      assert.equal(tpl.services[0].maxPrice, 900);
      assert.equal(tpl.productCostTotal, 125);
      assert.equal(tpl.products[0].sellPrice, 150);
      assert.deepEqual((await q('SELECT services,products FROM check_templates WHERE id=$1', [tpl.id]))[0], raw);
      assert.equal(
        Number((await q('SELECT price FROM check_service_lines WHERE check_id=$1', [snapshotCheck]))[0].price),
        400,
      );
      assert.ok((await run(() => catalog.getPriceHistory(service.id, tenant))).length >= 2);
      const privateTemplate = await run(() =>
        templates.create(tenant, owner, { ...dto, name: 'Личный', shared: false }),
      );
      const staffTemplates = await run(() => templates.getAll(tenant, staff));
      assert.equal(
        staffTemplates.some((t) => t.id === privateTemplate.id),
        false,
      );
      assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(staffTemplates)), false);
      const staffOwn = await run(() => templates.create(tenant, staff, { ...dto, shared: false }));
      assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(staffOwn)), false);
      const staffUpdate = await run(() => templates.update(staffOwn.id, tenant, staff, { name: 'Изменённый' }));
      assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(staffUpdate)), false);
      await q('UPDATE products SET deleted_at=now() WHERE id=$1', [product.id]);
      tpl = (await run(() => templates.getAll(tenant, owner))).find((t) => t.id === tpl.id);
      assert.equal(tpl.costStatus, 'unknown');
      assert.equal(tpl.productCostTotal, undefined);
      assert.equal(tpl.products[0].costPrice, undefined);
      await q("UPDATE services SET category=' ТО / Масло ' WHERE id=$1", [service.id]);
      await run(() => catalog.renameFolder(tenant, 'ТО', 'Обслуживание'));
      assert.equal((await run(() => catalog.getById(service.id, tenant))).category, 'Обслуживание/Масло');
      await assert.rejects(
        run(() => catalog.renameFolder(tenant, 'Обслуживание', 'ТО', 'Обслуживание/Масло')),
        (e) => e.getStatus() === 400,
      );
      await run(() => catalog.renameFolder(tenant, 'Обслуживание', 'ТО', 'Пустая'));
      assert.equal((await run(() => catalog.getById(service.id, tenant))).category, 'Пустая/ТО/Масло');
      await run(() => catalog.removeFolder(tenant, 'Пустая/ТО'));
      assert.equal((await run(() => catalog.getById(service.id, tenant))).category, 'Пустая');
      const visibleClient = (
        await q("INSERT INTO clients(tenant_id,point_id,full_name,phone) VALUES($1,$2,'Видимый','123') RETURNING id", [
          tenant,
          point,
        ])
      )[0].id;
      const hiddenClient = (
        await q("INSERT INTO clients(tenant_id,point_id,full_name,phone) VALUES($1,$2,'Скрытый','124') RETURNING id", [
          tenant,
          otherPoint,
        ])
      )[0].id;
      const checkIds = [];
      for (const clientId of [visibleClient, hiddenClient, null]) {
        const ch = (
          await q(
            'INSERT INTO checks(tenant_id,master_id,client_id,point_id,is_deferred) VALUES($1,$2,$3,$4,false) RETURNING id',
            [tenant, otherId, clientId, otherPoint],
          )
        )[0].id;
        checkIds.push(ch);
        await q(
          "INSERT INTO check_service_lines(check_id,service_id,master_id,name,price,total,quantity) VALUES($1,$2,$3,'Замена масла',775,775,1)",
          [ch, service.id, otherId],
        );
      }
      let history = await run(() => catalog.getExecutionHistory(service.id, tenant, staff, {}));
      assert.equal(history.total, 1);
      assert.equal(history.data[0].checkId, checkIds[0]);
      assert.equal(history.data[0].price, 775);
      assert.equal(history.data[0].clientId, visibleClient);
      assert.equal(history.data[0].executorName, 'Коллега');
      history = await run(() =>
        catalog.getExecutionHistory(
          service.id,
          tenant,
          { ...staff, permissions: { clients_view: false, checks_view: true, checks_view_all: false } },
          {},
        ),
      );
      assert.equal(history.total, 0);
      await q('INSERT INTO check_assignees(check_id,tenant_id,user_id) VALUES($1,$2,$3)', [
        checkIds[2],
        tenant,
        staffId,
      ]);
      history = await run(() => catalog.getExecutionHistory(service.id, tenant, staff, {}));
      assert.equal(history.total, 2);
      assert.equal(history.data.find((e) => e.checkId === checkIds[2]).clientId, null);
      history = await run(() => catalog.getExecutionHistory(service.id, tenant, owner, {}));
      assert.equal(history.total, 3);
      await q('UPDATE checks SET deleted_at=now() WHERE id=$1', [checkIds[0]]);
      assert.equal((await run(() => catalog.getExecutionHistory(service.id, tenant, staff, {}))).total, 1);
      assert.equal((await runWithTenant(foreignTenant, () => catalog.getFolders(foreignTenant))).length, 0);
      assert.equal(
        (
          await runWithTenant(foreignTenant, () =>
            templates.getAll(foreignTenant, { ...owner, tenantID: foreignTenant }),
          )
        ).length,
        0,
      );
      await assert.rejects(
        runWithTenant(foreignTenant, () =>
          catalog.getExecutionHistory(service.id, foreignTenant, { ...owner, tenantID: foreignTenant }, {}),
        ),
        (e) => e.getStatus() === 404,
      );
      const policies = await q(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='service_folders'",
      );
      assert.equal(policies[0].relrowsecurity, true);
      assert.equal(policies[0].relforcerowsecurity, true);
    } finally {
      await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreignTenant]]);
      await app.end();
      await admin.end();
    }
  },
);
