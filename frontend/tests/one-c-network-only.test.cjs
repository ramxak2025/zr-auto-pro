const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('1C connection, key rotation and journal bypass service-worker cache and mutation replay', () => {
  let onFetch;
  const context = {
    self: {
      location: { origin: 'https://autexa.test' },
      addEventListener: (type, fn) => {
        if (type === 'fetch') onFetch = fn;
      },
    },
    URL,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), context);
  for (const [method, route] of [
    ['POST', '/api/one-c/connection'],
    ['PATCH', '/api/one-c/connection'],
    ['POST', '/api/one-c/connection/rotate-key'],
    ['GET', '/api/one-c/journal'],
  ]) {
    onFetch({
      request: { method, url: `https://autexa.test${route}` },
      respondWith: () => assert.fail(`${method} ${route} intercepted`),
    });
  }
});
