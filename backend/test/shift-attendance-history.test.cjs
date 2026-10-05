const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { ShiftsService } = require('../dist/shifts/shifts.service');
const { ShiftsController } = require('../dist/shifts/shifts.controller');
const { ShiftAutoCloseService } = require('../dist/shifts/shift-auto-close.service');
const { staleShiftSql } = require('../dist/shifts/shift-auto-close.sql');
const { ScheduleService } = require('../dist/schedule/schedule.service');
const { zonedDateKey } = require('../dist/common/timezone');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const POINT = '33333333-3333-4333-8333-333333333333';
const actor = (tenantID = TENANT, userID = USER, currentPointId = POINT) => ({
  tenantID,
  userID,
  currentPointId,
  role: 'director',
  permissions: {},
});
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();
const iso = (value) => (value == null ? null : new Date(value).toISOString());

function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: flat(sql), params });
      if (sql.includes('SELECT timezone FROM tenants')) return { rows: [{ timezone: 'Europe/Moscow' }] };
      if (sql.includes('SELECT shifts_enabled FROM tenants')) return { rows: [{ shifts_enabled: true }] };
      return { rows: /^\s*SELECT s\.\*/.test(sql) ? rows : [], rowCount: 0 };
    },
  };
}

test('history rejects malformed, repeated, structured and impossible dates before touching the database', async () => {
  const pool = fakePool();
  const service = new ShiftsService(pool, {});
  for (const date of [
    '',
    null,
    20261005,
    [],
    ['2026-10-05'],
    ['2026-10-05', '2026-10-06'],
    { day: '2026-10-05' },
    '2026-2-03',
    ' 2026-10-05',
    '2026-10-05T00:00:00Z',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-10-00',
    '0000-01-01',
    "2026-10-05' OR true --",
  ]) {
    await assert.rejects(
      () => service.getAll(TENANT, actor(), date),
      (error) => error.getStatus() === 400,
    );
  }
  assert.equal(pool.calls.length, 0);
});

test('day history retains exact events, binds date and session scope, and leaves the legacy limit intact', async () => {
  const row = {
    id: randomUUID(),
    tenant_id: TENANT,
    user_id: USER,
    point_id: POINT,
    date: '2024-02-29',
    opened_at: '2024-02-29T06:07:08.123Z',
    closed_at: '2024-02-29T21:00:00.000Z',
    is_auto_closed: true,
    user_full_name: 'Мастер',
    user_role: 'master',
  };
  const pool = fakePool([row]);
  const service = new ShiftsService(pool, {});
  const [shift] = await service.getAll(TENANT, actor(), '2024-02-29');
  assert.equal(shift.openedAt, row.opened_at);
  assert.equal(shift.closedAt, row.closed_at);
  assert.equal(shift.date, '2024-02-29');
  assert.equal(shift.user.fullName, 'Мастер');
  assert.equal(shift.pointId, POINT);
  let query = pool.calls.find((call) => call.sql.startsWith('SELECT s.*'));
  assert.deepEqual(query.params, [TENANT, POINT, '2024-02-29']);
  assert.match(query.sql, /u\.tenant_id = s\.tenant_id/);
  assert.match(query.sql, /s\.tenant_id = \$1 AND s\.point_id = \$2 AND s\.date = \$3::date/);
  assert.match(query.sql, /s\.date::text AS date/);
  assert.match(query.sql, /ORDER BY s\.opened_at DESC, s\.id DESC$/);
  assert.doesNotMatch(query.sql, /LIMIT/);
  pool.calls.length = 0;
  await service.getAll(TENANT, actor());
  query = pool.calls.find((call) => call.sql.startsWith('SELECT s.*'));
  assert.deepEqual(query.params, [TENANT, POINT]);
  assert.match(query.sql, /LIMIT 100$/);
  assert.doesNotMatch(query.sql, /date::text/);
});

test('history keeps schedule_view authorization and forwards only authenticated scope plus the date', async () => {
  const calls = [];
  const controller = new ShiftsController({ getAll: (...args) => calls.push(args) });
  const user = actor();
  controller.getAll(user, '2026-10-05');
  assert.deepEqual(calls, [[TENANT, user, '2026-10-05']]);
  assert.equal(Reflect.getMetadata('requiredPermission', ShiftsController.prototype.getAll), 'schedule_view');
});

test('the attendance scheduler runs every UTC minute and startup recovery remains enabled', async (t) => {
  const metadata = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', ShiftAutoCloseService.prototype.handleDailyClose);
  assert.equal(metadata.cronTime, '* * * * *');
  assert.equal(metadata.timeZone, 'UTC');
  const job = new ShiftAutoCloseService({});
  const triggers = [];
  job.closeStaleShifts = async (trigger) => triggers.push(trigger);
  let scheduled;
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    scheduled = { callback, delay };
  });
  await job.onModuleInit();
  assert.equal(scheduled.delay, 10_000);
  await scheduled.callback();
  await job.handleDailyClose();
  assert.deepEqual(triggers, ['startup', 'cron']);
});

// Explicit opt-in only. Never read DATABASE_URL or the application's DB config.
// Every connection creates temporary tables with a pg_temp-only search path,
// uses savepoints for service transactions, and rolls everything back.
const LIVE_DB = process.env.SHIFTS_LIVE_DB;
const LIVE = { skip: LIVE_DB ? false : 'set SHIFTS_LIVE_DB to an isolated local PostgreSQL fixture' };

async function withDatabase(now, scenario) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: LIVE_DB });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path = pg_temp');
    await client.query(`
      CREATE TEMP TABLE tenants (id uuid PRIMARY KEY, timezone text, shifts_enabled boolean DEFAULT true) ON COMMIT DROP;
      CREATE TEMP TABLE users (
        id uuid PRIMARY KEY, tenant_id uuid, full_name text DEFAULT 'Мастер', role text DEFAULT 'master', avatar text,
        is_active boolean DEFAULT true, dismissed_at timestamptz, purged_at timestamptz,
        hidden_from_schedule boolean DEFAULT false, hidden_everywhere boolean DEFAULT false
      ) ON COMMIT DROP;
      CREATE TEMP TABLE shifts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tenant_id uuid, point_id uuid,
        date date, opened_at timestamptz DEFAULT now(), closed_at timestamptz,
        is_auto_closed boolean DEFAULT false, note text
      ) ON COMMIT DROP;
      CREATE TEMP TABLE schedule_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tenant_id uuid, point_id uuid, date date, is_day_off boolean DEFAULT false,
        shift_start text, shift_end text, actual_arrival timestamptz, late_minutes integer, late_status text, note text,
        is_manual_override boolean DEFAULT false, UNIQUE (tenant_id, user_id, date)
      ) ON COMMIT DROP;
      CREATE TEMP TABLE user_points (user_id uuid, tenant_id uuid, point_id uuid) ON COMMIT DROP;
    `);
    const clock = { now };
    const query = (sql, params = []) => {
      // Execute the production SQL; replace only its clock with a bound instant.
      // No date, scope, ordering or limit logic is simulated in this adapter.
      if (/\b(?:now|clock_timestamp)\(\)/i.test(sql)) {
        return client.query(sql.replace(/\b(?:now|clock_timestamp)\(\)/gi, `$${params.length + 1}::timestamptz`), [
          ...params,
          clock.now,
        ]);
      }
      return client.query(sql, params);
    };
    let sequence = 0;
    const pool = {
      query,
      async connect() {
        const savepoint = `shift_test_${++sequence}`;
        return {
          async query(sql, params) {
            if (sql === 'BEGIN') return client.query(`SAVEPOINT ${savepoint}`);
            if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoint}`);
            if (sql === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            return query(sql, params);
          },
          release() {},
        };
      },
    };
    await scenario({ client, pool, clock });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

async function seedTenant(client, timezone = 'Europe/Moscow') {
  const tenantID = randomUUID();
  const userID = randomUUID();
  const pointId = randomUUID();
  await client.query('INSERT INTO tenants (id, timezone) VALUES ($1, $2)', [tenantID, timezone]);
  await client.query('INSERT INTO users (id, tenant_id) VALUES ($1, $2)', [userID, tenantID]);
  return { tenantID, userID, pointId, actor: actor(tenantID, userID, pointId) };
}

async function seedShift(client, owner, date, openedAt, extra = {}) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO shifts (id, tenant_id, user_id, point_id, date, opened_at, closed_at, is_auto_closed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      owner.tenantID,
      extra.userID ?? owner.userID,
      Object.hasOwn(extra, 'pointId') ? extra.pointId : owner.pointId,
      date,
      openedAt,
      extra.closedAt ?? null,
      extra.isAutoClosed ?? false,
    ],
  );
  return id;
}

async function storedShift(client, id) {
  const { rows } = await client.query('SELECT *, date::text AS date FROM shifts WHERE id=$1', [id]);
  return rows[0];
}

function serviceWithoutPush(pool) {
  const service = new ShiftsService(pool, {});
  const notifications = [];
  service.fireAttendancePush = async (...args) => notifications.push(args);
  return { service, notifications };
}

test(
  'LIVE midnight closes last-minute shifts, catches missed jobs across tenant zones, and preserves finished rows',
  LIVE,
  async (t) => {
    const beforeMidnight = '2026-10-05T20:59:59.999Z';
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(beforeMidnight) });
    await withDatabase(beforeMidnight, async ({ client, pool, clock }) => {
      const moscow = await seedTenant(client);
      const vladivostok = await seedTenant(client, 'Asia/Vladivostok');
      const lastMinute = await seedShift(client, moscow, '2026-10-05', beforeMidnight);
      const nextDay = await seedShift(client, moscow, '2026-10-06', '2026-10-05T21:00:00Z');
      const otherZoneToday = await seedShift(client, vladivostok, '2026-10-06', '2026-10-05T14:05:00Z');
      const missed = await seedShift(client, moscow, '2026-10-01', '2026-10-01T06:00:00Z');
      const historical = await seedShift(client, moscow, '2026-10-02', '2026-10-05T12:00:00Z');
      const manual = await seedShift(client, moscow, '2026-10-04', '2026-10-04T06:00:00Z', {
        closedAt: '2026-10-04T08:00:00Z',
      });
      const job = new ShiftAutoCloseService(pool);
      await job.handleDailyClose();
      assert.equal((await storedShift(client, lastMinute)).closed_at, null);
      assert.equal(iso((await storedShift(client, missed)).closed_at), '2026-10-01T21:00:00.000Z');
      assert.equal(iso((await storedShift(client, historical)).closed_at), '2026-10-05T12:00:00.000Z');

      clock.now = '2026-10-05T21:00:00.000Z';
      t.mock.timers.setTime(Date.parse(clock.now));
      await job.handleDailyClose();
      const closed = await storedShift(client, lastMinute);
      assert.equal(iso(closed.closed_at), clock.now, 'the original 23:59/hour gate leaves this shift open at midnight');
      assert.equal(closed.is_auto_closed, true);
      assert.equal((await storedShift(client, nextDay)).closed_at, null);
      assert.equal((await storedShift(client, otherZoneToday)).closed_at, null);

      clock.now = '2026-10-06T14:07:00.000Z'; // 00:07 the next day in Vladivostok, missed midnight run.
      t.mock.timers.setTime(Date.parse(clock.now));
      await job.handleDailyClose();
      assert.equal(iso((await storedShift(client, otherZoneToday)).closed_at), '2026-10-06T14:00:00.000Z');
      assert.equal((await storedShift(client, nextDay)).closed_at, null, 'Moscow has not reached its next midnight');
      clock.now = '2026-10-08T09:10:00.000Z';
      await job.closeStaleShifts('startup');
      assert.equal(iso((await storedShift(client, nextDay)).closed_at), '2026-10-06T21:00:00.000Z');
      await job.handleDailyClose();
      assert.deepEqual(await storedShift(client, lastMinute), closed, 'later sweeps do not rewrite completed shifts');
      const preserved = await storedShift(client, manual);
      assert.equal(iso(preserved.closed_at), '2026-10-04T08:00:00.000Z');
      assert.equal(preserved.is_auto_closed, false);
    });
  },
);

test('LIVE shared midnight SQL handles half-hour zones and calendar year boundaries', LIVE, async () => {
  await withDatabase('2027-01-01T02:00:00.000Z', async ({ client, pool }) => {
    const owner = await seedTenant(client);
    const id = await seedShift(client, owner, '2026-12-31', '2026-12-31T18:29:59.900Z');
    const stale = staleShiftSql('$2');
    await pool.query(
      `UPDATE shifts SET closed_at = ${stale.closedAt}, is_auto_closed = true
       WHERE id=$1 AND closed_at IS NULL AND ${stale.predicate}`,
      [id, 'Asia/Kolkata'],
    );
    assert.equal(iso((await storedShift(client, id)).closed_at), '2026-12-31T18:30:00.000Z');
  });
});

test(
  'LIVE selected-day history returns over 100 events, canonical dates and exact timestamps without tenant/point leakage',
  LIVE,
  async () => {
    await withDatabase('2026-10-08T09:00:00.000Z', async ({ client, pool }) => {
      const owner = await seedTenant(client);
      const foreign = await seedTenant(client);
      const otherPoint = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO shifts (user_id, tenant_id, point_id, date, opened_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, '2026-10-05'::date, '2026-10-05T06:07:08.123Z'::timestamptz
       FROM generate_series(1, 105) RETURNING id`,
        [owner.userID, owner.tenantID, owner.pointId],
      );
      const outsidePoint = await seedShift(client, owner, '2026-10-05', '2026-10-05T08:00:00Z', {
        pointId: otherPoint,
      });
      const outsideTenant = await seedShift(client, foreign, '2026-10-05', '2026-10-05T08:00:00Z');
      await seedShift(client, owner, '2026-10-05', '2026-10-05T09:00:00Z', { userID: foreign.userID });
      await seedShift(client, owner, '2026-10-05', '2026-10-05T09:00:00Z', { pointId: null });
      await seedShift(client, owner, '2026-10-04', '2026-10-04T09:00:00Z');
      await seedShift(client, owner, '2026-10-06', '2026-10-06T09:00:00Z');
      const { service } = serviceWithoutPush(pool);
      const history = await service.getAll(owner.tenantID, owner.actor, '2026-10-05');
      assert.equal(history.length, 105);
      assert.deepEqual(
        history.map((shift) => shift.id),
        rows
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
      for (const shift of history) {
        assert.equal(shift.tenantId, owner.tenantID);
        assert.equal(shift.pointId, owner.pointId);
        assert.equal(shift.userId, owner.userID);
        assert.equal(shift.date, '2026-10-05');
        assert.equal(JSON.parse(JSON.stringify(shift)).date, '2026-10-05');
        assert.equal(iso(shift.openedAt), '2026-10-05T06:07:08.123Z');
        assert.equal(iso(shift.closedAt), '2026-10-05T21:00:00.000Z');
      }
      assert.equal(
        (await storedShift(client, outsidePoint)).closed_at,
        null,
        'read recovery stays in the session point',
      );
      assert.equal((await storedShift(client, outsideTenant)).closed_at, null);
      assert.equal((await service.getAll(owner.tenantID, owner.actor)).length, 100);
      assert.deepEqual(await service.getAll(owner.tenantID, owner.actor, '2026-10-03'), []);
      const single = await seedTenant(client);
      const singleId = await seedShift(client, single, '2026-10-05', '2026-10-05T06:00:00Z', { pointId: null });
      const singleHistory = await service.getAll(
        single.tenantID,
        { ...single.actor, currentPointId: null },
        '2026-10-05',
      );
      assert.deepEqual(
        singleHistory.map((shift) => shift.id),
        [singleId],
      );
    });
  },
);

test(
  'LIVE self/schedule recovery and manual-close retries use midnight without rewriting completed rows',
  LIVE,
  async () => {
    await withDatabase('2026-10-06T05:10:00.000Z', async ({ client, pool, clock }) => {
      const owner = await seedTenant(client);
      const foreign = await seedTenant(client);
      const otherUser = randomUUID();
      await client.query('INSERT INTO users (id, tenant_id) VALUES ($1, $2)', [otherUser, owner.tenantID]);
      const mine = await seedShift(client, owner, '2026-10-05', '2026-10-05T07:00:00Z');
      const colleague = await seedShift(client, owner, '2026-10-05', '2026-10-05T08:00:00Z', { userID: otherUser });
      const foreignId = await seedShift(client, foreign, '2026-10-05', '2026-10-05T08:00:00Z');
      const { service, notifications } = serviceWithoutPush(pool);
      const mineHistory = await service.getMy(owner.userID, owner.tenantID);
      assert.equal(iso(mineHistory[0].closedAt), '2026-10-05T21:00:00.000Z');
      assert.equal((await storedShift(client, colleague)).closed_at, null, 'self recovery does not close a colleague');
      assert.equal((await storedShift(client, foreignId)).closed_at, null);
      assert.deepEqual(await service.close(mine, owner.tenantID, owner.actor), { message: 'Смена не найдена' });
      assert.equal(iso((await storedShift(client, mine)).closed_at), '2026-10-05T21:00:00.000Z');

      const selfActor = { ...owner.actor, role: 'master', permissions: { schedule_manage: false } };
      assert.deepEqual(await service.close(colleague, owner.tenantID, selfActor), { message: 'Смена не найдена' });
      assert.deepEqual(await service.close(foreignId, owner.tenantID, owner.actor), { message: 'Смена не найдена' });
      const recovered = await service.close(colleague, owner.tenantID, owner.actor);
      assert.equal(iso(recovered.closedAt), '2026-10-05T21:00:00.000Z');
      assert.equal(recovered.isAutoClosed, true);
      assert.equal(notifications.length, 0, 'recovering yesterday is not a departure notification now');

      const current = await seedShift(client, owner, '2026-10-06', '2026-10-06T04:00:00Z');
      const manual = await service.close(current, owner.tenantID, selfActor);
      assert.equal(iso(manual.closedAt), clock.now);
      assert.equal(manual.isAutoClosed, false);
      assert.equal(notifications.length, 1);
      clock.now = '2026-10-06T06:00:00.000Z';
      await service.close(current, owner.tenantID, owner.actor);
      assert.equal(iso((await storedShift(client, current)).closed_at), '2026-10-06T05:10:00.000Z');
      assert.equal(notifications.length, 1);

      const forSchedule = await seedShift(client, owner, '2026-10-04', '2026-10-04T08:00:00Z');
      await new ScheduleService(pool).getToday(owner.tenantID, owner.actor);
      assert.equal(iso((await storedShift(client, forSchedule)).closed_at), '2026-10-04T21:00:00.000Z');
      assert.equal((await storedShift(client, foreignId)).closed_at, null);
    });
  },
);

test(
  'LIVE opening after a missed job closes yesterday at midnight and preserves closed same-day events',
  LIVE,
  async () => {
    const now = new Date();
    const today = zonedDateKey(now, 'Europe/Moscow');
    const yesterday = zonedDateKey(new Date(now.getTime() - 86_400_000), 'Europe/Moscow');
    const midnight = new Date(`${today}T00:00:00+03:00`).toISOString();
    await withDatabase(now.toISOString(), async ({ client, pool }) => {
      const owner = await seedTenant(client);
      const previousDay = await seedShift(client, owner, yesterday, `${yesterday}T08:00:00+03:00`);
      const earlierToday = await seedShift(client, owner, today, midnight, { closedAt: midnight });
      const completed = await seedShift(client, owner, yesterday, `${yesterday}T06:00:00+03:00`, {
        closedAt: `${yesterday}T18:00:00+03:00`,
      });
      const { service } = serviceWithoutPush(pool);
      const opened = await service.open(owner.userID, owner.tenantID, owner.actor);
      assert.equal(opened.closedAt, null);
      assert.equal(opened.pointId, owner.pointId);
      assert.equal(iso((await storedShift(client, previousDay)).closed_at), midnight);
      assert.equal(iso((await storedShift(client, earlierToday)).closed_at), midnight);
      assert.notEqual(opened.id, earlierToday);
      const preserved = await storedShift(client, completed);
      assert.equal(iso(preserved.closed_at), new Date(`${yesterday}T18:00:00+03:00`).toISOString());
      assert.equal(preserved.is_auto_closed, false);
    });
  },
);
