const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductSharingService } = require('../dist/products/product-sharing.service');
const { productPhotos, validateProductPhotos } = require('../dist/products/product-photos');

test('ordered photos validate cardinality, duplicates, empty values and legacy fallback', () => {
  assert.deepEqual(productPhotos(undefined, '/legacy.jpg'), ['/legacy.jpg']);
  assert.deepEqual(validateProductPhotos([]), []);
  assert.deepEqual(validateProductPhotos([' a ', 'b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  for (const input of [null, [''], ['a', ' a '], [1], ['a', 'b', 'c', 'd', 'e']]) {
    assert.throws(() => validateProductPhotos(input), (error) => error.getStatus() === 400);
  }
});

test('public DTO reveals only allowed fields and proxies only exact owned storage paths', async () => {
  const tenant = 'b96b7544-696b-4d05-a740-213952b7b635';
  const token = 'a'.repeat(43);
  const photo = `/api/uploads/${tenant}/58fb3ad4-1865-4776-a488-72f1cf3e8139.webp`;
  const oldEnabled = process.env.INVENTORY_PREVIEW_ENABLED;
  const oldTenants = process.env.INVENTORY_PREVIEW_TENANTS;
  process.env.INVENTORY_PREVIEW_ENABLED = 'true';
  process.env.INVENTORY_PREVIEW_TENANTS = tenant;
  let reads = 0;
  const row = { name: 'Шина', tenant_id: tenant, id: 'secret-id', stock: 13, cost_price: 1000, sell_price: '1300.00',
    photos: [photo, 'https://evil.invalid/img', `/api/uploads/${tenant}/../../secrets.png`, '/api/uploads/other/a.png'] };
  const service = new ProductSharingService({ query: async () => ({ rows: [row] }) }, {
    resolve: () => { reads++; throw new Error('must not resolve invalid assets'); },
  });
  try {
    assert.deepEqual(await service.getPublic(token), {
      name: 'Шина', sellPrice: 1300, photos: [`/api/public/products/${token}/images/0`],
    });
    await assert.rejects(service.image(token, '1'), (error) => error.getStatus() === 404);
    await assert.rejects(service.getPublic('bad-token'), (error) => error.getStatus() === 404);
    assert.equal(reads, 0);
    process.env.INVENTORY_PREVIEW_ENABLED = 'false';
    await assert.rejects(service.getPublic(token), (error) => error.getStatus() === 404);
  } finally {
    if (oldEnabled === undefined) delete process.env.INVENTORY_PREVIEW_ENABLED;
    else process.env.INVENTORY_PREVIEW_ENABLED = oldEnabled;
    if (oldTenants === undefined) delete process.env.INVENTORY_PREVIEW_TENANTS;
    else process.env.INVENTORY_PREVIEW_TENANTS = oldTenants;
  }
});
