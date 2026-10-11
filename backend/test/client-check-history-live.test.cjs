const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
Logger.overrideLogger(false);
const live = process.env.OCT12_CLIENT_HISTORY_DB;
const status = (code) => (error) => error.getStatus?.() === code;

test(
  'client check history / PostgreSQL16: colleague checks without widening journal or tenant/branch access',
  { skip: !live, timeout: 60000 },
  async (t) => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55440');
    assert.equal(url.pathname, '/autexa_oct12_core');
    const admin = new Pool({ connectionString: live });
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.OCT12_CLIENT_HISTORY_APP_PASSWORD;
    assert.ok(appUrl.password);
    const app = new Pool({ connectionString: appUrl.toString() });
    const pool = new TenantAwarePool(admin, app);
    const clients = new ClientsService(pool);
    const checks = new ChecksService(pool, new WarrantyService(pool), clients);
    const ids = Object.fromEntries(
      [
        'tenant',
        'foreignTenant',
        'point',
        'otherPoint',
        'master',
        'colleague',
        'owner',
        'client',
        'otherClient',
        'foreignClient',
        'check',
        'ownCheck',
        'foreignCheck',
      ].map((k) => [k, randomUUID()]),
    );
    const actor = {
      userID: ids.master,
      tenantID: ids.tenant,
      role: 'master',
      permissions: { checks_view: false, checks_view_all: false, clients_view: true },
      pointId: ids.point,
      currentPointId: ids.point,
    };
    const run = (fn) => runWithTenant(ids.tenant, fn);
    try {
      for (const tenant of [ids.tenant, ids.foreignTenant])
        await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Client history QA')", [tenant]);
      await admin.query(
        "INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,'Main',true),($2,$3,'Other',false)",
        [ids.point, ids.otherPoint, ids.tenant],
      );
      for (const user of [ids.master, ids.colleague, ids.owner])
        await admin.query(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$2,$1::text,'unused','History QA','master')",
          [user, ids.tenant],
        );
      for (const [client, tenant, point] of [
        [ids.client, ids.tenant, ids.otherPoint],
        [ids.otherClient, ids.tenant, ids.point],
        [ids.foreignClient, ids.foreignTenant, null],
      ]) {
        await admin.query(
          "INSERT INTO clients(id,tenant_id,full_name,phone,point_id) VALUES($1,$2,'History client',$4,$3)",
          [client, tenant, point, client === ids.client ? '79991112233' : client === ids.otherClient ? '79991112234' : '79991112235'],
        );
      }
      for (const [check, tenant, client, master, number] of [
        [ids.check, ids.tenant, ids.client, ids.colleague, 1],
        [ids.ownCheck, ids.tenant, ids.client, ids.master, 2],
        [ids.foreignCheck, ids.foreignTenant, ids.foreignClient, null, 1],
      ]) {
        await admin.query(
          "INSERT INTO checks(id,tenant_id,client_id,master_id,number,date,service_total,total_revenue,total_cost,profit,payment_method) VALUES($1,$2,$3,$4,$5,now(),500,500,100,400,'cash')",
          [check, tenant, client, master, number],
        );
      }
      await t.test('history sees and opens colleague work; ordinary own journal/detail remain restricted', async () => {
        const history = await run(() => checks.getClientHistory(ids.client, ids.tenant, {}, actor));
        assert.deepEqual(new Set(history.data.map((x) => x.id)), new Set([ids.check, ids.ownCheck]));
        const detail = await run(() => checks.getClientHistoryCheck(ids.check, ids.client, ids.tenant, actor));
        assert.equal(detail.id, ids.check);
        assert.equal(detail.profit, 0);
        const journal = await run(() => checks.getAll(ids.tenant, {}, actor));
        assert.ok(!journal.data.some((x) => x.id === ids.check));
        await assert.rejects(
          run(() => checks.getByIdForActor(ids.check, ids.tenant, actor)),
          status(404),
        );
      });
      await t.test('client and check IDs cannot be mixed or crossed between tenants', async () => {
        await assert.rejects(
          run(() => checks.getClientHistoryCheck(ids.check, ids.otherClient, ids.tenant, actor)),
          status(404),
        );
        await assert.rejects(
          run(() => checks.getClientHistory(ids.foreignClient, ids.tenant, {}, actor)),
          status(404),
        );
        await assert.rejects(
          run(() => checks.getClientHistoryCheck(ids.foreignCheck, ids.client, ids.tenant, actor)),
          status(404),
        );
        const history = await run(() =>
          checks.getClientHistory(
            ids.client,
            ids.tenant,
            { clientId: ids.foreignClient, masterId: ids.colleague },
            actor,
          ),
        );
        assert.equal(history.data.length, 2);
      });
      await t.test('separate branch client database still denies inaccessible clients', async () => {
        await admin.query('UPDATE tenants SET points_shared_clients=false WHERE id=$1', [ids.tenant]);
        await assert.rejects(
          run(() => checks.getClientHistory(ids.client, ids.tenant, {}, actor)),
          status(404),
        );
        await assert.rejects(
          run(() => checks.getClientHistoryCheck(ids.check, ids.client, ids.tenant, actor)),
          status(404),
        );
      });
    } finally {
      await admin.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[ids.tenant, ids.foreignTenant]]);
      await Promise.all([admin.end(), app.end()]);
    }
  },
);
