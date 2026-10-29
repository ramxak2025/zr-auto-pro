// Explicit disposable PostgreSQL16 only; never reads .env or DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { OwnerHomeService } = require('../dist/reports/owner-home/owner-home.service');
const { ReportsService } = require('../dist/reports/reports.service');
const { visitQuery } = require('../dist/reports/owner-home/owner-home-visits');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
Logger.overrideLogger(false);
const live = process.env.OCT29_OWNER_HOME_TEST_DB;
const ciFixture = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
const appPassword = process.env.OCT29_OWNER_HOME_APP_PASSWORD;
const opts = { skip: !live, timeout: 60000 };
const bad = (code) => (e) => e.getStatus?.() === code;

async function fixture(fn) {
  const url = new URL(live);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  // Query parameters can override pg host/database fields; accept only the
  // literal disposable destinations below, never alternate connection options.
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  if (ciFixture) {
    assert.equal(url.port, '55438');
    assert.equal(url.pathname, '/autexa_oct8_test');
    assert.equal(url.username, 'oct8_fixture');
    assert.ok(appPassword, 'CI fixture app password is required');
  } else {
    assert.equal(url.port, '55457');
    assert.equal(url.pathname, '/autexa_oct29_owner');
    assert.equal(url.username, 'oct29_owner_admin');
  }
  const admin = new Pool({ connectionString: live });
  assert.match((await admin.query('SHOW server_version')).rows[0].server_version, /^16\./);
  const schema = `owner_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({ connectionString: live, options: `-c search_path=${schema},pg_catalog` });
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  // CI app credentials differ from the fixture administrator. A local fixture
  // may retain its own trust/same-password configuration when no override is set.
  if (appPassword !== undefined) appUrl.password = appPassword;
  const app = new Pool({ connectionString: appUrl.toString(), options: `-c search_path=${schema},pg_catalog` });
  const scoped = new TenantAwarePool(db, app),
    service = new OwnerHomeService(scoped),
    legacy = new ReportsService(scoped);
  const q = (sql, params = []) => db.query(sql, params);
  const tenant = randomUUID(),
    foreign = randomUUID(),
    point = randomUUID(),
    otherPoint = randomUUID();
  let now = '2026-10-29T09:00:00.000Z';
  const RealDate = Date;
  const clock = (value) => {
    now = value;
    global.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
      static now() {
        return new RealDate(now).getTime();
      }
    };
  };
  try {
    await q(`
      CREATE TABLE tenants(id uuid PRIMARY KEY,timezone text,points_shared_clients boolean DEFAULT true);
      CREATE TABLE tenant_points(id uuid PRIMARY KEY,tenant_id uuid,name text,is_main boolean DEFAULT false);
      CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid);
      CREATE TABLE user_points(user_id uuid,tenant_id uuid,point_id uuid);
      CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,point_id uuid,full_name text,phone text,is_retail boolean DEFAULT false,created_at timestamptz);
      CREATE TABLE cars(id uuid PRIMARY KEY,tenant_id uuid,client_id uuid,plate_number text,make_model text);
      CREATE TABLE checks(id uuid PRIMARY KEY,number serial,tenant_id uuid,point_id uuid,client_id uuid,car_id uuid,date timestamptz,created_at timestamptz DEFAULT now(),
        is_deferred boolean DEFAULT false,deleted_at timestamptz,payment_method text DEFAULT 'cash',total_revenue numeric DEFAULT 0,profit numeric DEFAULT 0,
        cash_amount numeric DEFAULT 0,card_amount numeric DEFAULT 0,product_cost_total numeric DEFAULT 0,service_salary_total numeric DEFAULT 0,product_salary_total numeric DEFAULT 0,
        is_returned boolean DEFAULT false,return_scope text);
      CREATE TABLE check_service_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),check_id uuid,name text,quantity numeric DEFAULT 1);
      CREATE TABLE expense_categories(id uuid PRIMARY KEY,tenant_id uuid,name text,is_recurring boolean DEFAULT false);
      CREATE TABLE expenses(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,point_id uuid,category_id uuid,date timestamptz,amount numeric,period_month text,approval_status text);
      CREATE TABLE salary_premiums(tenant_id uuid,point_id uuid,type text,amount numeric,period_month_year text,created_at timestamptz);
      CREATE TABLE motivation_accruals(tenant_id uuid,check_id uuid,amount numeric,accrued_at timestamptz,scheme text);
      CREATE TABLE fixed_costs(id uuid PRIMARY KEY,tenant_id uuid,point_id uuid,mode text DEFAULT 'monthly',monthly_amount numeric DEFAULT 0,active boolean DEFAULT true);
      CREATE TABLE fixed_cost_vehicle_history(tenant_id uuid,fixed_cost_id uuid,effective_from date,revision int,amount numeric,active boolean,archived boolean DEFAULT false);
      CREATE TABLE employee_compensation(tenant_id uuid,user_id uuid,type text,amount numeric,active boolean DEFAULT true);
      CREATE TABLE installment_plans(id uuid,tenant_id uuid,check_id uuid);
      CREATE TABLE installment_payments(tenant_id uuid,plan_id uuid,amount numeric,payment_method text,paid_at timestamptz);
      CREATE INDEX checks_client_date ON checks(client_id,date DESC);
      CREATE INDEX checks_car_date ON checks(car_id,date DESC);
      CREATE INDEX checks_tenant_point_money_date ON checks(tenant_id,point_id,date) WHERE is_deferred=false AND deleted_at IS NULL;
      CREATE INDEX checks_vehicle_days_idx ON checks(tenant_id,date,car_id) WHERE is_deferred=false AND deleted_at IS NULL AND client_id IS NOT NULL AND car_id IS NOT NULL;
      CREATE INDEX vehicle_history_idx ON fixed_cost_vehicle_history(tenant_id,fixed_cost_id,effective_from DESC,revision DESC);
      CREATE INDEX check_services_idx ON check_service_lines(check_id);
    `);
    const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, [schema])).rows.map(
      (r) => r.tablename,
    );
    for (const table of tables) {
      const policy =
        table === 'tenants'
          ? `id=NULLIF(current_setting('app.tenant_id',true),'')::uuid`
          : table === 'check_service_lines'
            ? `EXISTS(SELECT 1 FROM checks c WHERE c.id=check_id AND c.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)`
            : `tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid`;
      await q(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table} USING(${policy}) WITH CHECK(${policy});`);
    }
    await q(
      `GRANT USAGE ON SCHEMA ${schema} TO autexa_app; GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO autexa_app;`,
    );
    await q('INSERT INTO tenants(id,timezone) VALUES($1,$3),($2,$3)', [tenant, foreign, 'Europe/Moscow']);
    await q("INSERT INTO tenant_points VALUES($1,$3,'Main',true),($2,$3,'Other',false)", [point, otherPoint, tenant]);
    clock(now);
    const client = async ({
      tid = tenant,
      p = point,
      created = '2020-01-01T00:00Z',
      retail = false,
      name = 'Client',
    } = {}) => {
      const id = randomUUID();
      await q("INSERT INTO clients VALUES($1,$2,$3,$4,'',$5,$6)", [id, tid, p, name, retail, created]);
      return id;
    };
    const car = async (cid, { tid = tenant, plate = 'A111AA', name = 'Car' } = {}) => {
      const id = randomUUID();
      await q('INSERT INTO cars VALUES($1,$2,$3,$4,$5)', [id, tid, cid, plate, name]);
      return id;
    };
    const check = async ({
      cid = null,
      carId = null,
      tid = tenant,
      p = point,
      date = now,
      revenue = 0,
      profit = 0,
      deferred = false,
      deleted = null,
      payment = 'cash',
      returned = false,
      cost = 0,
      salary = 0,
      productSalary = 0,
    } = {}) => {
      const id = randomUUID();
      await q(
        `INSERT INTO checks(id,tenant_id,point_id,client_id,car_id,date,total_revenue,profit,is_deferred,deleted_at,payment_method,is_returned,product_cost_total,service_salary_total,product_salary_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          tid,
          p,
          cid,
          carId,
          date,
          revenue,
          profit,
          deferred,
          deleted,
          payment,
          returned,
          cost,
          salary,
          productSalary,
        ],
      );
      return id;
    };
    const run = (fn) => runWithTenant(tenant, fn);
    const profit = (day) => run(() => service.profit(tenant, point, day));
    await fn({
      q,
      client,
      car,
      check,
      run,
      profit,
      service,
      legacy,
      scoped,
      tenant,
      foreign,
      point,
      otherPoint,
      clock,
      schema,
      now,
    });
  } finally {
    global.Date = RealDate;
    await app.end();
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test(
  'PG16 current clean profit preserves dashboard-v2 components, including assigned premium today and both motivation schemes',
  opts,
  async () =>
    fixture(async (f) => {
      const c = await f.client(),
        car = await f.car(c);
      await f.check({ cid: c, carId: car, date: '2026-10-28T08:00Z', revenue: 1000, profit: 500 });
      const current = await f.check({ cid: c, carId: car, date: '2026-10-29T08:00Z', revenue: 2000, profit: 1000 });
      const old = await f.check({ date: '2026-10-01T08:00Z' });
      await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'monthly',3100,true),($4,$2,$3,'per_vehicle_day',0,false)", [
        randomUUID(),
        f.tenant,
        f.point,
        randomUUID(),
      ]);
      const fc = (await f.q("SELECT id FROM fixed_costs WHERE mode='per_vehicle_day'")).rows[0].id;
      await f.q("INSERT INTO fixed_cost_vehicle_history VALUES($1,$2,'2026-10-01',1,10,true,false)", [f.tenant, fc]);
      for (const [type, amount] of [
        ['fixed_monthly', 310],
        ['pct_profit', 10],
      ]) {
        const u = randomUUID();
        await f.q('INSERT INTO users VALUES($1,$2)', [u, f.tenant]);
        await f.q('INSERT INTO user_points VALUES($1,$2,$3)', [u, f.tenant, f.point]);
        await f.q('INSERT INTO employee_compensation VALUES($1,$2,$3,$4,true)', [f.tenant, u, type, amount]);
      }
      await f.q(
        "INSERT INTO salary_premiums VALUES($1,$2,'cash',70,'2026-10','2026-10-29T08:00Z'),($1,$2,'rate_bonus',999,'2026-10','2026-10-29T08:00Z')",
        [f.tenant, f.point],
      );
      await f.q(
        "INSERT INTO motivation_accruals VALUES($1,$2,10,'2026-10-29T08:00Z','margin_v1'),($1,$3,20,'2026-10-29T08:00Z','revenue_v2')",
        [f.tenant, current, old],
      );
      const category = randomUUID(),
        salaryCategory = randomUUID();
      await f.q("INSERT INTO expense_categories VALUES($1,$3,'Other',false),($2,$3,'Зарплата',false)", [
        category,
        salaryCategory,
        f.tenant,
      ]);
      await f.q(
        "INSERT INTO expenses(tenant_id,point_id,category_id,date,amount,approval_status) VALUES($1,$2,$3,'2026-10-29T08:00Z',25,'approved'),($1,$2,$4,'2026-10-29T08:00Z',9999,'approved')",
        [f.tenant, f.point, category, salaryCategory],
      );
      const actual = await f.profit();
      const baseline = await f.run(() => f.legacy.computeDashboardV2(f.tenant, 'today', f.point));
      for (const key of Object.keys(baseline.netProfitAccrual.mtd)) {
        assert.equal(actual.current.mtd[key], baseline.netProfitAccrual.mtd[key], `MTD ${key}`);
        assert.equal(actual.current.day[key], baseline.netProfitAccrual.today[key], `day ${key}`);
      }
      assert.equal(actual.current.day.salaryExtras, 100);
      assert.equal(actual.current.day.netProfit, 655);
      assert.equal(actual.current.mtd.netProfit, -1985);
      assert.equal(actual.basis, 'current_plan');
      assert.equal(actual.historicalSnapshot, false);
    }),
);

test(
  'PG16 historical periods, matching local-clock comparison, boundaries and tenant/point isolation',
  opts,
  async () =>
    fixture(async (f) => {
      await f.q("UPDATE tenants SET timezone='Asia/Vladivostok' WHERE id=$1", [f.tenant]);
      await f.check({ date: '2026-10-29T08:00Z', revenue: 100, profit: 100 });
      await f.check({ date: '2026-10-29T10:00Z', revenue: 9999, profit: 9999 });
      await f.check({ date: '2026-09-29T08:00Z', revenue: 80, profit: 80 });
      await f.check({ date: '2026-09-29T10:00Z', revenue: 20, profit: 20 });
      await f.check({ date: '2026-09-29T13:59:59.999Z', revenue: 1, profit: 1 });
      await f.check({ date: '2026-09-29T14:00:00Z', revenue: 9000, profit: 9000 });
      await f.check({ date: '2026-09-29T08:00Z', revenue: 8000, profit: 8000, p: f.otherPoint });
      await f.check({ date: '2026-09-29T08:00Z', revenue: 7000, profit: 7000, tid: f.foreign });
      let value = await f.profit();
      assert.equal(value.current.day.revenue, 100);
      assert.equal(value.comparison.day.revenue, 80);
      assert.equal(value.comparison.dayDelta.percent, 25);
      value = await f.profit('2026-09-29');
      assert.equal(value.current.day.revenue, 101);
      assert.equal(value.current.period.untilExclusive, '2026-09-29T14:00:00.000Z');
      assert.equal(value.comparison.mtdDelta.percent, null);
      await assert.rejects(() => f.profit('2026-10-30'), bad(400));
    }),
);

test('PG16 signed profit-share reversal, warranty/refund loss and first-day allocated costs', opts, async () =>
  fixture(async (f) => {
    const u = randomUUID();
    await f.q('INSERT INTO users VALUES($1,$2)', [u, f.tenant]);
    await f.q("INSERT INTO employee_compensation VALUES($1,$2,'pct_profit',10,true)", [f.tenant, u]);
    await f.check({ date: '2026-10-18T08:00Z', profit: 500, revenue: 500 });
    await f.check({ date: '2026-10-19T08:00Z', profit: -1000, returned: true });
    let value = await f.profit('2026-10-19');
    assert.equal(value.current.day.staffPctProfit, -50);
    assert.equal(value.current.day.netProfit, -950);
    await f.check({
      date: '2026-10-20T08:00Z',
      payment: 'warranty',
      revenue: 10000,
      profit: 9000,
      cost: 40,
      salary: 10,
      productSalary: 5,
    });
    value = await f.profit('2026-10-20');
    assert.equal(value.current.day.revenue, 0);
    assert.equal(value.current.day.checkProfit, -55);
    await f.q(
      "INSERT INTO salary_premiums VALUES($1,$2,'cash',33,'2026-10','2026-11-15T08:00Z'),($1,$2,'cash',100,NULL,'2026-10-02T08:00Z')",
      [f.tenant, f.point],
    );
    await f.q(
      "INSERT INTO expenses(tenant_id,point_id,date,amount,period_month,approval_status) VALUES($1,$2,'2026-11-15T08:00Z',44,'2026-10','approved'),($1,$2,'2026-10-02T08:00Z',100,NULL,'approved')",
      [f.tenant, f.point],
    );
    value = await f.profit('2026-10-01');
    assert.deepEqual(value.current.day, value.current.mtd);
    assert.equal(value.current.day.salaryExtras, 33);
    assert.equal(value.current.day.oneOffExpenses, 44);
  }),
);

test(
  'PG16 client cohorts use actual visit history; daily car dedup, distinct cars, refunds and exclusions',
  opts,
  async () =>
    fixture(async (f) => {
      const fresh = await f.client({ created: '2020-01-01T00:00Z' }),
        freshCar = await f.car(fresh);
      await f.check({ cid: fresh, carId: freshCar, date: '2026-10-29T07:00Z' });
      await f.check({ cid: fresh, carId: freshCar, date: '2026-10-29T08:00Z' });
      const repeat = await f.client({ created: '2026-10-29T00:00Z' }),
        repeatCar = await f.car(repeat);
      await f.check({ cid: repeat, carId: repeatCar, date: '2026-10-28T08:00Z' });
      await f.check({ cid: repeat, carId: repeatCar, date: '2026-10-29T08:00Z', payment: 'warranty', returned: true });
      const multi = await f.client(),
        a = await f.car(multi),
        b = await f.car(multi);
      await f.check({ cid: multi, carId: a, date: '2026-10-28T08:00Z' });
      await f.check({ cid: multi, carId: b, date: '2026-10-29T08:00Z' });
      const draft = await f.client(),
        draftCar = await f.car(draft);
      await f.check({ cid: draft, carId: draftCar, date: '2026-09-01T08:00Z', deferred: true });
      await f.check({ cid: draft, carId: draftCar, date: '2026-10-29T08:00Z' });
      const retail = await f.client({ retail: true }),
        retailCar = await f.car(retail);
      await f.check({ cid: retail, carId: retailCar, date: '2026-10-29T08:00Z' });
      const excluded = await f.client(),
        excludedCar = await f.car(excluded);
      await f.check({ cid: excluded, date: '2026-10-29T08:00Z' });
      await f.check({ cid: excluded, carId: excludedCar, date: '2026-10-29T08:00Z', deleted: '2026-10-29T08:01Z' });
      await f.check({ cid: excluded, carId: excludedCar, date: '2026-10-29T10:00Z' });
      const day = { from: '2026-10-29', to: '2026-10-29' },
        month = { from: '2026-10-01', to: '2026-10-29' };
      let value = await f.run(() => f.service.visits(f.tenant, f.point, day));
      assert.equal(value.servedClients, 4);
      assert.equal(value.newClients, 2);
      assert.equal(value.returningClients, 2);
      assert.equal(value.visitCount, 4);
      assert.equal(value.rapidReturnVehicleCount, 1);
      const rows = await f.run(() => f.service.clients(f.tenant, f.point, { ...day, cohort: 'new' }));
      assert.deepEqual(new Set(rows.items.map((r) => r.clientId)), new Set([fresh, draft]));
      value = await f.run(() => f.service.visits(f.tenant, f.point, month));
      assert.equal(value.newClients, 4);
      assert.equal(value.returningClients, 0);
      assert.equal(value.rapidReturnVehicleCount, 1);
      await f.q('UPDATE cars SET client_id=$2 WHERE id=$1', [freshCar, excluded]);
      const after = await f.run(() => f.service.visits(f.tenant, f.point, day));
      assert.equal(after.newClients, 2, 'current car owner must not rewrite check client history');
    }),
);

test('PG16 1/30/31 calendar-day returns, tenant-wide history and point-safe previous works', opts, async () =>
  fixture(async (f) => {
    const ids = [];
    for (const prior of ['2026-10-28', '2026-09-29', '2026-09-28']) {
      const cid = await f.client(),
        car = await f.car(cid);
      ids.push(car);
      const previous = await f.check({ cid, carId: car, date: `${prior}T08:00Z`, p: f.otherPoint });
      await f.q("INSERT INTO check_service_lines(check_id,name) VALUES($1,'PRIVATE OTHER BRANCH WORK')", [previous]);
      await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
    }
    const cid = await f.client(),
      car = await f.car(cid);
    const prev1 = await f.check({ cid, carId: car, date: '2026-10-28T07:00Z' }),
      prev2 = await f.check({ cid, carId: car, date: '2026-10-28T08:00Z' });
    await f.q("INSERT INTO check_service_lines(check_id,name) VALUES($1,'Oil'),($2,'Brakes')", [prev1, prev2]);
    await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
    const crossing = await f.client(),
      crossCar = await f.car(crossing);
    await f.check({ cid: crossing, carId: crossCar, date: '2026-10-29T07:00Z', p: f.otherPoint });
    await f.check({ cid: crossing, carId: crossCar, date: '2026-10-29T08:00Z' });
    const query = { from: '2026-10-29', to: '2026-10-29' };
    const value = await f.run(() => f.service.visits(f.tenant, f.point, query));
    assert.equal(value.visitCount, 4, 'same-car/day goes only to first branch');
    assert.equal(value.rapidReturnVehicleCount, 3);
    const page = await f.run(() => f.service.rapidReturns(f.tenant, f.point, query));
    assert.deepEqual(new Set(page.items.map((r) => r.carId)), new Set([...ids.slice(0, 2), car]));
    for (const row of page.items.filter((r) => ids.includes(r.carId))) {
      assert.equal(row.previousDetailsRestricted, true);
      assert.deepEqual(row.previousChecks, []);
      assert.deepEqual(row.previousWorks, []);
    }
    const own = page.items.find((r) => r.carId === car);
    assert.deepEqual(own.previousWorks, ['Brakes', 'Oil']);
    assert.equal(own.previousCheckCount, 2);
    await f.q('UPDATE tenants SET points_shared_clients=false WHERE id=$1', [f.tenant]);
    await f.q('UPDATE clients SET point_id=$2 WHERE id=$1', [cid, f.otherPoint]);
    const restricted = await f.run(() => f.service.rapidReturns(f.tenant, f.point, query));
    assert.equal(restricted.items.find((r) => r.carId === car).canOpenCarHistory, false);
  }),
);

test(
  'PG16 exact totals beyond client/page caps, deterministic cursor traversal, app-role RLS and query plan',
  opts,
  async () =>
    fixture(async (f) => {
      for (let i = 0; i < 61; i++) {
        const cid = await f.client(),
          car = await f.car(cid);
        await f.check({ cid, carId: car, date: '2026-10-28T08:00Z' });
        await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
      }
      const query = { from: '2026-10-29', to: '2026-10-29', limit: 20 };
      const value = await f.run(() => f.service.visits(f.tenant, f.point, query));
      assert.equal(value.returningClients, 61);
      assert.equal(value.rapidReturnVehicleCount, 61);
      const seen = [];
      let cursor;
      let firstCursor;
      do {
        const page = await f.run(() =>
          f.service.rapidReturns(f.tenant, f.point, { ...query, ...(cursor ? { cursor } : {}) }),
        );
        assert.equal(page.total, 61);
        seen.push(...page.items.map((r) => r.carId));
        cursor = page.nextCursor;
        firstCursor ??= cursor;
      } while (cursor);
      assert.equal(seen.length, 61);
      assert.equal(new Set(seen).size, 61);
      const people = [];
      cursor = undefined;
      do {
        const page = await f.run(() =>
          f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning', ...(cursor ? { cursor } : {}) }),
        );
        assert.equal(page.total, 61);
        people.push(...page.items.map((r) => r.clientId));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(new Set(people).size, 61);
      await assert.rejects(
        () => f.run(() => f.service.rapidReturns(f.tenant, f.otherPoint, { ...query, cursor: firstCursor })),
        bad(400),
      );
      for (const limit of ['bad', 0, 51, 1.2])
        await assert.rejects(
          () => f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning', limit })),
          bad(400),
        );
      const role = await f.run(() =>
        f.scoped.query('SELECT current_user AS name,(SELECT COUNT(*) FROM tenants) AS tenants'),
      );
      assert.equal(role.rows[0].name, 'autexa_app');
      assert.equal(Number(role.rows[0].tenants), 1);
      await assert.rejects(() => f.run(() => f.service.profit(f.foreign, f.point)), bad(404));
      const v = visitQuery({
        tenant: f.tenant,
        point: f.point,
        tz: 'Europe/Moscow',
        shared: true,
        from: query.from,
        to: query.to,
        start: '2026-10-28T21:00Z',
        until: '2026-10-29T09:00Z',
      });
      const explain = await f.run(() =>
        f.scoped.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${v.cte} SELECT COUNT(*) FROM client_cohorts`, v.params),
      );
      const plan = explain.rows[0]['QUERY PLAN'][0];
      console.log(
        JSON.stringify({
          ownerHomeFixtureClients: 61,
          executionMs: plan['Execution Time'],
          planningMs: plan['Planning Time'],
        }),
      );
      assert.ok(plan['Execution Time'] < 10000, 'bounded indexed fixture query must complete');
    }),
);

test(
  'PG16 monthly coverage, no-plan recurring fallback and historical vehicle rates remain independent',
  opts,
  async () =>
    fixture(async (f) => {
      const category = randomUUID();
      await f.q("INSERT INTO expense_categories VALUES($1,$2,'Rent',true)", [category, f.tenant]);
      await f.q(
        "INSERT INTO expenses(tenant_id,point_id,category_id,date,amount,period_month,approval_status) VALUES($1,$2,$3,'2026-11-01T08:00Z',6200,'2026-10','approved')",
        [f.tenant, f.point, category],
      );
      let value = await f.profit('2026-10-18');
      assert.equal(value.current.mtd.oneOffExpenses, 6200);
      assert.equal(value.current.day.oneOffExpenses, 0);
      const monthly = randomUUID();
      await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'monthly',3100,true)", [monthly, f.tenant, f.point]);
      value = await f.profit('2026-10-18');
      assert.equal(value.current.mtd.plannedFixedAmortized, 1800);
      assert.equal(value.current.mtd.recurringExcess, 1800);
      assert.equal(value.current.day.recurringExcess, 100);
      assert.equal(value.current.day.netProfit, -200);
      const cost = randomUUID();
      await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'per_vehicle_day',0,false)", [cost, f.tenant, f.point]);
      await f.q(
        "INSERT INTO fixed_cost_vehicle_history VALUES($1,$2,'2026-10-01',1,10,true,false),($1,$2,'2026-10-29',2,20,true,false),($1,$2,'2026-10-30',3,20,false,true)",
        [f.tenant, cost],
      );
      const cid = await f.client(),
        car = await f.car(cid);
      await f.check({ cid, carId: car, date: '2026-10-28T08:00Z' });
      await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
      value = await f.profit('2026-10-28');
      assert.equal(value.current.day.perVehicleDayExpense, 10);
      value = await f.profit();
      assert.equal(value.current.day.perVehicleDayExpense, 20);
      assert.equal(value.current.mtd.perVehicleDayExpense, 30);
    }),
);

test('PG16 counts exceed 1000-client cap using indexed candidates, without a schema migration', opts, async () =>
  fixture(async (f) => {
    await f.q(
      `INSERT INTO clients(id,tenant_id,point_id,full_name,created_at)
    SELECT md5('client-'||n)::uuid,$1,$2,'Client '||n,'2020-01-01'::timestamptz FROM generate_series(1,1205) n`,
      [f.tenant, f.point],
    );
    await f.q(
      `INSERT INTO cars(id,tenant_id,client_id,plate_number,make_model)
    SELECT md5('car-'||n)::uuid,$1,md5('client-'||n)::uuid,'P'||n,'Car' FROM generate_series(1,1205) n`,
      [f.tenant],
    );
    await f.q(
      `INSERT INTO checks(id,tenant_id,point_id,client_id,car_id,date)
    SELECT md5('check-'||n||'-'||d)::uuid,$1,$2,md5('client-'||n)::uuid,md5('car-'||n)::uuid,
      ('2026-10-'||d||'T08:00:00Z')::timestamptz FROM generate_series(1,1205) n CROSS JOIN generate_series(28,29) d`,
      [f.tenant, f.point],
    );
    await f.q(
      `INSERT INTO checks(id,tenant_id,point_id,date)
    SELECT md5('foreign-'||n)::uuid,$1,$2,'2026-10-29T08:00Z' FROM generate_series(1,10000) n`,
      [f.foreign, f.otherPoint],
    );
    await f.q('ANALYZE checks; ANALYZE clients; ANALYZE cars');
    const query = { from: '2026-10-29', to: '2026-10-29' };
    const summary = await f.run(() => f.service.visits(f.tenant, f.point, query));
    assert.equal(summary.servedClients, 1205);
    assert.equal(summary.returningClients, 1205);
    assert.equal(summary.rapidReturnVehicleCount, 1205);
    const page = await f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning', limit: 50 }));
    assert.equal(page.total, 1205);
    assert.equal(page.items.length, 50);
    const v = visitQuery({
      tenant: f.tenant,
      point: f.point,
      tz: 'Europe/Moscow',
      shared: true,
      ...query,
      start: '2026-10-28T21:00Z',
      until: '2026-10-29T09:00Z',
    });
    const result = await f.run(() =>
      f.scoped.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${v.cte} SELECT COUNT(*) FROM client_cohorts`, v.params),
    );
    const plan = result.rows[0]['QUERY PLAN'][0];
    console.log(
      JSON.stringify({
        ownerHomeFixtureClients: 1205,
        foreignChecks: 10000,
        executionMs: plan['Execution Time'],
        planningMs: plan['Planning Time'],
      }),
    );
    assert.ok(plan['Execution Time'] < 10000);
  }),
);

test('PG16 full historical day includes the last PostgreSQL microsecond for vehicle costs', opts, async () =>
  fixture(async (f) => {
    const cid = await f.client();
    const car = await f.car(cid);
    const tomorrowCar = await f.car(cid);
    const cost = randomUUID();
    await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'per_vehicle_day',0,true)", [cost, f.tenant, f.point]);
    await f.q("INSERT INTO fixed_cost_vehicle_history VALUES($1,$2,'2026-09-01',1,10,true,false)", [f.tenant, cost]);
    await f.check({ cid, carId: car, date: '2026-09-29T20:59:59.999999Z', revenue: 100, profit: 100 });
    await f.check({ cid, carId: tomorrowCar, date: '2026-09-29T21:00:00.000000Z', revenue: 1000, profit: 1000 });
    const value = await f.profit('2026-09-29');
    assert.equal(value.current.day.checkProfit, 100);
    assert.equal(value.current.day.perVehicleDayExpense, 10);
    assert.equal(value.current.day.netProfit, 90);
  }),
);

test('PG16 mixed-point previous visit exposes only permitted checks, works and counts', opts, async () =>
  fixture(async (f) => {
    const cid = await f.client();
    const car = await f.car(cid);
    const foreignFirst = await f.check({ cid, carId: car, p: f.otherPoint, date: '2026-10-28T07:00Z' });
    const ownFirst = await f.check({ cid, carId: car, date: '2026-10-28T08:00Z' });
    const ownSecond = await f.check({ cid, carId: car, date: '2026-10-28T08:15Z' });
    const foreignSecond = await f.check({ cid, carId: car, p: f.otherPoint, date: '2026-10-28T08:30Z' });
    await f.q(
      `INSERT INTO check_service_lines(check_id,name) VALUES
        ($1,'Private diagnostic'),($2,'Oil'),($3,'Brakes'),($4,'Private repair')`,
      [foreignFirst, ownFirst, ownSecond, foreignSecond],
    );
    const current = await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
    const query = { from: '2026-10-29', to: '2026-10-29' };
    const summary = await f.run(() => f.service.visits(f.tenant, f.point, query));
    assert.equal(summary.returningClients, 1);
    assert.equal(summary.rapidReturnVehicleCount, 1);
    const page = await f.run(() => f.service.rapidReturns(f.tenant, f.point, query));
    assert.equal(page.total, 1);
    const row = page.items[0];
    assert.equal(row.carId, car);
    assert.equal(row.previousVisitDate, '2026-10-28');
    assert.equal(row.gapDays, 1);
    assert.equal(row.previousDetailsRestricted, true);
    assert.deepEqual(new Set(row.previousChecks.map((check) => check.id)), new Set([ownFirst, ownSecond]));
    assert.equal(row.previousCheckCount, 2, 'count only authorized checks, not all four checks of the visit');
    assert.deepEqual(row.previousWorks, ['Brakes', 'Oil']);
    assert.equal(row.previousWorkCount, 2, 'count only authorized work names');
    assert.deepEqual(
      row.currentChecks.map((check) => check.id),
      [current],
    );
    assert.equal(row.currentCheckCount, 1);
    const serialized = JSON.stringify(page);
    for (const forbidden of [foreignFirst, foreignSecond, 'Private diagnostic', 'Private repair'])
      assert.equal(serialized.includes(forbidden), false);
  }),
);

test('PG16 transferred car owner never reassigns client cohorts or client-history visibility', opts, async () =>
  fixture(async (f) => {
    await f.q('UPDATE tenants SET points_shared_clients=false WHERE id=$1', [f.tenant]);
    const historicalClient = await f.client({ name: 'Historical check client' });
    const currentOwner = await f.client({ p: f.otherPoint, name: 'Private current owner' });
    const car = await f.car(historicalClient);
    await f.check({ cid: historicalClient, carId: car, date: '2026-09-30T08:00Z' });
    await f.check({ cid: historicalClient, carId: car, date: '2026-10-28T08:00Z' });
    await f.check({ cid: historicalClient, carId: car, date: '2026-10-29T08:00Z' });
    const query = { from: '2026-10-01', to: '2026-10-29' };
    const before = await f.run(() => f.service.visits(f.tenant, f.point, query));
    const beforeCars = await f.run(() => f.service.rapidReturns(f.tenant, f.point, query));
    assert.equal(beforeCars.items[0].canOpenCarHistory, true);
    await f.q('UPDATE cars SET client_id=$2 WHERE id=$1', [car, currentOwner]);
    const after = await f.run(() => f.service.visits(f.tenant, f.point, query));
    assert.deepEqual(after, before, 'changing current car owner must not alter historical visit cohorts');
    assert.equal(after.servedClients, 1);
    assert.equal(after.newClients, 0);
    assert.equal(after.returningClients, 1);
    const clients = await f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning' }));
    assert.equal(clients.total, 1);
    assert.equal(clients.items[0].clientId, historicalClient);
    assert.equal(clients.items[0].firstVisitDate, '2026-09-30');
    assert.equal(clients.items[0].canOpenClientHistory, true, 'historical client remains visible at this point');
    const newClients = await f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'new' }));
    assert.equal(newClients.total, 0, 'the new owner did not have a recorded visit');
    const cars = await f.run(() => f.service.rapidReturns(f.tenant, f.point, query));
    assert.equal(cars.items[0].clientId, historicalClient);
    assert.equal(cars.items[0].canOpenCarHistory, false, 'current owner belongs to a hidden point');
    assert.equal(JSON.stringify(cars).includes('Private current owner'), false);
    const checkOwners = await f.q('SELECT DISTINCT client_id FROM checks WHERE tenant_id=$1 AND car_id=$2', [
      f.tenant,
      car,
    ]);
    assert.deepEqual(
      checkOwners.rows.map((row) => row.client_id),
      [historicalClient],
    );
    await f.q('UPDATE clients SET point_id=$2 WHERE id=$1', [historicalClient, f.otherPoint]);
    const hiddenClient = await f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning' }));
    assert.equal(hiddenClient.items[0].clientId, historicalClient);
    assert.equal(hiddenClient.items[0].canOpenClientHistory, false, 'client visibility is checked independently');
  }),
);
