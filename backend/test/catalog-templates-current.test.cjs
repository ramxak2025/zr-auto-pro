const test = require('node:test');
const assert = require('node:assert/strict');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { ServicesService } = require('../dist/services/services.service');
const owner = { userID: 'owner', role: 'director' };
const staff = { userID: 'staff', role: 'master', permissions: { warehouse_manage: false } };
const productId = '00000000-0000-0000-0000-000000000001';
const serviceId = '00000000-0000-0000-0000-000000000002';
const missingId = '00000000-0000-0000-0000-000000000003';
function fixture() {
  const calls = [];
  const rows = [
    {
      id: '00000000-0000-0000-0000-000000000004',
      product_version: '1234',
      name: 'ТО',
      user_id: null,
      services: [
        { serviceId, name: 'Работа', price: 10, quantity: 3 },
        { name: 'Ручная', price: 17, quantity: 1 },
      ],
      products: [{ productId, name: 'Масло', sellPrice: 15, costPrice: 999, quantity: 2.5 }],
    },
  ];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('FROM check_templates')) return { rows };
    if (sql.includes('FROM services'))
      return {
        rows: [{ id: serviceId, default_price: '240', price_type: 'range', min_price: '240', max_price: '550' }],
      };
    if (sql.includes('FROM products')) return { rows: [{ id: productId, sell_price: '100', cost_price: '12' }] };
    throw Error(sql);
  };
  return { rows, calls, query, connect: async () => ({ query, release() {} }) };
}
test('template read projects current prices in batched tenant scoped reads without rewriting saved quantities/manual lines', async () => {
  const pool = fixture();
  pool.rows.push({ ...pool.rows[0], id: 'second' });
  const result = await new CheckTemplatesService(pool).getAll('tenant', owner);
  assert.equal(result[0].services[0].price, 240);
  assert.equal(result[0].services[0].quantity, 3);
  assert.equal(result[0].services[0].maxPrice, 550);
  assert.equal(result[0].services[1].price, 17);
  assert.equal(result[0].products[0].sellPrice, 100);
  assert.equal(result[0].products[0].costPrice, 12);
  assert.equal(result[0].productCostTotal, 30);
  assert.equal(pool.rows[0].products[0].costPrice, 999);
  assert.equal(pool.rows[0].services[0].price, 10);
  assert.equal(pool.calls.length, 3);
  assert.deepEqual(pool.calls[0].values, ['tenant', 'owner']);
  assert.ok(pool.calls.slice(1).every((call) => call.values[0] === 'tenant' && call.sql.includes('tenant_id=$1')));
});
test('all template product cost data is omitted for unauthorized staff even when stored JSON or catalog contains cost', async () => {
  const pool = fixture();
  const result = await new CheckTemplatesService(pool).getAll('tenant', staff);
  assert.equal(/costPrice|costStatus|productCostTotal/.test(JSON.stringify(result)), false);
  assert.equal(pool.calls.find((call) => call.sql.includes('FROM products')).sql.includes('cost_price'), false);
});
test('broken linked cost is unknown; manual saved costs and explicit zero retain their economics', async () => {
  const pool = fixture();
  pool.rows[0].products.push(
    { productId: missingId, name: 'Deleted', costPrice: 123, sellPrice: 60, quantity: 2 },
    { name: 'Manual', costPrice: 500, sellPrice: 70, quantity: 1 },
  );
  const result = (await new CheckTemplatesService(pool).getAll('tenant', owner))[0];
  assert.equal(result.costStatus, 'unknown');
  assert.equal(result.productCostTotal, undefined);
  assert.equal(result.products[1].costPrice, undefined);
  assert.equal(result.products[1].catalogStatus, 'unavailable');
  assert.equal(result.products[2].costStatus, 'known');
  assert.equal(result.products[2].costPrice, 500);
  assert.deepEqual(result.products[2].sourceTemplateProduct, {
    templateId: pool.rows[0].id,
    productIndex: 2,
    version: '1234',
  });
  assert.equal(result.products[2].catalogStatus, 'manual');
  assert.ok(pool.calls.find((call) => call.sql.includes('FROM products')).sql.includes('deleted_at IS NULL'));
  const zero = fixture();
  zero.query = async (sql) =>
    sql.includes('FROM check_templates')
      ? { rows: zero.rows }
      : sql.includes('FROM services')
        ? { rows: [] }
        : { rows: [{ id: productId, sell_price: 0, cost_price: 0 }] };
  assert.equal((await new CheckTemplatesService(zero).getAll('tenant', owner))[0].productCostTotal, 0);
});
test('execution history keeps exact actor+tenant+client predicate and strips inaccessible client context from journal links', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM services')) return { rows: [{ id: serviceId }] };
      if (sql.includes('COUNT')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
  const clients = {
    separatePointFor: async () => 'point',
    separatePointWhere: (alias, point, values) => {
      values.push(point);
      return ` AND (${alias}.point_id=$${values.length} OR ${alias}.point_id IS NULL)`;
    },
  };
  const result = await new ServicesService(pool, clients).getExecutionHistory(
    serviceId,
    'tenant',
    { ...staff, currentPointId: 'point' },
    {},
  );
  assert.equal(result.total, 0);
  const sql = calls[2].sql;
  assert.ok(sql.includes('ch.deleted_at IS NULL'));
  assert.ok(sql.includes('ch.is_deferred=false'));
  assert.ok(sql.includes('assigned.user_id=$3'));
  assert.ok(sql.includes('c.tenant_id=$1'));
  assert.ok(sql.includes('CASE WHEN EXISTS'));
  assert.deepEqual(calls[1].values, ['tenant', serviceId, 'staff', 'point']);
});

test('malformed legacy linked identifiers are unavailable rather than sent to a UUID cast', async () => {
  const pool = fixture();
  pool.rows[0].products = [{ productId: '-'.repeat(36), name: 'Legacy', costPrice: 500, sellPrice: 10, quantity: 1 }];
  const result = (await new CheckTemplatesService(pool).getAll('tenant', owner))[0];
  assert.equal(result.costStatus, 'unknown');
  assert.equal(result.products[0].catalogStatus, 'unavailable');
  assert.equal(
    pool.calls.some((call) => call.sql.includes('FROM products')),
    false,
  );
});

test('template cost rounds each fractional product line before summing', async () => {
  const pool = fixture();
  pool.rows[0].products = [
    { productId, name: 'A', sellPrice: 20, quantity: 1.5 },
    { productId, name: 'B', sellPrice: 20, quantity: 1.5 },
  ];
  const original = pool.query;
  pool.query = async (...args) => {
    const result = await original(...args);
    if (args[0].includes('FROM products'))
      result.rows.forEach((row) => {
        row.cost_price = '10.01';
      });
    return result;
  };
  const result = (await new CheckTemplatesService(pool).getAll('tenant', owner))[0];
  assert.equal(result.productCostTotal, 30.04);
  pool.rows[0].products = [{ name: 'Unknown', sellPrice: 20, quantity: 1 }];
  assert.equal((await new CheckTemplatesService(pool).getAll('tenant', owner))[0].productCostTotal, undefined);
  pool.rows[0].products[0].costPrice = 0;
  assert.equal((await new CheckTemplatesService(pool).getAll('tenant', owner))[0].productCostTotal, 0);
});
