const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { Logger } = require('@nestjs/common');
const { of, firstValueFrom } = require('rxjs');
require('reflect-metadata');
const { PublicBookingsService } = require('../dist/bookings/public-bookings.service');
const {
  PublicBookingsController,
  BookingPublicationController,
} = require('../dist/bookings/public-bookings.controller');
const { BookingsService } = require('../dist/bookings/bookings.service');
const { BookingReminderService } = require('../dist/bookings/booking-reminder.service');
const { PublicBookingSubmitDto, validatedBookingDto } = require('../dist/bookings/dto/public-booking.dto');
const { TenantAwarePool } = require('../dist/common/tenant-pool');
const { runWithTenant } = require('../dist/common/tenant-context');
const { TenantsService } = require('../dist/tenants/tenants.service');
const { PointsService } = require('../dist/points/points.service');
const { ScheduleService } = require('../dist/schedule/schedule.service');
const { PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
const { RateLimitGuard } = require('../dist/common/guards/rate-limit.guard');
const { ETagInterceptor } = require('../dist/common/interceptors/etag.interceptor');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { redactPublicBookingTelemetry, redactNfcTelemetry } = require('../dist/common/sentry');
Logger.overrideLogger(false);
const uuid = randomUUID,
  token = () => randomBytes(32).toString('base64url'),
  wire = (x) => JSON.parse(JSON.stringify(x));
const at = (hour = '10:00', date = '2060-01-12', zone = '+03:00') =>
  new Date(`${date}T${hour}:00${zone}`).toISOString();
const failure = (status, code) => (e) => e.getStatus?.() === status && (!code || e.getResponse().code === code);
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const request = () => ({
  requestId: uuid(),
  recoveryToken: token(),
  serviceIds: [uuid()],
  startsAt: at(),
  name: 'Заявитель',
  phone: '+7 (999) 111-22-33',
  consentVersion: uuid(),
  consentAccepted: true,
});

test('public DTO and route boundaries: explicit consent, limits, no actor/resource/point override; canonical staff gates', () => {
  assert.equal(Reflect.getMetadata('__guards__', PublicBookingsController), undefined);
  for (const method of ['settings', 'put', 'resources', 'publish', 'unpublish'])
    assert.equal(Reflect.getMetadata(PERMISSION_KEY, BookingPublicationController.prototype[method]), 'company_manage');
  for (const method of ['requests', 'approve', 'reject'])
    assert.equal(
      Reflect.getMetadata(PERMISSION_KEY, BookingPublicationController.prototype[method]),
      'bookings_access',
    );
  for (const patch of [
    { consentAccepted: false },
    { name: 'control\ncharacter' },
    { name: '<script>alert(1)</script>' },
    { name: 'x'.repeat(101) },
    { comment: 'x'.repeat(1001) },
    { recoveryToken: 'short' },
    { requestId: 'bad' },
    { pointId: uuid() },
    { resourceId: uuid() },
    { tenantId: uuid() },
  ])
    assert.throws(() => validatedBookingDto(PublicBookingSubmitDto, { ...request(), ...patch }), failure(400));
  assert.equal(validatedBookingDto(PublicBookingSubmitDto, request()).consentAccepted, true);
});

test('public telemetry and HTTP 5xx never export contact/capability, other route telemetry remains intact, no-store survives ETag', async () => {
  const secret = token(),
    name = 'PRIVATE_FORM_NAME',
    phone = '+79991112233';
  const event = {
    request: {
      url: `/api/public/bookings/demo/requests?phone=${phone}&recoveryToken=${secret}`,
      data: { phone, name },
      query_string: secret,
      headers: { 'X-Booking-Recovery': secret },
    },
    extra: { name },
    breadcrumbs: [{ message: secret }],
    user: { name },
    contexts: { phone },
    spans: [{ description: name }],
    exception: { value: phone },
    message: name,
    transaction: secret,
  };
  const output = JSON.stringify(redactPublicBookingTelemetry(event));
  for (const value of [secret, name, phone]) assert.equal(output.includes(value), false);
  const ordinary = { request: { url: '/api/checks', data: { name } }, extra: { phone } };
  assert.deepEqual(redactPublicBookingTelemetry(structuredClone(ordinary)), ordinary);
  assert.equal(
    JSON.stringify(redactNfcTelemetry({ request: { url: '/api/shifts/nfc/scan', data: { token: secret } } })).includes(
      secret,
    ),
    false,
  );
  const filter = new HttpExceptionFilter(),
    logs = [];
  filter.logger = { error: (...args) => logs.push(args) };
  filter.report5xx(
    500,
    { method: 'POST', originalUrl: event.request.url + '?phone=' + phone },
    new Error(name + ' ' + secret),
    phone,
  );
  for (const value of [secret, name, phone]) assert.equal(JSON.stringify(logs).includes(value), false);
  const headers = [];
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/public/bookings/demo', headers: {} }),
      getResponse: () => ({ setHeader: (...args) => headers.push(args) }),
    }),
  };
  assert.deepEqual(
    await firstValueFrom(new ETagInterceptor().intercept(context, { handle: () => of({ example: 1 }) })),
    { example: 1 },
  );
  assert.deepEqual(headers, [], 'interceptor cannot overwrite no-store or return a cached price-bearing 304');
});

test('public POST budgets are IP+slug and IP-only, independent of bearer/header rotation', async () => {
  const original = global.setInterval;
  let guard;
  global.setInterval = () => ({});
  try {
    guard = new RateLimitGuard();
  } finally {
    global.setInterval = original;
  }
  const seen = [];
  guard.bump = async (key, max, now) => {
    seen.push({ key, max });
    return { overLimit: false, resetAt: now + 60000 };
  };
  const context = (slug, auth) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '203.0.113.7',
        socket: {},
        method: 'POST',
        path: `/api/public/bookings/${slug}/requests`,
        headers: { authorization: auth },
      }),
    }),
  });
  await guard.canActivate(context('demo', 'Bearer one'));
  await guard.canActivate(context('%64emo', 'Bearer two'));
  assert.deepEqual(seen.slice(0, 2), seen.slice(2));
  assert.deepEqual(
    seen.slice(0, 2).map((s) => s.max),
    [5, 20],
  );
  guard.bump = async (_key, max, now) => ({ overLimit: max === 5, resetAt: now + 60000 });
  await assert.rejects(guard.canActivate(context('demo', '')), failure(429));
});

test('shared public parser rejects queued/malformed/wrong-UUID responses and retains raw HTTP status; capability uses 32 secure bytes', async () => {
  const ts = require('typescript'),
    Module = require('node:module'),
    fs = require('node:fs'),
    path = require('node:path');
  const load = (relative) => {
    const filename = path.resolve(__dirname, '../../', relative),
      m = new Module(filename, module);
    m.filename = filename;
    m.paths = module.paths;
    m._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
      }).outputText,
      filename,
    );
    return m.exports;
  };
  const core = load('shared/utils/publicBooking.ts'),
    factory = load('shared/api/createServices.ts');
  const bytes = randomBytes(32),
    id = uuid(),
    identity = core.createPublicBookingIdentity({ randomUUID: () => id, randomBytes: () => new Uint8Array(bytes) });
  assert.equal(identity.recoveryToken, bytes.toString('base64url'));
  assert.ok(core.isPublicBookingIdentity(identity));
  assert.throws(() => core.createPublicBookingIdentity({ randomUUID: () => id, randomBytes: () => new Uint8Array(8) }));
  const result = {
    requestId: id,
    status: 'pending',
    startsAt: at(),
    endsAt: at('11:30'),
    services: [{ serviceId: uuid(), name: 'Test', durationMinutes: 90 }],
  };
  assert.deepEqual(core.readPublicBookingReceipt({ status: 201, data: result }, id), result);
  for (const response of [
    { status: 202, data: result },
    { status: 200, data: { ...result, queued: true } },
    { status: 201, data: { ...result, phone: 'private' } },
    { status: 201, data: { ...result, requestId: uuid() } },
    { status: 201, data: { ...result, services: [{ ...result.services[0], price: 100 }] } },
  ])
    assert.equal(core.readPublicBookingReceipt(response, id), null);
  assert.deepEqual(core.readPublicBookingRecovery({ status: 200, data: { status: 'unknown' } }, id), {
    status: 'unknown',
  });
  assert.deepEqual(core.readPublicBookingRecovery({ status: 200, data: { status: 'completed', result } }, id), {
    status: 'completed',
    result,
  });
  assert.equal(core.readPublicBookingRecovery({ status: 202, data: { status: 'completed', result } }, id), null);
  const sent = [],
    transport = {
      post: async (...args) => {
        sent.push(args);
        return { status: 202, data: { queued: true } };
      },
      get: async (...args) => {
        sent.push(args);
        return { status: 200, data: { status: 'unknown' } };
      },
    };
  const api = factory.createPublicBookingsApi(transport);
  assert.equal((await api.submit('shop', request())).status, 202);
  await api.recover('shop', id, identity.recoveryToken);
  assert.equal(sent[1][0].includes(identity.recoveryToken), false);
  assert.deepEqual(sent[1][1], { headers: { 'x-booking-recovery': identity.recoveryToken } });
});

const live = process.env.PUBLIC_BOOKING_LIVE_DB;
test(
  'PostgreSQL16 public booking: real RLS, calendars, transactions and concurrent reservations',
  { skip: !live },
  async (t) => {
    const url = new URL(live);
    assert.ok(
      ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55438' && url.pathname === '/autexa_oct8_test',
      'Disposable fixture only',
    );
    const admin = new Pool({ connectionString: live, max: 20, statement_timeout: 10000 });
    const appUrl = new URL(live);
    appUrl.username = 'autexa_app';
    appUrl.password = process.env.PUBLIC_BOOKING_LIVE_APP_PASSWORD || 'oct8_app_fixture_only';
    const app = new Pool({ connectionString: appUrl.toString(), max: 20, statement_timeout: 10000 });
    const native = new TenantAwarePool(admin, app),
      gates = new AsyncLocalStorage();
    const execute = async (client, sql, params) => {
      await gates.getStore()?.(sql, params);
      return client.query(sql, params);
    };
    const pool = {
      query: (sql, params) => execute(native, sql, params),
      connect: async () => {
        const c = await native.connect();
        return { query: (sql, params) => execute(c, sql, params), release: () => c.release() };
      },
    };
    const q = async (sql, args = []) => (await admin.query(sql, args)).rows,
      one = async (sql, args = []) => (await q(sql, args))[0];
    const tenants = [],
      sms = [],
      pushes = [],
      effects = [];
    const marketing = {
      sendClientMessage: async (tenant, phone, message, options) => {
        const count = await one('SELECT count(*)::int n FROM booking_operation_keys WHERE tenant_id=$1', [tenant]);
        sms.push({ tenant, phone, message, options, committed: count.n });
        return { sent: true };
      },
    };
    const push = {
      sendDataToTenant: async () => {},
      sendToUserInTenant: async (user, tenant, _kind, _title, _body, data) => {
        const count = await one('SELECT count(*)::int n FROM booking_operation_keys WHERE tenant_id=$1', [tenant]);
        pushes.push({ user, tenant, data, committed: count.n });
      },
      sendToUserCategory: async () => {},
    };
    const service = new PublicBookingsService(pool, marketing, push),
      bookings = new BookingsService(pool, marketing, push),
      schedule = new ScheduleService(pool);
    const after = service.afterCommit.bind(service);
    service.afterCommit = (row) => {
      const p = after(row);
      effects.push(p);
      return p;
    };
    const drain = () => Promise.all(effects);
    const run = (f, fn) => runWithTenant(f.tenant, fn);
    let phoneSuffix = 1000000000;
    const seed = async ({
      point = true,
      mode = 'instant',
      resources = 'owner',
      timezone = 'Europe/Moscow',
      publish = true,
    } = {}) => {
      const f = Object.fromEntries(
        ['tenant', 'point', 'otherPoint', 'owner', 'worker', 'otherWorker', 'role', 'service', 'client'].map((k) => [
          k,
          uuid(),
        ]),
      );
      tenants.push(f.tenant);
      f.slug = 'fixture-' + uuid();
      f.phone = '+7' + ++phoneSuffix;
      await q(
        "INSERT INTO tenants(id,name,timezone,points_shared_clients) VALUES($1,'Public booking fixture',$2,false)",
        [f.tenant, timezone],
      );
      if (point)
        await q(
          "INSERT INTO tenant_points(id,tenant_id,name,is_main) VALUES($1,$3,'Main',true),($2,$3,'Other',false)",
          [f.point, f.otherPoint, f.tenant],
        );
      else {
        f.point = null;
        f.otherPoint = null;
      }
      await q(
        `INSERT INTO roles(id,tenant_id,name,matrix) VALUES($1,$2,'Booking staff','{"bookings":{"view":true},"schedule":{"view":true,"manage":true}}')`,
        [f.role, f.tenant],
      );
      for (const [id, role] of [
        [f.owner, 'director'],
        [f.worker, 'master'],
        [f.otherWorker, 'master'],
      ])
        await q(
          "INSERT INTO users(id,tenant_id,phone,password,full_name,role,role_id) VALUES($1,$2,$5,'fixture-only','Booking resource',$3,$4)",
          [id, f.tenant, role, role === 'master' ? f.role : null, id],
        );
      if (point)
        await q('INSERT INTO user_points(user_id,tenant_id,point_id) VALUES($1,$3,$4),($2,$3,$4)', [
          f.worker,
          f.otherWorker,
          f.tenant,
          f.point,
        ]);
      await q("INSERT INTO services(id,tenant_id,name,default_price) VALUES($1,$2,'Service snapshot',1234.56)", [
        f.service,
        f.tenant,
      ]);
      await q(
        "INSERT INTO clients(id,tenant_id,point_id,full_name,phone,owner_notes) VALUES($1,$2,$3,'Saved card name',$4,'Do not overwrite')",
        [f.client, f.tenant, f.point, f.phone],
      );
      await q('INSERT INTO booking_settings(tenant_id,notify_client_on_create) VALUES($1,true)', [f.tenant]);
      f.boss = { userID: f.owner, tenantID: f.tenant, role: 'director', currentPointId: f.point };
      f.actor = { ...f.boss, userID: f.worker, role: 'master' };
      f.settings = {
        requestId: uuid(),
        revision: 0,
        slug: f.slug,
        displayName: 'Автосервис',
        address: 'Адрес',
        contacts: '+7 999 1112233',
        showPrices: false,
        mode,
        operator: { name: 'Оператор', requisites: 'Реквизиты', contact: 'Контакт оператора' },
        policyText: 'Политика обработки данных',
        consentText: 'Отдельное согласие',
        services: [{ serviceId: f.service }],
        resourceIds: [f[resources]],
      };
      f.page = await run(f, () => service.putSettings(f.boss, f.settings));
      if (publish) f.page = await run(f, () => service.publish(f.boss, { requestId: uuid() }, true));
      f.edit = async (patch) => {
        const current = await run(f, () => service.getSettings(f.boss));
        f.settings = { ...f.settings, requestId: uuid(), revision: current.revision, ...patch };
        f.page = await run(f, () => service.putSettings(f.boss, f.settings));
        return f.page;
      };
      f.body = (patch = {}) => ({
        requestId: uuid(),
        recoveryToken: token(),
        serviceIds: [f.service],
        startsAt: at(),
        name: 'Anonymous claim',
        phone: f.phone,
        consentVersion: f.page.consentVersion,
        consentAccepted: true,
        ...patch,
      });
      f.submit = (body) => service.submit(f.slug, body);
      f.recover = (body) => service.status(f.slug, body.requestId, body.recoveryToken);
      f.list = () => run(f, () => service.requests(f.boss));
      f.booking = () => one('SELECT * FROM bookings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [f.tenant]);
      f.internal = (patch = {}, actor = f.boss) =>
        run(f, () =>
          bookings.create(actor, {
            requestId: uuid(),
            clientId: f.client,
            masterId: f[resources],
            scheduledAt: at(),
            notifyOnCreate: false,
            ...patch,
          }),
        );
      return f;
    };
    const waitUntil = async (predicate) => {
      for (let i = 0; i < 250; i++) {
        if (await predicate()) return;
        await delay(5);
      }
      throw Error('Database lock barrier not reached');
    };
    const waiting = async (pattern) =>
      waitUntil(
        async () =>
          (
            await one(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname='autexa_oct8_test' AND wait_event_type='Lock' AND query LIKE $1",
              [pattern],
            )
          ).n > 0,
      );
    const counts = (f) =>
      one(
        'SELECT (SELECT count(*)::int FROM bookings WHERE tenant_id=$1) bookings,(SELECT count(*)::int FROM public_booking_requests WHERE tenant_id=$1) requests,(SELECT count(*)::int FROM clients WHERE tenant_id=$1) clients',
        [f.tenant],
      );
    // A focused follow-up may select one changed SQL scenario; CI runs all by default.
    const selectedCase = process.env.PUBLIC_BOOKING_CASE;
    const scenario = (name, fn) =>
      selectedCase && !name.includes(selectedCase) ? Promise.resolve() : t.test(name, fn);
    try {
      await scenario(
        'working owner is a real resource; consent proof, RLS isolation, hash-only capability and safe projections',
        async () => {
          const f = await seed(),
            other = await seed(),
            body = f.body();
          const resources = await run(f, () => service.resources(f.boss));
          assert.ok(resources.some((r) => r.id === f.owner));
          const landing = await service.landing(f.slug);
          assert.equal(landing.timezone, 'Europe/Moscow');
          assert.ok(Math.abs(Date.parse(landing.serverAt) - Date.now()) < 5000);
          assert.equal(landing.showPrices, false);
          assert.equal(JSON.stringify(landing).includes('1234.56'), false);
          assert.equal('price' in landing.services[0], false);
          assert.equal(JSON.stringify(landing).includes(f.owner), false);
          const slots = await service.slots(f.slug, { from: '2060-01-12', to: '2060-01-12', serviceIds: f.service });
          assert.ok(slots.slots.some((s) => s.startsAt === at()));
          const result = await f.submit(body);
          assert.equal(result.status, 'confirmed');
          assert.equal((await f.booking()).master_id, f.owner);
          const row = await one('SELECT * FROM public_booking_requests WHERE tenant_id=$1', [f.tenant]);
          assert.equal(row.capability_hash.length, 64);
          assert.equal(JSON.stringify(row).includes(body.recoveryToken), false);
          assert.equal(row.consent_proof.version, f.page.consentVersion);
          assert.equal(row.consent_proof.policyText, f.settings.policyText);
          assert.ok(row.consent_proof.acceptedAt);
          for (const privateValue of [f.client, f.owner, body.name, body.phone, '1234.56'])
            assert.equal(JSON.stringify(result).includes(privateValue), false);
          assert.deepEqual((await f.recover(body)).result, result);
          assert.deepEqual(await service.status(f.slug, body.requestId, token()), { status: 'unknown' });
          assert.deepEqual(await service.status(other.slug, body.requestId, body.recoveryToken), { status: 'unknown' });
          assert.equal(
            (
              await runWithTenant(other.tenant, () =>
                native.query('SELECT * FROM public_booking_requests WHERE id=$1', [row.id]),
              )
            ).rows.length,
            0,
          );
          await assert.rejects(
            runWithTenant(other.tenant, () =>
              native.query("INSERT INTO public_booking_pages(tenant_id,slug,settings) VALUES($1,$2,'{}')", [
                f.tenant,
                'cross-' + uuid(),
              ]),
            ),
            (e) => e.code === '42501',
          );
          assert.deepEqual(await one("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='autexa_app'"), {
            rolsuper: false,
            rolbypassrls: false,
          });
          assert.equal((await app.query('SELECT * FROM public_booking_requests')).rows.length, 0);
          const rls = await q(
            'SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',
            [
              [
                'public_booking_pages',
                'public_booking_services',
                'public_booking_resources',
                'public_booking_requests',
                'booking_operation_keys',
              ],
            ],
          );
          assert.equal(rls.length, 5);
          assert.ok(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity));
        },
      );
      await scenario(
        'same UUID parallel/retry replays one booking/client/notification; changed body/capability/operation conflicts',
        async () => {
          const f = await seed(),
            body = f.body({ phone: '+7' + ++phoneSuffix }),
            results = await Promise.all([f.submit(body), f.submit({ ...body }), f.submit({ ...body })]);
          assert.deepEqual(results[0], results[1]);
          assert.deepEqual(results[1], results[2]);
          assert.deepEqual(await counts(f), { bookings: 1, requests: 1, clients: 2 });
          for (const patch of [
            { name: 'changed' },
            { startsAt: at('12:00') },
            { recoveryToken: token() },
            { serviceIds: [uuid()] },
          ])
            await assert.rejects(f.submit({ ...body, ...patch }), failure(409, 'IDEMPOTENCY_CONFLICT'));
          await assert.rejects(
            f.internal({ requestId: body.requestId, scheduledAt: at('13:00') }),
            failure(409, 'IDEMPOTENCY_CONFLICT'),
          );
          await drain();
          assert.equal(sms.filter((s) => s.tenant === f.tenant).length, 1);
          assert.equal(pushes.filter((p) => p.tenant === f.tenant).length, 1);
          assert.ok(sms.filter((s) => s.tenant === f.tenant).every((s) => s.committed > 0));
          assert.ok(pushes.filter((p) => p.tenant === f.tenant).every((s) => s.committed > 0));
        },
      );
      await scenario(
        'real public/public and public/internal last-slot races serialize before read/check/insert',
        async () => {
          for (const internal of [false, true]) {
            const f = await seed(),
              block = await admin.connect();
            await block.query('BEGIN');
            await block.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.owner]);
            const first = f.submit(f.body());
            await waiting('SELECT id FROM users%');
            const second = internal ? f.internal() : f.submit(f.body());
            await waiting('%pg_advisory_xact_lock%');
            await block.query('COMMIT');
            block.release();
            const results = await Promise.allSettled([first, second]);
            assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
            assert.ok(failure(409, 'SLOT_UNAVAILABLE')(results.find((r) => r.status === 'rejected').reason));
            assert.equal((await counts(f)).bookings, 1);
          }
        },
      );
      await scenario(
        'internal winner prevents delayed public reservation; transfer races and cross-point occupancy use the same employee',
        async () => {
          const f = await seed({ resources: 'worker' });
          await f.edit({ resourceIds: [f.worker, f.otherWorker] });
          const existing = await f.internal({ scheduledAt: at('12:00'), masterId: f.otherWorker });
          // Pause the actual internal INSERT while its real tenant/resource locks are held.
          const reached = defer(),
            release = defer();
          const first = gates.run(
            async (sql) => {
              if (sql.startsWith('INSERT INTO bookings')) {
                reached.resolve();
                await release.promise;
              }
            },
            () => f.internal(),
          );
          await reached.promise;
          const transfer = run(f, () =>
            bookings.update(f.boss, existing.id, { requestId: uuid(), masterId: f.worker, scheduledAt: at() }),
          );
          await waiting('%pg_advisory_xact_lock%');
          release.resolve();
          await first;
          await assert.rejects(transfer, failure(409, 'SLOT_UNAVAILABLE'));
          await f.edit({ resourceIds: [f.worker] });
          await assert.rejects(f.submit(f.body()), failure(409, 'SLOT_UNAVAILABLE'));
          // Explicit two-point membership makes the SAME employee eligible in both.
          await q('INSERT INTO user_points(user_id,tenant_id,point_id) VALUES($1,$2,$3)', [
            f.worker,
            f.tenant,
            f.otherPoint,
          ]);
          await q('UPDATE tenants SET points_shared_clients=true WHERE id=$1', [f.tenant]);
          const otherActor = { ...f.boss, currentPointId: f.otherPoint };
          await assert.rejects(f.internal({}, otherActor), failure(409, 'SLOT_UNAVAILABLE'));
          const rows = await q('SELECT id,point_id FROM bookings WHERE tenant_id=$1', [f.tenant]);
          for (const row of rows) assert.equal(row.point_id, f.point);
        },
      );
      await scenario(
        'unconfigured legacy resource retains soft warning; configured intervals use duration and exact end boundary',
        async () => {
          const f = await seed({ resources: 'worker' });
          await f.edit({ resourceIds: [f.owner] });
          const a = await f.internal(),
            b = await f.internal({ scheduledAt: at('10:15') });
          assert.equal(a.conflictWarning, null);
          assert.ok(b.conflictWarning);
          assert.equal((await counts(f)).bookings, 2);
          await f.edit({ resourceIds: [f.worker] });
          await assert.rejects(f.internal({ scheduledAt: at('11:44') }), failure(409, 'SLOT_UNAVAILABLE'));
          const boundary = await f.internal({ scheduledAt: at('11:45'), durationMinutes: 30 });
          assert.equal(boundary.conflictWarning, null);
          await assert.rejects(
            f.internal({ scheduledAt: at('12:14'), durationMinutes: 5 }),
            failure(409, 'SLOT_UNAVAILABLE'),
          );
          await f.internal({ scheduledAt: at('12:15'), durationMinutes: 5 });
        },
      );
      await scenario(
        'approval stays pending without occupancy/SMS, rechecks occupied slot; rejection never reserves; cancel frees it',
        async () => {
          const f = await seed({ mode: 'approval' }),
            body = f.body();
          const pending = await f.submit(body);
          assert.equal(pending.status, 'pending');
          assert.equal((await counts(f)).bookings, 0);
          await drain();
          assert.equal(sms.filter((s) => s.tenant === f.tenant).length, 0);
          const r = (await f.list())[0],
            existing = await f.internal();
          await assert.rejects(
            run(f, () => service.decide(f.boss, r.id, { requestId: uuid() }, true)),
            failure(409, 'SLOT_UNAVAILABLE'),
          );
          assert.equal((await f.recover(body)).result.status, 'pending');
          await run(f, () => bookings.cancel(f.boss, existing.id, uuid()));
          const key = uuid(),
            approved = await run(f, () => service.decide(f.boss, r.id, { requestId: key }, true));
          assert.equal(approved.status, 'confirmed');
          assert.deepEqual(
            wire(await run(f, () => service.decide(f.boss, r.id, { requestId: key }, true))),
            wire(approved),
          );
          await drain();
          assert.equal(sms.filter((s) => s.tenant === f.tenant).length, 1);
          const next = f.body({ startsAt: at('13:00') });
          await f.submit(next);
          const r2 = (await f.list()).find((r) => r.requestId === next.requestId);
          await run(f, () => service.decide(f.boss, r2.id, { requestId: uuid() }, false));
          assert.equal((await f.recover(next)).result.status, 'rejected');
          assert.equal((await counts(f)).bookings, 2);
          await run(f, () => bookings.cancel(f.boss, approved.bookingId, uuid()));
          assert.equal((await f.recover(body)).result.status, 'cancelled');
        },
      );
      await scenario(
        'withdrawn publication, changed consent/services and disabled tenant/point reject new mutations but retain exact recovery',
        async () => {
          const f = await seed(),
            body = f.body(),
            original = await f.submit(body);
          await drain();
          const before = await counts(f),
            notices = pushes.filter((p) => p.tenant === f.tenant).length;
          await f.edit({ showPrices: true });
          assert.equal((await service.landing(f.slug)).services[0].price, 1234.56);
          await f.edit({ showPrices: false, policyText: 'New policy' });
          await assert.rejects(
            f.submit(f.body({ startsAt: at('12:00'), consentVersion: body.consentVersion })),
            failure(409, 'CONSENT_CHANGED'),
          );
          await f.edit({ services: [{ serviceId: f.service, durationMinutes: 45 }] });
          await run(f, () => service.publish(f.boss, { requestId: uuid() }, false));
          await assert.rejects(f.submit(f.body({ startsAt: at('13:00') })), failure(404, 'BOOKING_DISABLED'));
          assert.deepEqual(await f.submit(body), original);
          assert.deepEqual((await f.recover(body)).result, original);
          await run(f, () => service.publish(f.boss, { requestId: uuid() }, true));
          for (const sql of [
            'UPDATE tenants SET is_active=false WHERE id=$1',
            "UPDATE tenants SET is_active=true,subscription_end='2000-01-01' WHERE id=$1",
          ]) {
            await q(sql, [f.tenant]);
            await assert.rejects(f.submit(f.body({ startsAt: at('13:00') })), failure(404, 'BOOKING_DISABLED'));
            assert.deepEqual(await f.submit(body), original);
            assert.deepEqual((await f.recover(body)).result, original);
          }
          await q('UPDATE tenants SET subscription_end=NULL WHERE id=$1', [f.tenant]);
          await q('UPDATE tenant_points SET is_active=false WHERE id=$1', [f.point]);
          await assert.rejects(f.submit(f.body({ startsAt: at('13:00') })), failure(404, 'BOOKING_DISABLED'));
          assert.deepEqual(await f.submit(body), original);
          assert.deepEqual(await counts(f), before);
          await drain();
          assert.equal(pushes.filter((p) => p.tenant === f.tenant).length, notices);
          for (const value of [body.phone, body.name, '1234.56'])
            assert.equal(JSON.stringify(await f.recover(body)).includes(value), false);
        },
      );
      await scenario(
        'fresh role/point/resource boundaries; pending approval fails after consent change or employee removal',
        async () => {
          const f = await seed({ resources: 'worker', mode: 'approval' }),
            other = await seed();
          await assert.rejects(
            run(f, () =>
              service.putSettings(
                { ...f.actor, role: 'director', permissions: { company_manage: true } },
                { ...f.settings, requestId: uuid(), revision: f.page.revision },
              ),
            ),
            failure(403),
          );
          await q("UPDATE users SET role='admin' WHERE id=$1", [f.worker]);
          await assert.rejects(
            run(f, () => service.publish({ ...f.actor, role: 'admin' }, { requestId: uuid() }, false)),
            failure(403),
          );
          await assert.rejects(f.edit({ resourceIds: [other.owner] }), failure(400));
          await assert.rejects(f.edit({ services: [{ serviceId: other.service }] }), failure(400));
          // Restore valid draft after intentionally rejected edits.
          f.settings = { ...f.settings, resourceIds: [f.worker], services: [{ serviceId: f.service }] };
          const body = f.body();
          await f.submit(body);
          const row = (await f.list())[0];
          await assert.rejects(
            run(f, () =>
              service.decide({ ...f.boss, currentPointId: f.otherPoint }, row.id, { requestId: uuid() }, true),
            ),
            failure(404),
          );
          await assert.rejects(
            run(other, () => service.decide(other.boss, row.id, { requestId: uuid() }, true)),
            failure(404),
          );
          await q("UPDATE roles SET matrix='{}' WHERE id=$1", [f.role]);
          await assert.rejects(
            run(f, () => service.requests(f.actor)),
            failure(403),
          );
          await f.edit({ consentText: 'Changed consent' });
          await assert.rejects(
            run(f, () => service.decide(f.boss, row.id, { requestId: uuid() }, true)),
            failure(409, 'CONSENT_CHANGED'),
          );
          const newBody = f.body();
          await f.submit(newBody);
          const fresh = (await f.list()).find((r) => r.requestId === newBody.requestId);
          await q('UPDATE users SET is_active=false WHERE id=$1', [f.worker]);
          await assert.rejects(
            run(f, () => service.decide(f.boss, fresh.id, { requestId: uuid() }, true)),
            failure(409, 'SLOT_UNAVAILABLE'),
          );
          assert.equal((await counts(f)).bookings, 0);
        },
      );
      await scenario(
        'anonymous contact reuse never overwrites a card; foreign-point collision stays null until explicitly linked and checked',
        async () => {
          const f = await seed(),
            body = f.body({ name: 'Spoofed saved name' });
          await f.submit(body);
          assert.deepEqual(await one('SELECT full_name,owner_notes FROM clients WHERE id=$1', [f.client]), {
            full_name: 'Saved card name',
            owner_notes: 'Do not overwrite',
          });
          const f2 = await seed();
          await q('UPDATE clients SET point_id=$1 WHERE id=$2', [f2.otherPoint, f2.client]);
          const b = f2.body();
          await f2.submit(b);
          const booking = await f2.booking();
          assert.equal(booking.client_id, null);
          assert.equal((await counts(f2)).clients, 1);
          const staff = (await f2.list())[0];
          assert.equal(staff.clientId, null);
          assert.equal(staff.name, b.name);
          assert.equal(staff.needsClientLink, true);
          assert.equal(JSON.stringify(staff).includes('Saved card name'), false);
          const checkId = uuid();
          await assert.rejects(
            run(f2, () => bookings.convert(f2.boss, booking.id, checkId, uuid())),
            failure(409, 'BOOKING_CLIENT_LINK_REQUIRED'),
          );
          await assert.rejects(
            run(f2, () => bookings.linkClient(f2.boss, booking.id, { requestId: uuid(), clientId: f2.client })),
            failure(404),
          );
          await assert.rejects(
            run(f2, () => bookings.linkClient(f2.boss, booking.id, { requestId: uuid(), clientId: f.client })),
            failure(404),
          );
          const allowed = uuid();
          await q(
            "INSERT INTO clients(id,tenant_id,point_id,full_name,phone) VALUES($1,$2,$3,'Explicit linked card',$4)",
            [allowed, f2.tenant, f2.point, '+7' + ++phoneSuffix],
          );
          const linked = await run(f2, () =>
            bookings.linkClient(f2.boss, booking.id, { requestId: uuid(), clientId: allowed }),
          );
          assert.equal(linked.clientId, allowed);
          assert.equal(linked.needsClientLink, false);
          await q('INSERT INTO checks(id,tenant_id,point_id,client_id,master_id) VALUES($1,$2,$3,$4,$5)', [
            checkId,
            f2.tenant,
            f2.otherPoint,
            allowed,
            f2.owner,
          ]);
          await assert.rejects(
            run(f2, () => bookings.convert(f2.boss, booking.id, checkId, uuid())),
            failure(400),
          );
          await q('UPDATE checks SET point_id=$1 WHERE id=$2', [f2.point, checkId]);
          const converted = await run(f2, () => bookings.convert(f2.boss, booking.id, checkId, uuid()));
          assert.equal(converted.status, 'converted');
          await assert.rejects(f2.internal({ clientId: f2.client, scheduledAt: at('14:00') }), failure(404));
        },
      );
      await scenario(
        'calendar uses tenant timezone, date shifts/day-off/sickness/weekly default and overnight windows; bounded paginated slots',
        async () => {
          const f = await seed({ resources: 'worker', timezone: 'Asia/Vladivostok' }),
            date = '2060-01-12',
            day = new Date(date + 'T00:00Z').getUTCDay();
          await q('UPDATE users SET days_off=$1::jsonb WHERE id=$2', [JSON.stringify([day]), f.worker]);
          assert.equal((await service.slots(f.slug, { from: date, to: date, serviceIds: f.service })).slots.length, 0);
          await run(f, () =>
            schedule.create(f.tenant, { userId: f.worker, date, shiftStart: '12:00', shiftEnd: '15:00' }, f.boss),
          );
          let slots = await service.slots(f.slug, { from: date, to: date, serviceIds: f.service });
          assert.equal(slots.timezone, 'Asia/Vladivostok');
          assert.equal(slots.slots[0].startsAt, at('12:00', date, '+10:00'));
          assert.equal(slots.slots.at(-1).startsAt, at('13:30', date, '+10:00'));
          await q('UPDATE schedule_entries SET is_day_off=true WHERE tenant_id=$1', [f.tenant]);
          assert.equal((await service.slots(f.slug, { from: date, to: date, serviceIds: f.service })).slots.length, 0);
          await q("UPDATE schedule_entries SET is_day_off=false,note='Больничный' WHERE tenant_id=$1", [f.tenant]);
          assert.equal((await service.slots(f.slug, { from: date, to: date, serviceIds: f.service })).slots.length, 0);
          await q("UPDATE schedule_entries SET note=NULL,shift_start='22:00',shift_end='03:00' WHERE tenant_id=$1", [
            f.tenant,
          ]);
          await f.edit({ openingHours: { [day]: { start: '21:00', end: '04:00' } } });
          slots = await service.slots(f.slug, { from: date, to: '2060-01-13', serviceIds: f.service });
          assert.equal(slots.slots[0].startsAt, at('22:00', date, '+10:00'));
          assert.ok(slots.slots.some((s) => s.startsAt === at('00:00', '2060-01-13', '+10:00')));
          await f.submit(f.body({ startsAt: at('00:00', '2060-01-13', '+10:00') }));
          await assert.rejects(
            f.submit(f.body({ startsAt: at('00:15', '2060-01-13', '+10:00') })),
            failure(409, 'SLOT_UNAVAILABLE'),
          );
          await assert.rejects(
            service.slots(f.slug, { from: date, to: '2060-02-12', serviceIds: f.service }),
            failure(400),
          );
          await assert.rejects(
            service.slots(f.slug, { from: '2060-02-30', to: '2060-03-01', serviceIds: f.service }),
            failure(400),
          );
          await f.edit({
            slotStepMinutes: 5,
            services: [{ serviceId: f.service, durationMinutes: 5 }],
            openingHours: Object.fromEntries(
              Array.from({ length: 7 }, (_, i) => [i, { start: '00:00', end: '23:59' }]),
            ),
          });
          await q('DELETE FROM schedule_entries WHERE tenant_id=$1', [f.tenant]);
          await q("UPDATE users SET days_off='[]' WHERE id=$1", [f.worker]);
          slots = await service.slots(f.slug, { from: date, to: '2060-02-11', serviceIds: f.service });
          assert.equal(slots.slots.length, 1000);
          assert.ok(slots.nextAfter);
          const next = await service.slots(f.slug, {
            from: date,
            to: '2060-02-11',
            serviceIds: f.service,
            after: slots.nextAfter,
          });
          assert.ok(next.slots.every((s) => s.startsAt > slots.nextAfter));
          assert.equal(
            (await service.slots(f.slug, { from: '2000-01-01', to: '2000-01-01', serviceIds: f.service })).slots.length,
            0,
          );
        },
      );
      await scenario(
        'employee row barrier rereads a concurrent calendar change before booking; rollback produces no side effects',
        async () => {
          const f = await seed({ resources: 'worker' }),
            block = await admin.connect();
          await block.query('BEGIN');
          await block.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.worker]);
          const submit = f.submit(f.body());
          await waiting('SELECT id FROM users%');
          await block.query(
            "INSERT INTO schedule_entries(tenant_id,point_id,user_id,date,is_day_off) VALUES($1,$2,$3,'2060-01-12',true)",
            [f.tenant, f.point, f.worker],
          );
          await block.query('COMMIT');
          block.release();
          await assert.rejects(submit, failure(409, 'SLOT_UNAVAILABLE'));
          assert.deepEqual(await counts(f), { bookings: 0, requests: 0, clients: 1 });
          await drain();
          assert.equal(pushes.filter((p) => p.tenant === f.tenant).length, 0);
        },
      );
      await scenario(
        'membership removal and reservations serialize in both directions using the real point mutation path',
        async () => {
          const points = new PointsService(pool);
          for (const membershipFirst of [false, true]) {
            const f = await seed({ resources: 'worker' });
            await q('INSERT INTO user_points(user_id,tenant_id,point_id) VALUES($1,$2,$3)', [
              f.worker,
              f.tenant,
              f.otherPoint,
            ]);
            const reached = defer(),
              release = defer();
            const pauseSql = membershipFirst ? 'DELETE FROM user_points' : 'INSERT INTO bookings';
            const move = () => run(f, () => points.setUserPoints(f.tenant, f.worker, [f.otherPoint]));
            const first = gates.run(
              async (sql) => {
                if (sql.startsWith(pauseSql)) {
                  reached.resolve();
                  await release.promise;
                }
              },
              membershipFirst ? move : () => f.submit(f.body()),
            );
            await reached.promise;
            const second = membershipFirst ? f.submit(f.body()) : move();
            await waiting('%pg_advisory_xact_lock%');
            release.resolve();
            const outcomes = await Promise.allSettled([first, second]);
            assert.equal(outcomes[0].status, 'fulfilled');
            if (membershipFirst) {
              assert.equal(outcomes[1].status, 'rejected');
              assert.ok(failure(409, 'SLOT_UNAVAILABLE')(outcomes[1].reason));
              assert.equal((await counts(f)).bookings, 0);
            } else {
              assert.equal(outcomes[1].status, 'fulfilled');
              assert.equal((await counts(f)).bookings, 1);
            }
            await assert.rejects(f.submit(f.body({ startsAt: at('14:00') })), failure(409, 'SLOT_UNAVAILABLE'));
          }
        },
      );
      await scenario(
        'staff operations bind UUID to actor, point and operation; public contact link retains existing check guards',
        async () => {
          const f = await seed({ resources: 'worker' }),
            body = f.body();
          await f.submit(body);
          const row = await f.booking();
          const otherPoint = { ...f.boss, currentPointId: f.otherPoint };
          await assert.rejects(
            run(f, () => bookings.update(otherPoint, row.id, { comment: 'cross point' })),
            failure(404),
          );
          await assert.rejects(
            run(f, () => bookings.cancel(otherPoint, row.id)),
            failure(404),
          );
          await assert.rejects(
            run(f, () => bookings.convert(otherPoint, row.id, uuid())),
            failure(404),
          );
          const key = uuid(),
            updated = await run(f, () => bookings.update(f.boss, row.id, { requestId: key, comment: 'saved' }));
          assert.deepEqual(
            wire(await run(f, () => bookings.update(f.boss, row.id, { requestId: key, comment: 'saved' }))),
            wire(updated),
          );
          await assert.rejects(
            run(f, () => bookings.update(f.actor, row.id, { requestId: key, comment: 'saved' })),
            failure(409, 'IDEMPOTENCY_CONFLICT'),
          );
          await assert.rejects(
            run(f, () => bookings.cancel(f.boss, row.id, key)),
            failure(409, 'IDEMPOTENCY_CONFLICT'),
          );
          await assert.rejects(
            run(f, () => bookings.update(f.boss, row.id, { requestId: key, scheduledAt: at('14:00') })),
            failure(409, 'IDEMPOTENCY_CONFLICT'),
          );
          await assert.rejects(
            run(f, () => bookings.update({ ...f.actor, userID: f.otherWorker }, row.id, { comment: 'other worker' })),
            failure(403),
          );
        },
      );
      await scenario(
        'draft publication requirements, immutable slug, tenant-safe slug collision and settings replay/revision',
        async () => {
          const f = await seed({ publish: false }),
            other = await seed();
          await f.edit({ operator: { name: '', requisites: '', contact: '' } });
          await assert.rejects(
            run(f, () => service.publish(f.boss, { requestId: uuid() }, true)),
            failure(400, 'PUBLICATION_INCOMPLETE'),
          );
          const dto = {
            ...f.settings,
            requestId: uuid(),
            revision: f.page.revision,
            operator: { name: 'Operator', requisites: 'Requisites', contact: 'Contact' },
          };
          const saved = await run(f, () => service.putSettings(f.boss, dto));
          assert.deepEqual(wire(await run(f, () => service.putSettings(f.boss, dto))), wire(saved));
          await assert.rejects(
            run(f, () => service.putSettings(f.boss, { ...dto, requestId: uuid() })),
            failure(409, 'SETTINGS_CHANGED'),
          );
          await assert.rejects(
            run(f, () =>
              service.putSettings(f.boss, {
                ...dto,
                requestId: uuid(),
                revision: saved.revision,
                slug: 'changed-slug',
              }),
            ),
            failure(400),
          );
          await assert.rejects(
            run(other, () =>
              service.putSettings(
                { ...other.boss, currentPointId: other.otherPoint },
                { ...other.settings, requestId: uuid(), revision: 0, slug: f.slug },
              ),
            ),
            failure(409, 'SLUG_TAKEN'),
          );
          await run(f, () => service.publish(f.boss, { requestId: uuid() }, true));
        },
      );
      await scenario(
        'parallel approvals reserve once; approval refuses a disabled publication and a service no longer offered',
        async () => {
          const f = await seed({ mode: 'approval' }),
            body = f.body();
          await f.submit(body);
          const row = (await f.list())[0],
            key = uuid();
          const results = await Promise.all([
            run(f, () => service.decide(f.boss, row.id, { requestId: key }, true)),
            run(f, () => service.decide(f.boss, row.id, { requestId: key }, true)),
          ]);
          assert.deepEqual(results[0], results[1]);
          assert.equal((await counts(f)).bookings, 1);
          const next = f.body({ startsAt: at('13:00') });
          await f.submit(next);
          const pending = (await f.list()).find((r) => r.requestId === next.requestId);
          await run(f, () => service.publish(f.boss, { requestId: uuid() }, false));
          await assert.rejects(
            run(f, () => service.decide(f.boss, pending.id, { requestId: uuid() }, true)),
            failure(404, 'BOOKING_DISABLED'),
          );
          await run(f, () => service.publish(f.boss, { requestId: uuid() }, true));
          const anotherService = uuid();
          await q("INSERT INTO services(id,tenant_id,name,default_price) VALUES($1,$2,'Replacement',42)", [
            anotherService,
            f.tenant,
          ]);
          await f.edit({ services: [{ serviceId: anotherService }] });
          await assert.rejects(
            run(f, () => service.decide(f.boss, pending.id, { requestId: uuid() }, true)),
            failure(409, 'SERVICES_CHANGED'),
          );
          assert.equal((await counts(f)).bookings, 1);
        },
      );
      await scenario(
        'a clientless public booking reminds its own request contact only; pending requests have no reminder row',
        async () => {
          const f = await seed();
          await q('UPDATE clients SET point_id=$1 WHERE id=$2', [f.otherPoint, f.client]);
          await f.submit(f.body());
          await drain();
          await q("UPDATE bookings SET scheduled_at=now()+interval '1 hour' WHERE tenant_id=$1", [f.tenant]);
          await q('UPDATE booking_settings SET reminder_enabled=true,reminder_hours=2 WHERE tenant_id=$1', [f.tenant]);
          await q(
            "INSERT INTO messaging_integrations(tenant_id,provider_type,api_key,is_active) VALUES($1,'smsru','fixture-not-used',true)",
            [f.tenant],
          );
          const reminder = new BookingReminderService(native, marketing, push);
          await reminder.run();
          await reminder.run();
          const reminders = sms.filter(
            (s) => s.tenant === f.tenant && s.options.dedupKey.startsWith('booking_reminder:'),
          );
          assert.equal(reminders.length, 1);
          assert.equal(reminders[0].phone, f.phone);
          assert.equal(reminders[0].options.clientId, null);
        },
      );
      await scenario(
        'selected service deletion cannot cross a reservation; withdrawal before selection rejects without a booking',
        async () => {
          for (const deletionFirst of [false, true]) {
            const f = await seed(),
              blocker = await admin.connect();
            await blocker.query('BEGIN');
            if (deletionFirst) await blocker.query('DELETE FROM services WHERE id=$1', [f.service]);
            else await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.owner]);
            const submit = f.submit(f.body());
            if (deletionFirst) {
              await waiting('%FROM public_booking_services ps%');
              await blocker.query('COMMIT');
              blocker.release();
              await assert.rejects(submit, failure(409, 'SERVICES_CHANGED'));
              assert.equal((await counts(f)).bookings, 0);
            } else {
              await waiting('SELECT id FROM users%');
              const remove = q('DELETE FROM services WHERE id=$1', [f.service]);
              await waiting('DELETE FROM services%');
              await blocker.query('COMMIT');
              blocker.release();
              const result = await submit;
              await remove;
              assert.equal(result.status, 'confirmed');
              assert.equal((await counts(f)).bookings, 1);
            }
          }
        },
      );
      await scenario(
        'first-point attribution remains idempotent and public tenant purge/remove deletes ledger in order, neighbor intact',
        async () => {
          const neighbor = await seed(),
            nb = neighbor.body();
          await neighbor.submit(nb);
          const f = await seed({ point: false }),
            body = f.body();
          await f.submit(body);
          await drain();
          const points = new PointsService(pool),
            point = await run(f, () => points.adminCreate(f.tenant, { name: 'Public booking fixture' }));
          for (const table of [
            'public_booking_pages',
            'public_booking_requests',
            'booking_operation_keys',
            'bookings',
          ]) {
            const rows = await q(`SELECT point_id FROM ${table} WHERE tenant_id=$1`, [f.tenant]);
            assert.ok(rows.length);
            assert.ok(rows.every((r) => r.point_id === point.id));
          }
          await run(f, () => points.adminCreate(f.tenant, { name: 'Second' }));
          assert.equal(
            (await run(f, () => service.requests({ ...f.boss, currentPointId: point.id })))[0].requestId,
            body.requestId,
          );
          assert.equal((await f.recover(body)).status, 'completed');
          const cleanup = new TenantsService(native, {}, {});
          await cleanup.purgeTenantData(f.tenant);
          const another = await seed();
          await cleanup.remove(another.tenant);
          for (const table of ['public_booking_pages', 'public_booking_requests', 'booking_operation_keys'])
            assert.equal((await one(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [f.tenant])).n, 0);
          assert.equal((await neighbor.recover(nb)).status, 'completed');
        },
      );
      await scenario(
        'review repair: public transfer to an unconfigured resource keeps strict overlap and end boundary',
        async () => {
          const f = await seed();
          await f.submit(f.body());
          const source = await f.booking();
          await f.internal({ masterId: f.worker });
          await assert.rejects(
            run(f, () => bookings.update(f.boss, source.id, { requestId: uuid(), masterId: f.worker })),
            failure(409, 'SLOT_UNAVAILABLE'),
          );
          assert.equal((await one('SELECT master_id FROM bookings WHERE id=$1', [source.id])).master_id, f.owner);
          const moved = await run(f, () =>
            bookings.update(f.boss, source.id, { requestId: uuid(), masterId: f.worker, scheduledAt: at('11:30') }),
          );
          assert.equal(moved.masterId, f.worker);
          assert.equal(moved.conflictWarning, null);
          // Ordinary, never configured resources retain the original warning contract.
          await f.internal({ masterId: f.otherWorker });
          const legacy = await f.internal({ masterId: f.otherWorker });
          assert.ok(legacy.conflictWarning);
        },
      );
      await scenario(
        'review repair: public transfer checks current point membership and employee eligibility',
        async () => {
          const f = await seed();
          await f.submit(f.body());
          const source = await f.booking();
          await q('UPDATE user_points SET point_id=$1 WHERE user_id=$2', [f.otherPoint, f.worker]);
          await assert.rejects(
            run(f, () => bookings.update(f.boss, source.id, { requestId: uuid(), masterId: f.worker })),
            failure(400, 'RESOURCE_UNAVAILABLE'),
          );
          await q('UPDATE user_points SET point_id=$1 WHERE user_id=$2', [f.point, f.worker]);
          for (const field of ['is_active', 'dismissed_at', 'purged_at']) {
            await q(`UPDATE users SET ${field}=${field === 'is_active' ? 'false' : 'now()'} WHERE id=$1`, [f.worker]);
            await assert.rejects(
              run(f, () => bookings.update(f.boss, source.id, { requestId: uuid(), masterId: f.worker })),
              failure(400, 'RESOURCE_UNAVAILABLE'),
            );
            await q(`UPDATE users SET ${field}=${field === 'is_active' ? 'true' : 'NULL'} WHERE id=$1`, [f.worker]);
          }
          assert.equal((await one('SELECT master_id FROM bookings WHERE id=$1', [source.id])).master_id, f.owner);
        },
      );
      await scenario(
        'review repair: public transfer and internal create on unconfigured resource serialize in both orders',
        async () => {
          for (const transferFirst of [false, true]) {
            const f = await seed();
            await f.submit(f.body());
            const source = await f.booking(),
              entered = defer(),
              release = defer();
            const transfer = () =>
              run(f, () => bookings.update(f.boss, source.id, { requestId: uuid(), masterId: f.worker }));
            const create = () => f.internal({ masterId: f.worker });
            let paused = false;
            const first = gates.run(
              async (sql) => {
                if (
                  !paused &&
                  (transferFirst
                    ? sql.startsWith('UPDATE bookings SET scheduled_at=')
                    : sql.includes('INSERT INTO bookings'))
                ) {
                  paused = true;
                  entered.resolve();
                  await release.promise;
                }
              },
              transferFirst ? transfer : create,
            );
            await entered.promise;
            const second = (transferFirst ? create : transfer)();
            try {
              await waiting('%pg_advisory_xact_lock%');
            } finally {
              release.resolve();
            }
            const outcomes = await Promise.allSettled([first, second]);
            assert.equal(outcomes[0].status, 'fulfilled');
            assert.equal(outcomes[1].status, 'rejected');
            assert.ok(failure(409, 'SLOT_UNAVAILABLE')(outcomes[1].reason));
            assert.equal(
              (
                await one(
                  "SELECT count(*)::int n FROM bookings WHERE tenant_id=$1 AND master_id=$2 AND status='scheduled'",
                  [f.tenant, f.worker],
                )
              ).n,
              1,
            );
          }
        },
      );
      await scenario(
        'review repair: muted public reminder uses own snapshot and fresh point/permission/own recipients',
        async () => {
          const f = await seed(),
            allowed = uuid(),
            otherPointAdmin = uuid(),
            otherPointDirector = uuid(),
            revoked = uuid(),
            revokedRole = uuid();
          await q('UPDATE clients SET point_id=$1 WHERE id=$2', [f.otherPoint, f.client]);
          await q(
            `INSERT INTO roles(id,tenant_id,name,matrix) VALUES($1,$2,'Revoked bookings','{"bookings":{"view":false}}')`,
            [revokedRole, f.tenant],
          );
          for (const [id, role, roleId, point] of [
            [allowed, 'admin', f.role, f.point],
            [otherPointAdmin, 'admin', f.role, f.otherPoint],
            [otherPointDirector, 'director', null, f.otherPoint],
            [revoked, 'admin', f.role, f.point],
          ]) {
            await q(
              "INSERT INTO users(id,tenant_id,phone,password,full_name,role,role_id) VALUES($1,$2,$5,'fixture-only','Reminder recipient',$3,$4)",
              [id, f.tenant, role, roleId, id],
            );
            await q('INSERT INTO user_points(user_id,tenant_id,point_id) VALUES($1,$2,$3)', [id, f.tenant, point]);
          }
          await f.submit(f.body({ name: 'Own request contact' }));
          await drain();
          assert.equal((await f.booking()).client_id, null);
          // Revoke after submission, so no cached authorisation from creation can leak the reminder.
          await q('UPDATE users SET role_id=$1 WHERE id=$2', [revokedRole, revoked]);
          await q("UPDATE bookings SET scheduled_at=now()+interval '1 hour' WHERE tenant_id=$1", [f.tenant]);
          await q('UPDATE booking_settings SET reminder_enabled=true,reminder_hours=2 WHERE tenant_id=$1', [f.tenant]);
          await q(
            "INSERT INTO messaging_integrations(tenant_id,provider_type,api_key,is_active) VALUES($1,'smsru','fixture-not-used',true)",
            [f.tenant],
          );
          const sent = [],
            smsAttempts = [];
          const reminders = new BookingReminderService(
            native,
            {
              sendClientMessage: async (...args) => {
                smsAttempts.push(args);
                return { sent: false, reason: 'no_provider' };
              },
            },
            {
              sendToUserCategory: async (id, _category, _title, body) => {
                sent.push({ id, body });
              },
              sendToUserInTenant: async (id, tenant, _category, _title, body) => {
                assert.equal(tenant, f.tenant);
                sent.push({ id, body });
              },
            },
          );
          await reminders.run();
          await reminders.run();
          assert.equal(smsAttempts.length, 1);
          assert.equal(smsAttempts[0][1], f.phone);
          assert.equal(smsAttempts[0][3].clientId, null);
          assert.deepEqual(sent.map((s) => s.id).sort(), [f.owner, allowed].sort());
          assert.ok(sent.every((s) => s.body.includes('Own request contact') && !s.body.includes('Saved card name')));
        },
      );
    } finally {
      await Promise.allSettled(effects);
      const cleanup = new TenantsService(native, {}, {});
      for (const tenant of tenants)
        await cleanup.purgeTenantData(tenant).catch((error) => {
          if (error.getStatus?.() !== 404) throw error;
        });
      await app.end();
      await admin.end();
    }
  },
);
