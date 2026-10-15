// Explicit isolated PostgreSQL16 fixture only; never DATABASE_URL or production fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
Logger.overrideLogger(false);
const live = process.env.OCT16_PRICING_LIVE_DB;
const expected = 'postgresql://oct16_fixture@127.0.0.1:60984/autexa_oct16_pricing_test';
async function fixture(work) {
  assert.equal(live, expected, 'Only the explicitly approved disposable fixture may be mutated');
  const admin = new Pool({ connectionString: live, max: 5, statement_timeout: 8000 });
  const app = new Pool({
    host: '127.0.0.1',
    port: 60984,
    database: 'autexa_oct16_pricing_test',
    user: 'autexa_app',
    password: 'oct16_fixture_app_only',
    max: 5,
  });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
  const [identity] = await q(
    `SELECT current_database() db,current_user usr,current_setting('server_version_num')::int version`,
  );
  assert.equal(identity.db, 'autexa_oct16_pricing_test');
  assert.equal(identity.usr, 'oct16_fixture');
  assert.ok(identity.version >= 160000 && identity.version < 170000);
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
  try {
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
    await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[tenant, foreign]]);
    await q('DELETE FROM users WHERE id=ANY($1::uuid[])', [[manager, otherManager]]);
    await pool.end();
  }
}
const status = (n, code) => (e) => e.getStatus?.() === n && (!code || e.getResponse().code === code);

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
