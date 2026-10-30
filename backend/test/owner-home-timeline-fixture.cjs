// Explicit disposable PostgreSQL16 only; never reads .env or DATABASE_URL.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { OwnerHomeService } = require('../dist/reports/owner-home/owner-home.service');
const { ReportsService } = require('../dist/reports/reports.service');
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
    const events = [];
    const originalConnect = scoped.connect.bind(scoped);
    scoped.connect = async (...args) => {
      const connection = await originalConnect(...args);
      const originalQuery = connection.query.bind(connection);
      const originalRelease = connection.release.bind(connection);
      connection.query = (...queryArgs) => {
        events.push({ sql: queryArgs[0], params: queryArgs[1] });
        return originalQuery(...queryArgs);
      };
      connection.release = (...releaseArgs) => {
        connection.query = originalQuery;
        connection.release = originalRelease;
        return originalRelease(...releaseArgs);
      };
      return connection;
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
      events,
    });
  } finally {
    global.Date = RealDate;
    await app.end();
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

module.exports = { fixture, opts, bad };
