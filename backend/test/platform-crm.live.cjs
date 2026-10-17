// Deliberately outside *.test.cjs: explicit isolated integration command, NO SKIP.
// OCT18_PLATFORM_LIVE_DB=postgresql://oct16_fixture@127.0.0.1:60984/autexa_oct16_pricing_test node --test backend/test/platform-crm.live.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const Module = require('node:module');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { Logger } = require('@nestjs/common');
const { PlatformCrmService } = require('../dist/platform-managers/platform-crm.service');
const { PlatformReminderService } = require('../dist/platform-managers/platform-reminder.service');
const { ManagerCabinetService } = require('../dist/platform-managers/manager-cabinet.service');
const { ManagerFinanceService } = require('../dist/platform-managers/manager-finance.service');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { PushService } = require('../dist/push/push.service');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { cabinetActor } = require('../dist/platform-managers/manager-scope');
const { ttlCache } = require('../dist/common/ttl-cache');
const { authCacheKey } = require('../dist/common/auth-cache');
Logger.overrideLogger(false);
// Even a mistaken test stub must never reach Expo or any external endpoint.
require('node:https').request = () => {
  throw new Error('NETWORK_FORBIDDEN_FIXTURE');
};
const url = 'postgresql://oct16_fixture@127.0.0.1:60984/autexa_oct16_pricing_test';
assert.equal(
  process.env.OCT18_PLATFORM_LIVE_DB,
  url,
  'Explicit approved disposable DB is required; no environment fallback',
);
const status = (n) => (e) => e.getStatus?.() === n;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function fixture(work) {
  const admin = new Pool({ connectionString: url, max: 10, statement_timeout: 8000, connectionTimeoutMillis: 3000 });
  const app = new Pool({
    host: '127.0.0.1',
    port: 60984,
    user: 'autexa_app',
    password: 'oct16_fixture_app_only',
    database: 'autexa_oct16_pricing_test',
    max: 5,
    statement_timeout: 8000,
  });
  const pool = new TenantAwarePool(admin, app);
  const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const a = randomUUID(),
    b = randomUUID(),
    sa = randomUUID();
  const t1 = randomUUID(),
    t2 = randomUUID(),
    t3 = randomUUID(),
    owner = randomUUID();
  const audits = [];
  const audit = { resolveActorName: async () => 'Fixture operator', log: async (...args) => audits.push(args) };
  const tenants = new TenantsService(pool, undefined, audit, undefined);
  const crm = new PlatformCrmService(pool);
  const finance = new ManagerFinanceService(pool, tenants);
  const cabinet = new ManagerCabinetService(pool, tenants, audit, finance, undefined);
  const actor = (id = a, role = 'manager') => cabinetActor({ userID: id, role, tenantID: '', permissions: {} });
  let verified = false;
  try {
    const identity = `SELECT current_database() db,current_user usr,current_setting('server_version_num')::int version,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    const [adminId] = await q(identity),
      [appId] = (await app.query(identity)).rows;
    assert.equal(adminId.db, 'autexa_oct16_pricing_test');
    assert.equal(adminId.usr, 'oct16_fixture');
    assert.ok(adminId.version >= 160000 && adminId.version < 170000);
    assert.equal(adminId.rolsuper, true);
    assert.equal(appId.db, adminId.db);
    assert.equal(appId.usr, 'autexa_app');
    assert.equal(appId.rolsuper, false);
    assert.equal(appId.rolbypassrls, false);
    verified = true;
    for (const [id, role] of [
      [a, 'manager'],
      [b, 'manager'],
      [sa, 'superadmin'],
    ]) {
      await q(
        `INSERT INTO users(id,phone,password,full_name,role,is_active) VALUES($1::uuid,$1::uuid::text,'unused',$2,$3,true)`,
        [id, `Operator ${id}`, role],
      );
    }
    for (const [id, manager] of [
      [t1, a],
      [t2, b],
      [t3, a],
    ]) {
      await q(
        `INSERT INTO tenants(id,name,manager_id,subscription_end,timezone) VALUES($1,'CRM fixture',$2,now()+interval '6 days','Europe/Moscow')`,
        [id, manager],
      );
    }
    await q(
      `INSERT INTO users(id,tenant_id,phone,password,full_name,role,is_active) VALUES($1::uuid,$2,$1::uuid::text,'original','Fixture owner','director',true)`,
      [owner, t1],
    );
    await work({
      q,
      admin,
      app,
      pool,
      a,
      b,
      sa,
      t1,
      t2,
      t3,
      owner,
      actor,
      crm,
      finance,
      cabinet,
      tenants,
      audit,
      audits,
    });
  } finally {
    if (verified) {
      await q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [[t1, t2, t3]]);
      await q('DELETE FROM users WHERE id=ANY($1::uuid[])', [[a, b, sa, owner]]);
    }
    await pool.end();
  }
}

test('notes: concurrent idempotency, conflict, pagination, transfer and immutable author snapshot', () =>
  fixture(async (f) => {
    const requestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => f.crm.addNote(f.actor(), f.t1, { text: '  confidential crm  ', requestId })),
    );
    assert.equal(new Set(results.map((x) => x.id)).size, 1);
    assert.equal(results[0].text, 'confidential crm');
    await assert.rejects(f.crm.addNote(f.actor(), f.t1, { text: 'different', requestId }), status(409));
    await assert.rejects(f.crm.addNote(f.actor(), f.t3, { text: 'confidential crm', requestId }), status(409));
    await assert.rejects(f.crm.addNote(f.actor(), f.t2, { text: 'no access', requestId: randomUUID() }), status(404));
    await assert.rejects(f.crm.notes(f.actor(), f.t2), status(404));
    await f.crm.addNote(f.actor(), f.t1, { text: 'second', requestId: randomUUID() });
    await f.q(`UPDATE users SET full_name='Renamed operator' WHERE id=$1`, [f.a]);
    const page = await f.crm.notes(f.actor(), f.t1, '1', '1');
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].authorName, `Operator ${f.a}`);
    assert.equal((await f.crm.notes(f.actor(), f.t1, '30', '999')).total, 2);
    assert.throws(() => f.crm.notes(f.actor(), f.t1, '-1'), status(400));
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
    await assert.rejects(f.crm.addNote(f.actor(), f.t1, { text: 'confidential crm', requestId }), status(404));
    await assert.rejects(f.crm.notes(f.actor(), f.t1), status(404));
    assert.equal((await f.crm.notes(f.actor(f.b), f.t1)).total, 2);
    assert.equal((await f.crm.notes(f.actor(f.sa, 'superadmin'), f.t1)).total, 2);
  }));

test('all CRM tables FORCE RLS deny reads/writes even under matching tenant and blanket app grants; public responses do not leak', () =>
  fixture(async (f) => {
    const secret = `private-${randomUUID()}`;
    await f.crm.addNote(f.actor(), f.t1, { text: secret, requestId: randomUUID() });
    await f.crm.setFollowUp(f.actor(), f.t1, { nextContactAt: '2026-10-01T00:00:00Z' });
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: true, daysBefore: [7], pushEnabled: false });
    await f.q('INSERT INTO platform_reminder_claims(user_id,event_key,tenant_id) VALUES($1,$2,$3)', [
      f.a,
      'fixture-key',
      f.t1,
    ]);
    for (const table of [
      'platform_tenant_notes',
      'platform_tenant_followups',
      'platform_reminder_settings',
      'platform_reminder_claims',
    ]) {
      const [flags] = await f.q('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [
        table,
      ]);
      assert.deepEqual(flags, { relrowsecurity: true, relforcerowsecurity: true });
      assert.equal((await runWithTenant(f.t1, () => f.pool.query(`SELECT * FROM ${table}`))).rows.length, 0);
      assert.equal((await f.app.query(`SELECT * FROM ${table}`)).rows.length, 0, 'missing tenant context denied too');
    }
    await assert.rejects(
      runWithTenant(f.t1, () =>
        f.pool.query(
          `INSERT INTO platform_tenant_notes(tenant_id,author_user_id,request_id,text) VALUES($1,$2,$3,'leak')`,
          [f.t1, f.owner, randomUUID()],
        ),
      ),
      (e) => e.code === '42501',
    );
    assert.equal(
      (
        await runWithTenant(f.t1, () =>
          f.pool.query(`UPDATE platform_tenant_notes SET text='overwrite' WHERE tenant_id=$1`, [f.t1]),
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await runWithTenant(f.t1, () => f.pool.query(`DELETE FROM platform_tenant_notes WHERE tenant_id=$1`, [f.t1])))
        .rowCount,
      0,
    );
    const publicPayloads = await runWithTenant(f.t1, async () => [
      await f.tenants.getById(f.t1),
      await f.tenants.getMyCompany(f.t1),
      await f.tenants.getSubscription(f.t1),
    ]);
    assert.equal(JSON.stringify(publicPayloads).includes(secret), false);
    for (const payload of publicPayloads)
      for (const key of ['notes', 'nextContactAt', 'reminderSettings']) assert.equal(key in payload, false);
  }));

test('reminders: personal defaults, current assignment, follow-up, clearing, extension and full total/200 cap', () =>
  fixture(async (f) => {
    const defaults = { expiryEnabled: true, daysBefore: [7, 3, 1, 0], pushEnabled: false };
    assert.deepEqual(await f.crm.reminderSettings(f.actor()), defaults);
    assert.equal((await f.crm.reminders(f.actor())).items.length, 2);
    await f.crm.setFollowUp(f.actor(), f.t1, { nextContactAt: new Date(Date.now() - 60_000).toISOString() });
    await assert.rejects(f.crm.setFollowUp(f.actor(), f.t2, { nextContactAt: null }), status(404));
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: false, daysBefore: [], pushEnabled: false });
    assert.deepEqual(await f.crm.reminderSettings(f.actor(f.b)), defaults);
    let feed = await f.crm.reminders(f.actor());
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].kind, 'follow_up');
    await f.crm.setFollowUp(f.actor(), f.t1, { nextContactAt: null });
    assert.equal((await f.crm.reminders(f.actor())).total, 0);
    await f.crm.updateReminderSettings(f.actor(), defaults);
    const oldKey = (await f.crm.reminders(f.actor())).items.find((x) => x.tenantId === f.t1).id;
    await f.q(`UPDATE tenants SET subscription_end=now()+interval '2 days' WHERE id=$1`, [f.t1]);
    assert.notEqual((await f.crm.reminders(f.actor())).items.find((x) => x.tenantId === f.t1).id, oldKey);
    await f.q(`UPDATE tenants SET subscription_end=now()+interval '60 days' WHERE id=$1`, [f.t1]);
    assert.equal(
      (await f.crm.reminders(f.actor())).items.some((x) => x.tenantId === f.t1),
      false,
    );
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t3, f.b]);
    assert.equal((await f.crm.reminders(f.actor())).total, 0);
    const added = [];
    try {
      for (let i = 0; i < 205; i++) {
        const id = randomUUID();
        added.push(id);
        await f.q(
          `INSERT INTO tenants(id,name,manager_id,subscription_end) VALUES($1,'Bulk reminder',$2,now()-($3::int*interval '1 day'))`,
          [id, f.a, i],
        );
      }
      feed = await f.crm.reminders(f.actor());
      assert.equal(feed.total, 205);
      assert.equal(feed.items.length, 200);
      for (let i = 1; i < feed.items.length; i++)
        assert.ok(feed.items[i].daysRemaining >= feed.items[i - 1].daysRemaining);
    } finally {
      await f.q('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [added]);
    }
  }));

test('analytics uses full historical payment snapshots, six zero-filled months, never current assignment or ledger cap', () =>
  fixture(async (f) => {
    await f.q(
      `INSERT INTO subscription_payments(tenant_id,manager_id,amount,owner_share_amount,is_free,created_at)
    SELECT $1::uuid,$2::uuid,0.10,0.06,false,now() FROM generate_series(1,2005)`,
      [f.t1, f.a],
    );
    await f.q(
      `INSERT INTO subscription_payments(tenant_id,manager_id,amount,owner_share_amount,is_free,created_at)
    VALUES($1,$2,100,60,false,date_trunc('month',now())-interval '2 months'),($1,$3,700,420,false,now()),($1,$2,999,0,true,now())`,
      [f.t1, f.a, f.b],
    );
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
    const result = await f.finance.analytics(f.a);
    assert.equal(result.monthly.length, 6);
    assert.deepEqual(result.monthly.at(-1), {
      month: new Date().toISOString().slice(0, 7),
      paidRevenue: 200.5,
      ownerShare: 120.3,
      myShare: 80.2,
    });
    assert.equal(result.monthly[3].paidRevenue, 100);
    assert.deepEqual(result.monthly[0], { month: result.monthly[0].month, paidRevenue: 0, ownerShare: 0, myShare: 0 });
    assert.equal((await f.finance.analytics(f.b)).monthly.at(-1).paidRevenue, 700);
  }));

function legacyCabinetClass() {
  const source = execFileSync(
    'git',
    ['show', '1ed079f267a1b55af455bcf46f85fe03c7ce2db9:backend/src/platform-managers/manager-cabinet.service.ts'],
    { cwd: join(__dirname, '../..'), encoding: 'utf8' },
  );
  const ts = require('typescript');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
    },
  }).outputText;
  const filename = join(__dirname, '../dist/platform-managers/legacy-reset-fixture.js');
  const module = new Module(filename, require.main);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(join(__dirname, '../dist/platform-managers'));
  module._compile(compiled, filename);
  return module.exports.ManagerCabinetService;
}

async function transferDuringHash(f, service) {
  const entered = deferred(),
    resume = deferred(),
    realHash = bcrypt.hash;
  bcrypt.hash = async (...args) => {
    entered.resolve();
    await resume.promise;
    return realHash(...args);
  };
  const pending = service.resetOwnerPassword(f.actor(), f.t1, 'replacement-password');
  pending.catch(() => {});
  try {
    await entered.promise;
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
  } finally {
    resume.resolve();
    bcrypt.hash = realHash;
  }
  return pending;
}

test('regression proof: pre-fix reset changes transferred owner password; new reset rejects before mutation', () =>
  fixture(async (f) => {
    const Legacy = legacyCabinetClass();
    const legacy = new Legacy(f.pool, f.tenants, f.audit, f.finance, undefined);
    assert.deepEqual(await transferDuringHash(f, legacy), { ok: true });
    assert.equal(
      await bcrypt.compare(
        'replacement-password',
        (await f.q('SELECT password FROM users WHERE id=$1', [f.owner]))[0].password,
      ),
      true,
      'demonstrates original TOCTOU failure',
    );
    await f.q(`UPDATE users SET password='original',sessions_valid_from=NULL WHERE id=$1`, [f.owner]);
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.a]);
    f.audits.length = 0;
    const key = authCacheKey(f.owner, 'reset-race');
    ttlCache.set(key, { userID: f.owner }, 30000);
    try {
      await assert.rejects(transferDuringHash(f, f.cabinet), status(404));
      assert.equal((await f.q('SELECT password FROM users WHERE id=$1', [f.owner]))[0].password, 'original');
      assert.ok(ttlCache.get(key));
      assert.equal(f.audits.length, 0);
    } finally {
      ttlCache.invalidate(key);
    }
  }));

test('reset transaction holds assignment lock through owner update; sessions and auth cache change only on commit', () =>
  fixture(async (f) => {
    const gotLock = deferred(),
      release = deferred();
    const originalConnect = f.pool.connect.bind(f.pool);
    let first = true;
    f.pool.connect = async () => {
      const client = await originalConnect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        const result = await query(...args);
        if (first && /SELECT id, name FROM tenants/.test(args[0])) {
          first = false;
          gotLock.resolve();
          await release.promise;
        }
        return result;
      };
      return client;
    };
    const key = authCacheKey(f.owner, 'reset-commit');
    ttlCache.set(key, { userID: f.owner }, 30000);
    const pending = f.cabinet.resetOwnerPassword(f.actor(), f.t1, 'owner-new-secret');
    try {
      await gotLock.promise;
      const contender = await f.admin.connect();
      try {
        await contender.query("SET lock_timeout='150ms'");
        await assert.rejects(
          contender.query('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]),
          (error) => error.code === '55P03',
        );
      } finally {
        await contender.query('RESET lock_timeout');
        contender.release();
      }
    } finally {
      release.resolve();
      f.pool.connect = originalConnect;
    }
    await pending;
    const owner = (await f.q('SELECT password,sessions_valid_from FROM users WHERE id=$1', [f.owner]))[0];
    assert.equal(await bcrypt.compare('owner-new-secret', owner.password), true);
    assert.ok(owner.sessions_valid_from);
    assert.equal(ttlCache.get(key), undefined);
    assert.equal(JSON.stringify(f.audits).includes('owner-new-secret'), false);
    assert.equal(JSON.stringify(f.audits).includes(owner.password), false);
  }));

function fakeDelivery(f) {
  const push = new PushService(f.pool);
  const delivered = [];
  push.postToExpo = async (messages) => {
    delivered.push(...messages);
    return { ok: true, status: 200, tickets: [], errors: [], transportError: null };
  };
  return { push, delivered, worker: new PlatformReminderService(f.pool, f.crm, push) };
}

test('operator push: default off, muted/quiet/tokenless claims remain free, concurrent attempts dedup and payload targets only operator', () =>
  fixture(async (f) => {
    const { push, delivered, worker } = fakeDelivery(f);
    await worker.tick();
    assert.equal(delivered.length, 0);
    assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 0);
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: true, daysBefore: [7, 3, 1, 0], pushEnabled: true });
    const candidate = (await f.crm.reminders(f.actor())).items.find((x) => x.tenantId === f.t1);
    await worker.deliver(f.a, candidate);
    assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 0);
    // Tenant-less platform token registration uses existing own-user insert, no broader RLS routing.
    const token = `ExponentPushToken[fixture-${f.a}]`;
    const registered = await runWithTenant('00000000-0000-0000-0000-000000000000', () =>
      push.upsertToken(f.a, '00000000-0000-0000-0000-000000000000', token, 'ios'),
    );
    assert.equal(registered.registered, true);
    await f.q('INSERT INTO notification_settings(user_id,master_enabled) VALUES($1,false)', [f.a]);
    await worker.deliver(f.a, candidate);
    assert.equal(delivered.length, 0);
    await f.q(
      `UPDATE notification_settings SET master_enabled=true,quiet_from=(now() at time zone 'UTC'-interval '1 hour')::time,quiet_to=(now() at time zone 'UTC'+interval '1 hour')::time,tz_offset_minutes=0 WHERE user_id=$1`,
      [f.a],
    );
    await worker.deliver(f.a, candidate);
    assert.equal(delivered.length, 0);
    await f.q('UPDATE notification_settings SET quiet_from=NULL,quiet_to=NULL WHERE user_id=$1', [f.a]);
    await f.q(`INSERT INTO notification_mutes(user_id,category) VALUES($1,'platform_reminder')`, [f.a]);
    await worker.deliver(f.a, candidate);
    assert.equal(delivered.length, 0);
    assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 0);
    await f.q('DELETE FROM notification_mutes WHERE user_id=$1', [f.a]);
    await Promise.all(Array.from({ length: 4 }, () => worker.deliver(f.a, candidate)));
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].to, token);
    assert.deepEqual(
      {
        type: delivered[0].data.type,
        operatorUserId: delivered[0].data.operatorUserId,
        tenantId: delivered[0].data.tenantId,
        kind: delivered[0].data.kind,
      },
      { type: 'platform_reminder', operatorUserId: f.a, tenantId: f.t1, kind: 'subscription_expiry' },
    );
    assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 1);
    await worker.deliver(f.a, candidate);
    assert.equal(delivered.length, 1);
  }));

test('push final recheck rejects transferred tenant, inactive operator and superseded event; ambiguous failure is never retried', () =>
  fixture(async (f) => {
    const { push, delivered, worker } = fakeDelivery(f);
    await push.upsertToken(f.a, '00000000-0000-0000-0000-000000000000', `ExponentPushToken[fixture-${f.a}]`, 'ios');
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: true, daysBefore: [7, 3, 1, 0], pushEnabled: true });
    const candidate = (await f.crm.reminders(f.actor())).items.find((x) => x.tenantId === f.t1);
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
    await worker.deliver(f.a, candidate);
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.a]);
    await f.q('UPDATE users SET is_active=false WHERE id=$1', [f.a]);
    await worker.deliver(f.a, candidate);
    await f.q('UPDATE users SET is_active=true WHERE id=$1', [f.a]);
    await f.q(`UPDATE tenants SET subscription_end=now()+interval '90 days' WHERE id=$1`, [f.t1]);
    await worker.deliver(f.a, candidate);
    assert.equal(delivered.length, 0);
    assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 0);
    await f.crm.setFollowUp(f.actor(), f.t1, { nextContactAt: new Date(Date.now() - 1000).toISOString() });
    const contact = (await f.crm.reminders(f.actor())).items.find((x) => x.kind === 'follow_up');
    let attempts = 0;
    push.postToExpo = async () => {
      attempts++;
      throw Error('unknown delivery result');
    };
    await worker.deliver(f.a, contact);
    await worker.deliver(f.a, contact);
    assert.equal(attempts, 1);
    assert.equal(
      (await f.crm.reminders(f.actor())).items.some((x) => x.id === contact.id),
      true,
    );
  }));

test('reset failure rolls back password/session boundary and leaves auth cache plus audit untouched', () =>
  fixture(async (f) => {
    const originalConnect = f.pool.connect.bind(f.pool);
    f.pool.connect = async () => {
      const client = await originalConnect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        const result = await query(...args);
        if (/UPDATE users SET password/.test(args[0])) throw new Error('fixture failure after update');
        return result;
      };
      return client;
    };
    const key = authCacheKey(f.owner, 'reset-rollback');
    ttlCache.set(key, { userID: f.owner }, 30000);
    const [before] = await f.q('SELECT password,sessions_valid_from FROM users WHERE id=$1', [f.owner]);
    try {
      await assert.rejects(f.cabinet.resetOwnerPassword(f.actor(), f.t1, 'rollback-secret'), /fixture failure/);
      assert.deepEqual((await f.q('SELECT password,sessions_valid_from FROM users WHERE id=$1', [f.owner]))[0], before);
      assert.ok(ttlCache.get(key));
      assert.equal(f.audits.length, 0);
    } finally {
      f.pool.connect = originalConnect;
      ttlCache.invalidate(key);
    }
  }));

test('push claim is durable before delivery and authorization locks prevent transfer during delivery', () =>
  fixture(async (f) => {
    const { push, worker } = fakeDelivery(f);
    await push.upsertToken(f.a, '00000000-0000-0000-0000-000000000000', `ExponentPushToken[fixture-${f.a}]`, 'ios');
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: true, daysBefore: [7], pushEnabled: true });
    const candidate = (await f.crm.reminders(f.actor())).items.find((x) => x.tenantId === f.t1);
    let called = false;
    let durableClaim = false;
    let transferBlocked = false;
    push.postToExpo = async () => {
      called = true;
      durableClaim =
        (await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1 AND event_key=$2', [f.a, candidate.id]))
          .length === 1;
      const contender = await f.admin.connect();
      try {
        await contender.query("SET lock_timeout='150ms'");
        try {
          await contender.query('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
        } catch (error) {
          transferBlocked = error.code === '55P03';
        }
      } finally {
        await contender.query('RESET lock_timeout');
        contender.release();
      }
      return { ok: true, status: 200, tickets: [], errors: [], transportError: null };
    };
    await worker.deliver(f.a, candidate);
    assert.equal(called, true);
    assert.equal(durableClaim, true, 'claim visible from independent connection before delivery');
    assert.equal(transferBlocked, true, 'scope remains locked through delivery');
    await f.q('UPDATE tenants SET manager_id=$2 WHERE id=$1', [f.t1, f.b]);
    assert.equal((await f.q('SELECT manager_id FROM tenants WHERE id=$1', [f.t1]))[0].manager_id, f.b);
  }));

test('migration 195 is safely repeatable and keeps existing private notes', () =>
  fixture(async (f) => {
    const note = await f.crm.addNote(f.actor(), f.t1, { text: 'preserve on rerun', requestId: randomUUID() });
    const sql = require('node:fs').readFileSync(join(__dirname, '../migrations/195_platform_crm.sql'), 'utf8');
    await f.q(sql);
    assert.equal((await f.crm.notes(f.actor(), f.t1)).items[0].id, note.id);
  }));

test('push waiting for concurrent contact clearing uses the new follow-up snapshot and sends nothing', () =>
  fixture(async (f) => {
    const { push, delivered, worker } = fakeDelivery(f);
    await push.upsertToken(f.a, '00000000-0000-0000-0000-000000000000', `ExponentPushToken[fixture-${f.a}]`, 'ios');
    await f.crm.updateReminderSettings(f.actor(), { expiryEnabled: false, daysBefore: [], pushEnabled: true });
    await f.crm.setFollowUp(f.actor(), f.t1, { nextContactAt: new Date(Date.now() - 1000).toISOString() });
    const candidate = (await f.crm.reminders(f.actor())).items[0];
    const updater = await f.admin.connect();
    const originalConnect = f.pool.connect.bind(f.pool);
    const locking = deferred();
    let selectPid;
    f.pool.connect = async () => {
      const client = await originalConnect();
      selectPid = (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const query = client.query.bind(client);
      client.query = (...args) => {
        if (/FROM tenants t/.test(args[0]) && /FOR SHARE/.test(args[0])) locking.resolve();
        return query(...args);
      };
      return client;
    };
    let pending;
    try {
      await updater.query('BEGIN');
      await updater.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [f.t1]);
      pending = worker.deliver(f.a, candidate);
      pending.catch(() => {});
      await locking.promise;
      // Confirm PostgreSQL has taken the statement snapshot and is waiting on our
      // lock before clearing contact. No timing-only success assertion.
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [state] = await f.q('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [selectPid]);
        if (state?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true);
      await updater.query('UPDATE platform_tenant_followups SET next_contact_at=NULL WHERE tenant_id=$1', [f.t1]);
      await updater.query('COMMIT');
      await pending;
      assert.equal(delivered.length, 0);
      assert.equal((await f.q('SELECT * FROM platform_reminder_claims WHERE user_id=$1', [f.a])).length, 0);
    } finally {
      await updater.query('ROLLBACK');
      updater.release();
      f.pool.connect = originalConnect;
      if (pending) await pending;
    }
  }));
