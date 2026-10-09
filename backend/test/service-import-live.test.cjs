// Explicitly disposable PostgreSQL16 fixture only. Never fall back to production config.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { ServicesService } = require('../dist/services/services.service');

Logger.overrideLogger(false);
const live = process.env.OCT10_PRICING_LIVE_DB;
const status = (code) => (error) => error.getStatus?.() === code;

test('service import preview, atomic confirm, price history, idempotency, version conflict and tenant isolation', { skip: !live, timeout: 120000 }, async (t) => {
  const url = new URL(live);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55438');
  assert.equal(url.pathname, '/autexa_oct8_test');
  const appUrl = new URL(live);
  appUrl.username = 'autexa_app';
  appUrl.password = process.env.OCT10_PRICING_APP_PASSWORD;
  assert.ok(appUrl.password);
  const admin = new Pool({ connectionString: live, max: 4 });
  const app = new Pool({ connectionString: appUrl.toString(), max: 4 });
  const pool = new TenantAwarePool(admin, app);
  const services = new ServicesService(pool);
  const tenants = [];
  const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const run = (tenant, fn) => runWithTenant(tenant, fn);
  const fixture = async (name) => {
    const f = { tenant: randomUUID(), user: randomUUID() };
    tenants.push(f.tenant);
    await q("INSERT INTO tenants(id,name,timezone) VALUES($1,$2,'Europe/Moscow')", [f.tenant, name]);
    await q("INSERT INTO users(id,tenant_id,phone,password,full_name,role) VALUES($1,$2,$3,'unused',$4,'director')", [f.user, f.tenant, f.user, name + ' owner']);
    f.create = (input) => run(f.tenant, () => services.create(f.tenant, input, f.user));
    f.preview = (rows) => run(f.tenant, () => services.previewImport(f.tenant, f.user, rows));
    f.confirm = (previewId, requestId = randomUUID()) => run(f.tenant, () => services.confirmImport(f.tenant, f.user, previewId, requestId));
    return f;
  };

  try {
    const a = await fixture('Service import tenant A ' + randomUUID());
    const b = await fixture('Service import tenant B ' + randomUUID());
    const existing = await a.create({ name: 'Замена масла', category: 'Двигатель/ТО', defaultPrice: 100 });
    const foreign = await b.create({ name: 'Чужая услуга', category: 'Двигатель/ТО', defaultPrice: 300 });

    await t.test('preview classifies rows, rejects repeated rows and foreign IDs without last-write-wins', async () => {
      const preview = await a.preview([
        { sourceRow: 2, id: foreign.id, name: 'Подмена', priceType: 'fixed', defaultPrice: 20 },
        { sourceRow: 3, name: 'Новая услуга', category: 'Диагностика/Двигатель', priceType: 'range', minPrice: 50, maxPrice: 90 },
        { sourceRow: 4, name: 'замена масла', category: 'Двигатель / ТО', priceType: 'fixed', defaultPrice: 120 },
        { sourceRow: 5, name: 'Повтор', category: 'X/Y', priceType: 'fixed', defaultPrice: 0 },
        { sourceRow: 6, name: ' повтор ', category: 'X / Y', priceType: 'fixed', defaultPrice: 1 },
        { sourceRow: 7, name: 'Без диапазона', priceType: 'range' },
      ]);
      assert.equal(preview.summary.create, 1);
      assert.equal(preview.summary.update, 1);
      assert.equal(preview.summary.errors, 4);
      assert.equal(preview.rows.find((row) => row.sourceRow === 4).serviceId, existing.id);
      assert.equal(preview.rows.find((row) => row.sourceRow === 2).action, 'error');
      assert.equal(preview.rows.find((row) => row.sourceRow === 5).action, 'error');
      assert.equal(preview.rows.find((row) => row.sourceRow === 6).action, 'error');
      assert.equal(preview.rows.find((row) => row.sourceRow === 7).action, 'error');
    });

    await t.test('confirmed import applies all rows atomically, records history once, and replays the same result', async () => {
      const preview = await a.preview([
        { sourceRow: 2, name: 'Новая range', category: 'Подвеска/Работы', priceType: 'range', minPrice: 200, maxPrice: 500, masterPercent: 0, warrantyDays: 7 },
        { sourceRow: 3, id: existing.id, name: 'Замена масла', category: 'Двигатель/ТО', priceType: 'fixed', defaultPrice: 250, masterPercent: 20 },
      ]);
      const requestId = randomUUID();
      const result = await a.confirm(preview.previewId, requestId);
      assert.equal(result.created, 1);
      assert.equal(result.updated, 1);
      const historyBefore = await q('SELECT count(*)::int AS n FROM service_price_history WHERE tenant_id=$1', [a.tenant]);
      const replay = await a.confirm(preview.previewId, requestId);
      const historyAfter = await q('SELECT count(*)::int AS n FROM service_price_history WHERE tenant_id=$1', [a.tenant]);
      assert.deepEqual(replay, JSON.parse(JSON.stringify(result)));
      assert.equal(historyAfter[0].n, historyBefore[0].n);
      const updated = await q('SELECT s.price_version, s.default_price, h.changed_by FROM services s JOIN service_price_history h ON h.service_id=s.id WHERE s.id=$1 AND h.version=s.price_version', [existing.id]);
      assert.equal(Number(updated[0].default_price), 250);
      assert.equal(updated[0].changed_by, a.user);
      const ownRows = await run(a.tenant, () => services.exportCatalog(a.tenant));
      assert.equal(ownRows.some((service) => service.id === foreign.id), false);
    });

    await t.test('stale price version rejects the whole batch after preview', async () => {
      const preview = await a.preview([
        { sourceRow: 2, name: 'Не должен сохраниться', category: 'Новая/Папка', priceType: 'fixed', defaultPrice: 1 },
        { sourceRow: 3, id: existing.id, name: 'Замена масла', category: 'Двигатель/ТО', priceType: 'fixed', defaultPrice: 400 },
      ]);
      await run(a.tenant, () => services.update(existing.id, a.tenant, { defaultPrice: 350 }, a.user));
      await assert.rejects(a.confirm(preview.previewId), status(409));
      const created = await q('SELECT id FROM services WHERE tenant_id=$1 AND name=$2', [a.tenant, 'Не должен сохраниться']);
      assert.equal(created.length, 0);
    });
  } finally {
    for (const tenant of tenants) await q('DELETE FROM tenants WHERE id=$1', [tenant]);
    await pool.end();
  }
});
