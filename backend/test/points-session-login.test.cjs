const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ФИЛИАЛ — СВОЙСТВО СЕССИИ (миграция 163). Что охраняет этот тест:
 *
 *   1. ВХОД С ОДНИМ ДОСТУПНЫМ ФИЛИАЛОМ — как раньше: токен сразу, без выбора.
 *   2. ВХОД С НЕСКОЛЬКИМИ — список + КРАТКОЖИВУЩИЙ промежуточный токен, и
 *      НИКАКОГО полноценного токена: сессия без филиала снова рождала бы
 *      деньги, невидимые всем филиалам.
 *   3. СТАРЫЙ КЛИЕНТ (3.5/3.6) БЕЗ ПРИЗНАКА — входит по-старому, филиал
 *      подставляет сервер. Пустой экран у живого автосервиса недопустим.
 *   4. ПРОМЕЖУТОЧНЫЙ ТОКЕН не пускает в обычные ручки и ГИБНЕТ после обмена.
 *   5. СНЯТИЕ ДОСТУПА рвёт активную сессию в снятом филиале.
 *   6. АРХИВАЦИЯ ФИЛИАЛА рвёт сессии тенанта.
 *   7. ОДНОТОЧЕЧНЫЙ ТЕНАНТ не заметил вообще ничего.
 *   8. Филиал денежной записи = филиал сессии: отказа «Выберите филиал» на
 *      путях записи больше нет, второй копии правила доступа — тоже.
 *
 * Тесты ПОВЕДЕНЧЕСКИЕ там, где это возможно (сервисы поднимаются на
 * пуле-заглушке, как в points-main-service), и статические там, где проверяется
 * текст SQL или отсутствие мёртвой ветки: живой БД в CI нет.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-strategy-32-chars-min';

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const bcrypt = require('bcryptjs');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PointsService } = require('../dist/points/points.service');
const { POINT_SELECT_PURPOSE, POINT_SELECT_TTL_SECONDS } = require('../dist/auth/point-session');
const { ttlCache } = require('../dist/common/ttl-cache');

const migration163 = read('migrations/163_point_session_login.sql');
const pointScope = read('src/common/point-scope.ts');
const jwtStrategySrc = read('src/auth/jwt.strategy.ts');
const authServiceSrc = read('src/auth/auth.service.ts');
const pointsServiceSrc = read('src/points/points.service.ts');
const checksSrc = read('src/checks/checks.service.ts');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MAIN = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'Secret123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

/**
 * Пул-заглушка: маршрутизирует запрос по первому совпавшему шаблону. Журнал
 * запросов доступен для проверок «что именно ушло в базу».
 */
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
  return {
    calls,
    query: run,
    connect: async () => ({ query: run, release() {} }),
  };
}

/** JwtService-заглушка: токен = JSON. Позволяет заглянуть внутрь claims. */
function fakeJwt(overrides = {}) {
  return {
    sign(payload, opts) {
      return JSON.stringify({ ...payload, expiresIn: opts?.expiresIn ?? null, exp: Math.floor(Date.now() / 1000) + 600 });
    },
    decode(token) {
      try {
        return JSON.parse(token);
      } catch {
        return null;
      }
    },
    verify(token) {
      if (overrides.verifyThrows) throw new Error('jwt expired');
      return JSON.parse(token);
    },
  };
}

const userRow = (extra = {}) => ({
  password: HASH,
  id: USER,
  phone: '+79990000000',
  full_name: 'Мастер',
  role: 'master',
  role_id: null,
  role_matrix: null,
  is_active: true,
  dismissed_at: null,
  purged_at: null,
  tenant_id: TENANT,
  current_point_id: null,
  created_at: new Date().toISOString(),
  tenant_json: null,
  ...extra,
});

const pointRow = (id, name, isMain) => ({ id, name, address: null, is_main: isMain });

// ── 1. Вход с ОДНИМ доступным филиалом: как раньше ──────────────────────────

test('один доступный филиал — токен сразу, филиал уехал в токен', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    [/autexa_available_points/, [pointRow(MAIN, 'ZR AUTO', true)]],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD });

  assert.ok(res.token, 'клиент обязан получить токен без второго шага');
  assert.equal(JSON.parse(res.token).pointId, MAIN, 'филиал обязан лежать в токене — иначе сессия работает «везде»');
  assert.equal(res.user.currentPointId, MAIN, 'профиль обязан отдавать филиал ЭТОЙ сессии');
  assert.ok(
    pool.calls.some((c) => /UPDATE users SET current_point_id/.test(c.text)),
    'филиал не запомнен как «последний выбранный» — старый клиент при следующем входе попадёт не туда',
  );
});

// ── 2. Несколько филиалов + клиент умеет выбирать ───────────────────────────

test('несколько филиалов и новый клиент — список + промежуточный токен, БЕЗ токена сессии', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    [/autexa_available_points/, [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)]],
    [/autexa_default_point/, [{ point_id: MAIN }]],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD, supportsPointSelect: true });

  assert.equal(res.token, undefined, 'полноценный токен до выбора филиала = сессия без филиала = деньги в никуда');
  assert.equal(res.pointSelectionRequired, true);
  assert.equal(res.points.length, 2);
  assert.equal(res.points[0].isMain, true, 'основной сервис обязан идти первым');
  assert.equal(res.defaultPointId, MAIN);
  assert.equal(res.expiresIn, POINT_SELECT_TTL_SECONDS);

  const claims = JSON.parse(res.selectToken);
  assert.equal(claims.purpose, POINT_SELECT_PURPOSE, 'без назначения промежуточный токен = обычный токен без филиала');
  assert.equal(claims.expiresIn, POINT_SELECT_TTL_SECONDS, 'промежуточный токен обязан жить минуты, а не дни');
  assert.equal(claims.pointId, undefined, 'филиала в промежуточном токене быть не может — он ещё не выбран');
  assert.ok(
    !pool.calls.some((c) => /UPDATE users SET current_point_id/.test(c.text)),
    'шаг 1 ничего не выбирает и не должен ничего запоминать',
  );
});

// ── 3. Старый клиент (3.5/3.6) — вход по-старому ────────────────────────────

test('старый клиент без признака поддержки входит сразу: филиал подставляет сервер', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow({ current_point_id: BRANCH })]],
    [/autexa_available_points/, [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)]],
    [/autexa_default_point/, [{ point_id: BRANCH }]],
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD });

  assert.ok(res.token, 'старая сборка ждёт токен сразу — ответ без токена это пустой экран у живого автосервиса');
  assert.equal(res.pointSelectionRequired, undefined);
  assert.equal(
    JSON.parse(res.token).pointId,
    BRANCH,
    'подставлен обязан быть ПОСЛЕДНИЙ использованный филиал, а не первый попавшийся',
  );
});

// ── 4. Промежуточный токен: одноразовость и запрет обычных ручек ────────────

test('обмен промежуточного токена выдаёт сессию, ПОВТОРНЫЙ обмен — 401', async () => {
  let inserts = 0;
  const routes = [
    [/FROM users u/, [userRow()]],
    [/autexa_available_points/, [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)]],
    [
      /INSERT INTO revoked_tokens/,
      () => {
        inserts += 1;
        // ON CONFLICT DO NOTHING: линию выигрывает ровно один обмен.
        return { rows: [], rowCount: inserts === 1 ? 1 : 0 };
      },
    ],
    [/UPDATE users SET current_point_id/, []],
  ];
  const pool = fakePool(routes);
  const auth = new AuthService(pool, fakeJwt());
  const selectToken = JSON.stringify({ sub: USER, tenantId: TENANT, jti: 'jti-select', purpose: POINT_SELECT_PURPOSE });

  const ok = await auth.selectPoint({ selectToken, pointId: BRANCH });
  assert.equal(JSON.parse(ok.token).pointId, BRANCH, 'выбранный филиал обязан уехать в токен сессии');
  assert.equal(ok.user.currentPointId, BRANCH);

  await assert.rejects(
    () => auth.selectPoint({ selectToken, pointId: MAIN }),
    (err) => /уже использован/i.test(err?.response?.message ?? err?.message ?? ''),
    'повторный обмен обязан быть отбит: иначе один пароль даёт две сессии в разные филиалы',
  );
});

test('чужой филиал в шаге 2 не выдаёт токен', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    [/autexa_available_points/, [pointRow(MAIN, 'ZR AUTO', true)]],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const selectToken = JSON.stringify({ sub: USER, tenantId: TENANT, jti: 'jti-x', purpose: POINT_SELECT_PURPOSE });
  await assert.rejects(
    () => auth.selectPoint({ selectToken, pointId: BRANCH }),
    (err) => /недоступен/i.test(err?.response?.message ?? err?.message ?? ''),
    'подстановка чужого филиала в шаг 2 = законный токен в чужой автосервис',
  );
});

test('истёкший промежуточный токен — 401, а не 500', async () => {
  const pool = fakePool([]);
  const auth = new AuthService(pool, fakeJwt({ verifyThrows: true }));
  await assert.rejects(
    () => auth.selectPoint({ selectToken: 'whatever', pointId: MAIN }),
    (err) => err?.status === 401,
  );
});

test('промежуточный токен не пускают в обычные ручки', async () => {
  const strategy = new JwtStrategy(fakePool([]));
  await assert.rejects(
    () => strategy.validate({ sub: USER, jti: 'jti-select', purpose: POINT_SELECT_PURPOSE }),
    (err) => err?.status === 401,
    'иначе промежуточным токеном можно работать вообще без филиала',
  );
});

// ── 5–6. Живая сессия обесточивается: снятие доступа и архивация ────────────

test('снятый доступ к филиалу рвёт активную сессию (401 на следующем запросе)', async () => {
  const pool = fakePool([
    [/FROM revoked_tokens/, []],
    [
      /FROM users u LEFT JOIN roles r/,
      [
        {
          is_active: true,
          tenant_id: TENANT,
          role: 'master',
          dismissed_at: null,
          purged_at: null,
          role_matrix: null,
          point_allowed: false, // autexa_point_is_allowed: доступ снят / филиал в архиве
          default_point_id: null,
        },
      ],
    ],
  ]);
  const strategy = new JwtStrategy(pool);
  await assert.rejects(
    () => strategy.validate({ sub: USER, jti: 'jti-live-1', pointId: BRANCH }),
    (err) => err?.status === 401 && /Филиал больше не доступен/.test(err?.response?.message ?? ''),
    'сессия обязана умереть: иначе снятый сотрудник продолжает пробивать чеки чужого филиала',
  );
});

test('живой доступ — сессия работает, филиал берётся ИЗ ТОКЕНА', async () => {
  const pool = fakePool([
    [/FROM revoked_tokens/, []],
    [
      /FROM users u LEFT JOIN roles r/,
      [
        {
          is_active: true,
          tenant_id: TENANT,
          role: 'master',
          dismissed_at: null,
          purged_at: null,
          role_matrix: null,
          point_allowed: true,
          default_point_id: null,
        },
      ],
    ],
  ]);
  const strategy = new JwtStrategy(pool);
  const actor = await strategy.validate({ sub: USER, jti: 'jti-live-2', pointId: BRANCH });
  assert.equal(actor.currentPointId, BRANCH);
  const userQuery = pool.calls.find((c) => /FROM users u LEFT JOIN roles r/.test(c.text.replace(/\s+/g, ' ')));
  assert.equal(userQuery.params[1], BRANCH, 'филиал обязан приезжать параметром ИЗ ТОКЕНА, а не читаться из строки users');
  assert.ok(
    !/u\.current_point_id::text as current_point_id/.test(jwtStrategySrc),
    'филиал сессии снова читается из колонки пользователя — веб опять унаследует филиал телефона',
  );
});

test('снятие доступа сбрасывает auth-кеш затронутых сотрудников', async () => {
  const pool = fakePool([
    [/FROM tenant_points WHERE id=/, [{ id: BRANCH }]],
    [/SELECT user_id FROM user_points WHERE point_id=/, [{ user_id: USER }]],
    [/DELETE FROM user_points/, []],
    [/INSERT INTO user_points/, []],
  ]);
  const points = new PointsService(pool);
  const key = `auth:jwt:${USER}:jti-cached`;
  ttlCache.wrap(key, 30_000, async () => ({ cached: true }));
  await points.setMembers(TENANT, BRANCH, []); // сняли всех
  assert.equal(
    await ttlCache.wrap(key, 30_000, async () => ({ cached: false })).then((v) => v.cached),
    false,
    'кеш не сброшен — снятый сотрудник ещё до 30 секунд работает там, откуда его убрали',
  );
});

test('архивация филиала обесточивает сессии тенанта', async () => {
  const pool = fakePool([
    [/SELECT is_main FROM tenant_points/, [{ is_main: false }]],
    [/UPDATE tenant_points SET is_active=false/, [{ id: BRANCH }]],
    [/SELECT id FROM users WHERE tenant_id=/, [{ id: USER }]],
  ]);
  const points = new PointsService(pool);
  const key = `auth:jwt:${USER}:jti-archive`;
  await ttlCache.wrap(key, 30_000, async () => ({ cached: true }));
  await points.adminArchive(TENANT, BRANCH);
  assert.equal(
    await ttlCache.wrap(key, 30_000, async () => ({ cached: false })).then((v) => v.cached),
    false,
    'сессия в заархивированном филиале продолжила бы штамповать деньги в филиал, которого нет ни в одном срезе',
  );
});

// ── 7. Одноточечный тенант ──────────────────────────────────────────────────

test('одноточечный тенант: вход прежний, филиал сессии null, фильтра нет', async () => {
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    [/autexa_available_points/, []], // филиалов у тенанта нет вовсе
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD, supportsPointSelect: true });
  assert.ok(res.token, 'одноточечный автосервис не должен видеть выбора даже с новым клиентом');
  assert.equal(JSON.parse(res.token).pointId, null);
  assert.equal(res.user.currentPointId, null);
  assert.ok(
    !pool.calls.some((c) => /UPDATE users SET current_point_id/.test(c.text)),
    'подставлять и запоминать нечего — лишняя запись в users на каждый вход',
  );
});

test('филиал сессии подставляется сессии БЕЗ филиала в токене (старый токен / филиал завели после входа)', async () => {
  const pool = fakePool([
    [/FROM revoked_tokens/, []],
    [
      /FROM users u LEFT JOIN roles r/,
      [
        {
          is_active: true,
          tenant_id: TENANT,
          role: 'master',
          dismissed_at: null,
          purged_at: null,
          role_matrix: null,
          point_allowed: null,
          default_point_id: MAIN,
        },
      ],
    ],
  ]);
  const strategy = new JwtStrategy(pool);
  const actor = await strategy.validate({ sub: USER, jti: 'jti-legacy' });
  assert.equal(actor.currentPointId, MAIN, 'сессия без филиала на тенанте с филиалами снова писала бы деньги «в никуда»');
});

// ── 8. Правило одно, копий нет ──────────────────────────────────────────────

test('163 заводит ОДИН предикат доступа к филиалам и он идемпотентен', () => {
  for (const fn of ['autexa_available_points', 'autexa_point_is_allowed', 'autexa_default_point']) {
    assert.ok(
      new RegExp(`CREATE OR REPLACE FUNCTION\\s+${fn}`).test(migration163),
      `нет функции ${fn} — предикат доступа снова расползётся копиями по сервисам`,
    );
  }
  assert.ok(
    /NOT EXISTS \(SELECT 1 FROM mine\)/.test(migration163),
    'потеряна конвенция 156: сотрудник без назначений не ограничен — иначе тенант без настроек не сможет войти никуда',
  );
  assert.ok(
    /COALESCE\(a\.id = p_preferred, false\) DESC/.test(migration163),
    'последний выбранный филиал обязан выигрывать явно; NULL-порядок здесь молча меняет филиал по умолчанию',
  );
  assert.ok(
    /a\.id ASC/.test(migration163),
    'без id в хвосте порядка два одноимённых филиала дают разный ответ на разных репликах',
  );
  assert.ok(!/CONCURRENTLY/.test(migration163), 'CONCURRENTLY запрещён внутри транзакции миграции');
});

test('денежная запись больше не резолвит филиал и не отказывает «Выберите филиал»', () => {
  assert.ok(
    !/resolvePointForWrite\s*\(/.test(pointScope.replace(/\/\*[\s\S]*?\*\//g, '')),
    'резолв филиала вернулся в point-scope — это вторая копия правила и лишний запрос на каждую денежную строку',
  );
  const sources = [
    'src/checks/checks.service.ts',
    'src/expenses/expenses.service.ts',
    'src/salary/salary.service.ts',
    'src/shifts/shifts.service.ts',
    'src/cash-shifts/cash-shifts.service.ts',
    'src/equipment/equipment.service.ts',
    'src/stock-movements/stock-movements.service.ts',
    'src/products/products.service.ts',
  ];
  for (const file of sources) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(
      !/resolvePointForWrite/.test(code),
      `${file}: денежный путь снова резолвит филиал сам — филиал сессии единственный ответ`,
    );
    assert.ok(
      !/Выберите филиал/.test(code),
      `${file}: отказ «Выберите филиал» вернулся — при филиале в сессии спрашивать нечего`,
    );
  }
});

test('офлайн-очередь проверяет филиал общим предикатом, а не своей копией', () => {
  assert.ok(
    /autexa_point_is_allowed\(\$2::uuid, \$3::uuid, \$1::uuid\)/.test(checksSrc),
    'проверка филиала из payload офлайн-очереди снова написана вручную — копии расходятся молча',
  );
});

/**
 * СТАРАЯ СБОРКА ОБЯЗАНА МОЧЬ СМЕНИТЬ ФИЛИАЛ (165).
 *
 * 163 оставил POST /points/switch живым, но ВСЕГДА отвечающим 409, и
 * сознательно не писал users.current_point_id. Для сборок 3.5/3.6 это был
 * тупик: филиал им выбирает сервер (autexa_default_point = «последний
 * выбранный, иначе основной»), переключатель отказывает, а выход и вход
 * возвращают человека ровно туда же — подсказку менять нечем. Мастер,
 * вошедший не в тот автосервис, не мог попасть в нужный НИКАК.
 *
 * Теперь ручка делает РОВНО ОДНО: пишет подсказку следующего входа — и только
 * в тот филиал, где сотрудник вправе работать. Филиал ТЕКУЩЕЙ сессии не
 * меняется (он в подписанном токене), поэтому в ответе едет он, а не
 * запрошенный: соврать здесь = человек видит филиал Б, а чеки уходят в А.
 */
test('смена филиала старым клиентом пишет ТОЛЬКО подсказку следующего входа', () => {
  const body = pointsServiceSrc.slice(
    pointsServiceSrc.indexOf('async switchPoint('),
    pointsServiceSrc.indexOf('applyMembership'),
  );
  assert.ok(body.length > 0, 'ручка смены филиала исчезла — старый клиент получит 404 вместо объяснения');
  assert.ok(
    /autexa_point_is_allowed\(\$1::uuid, \$2::uuid, \$3::uuid\)/.test(body),
    'подсказка пишется без проверки доступа — это способ попасть при следующем входе в чужой автосервис',
  );
  assert.ok(
    /UPDATE users SET current_point_id=\$1 WHERE id=\$2 AND tenant_id=\$3/.test(body),
    'подсказка следующего входа не пишется — старый клиент снова заперт в одном филиале',
  );
  assert.ok(
    /return \{ currentPointId: actorPointId\(user\) \}/.test(body),
    'ответ обязан нести филиал ЭТОЙ сессии: запрошенный означал бы «вижу Б, пишу в А»',
  );
  assert.ok(
    /ConflictException/.test(body) && /Все автосервисы/.test(body),
    'режим «Все автосервисы» обязан отвечать отказом — такого режима больше нет',
  );
  // Ни одна другая колонка пользователя этой ручкой не правится.
  const updates = body.match(/UPDATE users SET [^`]*/g) ?? [];
  assert.equal(updates.length, 1, 'ручка трогает больше одной колонки пользователя');
});

test('GET /points ничего не пишет: филиал выдаётся входом, а не чтением', () => {
  const body = pointsServiceSrc.slice(
    pointsServiceSrc.indexOf('async listForTenant('),
    pointsServiceSrc.indexOf('async switchPoint('),
  );
  assert.ok(!/UPDATE users/.test(body), 'побочная запись на чтении — гонка двух устройств за филиал одного человека');
  assert.ok(/actorPointId\(user\)/.test(body), 'филиал обязан браться из сессии');
});

test('вход не отдаёт филиал из колонки пользователя', () => {
  assert.ok(
    /currentPointId: sessionPointId \?\? null/.test(authServiceSrc),
    'профиль снова отдаёт users.current_point_id — веб покажет филиал, выбранный в телефоне',
  );
  assert.ok(
    /async me\(actor: \{ userID: string; currentPointId\?: string \| null \}\)/.test(authServiceSrc),
    '/auth/me обязан отдавать филиал ЭТОЙ сессии',
  );
  assert.ok(
    /this\.generateToken\(user\.userID, tenantID, user\.currentPointId \?\? null\)/.test(authServiceSrc),
    'refresh обязан переносить филиал в новый токен — иначе продление молча меняет автосервис',
  );
});
