const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ВОРОНКА ЗВОНКОВ ПО РЕАЛЬНЫМ ЗВОНКАМ (правка владельца №4, 2026-09-25).
 *
 * Симптом: на главной воронка показывала нули при подключённой телефонии —
 * она считалась по sms_history. Теперь источник — CallsService.getCalls.
 * Инварианты:
 *
 *   1. Пример из спеки: 2 входящих с одного номера + 1 с другого, один номер —
 *      клиент с чеком после звонка → uniqueCallers=2, knownCallers=1,
 *      arrivedClients=1, createdChecks=1, conversionRate=50.
 *   2. Номера уходят в ОДИН SQL массивами (unnest), день первого звонка —
 *      в поясе тенанта, фильтр филиала — по чекам.
 *   3. Телефония не подключена → нули и telephony.connected=false.
 *   4. Провайдер ответил ошибкой → нули, telephony.connected=true + error.
 *   5. Кэш 60 с: второй вызов не ходит к провайдеру.
 *   6. Статика: в теле getCallFunnel больше нет sms_history.
 *
 * Живой БД в CI нет — пул подменяется заглушкой, которая запоминает параметры
 * запроса воронки и отвечает агрегатами.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const { ReportsService } = require('../dist/reports/reports.service');
const { BadRequestException } = require('@nestjs/common');

function makePool(funnelRow) {
  const calls = [];
  const pool = {
    calls,
    query: async (sql, params) => {
      if (/SELECT timezone FROM tenants/.test(sql)) return { rows: [{ timezone: 'Europe/Moscow' }] };
      if (/unnest\(\$2::text\[\], \$3::date\[\]\)/.test(sql)) {
        calls.push({ sql, params });
        return { rows: [funnelRow] };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
    },
  };
  return pool;
}

const SPEC_CALLS = {
  calls: [
    // Номер A — клиент: два входящих (второй пропущен), первый звонок 10 сентября.
    {
      id: 'a1',
      date: '2026-09-10T08:00:00.000Z',
      direction: 'incoming',
      from: '+7 (900) 111-22-33',
      to: '101',
      status: 'answered',
    },
    {
      id: 'a2',
      date: '2026-09-12T09:00:00.000Z',
      direction: 'incoming',
      from: '+7 (900) 111-22-33',
      to: '101',
      status: 'missed',
    },
    // Номер B — не клиент: входящий поздно вечером по UTC = уже 13 сентября по Москве.
    {
      id: 'b1',
      date: '2026-09-12T21:30:00.000Z',
      direction: 'incoming',
      from: '89004445566',
      to: '101',
      status: 'answered',
    },
    // Исходящий — в воронку не входит.
    {
      id: 'o1',
      date: '2026-09-12T10:00:00.000Z',
      direction: 'outgoing',
      from: '101',
      to: '89004445566',
      status: 'answered',
    },
    // Без номера — не «звонивший».
    {
      id: 'x1',
      date: '2026-09-12T11:00:00.000Z',
      direction: 'incoming',
      from: 'anonymous',
      to: '101',
      status: 'missed',
    },
  ],
  summary: { total: 5, incoming: 4, outgoing: 1, missed: 2, notCalledBack: 1 },
};

function fakeCalls(provider, result) {
  let getCallsCount = 0;
  return {
    get getCallsCount() {
      return getCallsCount;
    },
    getTelephonyProvider: async () => provider,
    getCalls: async () => {
      getCallsCount += 1;
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

// ── 1–2. Пример из спеки ─────────────────────────────────────────────────────

test('пример из спеки: uniqueCallers=2, knownCallers=1, arrivedClients=1, createdChecks=1, conversionRate=50', async () => {
  const pool = makePool({
    known_callers: '1',
    arrived_clients: '1',
    created_checks: '1',
    total_revenue: '5000.00',
    repeat_clients: '0',
  });
  const calls = fakeCalls('moizvonki', SPEC_CALLS);
  const svc = new ReportsService(pool, calls);

  const f = await svc.getCallFunnel('tenant-spec', { dateFrom: '2026-09-01', dateTo: '2026-09-30' }, 'point-1');

  assert.equal(f.totalCalls, 4, 'входящие за период');
  assert.equal(f.answeredCalls, 2);
  assert.equal(f.missedCalls, 2);
  assert.equal(f.notCalledBack, 1);
  assert.equal(f.outgoingCalls, 1);
  assert.equal(f.uniqueCallers, 2);
  assert.equal(f.knownCallers, 1);
  assert.equal(f.newCallers, 1);
  assert.equal(f.arrivedClients, 1);
  assert.equal(f.createdChecks, 1);
  assert.equal(f.totalRevenue, 5000);
  assert.equal(f.avgCheckValue, 5000);
  assert.equal(f.conversionRate, 50);
  assert.equal(f.repeatClients, 0);
  assert.deepEqual(f.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(f.telephony, { connected: true, provider: 'moizvonki' });

  // Один SQL на сопоставление: номера (последние 10 цифр) и дни первого звонка
  // уходят массивами; день B — 13 сентября по Москве, хотя по UTC ещё 12-е.
  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.equal(params[0], 'tenant-spec');
  assert.deepEqual(params[1], ['9001112233', '9004445566']);
  assert.deepEqual(params[2], ['2026-09-10', '2026-09-13']);
  assert.equal(params[3], 'Europe/Moscow');
  assert.equal(params[4], '2026-09-30');
  assert.equal(params[5], 'point-1');
  assert.ok(/ch\.point_id = \$6/.test(sql), 'чеки воронки обязаны резаться филиалом');
  assert.ok(/right\(regexp_replace\(cl\.phone, '\[\^0-9\]', '', 'g'\), 10\) = c\.phone_key/.test(sql));
  assert.ok(/AT TIME ZONE \$4::text/.test(sql), 'границы дней — в поясе тенанта');
  assert.ok(/is_deferred = false AND ch\.deleted_at IS NULL/.test(sql), 'только проведённые живые чеки');
  assert.ok(/payment_method IS DISTINCT FROM 'warranty'/.test(sql), 'гарантия денег не приносит');
});

test('без филиала фильтр по точке не добавляется, а lower-case/8-формат номера схлопываются в один ключ', async () => {
  const pool = makePool({
    known_callers: '0',
    arrived_clients: '0',
    created_checks: '0',
    total_revenue: '0',
    repeat_clients: '0',
  });
  const calls = fakeCalls('mango', {
    calls: [
      {
        id: '1',
        date: '2026-09-02T10:00:00.000Z',
        direction: 'incoming',
        from: '+79001112233',
        to: '',
        status: 'answered',
      },
      {
        id: '2',
        date: '2026-09-01T10:00:00.000Z',
        direction: 'incoming',
        from: '8 900 111-22-33',
        to: '',
        status: 'missed',
      },
    ],
    summary: { total: 2, incoming: 2, outgoing: 0, missed: 1, notCalledBack: 1 },
  });
  const svc = new ReportsService(pool, calls);
  const f = await svc.getCallFunnel('tenant-nopoint', { dateFrom: '2026-09-01', dateTo: '2026-09-05' }, null);
  assert.equal(f.uniqueCallers, 1);
  assert.equal(f.conversionRate, 0);
  assert.equal(f.telephony.provider, 'mango');
  const { sql, params } = pool.calls[0];
  assert.deepEqual(params[1], ['9001112233']);
  assert.deepEqual(params[2], ['2026-09-01'], 'первый звонок — самый ранний день, а не первый в списке');
  assert.equal(params.length, 5);
  assert.ok(!/point_id/.test(sql));
});

// ── 3. Телефония не подключена ───────────────────────────────────────────────

test('телефонии нет → нули и telephony.connected=false, к провайдеру и в SQL не ходим', async () => {
  const pool = makePool(null);
  const calls = fakeCalls(null, SPEC_CALLS);
  const svc = new ReportsService(pool, calls);
  const f = await svc.getCallFunnel('tenant-none', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.equal(f.totalCalls, 0);
  assert.equal(f.uniqueCallers, 0);
  assert.equal(f.arrivedClients, 0);
  assert.equal(f.conversionRate, 0);
  assert.deepEqual(f.telephony, { connected: false, provider: null });
  assert.equal(calls.getCallsCount, 0);
  assert.equal(pool.calls.length, 0);
});

// ── 4. Провайдер ответил ошибкой ─────────────────────────────────────────────

test('провайдер упал → нули, telephony.connected=true и текст ошибки для UI', async () => {
  const pool = makePool(null);
  const calls = fakeCalls('moizvonki', new BadRequestException({ message: 'МоиЗвонки: сетевая ошибка — timeout' }));
  const svc = new ReportsService(pool, calls);
  const f = await svc.getCallFunnel('tenant-err', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.equal(f.totalCalls, 0);
  assert.deepEqual(f.telephony, {
    connected: true,
    provider: 'moizvonki',
    error: 'МоиЗвонки: сетевая ошибка — timeout',
  });
  assert.equal(pool.calls.length, 0);
});

// ── 5. Кэш 60 с ──────────────────────────────────────────────────────────────

test('повторный запрос за тот же период идёт из кэша, а другой период — снова к провайдеру', async () => {
  const pool = makePool({
    known_callers: '0',
    arrived_clients: '0',
    created_checks: '0',
    total_revenue: '0',
    repeat_clients: '0',
  });
  const calls = fakeCalls('moizvonki', SPEC_CALLS);
  const svc = new ReportsService(pool, calls);
  await svc.getCallFunnel('tenant-cache', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  await svc.getCallFunnel('tenant-cache', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.equal(calls.getCallsCount, 1);
  await svc.getCallFunnel('tenant-cache', { dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  assert.equal(calls.getCallsCount, 2);
});

// ── 6. Статика ───────────────────────────────────────────────────────────────

test('getCallFunnel больше не считается по sms_history и кеширует по tenant+point+период', () => {
  const reports = read('src/reports/reports.service.ts');
  const body = reports.slice(reports.indexOf('async getCallFunnel('), reports.indexOf('async getCashFlow('));
  assert.ok(!/FROM sms_history/.test(body), 'воронка снова считается по СМС — нули при подключённой телефонии');
  assert.ok(/call-funnel:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}:\$\{dateFrom\}:\$\{dateTo\}/.test(body));
  assert.ok(/this\.callsService\.getTelephonyProvider\(tenantID\)/.test(body));
  assert.ok(/unnest\(\$2::text\[\], \$3::date\[\]\)/.test(body), 'сопоставление номеров — одним SQL с массивами');
  const callsService = read('src/calls/calls.service.ts');
  assert.ok(
    /async getTelephonyProvider\(tenantId: string\): Promise<'mango' \| 'moizvonki' \| null>/.test(callsService),
  );
});
