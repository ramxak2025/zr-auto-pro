const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');

/**
 * VIN-КОД АВТОМОБИЛЯ (171, 2026-09-25).
 *
 * Что охраняет этот файл:
 *
 *   1. backend/src/vin/vin.util.ts — КОПИЯ shared/utils/vin.ts. Кейсы ниже —
 *      зеркало mobile/src/utils/__tests__/vin.test.ts: разъедутся копии —
 *      клиент посчитает VIN валидным, сервер отвергнет (или наоборот).
 *   2. Офлайн-таблица WMI покрывает рынок РФ (АвтоВАЗ, российские сборки
 *      иномарок, Китай) — NHTSA их не знает, и без таблицы марка не подставится.
 *   3. Адаптер Vincario: формула контрольной суммы, разбор ответа, маскирование
 *      ключей в ошибках. Реального ключа нет — проверяется на подставном fetch.
 *   4. Адаптер NHTSA: разбор полей и перевод топлива/кузова.
 *   5. VinService.decode: порядок источников (платный → NHTSA → WMI), valid:false
 *      вместо 400, лимит 60/мин на тенанта.
 *   6. Статические инварианты: 409 VIN_DUPLICATE в cars, vinEnabled в проекции
 *      auth и в mapTenant, идемпотентная миграция 171, регистрация модуля.
 *
 * Тесты рантаймовые (через dist) там, где можно проверить поведение без сети
 * и без БД (пул и fetch подменяются), статические — где инвариант есть текст.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const util = require('../dist/vin/vin.util');
const { lookupWmi, WMI_TABLE } = require('../dist/vin/wmi-table');
const { vincarioProvider, vincarioControlSum } = require('../dist/vin/providers/vincario');
const { decodeVinNhtsa } = require('../dist/vin/providers/nhtsa');
const { VinService } = require('../dist/vin/vin.service');

// ── 1. Паритет хелперов с shared/utils/vin.ts ────────────────────────────────

test('normalizeVin: регистр, пробелы, дефисы', () => {
  assert.equal(util.normalizeVin(' xta 21901-0k0123456 '), 'XTA219010K0123456');
});

test('normalizeVin: кириллические двойники → латиница', () => {
  assert.equal(util.normalizeVin('ХТА219010К0123456'), 'XTA219010K0123456');
  assert.equal(util.normalizeVin('А В Е К М Н Р С Т У Х'), 'ABEKMHPCTYX');
});

test('normalizeVin: I/O/Q (и кириллическая О) → цифры, чужие символы отбрасываются', () => {
  assert.equal(util.normalizeVin('1HGCM82633AOO4352'), '1HGCM82633A004352');
  assert.equal(util.normalizeVin('WBAІ'), 'WBA');
  assert.equal(util.normalizeVin('JQ1I'), 'J011');
  assert.equal(util.normalizeVin(''), '');
  assert.equal(util.normalizeVin(null), '');
  assert.equal(util.normalizeVin(undefined), '');
});

test('isValidVin: 17 символов алфавита', () => {
  assert.equal(util.isValidVin('XTA219010K0123456'), true);
  assert.equal(util.isValidVin('1HGCM82633A004352'), true);
  assert.equal(util.isValidVin('XTA219010K012345'), false);
  assert.equal(util.isValidVin('XTA219010K01234567'), false);
  assert.equal(util.isValidVin('XTA219010K012345O'), false);
  assert.equal(util.isValidVin(''), false);
  assert.equal(util.isValidVin(null), false);
});

test('контрольная цифра: только Северная Америка, 9-я позиция', () => {
  assert.equal(util.vinNeedsCheckDigit('1HGCM82633A004352'), true);
  assert.equal(util.vinNeedsCheckDigit('5YJSA1E26HF000337'), true);
  assert.equal(util.vinNeedsCheckDigit('XTA219010K0123456'), false);
  assert.equal(util.vinNeedsCheckDigit('WBA3A5C55CF123456'), false);
  assert.equal(util.vinCheckDigitOk('1HGCM82633A004352'), true);
  assert.equal(util.vinCheckDigitOk('1HGCM82633A004353'), false);
  assert.equal(util.vinCheckDigitOk('1HGCM8263XA004352'), false);
});

test('vinModelYear: 30-летний цикл, не позже следующего года', () => {
  const now = new Date('2026-09-25');
  assert.equal(util.vinModelYear('1HGCM82633A004352', now), 2003);
  assert.equal(util.vinModelYear('XTA219010K0123456', now), 2019);
  assert.equal(util.vinModelYear('WBA3A5C55CF123456', now), 2012);
  assert.equal(util.vinModelYear('XTA219010T0123456', now), 2026);
  assert.equal(util.vinModelYear('XTA219010V0123456', now), 2027);
  assert.equal(util.vinModelYear('XTA219010W0123456', now), 1998);
  assert.equal(util.vinModelYear('XTA219010U0123456', now), null);
  assert.equal(util.vinModelYear('XTA', now), null);
});

test('formatVin / vinWmi', () => {
  assert.equal(util.formatVin('XTA219010K0123456'), 'XTA 219010 K0123456');
  assert.equal(util.formatVin('XTA2190'), 'XTA2190');
  assert.equal(util.formatVin(''), '');
  assert.equal(util.vinWmi('XTA219010K0123456'), 'XTA');
});

test('humanizeMake: TOYOTA → Toyota, BMW остаётся, LAND ROVER → Land Rover', () => {
  assert.equal(util.humanizeMake('TOYOTA'), 'Toyota');
  assert.equal(util.humanizeMake('BMW'), 'BMW');
  assert.equal(util.humanizeMake('LAND ROVER'), 'Land Rover');
  assert.equal(util.humanizeMake('MERCEDES-BENZ'), 'Mercedes-Benz');
  assert.equal(util.humanizeMake('KIA'), 'Kia');
  assert.equal(util.humanizeMake('  '), null);
  assert.equal(util.humanizeMake(undefined), null);
});

// ── 2. Таблица WMI — рынок РФ ────────────────────────────────────────────────

test('таблица WMI: не меньше 300 записей и ключевые заводы РФ/СНГ/Китая', () => {
  assert.ok(Object.keys(WMI_TABLE).length >= 300, `в таблице всего ${Object.keys(WMI_TABLE).length} WMI`);
  const expect = {
    XTA: 'Lada',
    XTH: 'ГАЗ',
    X96: 'ГАЗ',
    XTT: 'УАЗ',
    XTC: 'КАМАЗ',
    X7L: 'Renault',
    Z8N: 'Nissan',
    XW8: 'Volkswagen',
    XWE: 'Kia',
    X4X: 'BMW',
    Z94: 'Hyundai',
    XUU: 'Chevrolet',
    X9F: 'Ford',
    XW7: 'Toyota',
    Y4K: 'Geely',
    XWB: 'Chevrolet',
    LVV: 'Chery',
    LGW: 'Haval',
    L6T: 'Geely',
    LS4: 'Changan',
    LGX: 'BYD',
    LJ1: 'JAC',
    LMG: 'GAC',
    LVU: 'Jetour',
    KNA: 'Kia',
    KMH: 'Hyundai',
    WBA: 'BMW',
    WVW: 'Volkswagen',
    TMB: 'Škoda',
    JTM: 'Toyota',
    '1HG': 'Honda',
  };
  for (const [wmi, make] of Object.entries(expect)) {
    assert.equal(lookupWmi(`${wmi}00000000000000`)?.make, make, `WMI ${wmi}`);
  }
});

test('таблица WMI: неоднозначные заводы помечены, неизвестный WMI → null, семейство по двум символам', () => {
  const kaluga = lookupWmi('XW8ZZZ61ZJG000001');
  assert.ok(kaluga.ambiguous.includes('Škoda'), 'XW8 (Калуга) собирал и Škoda — UI должен попросить проверить марку');
  assert.equal(lookupWmi('XW8ZZZ61ZJG000001').country, 'Россия');
  assert.equal(lookupWmi('QQQ00000000000000'), null);
  assert.equal(lookupWmi('XT'), null);
  // JTZ нет в точной таблице — семейство JT закреплено за Toyota.
  assert.equal(lookupWmi('JTZ00000000000000')?.make, 'Toyota');
});

// ── 3. Vincario — подставной fetch ───────────────────────────────────────────

const VIN_EU = 'TMBJJ7NE5F0123456';
const CREDS = { apiKey: 'test-api-key-12345', secretKey: 'test-secret-67890' };

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test('Vincario: контрольная сумма = sha1("vin|decode|key|secret")[0..10]', () => {
  const expected = createHash('sha1')
    .update(`${VIN_EU}|decode|${CREDS.apiKey}|${CREDS.secretKey}`)
    .digest('hex')
    .slice(0, 10);
  assert.equal(vincarioControlSum(VIN_EU, CREDS.apiKey, CREDS.secretKey), expected);
});

test('Vincario: URL и разбор ответа decode[]', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse({
      decode: [
        { label: 'Make', value: 'Skoda' },
        { label: 'Model', value: 'Octavia' },
        { label: 'Model Year', value: 2015 },
        { label: 'Body', value: 'Hatchback' },
        { label: 'Fuel Type - Primary', value: 'Gasoline' },
        { label: 'Engine Displacement (ccm)', value: 1798 },
        { label: 'Engine Power (kW)', value: 132 },
      ],
    });
  };
  const r = await vincarioProvider.decode(VIN_EU, CREDS, { timeoutMs: 1000, fetchImpl });
  assert.equal(r.make, 'Skoda');
  assert.equal(r.model, 'Octavia');
  assert.equal(r.year, 2015);
  assert.equal(r.bodyType, 'Hatchback');
  assert.equal(r.fuel, 'Gasoline');
  assert.equal(r.engine, '1.8 л, 179 л.с.');
  const sum = vincarioControlSum(VIN_EU, CREDS.apiKey, CREDS.secretKey);
  assert.equal(seen[0], `https://api.vindecoder.eu/3.2/${CREDS.apiKey}/${sum}/decode/${VIN_EU}.json`);
});

test('Vincario: ошибка сервиса — throw без ключей в тексте; нет decode — null', async () => {
  const withError = async () =>
    jsonResponse({ error: 'Invalid API key', message: `key ${CREDS.apiKey} rejected` }, 403);
  await assert.rejects(
    () => vincarioProvider.decode(VIN_EU, CREDS, { timeoutMs: 1000, fetchImpl: withError }),
    (err) => {
      assert.ok(/Vincario/.test(err.message));
      assert.ok(!err.message.includes(CREDS.apiKey), 'ключ утёк в текст ошибки');
      return true;
    },
  );
  const empty = async () => jsonResponse({ balance: { 'API Decode': 5 } });
  assert.equal(await vincarioProvider.decode(VIN_EU, CREDS, { timeoutMs: 1000, fetchImpl: empty }), null);
  await assert.rejects(() => vincarioProvider.decode(VIN_EU, { apiKey: '' }, { timeoutMs: 1000, fetchImpl: empty }));
});

// ── 4. NHTSA — подставной fetch ──────────────────────────────────────────────

const NHTSA_HONDA = {
  Results: [
    {
      Make: 'HONDA',
      Model: 'Accord',
      ModelYear: '2003',
      BodyClass: 'Coupe',
      FuelTypePrimary: 'Gasoline',
      DisplacementL: '2.998832712',
      ErrorCode: '0',
    },
  ],
};

test('NHTSA: разбор полей, человеческая марка, перевод топлива и кузова', async () => {
  const r = await decodeVinNhtsa('1HGCM82633A004352', {
    timeoutMs: 1000,
    fetchImpl: async () => jsonResponse(NHTSA_HONDA),
  });
  assert.deepEqual(r, {
    make: 'Honda',
    model: 'Accord',
    year: 2003,
    bodyType: 'Купе',
    fuel: 'Бензин',
    engine: '3.0 л',
  });
});

test('NHTSA: пустой Make, HTTP-ошибка и сетевой сбой → null (молча дальше)', async () => {
  const empty = async () => jsonResponse({ Results: [{ Make: '', Model: '', ErrorCode: '1,7' }] });
  assert.equal(await decodeVinNhtsa('XTA219010K0123456', { timeoutMs: 1000, fetchImpl: empty }), null);
  assert.equal(
    await decodeVinNhtsa('XTA219010K0123456', { timeoutMs: 1000, fetchImpl: async () => jsonResponse({}, 503) }),
    null,
  );
  assert.equal(
    await decodeVinNhtsa('XTA219010K0123456', {
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    }),
    null,
  );
});

// ── 5. VinService.decode — порядок источников ────────────────────────────────

function fakePool(tenantRow) {
  return {
    query: async (sql) => {
      if (/vin_decoder_provider/.test(sql)) return { rows: [tenantRow] };
      if (/vin_enabled/.test(sql)) return { rows: [{ vin_enabled: true }] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

/** fetch-заглушка: NHTSA знает только Honda; Vincario знает Škoda. */
const routedFetch = async (url) => {
  if (url.startsWith('https://vpic.nhtsa.dot.gov/')) {
    return url.includes('1HGCM82633A004352')
      ? jsonResponse(NHTSA_HONDA)
      : jsonResponse({ Results: [{ Make: '', Model: '', ErrorCode: '1,7' }] });
  }
  if (url.startsWith('https://api.vindecoder.eu/')) {
    return jsonResponse({
      decode: [
        { label: 'Make', value: 'Skoda' },
        { label: 'Model', value: 'Octavia' },
        { label: 'Model Year', value: 2015 },
      ],
    });
  }
  throw new Error(`unexpected fetch ${url}`);
};

test('decode: некорректный VIN → 200 valid:false, без похода в источники', async () => {
  const svc = new VinService(fakePool({ vin_decoder_provider: null, vin_decoder_credentials: null }));
  svc.fetchImpl = async () => {
    throw new Error('не должен вызываться');
  };
  const r = await svc.decode('t1', 'XTA219010K012345');
  assert.equal(r.valid, false);
  assert.equal(r.source, 'none');
  assert.equal(r.make, null);
  assert.equal(r.vin, 'XTA219010K012345');
});

test('decode: Lada — NHTSA молчит, марка из таблицы WMI, год по 10-й позиции', async () => {
  const svc = new VinService(fakePool({ vin_decoder_provider: null, vin_decoder_credentials: null }));
  svc.fetchImpl = routedFetch;
  const r = await svc.decode('t2', 'хта219010к0123456');
  assert.equal(r.valid, true);
  assert.equal(r.vin, 'XTA219010K0123456');
  assert.equal(r.source, 'wmi');
  assert.equal(r.make, 'Lada');
  assert.equal(r.model, null);
  assert.equal(r.makeModel, 'Lada');
  assert.equal(r.year, 2019);
  assert.ok(r.notes.some((n) => n.startsWith('Производитель по WMI: АвтоВАЗ')));
});

test('decode: Honda — марка и модель из NHTSA (source nhtsa), контрольная цифра сходится', async () => {
  const svc = new VinService(fakePool({ vin_decoder_provider: null, vin_decoder_credentials: null }));
  svc.fetchImpl = routedFetch;
  const r = await svc.decode('t3', '1HGCM82633A004352');
  assert.equal(r.source, 'nhtsa');
  assert.equal(r.makeModel, 'Honda Accord');
  assert.equal(r.year, 2003);
  assert.equal(r.fuel, 'Бензин');
  assert.equal(r.notes, undefined);
});

test('decode: платный провайдер тенанта побеждает (source paid), кэш отдаёт тот же ответ', async () => {
  const svc = new VinService(
    fakePool({ vin_decoder_provider: 'vincario', vin_decoder_credentials: { apiKey: 'k1234', secretKey: 's5678' } }),
  );
  let fetches = 0;
  svc.fetchImpl = async (url) => {
    fetches += 1;
    return routedFetch(url);
  };
  const r = await svc.decode('t4', VIN_EU);
  assert.equal(r.source, 'paid');
  assert.equal(r.makeModel, 'Skoda Octavia');
  assert.equal(r.year, 2015);
  const again = await svc.decode('t4', VIN_EU.toLowerCase());
  assert.equal(again, r, 'повторная расшифровка того же VIN должна идти из кэша');
  assert.equal(fetches, 1);
});

test('decode: платный провайдер упал → пометка в notes и бесплатные источники', async () => {
  const svc = new VinService(
    fakePool({ vin_decoder_provider: 'vincario', vin_decoder_credentials: { apiKey: 'k1234', secretKey: 's5678' } }),
  );
  svc.fetchImpl = async (url) => {
    if (url.startsWith('https://api.vindecoder.eu/')) throw new Error('ETIMEDOUT');
    return routedFetch(url);
  };
  const r = await svc.decode('t5', 'XTA219010K0123456');
  assert.equal(r.source, 'wmi');
  assert.equal(r.make, 'Lada');
  assert.ok(r.notes.includes('Платный сервис не ответил — использованы бесплатные источники'));
});

test('decode: лимит 60 расшифровок в минуту на тенанта → 429', async () => {
  const svc = new VinService(fakePool({ vin_decoder_provider: null, vin_decoder_credentials: null }));
  svc.fetchImpl = routedFetch;
  for (let i = 0; i < 60; i++) {
    const vin = `XTA219010K01${String(i).padStart(5, '0')}`;
    await svc.decode('t6', vin);
  }
  await assert.rejects(
    () => svc.decode('t6', 'XTA219010K0199999'),
    (err) => err.getStatus && err.getStatus() === 429,
  );
  // Другой тенант не задет.
  assert.equal((await svc.decode('t7', 'XTA219010K0199999')).make, 'Lada');
});

// ── 6. Статические инварианты ────────────────────────────────────────────────

test('cars: VIN принимается только при включённой опции, дубль → 409 VIN_DUPLICATE', () => {
  const cars = read('src/cars/cars.service.ts');
  assert.ok(/code: 'VIN_DUPLICATE'/.test(cars));
  assert.ok(/new ConflictException\(\{\s*code: 'VIN_DUPLICATE'/.test(cars));
  assert.ok(
    /if \(!\(await this\.vin\.isEnabled\(tenantID\)\)\) return undefined;/.test(cars),
    'выключенная опция обязана молча игнорировать vin',
  );
  const controller = read('src/cars/cars.controller.ts');
  assert.ok(
    controller.indexOf("@Get('lookup-by-vin')") < controller.indexOf("@Get(':id')"),
    'lookup-by-vin объявлен после :id — перехватится как id',
  );
});

test('vinEnabled едет во всех проекциях tenant: auth (login/me/refresh) и /my-company', () => {
  assert.ok(read('src/auth/auth.service.ts').includes("'vinEnabled',COALESCE(t.vin_enabled,false)"));
  assert.ok(read('src/tenants/tenants.service.ts').includes('vinEnabled: row.vin_enabled === true'));
});

test('миграция 171 идемпотентна и модуль зарегистрирован', () => {
  const sql = read('migrations/171_cars_vin.sql');
  for (const stmt of sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'))) {
    const body = stmt.replace(/^(--.*\n)+/gm, '');
    assert.ok(/IF NOT EXISTS/.test(body), `не идемпотентно: ${body.slice(0, 80)}`);
  }
  assert.ok(read('src/app.module.ts').includes('VinModule'));
});
