const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const Module = require('node:module');
const test = require('node:test');

// Optional replay of the accepted, uncommitted baseline without changing the checkout.
function serviceModule(relative) {
  const target = join(__dirname, '../dist', relative);
  if (!process.env.AUTO_SCHEDULE_BASELINE_DIR) return require(target);
  const compiled = new Module(target, module);
  compiled.filename = target;
  compiled.paths = Module._nodeModulePaths(dirname(target));
  compiled._compile(
    readFileSync(join(process.env.AUTO_SCHEDULE_BASELINE_DIR, 'backend/dist', relative), 'utf8'),
    target,
  );
  return compiled.exports;
}
const { ShiftsService } = serviceModule('shifts/shifts.service.js');
const { ScheduleService } = serviceModule('schedule/schedule.service.js');
const { EmployeesService } = require('../dist/employees/employees.service');
const { UsersService } = require('../dist/users/users.service');
const { classifyArrival, manualAttendance, hasRecordedAttendance } = require('../dist/shifts/attendance');
const { workModeFields } = require('../dist/schedule/work-mode');
const iso = (value) => (value == null ? null : new Date(value).toISOString());
const base = {
  shift_start: '09:00',
  shift_end: '18:00',
  is_day_off: false,
  note: '',
  late_status: null,
  late_minutes: 0,
  actual_arrival: null,
  is_manual_override: false,
};
const clock = { instant: new Date('2026-10-05T09:23:45.678Z'), today: '2026-10-05' };

test('arrival uses tenant local whole minutes, planned start and exact one-hour boundary', () => {
  for (const [time, status, minutes] of [
    ['08:59:59.999', 'on_time', 0],
    ['09:00:00.000', 'on_time', 0],
    ['09:00:59.999', 'on_time', 0],
    ['09:01:00.000', 'late_minor', 1],
    ['09:59:59.999', 'late_minor', 59],
    ['10:00:00.000', 'late_major', 60],
  ]) {
    assert.deepEqual(classifyArrival(new Date(`2026-10-05T${time}+03:00`), 'Europe/Moscow', undefined), {
      lateStatus: status,
      lateMinutes: minutes,
    });
  }
  assert.deepEqual(classifyArrival(new Date('2026-10-05T14:00:59.999+05:30'), 'Asia/Kolkata', '14:00'), {
    lateStatus: 'on_time',
    lateMinutes: 0,
  });
  assert.deepEqual(classifyArrival(new Date('2026-10-05T15:00:00+05:00'), 'Asia/Yekaterinburg', '14:00'), {
    lateStatus: 'late_major',
    lateMinutes: 60,
  });
  assert.equal(classifyArrival(new Date('2026-10-05T06:01:00Z'), 'Europe/Moscow', 'garbage').lateStatus, 'late_minor');
});

test('manual status normalizes old fields, uses real today arrival, and plan overrides remain unmarked', () => {
  const result = manualAttendance(
    { lateStatus: 'on_time', actualArrival: '2026-10-05T06:00:00Z', isManualOverride: false },
    { ...base, note: 'Прогул', late_minutes: 95, late_status: 'late_major' },
    clock.today,
    clock,
    'Europe/Moscow',
  );
  assert.equal(result.late_status, 'on_time');
  assert.equal(result.late_minutes, 0);
  assert.equal(result.note, '');
  assert.equal(iso(result.actual_arrival), iso(clock.instant));
  assert.equal(result.is_manual_override, true);
  const plan = manualAttendance(
    { shiftStart: '14:00', shiftEnd: '19:00' },
    undefined,
    clock.today,
    clock,
    'Europe/Moscow',
  );
  assert.equal(plan.is_manual_override, true);
  assert.equal(hasRecordedAttendance(plan), false);
  const prior = {
    ...base,
    actual_arrival: '2026-10-05T05:59:00.123Z',
    late_status: 'on_time',
    is_manual_override: true,
  };
  assert.equal(
    manualAttendance({ shiftStart: '14:00' }, prior, clock.today, clock, 'Europe/Moscow').actual_arrival,
    prior.actual_arrival,
  );
  assert.equal(
    manualAttendance({ lateStatus: 'late_major' }, prior, clock.today, clock, 'Europe/Moscow').actual_arrival,
    prior.actual_arrival,
  );
  for (const dto of [{ note: 'Прогул' }, { note: 'Больничный' }, { isDayOff: true }]) {
    const mark = manualAttendance(dto, prior, clock.today, clock, 'Europe/Moscow');
    assert.equal(mark.actual_arrival, null);
    assert.equal(mark.late_status, null);
    assert.equal(mark.late_minutes, 0);
    assert.equal(mark.is_manual_override, true);
  }
  assert.equal(
    manualAttendance({ isDayOff: true }, { ...prior, note: 'Прогул' }, clock.today, clock, 'Europe/Moscow').note,
    '',
  );
  assert.equal(
    manualAttendance(
      { lateStatus: 'late_minor', actualArrival: '2026-10-06T06:15:00Z' },
      undefined,
      '2026-10-06',
      clock,
      'Europe/Moscow',
    ).actual_arrival,
    null,
  );
});

test('work mode validates complete weekday pairs and preserves omitted/legacy fields', () => {
  const previous = {
    name: 'Old',
    type: 'weekly',
    work_days: 2,
    off_days: 2,
    week_days: [],
    shift_start: '20:00',
    shift_end: '08:00',
    day_times: { 3: { shiftStart: '14:00', shiftEnd: '18:00' } },
  };
  assert.deepEqual(workModeFields({ name: 'Renamed' }, previous).day_times, previous.day_times);
  assert.deepEqual(workModeFields({ dayTimes: {} }, previous).day_times, {});
  assert.equal(workModeFields({ shiftStart: '20:00', shiftEnd: '08:00' }, previous).shift_end, '08:00');
  for (const dto of [
    { name: 'x', type: 'weekly' },
    { weekDays: [7] },
    { weekDays: ['3'] },
    { dayTimes: null },
    { dayTimes: [] },
    { dayTimes: { 7: { shiftStart: '09:00', shiftEnd: '18:00' } } },
    { dayTimes: { 3: { shiftStart: '14:00' } } },
    { dayTimes: { 3: { shiftStart: '24:00', shiftEnd: '18:00' } } },
    { shiftStart: '9:00' },
  ]) {
    assert.throws(
      () => workModeFields(dto, dto.name ? undefined : previous),
      (error) => error.getStatus() === 400,
    );
  }
});

test('legacy weekly empty full-form edits preserve all-days semantics without allowing new empty modes', () => {
  const previous = {
    name: 'Legacy',
    type: 'weekly',
    work_days: 2,
    off_days: 2,
    week_days: [],
    shift_start: '09:00',
    shift_end: '18:00',
    day_times: {},
  };
  const edited = workModeFields(
    { name: 'Renamed', type: 'weekly', weekDays: [], shiftStart: '14:00', shiftEnd: '20:00' },
    previous,
  );
  assert.equal(edited.name, 'Renamed');
  assert.equal(edited.shift_start, '14:00');
  assert.deepEqual(edited.week_days, []);
  for (const prior of [undefined, { ...previous, week_days: [1, 2] }, { ...previous, type: 'rotating' }]) {
    assert.throws(
      () => workModeFields({ name: 'Invalid', type: 'weekly', weekDays: [] }, prior),
      (error) => error.getStatus() === 400,
    );
  }
});

test('blank planned days do not count as absence or interrupt discipline; explicit absence does', async () => {
  const service = new ScheduleService({ query: async () => ({ rows: [{ shift_statuses: ['absent'] }] }) });
  assert.equal((await service.buildShiftFilter(randomUUID())).sql, "((note = 'Прогул'))");
  let rows = [
    { ...base, shift_start: '14:00' },
    { ...base, late_status: 'late_minor' },
    { ...base, late_status: 'on_time' },
  ];
  const employees = new EmployeesService(
    {
      query: async (sql) => ({
        rows: sql.includes('SELECT timezone')
          ? [{ timezone: 'Asia/Vladivostok' }]
          : sql.includes('FROM schedule_entries')
            ? rows
            : [],
      }),
    },
    {},
  );
  assert.equal((await employees.computeStreaks(randomUUID(), randomUUID(), null)).disciplineStreak, 2);
  for (const [middle, expected] of [
    [{ late_minutes: 59 }, 3],
    [{ late_minutes: 60 }, 1],
    [{ late_minutes: 90 }, 1],
    [{ late_minutes: 90, late_status: 'on_time' }, 3],
    [{ late_minutes: 90, late_status: 'late_minor' }, 3],
    [{ late_minutes: 90, is_day_off: true }, 3],
    [{ late_minutes: 90, note: 'Больничный' }, 3],
  ]) {
    rows = [{ ...base, late_status: 'on_time' }, { ...base, ...middle }, { ...base, late_status: 'on_time' }];
    assert.equal(
      (await employees.computeStreaks(randomUUID(), randomUUID(), null)).disciplineStreak,
      expected,
      JSON.stringify(middle),
    );
  }
  rows = [{ ...base, actual_arrival: clock.instant, late_status: 'on_time', note: 'Прогул' }];
  assert.equal((await employees.computeStreaks(randomUUID(), randomUUID(), null)).disciplineStreak, 0);
});

const LIVE = { skip: !process.env.SHIFTS_LIVE_DB && 'Set SHIFTS_LIVE_DB to an isolated local PostgreSQL fixture' };
async function withDatabase(now, run) {
  const url = new URL(process.env.SHIFTS_LIVE_DB);
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Fixture must be local; DATABASE_URL is never consulted',
  );
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: url.toString() });
  const schema = `auto_schedule_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const native = new Pool({ connectionString: url.toString(), options: `-c search_path=${schema},pg_catalog`, max: 8 });
  const clock = { now };
  const faults = { before: null };
  const execute = async (client, sql, params = []) => {
    if (faults.before) await faults.before(sql, params);
    if (/\b(?:now|clock_timestamp)\(\)/i.test(sql))
      return client.query(sql.replace(/\b(?:now|clock_timestamp)\(\)/gi, `$${params.length + 1}::timestamptz`), [
        ...params,
        clock.now,
      ]);
    return client.query(sql, params);
  };
  const pool = {
    query: (sql, params) => execute(native, sql, params),
    connect: async () => {
      const client = await native.connect();
      return { query: (sql, params) => execute(client, sql, params), release: () => client.release() };
    },
  };
  try {
    await native.query(`
      CREATE TABLE tenants (id uuid PRIMARY KEY, timezone text, shifts_enabled boolean DEFAULT true, attendance_mode text DEFAULT 'manual');
      CREATE TABLE users (id uuid PRIMARY KEY, tenant_id uuid, full_name text DEFAULT 'Мастер', role text DEFAULT 'master', avatar text,
        is_active boolean DEFAULT true, dismissed_at timestamptz, purged_at timestamptz, hidden_from_schedule boolean DEFAULT false,
        hidden_everywhere boolean DEFAULT false, days_off jsonb DEFAULT '[]', permissions jsonb DEFAULT '{}', salary_percent numeric DEFAULT 0,
        product_salary_percent numeric DEFAULT 0, phone text, username text, sort_order integer DEFAULT 0, team text,
        can_add_expenses boolean DEFAULT false, daily_expense_limit numeric, role_id uuid, direction_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE employee_directions (id uuid PRIMARY KEY, tenant_id uuid, name text);
      CREATE TABLE shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tenant_id uuid, point_id uuid, date date,
        opened_at timestamptz DEFAULT now(), closed_at timestamptz, is_auto_closed boolean DEFAULT false, note text);
      CREATE TABLE schedule_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tenant_id uuid, point_id uuid, date date,
        shift_start text, shift_end text, is_day_off boolean DEFAULT false, actual_arrival timestamptz, late_minutes integer DEFAULT 0,
        late_status text, note text, is_manual_override boolean DEFAULT false, UNIQUE(tenant_id,user_id,date));
      CREATE TABLE work_modes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, type text,
        work_days integer, off_days integer, week_days jsonb DEFAULT '[]', shift_start text, shift_end text);
      CREATE TABLE user_points (user_id uuid, tenant_id uuid, point_id uuid);
    `);
    const migration = readFileSync(join(__dirname, '../migrations/176_work_mode_day_times.sql'), 'utf8');
    await native.query(migration);
    await native.query(migration);
    const seed = async (timezone = 'Europe/Moscow') => {
      const userID = randomUUID(),
        tenantID = randomUUID(),
        pointId = randomUUID();
      await native.query('INSERT INTO tenants(id,timezone) VALUES ($1,$2)', [tenantID, timezone]);
      await native.query('INSERT INTO users(id,tenant_id) VALUES ($1,$2)', [userID, tenantID]);
      const actor = { userID, tenantID, currentPointId: pointId, role: 'director', permissions: {} };
      return { userID, tenantID, pointId, actor };
    };
    const shifts = new ShiftsService(pool, {}),
      schedule = new ScheduleService(pool);
    const pushes = [];
    shifts.fireAttendancePush = async (...args) => pushes.push(args);
    const entry = async (person, date = '2026-10-05') =>
      (
        await native.query(
          'SELECT *, date::text AS date FROM schedule_entries WHERE tenant_id=$1 AND user_id=$2 AND date=$3',
          [person.tenantID, person.userID, date],
        )
      ).rows[0];
    await run({ pool, native, clock, faults, seed, shifts, schedule, pushes, entry });
  } finally {
    await native.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test(
  'LIVE opening creates attendance at the exact server instant; repeat/reopen retains first arrival',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T06:00:59.999Z', async ({ native, clock, seed, shifts, pushes, entry }) => {
      const person = await seed();
      const opened = await shifts.open(person.userID, person.tenantID, person.actor);
      const first = await entry(person);
      assert.ok(first, 'Opening without a preplanned calendar row must create attendance');
      assert.equal(iso(opened.openedAt), clock.now);
      assert.equal(first.date, '2026-10-05');
      assert.equal(first.late_status, 'on_time');
      assert.equal(iso(first.actual_arrival), clock.now);
      const again = await shifts.open(person.userID, person.tenantID, person.actor);
      assert.equal(again.id, opened.id);
      assert.equal(pushes.length, 1);
      clock.now = '2026-10-05T10:00:00.123Z';
      await shifts.close(opened.id, person.tenantID, person.actor);
      const reopened = await shifts.open(person.userID, person.tenantID, person.actor);
      assert.notEqual(reopened.id, opened.id);
      assert.deepEqual(await entry(person), first);
      assert.equal((await native.query('SELECT count(*)::int AS n FROM shifts')).rows[0].n, 2);
    });
  },
);

test(
  'LIVE planned 14:00 uses tenant timezone and legacy attendance/manual nonwork marks survive opening',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T09:01:00.123Z', async ({ native, seed, shifts, schedule, entry }) => {
      const person = await seed('Asia/Yekaterinburg');
      const plan = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-05', shiftStart: '14:00', shiftEnd: '20:00' },
        person.actor,
      );
      assert.equal(plan.isManualOverride, true);
      assert.equal(plan.actualArrival, null);
      assert.equal((await native.query('SELECT count(*)::int AS n FROM shifts')).rows[0].n, 0);
      await shifts.open(person.userID, person.tenantID, person.actor);
      const attended = await entry(person);
      assert.equal(attended.late_status, 'late_minor');
      assert.equal(attended.late_minutes, 1);
      for (const fields of [
        "late_status='on_time', actual_arrival='2026-10-05T07:00:00.123Z', is_manual_override=false",
        "late_status=NULL, actual_arrival=NULL, note='Прогул', is_manual_override=false",
        'late_status=NULL, actual_arrival=NULL, note=NULL, late_minutes=30, is_manual_override=false',
      ]) {
        await native.query('UPDATE shifts SET closed_at=opened_at');
        await native.query(`UPDATE schedule_entries SET ${fields} WHERE id=$1`, [plan.id]);
        const prior = await entry(person);
        await shifts.open(person.userID, person.tenantID, person.actor);
        assert.deepEqual(await entry(person), prior);
      }
    });
  },
);

test(
  'LIVE manual today opens atomically, reopens closed history, preserves arrival and selected status',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T09:23:45.678Z', async ({ native, clock, seed, shifts, schedule, entry, faults }) => {
      const person = await seed();
      const saved = await schedule.create(
        person.tenantID,
        {
          userId: person.userID,
          date: '2026-10-05',
          lateStatus: 'on_time',
          lateMinutes: 90,
          actualArrival: '2026-10-05T06:00:00Z',
          isManualOverride: false,
        },
        person.actor,
      );
      assert.equal(saved.lateStatus, 'on_time');
      assert.equal(saved.lateMinutes, 0);
      assert.equal(iso(saved.actualArrival), clock.now);
      assert.equal(saved.isManualOverride, true);
      let rows = (await native.query('SELECT * FROM shifts')).rows;
      assert.equal(rows.length, 1);
      assert.equal(iso(rows[0].opened_at), clock.now);
      await shifts.close(rows[0].id, person.tenantID, person.actor);
      clock.now = '2026-10-05T10:00:00.987Z';
      const marked = await schedule.update(saved.id, person.tenantID, { lateStatus: 'late_minor' }, person.actor);
      rows = (await native.query('SELECT * FROM shifts ORDER BY opened_at')).rows;
      assert.equal(rows.length, 2);
      assert.equal(iso(rows[0].closed_at), '2026-10-05T09:23:45.678Z');
      assert.equal(iso(rows[1].opened_at), clock.now);
      assert.equal(marked.lateStatus, 'late_minor');
      assert.equal(iso(marked.actualArrival), '2026-10-05T09:23:45.678Z');
      await shifts.open(person.userID, person.tenantID, person.actor);
      assert.equal((await entry(person)).late_status, 'late_minor');
      const before = await entry(person);
      await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-05', shiftStart: '14:00' },
        person.actor,
      );
      const planned = await entry(person);
      assert.equal(iso(planned.actual_arrival), iso(before.actual_arrival));
      assert.equal(planned.late_status, before.late_status);
      const other = await seed();
      faults.before = (sql) => {
        if (/INSERT INTO shifts/.test(sql)) throw new Error('simulated insert failure');
      };
      await assert.rejects(
        schedule.create(
          other.tenantID,
          { userId: other.userID, date: '2026-10-05', lateStatus: 'on_time' },
          other.actor,
        ),
        /simulated insert failure/,
      );
      faults.before = null;
      assert.equal(await entry(other), undefined);
    });
  },
);

test(
  'LIVE nonworking/past/future calendar marks do not open shifts; changing status never closes an active shift',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T09:00:00.123Z', async ({ native, seed, schedule }) => {
      for (const dto of [
        { date: '2026-10-05', note: 'Прогул' },
        { date: '2026-10-05', note: 'Больничный' },
        { date: '2026-10-05', isDayOff: true },
        { date: '2026-10-04', lateStatus: 'on_time', actualArrival: '2026-10-04T06:01:02.345Z' },
        { date: '2026-10-06', lateStatus: 'late_major', actualArrival: '2026-10-06T07:00:00Z' },
      ]) {
        const person = await seed();
        const mark = await schedule.create(person.tenantID, { userId: person.userID, ...dto }, person.actor);
        if (dto.date === '2026-10-04') assert.equal(iso(mark.actualArrival), dto.actualArrival);
        if (dto.date === '2026-10-06') assert.equal(mark.actualArrival, null);
      }
      assert.equal((await native.query('SELECT count(*)::int AS n FROM shifts')).rows[0].n, 0);
      const person = await seed();
      const mark = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-05', lateStatus: 'on_time' },
        person.actor,
      );
      await schedule.update(mark.id, person.tenantID, { note: 'Прогул' }, person.actor);
      assert.equal((await native.query('SELECT closed_at FROM shifts')).rows[0].closed_at, null);
    });
  },
);

test(
  'LIVE concurrent self/manual opening produces one event and manual wins; clock is captured after lock',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T06:30:00.456Z', async ({ native, clock, faults, seed, shifts, schedule, entry }) => {
      const person = await seed();
      await Promise.all([
        shifts.open(person.userID, person.tenantID, person.actor),
        schedule.create(
          person.tenantID,
          { userId: person.userID, date: '2026-10-05', lateStatus: 'on_time' },
          person.actor,
        ),
        shifts.open(person.userID, person.tenantID, person.actor),
      ]);
      assert.equal((await native.query('SELECT count(*)::int AS n FROM shifts')).rows[0].n, 1);
      assert.equal((await entry(person)).late_status, 'on_time');
      const second = await seed();
      const blocker = await native.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [second.userID]);
      let signal;
      const started = new Promise((resolve) => {
        signal = resolve;
      });
      faults.before = (sql, params) => {
        if (/FROM users .*FOR UPDATE/.test(sql) && params[0] === second.userID) signal();
      };
      const pending = shifts.open(second.userID, second.tenantID, second.actor);
      await started;
      clock.now = '2026-10-05T21:00:00.789Z';
      await blocker.query('COMMIT');
      blocker.release();
      const result = await pending;
      faults.before = null;
      assert.equal(iso(result.openedAt), clock.now);
      assert.equal((await entry(second, '2026-10-06')).date, '2026-10-06');
    });
  },
);

test(
  'LIVE cross-point automatic conflict rolls back; manual transfer preserves old history and rejects foreign updates',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T06:00:00.123Z', async ({ native, clock, seed, shifts, schedule, entry }) => {
      const person = await seed(),
        other = await seed();
      const original = await shifts.open(person.userID, person.tenantID, person.actor);
      const before = await entry(person);
      const pointB = randomUUID();
      const actorB = { ...person.actor, currentPointId: pointB };
      await assert.rejects(shifts.open(person.userID, person.tenantID, actorB), (error) => error.getStatus() === 409);
      assert.deepEqual(await entry(person), before);
      await assert.rejects(
        schedule.update(before.id, person.tenantID, { lateStatus: 'on_time' }, actorB),
        (error) => error.getStatus() === 404,
      );
      await assert.rejects(
        schedule.create(
          person.tenantID,
          { userId: other.userID, date: '2026-10-05', lateStatus: 'on_time' },
          person.actor,
        ),
        (error) => error.getStatus() === 400,
      );
      clock.now = '2026-10-05T07:00:00.456Z';
      const transferred = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-05', lateStatus: 'on_time' },
        actorB,
      );
      assert.equal(transferred.pointId, pointB);
      assert.equal(iso(transferred.actualArrival), iso(original.openedAt));
      const rows = (await native.query('SELECT * FROM shifts ORDER BY opened_at')).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows[0].point_id, person.pointId);
      assert.equal(iso(rows[0].closed_at), clock.now);
      assert.equal(rows[1].point_id, pointB);
      assert.equal(rows[1].closed_at, null);
    });
  },
);

test(
  'LIVE weekly overrides apply by canonical weekday, preserve explicit plans/status and tenant-local today',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T22:30:00.000Z', async ({ native, seed, schedule, entry }) => {
      const person = await seed('Europe/Moscow'); // Tenant today is October6 although UTC date is October5.
      await native.query('UPDATE users SET days_off=$1::jsonb WHERE id=$2', [JSON.stringify([4]), person.userID]); // Thursday
      const mode = await schedule.createWorkMode(person.tenantID, {
        name: 'Weekly',
        type: 'weekly',
        weekDays: [1, 2, 3, 4, 5],
        shiftStart: '09:00',
        shiftEnd: '18:00',
        dayTimes: { 3: { shiftStart: '14:00', shiftEnd: '20:00' }, 4: { shiftStart: '15:00', shiftEnd: '19:00' } },
      });
      const manual = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-09', shiftStart: '15:00', shiftEnd: '19:00' },
        person.actor,
      );
      const mark = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-12', lateStatus: 'on_time' },
        person.actor,
      );
      await schedule.applyWorkMode(
        person.tenantID,
        { workModeId: mode.id, userId: person.userID, dateFrom: '2026-10-06', dateTo: '2026-10-12' },
        person.actor,
      );
      assert.equal(await entry(person, '2026-10-06'), undefined);
      assert.equal((await entry(person, '2026-10-07')).shift_start, '14:00');
      assert.equal((await entry(person, '2026-10-08')).is_day_off, true);
      assert.equal((await entry(person, '2026-10-08')).shift_start, null);
      assert.equal((await entry(person, '2026-10-10')).is_day_off, true);
      assert.equal((await entry(person, '2026-10-09')).id, manual.id);
      assert.equal((await entry(person, '2026-10-09')).shift_start, '15:00');
      assert.equal((await entry(person, '2026-10-12')).id, mark.id);
      assert.equal((await entry(person, '2026-10-12')).late_status, 'on_time');
      const updated = await schedule.updateWorkMode(mode.id, person.tenantID, { name: 'Renamed' });
      assert.deepEqual(updated.dayTimes, mode.dayTimes);
      await assert.rejects(
        schedule.updateWorkMode(mode.id, person.tenantID, {
          name: 'Bad',
          dayTimes: { 3: { shiftStart: '99:00', shiftEnd: '18:00' } },
        }),
        (error) => error.getStatus() === 400,
      );
      assert.equal((await schedule.getWorkModes(person.tenantID))[0].name, 'Renamed');
      assert.deepEqual((await schedule.updateWorkMode(mode.id, person.tenantID, { dayTimes: {} })).dayTimes, {});
    });
  },
);

test(
  'LIVE profile daysOff preserves today, individual future plans and attendance, and keeps base times',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T06:00:00.000Z', async ({ pool, native, seed, schedule, entry }) => {
      const person = await seed();
      const manual = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-06', shiftStart: '14:00', shiftEnd: '20:00' },
        person.actor,
      );
      await native.query(
        `INSERT INTO schedule_entries (user_id,tenant_id,point_id,date,shift_start,shift_end) VALUES ($1,$2,$3,'2026-10-05','14:00','20:00'),($1,$2,$3,'2026-10-07','14:00','20:00'),($1,$2,$3,'2026-10-08','14:00','20:00')`,
        [person.userID, person.tenantID, person.pointId],
      );
      const users = new UsersService(pool, {});
      await users.update(person.userID, person.tenantID, 'director', randomUUID(), { daysOff: [1, 2, 3] });
      assert.equal((await entry(person)).is_day_off, false);
      assert.equal((await entry(person, '2026-10-06')).id, manual.id);
      assert.equal((await entry(person, '2026-10-06')).shift_start, '14:00');
      assert.equal((await entry(person, '2026-10-07')).is_day_off, true);
      assert.equal((await entry(person, '2026-10-08')).shift_start, '14:00');
    });
  },
);

test(
  'LIVE legacy active same-point shift repairs missing calendar from the original opening without another push',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T10:30:00.789Z', async ({ native, seed, shifts, entry, pushes, clock }) => {
      const person = await seed();
      const original = '2026-10-05T06:00:59.999Z';
      const { rows } = await native.query(
        `INSERT INTO shifts (user_id, tenant_id, point_id, date, opened_at) VALUES ($1,$2,$3,'2026-10-05',$4) RETURNING *`,
        [person.userID, person.tenantID, person.pointId, original],
      );
      const returned = await shifts.open(person.userID, person.tenantID, person.actor);
      const repaired = await entry(person);
      assert.ok(repaired, 'Existing active event must fill its missing attendance');
      assert.equal(returned.id, rows[0].id);
      assert.equal(iso(returned.openedAt), original);
      assert.equal(iso(repaired.actual_arrival), original);
      assert.equal(repaired.late_status, 'on_time');
      assert.equal(repaired.late_minutes, 0);
      assert.equal(pushes.length, 0);
      clock.now = '2026-10-05T12:00:00.123Z';
      assert.equal((await shifts.open(person.userID, person.tenantID, person.actor)).id, rows[0].id);
      assert.deepEqual(await entry(person), repaired);
      assert.deepEqual((await native.query('SELECT * FROM shifts')).rows, rows);
      assert.equal(pushes.length, 0);
    });
  },
);

test(
  'LIVE legacy active same-point shift fills blank14 plan using opening minute rather than retry minute',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T13:15:00.123Z', async ({ native, seed, shifts, schedule, entry, pushes }) => {
      const person = await seed();
      const plan = await schedule.create(
        person.tenantID,
        { userId: person.userID, date: '2026-10-05', shiftStart: '14:00', shiftEnd: '20:00' },
        person.actor,
      );
      const original = '2026-10-05T11:00:59.999Z';
      const { rows } = await native.query(
        `INSERT INTO shifts (user_id, tenant_id, point_id, date, opened_at) VALUES ($1,$2,$3,'2026-10-05',$4) RETURNING *`,
        [person.userID, person.tenantID, person.pointId, original],
      );
      const returned = await shifts.open(person.userID, person.tenantID, person.actor);
      const repaired = await entry(person);
      assert.equal(returned.id, rows[0].id);
      assert.equal(repaired.id, plan.id);
      assert.equal(iso(repaired.actual_arrival), original);
      assert.equal(repaired.late_status, 'on_time');
      assert.equal(repaired.late_minutes, 0);
      assert.equal(repaired.shift_start, '14:00');
      assert.equal(repaired.shift_end, '20:00');
      assert.equal(repaired.is_manual_override, true);
      assert.deepEqual((await native.query('SELECT * FROM shifts')).rows, rows);
      assert.equal(pushes.length, 0);
    });
  },
);

test(
  'LIVE legacy active other-point shift rejects automatic opening with missing or misleading calendar and rolls back recovery',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T12:00:00.123Z', async ({ native, seed, shifts, schedule, entry, pushes }) => {
      for (const situation of ['no calendar', 'blank same-point calendar', 'same-point active also exists']) {
        const person = await seed();
        const actorB = { ...person.actor, currentPointId: randomUUID() };
        if (situation !== 'no calendar') {
          await schedule.create(
            person.tenantID,
            { userId: person.userID, date: '2026-10-05', shiftStart: '14:00', shiftEnd: '20:00' },
            actorB,
          );
        }
        await native.query(
          `INSERT INTO shifts (user_id, tenant_id, point_id, date, opened_at) VALUES
        ($1,$2,$3,'2026-10-04','2026-10-04T06:00:00Z'), ($1,$2,$3,'2026-10-05','2026-10-05T06:00:00Z')`,
          [person.userID, person.tenantID, person.pointId],
        );
        if (situation === 'same-point active also exists') {
          await native.query(
            `INSERT INTO shifts (user_id, tenant_id, point_id, date, opened_at) VALUES ($1,$2,$3,'2026-10-05','2026-10-05T05:00:00Z')`,
            [person.userID, person.tenantID, actorB.currentPointId],
          );
        }
        const beforeShifts = (
          await native.query('SELECT * FROM shifts WHERE tenant_id=$1 ORDER BY id', [person.tenantID])
        ).rows;
        const beforeEntry = await entry(person);
        await assert.rejects(
          shifts.open(person.userID, person.tenantID, actorB),
          (error) => error.getStatus() === 409,
          situation,
        );
        assert.deepEqual(
          (await native.query('SELECT * FROM shifts WHERE tenant_id=$1 ORDER BY id', [person.tenantID])).rows,
          beforeShifts,
        );
        assert.deepEqual(await entry(person), beforeEntry);
        assert.equal(pushes.length, 0);
      }
    });
  },
);

test(
  'LIVE legacy weekly empty full-form PATCH keeps all days, and invalid empty replacements are atomic',
  LIVE,
  async () => {
    await withDatabase('2026-10-05T06:00:00.123Z', async ({ native, seed, schedule, entry }) => {
      const person = await seed();
      const { rows } = await native.query(
        `INSERT INTO work_modes (tenant_id, name, type, week_days, shift_start, shift_end, day_times)
      VALUES ($1,'Legacy','weekly','[]','09:00','18:00','{"3":{"shiftStart":"14:00","shiftEnd":"20:00"}}') RETURNING id`,
        [person.tenantID],
      );
      const edited = await schedule.updateWorkMode(rows[0].id, person.tenantID, {
        name: 'Renamed',
        type: 'weekly',
        weekDays: [],
        shiftStart: '10:00',
        shiftEnd: '19:00',
      });
      assert.equal(edited.name, 'Renamed');
      assert.deepEqual(edited.weekDays, []);
      assert.equal(edited.dayTimes[3].shiftStart, '14:00');
      await schedule.applyWorkMode(
        person.tenantID,
        { workModeId: edited.id, userId: person.userID, dateFrom: '2026-10-07', dateTo: '2026-10-11' },
        person.actor,
      );
      assert.equal((await entry(person, '2026-10-07')).shift_start, '14:00');
      assert.equal((await entry(person, '2026-10-11')).shift_start, '10:00');
      assert.equal((await entry(person, '2026-10-11')).is_day_off, false);
      const selected = await schedule.updateWorkMode(edited.id, person.tenantID, { weekDays: [1, 2, 3] });
      await assert.rejects(
        schedule.updateWorkMode(edited.id, person.tenantID, { name: 'Invalid', type: 'weekly', weekDays: [] }),
        (error) => error.getStatus() === 400,
      );
      assert.deepEqual((await schedule.getWorkModes(person.tenantID))[0], selected);
      await assert.rejects(
        schedule.createWorkMode(person.tenantID, { name: 'Invalid new', type: 'weekly', weekDays: [] }),
        (error) => error.getStatus() === 400,
      );
      assert.equal((await schedule.getWorkModes(person.tenantID)).length, 1);
    });
  },
);
