const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ТРИ ПОСЛЕДСТВИЯ 165, ЗАКРЫТЫЕ ВОЛНОЙ 166. Что охраняет этот тест:
 *
 *   1. ВЛАДЕЛЕЦ НЕ МОЖЕТ ЗАПЕРЕТЬ САМ СЕБЯ. 165 развела «доступ не настроен»
 *      и «доступ настроен, но филиал закрыт» — и вторая ветка стала тупиком:
 *      владелец, назначивший себя только на филиал, после его архивации не мог
 *      войти НИКУДА, в том числе чтобы исправить собственные назначения.
 *      Держатель права управления персоналом попадает в основной сервис.
 *   2. ЭСКАЛАЦИЯ ОСТАЁТСЯ ЗАКРЫТОЙ. Обычный сотрудник в той же ситуации
 *      по-прежнему получает отказ — пускать его в основной сервис нельзя,
 *      там деньги всей сети.
 *   3. БЕЗОПАСНЫЙ ДЕФОЛТ ВНЕДРЕНИЯ НЕ ТРОНУТ. Сотрудник без единой строки
 *      user_points работает как раньше: доступны все живые филиалы.
 *   4. «ПРИБЫЛЬ ЗА МЕСЯЦ» ОДНА. Карточка филиала считает её тем же составом
 *      термов, что главная: прибыль по чекам − расходы − премии − мотивация.
 *   5. СУММА КАРТОЧЕК = ИТОГ ТЕНАНТА. Деньги заархивированного филиала
 *      остаются в итогах сети, поэтому его карточка остаётся в сводке —
 *      помеченной как закрытая, а не молча выброшенной.
 *
 * Тесты поведенческие там, где сервис можно поднять на пуле-заглушке
 * (конвенция points-session-login / points-main-service), и статические там,
 * где проверяется текст SQL: живой БД в CI нет. Правило доступа из миграции
 * 166 повторено в тесте МОДЕЛЬЮ, и модель сверяется с текстом самой миграции —
 * иначе заглушка проверяла бы саму себя.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-strategy-32-chars-min';

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const bcrypt = require('bcryptjs');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PointsService } = require('../dist/points/points.service');
const { ttlCache } = require('../dist/common/ttl-cache');

const migration166 = read('migrations/166_no_manager_lockout.sql');
const migration165 = read('migrations/165_access_hardening.sql');
const authServiceSrc = read('src/auth/auth.service.ts');
const jwtStrategySrc = read('src/auth/jwt.strategy.ts');
const pointsSrc = read('src/points/points.service.ts');
const reportsSrc = read('src/reports/reports.service.ts');
const salaryExtrasSrc = read('src/common/salary-extras-sql.ts');
const permissionsGuardSrc = read('src/common/guards/permissions.guard.ts');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MAIN = '33333333-3333-4333-8333-333333333333';
const BRANCH = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'Secret123';
const HASH = bcrypt.hashSync(PASSWORD, 4);

/** Пул-заглушка: маршрутизирует запрос по первому совпавшему шаблону. */
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

/** JwtService-заглушка: токен = JSON, чтобы заглянуть внутрь claims. */
const fakeJwt = () => ({
  sign: (payload, opts) => JSON.stringify({ ...payload, expiresIn: opts?.expiresIn ?? null }),
  decode: (t) => JSON.parse(t),
  verify: (t) => JSON.parse(t),
});

const userRow = (extra = {}) => ({
  password: HASH,
  id: USER,
  phone: '+79990000000',
  full_name: 'Сотрудник',
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

const pointRow = (id, name, isMain, sortOrder) => ({
  id,
  name,
  address: null,
  is_main: isMain,
  sort_order: sortOrder ?? (isMain ? 0 : 1),
});

// ─────────────────────────────────────────────────────────────────────────────
// МОДЕЛЬ ПРАВИЛА ДОСТУПА (миграция 166) — ОДНА на весь файл
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Дословное повторение autexa_available_points из 166. Три ветки:
 *   1. есть назначения на живые филиалы → только они;
 *   2. НЕТ НИ ОДНОЙ строки user_points → все живые (дефолт внедрения 156/163);
 *   3. назначения есть, живых среди них нет:
 *        • держатель user_management → РОВНО основной сервис;
 *        • остальные                 → пусто (отказ на входе).
 * Порядок ветки 3 — тот же, что у autexa_default_point.
 */
function availablePointsModel({ livePoints, assignedPointIds, canManageStaff }) {
  const mine = livePoints.filter((p) => assignedPointIds.includes(p.id));
  if (mine.length > 0) return mine;
  if (assignedPointIds.length === 0) return livePoints;
  if (!canManageStaff) return [];
  return [...livePoints]
    .sort(
      (a, b) =>
        Number(b.is_main) - Number(a.is_main) ||
        a.sort_order - b.sort_order ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 1);
}

/** Роуты пула, отвечающие «как база» на все три функции доступа. */
function accessRoutes(state) {
  const available = () => availablePointsModel(state);
  return [
    [/autexa_available_points/, () => available()],
    [/autexa_default_point/, () => [{ point_id: available()[0]?.id ?? null }]],
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. МОДЕЛЬ СВЕРЕНА С ТЕКСТОМ МИГРАЦИИ
// ─────────────────────────────────────────────────────────────────────────────

test('166: все три ветки правила доступа физически присутствуют в SQL', () => {
  // Ветка 1 — назначенные живые филиалы.
  assert.ok(
    /mine AS \(\s*SELECT l\.\* FROM live l\s*WHERE EXISTS \(/.test(migration166),
    '166: пропала ветка «назначенные живые филиалы» — сотрудник потеряет доступ к своему филиалу',
  );
  // Ветка 2 — «доступ НЕ настроен» (ни одной строки user_points). Именно она
  // сохраняет одноточечным и несконфигурированным тенантам прежнее поведение.
  assert.ok(
    /assigned AS \([\s\S]*?SELECT EXISTS \(\s*SELECT 1 FROM user_points up\s*WHERE up\.user_id = p_user\s*AND up\.tenant_id = p_tenant\s*\) AS any_row/.test(
      migration166,
    ),
    '166: признак «есть ли назначения вообще» пропал — вернулась формулировка 165-до, и архивация снова раздаёт сеть',
  );
  assert.ok(
    /SELECT \* FROM live\s*WHERE NOT \(SELECT any_row FROM assigned\)/.test(migration166),
    '166: пропал безопасный дефолт внедрения — тенант, который никого не назначал, останется без доступа',
  );
  // Ветка 3 — выход из тупика для держателя user_management, и ТОЛЬКО одна точка.
  assert.ok(
    /WHERE \(SELECT any_row FROM assigned\)\s*AND NOT EXISTS \(SELECT 1 FROM mine\)\s*AND autexa_can_manage_staff\(p_user\)/.test(
      migration166,
    ),
    '166: ветка «назначения есть, живых нет» либо пропала, либо перестала требовать право управления персоналом — это ровно та эскалация, которую закрыла 165',
  );
  assert.ok(
    /ORDER BY l\.is_main DESC, l\.sort_order ASC, lower\(l\.name\) ASC, l\.id ASC\s*LIMIT 1/.test(migration166),
    '166: выход из тупика перестал быть ОДНОЙ точкой — держатель прав получает всю сеть вместо основного сервиса',
  );
  // 165 закрыла эскалацию — её формулировка обязана остаться в силе.
  assert.ok(
    /NOT EXISTS \(\s*SELECT 1 FROM user_points up\s*WHERE up\.user_id = p_user/.test(migration165),
    '165: исходная формулировка «доступ не настроен» изменилась — проверь, не разъехались ли миграции',
  );
});

test('166: право управления персоналом читается тем же правилом, что в guard', () => {
  // Зеркало userHasPermission(actor, 'user_management'): owner-class роли,
  // затем матрица роли (employees.manage), затем дефолт админа без матрицы.
  assert.ok(
    /WHEN u\.role IN \('director', 'superadmin'\)\s*THEN true/.test(migration166),
    '166: owner-class роли перестали быть держателями права — владелец снова запирается',
  );
  assert.ok(
    /\(r\.matrix -> 'employees' ->> 'manage'\) = 'true'/.test(migration166),
    '166: матрица роли больше не авторитетна — админ сети с включённой ячейкой запирается, а с выключенной получает лишний доступ',
  );
  assert.ok(
    /WHEN u\.role = 'admin'\s*THEN true/.test(migration166),
    '166: админ без матрицы (role_id NULL) заперт — это зеркало ADMIN_PERMISSION_DEFAULTS.user_management',
  );
  assert.ok(
    !/->> 'manage'\)\s*::boolean/.test(migration166),
    '166: приведение ячейки к boolean уронит КАЖДЫЙ auth-запрос на мусоре в ней — сравнение обязано быть строковым',
  );
  // Источник правды на стороне приложения не должен был поменяться.
  assert.ok(
    /const OWNER_CLASS_ROLES = new Set\(\['superadmin', 'director'\]\)/.test(permissionsGuardSrc),
    'состав owner-class ролей изменился — зеркало в миграции 166 устарело',
  );
  assert.ok(
    /user_management: true,/.test(permissionsGuardSrc),
    'ADMIN_PERMISSION_DEFAULTS.user_management больше не true — зеркало в миграции 166 устарело',
  );
});

test('правило доступа существует в ОДНОМ экземпляре — копий в коде нет', () => {
  // Ни login, ни JwtStrategy не имеют права решать «а он вообще начальник?»:
  // разъехавшиеся копии = либо запертый владелец, либо чужая касса нараспашку.
  for (const [name, src] of [
    ['auth.service', authServiceSrc],
    ['jwt.strategy', jwtStrategySrc],
  ]) {
    assert.ok(
      !/userHasPermission\([^)]*'user_management'/.test(src),
      `${name}: появилась вторая копия правила «кому доступен основной сервис» — она неминуемо отстанет от SQL-функции`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ВЛАДЕЛЕЦ С ЕДИНСТВЕННЫМ АРХИВНЫМ НАЗНАЧЕНИЕМ — ВХОДИТ
// ─────────────────────────────────────────────────────────────────────────────

test('владелец, назначенный только на закрытый филиал, входит в основной сервис', async () => {
  // Основной сервис жив, филиал заархивирован → в live его нет. Назначение
  // владельца при этом осталось — оно указывает на закрытый филиал.
  const state = {
    livePoints: [pointRow(MAIN, 'ZR AUTO', true)],
    assignedPointIds: [BRANCH],
    canManageStaff: true,
  };
  const pool = fakePool([
    [/FROM users u/, [userRow({ role: 'director' })]],
    ...accessRoutes(state),
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD, supportsPointSelect: true });

  assert.ok(res.token, 'владелец обязан получить токен — иначе некому починить его же назначения');
  assert.equal(
    JSON.parse(res.token).pointId,
    MAIN,
    'владелец обязан попасть в ОСНОВНОЙ сервис, а не в сессию без филиала',
  );
  assert.ok(
    !pool.calls.some((c) => /EXISTS\(SELECT 1 FROM tenant_points WHERE tenant_id=\$1 AND is_active\)/.test(c.text)),
    'до ветки отказа дело дойти не должно: список филиалов у держателя прав непустой',
  );
});

test('админ сети с правом управления персоналом — тоже не запирается', async () => {
  const state = {
    livePoints: [pointRow(MAIN, 'ZR AUTO', true)],
    assignedPointIds: [BRANCH],
    canManageStaff: true, // матрица роли: employees.manage = true
  };
  const pool = fakePool([
    [/FROM users u/, [userRow({ role: 'admin' })]],
    ...accessRoutes(state),
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD });
  assert.equal(JSON.parse(res.token).pointId, MAIN);
});

test('живая сессия владельца без филиала в токене получает основной сервис, а не 401', async () => {
  // Токен выписан до 163 либо филиал в нём уже заархивирован и клиент вошёл
  // заново: филиал подставляет сервер через autexa_default_point.
  const pool = fakePool([
    [/FROM revoked_tokens/, []],
    [
      /FROM users u LEFT JOIN roles r/,
      [
        {
          is_active: true,
          tenant_id: TENANT,
          role: 'director',
          dismissed_at: null,
          purged_at: null,
          role_matrix: null,
          session_stale: false,
          tenant_has_points: true,
          point_allowed: null,
          default_point_id: MAIN, // ← ветка 3 модели: основной сервис
        },
      ],
    ],
  ]);
  const actor = await new JwtStrategy(pool).validate({ sub: USER, jti: 'jti-owner-1' });
  assert.equal(
    actor.currentPointId,
    MAIN,
    'сессия владельца обязана получить основной сервис — иначе каждый её запрос отвечает «войдите заново» в бесконечном цикле',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ОБЫЧНЫЙ СОТРУДНИК В ТОЙ ЖЕ СИТУАЦИИ — ОТКАЗ
// ─────────────────────────────────────────────────────────────────────────────

test('мастер, назначенный только на закрытый филиал, получает понятный отказ', async () => {
  const state = {
    livePoints: [pointRow(MAIN, 'ZR AUTO', true)],
    assignedPointIds: [BRANCH],
    canManageStaff: false,
  };
  const pool = fakePool([
    [/FROM users u/, [userRow({ role: 'master' })]],
    ...accessRoutes(state),
    [/EXISTS\(SELECT 1 FROM tenant_points WHERE tenant_id=\$1 AND is_active\)/, [{ has_points: true }]],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  await assert.rejects(
    () => auth.login({ phone: '+79990000000', password: PASSWORD, supportsPointSelect: true }),
    (err) =>
      err?.status === 403 && /не назначен ни один действующий филиал[\s\S]*руководител/i.test(err?.response?.message ?? ''),
    'мастеру закрытие филиала обязано ОТНИМАТЬ доступ, а не выдавать новый — в основном сервисе деньги всей сети',
  );
});

test('живая сессия мастера без доступного филиала умирает (401), а не работает без филиала', async () => {
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
          session_stale: false,
          tenant_has_points: true,
          point_allowed: null,
          default_point_id: null, // ← ветка 3 модели: пусто
        },
      ],
    ],
  ]);
  await assert.rejects(
    () => new JwtStrategy(pool).validate({ sub: USER, jti: 'jti-master-1' }),
    (err) => err?.status === 401 && /не назначен ни один действующий филиал/i.test(err?.response?.message ?? ''),
    'сессия без филиала у тенанта С филиалами штампует деньги с point_id = NULL — они невидимы в КАЖДОМ срезе',
  );
});

test('МОДЕЛЬ: закрытие филиала отнимает доступ у сотрудника и не отнимает у начальника', () => {
  const live = [pointRow(MAIN, 'ZR AUTO', true)];
  assert.deepEqual(
    availablePointsModel({ livePoints: live, assignedPointIds: [BRANCH], canManageStaff: false }),
    [],
    'сотрудник с единственным закрытым назначением обязан получить пустой список',
  );
  assert.deepEqual(
    availablePointsModel({ livePoints: live, assignedPointIds: [BRANCH], canManageStaff: true }).map((p) => p.id),
    [MAIN],
    'начальник обязан получить основной сервис — и ровно его одного',
  );
  // Начальник, у которого ОСТАЛСЯ живой филиал, в основной сервис не попадает:
  // выход из тупика не должен превращаться в постоянную прибавку доступа.
  const both = [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)];
  assert.deepEqual(
    availablePointsModel({ livePoints: both, assignedPointIds: [BRANCH], canManageStaff: true }).map((p) => p.id),
    [BRANCH],
    'пока живое назначение есть, начальник работает только в нём',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. СОТРУДНИК БЕЗ ЕДИНОГО НАЗНАЧЕНИЯ — КАК РАНЬШЕ
// ─────────────────────────────────────────────────────────────────────────────

test('сотрудник без единой строки user_points видит все живые филиалы (дефолт внедрения)', async () => {
  const state = {
    livePoints: [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)],
    assignedPointIds: [],
    canManageStaff: false,
  };
  const pool = fakePool([[/FROM users u/, [userRow()]], ...accessRoutes(state)]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD, supportsPointSelect: true });

  assert.equal(res.pointSelectionRequired, true, 'два доступных филиала — выбор обязан остаться');
  assert.deepEqual(res.points.map((p) => p.id).sort(), [MAIN, BRANCH].sort());
});

test('одноточечный автосервис не заметил волны вообще', async () => {
  const state = {
    livePoints: [pointRow(MAIN, 'ZR AUTO', true)],
    assignedPointIds: [],
    canManageStaff: false,
  };
  const pool = fakePool([
    [/FROM users u/, [userRow()]],
    ...accessRoutes(state),
    [/UPDATE users SET current_point_id/, []],
  ]);
  const auth = new AuthService(pool, fakeJwt());
  const res = await auth.login({ phone: '+79990000000', password: PASSWORD });
  assert.equal(JSON.parse(res.token).pointId, MAIN, 'единственная точка — вход молча, без выбора');
});

test('МОДЕЛЬ: отсутствие назначений и назначение на закрытый филиал — РАЗНЫЕ состояния', () => {
  const live = [pointRow(MAIN, 'ZR AUTO', true), pointRow(BRANCH, 'ТопГаз', false)];
  assert.equal(
    availablePointsModel({ livePoints: live, assignedPointIds: [], canManageStaff: false }).length,
    2,
    '«доступ не настроен» обязан открывать все живые филиалы — иначе внедрение прячет всю команду',
  );
  assert.equal(
    availablePointsModel({ livePoints: [live[0]], assignedPointIds: ['ghost'], canManageStaff: false }).length,
    0,
    'смешение двух состояний и есть та эскалация, которую закрыла 165',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. «ПРИБЫЛЬ ЗА МЕСЯЦ» НА КАРТОЧКЕ ФИЛИАЛА = ПРИБЫЛЬ НА ГЛАВНОЙ
// ─────────────────────────────────────────────────────────────────────────────

/** Роуты пула под PointsService.computeSummary. Суммы задаёт вызывающий. */
function summaryRoutes({ checkRows, expenses = [], premiums = [], motivation = [] }) {
  return [
    [/SELECT timezone FROM tenants/, [{ timezone: 'Europe/Moscow' }]],
    [/SELECT shifts_enabled FROM tenants/, [{ shifts_enabled: false }]],
    [/FROM expenses e LEFT JOIN expense_categories/, expenses],
    [/FROM salary_premiums sp/, premiums],
    [/FROM motivation_accruals ma/, motivation],
    [/FROM tenant_points p LEFT JOIN checks ch/, checkRows],
  ];
}

const checkAggRow = (id, name, isMain, isActive, profitMonth, revenueMonth) => ({
  id,
  name,
  is_main: isMain,
  is_active: isActive,
  revenue_today: '0',
  revenue_month: String(revenueMonth),
  profit_month: String(profitMonth),
  checks_today: '0',
  checks_month: '1',
});

const director = { userID: USER, tenantID: TENANT, role: 'director', permissions: {} };

/** Кеш сводки общий на тенанта — между сценариями его обязательно чистим. */
const freshSummary = async (pool) => {
  ttlCache.invalidatePrefix('reports:');
  ttlCache.invalidatePrefix('tenant-tz:');
  return new PointsService(pool).summaryForTenant(director);
};

test('карточка филиала вычитает расходы, премии и мотивацию — как netProfitMonth на главной', async () => {
  // Одни и те же данные, поданные обоим экранам: прибыль по чекам 100 000,
  // расходы филиала 30 000, премия деньгами 9 000, мотивация 2 000.
  const pool = fakePool(
    summaryRoutes({
      checkRows: [checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000)],
      expenses: [{ point_id: MAIN, total: '30000' }],
      premiums: [{ point_id: MAIN, total: '9000' }],
      motivation: [{ point_id: MAIN, total: '2000' }],
    }),
  );
  const summary = await freshSummary(pool);

  // Формула главной (reports.computeDashboardV2): profitMonth − expMonth −
  // salaryExtras.month. Составляем её из ТЕХ ЖЕ слагаемых.
  const dashboardNetProfitMonth = 100000 - 30000 - (9000 + 2000);
  assert.equal(
    summary.points[0].profitMonth,
    dashboardNetProfitMonth,
    'карточка филиала и главная снова показывают разные числа под названием «Прибыль за месяц»',
  );
  assert.equal(summary.points[0].profitMonth, 59000);
});

test('премии и мотивация филиала не вычитаются из соседнего', async () => {
  const pool = fakePool(
    summaryRoutes({
      checkRows: [
        checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000),
        checkAggRow(BRANCH, 'ТопГаз', false, true, 50000, 120000),
      ],
      expenses: [{ point_id: BRANCH, total: '10000' }],
      premiums: [{ point_id: BRANCH, total: '5000' }],
      motivation: [{ point_id: MAIN, total: '1000' }],
    }),
  );
  const summary = await freshSummary(pool);
  const byId = new Map(summary.points.map((p) => [p.pointId, p]));
  assert.equal(byId.get(MAIN).profitMonth, 100000 - 1000, 'в основной сервис утекли премии филиала');
  assert.equal(byId.get(BRANCH).profitMonth, 50000 - 10000 - 5000, 'филиал недосчитался своих премий');
});

test('без profit_view прибыль обнуляется и в карточке закрытого филиала', async () => {
  const pool = fakePool(
    summaryRoutes({
      checkRows: [checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000)],
    }),
  );
  ttlCache.invalidatePrefix('reports:');
  ttlCache.invalidatePrefix('tenant-tz:');
  const master = { userID: USER, tenantID: TENANT, role: 'master', permissions: {} };
  const summary = await new PointsService(pool).summaryForTenant(master);
  assert.equal(summary.points[0].profitMonth, 0, 'прибыль обязана быть закрыта правом profit_view');
  assert.equal(summary.points[0].revenueMonth, 250000, 'оборот правом profit_view не закрыт — гейт раздела financial_reports');
});

test('формулы премий и мотивации взяты из ОБЩЕГО модуля, а не скопированы в points', () => {
  assert.ok(
    /import \{ motivationByPointMonthSql, premiumsByPointMonthSql \} from '\.\.\/common\/salary-extras-sql'/.test(
      pointsSrc,
    ),
    'points.service перестал брать формулу премий/мотивации из общего модуля — это четвёртая копия правила',
  );
  assert.ok(
    /premiumCashAmountExpr\('sp'\)/.test(salaryExtrasSrc) && /premiumMonthExpr\('sp', '\$3::text'\)/.test(salaryExtrasSrc),
    'сгруппированный по филиалам запрос премий собран не из общих выражений — он разъедется с дашбордом',
  );
  assert.ok(
    /const netProfitMonth = profitMonth - expMonth - salaryExtras\.month;/.test(reportsSrc),
    'состав термов netProfitMonth на главной изменился — карточку филиала надо двигать следом',
  );
  assert.ok(
    /\(parseFloat\(r\.profit_month\) \|\| 0\) - \(expenseByPoint\.get\(id\) \?\? 0\) - \(extrasByPoint\.get\(id\) \?\? 0\)/.test(
      pointsSrc,
    ),
    'на карточке филиала состав термов «Прибыли за месяц» разошёлся с главной',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. СУММА КАРТОЧЕК СХОДИТСЯ С ИТОГОМ ТЕНАНТА
// ─────────────────────────────────────────────────────────────────────────────

test('заархивированный филиал с деньгами остаётся в сводке — помеченным как закрытый', async () => {
  // Тенант: живой основной сервис + филиал, закрытый в середине месяца. Его
  // деньги никуда из итогов тенанта не делись.
  const pool = fakePool(
    summaryRoutes({
      checkRows: [
        checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000),
        checkAggRow(BRANCH, 'ТопГаз', false, false, 40000, 90000),
      ],
      expenses: [
        { point_id: MAIN, total: '30000' },
        { point_id: BRANCH, total: '12000' },
      ],
      premiums: [{ point_id: BRANCH, total: '3000' }],
      motivation: [{ point_id: MAIN, total: '2000' }],
    }),
  );
  const summary = await freshSummary(pool);
  const byId = new Map(summary.points.map((p) => [p.pointId, p]));

  assert.ok(byId.has(BRANCH), 'деньги закрытого филиала пропали из сводки — владелец читает это как пропажу');
  assert.equal(byId.get(BRANCH).isArchived, true, 'закрытый филиал обязан быть помечен, иначе в нём будут искать работу');
  assert.equal(byId.get(MAIN).isArchived, false);

  // ГЛАВНЫЙ ИНВАРИАНТ: сумма карточек = итог тенанта, посчитанный теми же
  // термами по всей сети.
  const tenantTotal = 100000 + 40000 - (30000 + 12000) - (3000 + 2000);
  const cardsTotal = summary.points.reduce((acc, p) => acc + p.profitMonth, 0);
  assert.equal(cardsTotal, tenantTotal, 'сумма карточек не сходится с итогом тенанта — деньги теряются молча');
  assert.equal(cardsTotal, 93000);
});

test('закрытый филиал БЕЗ денег в периоде карточкой не приезжает', async () => {
  // Филиал, закрытый год назад: складывать в нём нечего, и вечная строка нулей
  // только мешает читать сводку.
  const pool = fakePool(
    summaryRoutes({
      checkRows: [
        checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000),
        { ...checkAggRow(BRANCH, 'Старый', false, false, 0, 0), checks_month: '0' },
      ],
    }),
  );
  const summary = await freshSummary(pool);
  assert.deepEqual(summary.points.map((p) => p.pointId), [MAIN]);
});

test('закрытый филиал с одними расходами месяца обязан показать свой минус', async () => {
  // Чеков нет, но аренда за месяц оплачена — деньги реальные, и они сидят в
  // итогах тенанта. Отсев по «нулям» обязан смотреть на прибыль, а не только
  // на выручку.
  const pool = fakePool(
    summaryRoutes({
      checkRows: [
        checkAggRow(MAIN, 'ZR AUTO', true, true, 100000, 250000),
        { ...checkAggRow(BRANCH, 'ТопГаз', false, false, 0, 0), checks_month: '0' },
      ],
      expenses: [{ point_id: BRANCH, total: '12000' }],
    }),
  );
  const summary = await freshSummary(pool);
  const branch = summary.points.find((p) => p.pointId === BRANCH);
  assert.ok(branch, 'филиал с оплаченной арендой исчез из сводки — ровно на эту сумму перестала сходиться сеть');
  assert.equal(branch.profitMonth, -12000);
});

test('живые филиалы идут первыми, закрытые — в хвосте', async () => {
  const pool = fakePool(
    summaryRoutes({
      checkRows: [
        checkAggRow(MAIN, 'ZR AUTO', true, true, 10, 10),
        checkAggRow(BRANCH, 'ТопГаз', false, false, 20, 20),
      ],
    }),
  );
  const summary = await freshSummary(pool);
  assert.deepEqual(summary.points.map((p) => p.isArchived), [false, true]);
  assert.ok(
    /ORDER BY p\.is_active DESC, p\.is_main DESC, p\.sort_order ASC, lower\(p\.name\) ASC/.test(pointsSrc),
    'порядок карточек задаётся сервером — клиент складывает их сверху вниз',
  );
});

test('фильтр «только живые точки» из сводки убран сознательно', () => {
  const summaryBody = pointsSrc.slice(
    pointsSrc.indexOf('private async computeSummary('),
    pointsSrc.indexOf('// ── Суперадмин'),
  );
  assert.ok(
    /WHERE p\.tenant_id = \$1\s*GROUP BY p\.id, p\.name, p\.is_main, p\.is_active, p\.sort_order/.test(summaryBody),
    'в сводку вернулся фильтр is_active — деньги закрытого филиала снова исчезают из карточек, оставаясь в итогах тенанта',
  );
});
