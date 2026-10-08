const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('real service-worker dispatch bypasses only the three durable financial POST routes', async () => {
  const listeners = new Map();
  const sandbox = {
    URL,
    Response,
    Request,
    console,
    setTimeout,
    clearTimeout,
    self: { location: { origin: 'https://autexa-cloud.ru' }, addEventListener: (type, fn) => listeners.set(type, fn) },
    fetch: async () => new Response('{}', { status: 200 }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend/public/sw.js'), 'utf8'), sandbox);
  const invoke = (method, url) => {
    let handled = false;
    listeners.get('fetch')({
      request: new Request('https://autexa-cloud.ru' + url, { method }),
      respondWith: (promise) => {
        handled = true;
        void Promise.resolve(promise).catch(() => {});
      },
    });
    return handled;
  };
  for (const url of [
    '/api/purchase-orders/123/receive',
    '/api/suppliers/deliveries',
    '/api/suppliers/deliveries/123/returns',
  ])
    assert.equal(invoke('POST', url), false);
  for (const url of [
    '/api/checks',
    '/api/suppliers/payments',
    '/api/suppliers/returns',
    '/api/purchase-orders/123/cancel',
  ])
    assert.equal(invoke('POST', url), true);
  assert.equal(invoke('PATCH', '/api/suppliers/deliveries/123'), true);
});
