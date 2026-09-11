const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * МГНОВЕННОЕ ПЕРЕКЛЮЧЕНИЕ ФИЛИАЛА РУКОВОДИТЕЛЕМ (167). Что охраняет тест:
 *
 *   1. РУКОВОДИТЕЛЬ переключается одним запросом и получает токен с НОВЫМ
 *      филиалом — без повторного ввода пароля.
 *   2. СТАРЫЙ ТОКЕН ПОСЛЕ ЭТОГО МЁРТВ — немедленно (без grace-окна refresh'а) и
 *      без 30-секундной отсрочки auth-кэша: перехваченный прежний токен не
 *      должен остаться рабочим.
 *   3. СОТРУДНИК получает отказ С ОБЪЯСНЕНИЕМ, а его живая сессия не страдает:
 *      прежний сценарий 163 (выйти и войти) для него сохраняется дословно.
 *   4. ЧУЖОЙ и АРХИВНЫЙ филиалы отклонены одним и тем же ответом — по нему
 *      нельзя выяснить, существует ли филиал в чужой сети.
 *   5. ТОТ ЖЕ ФИЛИАЛ — не ошибка и не перевыпуск: ни один токен не гаснет.
 *   6. ОДНОТОЧЕЧНЫЙ ТЕНАНТ не затронут.
 *   7. ВХОД ПОД ПОЛЬЗОВАТЕЛЕМ не отмывается в полноценный токен.
 *   8. ПРАВИЛО ПРАВА живёт в SQL-функции 166, второй копии в коде нет.
 *   9. РУЧКА метится глобальным rate-limit'ом, как остальные чувствительные.
 *  10. СТАРАЯ ручка POST /points/switch не тронута (сборки 3.5/3.6).
 *
 * Тесты поведенческие: сервисы поднимаются на пуле-заглушке (как в
 * points-session-login), живой БД в CI нет.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-strategy-32-chars-min';

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');
/** Пробелы нечувствительны к переносам: prettier волен переносить строки. */
const flat = (source) => source.replace(/\s+/g, ' ');

const { AuthService } = require('../dist/auth/auth.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PointsService } = require('../dist/points/points.service');
const { RateLimitGuard } = require('../dist/common/guards/rate-limit.guard.js');
const { ttlCache } = require('../dist/common/ttl-cache');
const { authCacheKey } = require('../dist/common/auth-cache');

const authServiceSrc = read('src/auth/auth.service.ts');
const authControllerSrc = read('src/auth/auth.controller.ts');
const pointsServiceSrc = read('src/points/points.service.ts');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MAIN = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const FOREIGN = '55555555-5555-4555-8555-555555555555';
const ARCHIVED = '66666666-6666-4666-8666-666666666666';

/** Пул-заглушка: первый совпавший шаблон отвечает; журнал запросов открыт. */
function fakePool(routes) {
  const calls = [];
  const run = async (text, params) => {
    calls.push({ text, params });
    for (const [pattern, rows] of routes) {
      if (pattern.test(text.replace(/\s+/g, ' '))) {
        const value = typeof rows === 'function' ? rows(params, calls) : rows;
        return Array.isArray(value) ? { rows: value, rowCount: value.length } : value;
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return { calls, query: run, connect: async () => ({ query: run, release() {} }) };
}

/** JwtService-заглушка: токен = JSON, чтобы читать claims прямо в тесте. */
function fakeJwt() {
  return {
    sign(payload, opts) {
      return JSON.stringify({
        ...payload,
        expiresIn: opts?.expiresIn ?? null,
        exp: Math.floor(Date.now() / 1000) + 600,
      });
    },
    decode(token) {
      try {
        return JSON.parse(token);
      } catch {
        return null;
      }
    },
    verify(token) {
      return JSON.parse(token);
    },
  };
}

const TOKEN_EXP = Math.floor(Date.now() / 1000) + 86400;
const bearer = (extra = {}) =>
  JSON.stringify({ sub: USER, tenantId: TENANT, jti: 'jti-live', pointId: MAIN, exp: TOKEN_EXP, ...extra });

const actorIn = (pointId, jti = 'jti-live') => ({
  userID: USER,
  tenantID: TENANT,
  currentPointId: pointId,
  jti,
});

const userRow = (extra = {}) => ({
  id: USER,
  phone: '+79990000000',
  full_name: 'Владелец',
  avatar: null,
  role: 'director',
  role_id: null,
  role_name: null,
  role_matrix: null,
  salary_percent: 0,
  is_active: true,
  dismissed_at: null,
  purged_at: null,
  tenant_id: TENANT,
  current_point_id: MAIN,
  created_at: new Date().toISOString(),
  tenant_json: null,
  ...extra,
});

/**
 * Гейт как в базе: право управления персоналом (166) + доступ к филиалу
 * (163/165/166). Доступными считаем только ЖИВЫЕ филиалы СВОЕГО тенанта —
 * ровно то, что делает autexa_available_points.
 */
const gateRoute = (canManage, allowed = [MAIN, BRANCH]) => [
  /autexa_can_manage_staff/,
  (params) => [{ can_manage: canManage, point_allowed: allowed.includes(params[2]) }],
];

const insertedRevocations = (pool) => pool.calls.filter((c) => /INSERT INTO revoked_tokens/.test(c.text));
const rememberedPoints = (pool) => pool.calls.filter((c) => /UPDATE users SET current_point_id/.test(c.text));

// ── 1. Руководитель переключается одним запросом ─────────────────────────────

test('руководитель переключается: новый токен с новым филиалом, старый погашен немедленно', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  // Живой позитивный auth-кэш старого токена: без его сброса прежний bearer
  // работал бы ещё до 30 секунд ПОСЛЕ ревокации.
  const cacheKey = authCacheKey(USER, 'jti-live');
  await ttlCache.wrap(cacheKey, 30_000, async () => ({ cached: true }));

  const res = await auth.switchPoint(actorIn(MAIN), bearer(), { pointId: BRANCH });

  assert.equal(res.switched, true);
  assert.equal(res.currentPointId, BRANCH);
  assert.equal(JSON.parse(res.token).pointId, BRANCH, 'филиал обязан уехать в НОВЫЙ подписанный токен');
  assert.equal(JSON.parse(res.token).tenantId, TENANT, 'тенант обязан переехать вместе с сессией');
  assert.equal(res.user.currentPointId, BRANCH, 'профиль в ответе обязан показывать филиал ПОСЛЕ переключения');

  const revocation = insertedRevocations(pool);
  assert.equal(revocation.length, 1, 'старый токен обязан гаснуть ровно один раз');
  assert.equal(revocation[0].params[0], 'jti-live', 'гасить обязаны ИМЕННО прежний токен');
  assert.equal(revocation[0].params[3], 0, 'grace-окна здесь быть не должно: прежний токен привязан к старому филиалу');
  assert.match(
    flat(revocation[0].text),
    /ON CONFLICT \(jti\) DO NOTHING/,
    'ревокация обязана быть атомарным claim: два параллельных переключения не должны дать два токена',
  );

  assert.equal(
    await ttlCache.wrap(cacheKey, 30_000, async () => ({ cached: false })).then((v) => v.cached),
    false,
    'auth-кэш старого токена не сброшен — перехваченный bearer проживёт ещё до 30 секунд',
  );

  const remembered = rememberedPoints(pool);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].params[0], BRANCH, 'подсказка следующего входа обязана переехать в новый филиал');
});

// ── 2. Старый токен после переключения мёртв ────────────────────────────────

test('прежний токен после переключения получает 401 на следующем же запросе', async () => {
  const strategy = new JwtStrategy(
    fakePool([
      // Строка ревокации из switchPoint: revoked_at = now(), то есть уже
      // действует — запрос JwtStrategy её видит.
      [/FROM revoked_tokens/, [{ '?column?': 1 }]],
    ]),
  );

  await assert.rejects(
    () => strategy.validate({ sub: USER, jti: 'jti-dead-after-switch', pointId: MAIN }),
    (err) => err?.status === 401 && /Токен отозван/.test(err?.response?.message ?? ''),
    'иначе после переключения в сети живут ДВА токена одного человека в разных филиалах',
  );
});

// ── 3. Сотруднику — отказ с объяснением, сессия не страдает ─────────────────

test('мастер получает понятный отказ, а его сессия остаётся живой', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow({ role: 'master' })]],
    gateRoute(false),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer(), { pointId: BRANCH }),
    (err) => {
      const message = err?.response?.message ?? err?.message ?? '';
      assert.equal(err?.status, 403);
      assert.match(message, /только руководителю/i, 'отказ обязан называть правило, а не выглядеть поломкой');
      assert.match(message, /войдите заново/i, 'человек обязан узнать, ЧТО ему делать дальше');
      return true;
    },
  );

  assert.equal(insertedRevocations(pool).length, 0, 'отказ не имеет права гасить живую сессию сотрудника');
  assert.equal(rememberedPoints(pool).length, 0, 'отказ не имеет права менять даже подсказку следующего входа');
});

// ── 4. Чужой и архивный филиал ──────────────────────────────────────────────

test('переключение на чужой филиал отклонено и ничего не меняет', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer(), { pointId: FOREIGN }),
    (err) => err?.status === 403 && /Филиал недоступен/.test(err?.response?.message ?? ''),
    'иначе руководитель одной сети получает законный токен в чужой автосервис',
  );
  assert.equal(insertedRevocations(pool).length, 0);
  assert.equal(rememberedPoints(pool).length, 0);
});

test('переключение на архивный филиал отклонено', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    // ARCHIVED в списке доступных не значится: autexa_available_points отдаёт
    // только живые филиалы.
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer(), { pointId: ARCHIVED }),
    (err) => err?.status === 403 && /Филиал недоступен/.test(err?.response?.message ?? ''),
    'закрытый филиал обязан оставаться закрытым — иначе в нём снова пробивают чеки',
  );
  assert.equal(insertedRevocations(pool).length, 0);
});

// ── 5. Тот же филиал — не ошибка и не перевыпуск ─────────────────────────────

test('переключение на текущий филиал — не ошибка: ни перевыпуска, ни ревокации', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow({ current_point_id: BRANCH })]],
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const token = bearer({ pointId: BRANCH });

  const res = await auth.switchPoint(actorIn(BRANCH), token, { pointId: BRANCH });

  assert.equal(res.switched, false);
  assert.equal(res.currentPointId, BRANCH);
  assert.equal(
    res.token,
    token,
    'в ответе обязан лежать ТОТ ЖЕ токен: безусловный commit клиента должен быть безопасен',
  );
  assert.equal(res.user.currentPointId, BRANCH);
  assert.equal(insertedRevocations(pool).length, 0, 'повторный тап по своему филиалу не имеет права убивать сессию');
  assert.equal(rememberedPoints(pool).length, 0);
  assert.equal(
    pool.calls.filter((c) => /autexa_can_manage_staff/.test(c.text)).length,
    0,
    'ничего не происходит — спрашивать права не за что',
  );
});

// ── 6. Одноточечный тенант ───────────────────────────────────────────────────

test('одноточечный тенант не затронут: переключать нечего и не на что', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow({ current_point_id: null })]],
    // Живых филиалов нет вовсе → autexa_available_points пуст → доступа нет.
    gateRoute(true, []),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(null), bearer({ pointId: undefined }), { pointId: MAIN }),
    (err) => err?.status === 403 && /Филиал недоступен/.test(err?.response?.message ?? ''),
    'у тенанта без филиалов сессия обязана остаться ровно такой, какой была',
  );
  assert.equal(insertedRevocations(pool).length, 0, 'сессия одноточечного тенанта не имеет права погаснуть');
});

// ── 7. Вход под пользователем не отмывается в полноценный токен ─────────────

test('impersonation-сессия не переключает филиал и не касается базы', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer({ impersonatedBy: 'superadmin-id' }), { pointId: BRANCH }),
    (err) => err?.status === 403 && /под пользователем/i.test(err?.response?.message ?? ''),
    '30-минутный токен «войти как владелец» не имеет права обменяться на 30-дневный без следа impersonation',
  );
  assert.equal(pool.calls.length, 0, 'отказ обязан случиться до любого обращения к базе');
});

// ── Живые проверки аккаунта мимо 30-секундного auth-кэша ────────────────────

test('уволенный руководитель не получает свежий токен внутри окна auth-кэша', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow({ dismissed_at: new Date().toISOString() })]],
    gateRoute(true),
    [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer(), { pointId: BRANCH }),
    (err) => err?.status === 401,
    'иначе уволенный минуту назад получает свежий 30-дневный токен',
  );
  assert.equal(insertedRevocations(pool).length, 0);
});

test('параллельное переключение одним токеном выигрывает ровно одно', async () => {
  let inserts = 0;
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    gateRoute(true),
    [
      /INSERT INTO revoked_tokens/,
      () => {
        inserts += 1;
        return { rows: [], rowCount: inserts === 1 ? 1 : 0 };
      },
    ],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());

  const first = await auth.switchPoint(actorIn(MAIN), bearer(), { pointId: BRANCH });
  assert.equal(first.switched, true);

  // Второй запрос гонки — тот же токен, тот же целевой филиал.
  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer(), { pointId: BRANCH }),
    (err) => err?.status === 401 && /Токен отозван/.test(err?.response?.message ?? ''),
    'второй токен по уже погашенной линии = две живые сессии в разных филиалах',
  );
});

// ── 8. Правило права живёт в SQL, второй копии в коде нет ───────────────────

test('право решает функция миграции 166, а не копия правила в TypeScript', () => {
  const src = flat(authServiceSrc);
  assert.match(src, /autexa_can_manage_staff\(\$\d::uuid\) as can_manage/, 'право обязано спрашиваться у базы');
  assert.match(src, /autexa_point_is_allowed\(\$\d::uuid, \$\d::uuid, \$\d::uuid\) as point_allowed/);
  assert.doesNotMatch(
    authServiceSrc,
    /user_management/,
    'вторая копия правила «кто вправе управлять персоналом» рано или поздно отстанет от первой',
  );
  assert.doesNotMatch(authServiceSrc, /employees['"\s]*\]|'employees'/, 'матрицу роли читает SQL-функция, не сервис');
});

// ── 9. Ручка метится глобальным rate-limit'ом ───────────────────────────────

test('POST /auth/switch-point метится обычным write-бакетом и не обходит лимит', async () => {
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  let guard;
  try {
    guard = new RateLimitGuard();
  } finally {
    global.setInterval = originalSetInterval;
  }

  const metered = [];
  guard.bump = async (key, max, now) => {
    metered.push({ key, max });
    return { overLimit: false, resetAt: now + 60_000 };
  };

  const request = {
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    method: 'POST',
    path: '/api/auth/switch-point',
    url: '/api/auth/switch-point',
    headers: { authorization: 'Bearer some.jwt.value' },
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) };

  assert.equal(await guard.canActivate(ctx), true);
  assert.equal(metered.length, 1, 'ручка перевыпуска сессии не имеет права проходить мимо лимитера');
  assert.equal(metered[0].max, 150);
  assert.ok(metered[0].key.startsWith('write:'), `неожиданный бакет ${metered[0].key}`);

  assert.match(flat(authControllerSrc), /@Post\('switch-point'\)/);
  assert.match(
    flat(authControllerSrc),
    /@UseGuards\(JwtAuthGuard\) @Post\('switch-point'\)/,
    'ручка обязана требовать ЖИВУЮ сессию — иначе это вход без пароля',
  );
  assert.doesNotMatch(
    authControllerSrc,
    /@UseGuards\([^)]*\bRateLimitGuard\b[^)]*\)/,
    'второй экземпляр лимитера списывал бы те же бакеты дважды за запрос',
  );
});

// ── 10. Старая ручка не тронута ─────────────────────────────────────────────

test('POST /points/switch по-прежнему только запоминает филиал следующего входа', async () => {
  const pool = fakePool([
    [/autexa_point_is_allowed/, [{ ok: true }]],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const points = new PointsService(pool);

  const res = await points.switchPoint(actorIn(MAIN), BRANCH);

  assert.deepEqual(res, { currentPointId: MAIN }, 'филиал ТЕКУЩЕЙ сессии старая ручка менять не может');
  assert.equal(res.token, undefined, 'старая ручка токенов не выпускает — сборки 3.5/3.6 их не ждут');
  assert.equal(rememberedPoints(pool).length, 1, 'подсказка следующего входа обязана записаться, как и раньше');
  assert.equal(insertedRevocations(pool).length, 0, 'старая ручка не имеет права гасить сессию старого клиента');
  assert.match(flat(pointsServiceSrc), /async switchPoint\(user: JwtPayload, pointId: string \| null\)/);
});
