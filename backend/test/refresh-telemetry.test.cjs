const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { redactRefreshTelemetry } = require('../dist/common/refresh-telemetry');
test('refresh recovery capability is absent from headers, errors, breadcrumbs and nested context', () => {
  const key = '9ce3ca96-9ab8-4be2-b775-9b7d63f8ac6f';
  const value = {
    request: { headers: { 'X-Refresh-Request-ID': key } },
    extra: { config: { headers: { 'x-refresh-request-id': key } } },
    breadcrumbs: [{ message: `refreshRequestId=${key}`, data: { refreshRequestId: key } }],
    exception: { values: [{ value: `failed request ${key}` }] },
    code: 'ECONNRESET',
  };
  const clean = redactRefreshTelemetry(value);
  assert.equal(JSON.stringify(clean).includes(key), false);
  assert.equal(clean.code, 'ECONNRESET');
  assert.equal(value.request.headers['X-Refresh-Request-ID'], key, 'do not mutate live request headers');
  assert.equal(
    JSON.stringify(
      redactRefreshTelemetry({ message: key }, { config: { headers: { 'x-refresh-request-id': key } } }),
    ).includes(key),
    false,
  );
});
test('mobile and server recovery telemetry redactors stay identical', () => {
  assert.equal(
    readFileSync(join(__dirname, '../src/common/refresh-telemetry.ts'), 'utf8'),
    readFileSync(join(__dirname, '../../mobile/src/utils/refreshTelemetry.ts'), 'utf8'),
  );
});
