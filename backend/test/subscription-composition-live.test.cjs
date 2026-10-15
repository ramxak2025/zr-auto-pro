// Explicit isolated PostgreSQL16 fixture only; never DATABASE_URL or production fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { PlansService } = require('../dist/plans/plans.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
Logger.overrideLogger(false);
const live = process.env.OCT16_PRICING_LIVE_DB;
const localUrl = 'postgresql://oct16_fixture@127.0.0.1:60984/autexa_oct16_pricing_test';
const ciUrl = 'postgresql://oct8_fixture:oct8_fixture_only@127.0.0.1:55438/autexa_oct8_test';
function approvedFixture(url) {
  if (url === localUrl)
    return { database: 'autexa_oct16_pricing_test', role: 'oct16_fixture', appPassword: 'oct16_fixture_app_only' };
  if (url === ciUrl)
    return { database: 'autexa_oct8_test', role: 'oct8_fixture', appPassword: 'oct8_app_fixture_only' };
  throw new Error('Only the explicitly approved local or CI disposable fixture may be mutated');
}
async function fixture(work) {
  const expected = approvedFixture(live);
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = expected.appPassword;
  const admin = new Pool({ connectionString: live, max: 5, statement_timeout: 8000, connectionTimeoutMillis: 3000 });
  const app = new Pool({
    connectionString: appUrl.toString(),
    statement_timeout: 8000,
    connectionTimeoutMillis: 3000,
    max: 5,
  });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const tenant = randomUUID(),
    foreign = randomUUID(),
    manager = randomUUID(),
    otherManager = randomUUID();
  const plan = '16100000-0000-4000-a000-000000000003';
  const service = new TenantsService(pool, undefined, { log: async () => {} }, undefined);
  const user = async (options = {}) => {
    const id = randomUUID();
    await q(
      `INSERT INTO users(id,tenant_id,phone,password,full_name,role,is_active,dismissed_at,purged_at,hidden_from_schedule)
      VALUES($1::uuid,$2,$1::uuid::text,'unused','Fixture',$3,$4,$5,$6,$7)`,
      [
        id,
        options.tenant ?? tenant,
        options.role ?? 'master',
        options.active ?? true,
        options.dismissed ? new Date() : null,
        options.purged ? new Date() : null,
        options.hidden ?? false,
      ],
    );
    return id;
  };
  let verified = false;
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
    assert.ok(appIdentity.version >= 160000 && appIdentity.version < 170000);
    assert.equal(appIdentity.rolsuper, false);
    assert.equal(appIdentity.rolbypassrls, false);
    verified = true;
    for (const id of [manager, otherManager])
      await q(
        `INSERT INTO users(id,phone,password,full_name,role,owner_share_percent) VALUES($1::uuid,$1::uuid::text,'unused','Fixture manager','manager',60)`,
        [id],
      );
    await q(
      `INSERT INTO tenants(id,name,plan_id,manager_id,subscription_end,monthly_price,max_users) VALUES($1,'Pricing fixture',$2,$3,'2030-01-31T12:00:00Z',15000,50),($4,'Foreign fixture',$2,$5,'2030-01-31T12:00:00Z',15000,50)`,
      [tenant, plan, manager, foreign, otherManager],
    );
    const owner = await user({ role: 'director' });
    await work({ q, tenant, foreign, manager, otherManager, owner, user, service, pool });
  } finally {
    if (verified) {
      await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
      await q('DELETE FROM users WHERE id=ANY($1::uuid[])', [[manager, otherManager]]);
    }
    await pool.end();
  }
}
const status = (n, code) => (e) => e.getStatus?.() === n && (!code || e.getResponse().code === code);

/** Pause only after a real application statement completes; never rewrite SQL. */
async function afterStatement(pool, matches, paused, work) {
  const connect = pool.connect.bind(pool);
  let reached = false;
  pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client),
      release = client.release.bind(client);
    client.query = async (...args) => {
      const result = await query(...args);
      if (!reached && matches(args[0])) {
        reached = true;
        await paused(result);
      }
      return result;
    };
    client.release = (...args) => {
      client.query = query;
      release(...args);
    };
    return client;
  };
  try {
    return await work();
  } finally {
    pool.connect = connect;
    assert.equal(reached, true, 'the real query must reach the interleaving barrier');
  }
}
const quoteStatement = (sql) => /SELECT t\.plan_id, t\.subscription_end, p\.\*/.test(sql);
const tenantLockStatement = (sql) => /p\.name AS plan_name/.test(sql) && /FOR UPDATE OF t/.test(sql);

test('subscription fixture guard accepts only exact assigned local/CI identities', () => {
  assert.equal(approvedFixture(localUrl).database, 'autexa_oct16_pricing_test');
  assert.equal(approvedFixture(ciUrl).appPassword, 'oct8_app_fixture_only');
  for (const url of [
    undefined,
    '',
    localUrl.replace('127.0.0.1', 'external.example'),
    ciUrl.replace('55438', '5432'),
    ciUrl.replace('autexa_oct8_test', 'production'),
    ciUrl.replace('oct8_fixture_only', 'other'),
    ciUrl.replace('oct8_fixture:', 'postgres:'),
    ciUrl + '?host=external.example',
  ]) {
    assert.throws(() => approvedFixture(url), /explicitly approved/);
  }
});

test(
  'PG16: plan maxUsers update changes coded included employees while legacy/custom pricing stays unchanged',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, user, service, pool }) => {
      const plans = new PlansService(pool);
      const legacy = await plans.create({ name: 'Custom fixture', monthlyPrice: 777, maxUsers: 2 });
      const pro = '16100000-0000-4000-a000-000000000002';
      const [before] = await q('SELECT max_users,included_employees FROM plans WHERE id=$1', [pro]);
      try {
        const changedLegacy = await plans.update(legacy.id, { maxUsers: 6 });
        assert.equal(changedLegacy.maxUsers, 6);
        assert.equal(changedLegacy.pricing, null);
        assert.equal(
          (await q('SELECT included_employees FROM plans WHERE id=$1', [legacy.id]))[0].included_employees,
          null,
        );
        for (let i = 0; i < 5; i++) await user();
        await q('UPDATE tenants SET plan_id=$2 WHERE id=$1', [tenant, pro]);
        const [tenantBefore] = await q('SELECT * FROM tenants WHERE id=$1', [tenant]);
        assert.equal((await service.getSubscriptionQuote(tenant)).quote.employeesMonthlyAmount, 500);
        const changed = await plans.update(pro, { maxUsers: 6 });
        const quote = await service.getSubscriptionQuote(tenant);
        assert.equal(changed.maxUsers, 6);
        assert.equal(quote.pricing.includedEmployees, 6);
        assert.equal(quote.quote.employeesMonthlyAmount, 0);
        assert.equal(quote.quote.total, 4990);
        assert.deepEqual((await q('SELECT * FROM tenants WHERE id=$1', [tenant]))[0], tenantBefore);
      } finally {
        await q('UPDATE plans SET max_users=$2,included_employees=$3 WHERE id=$1', [
          pro,
          before.max_users,
          before.included_employees,
        ]);
        await q('DELETE FROM plans WHERE id=$1', [legacy.id]);
      }
    }),
);

test(
  'PG16: an exact until renewal replays after its date; new expired requests and foreign managers still fail',
  { skip: !live },
  async (t) =>
    fixture(async ({ q, tenant, manager, otherManager, service }) => {
      let now = Date.parse('2030-02-01T00:00:00Z');
      t.mock.method(Date, 'now', () => now);
      const request = { until: '2030-03-01T00:00:00Z', type: 'paid', amount: 321.45, requestId: randomUUID() };
      const actor = { userId: manager, name: 'Fixture manager' };
      const ctx = { scope: { managerId: manager }, credit: { managerId: manager } };
      const first = await service.extend(tenant, request, actor, ctx);
      const before = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
      now = Date.parse('2030-03-02T00:00:00Z');
      const replay = await service.extend(tenant, request, actor, ctx);
      assert.equal(new Date(replay.subscriptionEnd).toISOString(), new Date(first.subscriptionEnd).toISOString());
      assert.deepEqual(await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]), before);
      await assert.rejects(
        () => service.extend(tenant, { ...request, amount: 322 }, actor, ctx),
        status(409, 'REQUEST_ID_REUSED'),
      );
      await assert.rejects(
        () => service.extend(tenant, { ...request, requestId: randomUUID() }, actor, ctx),
        status(400),
      );
      await assert.rejects(
        () => service.extend(tenant, { ...request, until: 'invalid-date' }, actor, ctx),
        status(400),
      );
      await assert.rejects(
        () => service.extend(tenant, request, actor, { ...ctx, scope: { managerId: otherManager } }),
        status(404),
      );
      assert.deepEqual(await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]), before);
    }),
);

test(
  'PG16: a plan/usage combination that never existed during renewal cannot accept the old preview',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, owner, user, service, pool }) => {
      const people = [];
      for (let i = 0; i < 50; i++) people.push(await user());
      const preview = await service.getSubscriptionQuote(tenant);
      assert.equal(preview.usage.employees, 51);
      assert.equal(preview.quote.total, 15500);
      await q('UPDATE users SET is_active=false WHERE id=$1', [people[49]]);
      const [before] = await q('SELECT subscription_end FROM tenants WHERE id=$1', [tenant]);
      try {
        await afterStatement(
          pool,
          quoteStatement,
          async () => {
            await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [preview.planId, 16000]);
            await q('UPDATE users SET is_active=true WHERE id=$1', [people[49]]);
          },
          async () => {
            await assert.rejects(
              () =>
                service.extend(
                  tenant,
                  {
                    type: 'paid',
                    amount: 15500,
                    period: 'monthly',
                    quoteToken: preview.quoteToken,
                    requestId: randomUUID(),
                  },
                  { userId: owner, name: 'Fixture' },
                ),
              status(409, 'QUOTE_CHANGED'),
            );
          },
        );
        assert.equal((await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant])).length, 0);
        assert.deepEqual((await q('SELECT subscription_end FROM tenants WHERE id=$1', [tenant]))[0], before);
      } finally {
        await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [preview.planId, preview.pricing.monthlyPrice]);
      }
    }),
);

test(
  'PG16: a coherent authoritative quote remains valid when unrelated writes commit after its statement snapshot',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, owner, user, service, pool }) => {
      const inactive = await user({ active: false });
      const preview = await service.getSubscriptionQuote(tenant);
      try {
        await afterStatement(
          pool,
          quoteStatement,
          async () => {
            await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [
              preview.planId,
              preview.pricing.monthlyPrice + 123,
            ]);
            await q('UPDATE users SET is_active=true WHERE id=$1', [inactive]);
          },
          () =>
            service.extend(
              tenant,
              {
                type: 'paid',
                amount: 1234.56,
                period: 'monthly',
                quoteToken: preview.quoteToken,
                requestId: randomUUID(),
              },
              { userId: owner, name: 'Fixture' },
            ),
        );
        const [ledger] = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
        assert.deepEqual(ledger.composition_snapshot, preview);
        assert.equal(Number(ledger.amount), 1234.56);
      } finally {
        await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [preview.planId, preview.pricing.monthlyPrice]);
      }
    }),
);

test(
  'PG16: composition ledger takes its plan name from the quote snapshot; legacy rows keep their original snapshot',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, owner, service, pool }) => {
      const [{ plan_id: plan }] = await q('SELECT plan_id FROM tenants WHERE id=$1', [tenant]);
      const [{ name }] = await q('SELECT name FROM plans WHERE id=$1', [plan]);
      try {
        await q('UPDATE plans SET name=$2 WHERE id=$1', [plan, 'MAX renamed fixture']);
        const preview = await service.getSubscriptionQuote(tenant);
        await q('UPDATE plans SET name=$2 WHERE id=$1', [plan, name]);
        await afterStatement(
          pool,
          tenantLockStatement,
          () => q('UPDATE plans SET name=$2 WHERE id=$1', [plan, preview.pricing.name]),
          () =>
            service.extend(
              tenant,
              { period: 'monthly', quoteToken: preview.quoteToken },
              { userId: owner, name: 'Fixture' },
            ),
        );
        const [ledger] = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
        assert.equal(ledger.plan_name, preview.pricing.name);
        assert.equal(ledger.plan_id, preview.planId);
        assert.equal(ledger.plan_name, ledger.composition_snapshot.pricing.name);
        await q('UPDATE plans SET name=$2 WHERE id=$1', [plan, name]);
        await afterStatement(
          pool,
          tenantLockStatement,
          () => q('UPDATE plans SET name=$2 WHERE id=$1', [plan, 'Later legacy name']),
          () => service.extend(tenant, { days: 1 }, { userId: owner, name: 'Fixture' }),
        );
        const [legacy] = await q(
          'SELECT * FROM subscription_payments WHERE tenant_id=$1 AND composition_snapshot IS NULL',
          [tenant],
        );
        assert.equal(legacy.plan_name, name);
        assert.deepEqual((await q('SELECT * FROM subscription_payments WHERE id=$1', [ledger.id]))[0], ledger);
      } finally {
        await q('UPDATE plans SET name=$2 WHERE id=$1', [plan, name]);
      }
    }),
);

test(
  'PG16: active unique employees include owner and schedule-hidden; active branches and legacy zero branch quote; RLS and manager isolation',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, foreign, manager, owner, user, service }) => {
      const hidden = await user({ hidden: true });
      await user({ active: false });
      await user({ dismissed: true });
      await user({ purged: true });
      await user({ tenant: foreign });
      const before = await q('SELECT * FROM tenant_points WHERE tenant_id=$1', [tenant]);
      assert.equal(before.length, 0);
      const initial = await service.getSubscriptionQuote(tenant, 'monthly', { managerId: manager });
      assert.deepEqual(initial.usage, { employees: 2, activePoints: 0, billablePoints: 1 });
      assert.equal(
        (await q('SELECT * FROM tenant_points WHERE tenant_id=$1', [tenant])).length,
        0,
        'GET must not create a branch',
      );
      const points = [randomUUID(), randomUUID(), randomUUID()];
      for (let i = 0; i < 3; i++)
        await q('INSERT INTO tenant_points(id,tenant_id,name,is_active) VALUES($1,$2,$3,$4)', [
          points[i],
          tenant,
          'Fixture ' + i,
          i < 2,
        ]);
      for (const person of [owner, hidden])
        for (const point of points.slice(0, 2))
          await q('INSERT INTO user_points(user_id,point_id,tenant_id) VALUES($1,$2,$3)', [person, point, tenant]);
      const current = await service.getSubscriptionQuote(tenant, 'yearly', { managerId: manager });
      assert.deepEqual(current.usage, { employees: 2, activePoints: 2, billablePoints: 2 });
      assert.equal(current.quote.total, 200000);
      const sub = await runWithTenant(tenant, () => service.getSubscription(tenant));
      assert.equal(sub.currentUsers, 5, 'legacy all-users count preserved');
      assert.deepEqual(sub.usage, current.usage);
      await assert.rejects(() => service.getSubscriptionQuote(foreign, 'monthly', { managerId: manager }), status(404));
      assert.deepEqual(
        (await runWithTenant(tenant, () => service.getSubscriptionQuote(tenant, 'yearly'))).usage,
        current.usage,
      );
      await assert.rejects(
        () => service.getSubscriptionQuote(tenant, 'monthly', {}, '16100000-0000-4000-a000-000000000001'),
        status(400, 'UNPRICED_POINTS'),
      );
    }),
);

test(
  'PG16: annual snapshot, actual amount share, exact concurrent retry, changed request and stale preview do not write',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, foreign, manager, owner, user, service }) => {
      const preview = await service.getSubscriptionQuote(tenant, 'yearly', { managerId: manager });
      const request = {
        type: 'paid',
        amount: 1234.56,
        period: 'yearly',
        quoteToken: preview.quoteToken,
        requestId: randomUUID(),
      };
      const actor = { userId: manager, name: 'Fixture' };
      const ctx = { scope: { managerId: manager }, credit: { managerId: manager } };
      const [a, b] = await Promise.all([
        service.extend(tenant, request, actor, ctx),
        service.extend(tenant, request, actor, ctx),
      ]);
      assert.equal(new Date(a.subscriptionEnd).toISOString(), '2031-01-31T12:00:00.000Z');
      assert.equal(new Date(b.subscriptionEnd).toISOString(), new Date(a.subscriptionEnd).toISOString());
      const rows = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].amount), 1234.56);
      assert.equal(Number(rows[0].owner_share_amount), 740.74);
      assert.deepEqual(rows[0].composition_snapshot, preview);
      assert.equal(rows[0].composition_snapshot.quote.total, 150000);
      await assert.rejects(
        () => service.extend(tenant, { ...request, amount: 1235 }, actor, ctx),
        status(409, 'REQUEST_ID_REUSED'),
      );
      await assert.rejects(() => service.extend(foreign, request, actor, ctx), status(404));
      const next = await service.getSubscriptionQuote(tenant, 'monthly', ctx.scope);
      // Server plan edits must affect quotes and invalidate old previews.
      const originalPrice = next.pricing.monthlyPrice;
      try {
        await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [next.planId, originalPrice + 123]);
        assert.equal(
          (await service.getSubscriptionQuote(tenant, 'monthly', ctx.scope)).quote.total,
          originalPrice + 123,
        );
        await assert.rejects(
          () =>
            service.extend(
              tenant,
              { ...request, period: 'monthly', quoteToken: next.quoteToken, requestId: randomUUID() },
              actor,
              ctx,
            ),
          status(409, 'QUOTE_CHANGED'),
        );
      } finally {
        await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [next.planId, originalPrice]);
      }

      await user();
      await assert.rejects(
        () =>
          service.extend(
            tenant,
            { ...request, period: 'monthly', quoteToken: next.quoteToken, requestId: randomUUID() },
            actor,
            ctx,
          ),
        status(409, 'QUOTE_CHANGED'),
      );
      assert.equal((await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant])).length, 1);
      assert.equal(
        new Date(
          (await q('SELECT subscription_end FROM tenants WHERE id=$1', [tenant]))[0].subscription_end,
        ).toISOString(),
        '2031-01-31T12:00:00.000Z',
      );
      const branchPreview = await service.getSubscriptionQuote(
        tenant,
        'monthly',
        {},
        '16100000-0000-4000-a000-000000000001',
      );
      await q("UPDATE tenants SET plan_id='16100000-0000-4000-a000-000000000001' WHERE id=$1", [tenant]);
      for (let i = 0; i < 2; i++)
        await q('INSERT INTO tenant_points(tenant_id,name) VALUES($1,$2)', [tenant, 'Fixture ' + i]);
      await assert.rejects(
        () =>
          service.extend(
            tenant,
            { ...request, period: 'monthly', quoteToken: branchPreview.quoteToken, requestId: randomUUID() },
            actor,
            ctx,
          ),
        status(409, 'QUOTE_CHANGED'),
      );
    }),
);

test('PG16: ledger failure rolls back end date; legacy days still writes no composition', { skip: !live }, async () =>
  fixture(async ({ q, tenant, owner, service }) => {
    const preview = await service.getSubscriptionQuote(tenant);
    const before = (await q('SELECT subscription_end FROM tenants WHERE id=$1', [tenant]))[0].subscription_end;
    await assert.rejects(
      () =>
        service.extend(
          tenant,
          { type: 'paid', amount: 500, period: 'monthly', quoteToken: preview.quoteToken },
          { userId: randomUUID(), name: 'missing FK actor' },
        ),
      status(500),
    );
    assert.deepEqual(
      (await q('SELECT subscription_end FROM tenants WHERE id=$1', [tenant]))[0].subscription_end,
      before,
    );
    assert.equal((await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant])).length, 0);
    await service.extend(tenant, { days: 7 }, { userId: owner, name: 'Legacy' });
    const [row] = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
    assert.equal(row.is_free, true);
    assert.equal(Number(row.amount), 0);
    assert.equal(row.composition_snapshot, null);
  }),
);

test(
  'PG16: additive migration replay preserves legacy tenant/ledger/custom and edited canonical plan',
  { skip: !live },
  async () =>
    fixture(async ({ q, tenant, owner, service }) => {
      const legacy = '738bc6b3-a71b-4afb-9e88-0034519dc6c4',
        custom = randomUUID();
      const existing = await q('SELECT id FROM plans WHERE id=$1', [legacy]);
      if (!existing.length)
        await q(
          `INSERT INTO plans(id,name,monthly_price,max_users,features) VALUES($1,'Гараж',2000,2,'["reports_view"]')`,
          [legacy],
        );
      await q(`INSERT INTO plans(id,name,monthly_price,max_users,is_active) VALUES($1,'Custom fixture',777,7,true)`, [
        custom,
      ]);
      const canonical = '16100000-0000-4000-a000-000000000002';
      const [beforePlan] = await q('SELECT * FROM plans WHERE id=$1', [canonical]);
      try {
        await q('UPDATE tenants SET plan_id=$2,monthly_price=2111,max_users=7 WHERE id=$1', [tenant, legacy]);
        await service.extend(tenant, { days: 1 }, { userId: owner, name: 'Legacy' });
        const [before] = await q('SELECT * FROM tenants WHERE id=$1', [tenant]);
        const ledger = await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]);
        const [old] = await q('SELECT * FROM plans WHERE id=$1', [legacy]);
        await q('UPDATE plans SET monthly_price=5111 WHERE id=$1', [canonical]);
        const migration = readFileSync(
          join(__dirname, '../migrations/192_subscription_composition_pricing.sql'),
          'utf8',
        );
        await q(migration);
        await q(migration);
        assert.deepEqual((await q('SELECT * FROM tenants WHERE id=$1', [tenant]))[0], before);
        assert.deepEqual(await q('SELECT * FROM subscription_payments WHERE tenant_id=$1', [tenant]), ledger);
        assert.deepEqual((await q('SELECT * FROM plans WHERE id=$1', [legacy]))[0], { ...old, is_active: false });
        assert.equal(
          Number((await q('SELECT monthly_price FROM plans WHERE id=$1', [canonical]))[0].monthly_price),
          5111,
        );
        assert.equal((await q('SELECT is_active FROM plans WHERE id=$1', [custom]))[0].is_active, true);
        const max = (await q("SELECT features,voice_minutes FROM plans WHERE code='max'"))[0];
        assert.deepEqual(new Set(max.features), new Set(require('../dist/plans/feature-catalog').ALL_FEATURE_KEYS));
        assert.equal(max.voice_minutes, 1000);
      } finally {
        await q('UPDATE plans SET monthly_price=$2 WHERE id=$1', [canonical, beforePlan.monthly_price]);
        await q('UPDATE tenants SET plan_id=$2 WHERE id=$1', [tenant, '16100000-0000-4000-a000-000000000003']);
        await q('DELETE FROM plans WHERE id=$1', [custom]);
      }
    }),
);
