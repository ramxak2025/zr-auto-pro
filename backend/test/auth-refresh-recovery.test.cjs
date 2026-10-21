const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
require('reflect-metadata');
const { Controller, Get, UseGuards, Module, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { AuthService } = require('../dist/auth/auth.service');
const { AuthController } = require('../dist/auth/auth.controller');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtRefreshStrategy, JwtLogoutStrategy, JwtSwitchPointStrategy } = require('../dist/auth/jwt-refresh.strategy');
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
const { ttlCache } = require('../dist/common/ttl-cache');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');

// Explicit disposable local fixture only: never inherit DATABASE_URL / .env.
const url = process.env.AUTEXA_AUTH_TEST_DATABASE_URL;
const SECRET = 'disposable-oct21-refresh-fixture-secret-only';
process.env.JWT_SECRET = SECRET;
Logger.overrideLogger(false);

test('durable refresh recovery with real PostgreSQL and HTTP JWT guards', { skip: !url }, async (t) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(
    (parsed.port === '55439' && parsed.pathname === '/autexa_oct21_auth_test') ||
      (parsed.port === '55438' && parsed.pathname === '/autexa_oct8_test'),
  );
  const schema = 'auth_fixture_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  const tenant = randomUUID(),
    user = randomUUID(),
    point = randomUUID();
  let app;
  try {
    await pool.query(`
      CREATE TABLE tenants (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE roles (id uuid PRIMARY KEY, matrix jsonb);
      CREATE TABLE users (id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), role text DEFAULT 'director',
        role_id uuid, is_active boolean DEFAULT true, dismissed_at timestamptz, purged_at timestamptz,
        sessions_valid_from timestamptz, current_point_id uuid, point_allowed boolean DEFAULT true);
      CREATE TABLE tenant_points (id uuid PRIMARY KEY, tenant_id uuid, is_active boolean DEFAULT true);
      ALTER TABLE tenants ADD name text DEFAULT 'Fixture', ADD slug text, ADD phone text, ADD address text,
        ADD email text, ADD max_users int, ADD timezone text, ADD vin_enabled boolean,
        ADD attendance_mode text, ADD shifts_enabled boolean, ADD subscription_end timestamptz,
        ADD subscription_note text, ADD created_at timestamptz, ADD updated_at timestamptz;
      ALTER TABLE users ADD phone text, ADD full_name text, ADD avatar text, ADD salary_percent numeric,
        ADD owner_share_percent numeric, ADD created_at timestamptz;
      ALTER TABLE roles ADD name text;
      CREATE FUNCTION autexa_point_is_allowed(t uuid, u uuid, p uuid) RETURNS boolean LANGUAGE sql AS $$
        SELECT EXISTS(SELECT 1 FROM users x JOIN tenant_points y ON y.tenant_id=x.tenant_id
          WHERE x.id=u AND x.tenant_id=t AND y.id=p AND y.is_active AND x.point_allowed) $$;
      CREATE FUNCTION autexa_default_point(t uuid, u uuid, p uuid) RETURNS uuid LANGUAGE sql AS $$
        SELECT CASE WHEN autexa_point_is_allowed(t,u,p) THEN p END $$;
      CREATE FUNCTION autexa_can_manage_staff(u uuid) RETURNS boolean LANGUAGE sql AS $$
        SELECT role='director' FROM users WHERE id=u $$;
    `);
    await pool.query(readFileSync(join(__dirname, '../migrations/021_revoked_tokens.sql'), 'utf8'));
    const migration = join(__dirname, '../migrations/197_refresh_recovery.sql');
    if (existsSync(migration)) await pool.query(readFileSync(migration, 'utf8'));
    await pool.query('INSERT INTO tenants(id) VALUES($1)', [tenant]);
    await pool.query('INSERT INTO users(id,tenant_id,current_point_id) VALUES($1,$2,$3)', [user, tenant, point]);
    await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [point, tenant]);
    const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '30d' } });
    const auth = new AuthService(pool, jwt);
    const strategy = new JwtStrategy(pool);
    class ProtectedController {
      read() {
        return { ok: true };
      }
    }
    Controller('protected')(ProtectedController);
    UseGuards(JwtAuthGuard)(ProtectedController);
    Get()(
      ProtectedController.prototype,
      'read',
      Object.getOwnPropertyDescriptor(ProtectedController.prototype, 'read'),
    );
    class FixtureModule {}
    Module({
      controllers: [AuthController, ProtectedController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: JwtService, useValue: jwt },
        { provide: JwtStrategy, useValue: strategy },
        { provide: JwtRefreshStrategy, useValue: new JwtRefreshStrategy(strategy) },
        { provide: JwtLogoutStrategy, useValue: new JwtLogoutStrategy(strategy) },
        { provide: JwtSwitchPointStrategy, useValue: new JwtSwitchPointStrategy(strategy) },
      ],
    })(FixtureModule);
    app = await NestFactory.create(FixtureModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const bearer = (extra = {}) =>
      (extra.exp ? new JwtService({ secret: SECRET }) : jwt).sign({
        sub: user,
        tenantId: tenant,
        pointId: point,
        jti: randomUUID(),
        iat: Math.floor(Date.now() / 1000) - 8 * 86400,
        ...extra,
      });
    const refresh = (token, requestId) =>
      fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(requestId ? { 'x-refresh-request-id': requestId } : {}) },
      });
    const logout = (token, requestId) =>
      fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(requestId ? { 'x-refresh-request-id': requestId } : {}) },
      });
    const protectedGet = (token) => fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${token}` } });
    const switchPoint = (token, pointId, key) =>
      fetch(`${base}/auth/switch-point`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(key ? { 'x-refresh-request-id': key } : {}),
        },
        body: JSON.stringify({ pointId }),
      });
    const rotate = async (old = bearer(), key = randomUUID()) => {
      const response = await refresh(old, key);
      assert.equal(response.status, 201);
      return { old, key, child: (await response.json()).token };
    };
    const afterGrace = async (old) => {
      await pool.query("UPDATE revoked_tokens SET revoked_at=now()-interval '20 minutes' WHERE jti=$1", [
        jwt.decode(old).jti,
      ]);
      ttlCache.invalidatePrefix('');
    };
    const reset = async () => {
      ttlCache.invalidatePrefix('');
      await pool.query('TRUNCATE revoked_tokens');
      await pool.query(
        "UPDATE users SET is_active=true,dismissed_at=NULL,purged_at=NULL,sessions_valid_from=NULL,point_allowed=true,role='director'",
      );
      await pool.query('UPDATE tenants SET is_active=true');
      await pool.query('UPDATE users SET current_point_id=$1', [point]);
    };

    await t.test('lost response retries return exactly the committed successor on any replica', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID();
      const first = await refresh(old, key);
      assert.equal(first.status, 201);
      const committed = await first.json(); // Simulate response being lost at the caller.
      const retried = await refresh(old, key);
      assert.equal(retried.status, 201, 'lost response must not strand the client with a consumed token');
      assert.deepEqual(await retried.json(), committed);
      const anotherReplica = new AuthService(
        pool,
        new JwtService({ secret: SECRET, signOptions: { expiresIn: '30d' } }),
      );
      assert.deepEqual(
        await anotherReplica.refresh(
          { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(old).jti },
          old,
          key,
        ),
        committed,
      );
    });

    await t.test('signing failure does not commit a revocation without its successor', async () => {
      await reset();
      const old = bearer();
      const brokenJwt = {
        decode: (v) => jwt.decode(v),
        verify: (v) => jwt.verify(v),
        sign: () => {
          throw new Error('signing unavailable');
        },
      };
      const broken = new AuthService(pool, brokenJwt);
      await assert.rejects(() =>
        broken.refresh(
          { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(old).jti },
          old,
          randomUUID(),
        ),
      );
      const count = await pool.query('SELECT count(*)::int AS count FROM revoked_tokens');
      assert.equal(count.rows[0].count, 0, 'a failed exchange must leave the old credential usable');
    });

    await t.test('twenty-minute offline/restart replays fixed bytes while ordinary API stays revoked', async () => {
      await reset();
      const { old, key, child } = await rotate();
      await afterGrace(old);
      assert.equal((await protectedGet(old)).status, 401);
      assert.equal((await refresh(old)).status, 401);
      assert.equal((await refresh(old, randomUUID())).status, 401);
      const receipt = await pool.query('SELECT * FROM revoked_tokens WHERE jti=$1', [jwt.decode(old).jti]);
      assert.equal(receipt.rows[0].refresh_recover_until.getTime(), jwt.decode(old).exp * 1000);
      assert.equal(JSON.stringify(receipt.rows).includes(key), false);
      assert.equal(JSON.stringify(receipt.rows).includes(child), false);
      const resumed = await refresh(old, key);
      assert.equal(resumed.status, 201);
      assert.deepEqual(await resumed.json(), { token: child });
      assert.equal((await protectedGet(child)).status, 200);
      const later = await pool.query('SELECT * FROM revoked_tokens WHERE jti=$1', [jwt.decode(old).jti]);
      assert.deepEqual(later.rows, receipt.rows, 'replay cannot move iat, exp, deadline or grace');
    });

    await t.test('concurrent retries have one successor, different keys cannot fork it', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 12 }, () => refresh(old, key)));
      const tokens = await Promise.all(
        responses.map(async (r) => {
          assert.equal(r.status, 201);
          return (await r.json()).token;
        }),
      );
      assert.equal(new Set(tokens).size, 1);
      assert.equal((await refresh(old, randomUUID())).status, 401);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM revoked_tokens')).rows[0].n, 1);
    });

    await t.test(
      'legacy clients still rotate once, and invalid capabilities/signatures/expiry fail closed',
      async () => {
        await reset();
        const old = bearer();
        assert.equal((await refresh(old)).status, 201);
        assert.equal((await refresh(old)).status, 401);
        assert.equal((await refresh(bearer(), 'not-a-secret-uuid')).status, 400);
        assert.equal((await refresh(bearer({ exp: Math.floor(Date.now() / 1000) - 1 }), randomUUID())).status, 401);
        assert.equal((await refresh(old.slice(0, -5) + 'wrong', randomUUID())).status, 401);
        assert.equal((await refresh(bearer({ purpose: 'point_select' }), randomUUID())).status, 401);
        assert.equal((await refresh(bearer({ impersonatedBy: randomUUID() }), randomUUID())).status, 403);
        assert.equal((await refresh(bearer({ tenantId: randomUUID() }), randomUUID())).status, 401);
      },
    );

    for (const [name, sql] of [
      ['deactivation', 'UPDATE users SET is_active=false'],
      ['dismissal', 'UPDATE users SET dismissed_at=now()'],
      ['purge', 'UPDATE users SET purged_at=now()'],
      ['password boundary', "UPDATE users SET sessions_valid_from=now()+interval '1 second'"],
      ['point removal', 'UPDATE users SET point_allowed=false'],
      ['tenant closure', 'UPDATE tenants SET is_active=false'],
    ])
      await t.test(`live ${name} rejects replay even with a warm normal auth cache`, async () => {
        await reset();
        const { old, key } = await rotate();
        assert.equal((await protectedGet(old)).status, 200);
        await pool.query(sql);
        assert.equal((await refresh(old, key)).status, 401);
      });

    await t.test('consumed or logged-out child cannot be recovered through an ancestor', async () => {
      for (const consume of ['logout', 'refresh', 'switch-point']) {
        await reset();
        const { old, key, child } = await rotate();
        if (consume === 'logout') assert.equal((await logout(child)).status, 201);
        if (consume === 'refresh') await rotate(child);
        if (consume === 'switch-point')
          await auth.blacklistToken({
            jti: jwt.decode(child).jti,
            userId: user,
            tenantId: tenant,
            graceMs: 0,
            expiresAt: new Date(jwt.decode(child).exp * 1000),
            mode: 'claim',
          });
        assert.equal((await refresh(old, key)).status, 401, consume);
      }
    });

    await t.test('receipt deadline is absolute, never renewed by repeated requests', async () => {
      await reset();
      const { old, key } = await rotate();
      await pool.query('UPDATE revoked_tokens SET refresh_recover_until=now()');
      assert.equal((await refresh(old, key)).status, 401);
    });

    await t.test('lost switch response replays exactly one target-bound successor after restart', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID(),
        branch = randomUUID();
      await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
      const first = await switchPoint(old, branch, key);
      assert.equal(first.status, 201);
      const issued = await first.json();
      assert.equal(issued.user.currentPointId, branch);
      assert.equal((await protectedGet(old)).status, 401, 'switch still revokes ordinary source immediately');
      await afterGrace(old);
      const replay = await switchPoint(old, branch, key);
      assert.equal(replay.status, 201, 'lost switch response must recover without another login');
      assert.equal((await replay.json()).token, issued.token);
      assert.equal((await refresh(old, key)).status, 401, 'operation is bound to switch-point');
      assert.equal((await switchPoint(old, point, key)).status, 401, 'same-source target is not a replay/no-op bypass');
      assert.equal((await switchPoint(old, branch, randomUUID())).status, 401);
      assert.equal((await switchPoint(old, branch)).status, 401);
      assert.equal((await logout(old, key)).status, 201);
      assert.equal((await protectedGet(issued.token)).status, 401);
    });

    await t.test('switch recovery rechecks target availability, staff permission and password boundary', async () => {
      for (const boundary of ['target', 'role', 'password', 'source']) {
        await reset();
        const old = bearer(),
          key = randomUUID(),
          branch = randomUUID();
        await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
        assert.equal((await switchPoint(old, branch, key)).status, 201);
        if (boundary === 'target') await pool.query('UPDATE tenant_points SET is_active=false WHERE id=$1', [branch]);
        if (boundary === 'role') await pool.query("UPDATE users SET role='master'");
        if (boundary === 'password') await pool.query('UPDATE users SET sessions_valid_from=now()');
        if (boundary === 'source') await pool.query('UPDATE users SET point_allowed=false');
        assert.equal(
          (await switchPoint(old, branch, key)).status,
          ['target', 'role'].includes(boundary) ? 403 : 401,
          boundary,
        );
      }
    });

    await t.test('refresh and switch cannot consume the same source into different branches', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID(),
        branch = randomUUID();
      await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
      const replies = await Promise.all([refresh(old, key), switchPoint(old, branch, key)]);
      assert.deepEqual(replies.map((r) => r.status).sort(), [201, 401]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM revoked_tokens')).rows[0].n, 1);
    });

    await t.test('keyed same-point request does not mint or consume a token', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID();
      const response = await switchPoint(old, point, key);
      assert.equal(response.status, 201);
      assert.equal((await response.json()).token, old);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM revoked_tokens')).rows[0].n, 0);
    });

    await t.test('owned recovery logout revokes the target even after only its source point is archived', async () => {
      await reset();
      const old = bearer(),
        key = randomUUID(),
        branch = randomUUID();
      await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
      const issued = await switchPoint(old, branch, key);
      assert.equal(issued.status, 201);
      const child = (await issued.json()).token;
      await pool.query('UPDATE tenant_points SET is_active=false WHERE id=$1', [point]);
      try {
        ttlCache.invalidatePrefix('');
        assert.equal((await protectedGet(child)).status, 200);
        assert.equal((await logout(old)).status, 401);
        assert.equal((await logout(old, randomUUID())).status, 401);
        const other = randomUUID();
        await pool.query('INSERT INTO users(id,tenant_id,current_point_id) VALUES($1,$2,$3)', [other, tenant, branch]);
        assert.equal(
          (await logout(bearer({ sub: other, jti: jwt.decode(old).jti }), key)).status,
          401,
          'receipt belongs to the signed source user',
        );
        assert.equal((await logout(bearer({ jti: jwt.decode(old).jti, tenantId: randomUUID() }), key)).status, 401);
        assert.equal(
          (await logout(bearer({ jti: jwt.decode(old).jti, exp: Math.floor(Date.now() / 1000) - 1 }), key)).status,
          401,
        );
        assert.equal(
          (await logout(old, key)).status,
          201,
          'revocation must not require continued data access at the source',
        );
        assert.equal((await protectedGet(child)).status, 401);
        assert.equal((await switchPoint(old, branch, key)).status, 401);
      } finally {
        await pool.query('UPDATE tenant_points SET is_active=true WHERE id=$1', [point]);
      }
    });

    await t.test(
      'legacy source without a signed point replays its persisted source after the last-point hint moves',
      async () => {
        for (const rawPoint of [undefined, null]) {
          for (const operation of ['refresh', 'switch-point']) {
            await reset();
            const old = bearer({ pointId: rawPoint }),
              key = randomUUID(),
              branch = randomUUID();
            await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
            const first = await (operation === 'refresh' ? refresh(old, key) : switchPoint(old, branch, key));
            assert.equal(first.status, 201);
            const child = (await first.json()).token;
            await pool.query('UPDATE users SET current_point_id=$1', [branch]);
            const repeated = await (operation === 'refresh' ? refresh(old, key) : switchPoint(old, branch, key));
            assert.equal(repeated.status, 201, `${operation}, signed source=${String(rawPoint)}`);
            assert.equal((await repeated.json()).token, child);
            await pool.query('UPDATE tenant_points SET is_active=false WHERE id=$1', [point]);
            assert.equal(
              (await (operation === 'refresh' ? refresh(old, key) : switchPoint(old, branch, key))).status,
              401,
              'the original source must still be accessible',
            );
            await pool.query('UPDATE tenant_points SET is_active=true WHERE id=$1', [point]);
          }
        }
      },
    );

    await t.test(
      'keyed switch releases its transaction before the preference write with a one-connection pool',
      async () => {
        await reset();
        const one = new Pool({
          connectionString: url,
          options: `-c search_path=${schema},public`,
          max: 1,
          connectionTimeoutMillis: 100,
        });
        const query = one.query.bind(one);
        let preferenceCheckoutFailures = 0;
        one.query = async (sql, args) => {
          try {
            return await query(sql, args);
          } catch (error) {
            if (sql.startsWith('UPDATE users SET current_point_id')) preferenceCheckoutFailures++;
            throw error;
          }
        };
        try {
          const old = bearer(),
            branch = randomUUID();
          await one.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
          const service = new AuthService(one, jwt);
          const response = await service.switchPoint(
            { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(old).jti },
            old,
            { pointId: branch },
            randomUUID(),
          );
          assert.equal(jwt.decode(response.token).pointId, branch);
          assert.equal(
            preferenceCheckoutFailures,
            0,
            'a completed transaction must not hold the only connection while awaiting another checkout',
          );
          assert.equal(
            (await one.query('SELECT current_point_id FROM users WHERE id=$1', [user])).rows[0].current_point_id,
            branch,
          );
        } finally {
          await one.end();
        }
      },
    );

    await t.test('pending source logout after grace revokes descendants, including a consumed child', async () => {
      await reset();
      const a = await rotate();
      const b = await rotate(a.child);
      await afterGrace(a.old);
      assert.equal((await logout(a.old)).status, 401);
      assert.equal((await logout(a.old, randomUUID())).status, 401);
      assert.equal((await logout(a.old, a.key)).status, 201);
      assert.equal((await protectedGet(b.child)).status, 401);
      assert.equal((await refresh(a.old, a.key)).status, 401);
      assert.equal((await refresh(a.child, b.key)).status, 401);
    });

    await t.test('actual HTTP switch-point successor is revoked by pending ancestor logout', async () => {
      await reset();
      const a = await rotate();
      const branch = randomUUID();
      await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
      const switched = await fetch(`${base}/auth/switch-point`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${a.child}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId: branch }),
      });
      assert.equal(switched.status, 201);
      const c = (await switched.json()).token;
      assert.equal(jwt.decode(c).pointId, branch);
      assert.equal((await protectedGet(c)).status, 200);
      await afterGrace(a.old);
      assert.equal((await logout(a.old, a.key)).status, 201);
      assert.equal((await protectedGet(c)).status, 401, 'force logout must traverse the actual switch-point child');
    });

    await t.test('ancestor logout waits for an actual switch-point claim and revokes its successor', async () => {
      await reset();
      const a = await rotate(),
        branch = randomUUID();
      await pool.query('INSERT INTO tenant_points(id,tenant_id) VALUES($1,$2)', [branch, tenant]);
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        const switching = new AuthService({ query: (sql, args) => blocker.query(sql, args) }, jwt);
        const c = await switching.switchPoint(
          { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(a.child).jti },
          a.child,
          { pointId: branch },
        );
        const force = auth.logout(jwt.decode(a.old).jti, user, tenant);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          const q = await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO revoked_tokens%' LIMIT 1",
          );
          waiting = q.rowCount > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await blocker.query('COMMIT');
        await force;
        assert.equal(waiting, true, 'exercise the actual switch claim lock wait');
        assert.equal((await protectedGet(c.token)).status, 401);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
    });

    await t.test('logout waiting on an uncommitted child exchange revokes the new grandchild', async () => {
      await reset();
      const a = await rotate();
      const blocker = await pool.connect();
      let finishCommit;
      let hasInserted;
      const inserted = new Promise((resolve) => {
        hasInserted = resolve;
      });
      const commitGate = new Promise((resolve) => {
        finishCommit = resolve;
      });
      const racingPool = {
        connect: async () => ({
          query: async (sql, args) => {
            if (sql === 'COMMIT') {
              hasInserted();
              await commitGate;
            }
            return blocker.query(sql, args);
          },
          release: () => blocker.release(),
        }),
      };
      const other = new AuthService(racingPool, jwt);
      const rotation = other.refresh(
        { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(a.child).jti },
        a.child,
        randomUUID(),
      );
      await inserted;
      const force = auth.logout(jwt.decode(a.old).jti, user, tenant);
      // Wait for the real lock wait, not an arbitrary sleep scheduling guess.
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const q = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO revoked_tokens%' LIMIT 1",
        );
        waiting = q.rowCount > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      finishCommit();
      const c = await rotation;
      await force;
      assert.equal(waiting, true, 'the test must actually force the conflicting INSERT wait');
      assert.equal((await protectedGet(c.token)).status, 401);
      assert.equal((await refresh(a.old, a.key)).status, 401);
    });

    await t.test(
      'receipt failure rolls back claim and tenant RLS cannot hide a revocation from recovery/logout',
      async () => {
        await reset();
        await pool.query(`CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt unavailable'; END $$;
        CREATE TRIGGER receipt_failure BEFORE INSERT ON revoked_tokens FOR EACH ROW EXECUTE FUNCTION reject_receipt()`);
        const old = bearer(),
          key = randomUUID();
        assert.equal((await refresh(old, key)).status, 500);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM revoked_tokens')).rows[0].n, 0);
        await pool.query('DROP TRIGGER receipt_failure ON revoked_tokens');
        assert.equal((await refresh(old, key)).status, 201);

        const role = 'auth_role_' + randomUUID().replaceAll('-', '');
        const fixturePassword = 'fixture-' + randomUUID();
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${fixturePassword}' NOSUPERUSER NOBYPASSRLS`);
        const appUrl = new URL(url);
        appUrl.username = role;
        appUrl.password = fixturePassword;
        const appPool = new Pool({ connectionString: appUrl.toString(), options: `-c search_path=${schema},public` });
        try {
          await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT,INSERT,UPDATE ON revoked_tokens TO ${role};
          ALTER TABLE revoked_tokens ENABLE ROW LEVEL SECURITY; ALTER TABLE revoked_tokens FORCE ROW LEVEL SECURITY;
          CREATE POLICY tenant_isolation ON revoked_tokens USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
            WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)`);
          const tenantPool = new TenantAwarePool(pool, appPool),
            service = new AuthService(tenantPool, jwt);
          const session = await runWithTenant(tenant, () =>
            service.refresh(
              { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(old).jti },
              old,
              key,
            ),
          );
          const other = randomUUID();
          assert.equal(
            (await runWithTenant(other, () => tenantPool.query('SELECT * FROM revoked_tokens'))).rowCount,
            0,
          );
          assert.equal(
            (await runWithTenant(tenant, () => tenantPool.query('SELECT * FROM revoked_tokens'))).rowCount,
            1,
          );
          await runWithTenant(tenant, () => service.logout(jwt.decode(old).jti, user, tenant));
          assert.equal((await protectedGet(session.token)).status, 401);
          await assert.rejects(
            () =>
              runWithTenant(tenant, () =>
                service.refresh(
                  { userID: user, tenantID: tenant, currentPointId: point, jti: jwt.decode(old).jti },
                  old,
                  key,
                ),
              ),
            (e) => e.status === 401,
          );
        } finally {
          await appPool.end();
          await pool.query(
            'DROP POLICY IF EXISTS tenant_isolation ON revoked_tokens; ALTER TABLE revoked_tokens DISABLE ROW LEVEL SECURITY',
          );
          await admin.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
        }
      },
    );
    await t.test('tenant-less manager refresh, durable replay and logout use NULL tenant and no point', async () => {
      await reset();
      const manager = randomUUID(),
        key = randomUUID();
      await pool.query("INSERT INTO users(id,tenant_id,current_point_id,role) VALUES($1,NULL,NULL,'manager')", [
        manager,
      ]);
      const old = bearer({ sub: manager, tenantId: undefined, pointId: null });
      const first = await refresh(old, key);
      assert.equal(first.status, 201);
      const child = (await first.json()).token;
      const claims = jwt.decode(child);
      assert.equal(claims.sub, manager);
      assert.equal(claims.tenantId, undefined);
      assert.equal(claims.pointId, null);
      const receipt = (
        await pool.query('SELECT tenant_id,refresh_source_point_id FROM revoked_tokens WHERE jti=$1', [
          jwt.decode(old).jti,
        ])
      ).rows[0];
      assert.deepEqual(receipt, { tenant_id: null, refresh_source_point_id: null });
      await afterGrace(old);
      const repeat = await refresh(old, key);
      assert.equal(repeat.status, 201);
      assert.equal((await repeat.json()).token, child);
      assert.equal((await protectedGet(child)).status, 200);
      assert.equal((await logout(old, key)).status, 201);
      assert.equal((await protectedGet(child)).status, 401);
      assert.equal((await refresh(old, key)).status, 401);
    });
  } finally {
    if (app) await app.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
