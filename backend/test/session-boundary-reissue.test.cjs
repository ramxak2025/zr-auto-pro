const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ГРАНИЦА «ПАРОЛЬ ИЗМЕНЁН» В РУЧКАХ ПЕРЕВЫПУСКА ТОКЕНА (ревизия 2026-09).
 *
 * СЦЕНАРИЙ, РАДИ КОТОРОГО ТЕСТ НАПИСАН. У владельца увели телефон вместе с
 * живой сессией. Владелец меняет пароль — users.sessions_valid_from получает
 * момент смены (165), и ВСЕ ранее выданные токены обязаны умереть. Проверка
 * границы стояла только в JwtStrategy, а её результат кешируется на 30 секунд,
 * причём кеш ВНУТРИПРОЦЕССНЫЙ — в docker-compose реплик backend несколько, у
 * каждой свой. В этом окне вор успевал дёрнуть /auth/switch-point или
 * /auth/refresh: обе ручки ходили в базу мимо кеша (живая проверка «уволен /
 * деактивирован / удалён»), но границу НЕ сверяли — и выдавали СВЕЖИЙ
 * 30-дневный токен, выписанный уже ПОСЛЕ смены пароля. Дальше вор живёт в
 * системе законно: новый токен границу проходит, потому что моложе неё.
 * Смена пароля переставала выгонять кого бы то ни было.
 *
 * ЧТО ОХРАНЯЕТ ТЕСТ:
 *   1. Токен, выписанный ДО смены пароля, не продлевает сессию.
 *   2. Он же не переключает филиал — включая безобидную с виду ветку «я уже в
 *      этом филиале», где ручка отдаёт профиль и тот же токен.
 *   3. Отказ приходит ДО атомарного claim'а: живую линию токенов отказ не
 *      трогает.
 *   4. Токен, выписанный ПОСЛЕ смены пароля, работает в обеих ручках.
 *   5. Границы нет (пароль не меняли ни разу) — обе ручки работают как раньше;
 *      одноточечный тенант не затронут.
 *   6. Токен без claim `iat` при выставленной границе — стухший (fail-closed):
 *      проверить его возраст нечем.
 *   7. Редакция правила ОДНА на весь backend, сравнение считает база.
 *
 * Тесты поведенческие на пуле-заглушке (как points-instant-switch): живой БД в
 * CI нет, поэтому предикат границы моделируется ровно тем же выражением, что
 * стоит в SQL.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-strategy-32-chars-min';

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');
/** Пробелы нечувствительны к переносам: prettier волен переносить строки. */
const flat = (source) => source.replace(/\s+/g, ' ');

const { AuthService } = require('../dist/auth/auth.service');

const authServiceSrc = read('src/auth/auth.service.ts');
const jwtStrategySrc = read('src/auth/jwt.strategy.ts');
const sessionBoundarySrc = read('src/auth/session-boundary.ts');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MAIN = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';

const NOW = Math.floor(Date.now() / 1000);
/** Пароль сменили минуту назад. */
const PASSWORD_CHANGED_AT = NOW - 60;
/** Токен вора: выписан час назад, ДО смены пароля. */
const IAT_BEFORE = NOW - 3600;
/** Токен хозяина: выписан после смены пароля. */
const IAT_AFTER = NOW - 10;

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
        iat: NOW,
        exp: NOW + 86400,
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

const bearer = (extra = {}) =>
  JSON.stringify({
    sub: USER,
    tenantId: TENANT,
    jti: 'jti-live',
    pointId: MAIN,
    iat: IAT_AFTER,
    exp: NOW + 86400,
    ...extra,
  });

const actorIn = (pointId = MAIN, jti = 'jti-live') => ({
  userID: USER,
  tenantID: TENANT,
  currentPointId: pointId,
  jti,
});

const baseRow = (extra = {}) => ({
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
 * Строка пользователя + `session_stale`, посчитанный РОВНО тем выражением, что
 * стоит в SQL (auth/session-boundary.ts): граница выставлена И (iat не пришёл
 * ИЛИ iat раньше границы). `validFrom` = null — граница не выставлена.
 *
 * Обе ручки передают `iat` вторым параметром — на этом и держится модель.
 */
const usersRoute = (validFrom, extra = {}) => [
  /FROM users u/,
  (params) => {
    const iat = params[1] ?? null;
    const stale = validFrom !== null && (iat === null || iat < validFrom);
    return [baseRow({ session_stale: stale, ...extra })];
  },
];

const gateRoute = (canManage = true, allowed = [MAIN, BRANCH]) => [
  /autexa_can_manage_staff/,
  (params) => [{ can_manage: canManage, point_allowed: allowed.includes(params[2]) }],
];

const revokeRoute = [/INSERT INTO revoked_tokens/, { rows: [], rowCount: 1 }];
const rememberRoute = [/UPDATE users SET current_point_id/, []];

const insertedRevocations = (pool) => pool.calls.filter((c) => /INSERT INTO revoked_tokens/.test(c.text));
const rememberedPoints = (pool) => pool.calls.filter((c) => /UPDATE users SET current_point_id/.test(c.text));
const isStaleRejection = (err) =>
  err?.status === 401 && /Пароль изменён — войдите заново/.test(err?.response?.message ?? '');

// ── 1. Токен, выписанный ДО смены пароля, не продлевает сессию ───────────────

test('украденный токен не продлевает сессию после смены пароля', async () => {
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.refresh(actorIn(), bearer({ iat: IAT_BEFORE })),
    isStaleRejection,
    'иначе вор в окне auth-кеша меняет краденый токен на свежий — выписанный уже ПОСЛЕ смены пароля',
  );

  assert.equal(
    insertedRevocations(pool).length,
    0,
    'отказ обязан случиться ДО атомарного claim: иначе он гасит линию токенов заодно',
  );
});

// ── 2. Тот же токен не переключает филиал ───────────────────────────────────

test('украденный токен не переключает филиал после смены пароля', async () => {
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT), gateRoute(true), revokeRoute, rememberRoute]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(MAIN), bearer({ iat: IAT_BEFORE }), { pointId: BRANCH }),
    isStaleRejection,
    'смена филиала — такой же перевыпуск сессии, как продление: краденый токен обязан упереться в границу',
  );

  assert.equal(insertedRevocations(pool).length, 0, 'отказ не имеет права гасить чужую живую линию токенов');
  assert.equal(rememberedPoints(pool).length, 0, 'отказ не имеет права менять даже подсказку следующего входа');
  assert.equal(
    pool.calls.filter((c) => /autexa_can_manage_staff/.test(c.text)).length,
    0,
    'стухшую сессию нет смысла спрашивать о правах — она уже мертва',
  );
});

test('ветка «я уже в этом филиале» тоже не пускает стухшую сессию', async () => {
  // Ветка ничего не выпускает и ничего не гасит, поэтому выглядит безобидной.
  // Но она отдаёт ПРОФИЛЬ и подтверждает токен как рабочий — вору этого
  // достаточно, чтобы убедиться, что он всё ещё внутри.
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT, { current_point_id: BRANCH }), gateRoute(true), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.switchPoint(actorIn(BRANCH), bearer({ iat: IAT_BEFORE, pointId: BRANCH }), { pointId: BRANCH }),
    isStaleRejection,
    'после смены пароля ручка не имеет права отвечать 200 ни в одной ветке',
  );
});

// ── 3. Токен, выписанный ПОСЛЕ смены пароля, работает ───────────────────────

test('свежий токен владельца продлевается и после смены пароля', async () => {
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  const res = await auth.refresh(actorIn(), bearer({ iat: IAT_AFTER }));

  assert.ok(res.token, 'владелец, только что сменивший пароль, обязан продолжать работать');
  assert.equal(JSON.parse(res.token).pointId, MAIN, 'филиал обязан переехать в новый токен');
  assert.equal(insertedRevocations(pool).length, 1, 'обмен 1:1 обязан остаться обменом');
});

test('свежий токен владельца переключает филиал и после смены пароля', async () => {
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT), gateRoute(true), revokeRoute, rememberRoute]);
  const auth = new AuthService(pool, fakeJwt());

  const res = await auth.switchPoint(actorIn(MAIN), bearer({ iat: IAT_AFTER }), { pointId: BRANCH });

  assert.equal(res.switched, true);
  assert.equal(res.currentPointId, BRANCH);
  assert.equal(JSON.parse(res.token).pointId, BRANCH);
});

// ── 4. Границы нет — ничего не меняется ─────────────────────────────────────

test('пользователь, никогда не менявший пароль, продлевает сессию как раньше', async () => {
  const pool = fakePool([usersRoute(null), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  // Токен сколь угодно старый: границы нет — значит и стухнуть не от чего.
  const res = await auth.refresh(actorIn(), bearer({ iat: IAT_BEFORE }));
  assert.ok(res.token, 'пустая граница обязана оставаться пустой: иначе миграция разлогинит весь прод');
});

test('пользователь, никогда не менявший пароль, переключает филиал как раньше', async () => {
  const pool = fakePool([usersRoute(null), gateRoute(true), revokeRoute, rememberRoute]);
  const auth = new AuthService(pool, fakeJwt());

  const res = await auth.switchPoint(actorIn(MAIN), bearer({ iat: IAT_BEFORE }), { pointId: BRANCH });
  assert.equal(res.switched, true);
  assert.equal(res.currentPointId, BRANCH);
});

test('одноточечный тенант не затронут: границы нет, филиала в токене нет', async () => {
  const pool = fakePool([usersRoute(null, { current_point_id: null }), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  const res = await auth.refresh({ ...actorIn(null), currentPointId: null }, bearer({ pointId: undefined, iat: NOW }));
  assert.ok(res.token);
  assert.equal(JSON.parse(res.token).pointId, null, 'у тенанта без филиалов сессия остаётся ровно такой, какой была');
});

// ── 5. Токен без iat при выставленной границе — стухший (fail-closed) ───────

test('токен без claim iat при выставленной границе не перевыпускается', async () => {
  const pool = fakePool([usersRoute(PASSWORD_CHANGED_AT), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());

  await assert.rejects(
    () => auth.refresh(actorIn(), bearer({ iat: undefined })),
    isStaleRejection,
    'возраст такого токена проверить нечем — fail-closed',
  );

  const userQuery = pool.calls.find((c) => /FROM users u/.test(c.text));
  assert.equal(userQuery.params[1], null, 'в базу обязан уезжать явный NULL, а не undefined или дата с часов Node');
});

test('токен без claim iat при пустой границе проходит', async () => {
  const pool = fakePool([usersRoute(null), revokeRoute]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.refresh(actorIn(), bearer({ iat: undefined }));
  assert.ok(res.token, 'сессии, выданные до появления claim iat, не должны падать у тенанта без смены пароля');
});

// ── 6. Правило одно, сравнение считает база ─────────────────────────────────

test('обе ручки подставляют ОБЩЕЕ выражение границы, а не свою копию', () => {
  const src = flat(authServiceSrc);
  assert.match(
    src,
    /import \{ SESSION_STALE_MESSAGE, sessionStaleSql, tokenIatOf \} from '\.\/session-boundary';/,
    'сервис перестал брать границу из общего файла',
  );
  assert.equal(
    (src.match(/\$\{sessionStaleSql\('\$2'\)\}/g) || []).length,
    2,
    'выражение границы обязано стоять РОВНО в двух ручках перевыпуска: refresh и switchPoint',
  );
  assert.match(flat(jwtStrategySrc), /\$\{sessionStaleSql\('\$3'\)\}/, 'стратегия обязана брать то же выражение');
  assert.doesNotMatch(
    authServiceSrc,
    /to_timestamp\(/,
    'в сервисе завелась вторая копия SQL границы — копии разъедутся, и одна из них станет дырой',
  );
  assert.doesNotMatch(
    authServiceSrc,
    /sessions_valid_from/,
    'колонку границы читает общее выражение, а не сервис',
  );
  // Сравнение — в базе: часы Node и Postgres расходиться не обязаны.
  assert.doesNotMatch(authServiceSrc, /session_stale[\s\S]{0,80}Date\.now\(\)/);
});

test('граница проверяется ДО атомарного claim — отказ не гасит живую линию', () => {
  const refreshBody = authServiceSrc.slice(
    authServiceSrc.indexOf('async refresh('),
    authServiceSrc.indexOf('async isTokenRevoked('),
  );
  const switchBody = authServiceSrc.slice(
    authServiceSrc.indexOf('async switchPoint('),
    authServiceSrc.indexOf('async register('),
  );

  for (const [name, body] of [
    ['refresh', refreshBody],
    ['switchPoint', switchBody],
  ]) {
    const stale = body.indexOf('session_stale === true');
    const claim = body.indexOf('this.blacklistToken(');
    assert.ok(stale > 0, `${name}: проверка границы пропала — смена пароля снова не выгоняет вора`);
    assert.ok(claim > 0, `${name}: claim обмена пропал`);
    assert.ok(stale < claim, `${name}: отказ по границе гасит линию токенов вместо того, чтобы её не трогать`);
    assert.ok(
      /SESSION_STALE_MESSAGE/.test(body),
      `${name}: человеку обязан приходить тот же понятный текст, что и от стратегии`,
    );
  }
});

test('текст отказа один на весь монорепо и объясняет, что делать', () => {
  assert.match(
    flat(sessionBoundarySrc),
    /export const SESSION_STALE_MESSAGE = 'Пароль изменён — войдите заново';/,
    'отказ обязан называть причину и следующий шаг, а не выглядеть поломкой',
  );
  assert.match(
    flat(sessionBoundarySrc),
    /export function sessionStaleSql\(iatParam: string, userAlias = 'u'\): string/,
    'выражение границы обязано оставаться параметризуемым — иначе его не переиспользовать',
  );
});
