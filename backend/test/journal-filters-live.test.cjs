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
const live = process.env.AUTEXA_JOURNAL_TEST_DB;

test(
  'journal filters / real PostgreSQL: ownership, ACL, tenant/point, cents, timezone, count and cursor',
  { skip: !live, timeout: 60000 },
  async (t) => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(
      (url.port === '55446' && ['/autexa_oct13_journal_polish', '/autexa_oct13_recovery'].includes(url.pathname)) ||
        (url.port === '55438' && url.pathname === '/autexa_oct8_test'),
      'Named disposable QA databases only',
    );
    const admin = new Pool({ connectionString: live });
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.AUTEXA_JOURNAL_APP_PASSWORD;
    assert.ok(appUrl.password);
    const app = new Pool({ connectionString: appUrl.toString() });
    const pool = new TenantAwarePool(admin, app);
    const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool));
    const ids = Object.fromEntries(
      ['tenant', 'foreignTenant', 'point', 'otherPoint', 'main', 'other', 'cashier', 'client'].map((name) => [
        name,
        randomUUID(),
      ]),
    );
    const ownActor = {
      userID: ids.main,
      tenantID: ids.tenant,
      role: 'master',
      permissions: { checks_view: true, checks_view_all: false },
      pointId: ids.point,
      currentPointId: ids.point,
    };
    const owner = { ...ownActor, role: 'director' };
    const run = (query = {}, actor = owner) => runWithTenant(ids.tenant, () => checks.getAll(ids.tenant, query, actor));
    const fixtures = {};
    try {
      for (const tenant of [ids.tenant, ids.foreignTenant])
        await admin.query("INSERT INTO tenants(id,name,timezone) VALUES($1,'Journal QA','Europe/Moscow')", [tenant]);
      await admin.query(
        "INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,'Main',true),($2,$3,'Other',false)",
        [ids.point, ids.otherPoint, ids.tenant],
      );
      for (const user of [ids.main, ids.other, ids.cashier])
        await admin.query(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1::uuid,$2,$1::text,'unused','Journal user','master')",
          [user, ids.tenant],
        );
      await admin.query(
        "INSERT INTO clients(id,tenant_id,full_name,phone,point_id) VALUES($1,$2,'Journal needle','79991114455',$3)",
        [ids.client, ids.tenant, ids.point],
      );
      const insert = async (name, values = {}) => {
        const id = randomUUID();
        fixtures[name] = id;
        const v = {
          tenant: ids.tenant,
          point: ids.point,
          master: ids.main,
          date: '2026-10-12T21:00:00Z',
          amount: '100.50',
          discount: '5',
          deferred: true,
          returned: true,
          accepted: ids.cashier,
          client: ids.client,
          ...values,
        };
        await admin.query(
          "INSERT INTO checks(id,tenant_id,point_id,master_id,client_id,date,number,service_total,total_revenue,total_cost,profit,discount,is_deferred,is_returned,accepted_by,payment_method,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,100,$8,0,$8,$9,$10,$11,$12,'cash',$6)",
          [
            id,
            v.tenant,
            v.point,
            v.master,
            v.client,
            v.date,
            Object.keys(fixtures).length,
            v.amount,
            v.discount,
            v.deferred,
            v.returned,
            v.accepted,
          ],
        );
        return id;
      };
      await insert('start');
      await insert('end', { date: '2026-10-13T20:59:59.999Z' });
      await insert('before', { date: '2026-10-12T20:59:59.999Z' });
      await insert('after', { date: '2026-10-13T21:00:00Z' });
      await insert('low', { amount: '100.49' });
      await insert('high', { amount: '100.51' });
      await insert('zero', { amount: '0', discount: '0' });
      await insert('noDiscount', { discount: '0' });
      await insert('closed', { deferred: false });
      await insert('notReturned', { returned: false });
      await insert('otherMaster', { master: ids.other, accepted: ids.main });
      await admin.query(
        "INSERT INTO check_service_lines(check_id,master_id,name,price,total) VALUES($1,$2,'Line executor',1,1)",
        [fixtures.otherMaster, ids.main],
      );
      await insert('otherInvisible', { master: ids.other });
      await insert('otherPoint', { point: ids.otherPoint });
      await insert('foreign', { tenant: ids.foreignTenant, point: null, master: null, client: null, accepted: null });
      await insert('deleted');
      await admin.query('UPDATE checks SET deleted_at=now() WHERE id=$1', [fixtures.deleted]);
      const combo = {
        masterId: ids.main,
        search: 'needle',
        dateFrom: '2026-10-13',
        dateTo: '2026-10-13',
        amountFrom: '100.50',
        amountTo: '100.50',
        hasDiscount: 'true',
        isDeferred: 'true',
        isReturned: 'true',
      };
      await t.test(
        'strict main master excludes line executor and cashier, keeps ownership visibility ACL',
        async () => {
          const own = await run({ masterId: ids.main }, ownActor);
          assert.ok(!own.data.some((x) => x.id === fixtures.otherMaster));
          const normal = await run({}, ownActor);
          assert.ok(normal.data.some((x) => x.id === fixtures.otherMaster));
          assert.ok(!normal.data.some((x) => x.id === fixtures.otherInvisible));
          const other = await run({ masterId: ids.other }, ownActor);
          assert.deepEqual(
            other.data.map((x) => x.id),
            [fixtures.otherMaster],
          );
          assert.equal((await run({ masterId: ids.cashier })).total, 0);
          const all = await run();
          for (const key of ['foreign', 'otherPoint', 'deleted'])
            assert.ok(!all.data.some((x) => x.id === fixtures[key]));
        },
      );
      await t.test(
        'combined dates/amount/discount/flags/search include exact local midnight and cents boundaries',
        async () => {
          const result = await run(combo);
          assert.equal(result.total, 2);
          assert.deepEqual(new Set(result.data.map((x) => x.id)), new Set([fixtures.start, fixtures.end]));
          assert.equal((await run({ amountFrom: '0', amountTo: '0' })).data[0].id, fixtures.zero);
          assert.ok((await run({ amountTo: '100.49' })).data.some((x) => x.id === fixtures.low));
          assert.ok((await run({ amountFrom: '100.51' })).data.some((x) => x.id === fixtures.high));
          assert.equal((await run({ hasDiscount: 'false' })).total, (await run()).total);
        },
      );
      await t.test('offset and keyset both apply full filters and report the first-page total', async () => {
        const first = await run({ ...combo, cursor: '', limit: 1 });
        assert.equal(first.total, 2);
        assert.equal(first.data.length, 1);
        assert.ok(first.nextCursor);
        const second = await run({ ...combo, cursor: first.nextCursor, limit: 1 });
        assert.equal(second.total, null);
        assert.equal(second.data.length, 1);
        assert.ok(second.nextCursor);
        const end = await run({ ...combo, cursor: second.nextCursor, limit: 1 });
        assert.deepEqual(end.data, []);
        assert.equal(end.nextCursor, null);
        assert.notEqual(first.data[0].id, second.data[0].id);
        const offset = await run({ ...combo, page: 2, limit: 1 });
        assert.equal(offset.total, 2);
        assert.equal(offset.data[0].id, second.data[0].id);
      });
      await t.test('invalid API input is 400 rather than PostgreSQL failure', async () => {
        for (const query of [
          { amountFrom: '-1' },
          { amountTo: 'NaN' },
          { amountFrom: '2', amountTo: '1' },
          { dateTo: '2026-02-30' },
          { dateFrom: '0000-01-01' },
          { dateFrom: '2026-10-14', dateTo: '2026-10-13' },
          { hasDiscount: 'yes' },
        ])
          await assert.rejects(run(query), (error) => error.getStatus?.() === 400);
      });
    } finally {
      await admin.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[ids.tenant, ids.foreignTenant]]);
      await app.end();
      await admin.end();
    }
  },
);
