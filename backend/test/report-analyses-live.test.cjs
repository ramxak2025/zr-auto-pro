// Explicit disposable PostgreSQL 16 only. All fixture objects are TEMP tables
// on one connection; no .env/DATABASE_URL fallback and no production queries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadAnalysis } = require('../dist/reports/builder/analysis-query');
const { SalesBuilder, GrossProfitBuilder, AbcBuilder } = require('../dist/reports/builder/builders/analyses.builder');
const { ProductsBuilder } = require('../dist/reports/builder/builders/products.builder');
const { checkAggregate } = require('../dist/reports/builder/report-shared-queries');
const live = process.env.OCT30_REPORT_ANALYSES_TEST_DB;

async function fixture(work) {
  const url = new URL(live);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  const ownedLocal =
    url.port === '55457' && url.pathname === '/autexa_oct29_owner' && url.username === 'oct29_owner_admin';
  const ownedCi =
    process.env.CI === 'true' &&
    url.port === '55438' &&
    url.pathname === '/autexa_oct8_test' &&
    url.username === 'oct8_fixture';
  assert.ok(ownedLocal || ownedCi, 'Only the named disposable local/CI PostgreSQL fixture is permitted');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  const db = new Client({ connectionString: live, statement_timeout: 10000 });
  await db.connect();
  const tenant = randomUUID(),
    point = randomUUID();
  const ctx = {
    tenantId: tenant,
    pointId: point,
    tz: 'Europe/Moscow',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    days: 31,
    refDate: '2026-10-31',
    ids: [],
    groupBy: 'all',
    def: { id: 'sales' },
    actor: { tenantID: tenant, userID: randomUUID(), role: 'director', currentPointId: point },
    companyName: 'Fixture',
    pointName: 'Main',
  };
  try {
    assert.match((await db.query('SHOW server_version')).rows[0].server_version, /^16\./);
    await db.query('BEGIN');
    await db.query('SET LOCAL search_path = pg_temp, pg_catalog');
    await db.query(`
      CREATE TEMP TABLE checks(id uuid PRIMARY KEY, tenant_id uuid, point_id uuid, client_id uuid, date timestamptz,
        total_revenue numeric, product_cost_total numeric, discount numeric DEFAULT 0, product_total numeric DEFAULT 0,
        service_salary_total numeric DEFAULT 999, product_salary_total numeric DEFAULT 99,
        is_returned boolean DEFAULT false, return_scope text, return_destination text,
        is_deferred boolean DEFAULT false, deleted_at timestamptz, payment_method text DEFAULT 'cash');
      CREATE TEMP TABLE products(id uuid PRIMARY KEY, tenant_id uuid, name text, category text, stock numeric, cost_price numeric);
      CREATE TEMP TABLE check_product_lines(id uuid PRIMARY KEY, check_id uuid, product_id uuid, name text, quantity numeric, total_sell numeric, total_cost numeric);
      CREATE TEMP TABLE check_service_lines(id uuid PRIMARY KEY, check_id uuid, service_id uuid, name text, quantity numeric DEFAULT 1, total numeric);
      CREATE TEMP TABLE check_returns(id uuid PRIMARY KEY, check_id uuid, tenant_id uuid, destination text);
      CREATE TEMP TABLE check_return_lines(return_id uuid, product_line_id uuid, service_line_id uuid, quantity numeric, amount numeric);
      CREATE INDEX ON checks(tenant_id, point_id, date);
      CREATE INDEX ON check_product_lines(check_id);
      CREATE INDEX ON check_service_lines(check_id);
    `);
    const check = async ({ revenue, cost = 0, discount = 0, productTotal = 0, ...extra }) => {
      const id = randomUUID();
      const row = {
        id,
        tenant_id: tenant,
        point_id: point,
        date: '2026-10-15T09:00:00Z',
        total_revenue: revenue,
        product_cost_total: cost,
        discount,
        product_total: productTotal,
        ...extra,
      };
      const keys = Object.keys(row);
      await db.query(
        `INSERT INTO checks(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        Object.values(row),
      );
      return id;
    };
    const product = async (checkId, name, quantity, revenue, cost, productId = null) => {
      const id = randomUUID();
      await db.query('INSERT INTO check_product_lines VALUES($1,$2,$3,$4,$5,$6,$7)', [
        id,
        checkId,
        productId,
        name,
        quantity,
        revenue,
        cost,
      ]);
      return id;
    };
    const service = async (checkId, name, total, quantity = 1) => {
      const id = randomUUID();
      await db.query('INSERT INTO check_service_lines VALUES($1,$2,NULL,$3,$4,$5)', [
        id,
        checkId,
        name,
        quantity,
        total,
      ]);
      return id;
    };
    const returned = async (checkId, line, quantity, amount, destination = 'warehouse', kind = 'product') => {
      const id = randomUUID();
      await db.query('INSERT INTO check_returns VALUES($1,$2,$3,$4)', [id, checkId, tenant, destination]);
      await db.query('INSERT INTO check_return_lines VALUES($1,$2,$3,$4,$5)', [
        id,
        kind === 'product' ? line : null,
        kind === 'service' ? line : null,
        quantity,
        amount,
      ]);
    };
    await work({ db, ctx, check, product, service, returned });
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
}

const opts = { skip: !live, timeout: 60000 };
test(
  'PG: sales/gross reconcile canonical checks after discounts, partial/full returns, defect losses and custom refund adjustments',
  opts,
  async () =>
    fixture(async ({ db, ctx, check, product, service, returned }) => {
      const catalogId = randomUUID();
      await db.query("INSERT INTO products VALUES($1,$2,'Changed catalogue name','Folder',99,9999)", [
        catalogId,
        ctx.tenantId,
      ]);
      let ch = await check({ revenue: 570, cost: 140, discount: 30, productTotal: 300 });
      await product(ch, 'Snapshot product', 2, 200, 80, catalogId);
      await product(ch, 'Other product', 1, 100, 60);
      await service(ch, 'Legacy ×3', 300, 3);
      ch = await check({ revenue: 150, cost: 60, productTotal: 150, is_returned: true, return_scope: 'partial' });
      await returned(ch, await product(ch, 'Partial warehouse', 3, 150, 90), 1, 50);
      await service(ch, 'Work', 50);
      ch = await check({
        revenue: 60,
        cost: 40,
        discount: 20,
        productTotal: 80,
        is_returned: true,
        return_scope: 'partial',
      });
      await returned(ch, await product(ch, 'Partial defect', 2, 80, 40), 1, 40, 'defect');
      await service(ch, 'Work', 40);
      ch = await check({
        revenue: 0,
        cost: 0,
        productTotal: 10,
        is_returned: true,
        return_scope: 'full',
        return_destination: 'warehouse',
      });
      await product(ch, 'Full warehouse', 1, 10, 7);
      ch = await check({
        revenue: 0,
        cost: 20,
        productTotal: 40,
        is_returned: true,
        return_scope: 'full',
        return_destination: 'defect',
      });
      await product(ch, 'Full defect', 1, 40, 20);
      ch = await check({ revenue: 30, cost: 10, productTotal: 60, is_returned: true, return_scope: 'partial' });
      await returned(ch, await product(ch, 'Manual refund', 2, 60, 20), 1, 30);
      await service(ch, 'Work', 40);
      ch = await check({ revenue: 120, cost: 45, productTotal: 100 });
      await product(ch, 'Legacy mismatch', 1, 100, 40);
      // Same query boundaries as canonical money: local midnight included, prior day excluded.
      ch = await check({ revenue: 10, cost: 0, date: '2026-09-30T21:00:00Z' });
      await service(ch, 'Midnight', 10);
      for (const extra of [
        { date: '2026-09-30T20:59:59Z' },
        { date: '2026-10-31T21:00:00Z' },
        { is_deferred: true },
        { deleted_at: '2026-10-15T10:00:00Z' },
        { payment_method: 'warranty' },
        { tenant_id: randomUUID() },
        { point_id: randomUUID() },
      ]) {
        ch = await check({ revenue: 99999, cost: 999, ...extra });
        await product(ch, 'Excluded', 1, 99999, 999);
      }
      const canonical = await checkAggregate(db, ctx);
      const data = await loadAnalysis(db, ctx);
      assert.equal(canonical.revenue, 940);
      assert.equal(canonical.productCost, 315);
      assert.equal(data.totals.revenue, canonical.revenue);
      assert.equal(data.totals.cost, canonical.productCost);
      assert.equal(data.totals.gross, 625, 'salary snapshots are not part of gross');
      assert.equal(data.totals.service_qty, 5, 'legacy ×3 is one performed service');
      assert.equal(data.totals.product_qty, 8);
      assert.equal(data.rows.find((r) => r.name === 'Snapshot product').revenue, 180);
      assert.equal(
        data.rows.find((r) => r.name === 'Snapshot product').cost,
        80,
        'current catalog cost is never substituted',
      );
      assert.equal(data.rows.find((r) => r.name === 'Full defect').gross, -20);
      assert.equal(
        data.rows.some((r) => /Excluded|Full warehouse|Changed catalogue/.test(r.name)),
        false,
      );
      assert.deepEqual(data.adjustment, { revenue: -20, cost: 5, checks: 2 });
      for (const builder of [new SalesBuilder(db), new GrossProfitBuilder(db)]) {
        const report = await builder.build(ctx);
        assert.equal(report.totals.revenue, 940);
        assert.equal(
          report.rows.reduce((sum, r) => sum + r.revenue, 0),
          940,
        );
        assert.equal(
          report.sections.find((s) => s.key === 'timeline').rows.reduce((sum, r) => sum + r.revenue, 0),
          940,
        );
      }
      const goods = await loadAnalysis(db, ctx, { kind: 'products' });
      const works = await loadAnalysis(db, ctx, { kind: 'services' });
      assert.equal(goods.totals.revenue + works.totals.revenue + data.adjustment.revenue, canonical.revenue);
      assert.equal(works.totals.gross, works.totals.revenue);
      const oldProducts = await new ProductsBuilder(db).sales(ctx, false);
      assert.equal(oldProducts.totals.revenue, goods.totals.revenue);
      assert.equal(oldProducts.totals.profit, goods.totals.gross);
    }),
);

test(
  'PG: unknown costs remain null, recorded zero is flagged, and gross ABC omits unknown/negative/zero contributions',
  opts,
  async () =>
    fixture(async ({ db, ctx, check, product, service }) => {
      let ch = await check({ revenue: 50, cost: 0, productTotal: 50 });
      await product(ch, 'Missing cost', 1, 50, null);
      ch = await check({ revenue: 10, cost: 0, productTotal: 10 });
      await product(ch, 'Recorded zero', 1, 10, 0);
      ch = await check({ revenue: 10, cost: 30, productTotal: 10 });
      await product(ch, 'Loss', 1, 10, 30);
      ch = await check({ revenue: 0, cost: 0 });
      await product(ch, 'Free', 1, 0, 0);
      ch = await check({ revenue: 20 });
      await service(ch, 'Work', 20);
      const gross = await new GrossProfitBuilder(db).build(ctx);
      assert.equal(gross.totals.gross, null);
      assert.equal(gross.totals.cost, null);
      assert.equal(gross.rows.find((r) => r.name === 'Missing cost').gross, null);
      assert.equal(gross.rows.find((r) => r.name === 'Work').cost, null, 'no fictitious service COGS');
      assert.equal(gross.rows.find((r) => r.name === 'Recorded zero').status, 'Нулевая себестоимость');
      const abc = await new AbcBuilder(db).build({ ...ctx, groupBy: 'gross-all' });
      assert.equal(abc.kpis.find((r) => r.key === 'basis').value, 30);
      assert.equal(abc.rows.find((r) => r.name === 'Missing cost').tier, '—');
      assert.equal(abc.rows.find((r) => r.name === 'Loss').tier, '—');
      assert.equal(abc.rows.find((r) => r.name === 'Free').tier, '—');
      const revenueAbc = await new AbcBuilder(db).build({ ...ctx, groupBy: 'revenue-all' });
      assert.equal(revenueAbc.rows.find((r) => r.name === 'Missing cost').tier, 'A');
    }),
);

test(
  'PG: ABC dominant item, exact boundaries, tied groups, empty data and cent-level discount allocation',
  opts,
  async () =>
    fixture(async ({ db, ctx, check, product }) => {
      assert.equal((await loadAnalysis(db, ctx)).totals.revenue, 0);
      let ch = await check({ revenue: 100, productTotal: 100 });
      await product(ch, 'A', 1, 100, 0);
      let data = await loadAnalysis(db, ctx);
      assert.equal(data.rows[0].tier, 'A');
      assert.equal(data.rows[0].share, 100);
      await db.query('TRUNCATE checks, check_product_lines');
      ch = await check({ revenue: 100, productTotal: 100 });
      for (const [name, value] of [
        ['A', 80],
        ['B', 15],
        ['C', 5],
      ])
        await product(ch, name, 1, value, 0);
      data = await loadAnalysis(db, ctx);
      assert.deepEqual(
        data.rows.map((r) => r.tier),
        ['A', 'B', 'C'],
      );
      await db.query('TRUNCATE checks, check_product_lines');
      ch = await check({ revenue: 100, productTotal: 100 });
      await product(ch, 'B', 1, 50, 0);
      await product(ch, 'A', 1, 50, 0);
      data = await loadAnalysis(db, ctx);
      assert.deepEqual(
        data.rows.map((r) => [r.name, r.tier, r.cumulative]),
        [
          ['A', 'A', 100],
          ['B', 'A', 100],
        ],
      );
      await db.query('TRUNCATE checks, check_product_lines');
      ch = await check({ revenue: 0.02, discount: 0.01, productTotal: 0.03 });
      for (const name of ['One', 'Two', 'Three']) await product(ch, name, 1, 0.01, 0);
      data = await loadAnalysis(db, ctx);
      assert.equal(data.totals.revenue, 0.02);
      assert.equal(data.adjustment.checks, 0);
      assert.equal(
        data.rows.reduce((sum, r) => sum + Math.round(r.revenue * 100), 0),
        2,
      );
    }),
);

test(
  'PG: >500 groups keep complete totals, ABC denominator and tiers; one query, bounded rows; legacy Products totals also complete',
  opts,
  async () =>
    fixture(async ({ db, ctx, check }) => {
      const ch = await check({ revenue: 1001, cost: 500.5, productTotal: 1001 });
      await db.query(
        `INSERT INTO products SELECT gen_random_uuid(), $1, 'Product ' || lpad(i::text, 4, '0'), NULL, 1, 1 FROM generate_series(1,1001) i`,
        [ctx.tenantId],
      );
      await db.query(
        `INSERT INTO check_product_lines SELECT gen_random_uuid(), $1, id, name, 1, 1, 0.5 FROM products`,
        [ch],
      );
      let queries = 0;
      const counted = {
        query: (...args) => {
          queries += 1;
          return db.query(...args);
        },
      };
      const data = await loadAnalysis(counted, ctx);
      assert.equal(queries, 1);
      assert.equal(data.rows.length, 501);
      assert.equal(data.totals.groups, 1001);
      assert.equal(data.totals.revenue, 1001);
      assert.equal(data.totals.gross, 500.5);
      assert.equal(
        data.tiers.reduce((sum, r) => sum + r.count, 0),
        1001,
      );
      assert.equal(
        data.tiers.reduce((sum, r) => sum + r.value, 0),
        1001,
      );
      const report = await new AbcBuilder(counted).build({ ...ctx, groupBy: 'gross-products' });
      assert.equal(report.rows.length, 500);
      assert.equal(report.truncated, true);
      assert.equal(report.totals.value, 500.5);
      assert.ok(report.notes.some((note) => note.includes('500 из 1001')));
      const productIds = (await db.query('SELECT id FROM products')).rows.map((r) => r.id);
      const warehouse = await loadAnalysis(counted, ctx, {
        kind: 'products',
        warehouse: {
          productIds,
          from: '2026-10-01T00:00:00Z',
          to: '2026-10-31T23:59:59Z',
        },
      });
      assert.equal(warehouse.rows.length, 501);
      assert.deepEqual(warehouse.warehouse_tiers, [{ tier: 'A', count: 1001, value: 1001, pct: 100 }]);
      const categories = await new ProductsBuilder(counted).sales(ctx, true);
      assert.equal(categories.rows.length, 1);
      assert.equal(categories.totals.revenue, 1001);

      const oldProducts = await new ProductsBuilder(counted).sales(ctx, false);
      assert.equal(oldProducts.rows.length, 500);
      assert.equal(oldProducts.totals.revenue, 1001);
      assert.equal(oldProducts.totals.profit, 500.5);
    }),
);

test(
  'PG: warehouse ABC ranks authorised catalogue by discounted/returned sales, keeps stock-cost values and includes unsold stock',
  opts,
  async () =>
    fixture(async ({ db, ctx, check, product, returned }) => {
      const ids = Array.from({ length: 4 }, () => randomUUID());
      for (let i = 0; i < ids.length; i += 1) {
        await db.query("INSERT INTO products VALUES($1,$2,$3,'Folder',1,$4)", [
          ids[i],
          ctx.tenantId,
          'Stock ' + i,
          (i + 1) * 10,
        ]);
      }
      let ch = await check({ revenue: 80, cost: 10, discount: 20, productTotal: 100 });
      await product(ch, 'A snapshot', 1, 100, 10, ids[0]);
      ch = await check({ revenue: 15, cost: 15, productTotal: 20, is_returned: true, return_scope: 'partial' });
      await returned(ch, await product(ch, 'B partial', 4, 20, 20, ids[1]), 1, 5);
      ch = await check({ revenue: 5, cost: 3, productTotal: 5 });
      await product(ch, 'C snapshot', 1, 5, 3, ids[2]);
      // Excluded catalogue ID, tenant, point and instant must not move the ABC thresholds.
      const excluded = randomUUID();
      await db.query("INSERT INTO products VALUES($1,$2,'Not selected','Folder',1,999)", [excluded, ctx.tenantId]);
      ch = await check({ revenue: 999, productTotal: 999 });
      await product(ch, 'Not selected', 1, 999, 0, excluded);
      for (const extra of [{ point_id: randomUUID() }, { tenant_id: randomUUID() }, { date: '2026-10-01T08:59:59Z' }]) {
        ch = await check({ revenue: 999, productTotal: 999, ...extra });
        await product(ch, 'Wrong scope', 1, 999, 0, ids[0]);
      }
      let data = await loadAnalysis(db, ctx, {
        kind: 'products',
        warehouse: { productIds: ids, from: '2026-10-01T09:00:00Z', to: '2026-10-31T09:00:00Z' },
      });
      assert.deepEqual(data.warehouse_tiers, [
        { tier: 'A', count: 1, value: 10, pct: 10 },
        { tier: 'B', count: 1, value: 20, pct: 20 },
        { tier: 'C', count: 2, value: 70, pct: 70 },
      ]);
      data = await loadAnalysis(db, ctx, {
        kind: 'products',
        warehouse: { productIds: [ids[0]], from: '2026-10-01T09:00:00Z', to: '2026-10-31T09:00:00Z' },
      });
      assert.deepEqual(data.warehouse_tiers, [{ tier: 'A', count: 1, value: 10, pct: 100 }]);
      data = await loadAnalysis(db, ctx, {
        kind: 'products',
        warehouse: { productIds: [], from: '2026-10-01T09:00:00Z', to: '2026-10-31T09:00:00Z' },
      });
      assert.deepEqual(data.warehouse_tiers, []);
    }),
);

test('PG: service partial/full returns preserve one-line counts and expose a custom refund residual', opts, async () =>
  fixture(async ({ db, ctx, check, service, returned }) => {
    let ch = await check({ revenue: 200, is_returned: true, return_scope: 'partial' });
    await returned(ch, await service(ch, 'Legacy partial', 300, 3), 1, 100, 'warehouse', 'service');
    ch = await check({ revenue: 0, is_returned: true, return_scope: 'partial' });
    await returned(ch, await service(ch, 'Fully returned line', 50), 1, 50, 'warehouse', 'service');
    ch = await check({ revenue: 100, is_returned: true, return_scope: 'full', return_destination: 'warehouse' });
    await service(ch, 'Full custom refund', 300, 3);
    const all = await loadAnalysis(db, ctx);
    assert.equal(all.totals.revenue, 300);
    assert.equal(all.totals.service_qty, 1);
    assert.equal(all.rows.find((r) => r.name === 'Legacy partial').revenue, 200);
    assert.equal(
      all.rows.some((r) => r.name === 'Fully returned line' || r.name === 'Full custom refund'),
      false,
    );
    assert.deepEqual(all.adjustment, { revenue: 100, cost: 0, checks: 1 });
    assert.equal((await loadAnalysis(db, ctx, { kind: 'services' })).totals.revenue, 200);
  }),
);
