const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('reflect-metadata');
const { Module, Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { PublicBookingsController } = require('../dist/bookings/public-bookings.controller');
const { PublicBookingsService } = require('../dist/bookings/public-bookings.service');
const { RateLimitGuard } = require('../dist/common/guards/rate-limit.guard');
const { ETagInterceptor } = require('../dist/common/interceptors/etag.interceptor');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { redactPublicBookingTelemetry } = require('../dist/common/sentry');

Logger.overrideLogger(false);

test('real Nest/Express public routing keeps privacy and anonymous budgets with mixed static casing', async (t) => {
  const calls = [],
    logs = [],
    budget = [];
  const privateName = 'PRIVATE_FORM_NAME',
    privatePhone = '+79991112233',
    capability = 'PRIVATE_RECOVERY_CAPABILITY';
  const service = {
    landing: (slug) => ({ slug }),
    submit: (slug, dto) => {
      calls.push({ slug, dto });
      if (slug === 'failure') throw new Error(privateName + privatePhone + capability);
      return { slug };
    },
    status: (slug, requestId, recovery) => ({ slug, requestId, recoveryMatches: recovery === capability }),
  };
  class HttpTestModule {}
  Module({
    controllers: [PublicBookingsController],
    providers: [{ provide: PublicBookingsService, useValue: service }],
  })(HttpTestModule);
  const app = await NestFactory.create(HttpTestModule, { logger: false });
  const interval = global.setInterval;
  let guard;
  global.setInterval = () => ({});
  try {
    guard = new RateLimitGuard();
  } finally {
    global.setInterval = interval;
  }
  const bump = guard.bump.bind(guard);
  guard.bump = (...args) => {
    budget.push(args.slice(0, 2));
    return bump(...args);
  };
  const filter = new HttpExceptionFilter();
  filter.logger = { error: (...args) => logs.push(args) };
  app.setGlobalPrefix('api');
  app.useGlobalGuards(guard);
  app.useGlobalInterceptors(new ETagInterceptor());
  app.useGlobalFilters(filter);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const post = (slug, n) =>
    fetch(`${base}/API/Public/Bookings/${slug}/ReQuEsTs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer rotated-${n}` },
      body: JSON.stringify({ name: privateName, phone: privatePhone, recoveryToken: capability }),
    });
  try {
    await t.test(
      'rotating bearer and encoded slug still share 5/IP/slug and 20/IP, with original values preserved',
      async () => {
        for (let i = 0; i < 5; i++) {
          const r = await post(i % 2 ? '%64emo' : 'demo', i);
          assert.equal(r.status, 201);
          assert.deepEqual(await r.json(), { slug: 'demo' });
        }
        assert.equal((await post('demo', 5)).status, 429);
        assert.ok(
          budget
            .slice(0, 10)
            .every(([key, max], i) => key.endsWith(i % 2 ? '127.0.0.1' : ':demo') && max === (i % 2 ? 20 : 5)),
        );
        const upper = await post('Demo', 6);
        assert.equal(upper.status, 201);
        assert.deepEqual(await upper.json(), { slug: 'Demo' }, 'only static segments are case insensitive');
        assert.equal(budget.at(-2)[0].endsWith(':invalid'), true, 'invalid slug is not silently lowercased');
        for (let i = 0; i < 13; i++) assert.equal((await post(`another-${i}`, 10 + i)).status, 201);
        assert.equal((await post('last-one', 99)).status, 429, 'IP backstop applies across slugs and bearer rotation');
      },
    );
    await t.test(
      'GET keeps no-store and cannot use the interceptor price-cache ETag; capability casing is untouched',
      async () => {
        const path = '/aPi/PuBlIc/BoOkInGs/Mixed-Slug';
        const etag =
          '"' +
          createHash('md5')
            .update(JSON.stringify({ slug: 'Mixed-Slug' }))
            .digest('hex') +
          '"';
        const r = await fetch(base + path, { headers: { 'If-None-Match': etag } });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.notEqual(r.headers.get('etag'), etag);
        assert.deepEqual(await r.json(), { slug: 'Mixed-Slug' });
        const status = await fetch(base + path + '/REQUESTS/12345678-1234-4234-8234-123456789aBc', {
          headers: { 'X-Booking-Recovery': capability },
        });
        assert.equal(status.status, 200);
        assert.deepEqual(await status.json(), {
          slug: 'Mixed-Slug',
          requestId: '12345678-1234-4234-8234-123456789aBc',
          recoveryMatches: true,
        });
      },
    );
    await t.test('mixed-case 5xx and Sentry remove body/query/header and repeated private values', async () => {
      // Reset only this test's in-memory counter to exercise the error route after the quota test.
      guard.attempts.clear();
      const r = await fetch(`${base}/api/Public/Bookings/failure/requests?phone=${encodeURIComponent(privatePhone)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Booking-Recovery': capability },
        body: JSON.stringify({ name: privateName, phone: privatePhone }),
      });
      assert.equal(r.status, 500);
      assert.equal(calls.at(-1).slug, 'failure', 'actual Express router accepted mixed static casing');
      const telemetry = redactPublicBookingTelemetry({
        request: {
          url: `${base}/API/Public/Bookings/failure/requests?recoveryToken=${capability}`,
          data: { name: privateName, phone: privatePhone },
          query_string: capability,
          headers: { 'X-Booking-Recovery': capability },
        },
        extra: { privateName },
        breadcrumbs: [{ message: privatePhone }],
        exception: { value: capability },
      });
      for (const secret of [privateName, privatePhone, capability]) {
        assert.equal(JSON.stringify(logs).includes(secret), false);
        assert.equal(JSON.stringify(telemetry).includes(secret), false);
      }
      assert.ok(logs.length, '5xx remains observable');
      const other = { request: { url: '/api/checks', data: { name: privateName } } };
      assert.deepEqual(redactPublicBookingTelemetry(structuredClone(other)), other);
    });
  } finally {
    await app.close();
  }
});
