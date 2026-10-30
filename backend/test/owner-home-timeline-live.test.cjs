const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, opts, bad } = require('./owner-home-timeline-fixture.cjs');
const { vehicleDayCosts, sumVehicleDayCosts } = require('../dist/common/vehicle-day-costs');
const { visitQuery } = require('../dist/reports/owner-home/owner-home-visits');
const { visitRange } = require('../dist/reports/owner-home/owner-home-dates');
const { timelineSnapshot } = require('../dist/reports/owner-home/owner-home-timeline');

const timeline = (f, period = 'day', asOf, point = f.point) =>
  f.run(() => f.service.timeline(f.tenant, point, { period, ...(asOf ? { asOf } : {}) }));
const cents = (value) => Math.round(value * 100);
function telescopes(value) {
  for (const [field, cumulative, opening] of [
    ['revenue', 'cumulativeRevenue', 'revenue'],
    ['netProfit', 'cumulativeNetProfit', 'netProfit'],
  ]) {
    let sum = cents(value.opening[opening]);
    for (const bucket of value.buckets) {
      sum += cents(bucket[field]);
      assert.equal(sum, cents(bucket[cumulative]));
      assert.ok(bucket.untilExclusive <= value.range.untilExclusive);
      assert.ok(bucket.from <= bucket.untilExclusive);
    }
    assert.equal(sum, cents(value.totals[field]));
    assert.equal(value.buckets.at(-1)[cumulative], value.totals[field]);
  }
}
async function plan(f, values = {}) {
  if (values.fixed)
    await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'monthly',$4,true)", [
      randomUUID(),
      f.tenant,
      f.point,
      values.fixed,
    ]);
  for (const [type, amount] of [
    ['fixed_monthly', values.staffFixed],
    ['pct_turnover', values.turnover],
    ['pct_profit', values.profit],
  ]) {
    if (!amount) continue;
    const user = randomUUID();
    await f.q('INSERT INTO users VALUES($1,$2)', [user, f.tenant]);
    await f.q('INSERT INTO user_points VALUES($1,$2,$3)', [user, f.tenant, f.point]);
    await f.q('INSERT INTO employee_compensation VALUES($1,$2,$3,$4,true)', [f.tenant, user, type, amount]);
  }
}
async function expense(
  f,
  amount,
  date,
  { assigned = null, recurring = false, name = 'Other', status = 'approved' } = {},
) {
  const category = randomUUID();
  await f.q('INSERT INTO expense_categories VALUES($1,$2,$3,$4)', [category, f.tenant, name, recurring]);
  await f.q(
    'INSERT INTO expenses(tenant_id,point_id,category_id,date,amount,period_month,approval_status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [f.tenant, f.point, category, date, amount, assigned, status],
  );
}
async function premium(f, amount, created, assigned = null, type = 'cash') {
  await f.q('INSERT INTO salary_premiums VALUES($1,$2,$3,$4,$5,$6)', [
    f.tenant,
    f.point,
    type,
    amount,
    assigned,
    created,
  ]);
}
async function fee(f, changes, point = f.point) {
  const id = randomUUID();
  await f.q("INSERT INTO fixed_costs VALUES($1,$2,$3,'per_vehicle_day',0,false)", [id, f.tenant, point]);
  for (const [date, amount, active = true, archived = false] of changes)
    await f.q('INSERT INTO fixed_cost_vehicle_history VALUES($1,$2,$3,1,$4,$5,$6)', [
      f.tenant,
      id,
      date,
      amount,
      active,
      archived,
    ]);
}

test(
  'PG16 timeline day/month reconcile every canonical component; opening allocates date-only costs and keeps real prefixes',
  opts,
  async () =>
    fixture(async (f) => {
      await plan(f, { fixed: 3100, staffFixed: 310, turnover: 5, profit: 10 });
      await expense(f, 25, '2026-10-28T21:00Z');
      await expense(f, 15, '2026-10-29T08:30Z');
      await expense(f, 9999, '2026-10-29T08:00Z', { name: 'Зарплата' });
      await expense(f, 9999, '2026-10-30T09:01Z');
      await expense(f, 9999, '2026-10-29T08:00Z', { status: 'pending' });
      await expense(f, 100, '2026-12-01T00:00Z', { assigned: '2026-10' });
      const client = await f.client(),
        car = await f.car(client);
      await f.check({ date: '2026-10-28T08:00Z', revenue: 1000, profit: 500 });
      const check = await f.check({ cid: client, carId: car, date: '2026-10-29T08:00Z', revenue: 2000, profit: 1000 });
      await fee(f, [['2026-10-01', 7]]);
      await premium(f, 30, '2026-10-29T08:00Z', '2026-10');
      await f.q(
        "INSERT INTO motivation_accruals VALUES($1,$2,10,'2026-10-29T08:00Z','margin_v1'),($1,$2,20,'2026-10-29T08:30Z','revenue_v2')",
        [f.tenant, check],
      );
      for (const period of ['day', 'month']) {
        const result = await timeline(f, period);
        const baseline = await f.run(() => f.legacy.computeDashboardV2(f.tenant, 'today', f.point));
        const canonical = await f.profit();
        const which = period === 'day' ? 'day' : 'mtd';
        assert.deepEqual(result.totals, canonical.current[which]);
        for (const key of Object.keys(baseline.netProfitAccrual.mtd))
          assert.equal(result.totals[key], baseline.netProfitAccrual[period === 'day' ? 'today' : 'mtd'][key], key);
        assert.deepEqual(result.footer, canonical);
        assert.equal(result.footer.generatedAt, result.generatedAt);
        telescopes(result);
        if (period === 'day') {
          assert.equal(result.opening.netProfit, -157); // 100 fixed + 10 fixed salary + 40 expenses + 7 vehicle.
          assert.equal(result.opening.revenue, 0);
          assert.equal(
            result.buckets.find((b) => b.untilExclusive === '2026-10-29T08:00:00.000Z').cumulativeRevenue,
            0,
          );
          assert.equal(result.buckets.at(-1).cumulativeRevenue, 2000);
          assert.equal(result.totals.motivation, 30);
          assert.equal(result.totals.salaryExtras, 60);
          assert.equal(result.totals.netProfit, 583);
        }
      }
    }),
);

test(
  'PG16 assigned premium appears at first-day opening, legacy creation day, but once in monthly/yearly accrual',
  opts,
  async () =>
    fixture(async (f) => {
      await premium(f, 100, '2026-10-29T08:00Z', '2026-10');
      await premium(f, 30, '2026-11-15T08:00Z', '2026-10');
      await premium(f, 999, '2026-10-29T08:00Z', '2026-09');
      await premium(f, 20, '2026-10-29T07:00Z');
      await premium(f, 9000, '2026-10-29T09:00Z');
      await premium(f, 8000, '2026-10-29T08:00Z', '2026-10', 'rate_bonus');
      const first = await timeline(f, 'day', '2026-10-01');
      assert.equal(first.opening.netProfit, -130);
      assert.equal(first.totals.salaryExtras, 130);
      const day = await timeline(f);
      assert.equal(day.opening.netProfit, 0);
      assert.equal(day.totals.salaryExtras, 120);
      const month = await timeline(f, 'month');
      assert.equal(month.totals.salaryExtras, 150);
      assert.equal(month.buckets.at(-1).netProfit, -20);
      const week = await timeline(f, 'week');
      assert.equal(week.totals.salaryExtras, 20);
      const year = await timeline(f, 'year');
      assert.equal(year.totals.salaryExtras, 1149);
      for (const value of [first, day, month, week, year]) telescopes(value);
    }),
);

test(
  'PG16 opening and endpoints preserve exact-midnight full planned day, assigned costs and no future facts',
  opts,
  async () =>
    fixture(async (f) => {
      await plan(f, { fixed: 3100 });
      await expense(f, 30, '2026-11-01T08:00Z', { assigned: '2026-10' });
      await premium(f, 40, '2026-11-01T08:00Z', '2026-10');
      for (const [day, net] of [
        ['2026-10-01', -170],
        ['2026-10-29', -100],
      ]) {
        const midnight = day === '2026-10-01' ? '2026-09-30T21:00:00Z' : '2026-10-28T21:00:00Z';
        f.clock(midnight);
        await f.check({ date: midnight, revenue: 500, profit: 500 });
        const value = await timeline(f);
        assert.equal(value.buckets.length, 1);
        assert.equal(value.opening.at, value.range.untilExclusive);
        assert.equal(value.opening.netProfit, net);
        assert.equal(value.buckets[0].netProfit, 0);
        assert.equal(value.totals.netProfit, net);
        assert.equal(value.totals.revenue, 0);
        assert.deepEqual(value.totals, (await f.profit()).current.day);
        telescopes(value);
        const month = await timeline(f, 'month');
        assert.deepEqual(month.totals, month.footer.current.mtd);
        telescopes(month);
      }
    }),
);

test('PG16 nonlinear profit share and recurring excess preserve signed reversals at actual prefixes', opts, async () =>
  fixture(async (f) => {
    await plan(f, { profit: 10 });
    await f.check({ date: '2026-10-28T08:00Z', revenue: 500, profit: 500 });
    await f.check({ date: '2026-10-29T07:00Z', revenue: -1000, profit: -1000, returned: true });
    const day = await timeline(f);
    assert.equal(day.totals.staffPctProfit, -50);
    assert.equal(day.totals.netProfit, -950);
    assert.equal(day.buckets.at(-1).cumulativeNetProfit, -950);
    await expense(f, 3100, '2026-10-29T08:00Z', { recurring: true });
    const recurring = await timeline(f);
    assert.equal(recurring.opening.netProfit, -2850); // Existing 50 of percentage coverage also applies at opening.
    assert.equal(recurring.totals.recurringExcess, 2900);
    assert.equal(recurring.totals.netProfit, -3850);
    assert.equal(
      recurring.buckets.find((b) => b.untilExclusive === '2026-10-29T08:00:00.000Z').cumulativeNetProfit,
      -3850,
    );
    telescopes(recurring);
    // Large positive facts can reverse a previously charged capped recurring cost.
    await f.check({ date: '2026-10-29T08:30Z', revenue: 40000, profit: 40000 });
    const reversal = await timeline(f, 'month');
    assert.equal(reversal.totals.recurringExcess, 0);
    assert.equal(reversal.totals.netProfit, 35550);
    telescopes(reversal);
  }),
);

test(
  'PG16 week crossing month/year uses RAW month differences; fractional plans telescope once rounded',
  opts,
  async () =>
    fixture(async (f) => {
      f.clock('2027-01-02T12:00Z');
      await plan(f, { fixed: 1, staffFixed: 2 });
      await premium(f, 7, '2026-12-30T08:00Z', '2026-12');
      await premium(f, 11, '2027-01-31T08:00Z', '2027-01');
      const result = await timeline(f, 'week', '2027-01-01');
      assert.equal(result.range.from, '2026-12-28');
      assert.equal(result.totals.plannedFixedAmortized, 0.16); // 5/31, not five rounded 0.03 days.
      assert.equal(result.totals.staffFixedAmortized, 0.32);
      assert.equal(result.totals.salaryExtras, 11);
      assert.equal(result.totals.netProfit, -11.48);
      telescopes(result);
      const year = await timeline(f, 'year', '2026-12-31');
      assert.equal(year.totals.plannedFixedAmortized, 12);
      assert.equal(year.totals.staffFixedAmortized, 24);
      assert.equal(year.totals.salaryExtras, 7);
      assert.equal(year.totals.netProfit, -43);
      assert.equal(year.buckets.length, 12);
      telescopes(year);
    }),
);

test('PG16 vehicle cost dedup precedes point scope, uses historical rates and final microsecond', opts, async () =>
  fixture(async (f) => {
    await fee(f, [
      ['2026-01-01', 10],
      ['2026-10-01', 20],
      ['2026-10-20', 50, false],
    ]);
    const c = await f.client(),
      car = await f.car(c),
      car2 = await f.car(c);
    await f.check({ cid: c, carId: car, date: '2026-09-30T08:00Z' });
    await f.check({ cid: c, carId: car, date: '2026-10-01T07:00Z', p: f.otherPoint });
    await f.check({ cid: c, carId: car, date: '2026-10-01T08:00Z' });
    await f.check({ cid: c, carId: car2, date: '2026-10-01T20:59:59.999999Z' });
    await f.check({ cid: c, carId: car2, date: '2026-10-01T21:00:00Z' });
    await f.check({ cid: c, carId: car, date: '2026-10-29T08:00Z' });
    for (const [day, expected] of [
      ['2026-09-30', 10],
      ['2026-10-01', 20],
      ['2026-10-02', 20],
      ['2026-10-29', 0],
    ]) {
      const value = await timeline(f, 'day', day);
      assert.equal(value.totals.perVehicleDayExpense, expected);
      assert.equal(value.opening.netProfit, expected ? -expected : 0);
      const common = await f.run(() =>
        vehicleDayCosts(f.scoped, {
          tenantId: f.tenant,
          pointId: f.point,
          tz: 'Europe/Moscow',
          dateFrom: day,
          dateTo: day,
        }),
      );
      assert.equal(value.totals.perVehicleDayExpense, sumVehicleDayCosts(common));
    }
    const year = await timeline(f, 'year');
    assert.equal(year.totals.perVehicleDayExpense, 50);
    telescopes(year);
  }),
);

test(
  'PG16 warranty, stored refunds, late corrections, negative/zero and after-cutoff facts do not get double counted',
  opts,
  async () =>
    fixture(async (f) => {
      await expense(f, 9999, '2026-10-29T09:00Z');
      const check = await f.check({ date: '2026-10-29T07:00Z', revenue: 200, profit: 100, returned: true });
      await f.check({
        date: '2026-10-29T08:00Z',
        revenue: 999,
        profit: 999,
        payment: 'warranty',
        cost: 30,
        salary: 10,
        productSalary: 5,
      });
      await f.check({ date: '2026-10-29T08:59:59.999999Z', revenue: -10, profit: -20 });
      await f.check({ date: '2026-10-29T09:00:00Z', revenue: 10000, profit: 10000 });
      await f.check({ date: '2026-10-29T10:00Z', revenue: 10000, profit: 10000 });
      await f.check({ date: '2026-10-29T07:00Z', revenue: 10000, profit: 10000, deleted: '2026-10-29T08:00Z' });
      await f.check({ date: '2026-10-29T07:00Z', revenue: 10000, profit: 10000, deferred: true });
      await f.check({ date: '2026-10-29T07:00Z', revenue: 10000, profit: 10000, tid: f.foreign });
      await f.check({ date: '2026-10-29T07:00Z', revenue: 10000, profit: 10000, p: f.otherPoint });
      let value = await timeline(f);
      assert.equal(value.totals.revenue, 190);
      assert.equal(value.totals.checkProfit, 35);
      await f.q('UPDATE checks SET profit=-100,total_revenue=0 WHERE id=$1', [check]);
      value = await timeline(f);
      assert.equal(value.totals.netProfit, -165);
      assert.equal(value.historicalSnapshot, false);
      telescopes(value);
      const empty = await timeline(f, 'day', '2026-01-01');
      assert.equal(empty.totals.netProfit, 0);
      assert.equal(empty.footer.comparison.mtdDelta.percent, null);
      await assert.rejects(() => timeline(f, 'day', '2026-10-30'), bad(400));
    }),
);

test(
  'PG16 annual cohorts, tenant-wide history, private previous details and both keysets exceed 50 without truncation',
  opts,
  async () =>
    fixture(async (f) => {
      const clients = [];
      for (let i = 0; i < 61; i++) {
        const cid = await f.client({ p: f.otherPoint }),
          car = await f.car(cid);
        clients.push(cid);
        await f.check({ cid, carId: car, date: '2025-12-30T08:00Z', p: f.otherPoint });
        await f.check({ cid, carId: car, date: '2026-01-01T08:00Z', payment: 'warranty' });
        const previous = await f.check({ cid, carId: car, date: '2026-10-28T08:00Z', p: f.otherPoint });
        await f.q("INSERT INTO check_service_lines(check_id,name) VALUES($1,'PRIVATE')", [previous]);
        await f.check({ cid, carId: car, date: '2026-10-29T07:00Z', returned: true });
        await f.check({ cid, carId: car, date: '2026-10-29T08:00Z' });
      }
      const fresh = await f.client(),
        freshCar = await f.car(fresh);
      await f.check({ cid: fresh, carId: freshCar, date: '2026-02-01T08:00Z' });
      const retail = await f.client({ retail: true }),
        retailCar = await f.car(retail);
      await f.check({ cid: retail, carId: retailCar, date: '2026-02-01T08:00Z' });
      await f.check({ tid: f.foreign, date: '2026-10-29T08:00Z', profit: 9999 });
      const query = (await timeline(f, 'year')).visitsRange;
      let summary = await f.run(() => f.service.visits(f.tenant, f.point, query));
      assert.equal(summary.servedClients, 62);
      assert.equal(summary.newClients, 1);
      assert.equal(summary.returningClients, 61);
      assert.equal(summary.visitCount, 123);
      assert.equal(summary.rapidReturnVehicleCount, 61);
      assert.equal(summary.rapidReturnVisitCount, 122);
      assert.equal((await f.run(() => f.scoped.query('SELECT current_user'))).rows[0].current_user, 'autexa_app');
      assert.equal(
        (await f.run(() => f.scoped.query('SELECT COUNT(*) FROM checks WHERE tenant_id=$1', [f.foreign]))).rows[0]
          .count,
        '0',
      );
      await f.q('UPDATE tenants SET points_shared_clients=false WHERE id=$1', [f.tenant]);
      for (const kind of ['clients', 'rapidReturns']) {
        let cursor;
        const seen = [];
        do {
          const page = await f.run(() =>
            f.service[kind](f.tenant, f.point, {
              ...query,
              cohort: 'returning',
              limit: 50,
              ...(cursor ? { cursor } : {}),
            }),
          );
          assert.equal(page.total, 61);
          assert.ok(page.items.length <= 50);
          for (const row of page.items) {
            seen.push(kind === 'clients' ? row.clientId : row.carId);
            if (kind === 'clients') assert.equal(row.canOpenClientHistory, false);
            else {
              assert.equal(row.previousDetailsRestricted, true);
              assert.equal(row.canOpenCarHistory, false);
              assert.deepEqual(row.previousChecks, []);
              assert.deepEqual(row.previousWorks, []);
              for (const link of row.currentChecks) assert.deepEqual(Object.keys(link).sort(), ['id', 'number']);
            }
          }
          cursor = page.nextCursor;
          if (cursor)
            await assert.rejects(
              () =>
                f.run(() =>
                  f.service[kind](f.tenant, f.point, { ...query, from: '2026-02-01', cohort: 'returning', cursor }),
                ),
              bad(400),
            );
        } while (cursor);
        assert.equal(seen.length, 61);
        assert.equal(new Set(seen).size, 61);
      }
      await f.q('UPDATE tenants SET points_shared_clients=true WHERE id=$1', [f.tenant]);
      const shared = await f.run(() => f.service.clients(f.tenant, f.point, { ...query, cohort: 'returning' }));
      assert.ok(shared.items.every((row) => row.canOpenClientHistory));
    }),
);

test(
  'PG16 one captured clock/repeatable-read snapshot holds footer and points together across a concurrent correction',
  opts,
  async () =>
    fixture(async (f) => {
      const id = await f.check({ date: '2026-10-29T08:00Z', revenue: 100, profit: 100 });
      const connect = f.scoped.connect.bind(f.scoped);
      let corrected = false;
      f.scoped.connect = async () => {
        const client = await connect();
        const query = client.query.bind(client);
        client.query = async (...args) => {
          const result = await query(...args);
          if (!corrected && typeof args[0] === 'string' && args[0].includes('SELECT timezone,points_shared_clients')) {
            corrected = true;
            await f.q('UPDATE checks SET profit=200,total_revenue=200 WHERE id=$1', [id]);
          }
          return result;
        };
        return client;
      };
      const value = await timeline(f, 'month');
      assert.equal(corrected, true);
      assert.equal(value.totals.revenue, 100);
      assert.equal(value.footer.current.day.revenue, 100);
      assert.equal(value.footer.current.mtd.revenue, 100);
      assert.equal(value.generatedAt, value.footer.generatedAt);
      assert.equal(value.range.untilExclusive, value.footer.current.period.untilExclusive);
      assert.equal(
        f.events.filter((e) => e.sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').length,
        1,
      );
      telescopes(value);
      assert.equal((await timeline(f, 'month')).totals.revenue, 200);
    }),
);

test(
  'PG16 year has bounded SQL and payload at 36,600 scoped checks plus foreign traffic; actual EXPLAIN stays indexed',
  opts,
  async () =>
    fixture(async (f) => {
      f.clock('2029-01-01T09:00Z');
      await f.q(
        `WITH seeded AS (
    INSERT INTO clients(id,tenant_id,point_id,full_name,is_retail,created_at)
    SELECT gen_random_uuid(),$1,$2,'Volume',false,'2020-01-01T00:00Z'::timestamptz FROM generate_series(1,600) RETURNING id
  ) INSERT INTO cars(id,tenant_id,client_id,plate_number,make_model)
    SELECT gen_random_uuid(),$1,id,'TEST','Volume' FROM seeded`,
        [f.tenant, f.point],
      );
      await f.q(
        `WITH vehicles AS (SELECT id,client_id,row_number() OVER(ORDER BY id) AS n FROM cars WHERE tenant_id=$1)
    INSERT INTO checks(id,tenant_id,point_id,client_id,car_id,date,total_revenue,profit)
    SELECT gen_random_uuid(),$1,$2,v.client_id,v.id,
      '2027-12-31T21:00Z'::timestamptz + ((g.i-1)%366)*interval '1 day' + interval '8 hours',10,5
    FROM generate_series(1,36600) g(i) JOIN vehicles v ON v.n=((g.i-1)%600)+1`,
        [f.tenant, f.point],
      );
      await f.q(
        `INSERT INTO checks(id,tenant_id,point_id,date,total_revenue,profit)
    SELECT gen_random_uuid(),$1,$2,'2027-12-31T21:00Z'::timestamptz+((i-1)%366)*interval '1 day'+interval '8 hours',99999,99999
    FROM generate_series(1,20000) g(i)`,
        [f.foreign, f.point],
      );
      await fee(f, [
        ['2028-01-01', 1],
        ['2028-07-01', 2],
      ]);
      await plan(f, { fixed: 1, staffFixed: 2, turnover: 3, profit: 4 });
      await f.q('ANALYZE');
      const counts = [];
      let yearEvents, year;
      for (const period of ['day', 'week', 'month', 'year']) {
        f.events.length = 0;
        const value = await timeline(f, period, '2028-12-31');
        counts.push(f.events.length);
        assert.equal(f.events.filter((e) => e.sql.startsWith('WITH windows AS')).length, 5);
        assert.equal(f.events.filter((e) => e.sql.includes('FROM employee_compensation')).length, 1);
        assert.equal(f.events.filter((e) => e.sql.includes("fc.mode='monthly'")).length, 1);
        assert.ok(Buffer.byteLength(JSON.stringify(value)) < 18000);
        telescopes(value);
        if (period === 'year') {
          year = value;
          yearEvents = [...f.events];
        }
      }
      assert.deepEqual(counts, [10, 10, 10, 10]);
      assert.equal(year.totals.revenue, 366000);
      assert.equal(year.totals.checkProfit, 183000);
      assert.equal(year.totals.plannedFixedAmortized, 12);
      assert.equal(year.totals.staffFixedAmortized, 24);
      assert.equal(year.buckets.length, 12);
      const timing = [];
      await f.run(async () => {
        const client = await f.scoped.connect();
        try {
          await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
          for (const event of yearEvents.filter(
            (e) =>
              e.sql.startsWith('WITH windows AS') &&
              (e.sql.includes('LEFT JOIN checks c') || e.sql.includes('visits AS')),
          )) {
            const result = await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${event.sql}`, event.params);
            const output = result.rows[0]['QUERY PLAN'][0];
            assert.ok(output['Execution Time'] < 10000, 'bounded year query exceeded ten seconds');
            assert.match(JSON.stringify(output.Plan), /checks_(tenant_point_money_date|vehicle_days_idx)/);
            timing.push({
              source: event.sql.includes('visits AS') ? 'vehicle' : 'money',
              executionMs: output['Execution Time'],
              planningMs: output['Planning Time'],
            });
          }
          const range = visitRange('2028-01-01', '2028-12-31', 'Europe/Moscow', new Date('2029-01-01T09:00Z'));
          const q = visitQuery({ tenant: f.tenant, point: f.point, tz: 'Europe/Moscow', shared: true, ...range });
          const result = await client.query(
            `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${q.cte} SELECT COUNT(*) FROM client_cohorts`,
            q.params,
          );
          const output = result.rows[0]['QUERY PLAN'][0];
          assert.ok(output['Execution Time'] < 10000);
          timing.push({ source: 'visits', executionMs: output['Execution Time'], planningMs: output['Planning Time'] });
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      });
      console.log(
        JSON.stringify({
          ownerHomeTimelineScopedChecks: 36600,
          foreignChecks: 20000,
          queriesPerPeriod: counts,
          yearBytes: Buffer.byteLength(JSON.stringify(year)),
          plans: timing,
        }),
      );
    }),
);

test('PG16 leap year empty months use current plan and prior-month footer clamps to February 29', opts, async () =>
  fixture(async (f) => {
    f.clock('2028-04-01T12:00Z');
    await plan(f, { fixed: 100 });
    let result = await timeline(f, 'year', '2028-03-01');
    assert.equal(result.totals.plannedFixedAmortized, 203.23);
    assert.equal(result.totals.netProfit, -203.23);
    assert.deepEqual(
      result.buckets.map((b) => b.localDate),
      ['2028-01-31', '2028-02-29', '2028-03-01'],
    );
    telescopes(result);
    await f.check({ date: '2028-02-29T20:59:59.999999Z', revenue: 12, profit: 12 });
    await f.check({ date: '2028-02-29T21:00:00Z', revenue: 20, profit: 20 });
    result = await timeline(f, 'day', '2028-03-31');
    assert.equal(result.footer.comparison.clamped, true);
    assert.equal(result.footer.comparison.period.through, '2028-02-29');
    assert.equal(result.footer.comparison.day.revenue, 12);
    const month = await timeline(f, 'month', '2028-02-29');
    assert.equal(month.totals.revenue, 12);
    assert.deepEqual(month.totals, month.footer.current.mtd);
  }),
);

test(
  'PG16 timeline helper supports DST actual instants; recurring no-plan expenses allocate at opening',
  opts,
  async () =>
    fixture(async (f) => {
      await f.check({ date: '2026-03-08T06:30:00Z', revenue: 10, profit: 10 });
      await f.check({ date: '2026-03-08T07:30:00Z', revenue: 20, profit: 20 });
      await f.check({ date: '2026-11-01T05:30:00Z', revenue: 30, profit: 30 });
      await f.check({ date: '2026-11-01T06:30:00Z', revenue: 40, profit: 40 });
      await expense(f, 2, '2026-11-01T04:00:00Z', { recurring: true });
      for (const [day, hours, revenue] of [
        ['2026-03-08', 23, 30],
        ['2026-11-01', 25, 70],
      ]) {
        await f.run(async () => {
          const client = await f.scoped.connect();
          try {
            await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
            // Public tenant settings still normalize to the existing RU whitelist;
            // exercise the underlying date/finance path in a real DST zone directly.
            const value = await timelineSnapshot(
              client,
              f.tenant,
              f.point,
              'America/New_York',
              new Date('2026-12-01T12:00Z'),
              { period: 'day', asOf: day },
            );
            assert.equal(value.buckets.length, hours);
            assert.equal(value.totals.revenue, revenue);
            if (day === '2026-11-01') {
              assert.equal(value.opening.netProfit, -2);
              assert.equal(
                value.buckets.find((b) => b.untilExclusive === '2026-11-01T06:00:00.000Z').cumulativeRevenue,
                30,
              );
              assert.equal(
                value.buckets.find((b) => b.untilExclusive === '2026-11-01T07:00:00.000Z').cumulativeRevenue,
                70,
              );
            }
            telescopes(value);
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        });
      }
    }),
);

test(
  'PG16 date-only recurring costs allocate before UTC-midnight/03:00 Moscow, with actual prefix coverage and no future costs',
  opts,
  async () =>
    fixture(async (f) => {
      await plan(f, { profit: 10 });
      await f.check({ date: '2026-10-28T08:00Z', revenue: 500, profit: 500 });
      await expense(f, 3100, '2026-10-29T00:00:00Z', { recurring: true });
      await expense(f, 31000, '2026-10-29T09:00:00Z', { recurring: true });
      await f.check({ date: '2026-10-29T08:00Z', revenue: 10000, profit: 10000 });
      const value = await timeline(f);
      assert.equal(value.opening.netProfit, -2850);
      for (const until of ['2026-10-29T00:00:00.000Z', '2026-10-29T01:00:00.000Z', '2026-10-29T08:00:00.000Z'])
        assert.equal(value.buckets.find((b) => b.untilExclusive === until).cumulativeNetProfit, -2850, until);
      assert.equal(value.totals.staffPctProfit, 1000);
      assert.equal(value.totals.recurringExcess, 1850);
      assert.equal(value.totals.netProfit, 7150);
      assert.deepEqual(value.totals, value.footer.current.day);
      assert.deepEqual(value.footer, await f.profit());
      telescopes(value);
    }),
);
