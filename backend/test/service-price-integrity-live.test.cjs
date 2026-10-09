// Explicitly disposable October QA database only. No production fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { ReturnsService } = require('../dist/returns/returns.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { MastersBuilder } = require('../dist/reports/builder/builders/masters.builder');
Logger.overrideLogger(false);
const status = (code) => (error) => error.getStatus?.() === code;
const live = process.env.OCT10_PRICING_LIVE_DB;

test(
  'service price integrity / actual PostgreSQL16, transactions and RLS',
  { skip: !live, timeout: 120000 },
  async (t) => {
    const url = new URL(live);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55438');
    assert.equal(url.pathname, '/autexa_oct8_test');
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
    assert.ok(appUrl.password, 'disposable app-role password must be explicitly supplied');
    const admin = new Pool({ connectionString: live, max: 8, statement_timeout: 8000 });
    const app = new Pool({ connectionString: appUrl.toString(), max: 8, statement_timeout: 8000 });
    const pool = new TenantAwarePool(admin, app);
    const catalog = new ServicesService(pool);
    const checks = new ChecksService(pool, new WarrantyService(pool), new ClientsService(pool, undefined));
    const report = new MastersBuilder(pool);
    const tenants = [];
    const q = async (sql, args = []) => (await admin.query(sql, args)).rows;
    const one = async (sql, args = []) => (await q(sql, args))[0];
    const fixture = async () => {
      const f = Object.fromEntries(
        ['tenant', 'owner', 'editor', 'executor', 'point'].map((key) => [key, randomUUID()]),
      );
      tenants.push(f.tenant);
      await q("INSERT INTO tenants(id,name,timezone) VALUES($1,'Pricing QA','Europe/Moscow')", [f.tenant]);
      await q("INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$2,'QA',true)", [f.point, f.tenant]);
      for (const [key, name] of [
        ['owner', 'Price author'],
        ['editor', 'Other price author'],
        ['executor', 'Executor'],
      ]) {
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role,salary_percent) VALUES($1,$2,$4,'unused',$3,'director',10)",
          [f[key], f.tenant, name, f[key]],
        );
      }
      f.actor = (id = f.owner) => ({
        userID: id,
        tenantID: f.tenant,
        role: 'director',
        permissions: {},
        currentPointId: f.point,
        pointId: f.point,
      });
      f.run = (fn) => runWithTenant(f.tenant, fn);
      f.service = (price = { defaultPrice: 100 }) =>
        f.run(() => catalog.create(f.tenant, { name: 'Мойка', ...price }, f.owner));
      f.line = (service, price = service.defaultPrice, overrides = {}) => ({
        serviceId: service.id,
        masterId: f.executor,
        name: service.name,
        price,
        quantity: 1,
        ...overrides,
      });
      f.create = (lines, overrides = {}, actor = f.owner) =>
        f.run(() =>
          checks.create(
            f.tenant,
            actor,
            'director',
            {
              masterId: f.owner,
              isDeferred: true,
              paymentMethod: 'cash',
              services: lines,
              products: [],
              ...overrides,
            },
            f.actor(actor),
          ),
        );
      f.edit = (check, services, overrides = {}, actor = f.owner) =>
        f.run(() =>
          checks.update(
            check.id,
            f.tenant,
            'director',
            {
              services,
              products: [],
              ...overrides,
            },
            actor,
            f.actor(actor),
          ),
        );
      f.ctx = (overrides = {}) => ({
        tenantId: f.tenant,
        pointId: f.point,
        actor: f.actor(),
        tz: 'Europe/Moscow',
        dateFrom: '2020-01-01',
        dateTo: '2100-01-01',
        ids: [],
        days: 365,
        refDate: '2026-10-10',
        def: { id: 'masters' },
        ...overrides,
      });
      return f;
    };
    try {
      await t.test('migrations preserve legacy lines and record only a present-time catalogue baseline', async () => {
        assert.match((await one('SHOW server_version')).server_version, /^16\./);
        const tx = await admin.connect();
        try {
          await tx.query('BEGIN');
          const schema = 'price_migration_' + randomUUID().replaceAll('-', '');
          await tx.query(`CREATE SCHEMA ${schema}`);
          await tx.query(`SET LOCAL search_path TO ${schema}, public`);
          await tx.query(`CREATE TABLE tenants(id uuid primary key);
          CREATE TABLE users(id uuid primary key,tenant_id uuid,full_name text);
          CREATE TABLE services(id uuid primary key,tenant_id uuid,default_price numeric(12,2),created_at timestamptz);
          CREATE UNIQUE INDEX uq_services_tenant_id_id ON services(tenant_id,id);
          CREATE TABLE check_service_lines(id uuid, price numeric(12,2),quantity int);`);
          const tenant = randomUUID(),
            service = randomUUID();
          await tx.query('INSERT INTO tenants VALUES($1)', [tenant]);
          await tx.query("INSERT INTO services VALUES($1,$2,100,'2001-01-01')", [service, tenant]);
          await tx.query('INSERT INTO check_service_lines VALUES($1,300,3)', [randomUUID()]);
          const before = Date.now();
          await tx.query(readFileSync(join(__dirname, '../migrations/184_service_price_policy.sql'), 'utf8'));
          await tx.query(readFileSync(join(__dirname, '../migrations/186_check_service_price_snapshots.sql'), 'utf8'));
          const history = (await tx.query('SELECT * FROM service_price_history')).rows;
          assert.equal(history.length, 1);
          assert.equal(history[0].source, 'baseline');
          assert.ok(new Date(history[0].changed_at).getTime() >= before - 1000);
          assert.equal(history[0].changed_by, null);
          const line = (await tx.query('SELECT * FROM check_service_lines')).rows[0];
          assert.equal(line.price_snapshot_status, 'legacy_unknown');
          assert.equal(line.price_threshold, null);
          assert.equal(Number(line.price_excess), 0);
          assert.equal(Number(line.price), 300);
          assert.equal(line.quantity, 3);
        } finally {
          await tx.query('ROLLBACK');
          tx.release();
        }
      });

      await t.test(
        'catalogue create/rename/update history, actor reset, rollback and concurrent versions are atomic',
        async () => {
          const f = await fixture(),
            foreign = await fixture();
          let service = await f.service({ priceType: 'range', minPrice: 50, maxPrice: 100 });
          assert.equal(service.defaultPrice, 50);
          assert.equal(service.priceVersion, 1);
          service = await f.run(() => catalog.update(service.id, f.tenant, { name: 'Range wash' }, f.editor));
          assert.equal(service.priceVersion, 1);
          service = await f.run(() => catalog.update(service.id, f.tenant, { defaultPrice: 60 }, f.editor));
          assert.equal(service.minPrice, 60);
          assert.equal(service.maxPrice, 100);
          assert.equal(service.priceVersion, 2);
          let history = await f.run(() => catalog.getPriceHistory(service.id, f.tenant));
          assert.deepEqual(
            history.map((h) => h.changedBy),
            [f.editor, f.owner],
          );
          assert.equal(
            (await app.query("SELECT NULLIF(current_setting('app.service_price_actor',true),'') AS actor")).rows[0]
              .actor,
            null,
          );
          await assert.rejects(
            foreign.run(() => catalog.getPriceHistory(service.id, foreign.tenant)),
            status(404),
          );
          assert.equal(
            (
              await foreign.run(() =>
                pool.query('SELECT * FROM service_price_history WHERE service_id=$1', [service.id]),
              )
            ).rows.length,
            0,
          );
          const faultPool = {
            connect: async () => {
              const client = await pool.connect();
              return {
                release: () => client.release(),
                query: async (sql, args) => {
                  const result = await client.query(sql, args);
                  if (String(sql).startsWith('UPDATE services')) throw new Error('after-history fault');
                  return result;
                },
              };
            },
          };
          await assert.rejects(
            f.run(() => new ServicesService(faultPool).update(service.id, f.tenant, { maxPrice: 500 }, f.owner)),
            /after-history fault/,
          );
          assert.equal((await f.run(() => catalog.getById(service.id, f.tenant))).maxPrice, 100);
          assert.equal((await f.run(() => catalog.getPriceHistory(service.id, f.tenant))).length, 2);
          await Promise.all(
            [200, 300].map((maxPrice) => f.run(() => catalog.update(service.id, f.tenant, { maxPrice }, f.owner))),
          );
          history = await f.run(() => catalog.getPriceHistory(service.id, f.tenant));
          assert.deepEqual(
            history.map((h) => h.version),
            [4, 3, 2, 1],
          );
          await assert.rejects(
            f.run(() => catalog.update(service.id, f.tenant, { minPrice: 400 }, f.owner)),
            status(400),
          );
        },
      );

      await t.test(
        'catalogue edit then draft edit/close/closed-edit preserves id and snapshot; retries and price actor are stable',
        async () => {
          const f = await fixture();
          const service = await f.service();
          const requestId = randomUUID();
          let check = await f.create([f.line(service, 150, { quantity: 3 }), f.line(service, 50)], {
            clientRequestId: requestId,
          });
          const old = check.services.find((s) => s.price === 150),
            reduced = check.services.find((s) => s.price === 50);
          assert.equal(old.priceThreshold, 100);
          assert.equal(old.priceExcess, 150);
          assert.equal(check.servicePriceExcessTotal, 150);
          assert.equal(check.increasedServiceLinesCount, 1);
          assert.equal(old.priceChangedBy, f.owner);
          assert.equal(old.masterId, f.executor);
          await f.run(() => catalog.update(service.id, f.tenant, { defaultPrice: 200 }, f.editor));
          const retry = await f.create([f.line(service, 900)], { clientRequestId: requestId });
          assert.equal(retry.id, check.id);
          assert.equal(retry.services.find((s) => s.id === old.id).priceThreshold, 100);
          check = await f.edit(check, [reduced, old], { comment: 'Unrelated edit' }, f.editor);
          const persisted = check.services.find((s) => s.id === old.id);
          assert.equal(persisted.priceThreshold, 100);
          assert.equal(persisted.catalogPriceVersion, 1);
          assert.equal(persisted.priceChangedBy, f.owner);
          assert.deepEqual(persisted.priceChangedAt, old.priceChangedAt);
          check = await f.edit(
            check,
            check.services.map((s) => (s.id === old.id ? { ...s, price: 160, masterId: f.owner } : s)),
            {},
            f.editor,
          );
          const changed = check.services.find((s) => s.id === old.id);
          assert.equal(changed.priceChangedBy, f.editor);
          assert.equal(changed.priceExcess, 180);
          assert.equal(changed.priceThreshold, 100);
          const changedAt = changed.priceChangedAt;
          check = await f.edit(check, check.services, {}, f.owner);
          assert.deepEqual(check.services.find((s) => s.id === old.id).priceChangedAt, changedAt);
          check = await f.edit(check, check.services, { isDeferred: false, paymentMethod: 'cash' });
          check = await f.edit(check, check.services, { comment: 'Closed edit' });
          assert.equal(check.services.find((s) => s.id === old.id).priceThreshold, 100);
          assert.equal(check.services.find((s) => s.id === old.id).priceChangedBy, f.editor);
          assert.equal(check.servicePriceExcessTotal, 180);
          const journal = await f.run(() => checks.getAll(f.tenant, { limit: 100 }, f.actor()));
          assert.equal(journal.data.find((c) => c.id === check.id).servicePriceExcessTotal, 180);
          const keyset = await f.run(() => checks.getAll(f.tenant, { limit: 100, cursor: '' }, f.actor()));
          assert.equal(keyset.data.find((c) => c.id === check.id).increasedServiceLinesCount, 1);
          const range = await f.service({ priceType: 'range', minPrice: 40, maxPrice: 80 });
          check = await f.edit(
            check,
            check.services.map((s) => (s.id === old.id ? { ...s, serviceId: range.id } : s)),
          );
          assert.equal(check.services.find((s) => s.id === old.id).priceThreshold, 80);
          assert.equal(check.services.find((s) => s.id === old.id).catalogPriceType, 'range');
        },
      );

      await t.test(
        'first-save snapshot waits for an in-flight catalogue mutation and sees its committed version',
        async () => {
          const f = await fixture(),
            service = await f.service();
          const locked = await admin.connect();
          let entered;
          const reached = new Promise((resolve) => {
            entered = resolve;
          });
          const hooked = {
            query: (...args) => pool.query(...args),
            connect: async () => {
              const client = await pool.connect();
              return {
                release: () => client.release(),
                query: async (sql, args) => {
                  if (String(sql).includes('FROM services WHERE tenant_id=$1') && String(sql).includes('FOR SHARE'))
                    entered();
                  return client.query(sql, args);
                },
              };
            },
          };
          let pending;
          try {
            await locked.query('BEGIN');
            await locked.query('UPDATE services SET default_price=200 WHERE id=$1', [service.id]);
            const writer = new ChecksService(hooked, new WarrantyService(pool), new ClientsService(pool, undefined));
            pending = f.run(() =>
              writer.create(
                f.tenant,
                f.owner,
                'director',
                {
                  masterId: f.owner,
                  isDeferred: true,
                  services: [f.line(service, 150)],
                  products: [],
                },
                f.actor(),
              ),
            );
            await reached;
            await locked.query('COMMIT');
            const check = await pending;
            assert.equal(check.services[0].priceThreshold, 200);
            assert.equal(check.services[0].catalogPriceVersion, 2);
            assert.equal(check.services[0].priceExcess, 0);
          } finally {
            await locked.query('ROLLBACK');
            locked.release();
            if (pending) await pending;
          }
        },
      );

      // Optional, safe negative control: run the original compiled implementation
      // from an explicit git revision against this disposable fixture. It must
      // exhibit the deleted-identity/lost-snapshot defect, proving the new oracle.
      await t.test(
        'negative control: pre-fix check edit loses line identity and snapshot',
        {
          skip: !process.env.OCT10_PRICING_REGRESSION_BASELINE,
        },
        async () => {
          const revision = process.env.OCT10_PRICING_REGRESSION_BASELINE;
          assert.match(revision, /^[0-9a-f]{8,40}$/);
          const { execFileSync } = require('node:child_process');
          const Module = require('node:module');
          const ts = require('typescript');
          const source = execFileSync('git', ['show', `${revision}:backend/src/checks/checks.service.ts`], {
            cwd: join(__dirname, '../..'),
            encoding: 'utf8',
          });
          const filename = join(__dirname, '../dist/checks/checks.service.baseline.js');
          const oldModule = new Module(filename, module);
          oldModule.filename = filename;
          oldModule.paths = module.paths;
          oldModule._compile(
            ts.transpileModule(source, {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2021,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
              },
            }).outputText,
            filename,
          );
          const f = await fixture(),
            service = await f.service();
          const check = await f.create([f.line(service, 150)]),
            line = check.services[0];
          await f.run(() => catalog.update(service.id, f.tenant, { defaultPrice: 200 }, f.owner));
          const old = new oldModule.exports.ChecksService(
            pool,
            new WarrantyService(pool),
            new ClientsService(pool, undefined),
          );
          await f.run(() =>
            old.update(check.id, f.tenant, 'director', { services: check.services, products: [] }, f.owner, f.actor()),
          );
          const after = await one('SELECT * FROM check_service_lines WHERE check_id=$1', [check.id]);
          assert.notEqual(after.id, line.id, 'original code recreates the same logical line');
          assert.equal(after.price_snapshot_status, 'legacy_unknown', 'original code drops the saved policy');
          assert.equal(after.price_threshold, null);
          assert.equal(Number(after.price_excess), 0, 'original code loses the actual increase of 50');
        },
      );

      await t.test(
        'duplicate/foreign ids rollback and legacy ambiguous history refuses 409, explicit reorder succeeds',
        async () => {
          const f = await fixture(),
            foreign = await fixture();
          const service = await f.service();
          let check = await f.create([f.line(service, 150)]);
          const a = check.services[0];
          await f.run(() => catalog.update(service.id, f.tenant, { defaultPrice: 200 }, f.owner));
          check = await f.edit(check, [a, f.line(service, 150)]);
          const b = check.services.find((s) => s.id !== a.id);
          assert.equal(a.priceThreshold, 100);
          assert.equal(b.priceThreshold, 200);
          const before = await q('SELECT * FROM check_service_lines WHERE check_id=$1 ORDER BY id', [check.id]);
          await assert.rejects(f.edit(check, [a, a]), status(400));
          await assert.rejects(
            f.edit(
              check,
              check.services.map(({ id, ...line }) => line),
            ),
            status(409),
          );
          const otherCheck = await f.create([f.line(service)]);
          await assert.rejects(f.edit(check, [otherCheck.services[0]]), status(400));
          const foreignService = await foreign.service();
          const foreignCheck = await foreign.create([foreign.line(foreignService)]);
          await assert.rejects(f.edit(check, [{ ...a, id: foreignCheck.services[0].id }]), status(400));
          assert.deepEqual(
            await q('SELECT * FROM check_service_lines WHERE check_id=$1 ORDER BY id', [check.id]),
            before,
          );
          check = await f.edit(check, [b, a]);
          assert.deepEqual(
            check.services.map((s) => s.priceThreshold).sort((a, b) => a - b),
            [100, 200],
          );
          const unique = await f.create([f.line(service)]);
          const uniqueId = unique.services[0].id;
          const legacy = unique.services.map(({ id, ...line }) => ({ ...line, price: 250 }));
          assert.equal((await f.edit(unique, legacy)).services[0].id, uniqueId);
        },
      );

      await t.test('legacy unknown and manual free text have no invented threshold, including later edit', async () => {
        const f = await fixture();
        const service = await f.service();
        let check = await f.create([]);
        const id = randomUUID();
        await q(
          'INSERT INTO check_service_lines(id,check_id,service_id,name,price,quantity,total) VALUES($1,$2,$3,$4,300,3,900)',
          [id, check.id, service.id, 'Мойка'],
        );
        await assert.rejects(f.edit(check, [f.line(service, 300, { quantity: 3 })]), status(409));
        check = await f.edit(check, [f.line(service, 300, { quantity: 3, masterId: f.owner })]);
        assert.equal(check.services[0].id, id);
        assert.equal(check.services[0].priceSnapshotStatus, 'legacy_unknown');
        check = await f.edit(check, [{ ...check.services[0], price: 500 }]);
        assert.equal(check.services[0].priceThreshold, null);
        assert.equal(check.servicePriceExcessTotal, 0);
        const manual = await f.create([{ name: 'Ad-hoc', price: 100, masterId: f.executor }]);
        assert.equal(manual.services[0].priceSnapshotStatus, 'no_catalog');
        assert.equal(manual.servicePriceExcessTotal, 0);
      });

      await t.test(
        'employee report separates actor/executor, distinct checks and positive excess; return links survive edits',
        async () => {
          const f = await fixture();
          const service = await f.service();
          let check = await f.create([f.line(service, 150, { quantity: 3 }), f.line(service, 80)]);
          check = await f.edit(check, [...check.services, f.line(service, 130)], {}, f.editor);
          check = await f.edit(check, check.services, { isDeferred: false, paymentMethod: 'cash' });
          const target = check.services.find((s) => s.quantity === 3);
          check = await f.edit(check, check.services, { comment: 'Edit before return' });
          assert.ok(check.services.some((s) => s.id === target.id));
          let built = await f.run(() => report.build(f.ctx()));
          const summary = () => built.sections.find((s) => s.key === 'servicePriceIncreases');
          assert.deepEqual(summary().totals, {
            name: 'Итого',
            increasedServiceLinesCount: 2,
            increasedChecksCount: 1,
            servicePriceExcessTotal: 180,
          });
          assert.equal(summary().rows.length, 2);
          assert.equal(
            summary().rows.reduce((n, r) => n + r.increasedChecksCount, 0),
            2,
          );
          const details = built.sections.find((s) => s.key === 'servicePriceIncreaseDetails').rows;
          assert.ok(details.every((d) => d.executor === 'Executor' && d._href === `/checks/${check.id}`));
          const revenueBefore = built.totals.revenue,
            salaryBefore = built.totals.salaryAccrued;
          assert.equal(revenueBefore, 660);
          assert.equal(salaryBefore, 66);
          const returns = new ReturnsService(pool, new WarehousesService(pool));
          await f.run(() =>
            returns.createReturn(
              f.tenant,
              f.owner,
              check.id,
              {
                destination: 'warehouse',
                scope: 'partial',
                lines: [{ serviceLineId: target.id, quantity: 1 }],
              },
              f.actor(),
            ),
          );
          const returned = await one(
            'SELECT rl.service_line_id FROM check_return_lines rl JOIN check_returns cr ON cr.id=rl.return_id WHERE cr.check_id=$1',
            [check.id],
          );
          assert.equal(returned.service_line_id, target.id);
          built = await f.run(() => report.build(f.ctx()));
          assert.equal(summary().totals.servicePriceExcessTotal, 130);
          assert.equal(summary().totals.increasedServiceLinesCount, 2);
          await assert.rejects(f.edit(check, check.services), status(400));
          const historical = await f.run(() => checks.getById(check.id, f.tenant, f.actor()));
          assert.equal(historical.servicePriceExcessTotal, 180);
          const full = await f.create([f.line(service, 150)], { isDeferred: false });
          await f.run(() =>
            returns.createReturn(f.tenant, f.owner, full.id, { destination: 'warehouse', scope: 'full' }, f.actor()),
          );
          await f.create([f.line(service, 900)]); // draft excluded
          await f.create([f.line(service, 900)], { isDeferred: false, paymentMethod: 'warranty' });
          built = await f.run(() => report.build(f.ctx()));
          assert.equal(summary().totals.servicePriceExcessTotal, 130);
          const selected = await f.run(() => report.build(f.ctx({ ids: [f.editor] })));
          assert.equal(selected.sections[0].totals.servicePriceExcessTotal, 30);
          const otherPoint = await f.run(() => report.build(f.ctx({ pointId: randomUUID() })));
          assert.equal(otherPoint.sections[0].totals.servicePriceExcessTotal, 0);
        },
      );
    } finally {
      for (const tenant of tenants) await admin.query('DELETE FROM tenants WHERE id=$1', [tenant]);
      await pool.end();
    }
  },
);
