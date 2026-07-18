const assert = require('node:assert/strict');
const test = require('node:test');

const { RateLimitGuard } = require('../dist/common/guards/rate-limit.guard.js');

function createGuard() {
  // The production guard owns a periodic cleanup timer. Unit tests replace
  // the timer while constructing the guard so the test process can terminate.
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  try {
    return new RateLimitGuard();
  } finally {
    global.setInterval = originalSetInterval;
  }
}

function contextFor({ path, url = path, method = 'GET' }) {
  const request = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    method,
    path,
    url,
    headers: {},
  };

  return {
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
      };
    },
  };
}

function rejectAllMeteredRequests(guard) {
  const calls = [];
  guard.bump = async (key, max, now) => {
    calls.push({ key, max });
    return { overLimit: true, resetAt: now + 60_000 };
  };
  return calls;
}

test('canActivate bypasses only exact GET/HEAD public liveness paths', async () => {
  const acceptedRequests = [
    { path: '/health' },
    { path: '/health/' },
    { path: '/api/health' },
    { path: '/api/health/' },
    { path: '/api/health', url: '/api/health?source=mobile' },
    { path: '/api/health/', url: '/api/health/?source=mobile', method: 'HEAD' },
    // Express normally supplies `request.path` without the query string. The
    // URL-only case covers the guard's fallback used by non-Express contexts.
    { path: undefined, url: '/api/health?source=fallback' },
  ];

  for (const request of acceptedRequests) {
    const guard = createGuard();
    const meterCalls = rejectAllMeteredRequests(guard);

    assert.equal(await guard.canActivate(contextFor(request)), true);
    assert.deepEqual(meterCalls, [], `${request.method || 'GET'} ${request.url || request.path} was metered`);
  }
});

test('canActivate keeps /health/db and lookalike paths inside the ordinary quota', async () => {
  const meteredRequests = [
    { path: '/health/db' },
    { path: '/api/health/db' },
    { path: '/api/health/db', url: '/api/health/db?source=monitor' },
    { path: undefined, url: '/api/health/db?source=fallback' },
    { path: '/healthcheck' },
    { path: '/v1/health' },
    { path: '/api/health', method: 'POST' },
  ];

  for (const request of meteredRequests) {
    const guard = createGuard();
    const meterCalls = rejectAllMeteredRequests(guard);

    await assert.rejects(
      guard.canActivate(contextFor(request)),
      (error) => error?.getStatus?.() === 429,
      `${request.method || 'GET'} ${request.url || request.path} unexpectedly bypassed the quota`,
    );
    assert.equal(meterCalls.length, 1);
    assert.equal(meterCalls[0].max, request.method === 'POST' ? 150 : 600);
  }
});
