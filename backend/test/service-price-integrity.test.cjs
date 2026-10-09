const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe } = require('@nestjs/common');
const { normalizeServicePrice } = require('../dist/services/service-price-policy');
const { matchServiceLineIds } = require('../dist/checks/check-service-prices');
const { CheckServiceLineDto } = require('../dist/checks/dto/check-line.dto');
const { ServicesService } = require('../dist/services/services.service');

const status = (code) => (error) => error.getStatus?.() === code;
const line = (overrides = {}) => ({ name: 'Мойка', price: 100, quantity: 1, total: 100, ...overrides });
const saved = (overrides = {}) => ({
  id: randomUUID(),
  service_id: null,
  master_id: null,
  name: 'Мойка',
  price: '100',
  quantity: 1,
  price_snapshot_status: 'catalog',
  catalog_price_type: 'fixed',
  catalog_default_price: '100',
  catalog_min_price: '100',
  catalog_max_price: '100',
  catalog_price_version: 1,
  price_threshold: '100',
  price_changed_by: null,
  price_changed_at: null,
  ...overrides,
});

test('fixed/range input is finite, nonnegative and ordered; legacy fixed and zero remain valid', () => {
  assert.deepEqual(normalizeServicePrice({ defaultPrice: 0 }), {
    priceType: 'fixed',
    defaultPrice: 0,
    minPrice: 0,
    maxPrice: 0,
  });
  const range = normalizeServicePrice({ priceType: 'range', minPrice: '50', maxPrice: 200 });
  assert.deepEqual(range, { priceType: 'range', defaultPrice: 50, minPrice: 50, maxPrice: 200 });
  assert.equal(normalizeServicePrice({ defaultPrice: 60 }, range).minPrice, 60);
  assert.equal(normalizeServicePrice({ defaultPrice: 60 }, range).maxPrice, 200);
  for (const dto of [
    { defaultPrice: -1 },
    { defaultPrice: Infinity },
    { defaultPrice: NaN },
    { defaultPrice: null },
    { defaultPrice: '' },
    { priceType: null },
    { priceType: 'other' },
    { priceType: 'range', minPrice: 200, maxPrice: 100 },
    { priceType: 'range', minPrice: 100 },
    { priceType: 'range', minPrice: 0, maxPrice: Infinity },
  ]) {
    assert.throws(() => normalizeServicePrice(dto), status(400));
  }
});

test('check DTO preserves a valid server id, strips fabricated provenance and keeps below-range prices valid', async () => {
  const id = randomUUID();
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const result = await pipe.transform(
    {
      id,
      name: 'Мойка',
      price: '0',
      quantity: 3,
      priceSnapshotStatus: 'catalog',
      catalogMaxPrice: 999999,
      priceThreshold: 999999,
      priceChangedBy: randomUUID(),
      priceChangedAt: '2000-01-01',
      priceExcess: -100,
    },
    { type: 'body', metatype: CheckServiceLineDto },
  );
  assert.deepEqual({ ...result }, { id, name: 'Мойка', price: 0, quantity: 3 });
  await assert.rejects(
    pipe.transform({ id: 'not-a-server-id', price: 100 }, { type: 'body', metatype: CheckServiceLineDto }),
    status(400),
  );
});

test('identity rejects duplicate ids and a foreign/missing id before any rewrite', () => {
  const prior = saved();
  assert.throws(() => matchServiceLineIds([line({ id: prior.id }), line({ id: prior.id })], [prior]), status(400));
  assert.throws(() => matchServiceLineIds([line({ id: randomUUID() })], [prior]), status(400));
  assert.throws(() => matchServiceLineIds([line({ id: prior.id })], []), status(400));
  assert.equal(matchServiceLineIds([line({ id: prior.id, name: 'Changed', price: 90 })], [prior])[0].id, prior.id);
});

test('legacy matching reserves exact unchanged lines before matching a price edit, regardless of reorder', () => {
  const a = saved({ price: '100' }),
    b = saved({ price: '200', catalog_default_price: '200', price_threshold: '200' });
  assert.deepEqual(
    matchServiceLineIds([line({ price: 250 }), line({ price: 100 })], [a, b]).map((r) => r.id),
    [b.id, a.id],
  );
  assert.deepEqual(
    matchServiceLineIds([line({ price: 100 }), line({ price: 250 })], [a, b]).map((r) => r.id),
    [a.id, b.id],
  );
});

test('legacy ambiguous equal-price duplicates with different snapshots/provenance fail 409 instead of rebasing history', () => {
  const a = saved(),
    b = saved({ catalog_price_version: 2, price_threshold: '200' });
  assert.throws(
    () => matchServiceLineIds([line(), line()], [a, b]),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(error.getResponse().code, 'SERVICE_LINE_ID_REQUIRED');
      assert.match(error.getResponse().message, /историей цен/);
      return true;
    },
  );
  const identical = saved();
  assert.equal(new Set(matchServiceLineIds([line(), line()], [a, identical]).map((r) => r.id)).size, 2);
});

test('catalogue mutation and actor stamp share one transaction and rollback on history/insert failure', async () => {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push({ sql: String(sql), args });
      if (String(sql).startsWith('INSERT INTO services')) throw new Error('history write failed');
      return { rows: [] };
    },
    release: () => calls.push({ sql: 'release' }),
  };
  const pool = {
    connect: async () => client,
    query: () => assert.fail('must not split the actor and mutation across pool connections'),
  };
  await assert.rejects(
    new ServicesService(pool).create(randomUUID(), { name: 'Мойка', defaultPrice: 100 }, randomUUID()),
    /history write failed/,
  );
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /set_config\('app.service_price_actor', \$1, true\)/);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
  assert.equal(calls.at(-1).sql, 'release');
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
});
