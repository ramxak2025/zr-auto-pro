const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { SalaryService } = require('../dist/salary/salary.service');
const { DashboardService } = require('../dist/dashboard/dashboard.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { zonedMidnight, zonedDateKey } = require('../dist/common/timezone');
const live = process.env.OCT26_DASHBOARD_TEST_DB;

test('homepage saved earnings and scoped attention on disposable PostgreSQL', { skip: !live }, async (t) => {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55446');
  assert.equal(url.pathname, '/autexa_oct26_dashboard');
  const admin = new Pool({ connectionString: live });
  const schema = `dashboard_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: live, options: `-c search_path=${schema},pg_catalog` });
  const q = (sql, params = []) => pool.query(sql, params);
  const tenant = randomUUID(),
    otherTenant = randomUUID(),
    point = randomUUID(),
    otherPoint = randomUUID();
  const master = randomUUID(),
    executor = randomUUID(),
    zero = randomUUID(),
    outsider = randomUUID(),
    foreign = randomUUID();
  const realDate = Date;
  let now = '2026-10-26T12:00:00Z';
  const setClock = async (value) => {
    now = value;
    await q(
      `CREATE OR REPLACE FUNCTION ${schema}.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${value}'::timestamptz $$`,
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
      CREATE TABLE tenants(id uuid PRIMARY KEY, timezone text, is_active boolean DEFAULT true);
      CREATE TABLE roles(id uuid,tenant_id uuid,matrix jsonb);
      CREATE TABLE users(id uuid PRIMARY KEY, tenant_id uuid, full_name text, avatar text, role text, salary_percent numeric DEFAULT 0,
        product_salary_percent numeric DEFAULT 0, role_id uuid, is_active boolean DEFAULT true, dismissed_at timestamptz,purged_at timestamptz);
      CREATE TABLE user_points(user_id uuid,tenant_id uuid,point_id uuid);
      CREATE TABLE tenant_points(id uuid,tenant_id uuid,is_active boolean);
      CREATE FUNCTION autexa_point_is_allowed(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE TABLE checks(id uuid PRIMARY KEY,tenant_id uuid,point_id uuid,master_id uuid,date timestamptz,is_deferred boolean DEFAULT false,
        deleted_at timestamptz,is_returned boolean DEFAULT false,product_salary_total numeric DEFAULT 0,total_revenue numeric DEFAULT 0);
      CREATE TABLE check_service_lines(check_id uuid,master_id uuid,salary_amount numeric);
      CREATE TABLE motivation_accruals(tenant_id uuid,check_id uuid,employee_id uuid,amount numeric,accrued_at timestamptz);
      CREATE TABLE salary_premiums(id uuid,tenant_id uuid,point_id uuid,user_id uuid,type text,amount numeric,period_month_year text,
        created_at timestamptz,awarded_by uuid,bonus_percent numeric,reason text);
      CREATE TABLE salary_penalties(id uuid,tenant_id uuid,point_id uuid,user_id uuid,amount numeric,date timestamptz,created_by uuid,comment text);
      CREATE TABLE salary_payments(id uuid,tenant_id uuid,point_id uuid,user_id uuid,amount numeric,date timestamptz,month_year text,
        reversed_at timestamptz,created_by uuid,type text);
      CREATE TABLE salary_payment_confirmations(payment_id uuid,user_id uuid,confirmed_at timestamptz);
      CREATE TABLE salary_payouts(tenant_id uuid,point_id uuid,employee_id uuid,amount numeric,status text,period_month text,created_at timestamptz);
      CREATE TABLE master_rate_history(tenant_id uuid,user_id uuid,month text,salary_percent numeric,product_salary_percent numeric);
      CREATE TABLE purchase_orders(tenant_id uuid,point_id uuid,status text);
      CREATE TABLE warehouses(id uuid,point_id uuid);
      CREATE TABLE products(tenant_id uuid,warehouse_id uuid,stock numeric,min_stock numeric,deleted_at timestamptz);
      CREATE TABLE installment_plans(tenant_id uuid,check_id uuid,status text,next_payment_date date);
      CREATE TABLE public_booking_requests(id uuid,tenant_id uuid,point_id uuid,resource_id uuid,status text);
      CREATE TABLE bookings(public_request_id uuid,tenant_id uuid,status text);
    `);
    await q(`ALTER TABLE checks ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN client_id uuid, ADD COLUMN car_id uuid;
      ALTER TABLE check_service_lines ADD COLUMN price_excess numeric DEFAULT 0;
      ALTER TABLE tenant_points ADD COLUMN name text;
      CREATE TABLE clients(id uuid,tenant_id uuid,full_name text,phone text);
      CREATE TABLE cars(id uuid,tenant_id uuid,plate_number text,make_model text,vin text);
      CREATE TABLE check_tag_links(check_id uuid,tenant_id uuid,tag_id uuid);
      CREATE TABLE check_tag_defs(id uuid,name text,color text);`);
    await setClock(now);
    await q('INSERT INTO tenants VALUES($1,$2,true),($3,$2,true)', [tenant, 'Europe/Moscow', otherTenant]);
    for (const [id, name, role, tid] of [
      [master, 'Check owner', 'master', tenant],
      [executor, 'Substitute executor', 'master', tenant],
      [zero, 'Zero admin', 'admin', tenant],
      [outsider, 'Other branch', 'master', tenant],
      [foreign, 'Other tenant', 'master', otherTenant],
    ]) {
      await q('INSERT INTO users(id,tenant_id,full_name,role) VALUES($1,$2,$3,$4)', [id, tid, name, role]);
      await q('INSERT INTO user_points VALUES($1,$2,$3)', [
        id,
        tid,
        id === executor || id === outsider ? otherPoint : point,
      ]);
    }
    const salary = new SalaryService(pool, undefined, undefined, { buildShiftFilter: async () => null });
    const check = async ({
      owner = master,
      at = now,
      tid = tenant,
      branch = point,
      product = 0,
      deferred = false,
      deleted = null,
      returned = false,
      amount = 0,
      worker = null,
    } = {}) => {
      const id = randomUUID();
      await q(
        'INSERT INTO checks(id,tenant_id,point_id,master_id,date,is_deferred,deleted_at,is_returned,product_salary_total,total_revenue) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,10000)',
        [id, tid, branch, owner, at, deferred, deleted, returned, product],
      );
      await q('INSERT INTO check_service_lines(check_id,master_id,salary_amount) VALUES($1,$2,$3)', [
        id,
        worker,
        amount,
      ]);
      return id;
    };
    const result = () => salary.getTodayEarnings(tenant, point);
    const earned = async (id) => (await result()).employees.find((e) => e.id === id)?.earnedAmount;
    await check({ amount: 5000 });
    await q("INSERT INTO salary_payouts VALUES($1,$2,$3,2000,'accepted',NULL,$4)", [tenant, point, master, now]);
    await t.test(
      '5000 earned and 2000 advance still shows5000; penalty300 =>4700; matches existing salary formula',
      async () => {
        assert.equal(await earned(master), 5000);
        await q("INSERT INTO salary_penalties VALUES($1,$2,$3,$4,300,$5,$4,'fine')", [
          randomUUID(),
          tenant,
          point,
          master,
          now,
        ]);
        assert.equal(await earned(master), 4700);
        const old = (
          await salary.getAll(tenant, { dateFrom: '2026-10-26', dateTo: '2026-10-26' }, point, { carryOver: false })
        ).find((r) => r.masterId === master);
        assert.equal(old.remainingAmount, 2700);
        assert.equal(old.paidAmount, 2000);
        assert.equal(await earned(master), old.totalEarnings - old.penaltiesAmount);
        assert.equal(await earned(master), old.remainingAmount + old.paidAmount);
      },
    );
    await t.test(
      'executor service, checkowner product, split cents, zero admin, substitute membership, tenant/branch isolation',
      async () => {
        const id = await check({ amount: 12.34, worker: executor, product: 20.01 });
        await q('INSERT INTO motivation_accruals VALUES($1,$2,$3,0.03,$4),($1,$2,$5,0.02,$4)', [
          tenant,
          id,
          executor,
          now,
          master,
        ]);
        assert.equal(await earned(executor), 12.37);
        assert.equal(await earned(master), 4720.03);
        assert.equal(await earned(zero), 0);
        assert.equal(await earned(outsider), undefined);
        assert.equal(await earned(foreign), undefined);
        await check({ owner: foreign, tid: otherTenant, amount: 99999 });
        await check({ branch: otherPoint, amount: 88888 });
        assert.equal(await earned(master), 4720.03);
      },
    );
    await t.test(
      'full/partial returns preserve baked salary; ledger reductions flow through; drafts/deleted excluded',
      async () => {
        const full = await check({ amount: 100, returned: true });
        const partial = await check({ amount: 50, returned: true, product: 5 });
        await q('INSERT INTO motivation_accruals VALUES($1,$2,$3,0.04,$4)', [tenant, partial, master, now]);
        const before = await earned(master);
        assert.equal(before, 4875.07);
        await q('UPDATE motivation_accruals SET amount=0.02 WHERE check_id=$1', [partial]);
        assert.equal(await earned(master), 4875.05);
        await check({ amount: 10000, deferred: true });
        await check({ amount: 10000, deleted: now });
        assert.equal(await earned(master), 4875.05);
        assert.ok(full);
      },
    );
    await t.test(
      'cash only, no ratebonus doubling, negative allowed; firstday and pastmonth attribution use existing salary rule',
      async () => {
        await q(
          "INSERT INTO salary_premiums VALUES($1,$2,$3,$4,'cash',10.01,NULL,$5,$4,NULL,'bonus'),($1,$2,$3,$4,'rate_bonus',999,NULL,$5,$4,10,'rate')",
          [randomUUID(), tenant, point, master, now],
        );
        assert.equal(await earned(master), 4885.06);
        await q("INSERT INTO salary_penalties VALUES($1,$2,$3,$4,0.05,$5,$4,'fine')", [
          randomUUID(),
          tenant,
          point,
          zero,
          now,
        ]);
        assert.equal(await earned(zero), -0.05);
        await q(
          "INSERT INTO salary_premiums VALUES($1,$2,$3,$4,'cash',77.03,'2026-11',$5,$4,NULL,'assigned'),($1,$2,$3,$4,'cash',88,'2026-10',$5,$4,NULL,'past')",
          [randomUUID(), tenant, point, master, now],
        );
        await setClock('2026-11-01T12:00:00Z');
        assert.equal(await earned(master), 77.03);
        const old = (
          await salary.getAll(tenant, { dateFrom: '2026-11-01', dateTo: '2026-11-01' }, point, { carryOver: false })
        ).find((r) => r.masterId === master);
        assert.equal(await earned(master), old.totalEarnings - old.penaltiesAmount);
      },
    );
    await t.test('Moscow and Vladivostok midnight half-open day boundaries', async () => {
      for (const tz of ['Europe/Moscow', 'Asia/Vladivostok']) {
        const tid = randomUUID();
        await q('INSERT INTO tenants VALUES($1,$2,true)', [tid, tz]);
        const uid = randomUUID();
        await q("INSERT INTO users(id,tenant_id,full_name,role) VALUES($1,$2,'Boundary','master')", [uid, tid]);
        await setClock('2026-12-02T15:00:00Z');
        const day = zonedDateKey(new Date(), tz),
          [y, m, d] = day.split('-').map(Number);
        const from = zonedMidnight(tz, y, m - 1, d).getTime(),
          to = zonedMidnight(tz, y, m - 1, d + 1).getTime();
        for (const [instant, amount] of [
          [from - 1, 1000],
          [from, 1.01],
          [to - 1, 2.02],
          [to, 2000],
        ])
          await check({ tid, owner: uid, at: new realDate(instant).toISOString(), amount });
        const data = await salary.getTodayEarnings(tid, null);
        assert.equal(data.employees[0].earnedAmount, 3.03);
        assert.equal(data.date, day);
      }
    });
    await setClock('2026-10-26T12:00:00Z');
    await t.test(
      'deferred own destination matches count: author only, executor-only excluded; all remains broad',
      async () => {
        const tid = randomUUID(),
          self = randomUUID(),
          peer = randomUUID();
        await q('INSERT INTO tenants VALUES($1,$2,true)', [tid, 'Europe/Moscow']);
        for (const id of [self, peer])
          await q("INSERT INTO users(id,tenant_id,full_name,role) VALUES($1,$2,'Author','master')", [id, tid]);
        const own = await check({ tid, owner: self, deferred: true });
        const executorOnly = await check({ tid, owner: peer, worker: self, deferred: true });
        const actor = {
          tenantID: tid,
          userID: self,
          role: 'master',
          currentPointId: point,
          permissions: {
            checks_view: true,
            checks_view_all: false,
            bookings_access: false,
            suppliers_access: false,
            warehouse_access: false,
            debts_manage: false,
          },
        };
        const checks = new ChecksService(pool);
        const list = await checks.getAll(tid, { isDeferred: true, masterId: self }, actor);
        assert.deepEqual(
          list.data.map((c) => c.id),
          [own],
        );
        assert.equal(list.total, 1);
        const attention = await new DashboardService(pool).attention(actor);
        assert.equal(attention.buckets[0].count, list.total);
        const broadOwn = await checks.getAll(tid, { isDeferred: true }, actor);
        assert.equal(broadOwn.total, 2, 'executor-only visibility is broader than reminder ownership');
        actor.permissions.checks_view_all = true;
        const all = await checks.getAll(tid, { isDeferred: true }, actor);
        assert.equal(all.total, 2);
        assert.ok(all.data.some((c) => c.id === executorOnly));
        assert.equal((await new DashboardService(pool).attention(actor)).buckets[0].count, all.total);
      },
    );
    await t.test(
      'exact attention counts beyond reminder caps, own/all scope, pending/cancelled, partialorders, lowstock and overdue only',
      async () => {
        for (let i = 0; i < 205; i++) await check({ deferred: true });
        await check({ deferred: true, owner: executor });
        await check({ deferred: true, branch: otherPoint });
        await q(
          "INSERT INTO purchase_orders VALUES($1,$2,'ordered'),($1,$2,'ordered'),($1,$2,'received'),($1,$3,'ordered')",
          [tenant, point, otherPoint],
        );
        const wh = randomUUID(),
          otherwh = randomUUID();
        await q('INSERT INTO warehouses VALUES($1,$2),($3,$4)', [wh, point, otherwh, otherPoint]);
        await q(
          'INSERT INTO products VALUES($1,$2,1,1,NULL),($1,$2,0,0,NULL),($1,$2,2,1,NULL),($1,$2,0,1,$3),($1,$4,0,1,NULL)',
          [tenant, wh, now, otherwh],
        );
        const pc = await check(),
          otherpc = await check({ branch: otherPoint });
        await q(
          "INSERT INTO installment_plans VALUES($1,$2,'open','2026-10-25'),($1,$2,'open','2026-10-26'),($1,$2,'open','2026-10-27'),($1,$2,'closed','2026-10-01'),($1,$3,'open','2026-10-01')",
          [tenant, pc, otherpc],
        );
        const pending = randomUUID(),
          cancelled = randomUUID();
        await q(
          "INSERT INTO public_booking_requests VALUES($1,$3,$4,$5,'pending'),($2,$3,$4,$5,'pending'),($6,$3,$4,$7,'pending')",
          [pending, cancelled, tenant, point, master, randomUUID(), executor],
        );
        await q("INSERT INTO bookings VALUES($1,$2,'cancelled')", [cancelled, tenant]);
        const roleId = randomUUID();
        await q('INSERT INTO roles VALUES($1,$2,$3)', [roleId, tenant, { bookings: { view: true } }]);
        await q('UPDATE users SET role_id=$1 WHERE id=$2', [roleId, master]);
        const actor = {
          tenantID: tenant,
          userID: master,
          role: 'master',
          currentPointId: point,
          permissions: {
            checks_view: true,
            checks_view_all: false,
            bookings_access: true,
            suppliers_access: true,
            warehouse_access: true,
            debts_manage: true,
          },
        };
        const attention = new DashboardService(pool);
        const data = await attention.attention(actor);
        assert.deepEqual(Object.fromEntries(data.buckets.map((b) => [b.id, b.count])), {
          bookings: 1,
          deferred: 206,
          'purchase-orders': 2,
          'low-stock': 1,
          installments: 1,
        });
        actor.permissions.checks_view_all = true;
        assert.equal((await attention.attention(actor)).buckets.find((b) => b.id === 'deferred').count, 207);
      },
    );
  } finally {
    global.Date = realDate;
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
