// Strictly disposable October 13 fixed-pay DB; no production or default fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { MastersBuilder } = require('../dist/reports/builder/builders/masters.builder');
const { ReturnsService } = require('../dist/returns/returns.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { UsersService } = require('../dist/users/users.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
Logger.overrideLogger(false);
const live = process.env.AUTEXA_OCT13_LIVE_DB;
const status = (code) => (error) => error.getStatus?.() === code;
test(
  'fixed wages: actual PostgreSQL snapshots, closed/deferred writes, payroll, isolation',
  { skip: !live, timeout: 120000 },
  async (t) => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(
      (url.port === '55443' && ['/autexa_oct13', '/autexa_oct13_fixed'].includes(url.pathname)) ||
        (url.port === '55438' && url.pathname === '/autexa_oct8_test') ||
        (url.port === '55446' && url.pathname === '/autexa_oct13_recovery'),
      'Named disposable QA databases only',
    );
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.AUTEXA_OCT13_APP_PASSWORD;
    assert.ok(appUrl.password);
    const admin = new Pool({ connectionString: live, max: 5 });
    const app = new Pool({ connectionString: appUrl.toString(), max: 5 });
    const pool = new TenantAwarePool(admin, app);
    const catalog = new ServicesService(pool);
    const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool));
    const users = new UsersService(pool);
    const f = Object.fromEntries(['tenant', 'owner', 'executor', 'other'].map((k) => [k, randomUUID()]));
    const q = async (sql, args = []) => (await admin.query(sql, args)).rows;
    const one = async (sql, args) => (await q(sql, args))[0];
    const run = (fn) => runWithTenant(f.tenant, fn);
    const actor = { userID: f.owner, tenantID: f.tenant, role: 'director', permissions: {} };
    const service = (more = {}) =>
      run(() =>
        catalog.create(
          f.tenant,
          { name: 'Фикс QA', defaultPrice: 1000, masterPayMode: 'fixed', masterFixedAmount: 300, ...more },
          f.owner,
        ),
      );
    const line = (s, more = {}) => ({
      serviceId: s.id,
      name: s.name,
      masterId: f.executor,
      price: s.defaultPrice,
      quantity: 1,
      ...more,
    });
    const create = (lines, more = {}) =>
      run(() =>
        checks.create(
          f.tenant,
          f.owner,
          'director',
          { masterId: f.owner, services: lines, products: [], isDeferred: true, paymentMethod: 'cash', ...more },
          actor,
        ),
      );
    const edit = (c, lines, more = {}) =>
      run(() => checks.update(c.id, f.tenant, 'director', { services: lines, products: [], ...more }, f.owner, actor));
    try {
      await q("INSERT INTO tenants(id,name,timezone) VALUES($1,'Fixed pay QA','Europe/Moscow')", [f.tenant]);
      for (const key of ['owner', 'executor', 'other'])
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role,salary_percent) VALUES($1,$2,$4,'unused',$3,'director',25)",
          [f[key], f.tenant, key, f[key]],
        );
      let s, c;
      await t.test(
        'fixed replaces percent, zero sale, duplicate and legacy quantities count, actual executor',
        async () => {
          s = await service({ masterPercent: 90 });
          c = await create([line(s, { price: 0 }), line(s, { price: 5000 }), line(s, { quantity: 3 })]);
          assert.equal(c.serviceSalaryTotal, 1500);
          assert.equal(c.totalCost, 1500);
          const rows = await q('SELECT * FROM check_service_lines WHERE check_id=$1', [c.id]);
          assert.equal(rows.length, 3);
          assert.ok(
            rows.every(
              (r) => r.salary_mode === 'fixed' && Number(r.salary_fixed_amount) === 300 && r.master_id === f.executor,
            ),
          );
          assert.equal(
            rows.reduce((a, r) => a + Number(r.salary_amount), 0),
            1500,
          );
        },
      );
      await t.test('catalog change and server-ignored fabricated snapshots cannot change retained wages', async () => {
        await run(() =>
          catalog.update(
            s.id,
            f.tenant,
            { masterPayMode: 'percent', masterFixedAmount: null, masterPercent: 1 },
            f.owner,
          ),
        );
        const changed = c.services.map((l, i) => ({
          ...l,
          price: 100 + i,
          salaryMode: 'percent',
          salaryFixedAmount: 0,
          salaryAmount: 0,
          masterId: i === 0 ? f.other : l.masterId,
        }));
        c = await edit(c, changed);
        assert.equal(c.serviceSalaryTotal, 1500);
        const rows = await q('SELECT * FROM check_service_lines WHERE check_id=$1', [c.id]);
        assert.ok(rows.every((r) => r.salary_mode === 'fixed' && Number(r.salary_fixed_amount) === 300));
        assert.ok(rows.some((r) => r.master_id === f.other));
        const newc = await create([line(s)]);
        assert.equal(newc.serviceSalaryTotal, 10);
      });
      await t.test(
        'legacy percent snapshot never picks up today fixed catalog; omitted lines retain totals',
        async () => {
          const p = await service({ masterPayMode: 'percent', masterFixedAmount: null, masterPercent: null });
          const old = await create([line(p)]);
          assert.equal(old.serviceSalaryTotal, 250);
          await run(() => catalog.update(p.id, f.tenant, { masterPayMode: 'fixed', masterFixedAmount: 900 }, f.owner));
          const edited = await edit(
            old,
            old.services.map((l) => ({ ...l, price: 2000 })),
          );
          assert.equal(edited.serviceSalaryTotal, 500);
          const omitted = await run(() =>
            checks.update(old.id, f.tenant, 'director', { comment: 'only comment', products: [] }, f.owner, actor),
          );
          assert.equal(omitted.serviceSalaryTotal, 500);
          assert.equal((await create([line(p)])).serviceSalaryTotal, 900);
        },
      );
      await t.test('close, monthly percent recalculation, closed price/quantity edit preserve fixed', async () => {
        const closed = await edit(c, c.services, { isDeferred: false });
        assert.equal(closed.isDeferred, false);
        assert.equal(closed.serviceSalaryTotal, 1500);
        await run(async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await users.recomputeMonthSalary(
              client,
              f.tenant,
              f.executor,
              '2026-10',
              { servicePct: 80 },
              'Europe/Moscow',
            );
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        });
        assert.equal(
          Number((await one('SELECT service_salary_total FROM checks WHERE id=$1', [c.id])).service_salary_total),
          1500,
        );
        const changed = closed.services.map((l, i) => ({ ...l, price: 9999, quantity: i === 0 ? 2 : l.quantity }));
        const edited = await edit(closed, changed);
        assert.equal(edited.serviceSalaryTotal, 1800);
        assert.equal(edited.totalCost, 1800);
        const hidden = await run(() =>
          checks.getById(c.id, f.tenant, { ...actor, role: 'master', userID: f.executor, permissions: {} }),
        );
        assert.equal(hidden.serviceSalaryTotal, 0);
        assert.ok(hidden.services.every((l) => !('salaryFixedAmount' in l) && !('salaryMode' in l)));
      });
      await t.test(
        'invalid updates roll back; fixed zero works; imports lacking pay columns preserve setting',
        async () => {
          const zero = await service({ masterFixedAmount: 0 });
          assert.equal((await create([line(zero)])).serviceSalaryTotal, 0);
          await assert.rejects(
            run(() => catalog.update(zero.id, f.tenant, { masterPayMode: 'fixed', masterFixedAmount: -1 })),
            status(400),
          );
          assert.equal((await run(() => catalog.getById(zero.id, f.tenant))).masterFixedAmount, 0);
          const target = await service({ masterFixedAmount: 321.12 });
          const rows = [{ sourceRow: 2, id: target.id, name: target.name, priceType: 'fixed', defaultPrice: 2000 }];
          const preview = await run(() => catalog.previewImport(f.tenant, f.owner, rows));
          assert.equal(preview.summary.errors, 0);
          await run(() => catalog.confirmImport(f.tenant, f.owner, preview.previewId, randomUUID()));
          assert.equal((await run(() => catalog.getById(target.id, f.tenant))).masterFixedAmount, 321.12);
        },
      );
      await t.test('reports attribute fixed wages; warranty, return and cancel retain existing rules', async () => {
        const fixed = await service();
        const before = await create([line(fixed)], { isDeferred: false });
        const report = new MastersBuilder(pool);
        const ctx = {
          tenantId: f.tenant,
          pointId: null,
          actor,
          tz: 'Europe/Moscow',
          dateFrom: '2020-01-01',
          dateTo: '2100-01-01',
          ids: [],
          days: 365,
          refDate: '2026-10-13',
          def: { id: 'masters' },
        };
        const built = await run(() => report.build(ctx));
        assert.ok(built.rows.find((r) => r._id === f.executor).salaryAccrued >= 300);
        const returns = new ReturnsService(pool, new WarehousesService(pool));
        await run(() =>
          returns.createReturn(f.tenant, f.owner, before.id, { destination: 'warehouse', scope: 'full' }, actor),
        );
        assert.equal(
          Number((await one('SELECT service_salary_total FROM checks WHERE id=$1', [before.id])).service_salary_total),
          300,
        );
        const warranty = await create([line(fixed)], { isDeferred: false, paymentMethod: 'warranty' });
        assert.equal(warranty.serviceSalaryTotal, 300);
        assert.equal(warranty.cashAmount, 0);
        await run(() => checks.remove(warranty.id, f.tenant, 'director', f.owner, actor));
        assert.ok((await one('SELECT deleted_at FROM checks WHERE id=$1', [warranty.id])).deleted_at);
        assert.equal(
          Number((await one('SELECT COUNT(*) FROM salary_payments WHERE tenant_id=$1', [f.tenant])).count),
          0,
        );
      });
      await t.test('provisional service price is no benchmark; fixed earnings still snapshot', async () => {
        // This isolated DB starts at 190; simulate the independent 191 flags without production access.
        await q('ALTER TABLE services ADD COLUMN IF NOT EXISTS price_is_placeholder boolean NOT NULL DEFAULT false');
        const p = await service({ defaultPrice: 1 });
        await q('UPDATE services SET price_is_placeholder=true WHERE id=$1', [p.id]);
        const ch = await create([line(p, { price: 5000 })]);
        assert.equal(ch.serviceSalaryTotal, 300);
        assert.equal(ch.services[0].priceThreshold, null);
        assert.equal(ch.servicePriceExcessTotal, 0);
      });
      await t.test(
        'provisional product cost blocks new financial lines; proven historical cost retained per occurrence',
        async () => {
          await q(
            'ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price_is_placeholder boolean NOT NULL DEFAULT false',
          );
          const id = randomUUID();
          await q(
            "INSERT INTO products(id,tenant_id,name,sell_price,cost_price,stock,cost_price_is_placeholder) VALUES($1,$2,'Product QA',100,1,100,true)",
            [id, f.tenant],
          );
          const pl = { productId: id, name: 'Product QA', sellPrice: 100, costPrice: 9999, quantity: 1 };
          const provisional = (error) => error.getResponse?.().code === 'PRODUCT_COST_CONFIRMATION_REQUIRED';
          await assert.rejects(create([], { products: [pl] }), provisional);
          await assert.rejects(create([], { products: [pl], isDeferred: false }), provisional);
          await q('UPDATE products SET cost_price_is_placeholder=false,cost_price=40 WHERE id=$1', [id]);
          const old = await create([], { products: [pl] });
          assert.equal(old.productCostTotal, 40);
          await q('UPDATE products SET cost_price_is_placeholder=true,cost_price=1 WHERE id=$1', [id]);
          const preserved = await edit(old, [], {
            products: old.products.map((row) => ({ ...row, costPrice: 99999 })),
          });
          assert.equal(preserved.productCostTotal, 40);
          await assert.rejects(edit(old, [], { products: [{ ...pl, quantity: 2 }] }), provisional);
          await assert.rejects(edit(old, [], { products: [pl, pl] }), provisional);
        },
      );
      await t.test('cross-tenant service and foreign line IDs fail with no earning side effects', async () => {
        const before = Number((await one('SELECT COUNT(*) FROM checks WHERE tenant_id=$1', [f.tenant])).count);
        await assert.rejects(create([line({ ...s, id: randomUUID() })]));
        assert.equal(Number((await one('SELECT COUNT(*) FROM checks WHERE tenant_id=$1', [f.tenant])).count), before);
        await assert.rejects(edit(c, [{ ...c.services[0], id: randomUUID() }]), status(400));
      });
    } finally {
      await q('DELETE FROM tenants WHERE id=$1', [f.tenant]);
      await pool.end();
    }
  },
);
