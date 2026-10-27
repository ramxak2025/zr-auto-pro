// Explicit disposable PostgreSQL only. Never uses .env, DATABASE_URL or production credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { PlanningService } = require('../dist/planning/planning.service');
const { ReportsService } = require('../dist/reports/reports.service');
const { PointsService } = require('../dist/points/points.service');
const { SummaryBuilder } = require('../dist/reports/builder/builders/summary.builder');
const { PointsBuilder } = require('../dist/reports/builder/builders/points.builder');
const { vehicleDayCosts } = require('../dist/common/vehicle-day-costs');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const live = process.env.OCT27_FINANCE_TEST_DB;
Logger.overrideLogger(false);
const json = (x) => JSON.parse(JSON.stringify(x));
const status = (code) => (e) => e.getStatus?.() === code;

async function fixture(fn) {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55451');
  assert.equal(url.pathname, '/autexa_oct27_finance');
  assert.equal(url.username, 'oct27_finance_admin');
  const admin = new Pool({ connectionString: live });
  const schema = `finance_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: live, options: `-c search_path=${schema},pg_catalog` });
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  const app = new Pool({ connectionString: appUrl.toString(), options: `-c search_path=${schema},pg_catalog` });
  const scoped = new TenantAwarePool(pool, app);
  const q = (sql, params = []) => pool.query(sql, params);
  const tenant = randomUUID(),
    foreignTenant = randomUUID(),
    point = randomUUID(),
    branch = randomUUID();
  const realDate = Date;
  let now = '2026-10-27T12:00:00Z';
  const clock = async (value) => {
    assert.match(value, /^2026-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    now = value;
    await q(
      `CREATE OR REPLACE FUNCTION ${schema}.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${value}'::timestamptz $$`,
    );
    await q(
      `CREATE OR REPLACE FUNCTION ${schema}.statement_timestamp() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${value}'::timestamptz $$`,
    );
    global.Date = class extends realDate {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
      static now() {
        return new realDate(now).getTime();
      }
    };
  };
  try {
    await q(`
      CREATE TABLE tenants(id uuid PRIMARY KEY,timezone text,shifts_enabled boolean DEFAULT false);
      CREATE TABLE tenant_points(id uuid PRIMARY KEY,tenant_id uuid,name text,is_main boolean DEFAULT false,is_active boolean DEFAULT true,sort_order int DEFAULT 0);
      CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid,full_name text,role text,is_active boolean DEFAULT true,dismissed_at timestamptz,purged_at timestamptz);
      CREATE TABLE user_points(user_id uuid,tenant_id uuid,point_id uuid);
      CREATE TABLE expense_categories(id uuid PRIMARY KEY,tenant_id uuid,name text,is_recurring boolean DEFAULT false);
      CREATE TABLE expenses(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,point_id uuid,category_id uuid,amount numeric,date timestamptz,period_month text,approval_status text);
      CREATE TABLE checks(id uuid PRIMARY KEY,tenant_id uuid,point_id uuid,client_id uuid,car_id uuid,master_id uuid,
        date timestamptz,created_at timestamptz DEFAULT now(),is_deferred boolean DEFAULT false,deleted_at timestamptz,
        total_revenue numeric DEFAULT 0,product_cost_total numeric DEFAULT 0,service_salary_total numeric DEFAULT 0,product_salary_total numeric DEFAULT 0,
        profit numeric DEFAULT 0,cash_amount numeric DEFAULT 0,card_amount numeric DEFAULT 0,payment_method text DEFAULT 'cash',is_returned boolean DEFAULT false,return_scope text);
      CREATE TABLE motivation_accruals(tenant_id uuid,check_id uuid,employee_id uuid,amount numeric,accrued_at timestamptz);
      CREATE TABLE salary_premiums(tenant_id uuid,point_id uuid,type text,amount numeric,period_month_year text,created_at timestamptz);
      CREATE TABLE salary_payouts(tenant_id uuid,point_id uuid,amount numeric,status text,period_month text,created_at timestamptz);
      CREATE TABLE salary_payments(tenant_id uuid,point_id uuid,amount numeric,month_year text,date timestamptz,reversed_at timestamptz);
      CREATE TABLE installment_plans(id uuid,tenant_id uuid,check_id uuid,remaining numeric,status text);
      CREATE TABLE installment_payments(tenant_id uuid,plan_id uuid,amount numeric,paid_at timestamptz,payment_method text);
      CREATE TABLE clients(id uuid,tenant_id uuid,is_retail boolean DEFAULT false,created_at timestamptz);
      CREATE TABLE client_debts(tenant_id uuid,client_id uuid,type text,amount numeric);
      CREATE TABLE suppliers(id uuid,tenant_id uuid);
      CREATE TABLE deliveries(supplier_id uuid,tenant_id uuid,total_amount numeric,deleted_at timestamptz);
      CREATE TABLE supplier_payments(supplier_id uuid,tenant_id uuid,amount numeric,reversed_at timestamptz);
      CREATE TABLE supplier_returns(supplier_id uuid,tenant_id uuid,total_amount numeric);
      CREATE TABLE check_returns(id uuid,tenant_id uuid,check_id uuid,refund_amount numeric,created_at timestamptz);
      CREATE TABLE check_return_lines(return_id uuid,service_line_id uuid,quantity numeric,amount numeric);
      CREATE TABLE check_service_lines(id uuid,check_id uuid,service_id uuid,name text,quantity numeric,total numeric);
      CREATE TABLE check_product_lines(check_id uuid,product_id uuid,name text,quantity numeric,total_sell numeric,total_cost numeric);
      CREATE TABLE services(id uuid,name text);
      CREATE TABLE products(id uuid,name text);
    `);
    await q(readFileSync(join(__dirname, '../migrations/132_fixed_costs.sql'), 'utf8'));
    await q(readFileSync(join(__dirname, '../migrations/133_employee_compensation.sql'), 'utf8'));
    await q('ALTER TABLE fixed_costs ADD COLUMN point_id uuid REFERENCES tenant_points(id)');
    await q(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='autexa_app') THEN CREATE ROLE autexa_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`,
    );
    const migration = readFileSync(join(__dirname, '../migrations/199_fixed_cost_vehicle_days.sql'), 'utf8');
    await q(migration);
    await q(migration); // explicitly verify idempotent additive migration
    for (const table of [
      'checks',
      'tenant_points',
      'users',
      'user_points',
      'expenses',
      'expense_categories',
      'salary_premiums',
      'motivation_accruals',
    ]) {
      await q(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)`);
    }
    await q(
      `GRANT USAGE ON SCHEMA ${schema} TO autexa_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO autexa_app`,
    );
    await clock(now);
    await q('INSERT INTO tenants(id,timezone) VALUES($1,$2),($3,$2)', [tenant, 'Europe/Moscow', foreignTenant]);
    await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,'A',true),($3,$2,'B',false)", [
      point,
      tenant,
      branch,
    ]);
    const run = (action, tid = tenant) => runWithTenant(tid, action);
    const service = new PlanningService(scoped);
    const reports = new ReportsService(scoped, undefined);
    const check = async (args = {}) => {
      const id = args.id ?? randomUUID();
      const clientId = args.client === null ? null : (args.client ?? randomUUID());
      const carId = args.car === null ? null : (args.car ?? randomUUID());
      const tid = args.tenant ?? tenant;
      const revenue = args.revenue ?? 0,
        cost = args.cost ?? 0,
        salary = args.salary ?? 0;
      await q(
        `INSERT INTO checks(id,tenant_id,point_id,client_id,car_id,date,created_at,is_deferred,deleted_at,total_revenue,
        product_cost_total,service_salary_total,profit,payment_method,is_returned,return_scope,cash_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id,
          tid,
          args.point ?? point,
          clientId,
          carId,
          args.date ?? now,
          args.createdAt ?? now,
          args.deferred ?? false,
          args.deleted ?? null,
          revenue,
          cost,
          salary,
          revenue - cost - salary,
          args.payment ?? 'cash',
          args.returned ?? false,
          args.returnScope ?? null,
          args.cash ?? revenue,
        ],
      );
      return { id, car: carId, client: clientId };
    };
    const create = (amount = 500, args = {}) =>
      run(() =>
        service.createFixedCost(
          tenant,
          {
            mode: 'per_vehicle_day',
            name: 'Rent per visit',
            perVehicleDayAmount: amount,
            requestId: randomUUID(),
            ...args,
          },
          args.point ?? point,
        ),
      );
    const costs = (from = '2026-10-27', to = from, selectedPoint = point, tid = tenant, tz = 'Europe/Moscow') =>
      run(
        () => vehicleDayCosts(scoped, { tenantId: tid, dateFrom: from, dateTo: to, tz, pointId: selectedPoint }),
        tid,
      );
    const total = async (...args) => (await costs(...args)).reduce((sum, row) => sum + row.amount, 0);
    await fn({
      q,
      run,
      pool: scoped,
      rawPool: pool,
      app,
      tenant,
      foreignTenant,
      point,
      branch,
      service,
      reports,
      check,
      create,
      costs,
      total,
      clock,
      now: () => now,
    });
  } finally {
    global.Date = realDate;
    await app.end();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

const opts = { skip: !live, timeout: 60000 };
test('PG/RLS: tenant/car/day dedup before branch selection; zero, warranty and returns still visit', opts, async () => {
  await fixture(async ({ q, run, pool, app, tenant, foreignTenant, point, branch, check, create, total }) => {
    await create();
    await create(500, { point: branch });
    const car = randomUUID();
    for (let n = 0; n < 10; n++) await check({ car });
    assert.equal(await total(), 500);
    const second = await check();
    assert.equal(await total(), 1000);
    const otherBranch = await check({ car: second.car, point: branch, date: '2026-10-27T08:00:00Z' });
    assert.equal(await total(), 500);
    assert.equal(await total('2026-10-27', '2026-10-27', branch), 500);
    assert.equal(await total('2026-10-27', '2026-10-27', null), 1000);
    await check({ client: null });
    await check({ car: null });
    await check({ deferred: true });
    await check({ deleted: '2026-10-27T12:00:00Z' });
    assert.equal(await total(), 500);
    await check({ payment: 'warranty', cost: 25 });
    await check({ returned: true, returnScope: 'full' });
    await check({ returned: true, returnScope: 'partial' });
    assert.equal(await total(), 2000);
    await create(12.34);
    assert.equal(await total(), 2049.36, 'independent rows add, even with the same name');
    // Explicit tenant predicates and actual restricted role both prevent data mixing.
    await check({ tenant: foreignTenant, car, date: '2026-10-27T07:00:00Z' });
    assert.equal(await total(), 2049.36);
    assert.deepEqual(
      (await app.query('SELECT * FROM fixed_cost_vehicle_history')).rows,
      [],
      'RLS default deny without context',
    );
    assert.equal((await run(() => pool.query('SELECT DISTINCT tenant_id FROM checks'))).rows.length, 1);
    await assert.rejects(
      run(() =>
        pool.query("INSERT INTO fixed_cost_requests(tenant_id,request_id,payload_hash,result) VALUES($1,$2,'x','{}')", [
          foreignTenant,
          randomUUID(),
        ]),
      ),
      /row-level security/,
    );
    // Trash first check changes branch attribution; restore returns exactly the same charge.
    await q('UPDATE checks SET deleted_at=now() WHERE id=$1', [otherBranch.id]);
    assert.equal(await total(), 2561.7);
    await q('UPDATE checks SET deleted_at=NULL WHERE id=$1', [otherBranch.id]);
    assert.equal(await total(), 2049.36);
    await q("UPDATE checks SET date='2026-10-28T08:00:00Z' WHERE id=$1", [otherBranch.id]);
    assert.equal(await total(), 2561.7);
    assert.equal(await total('2026-10-28', '2026-10-28', branch), 500);
    await q('UPDATE checks SET car_id=$2 WHERE id=$1', [second.id, car]);
    assert.equal(await total(), 2049.36);
    assert.equal(
      (await q('SELECT count(*) FROM expenses')).rows[0].count,
      '0',
      'derived costs never create cash expenses',
    );
    const tiedCar = randomUUID();
    await check({
      id: '00000000-0000-0000-0000-000000000002',
      car: tiedCar,
      point,
      date: '2026-10-29T08:00:00Z',
      createdAt: '2026-10-29T09:00:00Z',
    });
    await check({
      id: '00000000-0000-0000-0000-000000000001',
      car: tiedCar,
      point: branch,
      date: '2026-10-29T08:00:00Z',
      createdAt: '2026-10-29T09:00:00Z',
    });
    assert.equal(await total('2026-10-29', '2026-10-29', point), 0);
    assert.equal(
      await total('2026-10-29', '2026-10-29', branch),
      500,
      'id breaks equal date/created_at deterministically',
    );
    await q("UPDATE checks SET created_at='2026-10-29T07:00:00Z' WHERE id='00000000-0000-0000-0000-000000000002'");
    assert.equal(await total('2026-10-29', '2026-10-29', point), 512.34, 'created_at breaks equal date before id');
  });
});

test(
  'PG: effective history, deterministic tomorrow, stale concurrent edits, retry and archive preserve closed days',
  opts,
  async () => {
    await fixture(async ({ q, run, service, tenant, point, branch, create, check, total, clock }) => {
      await clock('2026-10-26T12:00:00Z');
      let row = await create();
      await check();
      assert.equal(row.effectiveFrom, '2026-10-26');
      assert.equal(row.revision, 1);
      const request = { perVehicleDayAmount: 600, revision: 1, requestId: randomUUID() };
      row = await run(() => service.updateFixedCost(row.id, tenant, request, point));
      assert.equal(row.perVehicleDayAmount, 500);
      assert.equal(row.pending.perVehicleDayAmount, 600);
      assert.equal(row.pending.effectiveFrom, '2026-10-27');
      assert.equal(await total('2026-10-26'), 500);
      const replay = await run(() => service.updateFixedCost(row.id, tenant, request, point));
      assert.deepEqual(json(replay), json(row));
      await assert.rejects(
        run(() => service.updateFixedCost(row.id, tenant, { ...request, perVehicleDayAmount: 601 }, point)),
        status(409),
      );
      await assert.rejects(
        run(() =>
          service.updateFixedCost(row.id, tenant, { revision: 1, requestId: randomUUID(), active: false }, point),
        ),
        status(409),
      );
      await assert.rejects(
        run(() =>
          service.updateFixedCost(row.id, tenant, { revision: 2, requestId: randomUUID(), active: false }, branch),
        ),
        status(404),
      );
      const concurrent = await Promise.allSettled(
        [700, 800].map((amount) =>
          run(() =>
            service.updateFixedCost(
              row.id,
              tenant,
              { perVehicleDayAmount: amount, revision: 2, requestId: randomUUID() },
              point,
            ),
          ),
        ),
      );
      assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(concurrent.find((r) => r.status === 'rejected').reason.getStatus(), 409);
      row = concurrent.find((r) => r.status === 'fulfilled').value;
      const nextRate = row.pending.perVehicleDayAmount;
      assert.equal((await q('SELECT count(*) FROM fixed_cost_vehicle_history')).rows[0].count, '3');
      assert.equal(await total('2026-10-26'), 500);
      assert.deepEqual(
        json(await run(() => service.updateFixedCost(row.id, tenant, request, point))),
        json(replay),
        'old successful retry remains original result',
      );
      await clock('2026-10-27T12:00:00Z');
      await check();
      assert.equal(await total(), nextRate);
      row = await run(() =>
        service.updateFixedCost(row.id, tenant, { active: false, revision: 3, requestId: randomUUID() }, point),
      );
      assert.equal(row.active, true);
      assert.equal(row.pending.active, false);
      const archive = { revision: 4, requestId: randomUUID() };
      const removed = await run(() => service.removeFixedCost(row.id, tenant, point, archive));
      assert.equal(removed.fixedCost.pending.archived, true);
      assert.deepEqual(json(await run(() => service.removeFixedCost(row.id, tenant, point, archive))), json(removed));
      assert.equal((await run(() => service.listFixedCosts(tenant, point))).length, 1);
      await clock('2026-10-28T12:00:00Z');
      await check();
      assert.equal(await total('2026-10-28'), 0);
      assert.equal((await run(() => service.listFixedCosts(tenant, point))).length, 0);
      assert.equal(await total('2026-10-26'), 500);
      assert.equal(await total('2026-10-27'), nextRate);
      assert.equal((await q('SELECT count(*) FROM fixed_costs')).rows[0].count, '1', 'soft parent retained');
    });
  },
);

test(
  'PG: legacy monthly compatibility and strict per-vehicle input; create retry does not duplicate costs',
  opts,
  async () => {
    await fixture(async ({ run, service, tenant, point, q, create }) => {
      let monthly = await run(() => service.createFixedCost(tenant, { name: 'Rent', monthlyAmount: 31000 }, point));
      assert.equal(monthly.mode, 'monthly');
      monthly = await run(() => service.updateFixedCost(monthly.id, tenant, { monthlyAmount: 32000 }, point));
      assert.equal(monthly.monthlyAmount, 32000);
      await assert.rejects(
        run(() => service.updateFixedCost(monthly.id, tenant, { mode: 'per_vehicle_day' }, point)),
        status(400),
      );
      await run(() => service.removeFixedCost(monthly.id, tenant, point));
      assert.equal((await q('SELECT count(*) FROM fixed_costs')).rows[0].count, '0');
      const requestId = randomUUID();
      const row = await create(500, { requestId });
      assert.deepEqual(json(await create(500, { requestId })), json(row));
      assert.equal((await q('SELECT count(*) FROM fixed_costs')).rows[0].count, '1');
      await assert.rejects(
        run(() => service.updateFixedCost(row.id, tenant, { monthlyAmount: 1 }, point)),
        status(400),
      );
      await assert.rejects(
        run(() => service.updateFixedCost(row.id, tenant, { active: false }, point)),
        status(400),
      );
      await assert.rejects(
        run(() => service.removeFixedCost(row.id, tenant, point)),
        status(400),
      );
      for (const value of [NaN, Infinity, -1, 1.001, 0.000000001, 100000000.01, '12garbage', null, ''])
        await assert.rejects(create(value), status(400));
      assert.equal((await create(0)).perVehicleDayAmount, 0);
      const renamed = await run(() =>
        service.updateFixedCost(row.id, tenant, { name: 'Renamed', revision: 1, requestId: randomUUID() }, point),
      );
      assert.equal(renamed.revision, 2);
      assert.equal(renamed.pending, undefined, 'metadata does not invent a pending rate change');
    });
  },
);

const ctxFor = (f, from = '2026-10-01', to = '2026-10-31', point = f.point) => ({
  tenantId: f.tenant,
  pointId: point,
  tz: 'Europe/Moscow',
  dateFrom: from,
  dateTo: to,
  days: 31,
  ids: [],
  refDate: to,
  groupBy: null,
  actor: { tenantID: f.tenant, userID: randomUUID(), role: 'director' },
  companyName: 'Fixture',
  pointName: 'A',
});
const kpi = (result, key) => result.kpis.find((k) => k.key === key)?.value;
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

test(
  'PG/RLS: financial, summary timeline, branch report, cards and dashboard deduct identical pennies exactly once',
  opts,
  async () => {
    await fixture(async (f) => {
      const { run, reports, service, tenant, point, branch, create, check, q, pool } = f;
      await create(500.55);
      const empty = await run(() => reports.computeDashboardV2(tenant, 'month', point));
      assert.equal(empty.netProfitAccrual.config.hasPerVehicleDayCosts, true);
      assert.equal(empty.netProfitAccrual.config.hasPlannedConfig, false);
      const sale = await check({ revenue: 10000, cost: 2000, salary: 1000 });
      const rent = randomUUID();
      await q("INSERT INTO expense_categories VALUES($1,$2,'Rent',true)", [rent, tenant]);
      await q('INSERT INTO expenses(tenant_id,point_id,category_id,amount,date) VALUES($1,$2,$3,3100,now())', [
        tenant,
        point,
        rent,
      ]);
      await q("INSERT INTO salary_premiums VALUES($1,$2,'cash',100,NULL,now()),($1,$2,'rate_bonus',999,NULL,now())", [
        tenant,
        point,
      ]);
      await q('INSERT INTO motivation_accruals VALUES($1,$2,$3,50.01,now())', [tenant, sale.id, randomUUID()]);
      const financial = await run(() =>
        reports.getFinancial(tenant, { dateFrom: '2026-10-01', dateTo: '2026-10-31' }, point),
      );
      assert.equal(financial.perVehicleDayExpense, 500.55);
      assert.equal(financial.otherExpenses, 3100);
      assert.equal(round(financial.netProfit), 3249.44);
      assert.equal(financial.motivation, 50.01);
      const summary = await run(() => new SummaryBuilder(pool).build(ctxFor(f)));
      assert.equal(kpi(summary, 'netProfit'), 3249.44);
      assert.equal(kpi(summary, 'expenses'), 3600.55);
      assert.equal(summary.totals.expenses, 3600.55, 'daily table matches expenses KPI');
      const pointsReport = await run(() => new PointsBuilder(pool).build(ctxFor(f)));
      assert.equal(pointsReport.rows.find((r) => r._id === point).netProfit, 3249.44);
      const cards = await run(() => new PointsService(pool).computeSummary(tenant));
      assert.equal(round(cards.points.find((r) => r.pointId === point).profitMonth), 3249.44);
      let dashboard = await run(() => reports.computeDashboardV2(tenant, 'month', point));
      assert.equal(round(dashboard.netProfitMonth), 3249.44);
      assert.equal(dashboard.netProfitAccrual.mtd.netProfit, 3249.44);
      assert.equal(dashboard.netProfitAccrual.today.netProfit, 3249.44);
      assert.equal(dashboard.netProfitAccrual.mtd.perVehicleDayExpense, 500.55);
      assert.equal(dashboard.netProfitAccrual.projection.perVehicleDayExpense, round((500.55 / 27) * 31));
      assert.equal(
        dashboard.netProfitAccrual.mtd.oneOffExpenses,
        3100,
        'vehicle-only config cannot hide actual recurring rent',
      );
      assert.equal(dashboard.netProfitAccrual.mtd.plannedFixedAmortized, 0);
      assert.equal(dashboard.netProfitAccrual.mtd.salaryExtras, 150.01);
      assert.equal(
        dashboard.netProfitAccrual.mtd.motivation,
        50.01,
        'motivation is an informational subset of salaryExtras',
      );
      assert.equal(dashboard.cashPosition.total, 10000, 'derived charge never reduces cash position');
      await run(() => service.createFixedCost(tenant, { name: 'Monthly', monthlyAmount: 3100 }, point));
      dashboard = await run(() => reports.computeDashboardV2(tenant, 'month', point));
      assert.equal(dashboard.netProfitAccrual.mtd.plannedFixedAmortized, 2700);
      assert.equal(dashboard.netProfitAccrual.mtd.recurringExcess, 0);
      assert.equal(dashboard.netProfitAccrual.mtd.oneOffExpenses, 0);
      assert.equal(
        dashboard.netProfitAccrual.mtd.netProfit,
        3649.44,
        'monthly rent is accrued; financial report keeps paid rent semantics',
      );
      assert.equal(round(dashboard.netProfitMonth), 3249.44);
      assert.equal(dashboard.netProfitAccrual.config.plannedFixedMonthly, 3100);
      await create(500.55, { point: branch });
      await check({ car: sale.car, point: branch, date: '2026-10-27T13:00:00Z' });
      const branchReport = await run(() => new PointsBuilder(pool).build({ ...ctxFor(f), ids: [branch] }));
      assert.equal(branchReport.rows[0].expenses, 0, 'ids filter after company-wide visit attribution');
    });
  },
);

test(
  'PG: today is signed MTD delta across profit/loss and recurring-excess boundaries; future checks excluded',
  opts,
  async () => {
    await fixture(async (f) => {
      const { q, run, tenant, point, service, reports, clock, create, check } = f;
      await clock('2026-10-01T12:00:00Z');
      await create(0.01);
      await run(() => service.createFixedCost(tenant, { name: 'Monthly', monthlyAmount: 3100 }, point));
      const employee = randomUUID();
      await q("INSERT INTO users(id,tenant_id,full_name) VALUES($1,$2,'Admin')", [employee, tenant]);
      await q('INSERT INTO user_points VALUES($1,$2,$3)', [employee, tenant, point]);
      await run(() => service.upsertCompensation(tenant, { userId: employee, type: 'pct_profit', amount: 10 }));
      const rent = randomUUID();
      await q("INSERT INTO expense_categories VALUES($1,$2,'Actual rent',true)", [rent, tenant]);
      await q('INSERT INTO expenses(tenant_id,point_id,category_id,amount,date) VALUES($1,$2,$3,31000,now())', [
        tenant,
        point,
        rent,
      ]);
      await check({ revenue: 1000 });
      await check({ payment: 'warranty', cost: 2000, date: '2026-10-02T08:00:00Z' });
      const yesterday = (await run(() => reports.computeDashboardV2(tenant, 'month', point))).netProfitAccrual;
      assert.equal(yesterday.mtd.checkProfit, 1000, 'future warranty check excluded');
      assert.equal(yesterday.mtd.perVehicleDayExpense, 0.01);
      assert.deepEqual(yesterday.today, yesterday.mtd, 'first day delta is full MTD including calendar accrual');
      await clock('2026-10-02T12:00:00Z');
      let today = (await run(() => reports.computeDashboardV2(tenant, 'month', point))).netProfitAccrual;
      assert.equal(today.mtd.checkProfit, -1000);
      assert.equal(
        today.today.staffPctProfit,
        -100,
        'reverse previous positive MTD percentage; do not clamp daily loss to zero',
      );
      assert.equal(today.today.recurringExcess, 1000);
      for (const key of Object.keys(today.today))
        assert.equal(today.today[key], round(today.mtd[key] - yesterday.mtd[key]), `signed delta: ${key}`);
      // Opposite crossing: prior monthly loss -> positive month; excess decreases, signed credit is preserved.
      await q(
        "UPDATE checks SET payment_method='cash',total_revenue=12000,product_cost_total=0,profit=12000 WHERE date='2026-10-02T08:00:00Z'",
      );
      await q("UPDATE checks SET payment_method='warranty',product_cost_total=1000 WHERE date='2026-10-01T12:00:00Z'");
      today = (await run(() => reports.computeDashboardV2(tenant, 'month', point))).netProfitAccrual;
      assert.equal(today.today.staffPctProfit, 1100);
      assert.equal(today.today.recurringExcess, -200, 'declining MTD uncovered recurring component is a signed credit');
      assert.equal(today.today.plannedFixedAmortized, 100);
    });
  },
);

test(
  'PG: company timezone month boundary, pending state, null-point isolation and motivation accrued_at attribution',
  opts,
  async () => {
    await fixture(async (f) => {
      const { q, run, tenant, point, service, reports, clock, check, total } = f;
      await q("UPDATE tenants SET timezone='Asia/Vladivostok' WHERE id=$1", [tenant]);
      await clock('2026-10-31T22:30:00Z'); // Nov 1, 08:30 company time
      let row = await run(() =>
        service.createFixedCost(
          tenant,
          { name: 'Day', mode: 'per_vehicle_day', perVehicleDayAmount: 500.55, requestId: randomUUID() },
          point,
        ),
      );
      assert.equal(row.effectiveFrom, '2026-11-01');
      row = await run(() =>
        service.updateFixedCost(
          row.id,
          tenant,
          { perVehicleDayAmount: 600, revision: 1, requestId: randomUUID() },
          point,
        ),
      );
      assert.equal(row.pending.effectiveFrom, '2026-11-02');
      const car = randomUUID();
      await check({ car, revenue: 100, date: '2026-10-31T13:59:59Z' });
      await check({ car, revenue: 200, date: '2026-10-31T14:00:00Z' });
      await check({ car, revenue: 300, date: '2026-10-31T22:00:00Z' });
      await check({ car, revenue: 99999, date: '2026-11-01T14:00:00Z' });
      assert.equal(
        await total('2026-10-31', '2026-10-31', point, tenant, 'Asia/Vladivostok'),
        0,
        'no charge before effective local date',
      );
      assert.equal(await total('2026-11-01', '2026-11-01', point, tenant, 'Asia/Vladivostok'), 500.55);
      const historical = await check({ revenue: 0, date: '2026-10-29T12:00:00Z' });
      await q('INSERT INTO motivation_accruals VALUES($1,$2,$3,0.01,now())', [tenant, historical.id, randomUUID()]);
      await q(
        "INSERT INTO salary_premiums VALUES($1,$2,'cash',7,'2026-10',now()),($1,$2,'cash',3,'2026-11','2026-10-15T12:00:00Z')",
        [tenant, point],
      );
      await q(
        "INSERT INTO expenses(tenant_id,point_id,amount,date,period_month) VALUES($1,$2,11,now(),'2026-10'),($1,$2,2,'2026-10-15T12:00:00Z','2026-11')",
        [tenant, point],
      );
      const dashboard = await run(() => reports.computeDashboardV2(tenant, 'month', point));
      assert.equal(dashboard.netProfitAccrual.daysElapsed, 1);
      assert.equal(dashboard.revenueMonth, 500);
      assert.equal(dashboard.netProfitAccrual.mtd.perVehicleDayExpense, 500.55);
      assert.equal(
        dashboard.netProfitAccrual.mtd.motivation,
        0.01,
        'motivation belongs to accrued_at, not old check date',
      );
      assert.equal(dashboard.netProfitAccrual.mtd.salaryExtras, 3.01, 'assigned month preserved');
      assert.equal(dashboard.netProfitAccrual.mtd.oneOffExpenses, 2, 'expense assigned month preserved');
      assert.equal(dashboard.netProfitAccrual.today.netProfit, -5.56);
      assert.deepEqual(dashboard.netProfitAccrual.today, dashboard.netProfitAccrual.mtd);
      const nullPointCost = await run(() =>
        service.createFixedCost(
          tenant,
          { name: 'No point', mode: 'per_vehicle_day', perVehicleDayAmount: 100, requestId: randomUUID() },
          null,
        ),
      );
      assert.ok(nullPointCost.id);
      assert.equal(
        await total('2026-11-01', '2026-11-01', point, tenant, 'Asia/Vladivostok'),
        500.55,
        'null-point config cannot cover every branch',
      );
    });
  },
);

test('PG: fixed salaries and monthly costs accrue each calendar day even with no visits', opts, async () => {
  await fixture(async ({ q, run, tenant, point, service, reports, clock }) => {
    await clock('2026-10-04T12:00:00Z'); // Sunday: no checks or shifts
    await run(() => service.createFixedCost(tenant, { name: 'Rent', monthlyAmount: 31000 }, point));
    const employee = randomUUID();
    await q("INSERT INTO users(id,tenant_id,full_name) VALUES($1,$2,'Cleaner')", [employee, tenant]);
    await q('INSERT INTO user_points VALUES($1,$2,$3)', [employee, tenant, point]);
    await run(() => service.upsertCompensation(tenant, { userId: employee, type: 'fixed_monthly', amount: 15500 }));
    const accrual = (await run(() => reports.computeDashboardV2(tenant, 'month', point))).netProfitAccrual;
    assert.equal(accrual.today.plannedFixedAmortized, 1000);
    assert.equal(accrual.today.staffFixedAmortized, 500);
    assert.equal(accrual.today.netProfit, -1500);
    assert.equal(accrual.mtd.netProfit, -6000);
    assert.equal(accrual.projection.netProfit, -46500);
  });
});

test('PG: multiple-day vehicle totals retain exact cents and independent current parent state', opts, async () => {
  await fixture(async ({ q, run, tenant, point, create, clock, check, reports }) => {
    await clock('2026-10-01T12:00:00Z');
    const row = await create(500.55);
    for (const day of ['01', '02', '03']) await check({ date: `2026-10-${day}T12:00:00Z` });
    await q('UPDATE fixed_costs SET active=false WHERE id=$1', [row.id]);
    const financial = await run(() =>
      reports.getFinancial(tenant, { dateFrom: '2026-10-01', dateTo: '2026-10-03' }, point),
    );
    assert.equal(financial.perVehicleDayExpense, 1501.65, 'sum in kopecks, independent of current parent active flag');
  });
});
