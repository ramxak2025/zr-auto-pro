const test = require('node:test');
const assert = require('node:assert/strict');
const { ServicesService } = require('../dist/services/services.service');

const status = (code) => (error) => error.getStatus?.() === code;

function fakePool() {
  const calls = [];
  let storedBatch;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT * FROM services WHERE tenant_id=')) return { rows: [] };
      if (sql.startsWith('INSERT INTO service_import_batches')) {
        storedBatch = {
          id: params[0],
          tenant_id: params[1],
          actor_id: params[2],
          preview_rows: JSON.parse(params[3]),
          preview_result: JSON.parse(params[4]),
          result: null,
        };
      }
      if (sql.startsWith('SELECT id, result FROM service_import_batches')) return { rows: [] };
      if (sql.startsWith('SELECT * FROM service_import_batches')) return { rows: storedBatch ? [storedBatch] : [] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client, query: client.query }, calls };
}

test('raw service import rows produce structured preview errors and reject mixed confirmation atomically', async () => {
  const fake = fakePool();
  const service = new ServicesService(fake.pool);
  const preview = await service.previewImport('tenant-a', 'owner-a', [
    null,
    { sourceRow: 3, name: 42, priceType: 'fixed', defaultPrice: 0 },
    { sourceRow: 4, name: 'Bad category', category: {}, priceType: 'fixed', defaultPrice: 1 },
    { sourceRow: 5, name: 'Missing amount', priceType: 'fixed' },
    { sourceRow: 6, name: 'Missing type', defaultPrice: 0 },
    { sourceRow: 7, name: 'Unknown type', priceType: 'free', defaultPrice: 0 },
    { sourceRow: 8, name: 'Explicit zero', priceType: 'fixed', defaultPrice: 0 },
  ]);
  assert.deepEqual(preview.summary, { totalRows: 7, create: 1, update: 0, errors: 6 });
  assert.deepEqual(preview.rows.map((row) => row.action), ['error', 'error', 'error', 'error', 'error', 'error', 'create']);
  await assert.rejects(service.confirmImport('tenant-a', 'owner-a', preview.previewId, '54bce4c0-93e6-43ef-9e27-8c4f6c5a92b1'), status(400));
  assert.equal(fake.calls.some(({ sql }) => sql.startsWith('INSERT INTO services')), false);
  assert.equal(fake.calls.some(({ sql }) => sql.startsWith('UPDATE services')), false);
});

test('preview rejects a non-array raw body before catalog access', async () => {
  const fake = fakePool();
  const service = new ServicesService(fake.pool);
  await assert.rejects(service.previewImport('tenant-a', 'owner-a', { rows: [] }), status(400));
  assert.equal(fake.calls.some(({ sql }) => sql.startsWith('SELECT * FROM services')), false);
});
