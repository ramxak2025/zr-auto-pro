const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * МЕНЕДЖЕРЫ ПЛАТФОРМЫ (правка №2, docs/specs/2026-09-30-MANAGERS.md, миграция 173).
 *
 * Менеджер — сотрудник владельца платформы: живёт без тенанта (`users.tenant_id IS NULL`,
 * роль `manager`), ведёт СВОИХ клиентов-автосервисы (`tenants.manager_id`) и с каждой
 * платной оплаты должен владельцу его долю (по умолчанию 60 %). Это зона повышенного
 * риска сразу по двум причинам: права (роль-обход `superadmin` не должен «утечь» менеджеру)
 * и деньги (доля владельца и баланс менеджера — учёт, а не отображение). Что охраняет тест:
 *
 *   А. ГРАНИЦА ДОСТУПА (а, б из спеки §6). Каждый маршрут кабинета менеджера закрыт
 *      `@Roles('manager','superadmin')`; маршруты `/admin/managers*` и передача клиента —
 *      только `superadmin`; RolesGuard пропускает вне `@Roles` ТОЛЬКО суперадмина (файл
 *      guard'а не тронут — это проверяется и по исходнику (Т), и поведением); маршруты
 *      контроллеров 1:1 совпадают с контрактом shared/api/createServices.ts.
 *   Б. `cabinetActor` — второй, независимый замок кабинета: закрывает всё, кроме
 *      manager/superadmin, даже при забытом `@Roles`; менеджер без uuid в токене не
 *      превращается в «суперадмина без ограничения по клиентам».
 *   В. ПЛАТФОРМЕННАЯ РОЛЬ (в). `isPlatformRole('manager')`, `isTenantLess` охватывает
 *      менеджера; интерцепторы: запись без тенанта, контекст RLS-пула, подписка.
 *   Г. МИГРАЦИЯ 173 (г). Новый CHECK роли с 'manager'; `manager_settlements` БЕЗ RLS.
 *   Д. ДЕНЬГИ (д). `computeOwnerShare`: 1000@60 → 600, 1234.56@60 → 740.74, free / сумма ≤ 0 /
 *      нет менеджера → null.
 *   Е. Телефон менеджера: канонический +7…, дубль — 409 PHONE_TAKEN.
 *   Ж. DTO через настоящий глобальный ValidationPipe (transform + whitelist): менеджер не
 *      может прислать `creditManager`, доля 0..100, лишние поля вырезаются.
 *   З. TenantsService: снимок доли владельца в ТОЙ ЖЕ транзакции, что и продление; область
 *      менеджера (`manager_id`) в каждом запросе; чужой клиент — 404 ДО записи и ДО токена.
 *   И. TenantsService, чтение: список, кабинет клиента, метрики, форма платежа, статус.
 *   К. ManagerCabinetService: сводка (пример спеки «5000 оплаты, 60 %» → долг владельцу 3000,
 *      «моя доля» 2000), создание клиента, продления, сброс пароля владельца.
 *   Л. AdminManagersService: заведение и правка менеджера, расчёты с владельцем (отрицательный
 *      — только с примечанием), перенос клиента (история платежей остаётся у прежнего).
 *   М. Ответы и тела запросов сверяются с контрактом shared/ (он — источник истины).
 *   Н. ManagerFinanceService — единственный источник денег менеджера.
 *   О. PlatformSettingsService: потолок бесплатных дней (`managerMaxFreeDays`).
 *   П. UsersService: менеджера через «Сотрудников» не заведёт и не назначит никто.
 *   Р. AuthService (+ JwtStrategy): вход менеджера без тенанта и филиала, `ownerSharePercent`
 *      в /auth/me, отказы деактивированному/уволенному, выбор и смена филиала, продление
 *      сессии, выход, регистрация не создаёт менеджеров; вход суперадмина и директора не
 *      изменился.
 *   С. AccountService: «удалить аккаунт» не анонимизирует менеджера платформы. ProfileService:
 *      менеджер правит свой профиль и пароль сам (у него нет директора, который одобрил бы запрос).
 *   Т. СТАТИЧЕСКИЕ ЗАМКИ: исходник RolesGuard не тронут; во всём API `manager` назван в
 *      `@Roles` только на маршрутах кабинета; каждый запрос кабинета к `tenants` и каждый
 *      вызов TenantsService несёт область менеджера; писать в денежные таблицы умеют
 *      ровно известные места; у менеджера нет тенантных прав, `/my-company` для него закрыт.
 *
 * Тесты поведенческие там, где это возможно (сервисы поднимаются на пуле-заглушке), и
 * статические там, где проверяется текст SQL/исходника: живой БД в CI нет. Живой прогон
 * на PG16 (в режиме RLS с `DB_APP_PASSWORD`) выполняется вручную — см. docs/ios-redesign/MANAGERS_2026-09-30.md.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-strategy-32-chars-min';

require('reflect-metadata');
const bcrypt = require('bcryptjs');
const { Logger, RequestMethod, ValidationPipe } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const { Observable, firstValueFrom } = require('rxjs');

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');
const readRepo = (...parts) => readFileSync(join(backendRoot, '..', ...parts), 'utf8');
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

const { ManagerCabinetController } = require('../dist/platform-managers/manager-cabinet.controller');
const {
  AdminManagersController,
  AdminTenantManagerController,
} = require('../dist/platform-managers/admin-managers.controller');
const { ManagerCabinetService } = require('../dist/platform-managers/manager-cabinet.service');
const { AdminManagersService } = require('../dist/platform-managers/admin-managers.service');
const {
  ManagerFinanceService,
  LEDGER_DEFAULT_MONTHS,
  toMoney,
  subtractMoney,
  clampLedgerMonths,
  emptyManagerStats,
} = require('../dist/platform-managers/manager-finance.service');
const { cabinetActor } = require('../dist/platform-managers/manager-scope');
const { computeOwnerShare, DEFAULT_OWNER_SHARE_PERCENT } = require('../dist/platform-managers/owner-share');
const {
  PHONE_TAKEN_MESSAGE,
  phoneTakenError,
  normalizeLoginPhone,
  isPhoneUniqueViolation,
} = require('../dist/platform-managers/manager-phone');
const {
  CreateManagerDto,
  UpdateManagerDto,
  CreateSettlementDto,
  TransferTenantManagerDto,
} = require('../dist/platform-managers/dto/admin-managers.dto');
const {
  ManagerTenantDirectorDto,
  CreateManagerTenantDto,
  ManagerExtendDto,
  ManagerSuspendDto,
  ResetOwnerPasswordDto,
} = require('../dist/platform-managers/dto/manager-cabinet.dto');
const {
  NO_TENANT_ID,
  PLATFORM_ROLES,
  isPlatformRole,
  isTenantLess,
  authCacheKey,
} = require('../dist/common/auth-cache');
const { ttlCache } = require('../dist/common/ttl-cache');
const { ROLES_KEY, Roles, RolesGuard } = require('../dist/common/guards/roles.guard');
const { ALLOW_NO_TENANT_KEY, AllowNoTenant } = require('../dist/common/decorators/allow-no-tenant.decorator');
const { getCurrentTenantId } = require('../dist/common/tenant-context');
const {
  TenantContextInterceptor,
  apiPathHead,
  managerUsesAdminPool,
} = require('../dist/common/interceptors/tenant-context.interceptor');
const { TenantWriteGuardInterceptor } = require('../dist/common/interceptors/tenant-write-guard.interceptor');
const { SubscriptionGuardInterceptor } = require('../dist/common/interceptors/subscription-guard.interceptor');
const {
  PlatformSettingsService,
  DEFAULT_MANAGER_MAX_FREE_DAYS,
} = require('../dist/settings/platform-settings.service');
const { AdminSettingsController } = require('../dist/settings/admin-settings.controller');
const { UpdatePlatformSettingsDto } = require('../dist/settings/dto/update-platform-settings.dto');
const { TenantsService, computeSubscriptionStatusOf } = require('../dist/tenants/tenants.service');
const { ExtendSubscriptionDto } = require('../dist/tenants/dto/subscription.dto');
const { UsersService } = require('../dist/users/users.service');
const { AccountService } = require('../dist/account/account.service');
const { AuthService } = require('../dist/auth/auth.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { POINT_SELECT_PURPOSE } = require('../dist/auth/point-session');
const { SESSION_STALE_MESSAGE } = require('../dist/auth/session-boundary');
const { RegisterDto } = require('../dist/auth/dto/register.dto');
const { normalizePhone } = require('../dist/common/normalize-phone');
const { userHasPermission, PermissionsGuard, PERMISSION_KEY } = require('../dist/common/guards/permissions.guard');
const { CANONICAL_PERMISSION_KEYS } = require('../dist/common/role-matrix');
const { ProfileService } = require('../dist/profile/profile.service');
const { ProfileController } = require('../dist/profile/profile.controller');
const { TenantsController, AdminAuditController } = require('../dist/tenants/tenants.controller');
const { DEFAULT_TIMEZONE } = require('../dist/common/timezone');

// Часть тестов нарочно роняет транзакции (ожидаемые 500/откат) — логгер Nest не должен засорять вывод.
Logger.overrideLogger(false);

// ───────────────────────────────────────────────────────────────────────────
// Общие константы и заглушки
// ───────────────────────────────────────────────────────────────────────────

const SUPERADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MANAGER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const DIRECTOR_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_TENANT_ID = '55555555-5555-4555-8555-555555555555';
const PLAN_ID = '66666666-6666-4666-8666-666666666666';
const SETTLEMENT_ID = '77777777-7777-4777-8777-777777777777';

const managerUser = (overrides = {}) => ({ userID: MANAGER_ID, role: 'manager', tenantID: NO_TENANT_ID, ...overrides });
const superadminUser = (overrides = {}) => ({
  userID: SUPERADMIN_ID,
  role: 'superadmin',
  tenantID: NO_TENANT_ID,
  ...overrides,
});
const directorUser = (overrides = {}) => ({ userID: DIRECTOR_ID, role: 'director', tenantID: TENANT_ID, ...overrides });

/** Пул-заглушка: первый совпавший (по SQL с схлопнутыми пробелами) маршрут отвечает. */
function fakePool(routes = []) {
  const state = { calls: [], connects: 0, released: 0 };
  const run = async (text, params) => {
    const sql = flat(text);
    state.calls.push({ text: sql, sql, params });
    for (const [pattern, rows] of routes) {
      if (pattern.test(sql)) {
        const value = typeof rows === 'function' ? rows(params, state.calls) : rows;
        if (value instanceof Error) throw value;
        return Array.isArray(value) ? { rows: value, rowCount: value.length } : value;
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    get calls() {
      return state.calls;
    },
    get connects() {
      return state.connects;
    },
    get released() {
      return state.released;
    },
    query: run,
    connect: async () => {
      state.connects += 1;
      return {
        query: run,
        release() {
          state.released += 1;
        },
      };
    },
  };
}

/** JwtService-заглушка: токен — это JSON полезной нагрузки, подписи нет. */
function fakeJwt(overrides = {}) {
  const signCalls = [];
  return {
    signCalls,
    sign(payload, options) {
      signCalls.push({ payload, options });
      return JSON.stringify({
        ...payload,
        expiresIn: options?.expiresIn ?? null,
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
      if (overrides.verifyThrows) throw new Error('jwt expired');
      return JSON.parse(token);
    },
  };
}

/** AuditService-заглушка: копит записи журнала и отдаёт имя актора. */
function fakeAudit() {
  const entries = [];
  return {
    entries,
    async log(actor, action, target) {
      entries.push({ actor, action, target });
    },
    async resolveActorName() {
      return 'Тестовый актор';
    },
    async listByActor(actorUserId, limit, offset) {
      entries.push({ listByActor: { actorUserId, limit, offset } });
      return [];
    },
  };
}

/** Ждёт исключение и проверяет HTTP-статус и (по желанию) текст/поля тела ответа. */
async function expectHttp(run, status, expected) {
  let error;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'ожидалось исключение, а вызов завершился без ошибки');
  assert.equal(typeof error.getStatus, 'function', `ожидался HttpException, получено: ${error && error.stack}`);
  assert.equal(error.getStatus(), status, `статус: ${JSON.stringify(error.getResponse())}`);
  if (expected !== undefined) {
    const body = error.getResponse();
    const message =
      typeof body === 'string' ? body : Array.isArray(body.message) ? body.message.join('; ') : body.message;
    if (typeof expected === 'string') assert.equal(message, expected);
    else if (expected instanceof RegExp) assert.match(String(message), expected);
    else for (const [key, value] of Object.entries(expected)) assert.equal(body[key], value, `поле ${key} тела ответа`);
  }
  return error;
}

/** Контекст выполнения Nest для guard'ов и интерцепторов. */
function httpContext({ method = 'GET', path, user, handler, cls, extra = {} } = {}) {
  const request = { method, path, url: path, originalUrl: path, user, ...extra };
  return {
    request,
    getType: () => 'http',
    getHandler: () => handler ?? function anonymousHandler() {},
    getClass: () => cls ?? class AnonymousController {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

const HANDLED = { HANDLED: true };
const passthroughNext = { handle: () => HANDLED };

function methodKey(verb, path) {
  return `${verb} ${path}`;
}

const controllerRoutePath = (base, sub) => `/${base}/${sub === '/' ? '' : sub}`.replace(/\/+/g, '/').replace(/\/$/, '');

/** Маршруты контроллера по метаданным Nest: verb, полный путь, роли handler'а. */
function routesOf(Controller) {
  const base = Reflect.getMetadata('path', Controller);
  const routes = [];
  for (const name of Object.getOwnPropertyNames(Controller.prototype)) {
    const fn = Controller.prototype[name];
    if (name === 'constructor' || typeof fn !== 'function') continue;
    const method = Reflect.getMetadata('method', fn);
    if (method === undefined) continue;
    routes.push({
      name,
      verb: RequestMethod[method],
      path: controllerRoutePath(base, Reflect.getMetadata('path', fn)),
      roles: Reflect.getMetadata(ROLES_KEY, fn),
    });
  }
  return routes;
}

function guardContext(Controller, handlerName, user) {
  return httpContext({
    user,
    handler: Controller.prototype[handlerName],
    cls: Controller,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// А. ГРАНИЦА ДОСТУПА: @Roles, RolesGuard, контракт
// ───────────────────────────────────────────────────────────────────────────

const EXPECTED_CABINET_ROUTES = [
  'GET /manager/summary',
  'GET /manager/tenants',
  'POST /manager/tenants',
  'GET /manager/tenants/:id',
  'GET /manager/tenants/:id/cabinet',
  'GET /manager/tenants/:id/audit-log',
  'POST /manager/tenants/:id/extend',
  'POST /manager/tenants/:id/assign-plan',
  'POST /manager/tenants/:id/suspend',
  'POST /manager/tenants/:id/unsuspend',
  'POST /manager/tenants/:id/impersonate',
  'POST /manager/tenants/:id/reset-owner-password',
  'GET /manager/ledger',
  'GET /manager/audit-log',
];

const EXPECTED_ADMIN_ROUTES = [
  'GET /admin/managers',
  'POST /admin/managers',
  'GET /admin/managers/:id',
  'PATCH /admin/managers/:id',
  'GET /admin/managers/:id/ledger',
  'POST /admin/managers/:id/settlements',
  'DELETE /admin/managers/:id/settlements/:settlementId',
  'PATCH /admin/tenants/:tenantId/manager',
];

const routeKeys = (controllers) =>
  controllers.flatMap((Controller) => routesOf(Controller).map((r) => methodKey(r.verb, r.path))).sort();

test('кабинет менеджера: ровно 14 маршрутов, и КАЖДЫЙ закрыт @Roles(manager, superadmin)', () => {
  const routes = routesOf(ManagerCabinetController);
  assert.deepEqual(routeKeys([ManagerCabinetController]), [...EXPECTED_CABINET_ROUTES].sort());
  for (const route of routes) {
    assert.deepEqual(
      route.roles,
      ['manager', 'superadmin'],
      `${route.verb} ${route.path} (${route.name}): нет @Roles('manager','superadmin') — RolesGuard пропустил бы любого залогиненного`,
    );
  }
  // Публичных методов без HTTP-декоратора в кабинете нет: каждый метод класса — маршрут.
  const proto = ManagerCabinetController.prototype;
  const plain = Object.getOwnPropertyNames(proto).filter(
    (n) =>
      n !== 'constructor' && typeof proto[n] === 'function' && Reflect.getMetadata('method', proto[n]) === undefined,
  );
  assert.deepEqual(plain, []);
});

test('кабинет суперадмина: маршруты /admin/managers* и передача клиента — ТОЛЬКО superadmin', () => {
  assert.deepEqual(
    routeKeys([AdminManagersController, AdminTenantManagerController]),
    [...EXPECTED_ADMIN_ROUTES].sort(),
  );
  for (const Controller of [AdminManagersController, AdminTenantManagerController]) {
    for (const route of routesOf(Controller)) {
      assert.deepEqual(route.roles, ['superadmin'], `${route.verb} ${route.path}: роли ${JSON.stringify(route.roles)}`);
      assert.ok(!route.roles.includes('manager'), `${route.path}: менеджер не должен управлять менеджерами`);
    }
  }
});

test('все три контроллера: JwtAuthGuard + RolesGuard на классе и @AllowNoTenant (менеджер без тенанта)', () => {
  for (const Controller of [ManagerCabinetController, AdminManagersController, AdminTenantManagerController]) {
    const guards = (Reflect.getMetadata('__guards__', Controller) || []).map((g) => g.name);
    assert.ok(guards.includes('JwtAuthGuard'), `${Controller.name}: нет JwtAuthGuard`);
    assert.ok(guards.includes('RolesGuard'), `${Controller.name}: нет RolesGuard`);
    assert.equal(
      Reflect.getMetadata(ALLOW_NO_TENANT_KEY, Controller),
      true,
      `${Controller.name}: нет @AllowNoTenant()`,
    );
  }
});

/** Маршруты контракта shared/api/createServices.ts для менеджеров, в виде «VERB /path/:p». */
function contractManagerRoutes() {
  const source = readRepo('shared', 'api', 'createServices.ts');
  const start = source.indexOf('export function createAdminManagersApi');
  const cabinetStart = source.indexOf('export function createManagerCabinetApi');
  assert.ok(start > 0 && cabinetStart > start, 'в контракте нет фабрик менеджеров');
  const end = source.indexOf('\n}\n', cabinetStart);
  const slice = source.slice(start, end);
  const re = /api\.(get|post|put|patch|delete)<[^>]*>\(\s*(['"`])(.*?)\2/g;
  const routes = [];
  for (let match = re.exec(slice); match; match = re.exec(slice)) {
    routes.push(`${match[1].toUpperCase()} ${match[3].replace(/\$\{[^}]*\}/g, ':p').split('?')[0]}`);
  }
  return routes.sort();
}

test('маршруты контроллеров 1:1 совпадают с контрактом shared/api/createServices.ts', () => {
  const fromController = routeKeys([
    ManagerCabinetController,
    AdminManagersController,
    AdminTenantManagerController,
  ]).map((key) => key.replace(/:\w+/g, ':p'));
  const fromContract = contractManagerRoutes();
  assert.equal(fromContract.length, 22, `в контракте ожидалось 22 маршрута (14 + 8), найдено ${fromContract.length}`);
  assert.deepEqual([...fromController].sort(), fromContract);
});

test('RolesGuard: кабинет менеджера пускает manager и superadmin, остальные роли — нет', () => {
  const guard = new RolesGuard(new Reflector());
  const matrix = [
    [managerUser(), true],
    [superadminUser(), true],
    [directorUser(), false],
    [{ userID: DIRECTOR_ID, role: 'admin', tenantID: TENANT_ID }, false],
    [{ userID: DIRECTOR_ID, role: 'master', tenantID: TENANT_ID }, false],
    [{ userID: DIRECTOR_ID, role: 'unknown-role', tenantID: TENANT_ID }, false],
    [{ userID: DIRECTOR_ID, role: 'MANAGER', tenantID: TENANT_ID }, false],
    [undefined, false],
  ];
  for (const route of routesOf(ManagerCabinetController)) {
    for (const [user, expected] of matrix) {
      assert.equal(
        guard.canActivate(guardContext(ManagerCabinetController, route.name, user)),
        expected,
        `${route.verb} ${route.path} роль ${user?.role}`,
      );
    }
  }
});

test('RolesGuard: маршруты суперадмина (/admin/managers*, передача клиента) менеджеру закрыты', () => {
  const guard = new RolesGuard(new Reflector());
  for (const Controller of [AdminManagersController, AdminTenantManagerController]) {
    for (const route of routesOf(Controller)) {
      assert.equal(guard.canActivate(guardContext(Controller, route.name, managerUser())), false, `${route.path}`);
      assert.equal(guard.canActivate(guardContext(Controller, route.name, superadminUser())), true, `${route.path}`);
      assert.equal(guard.canActivate(guardContext(Controller, route.name, directorUser())), false, `${route.path}`);
    }
  }
});

test('RolesGuard: обход «пропускаем всё» — ТОЛЬКО у superadmin, менеджеру он не достался', () => {
  class Fake {
    directorOnly() {}
  }
  Roles('director')(Fake.prototype, 'directorOnly', Object.getOwnPropertyDescriptor(Fake.prototype, 'directorOnly'));
  const guard = new RolesGuard(new Reflector());
  const ctx = (user) => httpContext({ user, handler: Fake.prototype.directorOnly, cls: Fake });
  assert.equal(guard.canActivate(ctx(superadminUser())), true, 'superadmin проходит везде (как и раньше)');
  assert.equal(guard.canActivate(ctx(directorUser())), true);
  assert.equal(guard.canActivate(ctx(managerUser())), false, 'менеджер на чужом @Roles — отказ, обхода нет');
  assert.equal(guard.canActivate(ctx({ userID: DIRECTOR_ID, role: 'master', tenantID: TENANT_ID })), false);
});

// ───────────────────────────────────────────────────────────────────────────
// Б. cabinetActor — второй, независимый замок кабинета
// ───────────────────────────────────────────────────────────────────────────

test('cabinetActor: менеджер — свой портфель, суперадмин — без ограничения, остальные — 403', async () => {
  assert.deepEqual(cabinetActor(managerUser()), {
    userId: MANAGER_ID,
    isManager: true,
    scope: { managerId: MANAGER_ID },
  });
  assert.deepEqual(cabinetActor(superadminUser()), {
    userId: SUPERADMIN_ID,
    isManager: false,
    scope: { managerId: null },
  });
  for (const user of [
    directorUser(),
    { userID: DIRECTOR_ID, role: 'admin', tenantID: TENANT_ID },
    { userID: DIRECTOR_ID, role: 'master', tenantID: TENANT_ID },
    { userID: DIRECTOR_ID, role: undefined, tenantID: TENANT_ID },
    undefined,
    null,
  ]) {
    await expectHttp(() => cabinetActor(user), 403, 'Недостаточно прав для этого действия');
  }
});

test('cabinetActor: менеджер без валидного uuid в токене — 403, а не «без ограничения по клиентам»', async () => {
  for (const userID of [undefined, null, '', 'not-a-uuid', 42, "1'; DROP TABLE tenants;--"]) {
    await expectHttp(() => cabinetActor({ ...managerUser(), userID }), 403);
    await expectHttp(() => cabinetActor({ ...superadminUser(), userID }), 403);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// В. Роль платформы и интерцепторы
// ───────────────────────────────────────────────────────────────────────────

test('isPlatformRole / PLATFORM_ROLES: платформенные роли — superadmin и manager, и только они', () => {
  assert.deepEqual([...PLATFORM_ROLES].sort(), ['manager', 'superadmin']);
  assert.equal(isPlatformRole('manager'), true);
  assert.equal(isPlatformRole('superadmin'), true);
  for (const role of ['director', 'admin', 'master', 'MANAGER', ' manager', 'manager ', '', undefined, null]) {
    assert.equal(isPlatformRole(role), false, `роль ${JSON.stringify(role)}`);
  }
});

test('isTenantLess: менеджер без тенанта — «без автосервиса», как суперадмин; настоящий тенант — нет', () => {
  assert.equal(isTenantLess({ role: 'manager', tenantID: NO_TENANT_ID }), true);
  assert.equal(isTenantLess({ role: 'manager', tenantID: '' }), true);
  assert.equal(isTenantLess({ role: 'manager', tenantID: undefined }), true);
  assert.equal(isTenantLess({ role: 'superadmin', tenantID: NO_TENANT_ID }), true);
  // Платформенный пользователь внутри настоящего тенанта (impersonation) — обычный запрос.
  assert.equal(isTenantLess({ role: 'manager', tenantID: TENANT_ID }), false);
  assert.equal(isTenantLess({ role: 'superadmin', tenantID: TENANT_ID }), false);
  // Обычные роли не «без тенанта», даже если tenantID пуст: это не платформенная роль.
  assert.equal(isTenantLess({ role: 'director', tenantID: NO_TENANT_ID }), false);
  assert.equal(isTenantLess({ role: 'master', tenantID: '' }), false);
  // Строковая форма (сервисные lazy-seed проверки) — прежняя семантика.
  assert.equal(isTenantLess(NO_TENANT_ID), true);
  assert.equal(isTenantLess(''), true);
  assert.equal(isTenantLess(TENANT_ID), false);
  assert.equal(isTenantLess(null), false);
  assert.equal(isTenantLess(undefined), false);
});

test('TenantWriteGuardInterceptor: тенантная запись менеджера без автосервиса — 409, кабинет /manager — разрешён', async () => {
  const guard = new TenantWriteGuardInterceptor(new Reflector());
  const blocked = async (method, path, user = managerUser()) =>
    expectHttp(() => guard.intercept(httpContext({ method, path, user }), passthroughNext), 409, {
      code: 'NO_TENANT_CONTEXT',
    });

  await blocked('POST', '/api/users');
  await blocked('POST', '/api/clients');
  await blocked('PATCH', '/api/products/123');
  await blocked('PUT', '/api/services/123');
  await blocked('DELETE', '/api/checks/123');
  await blocked('POST', '/API/USERS');
  // Префикс — целый сегмент: «manager-evil» / «managers» кабинетом не считаются.
  await blocked('POST', '/api/manager-evil/tenants');
  await blocked('POST', '/api/managers');
  // Строка запроса не даёт «прикинуться» кабинетом.
  await blocked('POST', '/api/users?next=/manager/tenants');

  for (const path of [
    '/api/manager/tenants',
    '/api/manager/tenants/1/extend',
    '/api/manager/tenants/1/impersonate',
    '/api/auth/logout',
  ]) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal(guard.intercept(httpContext({ method, path, user: managerUser() }), passthroughNext), HANDLED, path);
    }
  }
});

test('TenantWriteGuardInterceptor: чтение, обычные роли и «менеджер внутри тенанта» не затронуты', () => {
  const guard = new TenantWriteGuardInterceptor(new Reflector());
  const pass = (method, path, user) =>
    assert.equal(guard.intercept(httpContext({ method, path, user }), passthroughNext), HANDLED, `${method} ${path}`);

  pass('GET', '/api/users', managerUser());
  pass('GET', '/api/clients', managerUser());
  pass('POST', '/api/users', directorUser());
  pass('POST', '/api/users', { role: 'manager', tenantID: TENANT_ID });
  pass('POST', '/api/users', { role: 'superadmin', tenantID: TENANT_ID });
  // Суперадмин на своих глобальных поверхностях — как и раньше.
  pass('POST', '/api/tenants', superadminUser());
  pass('PATCH', '/api/admin/managers/1', superadminUser());
});

test('TenantWriteGuardInterceptor: @AllowNoTenant на классе по-прежнему открывает запись без автосервиса', () => {
  class OptedOut {
    write() {}
  }
  AllowNoTenant()(OptedOut);
  const guard = new TenantWriteGuardInterceptor(new Reflector());
  const ctx = httpContext({
    method: 'POST',
    path: '/api/push/register',
    user: managerUser(),
    handler: OptedOut.prototype.write,
    cls: OptedOut,
  });
  assert.equal(guard.intercept(ctx, passthroughNext), HANDLED);
});

/** Тенант, который видит хендлер, выполняющийся под TenantContextInterceptor. */
async function tenantSeenByHandler(user, path) {
  const interceptor = new TenantContextInterceptor();
  const next = {
    handle: () =>
      new Observable((subscriber) => {
        subscriber.next(getCurrentTenantId());
        subscriber.complete();
      }),
  };
  return firstValueFrom(interceptor.intercept(httpContext({ user, path }), next));
}

test('TenantContextInterceptor: менеджер на /manager/*, /auth/* и /profile/* — admin-пул, на остальном — nil-tenant RLS-пул', async () => {
  for (const path of [
    '/api/manager/summary',
    '/api/manager/tenants/1/cabinet',
    '/api/MANAGER/summary',
    '/api/auth/me',
    '/api/auth/logout',
    '/manager/summary',
    // «Мой профиль»: под nil-tenant политика UPDATE на users не пускает даже СВОЮ строку менеджера
    // (у неё нет тенанта) — смена пароля «проходила» бы, ничего не изменив.
    '/api/profile',
    '/api/profile/password',
    '/api/profile/change-requests/mine',
    '/api/PROFILE/password',
  ]) {
    assert.equal(await tenantSeenByHandler(managerUser(), path), null, `${path}: admin-пул (контекста тенанта нет)`);
  }
  for (const path of [
    '/api/users',
    '/api/plans',
    '/api/clients',
    '/api/managers',
    '/api/tenants',
    '/api/users?next=/manager/x',
    '/api/x/manager',
    '/api/x/profile',
    '/api/profiles',
    '/api/profile-evil',
    '/api/users?next=/profile',
  ]) {
    assert.equal(await tenantSeenByHandler(managerUser(), path), NO_TENANT_ID, `${path}: RLS-пул под nil-tenant`);
  }
  // Что бы ни лежало в токене менеджера, чужой тенант в контекст не попадёт.
  assert.equal(await tenantSeenByHandler(managerUser({ tenantID: TENANT_ID }), '/api/users'), NO_TENANT_ID);
});

test('TenantContextInterceptor: суперадмин, директор и аноним — как и раньше', async () => {
  assert.equal(await tenantSeenByHandler(superadminUser(), '/api/users'), null);
  assert.equal(await tenantSeenByHandler(superadminUser(), '/api/tenants'), null);
  assert.equal(await tenantSeenByHandler(directorUser(), '/api/users'), TENANT_ID);
  assert.equal(await tenantSeenByHandler(directorUser(), '/api/manager/summary'), TENANT_ID);
  assert.equal(await tenantSeenByHandler(undefined, '/api/health'), null);
  assert.equal(await tenantSeenByHandler({ role: 'master', tenantID: 'не-uuid' }, '/api/users'), null);
});

test('apiPathHead / managerUsesAdminPool: первый сегмент после api, без регистра и строки запроса', () => {
  assert.equal(apiPathHead('/api/manager/tenants?x=1'), 'manager');
  assert.equal(apiPathHead('/API/Manager'), 'manager');
  assert.equal(apiPathHead('manager/summary'), 'manager');
  assert.equal(apiPathHead('//api//auth//me'), 'auth');
  assert.equal(apiPathHead('/api'), '');
  assert.equal(apiPathHead(''), '');
  assert.equal(apiPathHead(undefined), '');
  assert.equal(apiPathHead(null), '');
  assert.equal(managerUsesAdminPool('/api/manager/summary'), true);
  assert.equal(managerUsesAdminPool('/api/auth/refresh'), true);
  assert.equal(managerUsesAdminPool('/api/profile/password'), true);
  assert.equal(managerUsesAdminPool('/api/users'), false);
  assert.equal(managerUsesAdminPool('/api/managers'), false);
  assert.equal(managerUsesAdminPool('/api/profiles'), false);
  assert.equal(managerUsesAdminPool(''), false);

  // ЗАМОК: admin-пул (superuser, обход RLS) менеджеру выдаётся ровно на трёх головах пути. Четвёртая
  // голова — осознанное решение с разбором ВСЕХ её обработчиков, а не побочный эффект правки.
  assert.match(
    flat(read('src/common/interceptors/tenant-context.interceptor.ts')),
    /MANAGER_ADMIN_POOL_HEADS: ReadonlySet<string> = new Set\(\['manager', 'auth', 'profile'\]\)/,
  );
});

test('SubscriptionGuardInterceptor: менеджер и суперадмин вне enforcement подписки, директор блокированного — 403', async () => {
  const blockedTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const liveTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const pool = fakePool([
    [
      /FROM tenants WHERE id = \$1/,
      (params) =>
        params[0] === blockedTenant
          ? [{ is_active: false, subscription_end: null }]
          : [{ is_active: true, subscription_end: new Date(Date.now() + 86400000).toISOString() }],
    ],
  ]);
  const guard = new SubscriptionGuardInterceptor(pool);

  for (const user of [managerUser(), superadminUser(), managerUser({ tenantID: blockedTenant })]) {
    assert.equal(await guard.intercept(httpContext({ path: '/api/manager/tenants', user }), passthroughNext), HANDLED);
  }
  assert.equal(pool.calls.length, 0, 'платформенные роли не должны даже читать статус подписки');

  await expectHttp(
    () =>
      guard.intercept(
        httpContext({ path: '/api/clients', user: directorUser({ tenantID: blockedTenant }) }),
        passthroughNext,
      ),
    403,
    { code: 'SUBSCRIPTION_BLOCKED' },
  );
  assert.equal(
    await guard.intercept(
      httpContext({ path: '/api/clients', user: directorUser({ tenantID: liveTenant }) }),
      passthroughNext,
    ),
    HANDLED,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Г. Миграция 173
// ───────────────────────────────────────────────────────────────────────────

test('миграция 173: идемпотентна, роль manager в CHECK, manager_settlements без RLS', () => {
  const sql = read('migrations/173_platform_managers.sql');
  const text = flat(sql);
  // Новый CHECK допускает 'manager' и сохраняет прежние роли.
  assert.match(text, /CHECK \(role IN \('superadmin', ?'director', ?'admin', ?'master', ?'manager'\)\)/);
  // Расчёты менеджера читает и суперадмин, и сам менеджер — RLS на таблице не включаем.
  assert.doesNotMatch(sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(sql, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(text, /CREATE TABLE IF NOT EXISTS manager_settlements/);
  // Идемпотентность: повторный прогон не падает, ничего не сносит.
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
  assert.doesNotMatch(sql, /TRUNCATE|DELETE\s+FROM/i);
  for (const column of [
    'owner_share_percent',
    'manager_id',
    'owner_share_amount',
    'plan_name',
    'manager_max_free_days',
  ]) {
    const adds = text.match(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, 'g')) || [];
    assert.ok(adds.length >= 1, `колонка ${column}: нужен ADD COLUMN IF NOT EXISTS`);
  }
  assert.equal((text.match(/ADD COLUMN(?! IF NOT EXISTS)/g) || []).length, 0, 'ADD COLUMN без IF NOT EXISTS');
  assert.equal(
    (text.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || []).length,
    0,
    'CREATE INDEX без IF NOT EXISTS',
  );
});

test('миграция 173 — следующая после 171, и ни одна другая миграция не занимает её номер', () => {
  const files = readdirSync(join(backendRoot, 'migrations')).filter((f) => f.endsWith('.sql'));
  const number173 = files.filter((f) => f.startsWith('173_'));
  assert.deepEqual(number173, ['173_platform_managers.sql']);
});

// ───────────────────────────────────────────────────────────────────────────
// Д. Деньги: computeOwnerShare
// ───────────────────────────────────────────────────────────────────────────

test('computeOwnerShare: доля владельца — копейки без float-хвостов', () => {
  assert.equal(DEFAULT_OWNER_SHARE_PERCENT, 60);
  assert.equal(computeOwnerShare(1000, 60, false), 600);
  assert.equal(computeOwnerShare(1234.56, 60, false), 740.74);
  assert.equal(computeOwnerShare(5000, 60, false), 3000);
  assert.equal(computeOwnerShare(0.01, 60, false), 0.01);
  assert.equal(computeOwnerShare(100, 100, false), 100);
  assert.equal(computeOwnerShare(100, 0, false), 0, '0 % — доля есть, но равна нулю (это не «менеджера нет»)');
  assert.equal(computeOwnerShare(99.99, 33.33, false), 33.33);
  assert.equal(computeOwnerShare(1234.56, 12.5, false), 154.32);
});

test('computeOwnerShare: бесплатное продление, сумма ≤ 0 и нет менеджера — доли нет (null)', () => {
  assert.equal(computeOwnerShare(1000, 60, true), null, 'isFree');
  assert.equal(computeOwnerShare(0, 60, false), null);
  assert.equal(computeOwnerShare(-100, 60, false), null);
  assert.equal(computeOwnerShare(NaN, 60, false), null);
  assert.equal(computeOwnerShare(Infinity, 60, false), null);
  assert.equal(computeOwnerShare(null, 60, false), null);
  assert.equal(computeOwnerShare(undefined, 60, false), null);
  assert.equal(computeOwnerShare('1000', 60, false), null, 'строка — не число');
  assert.equal(computeOwnerShare(1000, null, false), null, 'менеджера нет');
  assert.equal(computeOwnerShare(1000, undefined, false), null);
  assert.equal(computeOwnerShare(1000, NaN, false), null);
  assert.equal(computeOwnerShare(1000, -1, false), null);
  assert.equal(computeOwnerShare(1000, 100.01, false), null);
});

// ───────────────────────────────────────────────────────────────────────────
// Е. Телефон менеджера
// ───────────────────────────────────────────────────────────────────────────

test('normalizeLoginPhone: канонический +7…, мусор и «+7» — 400', async () => {
  assert.equal(normalizeLoginPhone('+7 (999) 123-45-67'), '+79991234567');
  assert.equal(normalizeLoginPhone('89991234567'), '+79991234567');
  assert.equal(normalizeLoginPhone('  +7 999 123 45 67 '), '+79991234567');
  for (const bad of ['+7', '', '   ', null, undefined, 'abc', '12345', '+7 999']) {
    await expectHttp(() => normalizeLoginPhone(bad), 400, 'Укажите телефон в формате +7 999 123-45-67');
  }
});

test('isPhoneUniqueViolation: только 23505 по телефону; чужой уникальный индекс телефоном не объявляется', () => {
  assert.equal(isPhoneUniqueViolation({ code: '23505', constraint: 'users_phone_key' }), true);
  assert.equal(isPhoneUniqueViolation({ code: '23505' }), true);
  assert.equal(isPhoneUniqueViolation({ code: '23505', constraint: 'users_email_key' }), false);
  assert.equal(isPhoneUniqueViolation({ code: '23503', constraint: 'users_phone_key' }), false);
  assert.equal(isPhoneUniqueViolation(new Error('boom')), false);
  assert.equal(isPhoneUniqueViolation(null), false);
  assert.equal(isPhoneUniqueViolation(undefined), false);
});

test('phoneTakenError: 409 с кодом PHONE_TAKEN (ManagerPhoneTakenError из контракта)', async () => {
  const error = phoneTakenError();
  assert.equal(error.getStatus(), 409);
  assert.deepEqual(error.getResponse(), { message: PHONE_TAKEN_MESSAGE, code: 'PHONE_TAKEN' });
});

// ───────────────────────────────────────────────────────────────────────────
// Ж. DTO через настоящий глобальный ValidationPipe (transform + whitelist)
// ───────────────────────────────────────────────────────────────────────────

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const validateBody = (Dto, body) => pipe.transform(body, { type: 'body', metatype: Dto });

test('ManagerExtendDto: creditManager менеджеру недоступен (whitelist вырезает), type обязателен', async () => {
  const dto = await validateBody(ManagerExtendDto, {
    type: 'paid',
    amount: 5000,
    days: 30,
    creditManager: true,
    managerId: OTHER_MANAGER_ID,
    ownerSharePercent: 0,
  });
  assert.deepEqual({ ...dto }, { type: 'paid', amount: 5000, days: 30 });
  assert.ok(!('creditManager' in dto), 'флаг суперадмина «оплату получил менеджер» менеджеру недоступен');

  await expectHttp(() => validateBody(ManagerExtendDto, { days: 30 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'gift', days: 30 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'free', days: 0 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'free', days: -3 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'paid', amount: -1, days: 30 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'paid', amount: 100.123, days: 30 }), 400);
  await expectHttp(() => validateBody(ManagerExtendDto, { type: 'paid', amount: 100, until: 'вчера' }), 400);
  const ok = await validateBody(ManagerExtendDto, { type: 'free', days: 14, note: 'пробный' });
  assert.equal(ok.type, 'free');
  assert.equal(ok.days, 14);
});

test('CreateManagerTenantDto: владелец-директор обязателен, вложенный DTO валидируется', async () => {
  const good = {
    name: 'Автосервис Восток',
    planId: PLAN_ID,
    director: { name: 'Иван', phone: '+7 999 123-45-67', password: 'Secret123' },
    trialDays: 14,
  };
  const dto = await validateBody(CreateManagerTenantDto, { ...good, managerId: OTHER_MANAGER_ID, isActive: true });
  assert.ok(dto.director instanceof ManagerTenantDirectorDto);
  assert.ok(!('managerId' in dto), 'тенант всегда заводится «за собой»: managerId из тела вырезается');
  assert.ok(!('isActive' in dto));

  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, director: undefined }), 400);
  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, director: 'Иван' }), 400);
  await expectHttp(
    () => validateBody(CreateManagerTenantDto, { ...good, director: { name: 'Иван', phone: '+7', password: '123' } }),
    400,
  );
  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, planId: 'не-uuid' }), 400);
  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, name: '' }), 400);
  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, trialDays: 0 }), 400);
  await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, trialDays: 1.5 }), 400);
});

test('ResetOwnerPasswordDto: пароль 6..128 символов', async () => {
  await validateBody(ResetOwnerPasswordDto, { password: 'Secret1' });
  await expectHttp(() => validateBody(ResetOwnerPasswordDto, { password: '12345' }), 400);
  await expectHttp(() => validateBody(ResetOwnerPasswordDto, { password: 'x'.repeat(129) }), 400);
  await expectHttp(() => validateBody(ResetOwnerPasswordDto, {}), 400);
});

test('NoNulBytes: NUL (\\u0000) в свободных текстовых полях — 400, а не 500 от Postgres (22021)', async () => {
  const good = {
    name: 'Автосервис Восток',
    planId: PLAN_ID,
    director: { name: 'Иван', phone: '+7 999 123-45-67', password: 'Secret123' },
  };
  const createManager = { fullName: 'Пётр', phone: '+7 999 111-22-33', password: 'Secret1' };
  for (const bad of ['\u0000', 'a\u0000b', 'хвост\u0000']) {
    await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, name: bad }), 400);
    await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, phone: bad }), 400);
    await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, address: bad }), 400);
    await expectHttp(() => validateBody(CreateManagerTenantDto, { ...good, note: bad }), 400);
    await expectHttp(
      () => validateBody(CreateManagerTenantDto, { ...good, director: { ...good.director, name: bad } }),
      400,
    );
    await expectHttp(() => validateBody(ManagerExtendDto, { type: 'free', days: 1, note: bad }), 400);
    await expectHttp(() => validateBody(ManagerExtendDto, { type: 'paid', days: 1, amount: 5, note: bad }), 400);
    await expectHttp(() => validateBody(ManagerSuspendDto, { reason: bad }), 400);
    await expectHttp(() => validateBody(CreateManagerDto, { ...createManager, fullName: bad }), 400);
    await expectHttp(() => validateBody(CreateManagerDto, { ...createManager, note: bad }), 400);
    await expectHttp(() => validateBody(UpdateManagerDto, { fullName: bad }), 400);
    await expectHttp(() => validateBody(UpdateManagerDto, { note: bad }), 400);
    await expectHttp(() => validateBody(CreateSettlementDto, { amount: 1, note: bad }), 400);
  }
  // обычный текст (кириллица, emoji, переводы строк) и «очистить заметку» (null) проходят
  const suspend = await validateBody(ManagerSuspendDto, { reason: 'Неоплата 💥\nповторно', foo: 1 });
  assert.deepEqual({ ...suspend }, { reason: 'Неоплата 💥\nповторно' });
  await validateBody(ManagerSuspendDto, {});
  await validateBody(CreateManagerTenantDto, { ...good, note: 'заметка\tс табуляцией', address: 'ул. Ленина, 1' });
  await validateBody(UpdateManagerDto, { note: null });
  await validateBody(CreateSettlementDto, { amount: 1, note: 'выплата за сентябрь' });
});

test('CreateManagerDto / UpdateManagerDto: доля 0..100, пароль от 6, лишние поля вырезаются', async () => {
  const dto = await validateBody(CreateManagerDto, {
    fullName: 'Пётр',
    phone: '+7 999 111-22-33',
    password: 'Secret1',
    ownerSharePercent: 55.5,
    role: 'superadmin',
    tenantId: TENANT_ID,
  });
  assert.equal(dto.ownerSharePercent, 55.5);
  assert.ok(!('role' in dto), 'роль менеджеру задаёт сервер, а не тело запроса');
  assert.ok(!('tenantId' in dto));

  await expectHttp(() => validateBody(CreateManagerDto, { fullName: '', phone: '+7', password: 'Secret1' }), 400);
  await expectHttp(
    () => validateBody(CreateManagerDto, { fullName: 'Пётр', phone: '+79991112233', password: '123' }),
    400,
  );
  for (const percent of [-1, 100.01, 55.555, 'много']) {
    await expectHttp(
      () =>
        validateBody(CreateManagerDto, {
          fullName: 'Пётр',
          phone: '+79991112233',
          password: 'Secret1',
          ownerSharePercent: percent,
        }),
      400,
    );
  }
  for (const percent of [0, 100, 60, 33.33]) {
    const ok = await validateBody(UpdateManagerDto, { ownerSharePercent: percent });
    assert.equal(ok.ownerSharePercent, percent);
  }
  const update = await validateBody(UpdateManagerDto, { isActive: false, note: null, role: 'superadmin' });
  assert.equal(update.isActive, false);
  assert.equal(update.note, null);
  assert.ok(!('role' in update));
  await expectHttp(() => validateBody(UpdateManagerDto, { isActive: 'нет' }), 400);
});

test('UpdateManagerDto: null в fullName / phone / password / ownerSharePercent / isActive — 400, а не «сбросить»; note: null — очистить', async () => {
  // Регрессия живой проверки: с IsOptional `ownerSharePercent: null` проходил валидацию и молча
  // сбрасывал долю владельца в NULL (= 60 % по умолчанию); остальные null роняли сервис в 500.
  for (const field of ['fullName', 'phone', 'password', 'ownerSharePercent', 'isActive']) {
    await expectHttp(() => validateBody(UpdateManagerDto, { [field]: null }), 400);
  }
  const cleared = await validateBody(UpdateManagerDto, { note: null });
  assert.equal(cleared.note, null, 'null в заметке — штатное «очистить заметку»');
  // Не переданные поля не проверяются и не превращаются в null.
  const only = await validateBody(UpdateManagerDto, { isActive: true });
  assert.equal(only.isActive, true);
  assert.equal(only.ownerSharePercent, undefined);
  assert.equal(only.fullName, undefined);
  assert.equal(only.note, undefined);
});

test('CreateSettlementDto: сумма ≠ формат, дата ГГГГ-ММ-ДД; TransferTenantManagerDto: undefined — 400, null — «снять»', async () => {
  const ok = await validateBody(CreateSettlementDto, { amount: 3000, note: 'наличные', settledOn: '2026-09-30' });
  assert.equal(ok.amount, 3000);
  await validateBody(CreateSettlementDto, { amount: -500, note: 'корректировка' });
  await expectHttp(() => validateBody(CreateSettlementDto, {}), 400);
  await expectHttp(() => validateBody(CreateSettlementDto, { amount: '3000' }), 400);
  await expectHttp(() => validateBody(CreateSettlementDto, { amount: 10.005 }), 400);
  await expectHttp(() => validateBody(CreateSettlementDto, { amount: 100000000 }), 400);
  await expectHttp(() => validateBody(CreateSettlementDto, { amount: 10, settledOn: '30.09.2026' }), 400);

  const toManager = await validateBody(TransferTenantManagerDto, { managerId: OTHER_MANAGER_ID });
  assert.equal(toManager.managerId, OTHER_MANAGER_ID);
  const detach = await validateBody(TransferTenantManagerDto, { managerId: null });
  assert.equal(detach.managerId, null);
  await expectHttp(() => validateBody(TransferTenantManagerDto, {}), 400);
  await expectHttp(() => validateBody(TransferTenantManagerDto, { managerId: 'не-uuid' }), 400);
});

// ───────────────────────────────────────────────────────────────────────────
// З. TenantsService: снимок доли владельца и область видимости менеджера
// ───────────────────────────────────────────────────────────────────────────

const NOW_ISO = '2026-09-30T09:00:00.000Z';
const OLD_END_ISO = '2030-01-10T00:00:00.000Z';
const NEW_END_ISO = '2030-01-24T00:00:00.000Z';

const makeTenants = (pool, audit = fakeAudit(), jwt = fakeJwt()) => new TenantsService(pool, jwt, audit);
const auditActorOf = (userId, name = 'Актор аудита') => ({ userId, name });
const verbsOf = (pool) => pool.calls.map((c) => c.text.split(' ')[0]);
const insertPayment = (pool) => pool.calls.find((c) => c.text.startsWith('INSERT INTO subscription_payments'));
const subscriptionCacheKey = (tenantId) => `tenant-subscription:${tenantId}`;

function tenantRow(overrides = {}) {
  return {
    id: TENANT_ID,
    name: 'Автосервис «Восток»',
    is_active: true,
    plan_id: PLAN_ID,
    plan_name: 'Бизнес',
    manager_id: MANAGER_ID,
    subscription_end: OLD_END_ISO,
    monthly_price: '5000.00',
    max_users: 10,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Строка тенанта видна области `scopeManagerId` так же, как её видит предикат `($n::uuid IS NULL OR manager_id = $n::uuid)`. */
const visibleTo = (tenant, scopeManagerId) => scopeManagerId == null || scopeManagerId === tenant.manager_id;

/** Ответ UPDATE ... WHERE id = $1 AND ($n::uuid IS NULL OR manager_id = $n::uuid): строка или пусто. */
const scopedRows =
  (tenant, scopeIndex, patch = () => ({})) =>
  (params) =>
    params[0] === tenant.id && visibleTo(tenant, params[scopeIndex]) ? [{ ...tenant, ...patch(params) }] : [];

/**
 * Пул под TenantsService.extend. Повторяет то, что сделал бы Postgres: блокировка строки
 * тенанта отдаёт её только если `manager_id` подходит под предикат `$2`, а доля владельца
 * берётся из users по роли manager.
 */
function extendPool({
  tenant = tenantRow(),
  managers = { [MANAGER_ID]: { owner_share_percent: '60.00' } },
  insertError = null,
} = {}) {
  return fakePool([
    [/^(BEGIN|COMMIT|ROLLBACK)$/, []],
    [/FOR UPDATE OF t$/, (params) => (params[0] === tenant.id && visibleTo(tenant, params[1]) ? [tenant] : [])],
    [
      /^SELECT owner_share_percent FROM users WHERE id = \$1 AND role = 'manager'$/,
      (params) => (managers[params[0]] ? [managers[params[0]]] : []),
    ],
    [/AS anchor, CASE WHEN/, [{ anchor: NOW_ISO, new_end: NEW_END_ISO }]],
    [/^UPDATE tenants SET subscription_end = \$2/, (params) => [{ ...tenant, subscription_end: params[1] }]],
    [/^INSERT INTO subscription_payments/, insertError ?? { rows: [], rowCount: 1 }],
  ]);
}

test('extend: платное продление менеджером — снимок доли 60 % пишется в ТОЙ ЖЕ транзакции (5000 → 3000)', async () => {
  const key = subscriptionCacheKey(TENANT_ID);
  ttlCache.set(key, { found: true, isActive: true, subscriptionEndMs: 1 }, 30_000);
  const pool = extendPool();
  const audit = fakeAudit();

  const result = await makeTenants(pool, audit).extend(
    TENANT_ID,
    { type: 'paid', amount: 5000, days: 30, note: 'оплата наличными' },
    auditActorOf(MANAGER_ID, 'Иван Менеджеров'),
    { credit: { managerId: MANAGER_ID }, scope: { managerId: MANAGER_ID } },
  );

  assert.deepEqual(verbsOf(pool), ['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'UPDATE', 'INSERT', 'COMMIT']);
  assert.equal(pool.connects, 1);
  assert.equal(pool.released, 1, 'клиент пула обязан вернуться в пул');

  // Область видимости — прямо в блокирующем SELECT, до любой записи.
  const lock = pool.calls[1];
  assert.match(lock.text, /WHERE t\.id = \$1 AND \(\$2::uuid IS NULL OR t\.manager_id = \$2::uuid\) FOR UPDATE OF t$/);
  assert.deepEqual(lock.params, [TENANT_ID, MANAGER_ID]);

  // tenant_id, amount, is_free, period_from, period_to, previous_end, note, created_by,
  // manager_id, owner_share_percent, owner_share_amount, plan_id, plan_name.
  assert.deepEqual(insertPayment(pool).params, [
    TENANT_ID,
    5000,
    false,
    NOW_ISO,
    NEW_END_ISO,
    OLD_END_ISO,
    'оплата наличными',
    MANAGER_ID,
    MANAGER_ID,
    60,
    3000,
    PLAN_ID,
    'Бизнес',
  ]);

  assert.equal(result.id, TENANT_ID);
  assert.equal(result.subscriptionEnd, NEW_END_ISO);
  assert.equal('managerId' in result, false, 'RETURNING * не должен светить менеджера в ответе продления');

  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0].action, 'tenant_extend');
  assert.equal(audit.entries[0].target.targetId, TENANT_ID);
  assert.deepEqual(
    {
      type: audit.entries[0].target.detail.type,
      amount: audit.entries[0].target.detail.amount,
      managerId: audit.entries[0].target.detail.managerId,
      ownerSharePercent: audit.entries[0].target.detail.ownerSharePercent,
      ownerShareAmount: audit.entries[0].target.detail.ownerShareAmount,
    },
    { type: 'paid', amount: 5000, managerId: MANAGER_ID, ownerSharePercent: 60, ownerShareAmount: 3000 },
  );

  // После COMMIT кэш статуса подписки сброшен: продление снимает блокировку сразу, а не через 30 с.
  assert.equal(ttlCache.get(key), undefined);
});

for (const [label, stored, expectedPercent, expectedShare] of [
  ['60', '60.00', 60, 3000],
  ['33,33', '33.33', 33.33, 1666.5],
  ['0', '0.00', 0, 0],
  ['100', '100.00', 100, 5000],
  ['не задана (NULL) — по умолчанию 60', null, 60, 3000],
]) {
  test(`extend: доля менеджера ${label} % — в строке платежа процент и сумма (5000 → ${expectedShare})`, async () => {
    const pool = extendPool({ managers: { [MANAGER_ID]: { owner_share_percent: stored } } });
    await makeTenants(pool).extend(TENANT_ID, { type: 'paid', amount: 5000, days: 30 }, auditActorOf(MANAGER_ID), {
      credit: { managerId: MANAGER_ID },
      scope: { managerId: MANAGER_ID },
    });
    // manager_id, owner_share_percent, owner_share_amount. Процент 0 — это ЗАПИСЬ с нулевой долей
    // (менеджер принял деньги, владельцу с них ничего), а не «доли нет».
    assert.deepEqual(insertPayment(pool).params.slice(8, 11), [MANAGER_ID, expectedPercent, expectedShare]);
  });
}

test('extend: оплата, принятая владельцем напрямую (без credit), доли не даёт — менеджер даже не запрашивается', async () => {
  const pool = extendPool();
  await makeTenants(pool).extend(TENANT_ID, { type: 'paid', amount: 5000, days: 30 }, auditActorOf(SUPERADMIN_ID), {});
  assert.equal(
    pool.calls.some((c) => /FROM users/.test(c.text)),
    false,
  );
  const params = insertPayment(pool).params;
  assert.equal(params[7], SUPERADMIN_ID, 'created_by — кто внёс продление');
  assert.deepEqual(params.slice(8, 11), [null, null, null]);
  // Суперадмин без области видимости: предикат менеджера выключен (`$2 IS NULL`).
  assert.deepEqual(pool.calls[1].params, [TENANT_ID, null]);
});

test("extend: credit 'tenant-manager' (галочка суперадмина) — доля менеджеру, за которым закреплён тенант", async () => {
  const pool = extendPool({
    tenant: tenantRow({ manager_id: OTHER_MANAGER_ID }),
    managers: { [OTHER_MANAGER_ID]: { owner_share_percent: '40.00' } },
  });
  const audit = fakeAudit();
  await makeTenants(pool, audit).extend(
    TENANT_ID,
    { type: 'paid', amount: 5000, days: 30 },
    auditActorOf(SUPERADMIN_ID),
    { credit: 'tenant-manager' },
  );
  // created_by — суперадмин, а вот долг записан на менеджера тенанта (не на актора).
  assert.deepEqual(insertPayment(pool).params.slice(7, 11), [SUPERADMIN_ID, OTHER_MANAGER_ID, 40, 2000]);
  assert.equal(audit.entries[0].target.detail.managerId, OTHER_MANAGER_ID);
  assert.equal(audit.entries[0].target.detail.ownerShareAmount, 2000);
});

test("extend: credit 'tenant-manager' у тенанта без менеджера или с не-менеджером — доли нет, платёж записан", async () => {
  // Клиент ничей: галочка ничего не даёт, а сам платёж не теряется.
  const unassigned = extendPool({ tenant: tenantRow({ manager_id: null }) });
  await makeTenants(unassigned).extend(
    TENANT_ID,
    { type: 'paid', amount: 5000, days: 30 },
    auditActorOf(SUPERADMIN_ID),
    {
      credit: 'tenant-manager',
    },
  );
  assert.equal(
    unassigned.calls.some((c) => /FROM users/.test(c.text)),
    false,
  );
  assert.deepEqual(insertPayment(unassigned).params.slice(8, 11), [null, null, null]);
  assert.equal(insertPayment(unassigned).params[1], 5000);

  // За тенантом числится id, которого нет среди менеджеров (роль другая/пользователь удалён): долю
  // на директора или мастера записать нельзя — запрос идёт по `role = 'manager'` и ничего не находит.
  const notManager = extendPool({ managers: {} });
  await makeTenants(notManager).extend(
    TENANT_ID,
    { type: 'paid', amount: 5000, days: 30 },
    auditActorOf(SUPERADMIN_ID),
    {
      credit: 'tenant-manager',
    },
  );
  assert.equal(
    notManager.calls.some((c) => /role = 'manager'/.test(c.text)),
    true,
  );
  assert.deepEqual(insertPayment(notManager).params.slice(8, 11), [null, null, null]);
});

test('extend: БЕСПЛАТНОЕ продление доли не даёт никогда — даже с credit менеджера', async () => {
  const pool = extendPool();
  await makeTenants(pool).extend(TENANT_ID, { type: 'free', days: 14 }, auditActorOf(MANAGER_ID), {
    credit: { managerId: MANAGER_ID },
    scope: { managerId: MANAGER_ID },
  });
  assert.equal(
    pool.calls.some((c) => /FROM users/.test(c.text)),
    false,
  );
  const params = insertPayment(pool).params;
  assert.equal(params[1], 0, 'сумма бесплатного продления — 0');
  assert.equal(params[2], true, 'is_free');
  assert.deepEqual(params.slice(8, 11), [null, null, null]);
});

test('extend: чужой и «ничей» клиент под областью менеджера — 404 ДО записи (ROLLBACK, без UPDATE/INSERT/COMMIT)', async () => {
  for (const managerId of [OTHER_MANAGER_ID, null]) {
    const pool = extendPool({ tenant: tenantRow({ manager_id: managerId }) });
    const audit = fakeAudit();
    await expectHttp(
      () =>
        makeTenants(pool, audit).extend(TENANT_ID, { type: 'paid', amount: 5000, days: 30 }, auditActorOf(MANAGER_ID), {
          credit: { managerId: MANAGER_ID },
          scope: { managerId: MANAGER_ID },
        }),
      404,
      'Тенант не найден',
    );
    assert.deepEqual(verbsOf(pool), ['BEGIN', 'SELECT', 'ROLLBACK'], `manager_id тенанта: ${managerId}`);
    assert.equal(pool.released, 1);
    assert.equal(audit.entries.length, 0);
  }
});

test('extend: неверные входные данные отбиваются 400 ДО соединения с БД (catch метода превращает всё остальное в 500)', async () => {
  const cases = [
    [{ type: 'paid', days: 30 }, 'Для платного продления укажите сумму больше нуля'],
    [{ type: 'paid', amount: 0, days: 30 }, 'Для платного продления укажите сумму больше нуля'],
    [{ type: 'paid', amount: -100, days: 30 }, 'Для платного продления укажите сумму больше нуля'],
    [{ type: 'free' }, 'Укажите дату (until) или количество дней (days)'],
    [{ type: 'free', days: 0 }, 'Укажите дату (until) или количество дней (days)'],
    [{ type: 'free', until: '2020-01-01T00:00:00.000Z' }, 'Дата продления должна быть в будущем'],
    [{ type: 'free', until: 'не дата' }, 'Дата продления должна быть в будущем'],
  ];
  for (const [opts, message] of cases) {
    const pool = extendPool();
    await expectHttp(
      () =>
        makeTenants(pool).extend(TENANT_ID, opts, auditActorOf(MANAGER_ID), {
          credit: { managerId: MANAGER_ID },
          scope: { managerId: MANAGER_ID },
        }),
      400,
      message,
    );
    assert.equal(pool.connects, 0, `${JSON.stringify(opts)}: соединение не берётся`);
  }
});

test('extend: сбой INSERT платежа откатывает ВСЁ (ни продления без строки доли, ни строки доли без продления)', async () => {
  const pool = extendPool({ insertError: new Error('deadlock detected') });
  const audit = fakeAudit();
  await expectHttp(
    () =>
      makeTenants(pool, audit).extend(TENANT_ID, { type: 'paid', amount: 5000, days: 30 }, auditActorOf(MANAGER_ID), {
        credit: { managerId: MANAGER_ID },
        scope: { managerId: MANAGER_ID },
      }),
    500,
    'Ошибка при продлении подписки',
  );
  assert.deepEqual(verbsOf(pool), ['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'UPDATE', 'INSERT', 'ROLLBACK']);
  assert.equal(pool.released, 1);
  assert.equal(audit.entries.length, 0, 'аудит пишется только после COMMIT');
});

test('assignPlan: тариф чужому клиенту менеджера — 404, чужой строки UPDATE не задевает', async () => {
  const tenant = tenantRow();
  const plan = { id: PLAN_ID, name: 'Бизнес', monthly_price: '5000.00', max_users: 10 };
  const routes = (t) => [
    [/^SELECT id, name, monthly_price, max_users FROM plans WHERE id = \$1$/, (p) => (p[0] === PLAN_ID ? [plan] : [])],
    [
      /^UPDATE tenants SET plan_id = \$2/,
      scopedRows(t, 4, (p) => ({ plan_id: p[1], monthly_price: p[2], max_users: p[3] })),
    ],
  ];

  const own = fakePool(routes(tenant));
  const audit = fakeAudit();
  const updated = await makeTenants(own, audit).assignPlan(TENANT_ID, PLAN_ID, auditActorOf(MANAGER_ID), {
    managerId: MANAGER_ID,
  });
  assert.equal(updated.planId, PLAN_ID);
  assert.match(own.calls[1].text, /WHERE id = \$1 AND \(\$5::uuid IS NULL OR manager_id = \$5::uuid\) RETURNING \*$/);
  assert.deepEqual(own.calls[1].params, [TENANT_ID, PLAN_ID, '5000.00', 10, MANAGER_ID]);
  assert.deepEqual(
    audit.entries.map((e) => [e.action, e.target.detail]),
    [['tenant_change_plan', { planId: PLAN_ID, planName: 'Бизнес' }]],
  );

  const foreignAudit = fakeAudit();
  const foreign = fakePool(routes(tenantRow({ manager_id: OTHER_MANAGER_ID })));
  await expectHttp(
    () =>
      makeTenants(foreign, foreignAudit).assignPlan(TENANT_ID, PLAN_ID, auditActorOf(MANAGER_ID), {
        managerId: MANAGER_ID,
      }),
    404,
    'Тенант не найден',
  );
  assert.equal(foreignAudit.entries.length, 0);

  // Суперадмин — без области видимости (`$5 IS NULL`), как и раньше.
  const superadmin = fakePool(routes(tenantRow({ manager_id: OTHER_MANAGER_ID })));
  await makeTenants(superadmin).assignPlan(TENANT_ID, PLAN_ID, auditActorOf(SUPERADMIN_ID), {});
  assert.equal(superadmin.calls[1].params[4], null);

  // Несуществующий тариф — 404 «Тариф не найден» и никакого UPDATE.
  const noPlan = fakePool(routes(tenant));
  await expectHttp(
    () =>
      makeTenants(noPlan).assignPlan(TENANT_ID, '99999999-9999-4999-8999-999999999999', auditActorOf(MANAGER_ID), {
        managerId: MANAGER_ID,
      }),
    404,
    'Тариф не найден',
  );
  assert.equal(
    noPlan.calls.some((c) => c.text.startsWith('UPDATE')),
    false,
  );
});

test('suspend / unsuspend: своему клиенту — можно (кэш подписки сброшен), чужому — 404 без записи и аудита', async () => {
  const key = subscriptionCacheKey(TENANT_ID);
  const routes = (t) => [
    [
      /^UPDATE tenants SET suspended_at = COALESCE/,
      scopedRows(t, 2, (p) => ({ is_active: false, suspended_at: NOW_ISO, suspended_reason: p[1] })),
    ],
    [
      /^UPDATE tenants SET suspended_at = NULL/,
      scopedRows(t, 1, () => ({ is_active: true, suspended_at: null, suspended_reason: null })),
    ],
  ];

  ttlCache.set(key, { found: true, isActive: true, subscriptionEndMs: null }, 30_000);
  const own = fakePool(routes(tenantRow()));
  const audit = fakeAudit();
  const service = makeTenants(own, audit);
  const suspended = await service.suspend(TENANT_ID, 'неоплата', auditActorOf(MANAGER_ID), { managerId: MANAGER_ID });
  assert.equal(suspended.isActive, false);
  assert.equal(suspended.suspendedReason, 'неоплата');
  assert.deepEqual(own.calls[0].params, [TENANT_ID, 'неоплата', MANAGER_ID]);
  assert.equal(ttlCache.get(key), undefined, 'приостановка действует сразу, а не через TTL кэша');

  const lifted = await service.unsuspend(TENANT_ID, auditActorOf(MANAGER_ID), { managerId: MANAGER_ID }, 'оплатил');
  assert.equal(lifted.isActive, true);
  assert.deepEqual(own.calls[1].params, [TENANT_ID, MANAGER_ID]);
  assert.deepEqual(
    audit.entries.map((e) => [e.action, e.target.detail]),
    [
      ['tenant_suspend', { reason: 'неоплата' }],
      ['tenant_unsuspend', { reason: 'оплатил' }],
    ],
  );

  const foreignAudit = fakeAudit();
  const foreign = makeTenants(fakePool(routes(tenantRow({ manager_id: OTHER_MANAGER_ID }))), foreignAudit);
  await expectHttp(
    () => foreign.suspend(TENANT_ID, 'x', auditActorOf(MANAGER_ID), { managerId: MANAGER_ID }),
    404,
    'Тенант не найден',
  );
  await expectHttp(
    () => foreign.unsuspend(TENANT_ID, auditActorOf(MANAGER_ID), { managerId: MANAGER_ID }),
    404,
    'Тенант не найден',
  );
  assert.equal(foreignAudit.entries.length, 0);

  // Суперадмин: область не задана — параметр scope = NULL, поведение прежнее (в т.ч. пустое тело unsuspend).
  const superadminPool = fakePool(routes(tenantRow({ manager_id: OTHER_MANAGER_ID })));
  const superAudit = fakeAudit();
  await makeTenants(superadminPool, superAudit).suspend(TENANT_ID, undefined, auditActorOf(SUPERADMIN_ID), {});
  await makeTenants(superadminPool, superAudit).unsuspend(TENANT_ID, auditActorOf(SUPERADMIN_ID), {});
  assert.deepEqual(superadminPool.calls[0].params, [TENANT_ID, null, null]);
  assert.deepEqual(superadminPool.calls[1].params, [TENANT_ID, null]);
  assert.deepEqual(
    superAudit.entries.map((e) => e.target.detail),
    [{ reason: null }, {}],
  );
});

const directorRow = () => ({
  id: DIRECTOR_ID,
  phone: '+79990001122',
  full_name: 'Пётр Владелец',
  username: null,
  avatar: null,
  role: 'director',
  salary_percent: '0',
  permissions: '{"checks_view":true}',
  is_active: true,
  tenant_id: TENANT_ID,
  created_at: '2026-01-01T00:00:00.000Z',
});

function impersonationPool(tenant = tenantRow(), director = directorRow()) {
  return fakePool([
    [
      /^SELECT id FROM tenants WHERE id = \$1 AND \(\$2::uuid IS NULL OR manager_id = \$2::uuid\)$/,
      scopedRows(tenant, 1),
    ],
    [
      /FROM users WHERE tenant_id = \$1 AND role = 'director'/,
      (p) => (director && p[0] === tenant.id ? [director] : []),
    ],
  ]);
}

test('impersonate: менеджер входит только к СВОЕМУ клиенту и получает токен директора — не выше него, без ролей платформы', async () => {
  const pool = impersonationPool();
  const jwt = fakeJwt();
  const audit = fakeAudit();
  const result = await makeTenants(pool, audit, jwt).impersonate(TENANT_ID, auditActorOf(MANAGER_ID, 'Иван'), {
    managerId: MANAGER_ID,
  });

  assert.deepEqual(pool.calls[0].params, [TENANT_ID, MANAGER_ID], 'принадлежность клиента проверена тем же запросом');
  assert.equal(jwt.signCalls.length, 1);
  const { payload, options } = jwt.signCalls[0];
  assert.equal(payload.sub, DIRECTOR_ID, 'токен выпущен на владельца-директора клиента, а не на менеджера');
  assert.equal(payload.tenantId, TENANT_ID);
  assert.equal(payload.impersonatedBy, MANAGER_ID, 'аудит видит, кто вошёл');
  assert.equal(typeof payload.jti, 'string');
  assert.equal('role' in payload, false, 'в токене нет роли: её JwtStrategy берёт из БД по sub');
  assert.deepEqual(options, { expiresIn: '30m' });
  assert.equal(result.expiresIn, 1800);
  assert.equal(result.user.role, 'director', 'выше директора войти нельзя');
  assert.equal(result.user.tenantId, TENANT_ID);
  assert.deepEqual(result.user.permissions, { checks_view: true });

  assert.equal(audit.entries[0].action, 'impersonate');
  assert.equal(audit.entries[0].actor.userId, MANAGER_ID);
  assert.deepEqual(audit.entries[0].target.detail, { tenantId: TENANT_ID, impersonatedUserId: DIRECTOR_ID });
});

test('impersonate: чужой клиент — 404 и НИКАКОГО токена (владельца даже не ищем); клиент без владельца — 404', async () => {
  const foreignPool = impersonationPool(tenantRow({ manager_id: OTHER_MANAGER_ID }));
  const jwt = fakeJwt();
  const audit = fakeAudit();
  await expectHttp(
    () =>
      makeTenants(foreignPool, audit, jwt).impersonate(TENANT_ID, auditActorOf(MANAGER_ID), { managerId: MANAGER_ID }),
    404,
    'Тенант не найден',
  );
  assert.equal(
    foreignPool.calls.length,
    1,
    'после проверки принадлежности запросов нет — про владельца чужого клиента ничего не узнать',
  );
  assert.equal(jwt.signCalls.length, 0);
  assert.equal(audit.entries.length, 0);

  const emptyPool = impersonationPool(tenantRow(), null);
  await expectHttp(
    () =>
      makeTenants(emptyPool, audit, jwt).impersonate(TENANT_ID, auditActorOf(MANAGER_ID), { managerId: MANAGER_ID }),
    404,
    'У тенанта нет активного владельца',
  );
  assert.equal(jwt.signCalls.length, 0);

  // Суперадмин по-прежнему входит к любому клиенту.
  const superadminPool = impersonationPool(tenantRow({ manager_id: OTHER_MANAGER_ID }));
  const superJwt = fakeJwt();
  await makeTenants(superadminPool, fakeAudit(), superJwt).impersonate(TENANT_ID, auditActorOf(SUPERADMIN_ID), {});
  assert.equal(superJwt.signCalls.length, 1);
  assert.equal(superJwt.signCalls[0].payload.impersonatedBy, SUPERADMIN_ID);
});

test('create (суперадмин): managerId проверяется ДО транзакции — не uuid и не менеджер дают 400, а не «Ошибка сервера»', async () => {
  const dto = { name: 'СТО «Север»', planId: PLAN_ID };

  const badFormat = fakePool();
  await expectHttp(
    () => makeTenants(badFormat).create({ ...dto, managerId: 'не-uuid' }),
    400,
    'Некорректный идентификатор менеджера',
  );
  await expectHttp(
    () => makeTenants(badFormat).create({ ...dto, managerId: 42 }),
    400,
    'Некорректный идентификатор менеджера',
  );
  assert.equal(badFormat.calls.length, 0);
  assert.equal(badFormat.connects, 0);

  const unknownManager = fakePool([[/FROM users WHERE id = \$1 AND role = 'manager' AND is_active = true$/, []]]);
  await expectHttp(
    () => makeTenants(unknownManager).create({ ...dto, managerId: OTHER_MANAGER_ID }),
    400,
    'Менеджер не найден или отключён',
  );
  assert.equal(unknownManager.connects, 0);
});

test('create (суперадмин): с managerId клиент закрепляется за менеджером и это видно в ответе и аудите; без него — как раньше', async () => {
  const insertTenants = [
    /^INSERT INTO tenants \(name, phone/,
    (p) => [{ id: TENANT_ID, name: p[0], is_active: true, plan_id: p[7], manager_id: p[11], created_at: NOW_ISO }],
  ];
  const withManager = fakePool([
    [
      /FROM users WHERE id = \$1 AND role = 'manager' AND is_active = true$/,
      [{ id: MANAGER_ID, full_name: 'Иван Менеджеров' }],
    ],
    insertTenants,
  ]);
  const audit = fakeAudit();
  const created = await makeTenants(withManager, audit).create(
    { name: 'СТО «Север»', planId: PLAN_ID, managerId: MANAGER_ID },
    auditActorOf(SUPERADMIN_ID),
  );
  const insert = withManager.calls.find((c) => c.text.startsWith('INSERT INTO tenants'));
  assert.equal(insert.params[11], MANAGER_ID);
  assert.match(insert.text, /manager_id\)/);
  assert.equal(created.managerId, MANAGER_ID);
  assert.equal(created.managerName, 'Иван Менеджеров');
  assert.deepEqual(
    audit.entries.map((e) => [e.action, e.target.detail]),
    [['tenant_create', { managerId: MANAGER_ID, planId: PLAN_ID }]],
  );
  assert.equal(verbsOf(withManager).at(-1), 'COMMIT');

  const plain = fakePool([insertTenants]);
  const plainCreated = await makeTenants(plain).create({ name: 'СТО «Юг»', planId: PLAN_ID });
  assert.equal(
    plain.calls.some((c) => /role = 'manager'/.test(c.text)),
    false,
  );
  assert.equal(plain.calls.find((c) => c.text.startsWith('INSERT INTO tenants')).params[11], null);
  assert.equal(plainCreated.managerId, null);
});

// ───────────────────────────────────────────────────────────────────────────
// И. TenantsService: чтение — список, кабинет клиента, метрики, форма платежа, статус
// ───────────────────────────────────────────────────────────────────────────

const FUTURE_ISO = '2099-01-01T00:00:00.000Z';
const PAST_ISO = '2020-01-01T00:00:00.000Z';
const LIST_JOIN = /LEFT JOIN users mgr ON mgr\.id = t\.manager_id/;

function listRow(overrides = {}) {
  return {
    id: TENANT_ID,
    name: 'Автосервис «Восток»',
    slug: 'vostok',
    is_active: true,
    suspended_at: null,
    suspended_reason: null,
    subscription_end: FUTURE_ISO,
    plan_id: PLAN_ID,
    plan_name: 'Бизнес',
    plan_monthly_price: '5000.00',
    plan_max_users: 10,
    plan_description: 'Для сервисов до 10 сотрудников',
    monthly_price: '5000.00',
    max_users: 10,
    user_count: '4',
    manager_id: MANAGER_ID,
    manager_name: 'Иван Менеджеров',
    created_at: '2026-01-01T00:00:00.000Z',
    last_payment_id: null,
    current_period_kind: null,
    ...overrides,
  };
}

test('getAll: без фильтра — все клиенты и ни одного параметра запроса (поведение суперадмина не изменилось)', async () => {
  const pool = fakePool([
    [LIST_JOIN, [listRow(), listRow({ id: FOREIGN_TENANT_ID, manager_id: OTHER_MANAGER_ID, manager_name: 'Пётр' })]],
  ]);
  const rows = await makeTenants(pool).getAll();
  assert.deepEqual(
    rows.map((t) => t.id),
    [TENANT_ID, FOREIGN_TENANT_ID],
  );
  assert.deepEqual(pool.calls[0].params, []);
  assert.doesNotMatch(pool.calls[0].text, /WHERE t\./);
  assert.match(pool.calls[0].text, /ORDER BY t\.created_at DESC$/);
});

for (const [label, filter, expectedParams, expectedWhere] of [
  [
    'менеджер — только свои клиенты',
    { managerId: MANAGER_ID },
    [MANAGER_ID],
    /WHERE t\.manager_id = \$1::uuid ORDER BY t\.created_at DESC$/,
  ],
  [
    'менеджер + карточка одного клиента',
    { managerId: MANAGER_ID, id: TENANT_ID },
    [MANAGER_ID, TENANT_ID],
    /WHERE t\.manager_id = \$1::uuid AND t\.id = \$2::uuid ORDER BY t\.created_at DESC$/,
  ],
  [
    'один клиент без менеджера (суперадмин в кабинете)',
    { id: TENANT_ID },
    [TENANT_ID],
    /WHERE t\.id = \$1::uuid ORDER BY/,
  ],
  [
    'пустая строка НЕ снимает ограничение (fail-closed: сузить можно, расширить нельзя)',
    { managerId: '' },
    [''],
    /WHERE t\.manager_id = \$1::uuid ORDER BY/,
  ],
]) {
  test(`getAll: область видимости — ${label}`, async () => {
    const pool = fakePool([[LIST_JOIN, [listRow()]]]);
    await makeTenants(pool).getAll(filter);
    assert.deepEqual(pool.calls[0].params, expectedParams);
    assert.match(pool.calls[0].text, expectedWhere);
  });
}

test('getAll: managerId null/undefined (суперадмин) — без предиката менеджера', async () => {
  for (const managerId of [null, undefined]) {
    const pool = fakePool([[LIST_JOIN, [listRow()]]]);
    await makeTenants(pool).getAll({ managerId });
    assert.deepEqual(pool.calls[0].params, []);
    assert.doesNotMatch(pool.calls[0].text, /WHERE t\./);
  }
});

test('getAll: фильтр status — единое правило (suspended главнее expired; is_active=false — приостановлен; срока нет — активен)', async () => {
  const rows = [
    listRow({ id: 'active-with-end', subscription_end: FUTURE_ISO }),
    listRow({ id: 'active-no-end', subscription_end: null }),
    listRow({ id: 'expired', subscription_end: PAST_ISO }),
    listRow({ id: 'suspended-and-lapsed', suspended_at: PAST_ISO, subscription_end: PAST_ISO }),
    listRow({ id: 'legacy-disabled', is_active: false }),
  ];
  const idsFor = async (status) => {
    const pool = fakePool([[LIST_JOIN, rows]]);
    const result = await makeTenants(pool).getAll({ managerId: MANAGER_ID, status });
    assert.deepEqual(pool.calls[0].params, [MANAGER_ID], 'статус фильтруется в JS, а не подменяет область видимости');
    return result.map((t) => t.id);
  };
  assert.deepEqual(await idsFor('active'), ['active-with-end', 'active-no-end']);
  assert.deepEqual(await idsFor('expired'), ['expired']);
  assert.deepEqual(await idsFor('suspended'), ['suspended-and-lapsed', 'legacy-disabled']);
  assert.equal((await idsFor(undefined)).length, 5);
});

test('getAll: строка клиента — менеджер, тариф, последний платёж со снимком доли и признак периода', async () => {
  const row = listRow({
    last_payment_id: '88888888-8888-4888-8888-888888888888',
    last_payment_amount: '5000.00',
    last_payment_is_free: false,
    last_payment_period_from: NOW_ISO,
    last_payment_period_to: FUTURE_ISO,
    last_payment_previous_end: NOW_ISO,
    last_payment_note: 'наличные',
    last_payment_created_by: MANAGER_ID,
    last_payment_created_at: NOW_ISO,
    last_payment_manager_id: MANAGER_ID,
    last_payment_owner_share_percent: '60.00',
    last_payment_owner_share_amount: '3000.00',
    last_payment_plan_id: PLAN_ID,
    last_payment_plan_name: 'Бизнес',
    current_period_kind: 'paid',
  });
  const [tenant] = await makeTenants(fakePool([[LIST_JOIN, [row]]])).getAll({ managerId: MANAGER_ID });

  assert.equal(tenant.managerId, MANAGER_ID);
  assert.equal(tenant.managerName, 'Иван Менеджеров');
  assert.equal(tenant.userCount, 4);
  assert.deepEqual(tenant.plan, {
    id: PLAN_ID,
    name: 'Бизнес',
    monthlyPrice: 5000,
    maxUsers: 10,
    description: 'Для сервисов до 10 сотрудников',
  });
  assert.equal(tenant.currentPeriodKind, 'paid');
  assert.deepEqual(tenant.lastPayment, {
    id: '88888888-8888-4888-8888-888888888888',
    tenantId: TENANT_ID,
    amount: 5000,
    isFree: false,
    periodFrom: NOW_ISO,
    periodTo: FUTURE_ISO,
    previousEnd: NOW_ISO,
    note: 'наличные',
    createdBy: MANAGER_ID,
    createdAt: NOW_ISO,
    managerId: MANAGER_ID,
    ownerSharePercent: 60,
    ownerShareAmount: 3000,
    planId: PLAN_ID,
    planName: 'Бизнес',
  });
});

test('getAll: «ничей» клиент — managerId/managerName равны null, а не пропадают; легаси-платёж без снимка — null-поля', async () => {
  const row = listRow({
    manager_id: null,
    manager_name: null,
    last_payment_id: '88888888-8888-4888-8888-888888888888',
    last_payment_amount: '3000.00',
    last_payment_is_free: false,
    last_payment_manager_id: null,
    last_payment_owner_share_percent: null,
    last_payment_owner_share_amount: null,
    last_payment_plan_id: null,
    last_payment_plan_name: null,
  });
  const [tenant] = await makeTenants(fakePool([[LIST_JOIN, [row]]])).getAll();
  assert.equal(tenant.managerId, null);
  assert.equal(tenant.managerName, null);
  assert.equal('managerId' in tenant, true);
  assert.deepEqual(
    [
      tenant.lastPayment.managerId,
      tenant.lastPayment.ownerSharePercent,
      tenant.lastPayment.ownerShareAmount,
      tenant.lastPayment.planId,
      tenant.lastPayment.planName,
    ],
    [null, null, null, null, null],
  );
});

test('поля менеджера не попадают в ответы без join’а: владелец автосервиса не узнаёт id менеджера платформы', async () => {
  // suspend/assignPlan/extend отдают RETURNING * тенанта — той же формой пользуется и /my-company.
  const tenant = tenantRow({ manager_id: MANAGER_ID });
  const pool = fakePool([[/^UPDATE tenants SET suspended_at = COALESCE/, scopedRows(tenant, 2)]]);
  const suspended = await makeTenants(pool).suspend(TENANT_ID, 'проверка', auditActorOf(SUPERADMIN_ID), {});
  assert.equal('managerId' in suspended, false);
  assert.equal('managerName' in suspended, false);
  assert.equal(
    JSON.stringify(suspended).includes(MANAGER_ID),
    false,
    'id менеджера не должен просочиться в JSON ответа',
  );
});

const cabinetRow = (overrides = {}) => ({
  id: TENANT_ID,
  name: 'Автосервис «Восток»',
  is_active: true,
  suspended_at: null,
  suspended_reason: null,
  subscription_end: FUTURE_ISO,
  monthly_price: '5000.00',
  max_users: 10,
  plan_id: PLAN_ID,
  created_at: '2026-01-01T00:00:00.000Z',
  manager_id: MANAGER_ID,
  current_users: '4',
  plan_name: 'Бизнес',
  manager_name: 'Иван Менеджеров',
  last_payment_id: null,
  current_period_kind: null,
  ...overrides,
});

const METRICS_ROW = {
  users_count: '4',
  active_users_count: '3',
  checks_total: '12',
  checks_last_30d: '5',
  revenue_total: '120000.50',
  revenue_last_30d: '30000.00',
  last_activity_at: '2026-09-29T10:00:00.000Z',
  products_count: '7',
};

/** Пул под getCabinet/getMetrics: оба запроса к tenants отдают строку только своему менеджеру. */
function cabinetPool(row = cabinetRow(), metrics = METRICS_ROW) {
  return fakePool([
    [
      /^SELECT t\.id, t\.name, t\.is_active, t\.suspended_at/,
      (p) => (p[0] === row.id && visibleTo(row, p[1]) ? [row] : []),
    ],
    [
      /^SELECT created_at FROM tenants WHERE id = \$1 AND \(\$2::uuid IS NULL OR manager_id = \$2::uuid\)$/,
      (p) => (p[0] === row.id && visibleTo(row, p[1]) ? [{ created_at: row.created_at }] : []),
    ],
    [/AS users_count/, [metrics]],
  ]);
}

test('getCabinet: свой клиент — форма ответа целиком; область видимости в ОБОИХ запросах к tenants', async () => {
  const pool = cabinetPool();
  const cabinet = await makeTenants(pool).getCabinet(TENANT_ID, { managerId: MANAGER_ID });

  assert.deepEqual(cabinet, {
    id: TENANT_ID,
    name: 'Автосервис «Восток»',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    managerId: MANAGER_ID,
    managerName: 'Иван Менеджеров',
    subscription: {
      status: 'active',
      planId: PLAN_ID,
      planName: 'Бизнес',
      planPrice: 5000,
      subscriptionEnd: FUTURE_ISO,
      suspendedAt: null,
      suspendedReason: null,
      maxUsers: 10,
      currentUsers: 4,
      lastPayment: null,
      currentPeriodKind: null,
    },
    metrics: {
      usersCount: 4,
      activeUsersCount: 3,
      checksTotal: 12,
      checksLast30d: 5,
      revenueTotal: 120000.5,
      revenueLast30d: 30000,
      lastActivityAt: '2026-09-29T10:00:00.000Z',
      productsCount: 7,
    },
  });

  assert.equal(pool.calls.length, 3);
  assert.match(pool.calls[0].text, /WHERE t\.id = \$1 AND \(\$2::uuid IS NULL OR t\.manager_id = \$2::uuid\)$/);
  assert.deepEqual(pool.calls[0].params, [TENANT_ID, MANAGER_ID]);
  assert.deepEqual(pool.calls[1].params, [TENANT_ID, MANAGER_ID], 'getMetrics перепроверяет принадлежность сам');
  assert.deepEqual(pool.calls[2].params, [TENANT_ID], 'агрегаты — по id, который уже прошёл обе проверки');
});

test('getCabinet / getMetrics: чужой и «ничей» клиент — 404 после ОДНОГО запроса, метрики чужого клиента не считаются', async () => {
  for (const managerId of [OTHER_MANAGER_ID, null]) {
    const cabinet = cabinetPool(cabinetRow({ manager_id: managerId }));
    await expectHttp(
      () => makeTenants(cabinet).getCabinet(TENANT_ID, { managerId: MANAGER_ID }),
      404,
      'Тенант не найден',
    );
    assert.equal(cabinet.calls.length, 1, `manager_id тенанта ${managerId}: агрегатов по чужому клиенту нет`);

    const metrics = cabinetPool(cabinetRow({ manager_id: managerId }));
    await expectHttp(
      () => makeTenants(metrics).getMetrics(TENANT_ID, { managerId: MANAGER_ID }),
      404,
      'Тенант не найден',
    );
    assert.equal(metrics.calls.length, 1);
  }
});

test('getCabinet / getMetrics: суперадмин без области видит любого клиента (параметр области = NULL)', async () => {
  const pool = cabinetPool(cabinetRow({ manager_id: OTHER_MANAGER_ID }));
  const cabinet = await makeTenants(pool).getCabinet(TENANT_ID);
  assert.equal(cabinet.managerId, OTHER_MANAGER_ID);
  assert.equal(pool.calls[0].params[1], null);
  assert.equal(pool.calls[1].params[1], null);
});

test('getMetrics: у клиента без единого чека — нули, а дата активности откатывается на дату создания клиента', async () => {
  const pool = cabinetPool(cabinetRow(), {
    users_count: '1',
    active_users_count: '1',
    checks_total: '0',
    checks_last_30d: '0',
    revenue_total: '0',
    revenue_last_30d: '0',
    last_activity_at: null,
    products_count: '0',
  });
  const metrics = await makeTenants(pool).getMetrics(TENANT_ID, { managerId: MANAGER_ID });
  assert.deepEqual(metrics, {
    usersCount: 1,
    activeUsersCount: 1,
    checksTotal: 0,
    checksLast30d: 0,
    revenueTotal: 0,
    revenueLast30d: 0,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    productsCount: 0,
  });
});

test('getCabinet: статус подписки — тот же computeSubscriptionStatusOf, что и в списке; последний платёж со снимком доли', async () => {
  const row = cabinetRow({
    is_active: false,
    suspended_at: PAST_ISO,
    suspended_reason: 'неоплата',
    subscription_end: PAST_ISO,
    last_payment_id: '88888888-8888-4888-8888-888888888888',
    last_payment_amount: '2500.00',
    last_payment_is_free: false,
    last_payment_manager_id: MANAGER_ID,
    last_payment_owner_share_percent: '60.00',
    last_payment_owner_share_amount: '1500.00',
    current_period_kind: 'paid',
  });
  const { subscription } = await makeTenants(cabinetPool(row)).getCabinet(TENANT_ID, { managerId: MANAGER_ID });
  assert.equal(subscription.status, 'suspended', 'приостановка главнее истёкшего срока');
  assert.equal(subscription.suspendedReason, 'неоплата');
  assert.equal(subscription.currentPeriodKind, 'paid');
  assert.equal(subscription.lastPayment.ownerShareAmount, 1500);
  assert.equal(subscription.lastPayment.managerId, MANAGER_ID);
});

test('mapSubscriptionPayment: NUMERIC → числа; снимок доли у легаси-платежа — null, а «доля 0» — это 0, а не null', () => {
  const service = makeTenants(fakePool());
  const full = service.mapSubscriptionPayment({
    id: 'p1',
    tenant_id: TENANT_ID,
    amount: '5000.00',
    is_free: false,
    period_from: NOW_ISO,
    period_to: NEW_END_ISO,
    previous_end: OLD_END_ISO,
    note: null,
    created_by: MANAGER_ID,
    created_at: NOW_ISO,
    manager_id: MANAGER_ID,
    owner_share_percent: '60.00',
    owner_share_amount: '3000.00',
    plan_id: PLAN_ID,
    plan_name: 'Бизнес',
  });
  assert.deepEqual(full, {
    id: 'p1',
    tenantId: TENANT_ID,
    amount: 5000,
    isFree: false,
    periodFrom: NOW_ISO,
    periodTo: NEW_END_ISO,
    previousEnd: OLD_END_ISO,
    note: null,
    createdBy: MANAGER_ID,
    createdAt: NOW_ISO,
    managerId: MANAGER_ID,
    ownerSharePercent: 60,
    ownerShareAmount: 3000,
    planId: PLAN_ID,
    planName: 'Бизнес',
  });

  const legacy = service.mapSubscriptionPayment({ id: 'p0', tenant_id: TENANT_ID, amount: '1000', is_free: false });
  assert.deepEqual(
    [legacy.managerId, legacy.ownerSharePercent, legacy.ownerShareAmount, legacy.planId, legacy.planName],
    [null, null, null, null, null],
  );

  const zeroShare = service.mapSubscriptionPayment({
    id: 'p2',
    tenant_id: TENANT_ID,
    amount: '5000',
    is_free: false,
    manager_id: MANAGER_ID,
    owner_share_percent: '0.00',
    owner_share_amount: '0.00',
  });
  assert.equal(zeroShare.ownerSharePercent, 0);
  assert.equal(zeroShare.ownerShareAmount, 0);
  assert.equal(zeroShare.managerId, MANAGER_ID);
});

test('computeSubscriptionStatusOf: полная матрица статусов', () => {
  const cases = [
    [{ is_active: true, suspended_at: null, subscription_end: FUTURE_ISO }, 'active'],
    [{ is_active: true, suspended_at: null, subscription_end: null }, 'active'],
    [{ is_active: true }, 'active'],
    [{ is_active: null, suspended_at: null, subscription_end: FUTURE_ISO }, 'active'],
    [{ is_active: true, suspended_at: null, subscription_end: PAST_ISO }, 'expired'],
    [{ is_active: true, suspended_at: PAST_ISO, subscription_end: FUTURE_ISO }, 'suspended'],
    [{ is_active: true, suspended_at: PAST_ISO, subscription_end: PAST_ISO }, 'suspended'],
    [{ is_active: false, suspended_at: null, subscription_end: FUTURE_ISO }, 'suspended'],
    [{ is_active: false, suspended_at: null, subscription_end: PAST_ISO }, 'suspended'],
  ];
  for (const [row, expected] of cases) {
    assert.equal(computeSubscriptionStatusOf(row), expected, JSON.stringify(row));
  }
});

// ───────────────────────────────────────────────────────────────────────────
// К. ManagerCabinetService: сводка, область видимости, создание клиента, продления, сброс пароля
// ───────────────────────────────────────────────────────────────────────────

const settingsWith = (days = 30) => ({ getManagerMaxFreeDays: async () => days });

/** TenantsService-заглушка кабинета: пишет вызовы и отдаёт «свою» карточку клиента. */
function tenantsStub({ views = [listRow()], created = { tenant: { id: TENANT_ID } }, createError } = {}) {
  const calls = [];
  const record =
    (method, result) =>
    async (...args) => {
      calls.push({ method, args });
      return typeof result === 'function' ? result(...args) : result;
    };
  return {
    calls,
    views,
    callsOf: (method) => calls.filter((call) => call.method === method),
    getAll: record('getAll', views),
    getCabinet: record('getCabinet', (id) => ({ id })),
    extend: record('extend', {}),
    assignPlan: record('assignPlan', {}),
    suspend: record('suspend', {}),
    unsuspend: record('unsuspend', {}),
    impersonate: record('impersonate', { token: 'impersonation-token' }),
    createWithOwnerAndTrialTx: record('createWithOwnerAndTrialTx', () => {
      if (createError) throw createError;
      return created;
    }),
  };
}

function makeCabinet({
  pool = fakePool(),
  tenants = tenantsStub(),
  audit = fakeAudit(),
  finance,
  settings = settingsWith(30),
} = {}) {
  const money = finance ?? new ManagerFinanceService(pool, tenants);
  return { service: new ManagerCabinetService(pool, tenants, audit, money, settings), pool, tenants, audit };
}

const managerActor = () => cabinetActor(managerUser());
const superActor = () => cabinetActor(superadminUser());
const AS_MANAGER = { userId: MANAGER_ID, name: 'Тестовый актор' };
const AS_SUPERADMIN = { userId: SUPERADMIN_ID, name: 'Тестовый актор' };

/** Пул под статистику менеджера: три запроса statsFor + текущая доля владельца. */
function statsPool({ paid = '5000.00', share = '3000.00', settled = null, percent = '60.00' } = {}) {
  return fakePool([
    [
      /GROUP BY t\.manager_id/,
      [{ manager_id: MANAGER_ID, total: 3, active: 2, expired: 1, suspended: 0, expiring_in_7d: 1 }],
    ],
    [
      /FROM subscription_payments sp WHERE sp\.manager_id = ANY/,
      [{ manager_id: MANAGER_ID, paid_month: paid, share_month: share, paid_total: paid, share_total: share }],
    ],
    [
      /FROM manager_settlements ms WHERE ms\.manager_id = ANY/,
      settled === null ? [] : [{ manager_id: MANAGER_ID, settled_total: settled }],
    ],
    [/^SELECT owner_share_percent FROM users WHERE id = \$1 AND role = 'manager'$/, [{ owner_share_percent: percent }]],
  ]);
}

test('summary менеджера: оплата 5000 при доле 60 % — долг владельцу 3000, «моя доля» 2000; расчёт 3000 обнуляет долг', async () => {
  const before = await makeCabinet({ pool: statsPool() }).service.summary(managerActor());
  assert.deepEqual(before, {
    tenants: { total: 3, active: 2, expired: 1, suspended: 0, expiringIn7d: 1 },
    paidThisMonth: 5000,
    ownerShareThisMonth: 3000,
    myShareThisMonth: 2000,
    paidTotal: 5000,
    ownerShareTotal: 3000,
    settledTotal: 0,
    balance: 3000,
    ownerSharePercent: 60,
    maxFreeDays: 30,
  });

  const pool = statsPool({ settled: '3000.00' });
  const after = await makeCabinet({ pool }).service.summary(managerActor());
  assert.equal(after.balance, 0);
  assert.equal(after.settledTotal, 3000);
  assert.equal(after.ownerShareTotal, 3000, 'расчёт не переписывает начисленную долю');
  assert.equal(after.myShareThisMonth, 2000, 'расчёт с владельцем не меняет долю самого менеджера');

  // Все запросы — по id самого актора: ни один не читает чужих менеджеров.
  assert.equal(pool.calls.length, 4);
  for (const call of pool.calls.slice(0, 3)) assert.deepEqual(call.params, [[MANAGER_ID]]);
  assert.deepEqual(pool.calls[3].params, [MANAGER_ID]);
});

test('summary: потолок бесплатных дней и текущая доля берутся из настроек и профиля, а не зашиты', async () => {
  const seven = await makeCabinet({ pool: statsPool({ percent: '40.00' }), settings: settingsWith(7) }).service.summary(
    managerActor(),
  );
  assert.equal(seven.maxFreeDays, 7);
  assert.equal(seven.ownerSharePercent, 40);

  const legacy = await makeCabinet({ pool: statsPool({ percent: null }) }).service.summary(managerActor());
  assert.equal(legacy.ownerSharePercent, 60, 'NULL в профиле = доля по умолчанию, как при начислении');
});

test('summary суперадмина в кабинете: клиенты всей платформы, деньги и доля нулевые, платежи и расчёты не читаются', async () => {
  const pool = fakePool([[/FROM tenants t$/, [{ total: 10, active: 6, expired: 3, suspended: 1, expiring_in_7d: 2 }]]]);
  const summary = await makeCabinet({ pool }).service.summary(superActor());
  assert.deepEqual(summary, {
    tenants: { total: 10, active: 6, expired: 3, suspended: 1, expiringIn7d: 2 },
    paidThisMonth: 0,
    ownerShareThisMonth: 0,
    myShareThisMonth: 0,
    paidTotal: 0,
    ownerShareTotal: 0,
    settledTotal: 0,
    balance: 0,
    ownerSharePercent: 0,
    maxFreeDays: 30,
  });
  assert.equal(pool.calls.length, 1, 'ни subscription_payments, ни manager_settlements, ни users');
});

test('summary: у менеджера без клиентов и платежей — нули, а не пустой ответ', async () => {
  const pool = fakePool([[/^SELECT owner_share_percent FROM users/, [{ owner_share_percent: '60.00' }]]]);
  const summary = await makeCabinet({ pool }).service.summary(managerActor());
  assert.deepEqual(summary.tenants, { total: 0, active: 0, expired: 0, suspended: 0, expiringIn7d: 0 });
  assert.deepEqual(
    [summary.paidThisMonth, summary.ownerShareThisMonth, summary.myShareThisMonth, summary.balance],
    [0, 0, 0, 0],
  );
});

test('список клиентов кабинета: область менеджера всегда в фильтре; статус — только известный, мусор — 400', async () => {
  const { service, tenants } = makeCabinet();
  await service.listTenants(managerActor());
  await service.listTenants(managerActor(), 'active');
  await service.listTenants(managerActor(), '');
  await service.listTenants(superActor(), 'suspended');
  assert.deepEqual(
    tenants.callsOf('getAll').map((call) => call.args[0]),
    [
      { managerId: MANAGER_ID, status: undefined },
      { managerId: MANAGER_ID, status: 'active' },
      { managerId: MANAGER_ID, status: undefined },
      { managerId: null, status: 'suspended' },
    ],
  );

  const before = tenants.callsOf('getAll').length;
  for (const bad of ['bogus', 'ACTIVE', 'active,expired', 'все', 0, false, {}, []]) {
    await expectHttp(() => service.listTenants(managerActor(), bad), 400, 'Неизвестный статус подписки');
  }
  assert.equal(tenants.callsOf('getAll').length, before, 'с мусорным статусом запрос к тенантам не уходит');
});

test('карточка клиента кабинета: выборка по (менеджер, id); чужой или несуществующий — 404', async () => {
  const own = makeCabinet();
  const row = await own.service.getTenant(managerActor(), TENANT_ID);
  assert.equal(row, own.tenants.views[0]);
  assert.deepEqual(own.tenants.callsOf('getAll')[0].args[0], { managerId: MANAGER_ID, id: TENANT_ID });

  const foreign = makeCabinet({ tenants: tenantsStub({ views: [] }) });
  await expectHttp(() => foreign.service.getTenant(managerActor(), FOREIGN_TENANT_ID), 404, 'Тенант не найден');
  assert.deepEqual(foreign.tenants.callsOf('getAll')[0].args[0], { managerId: MANAGER_ID, id: FOREIGN_TENANT_ID });
});

test('кабинет клиента: область менеджера уходит в TenantsService.getCabinet (у суперадмина — null)', async () => {
  const { service, tenants } = makeCabinet();
  await service.getCabinet(managerActor(), TENANT_ID);
  await service.getCabinet(superActor(), TENANT_ID);
  assert.deepEqual(
    tenants.callsOf('getCabinet').map((call) => call.args),
    [
      [TENANT_ID, { managerId: MANAGER_ID }],
      [TENANT_ID, { managerId: null }],
    ],
  );
});

const newTenantDto = (overrides = {}) => ({
  name: '  Автосервис «Север»  ',
  phone: ' +7 495 000-00-00 ',
  address: '   ',
  note: '  ',
  planId: PLAN_ID,
  director: { name: ' Пётр Владельцев ', phone: '+7 (999) 123-45-67', password: 'Secret123' },
  ...overrides,
});

function createPool({
  plan = { id: PLAN_ID, name: 'Бизнес', monthly_price: '5000.00', max_users: 10 },
  taken = false,
  extra = [],
} = {}) {
  return fakePool([
    ...extra,
    [/^SELECT id, name, monthly_price, max_users FROM plans WHERE id = \$1$/, plan ? [plan] : []],
    [/^SELECT 1 FROM users WHERE phone = \$1 LIMIT 1$/, taken ? [{ '?column?': 1 }] : []],
  ]);
}

test('создание клиента менеджером: одна транзакция, клиент закрепляется за создателем, пробный период 14 дн., пароль — хэш', async () => {
  const pool = createPool();
  const { service, tenants, audit } = makeCabinet({ pool });
  const view = await service.createTenant(managerActor(), newTenantDto());

  assert.deepEqual(verbsOf(pool), ['SELECT', 'SELECT', 'BEGIN', 'COMMIT']);
  assert.deepEqual(pool.calls[0].params, [PLAN_ID]);
  assert.deepEqual(pool.calls[1].params, ['+79991234567']);
  assert.equal(pool.connects, 1);
  assert.equal(pool.released, 1);

  const [{ args }] = tenants.callsOf('createWithOwnerAndTrialTx');
  const [client, input] = args;
  assert.equal(typeof client.query, 'function', 'создание идёт на соединении открытой транзакции');
  assert.equal(bcrypt.compareSync('Secret123', input.ownerPasswordHash), true);
  assert.notEqual(input.ownerPasswordHash, 'Secret123');
  assert.deepEqual(
    { ...input, ownerPasswordHash: '<hash>' },
    {
      companyName: 'Автосервис «Север»',
      ownerName: 'Пётр Владельцев',
      ownerPhone: '+79991234567',
      ownerPasswordHash: '<hash>',
      trialDays: 14,
      createdBy: MANAGER_ID,
      extra: {
        maxUsers: 10,
        phone: '+7 495 000-00-00',
        address: null,
        planId: PLAN_ID,
        planName: 'Бизнес',
        monthlyPrice: 5000,
        subscriptionNote: null,
        managerId: MANAGER_ID,
        trialNote: 'Пробный период (менеджер платформы)',
      },
    },
  );

  assert.deepEqual(tenants.callsOf('getAll')[0].args[0], { managerId: MANAGER_ID, id: TENANT_ID });
  assert.equal(view, tenants.views[0]);
  assert.deepEqual(audit.entries, [
    {
      actor: AS_MANAGER,
      action: 'tenant_create',
      target: {
        targetType: 'tenant',
        targetId: TENANT_ID,
        targetName: 'Автосервис «Север»',
        detail: { managerId: MANAGER_ID, planId: PLAN_ID, trialDays: 14 },
      },
    },
  ]);
  assert.equal(JSON.stringify(audit.entries).includes('Secret123'), false, 'пароль владельца в журнал не попадает');
});

test('создание клиента: необязательные поля обрезаются; у тарифа без max_users лимита нет', async () => {
  const pool = createPool({ plan: { id: PLAN_ID, name: 'Старт', monthly_price: '1500.00' } });
  const { service, tenants } = makeCabinet({ pool });
  await service.createTenant(
    managerActor(),
    newTenantDto({ address: ' ул. Ленина, 1 ', note: ' по договору ', phone: undefined }),
  );
  const { extra } = tenants.callsOf('createWithOwnerAndTrialTx')[0].args[1];
  assert.equal(extra.address, 'ул. Ленина, 1');
  assert.equal(extra.subscriptionNote, 'по договору');
  assert.equal(extra.phone, null);
  assert.equal(extra.maxUsers, null);
  assert.equal(extra.monthlyPrice, 1500);
});

test('создание клиента: пробный период по умолчанию — min(14, потолок); больше потолка — 400 до любого запроса', async () => {
  for (const [cap, requested, expected] of [
    [30, undefined, 14],
    [7, undefined, 7],
    [30, 30, 30],
    [30, 1, 1],
    [60, 45, 45],
  ]) {
    const { service, tenants } = makeCabinet({ pool: createPool(), settings: settingsWith(cap) });
    await service.createTenant(managerActor(), newTenantDto(requested === undefined ? {} : { trialDays: requested }));
    assert.equal(
      tenants.callsOf('createWithOwnerAndTrialTx')[0].args[1].trialDays,
      expected,
      `потолок ${cap}, запрошено ${requested}`,
    );
  }

  for (const [cap, requested] of [
    [30, 31],
    [7, 8],
    [30, 365],
  ]) {
    const pool = createPool();
    const { service, tenants } = makeCabinet({ pool, settings: settingsWith(cap) });
    await expectHttp(
      () => service.createTenant(managerActor(), newTenantDto({ trialDays: requested })),
      400,
      `Пробный период — не больше ${cap} дн.`,
    );
    assert.equal(pool.calls.length, 0, 'ни одного запроса к БД');
    assert.equal(pool.connects, 0, 'транзакция не открывалась');
    assert.equal(tenants.calls.length, 0);
  }
});

test('создание клиента: пустые название/имя владельца и кривой телефон — 400 без обращения к БД', async () => {
  for (const [overrides, message] of [
    [{ name: '   ' }, 'Укажите название автосервиса'],
    [{ name: undefined }, 'Укажите название автосервиса'],
    [{ director: { name: '  ', phone: '+79991234567', password: 'Secret123' } }, 'Укажите имя владельца автосервиса'],
    [{ director: { name: 'Пётр', phone: '+7', password: 'Secret123' } }, 'Укажите телефон в формате +7 999 123-45-67'],
    [
      { director: { name: 'Пётр', phone: undefined, password: 'Secret123' } },
      'Укажите телефон в формате +7 999 123-45-67',
    ],
  ]) {
    const pool = createPool();
    const { service, tenants } = makeCabinet({ pool });
    await expectHttp(() => service.createTenant(managerActor(), newTenantDto(overrides)), 400, message);
    assert.equal(pool.calls.length, 0, message);
    assert.equal(tenants.calls.length, 0, message);
  }
});

test('создание клиента: несуществующий тариф — 400, занятый телефон — 409 PHONE_TAKEN; транзакция не открывается', async () => {
  const noPlan = createPool({ plan: null });
  await expectHttp(
    () => makeCabinet({ pool: noPlan }).service.createTenant(managerActor(), newTenantDto()),
    400,
    'Тариф не найден',
  );
  assert.equal(noPlan.connects, 0);
  assert.equal(noPlan.calls.length, 1, 'до проверки телефона дело не дошло');

  const taken = createPool({ taken: true });
  const built = makeCabinet({ pool: taken });
  await expectHttp(() => built.service.createTenant(managerActor(), newTenantDto()), 409, {
    code: 'PHONE_TAKEN',
    message: PHONE_TAKEN_MESSAGE,
  });
  assert.equal(taken.connects, 0);
  assert.equal(built.tenants.calls.length, 0);
  assert.equal(built.audit.entries.length, 0);
});

test('создание клиента: гонка по телефону (23505) — 409 и полный откат; чужая ошибка пробрасывается, даже если сам ROLLBACK упал', async () => {
  const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'users_phone_key',
  });
  const racePool = createPool();
  const race = makeCabinet({ pool: racePool, tenants: tenantsStub({ createError: duplicate }) });
  await expectHttp(() => race.service.createTenant(managerActor(), newTenantDto()), 409, {
    code: 'PHONE_TAKEN',
  });
  assert.deepEqual(verbsOf(racePool), ['SELECT', 'SELECT', 'BEGIN', 'ROLLBACK']);
  assert.equal(racePool.released, 1, 'соединение возвращено в пул');
  assert.equal(race.audit.entries.length, 0, 'откатили — в журнал ничего');
  assert.equal(race.tenants.callsOf('getAll').length, 0);

  const boom = new Error('boom');
  const brokenPool = createPool({ extra: [[/^ROLLBACK$/, new Error('connection lost')]] });
  const broken = makeCabinet({ pool: brokenPool, tenants: tenantsStub({ createError: boom }) });
  await assert.rejects(
    () => broken.service.createTenant(managerActor(), newTenantDto()),
    (error) => error === boom,
  );
  assert.equal(brokenPool.released, 1);
  assert.equal(broken.audit.entries.length, 0);
});

test('создание клиента суперадмином в кабинете: клиент никому не закрепляется (manager_id = NULL), актор — суперадмин', async () => {
  const { service, tenants, audit } = makeCabinet({ pool: createPool() });
  await service.createTenant(superActor(), newTenantDto());
  const input = tenants.callsOf('createWithOwnerAndTrialTx')[0].args[1];
  assert.equal(input.extra.managerId, null);
  assert.equal(input.createdBy, SUPERADMIN_ID);
  assert.deepEqual(audit.entries[0].actor, AS_SUPERADMIN);
  assert.deepEqual(audit.entries[0].target.detail, { managerId: null, planId: PLAN_ID, trialDays: 14 });
  assert.deepEqual(tenants.callsOf('getAll')[0].args[0], { managerId: null, id: TENANT_ID });
});

test('продление менеджером: платное — доля владельца на него самого и область в TenantsService; бесплатное — без доли', async () => {
  const { service, tenants } = makeCabinet();
  await service.extend(managerActor(), TENANT_ID, { type: 'paid', amount: 5000, note: 'наличные' });
  await service.extend(managerActor(), TENANT_ID, { type: 'free', days: 10, note: 'подарок' });
  await service.extend(superActor(), TENANT_ID, { type: 'paid', amount: 5000 });

  const [paid, free, superadminPaid] = tenants.callsOf('extend').map((call) => call.args);
  assert.deepEqual(paid, [
    TENANT_ID,
    { type: 'paid', days: undefined, amount: 5000, until: undefined, note: 'наличные' },
    AS_MANAGER,
    { credit: { managerId: MANAGER_ID }, scope: { managerId: MANAGER_ID } },
  ]);
  assert.deepEqual(free, [
    TENANT_ID,
    { type: 'free', days: 10, amount: undefined, until: undefined, note: 'подарок' },
    AS_MANAGER,
    { credit: undefined, scope: { managerId: MANAGER_ID } },
  ]);
  assert.deepEqual(
    superadminPaid[3],
    { credit: undefined, scope: { managerId: null } },
    'суперадмин в кабинете долей владельцу не платит и никем не ограничен',
  );
  assert.deepEqual(
    tenants.callsOf('getAll').map((call) => call.args[0]),
    [
      { managerId: MANAGER_ID, id: TENANT_ID },
      { managerId: MANAGER_ID, id: TENANT_ID },
      { managerId: null, id: TENANT_ID },
    ],
    'после продления карточка читается в той же области',
  );
});

test('бесплатное продление: только днями, без суммы и даты, не больше потолка; всё лишнее — 400 до TenantsService', async () => {
  for (const [dto, message] of [
    [
      { type: 'free', days: 10, until: '2030-01-01T00:00:00.000Z' },
      'Бесплатное продление задаётся числом дней, а не датой',
    ],
    [{ type: 'free', days: 10, amount: 100 }, 'Для бесплатного продления сумма не указывается'],
    [{ type: 'free' }, 'Укажите количество дней бесплатного продления'],
    [{ type: 'free', days: 31 }, 'Бесплатно можно продлить не больше чем на 30 дн.'],
    [{ type: 'free', days: 3650 }, 'Бесплатно можно продлить не больше чем на 30 дн.'],
  ]) {
    const { service, tenants } = makeCabinet();
    await expectHttp(() => service.extend(managerActor(), TENANT_ID, dto), 400, message);
    assert.equal(tenants.callsOf('extend').length, 0, message);
  }

  // Граница потолка включительно; нулевая «сумма» бесплатного продления не мешает и до TenantsService не доезжает.
  const edge = makeCabinet();
  await edge.service.extend(managerActor(), TENANT_ID, { type: 'free', days: 30, amount: 0 });
  const [, forwarded] = edge.tenants.callsOf('extend')[0].args;
  assert.deepEqual(forwarded, { type: 'free', days: 30, amount: undefined, until: undefined, note: undefined });

  // Потолок — настройка платформы, а не константа.
  const strict = makeCabinet({ settings: settingsWith(7) });
  await expectHttp(
    () => strict.service.extend(managerActor(), TENANT_ID, { type: 'free', days: 8 }),
    400,
    'Бесплатно можно продлить не больше чем на 7 дн.',
  );
  await strict.service.extend(managerActor(), TENANT_ID, { type: 'free', days: 7 });
  assert.equal(strict.tenants.callsOf('extend').length, 1);
});

test('назначение тарифа, приостановка, возобновление, вход владельцем: актор и область уходят в TenantsService', async () => {
  for (const [actor, scope, auditActor] of [
    [managerActor(), { managerId: MANAGER_ID }, AS_MANAGER],
    [superActor(), { managerId: null }, AS_SUPERADMIN],
  ]) {
    const { service, tenants } = makeCabinet();
    const card = await service.assignPlan(actor, TENANT_ID, PLAN_ID);
    await service.suspend(actor, TENANT_ID, 'неоплата');
    await service.unsuspend(actor, TENANT_ID, 'оплатил');
    const impersonation = await service.impersonate(actor, TENANT_ID);

    assert.deepEqual(tenants.callsOf('assignPlan')[0].args, [TENANT_ID, PLAN_ID, auditActor, scope]);
    assert.deepEqual(tenants.callsOf('suspend')[0].args, [TENANT_ID, 'неоплата', auditActor, scope]);
    assert.deepEqual(tenants.callsOf('unsuspend')[0].args, [TENANT_ID, auditActor, scope, 'оплатил']);
    assert.deepEqual(tenants.callsOf('impersonate')[0].args, [TENANT_ID, auditActor, scope]);
    assert.deepEqual(impersonation, { token: 'impersonation-token' });
    assert.equal(card, tenants.views[0]);
    assert.deepEqual(
      tenants.callsOf('getAll').map((call) => call.args[0]),
      [
        { ...scope, id: TENANT_ID },
        { ...scope, id: TENANT_ID },
        { ...scope, id: TENANT_ID },
      ],
      'карточка после действия — в области актора; вход владельцем карточку не читает',
    );
  }
});

test('действие над чужим клиентом: 404 из TenantsService пробрасывается, повторного чтения карточки нет', async () => {
  const { NotFoundException } = require('@nestjs/common');
  const tenants = tenantsStub();
  tenants.assignPlan = async () => {
    throw new NotFoundException({ message: 'Тенант не найден' });
  };
  const { service } = makeCabinet({ tenants });
  await expectHttp(() => service.assignPlan(managerActor(), FOREIGN_TENANT_ID, PLAN_ID), 404, 'Тенант не найден');
  assert.equal(tenants.callsOf('getAll').length, 0);
});

function resetPool({ ownedBy = MANAGER_ID, owners = [{ id: DIRECTOR_ID, full_name: 'Пётр Директоров' }] } = {}) {
  return fakePool([
    [
      /^SELECT id, name FROM tenants WHERE id = \$1::uuid AND \(\$2::uuid IS NULL OR manager_id = \$2::uuid\)$/,
      (p) =>
        p[0] === TENANT_ID && (p[1] === null || p[1] === ownedBy)
          ? [{ id: TENANT_ID, name: 'Автосервис «Восток»' }]
          : [],
    ],
    [/FROM users WHERE tenant_id = \$1 AND role = 'director'/, owners],
    [
      /^UPDATE users SET password = \$1, sessions_valid_from = now\(\), updated_at = now\(\) WHERE id = \$2$/,
      { rows: [], rowCount: 1 },
    ],
  ]);
}

const seedAuthCache = (userId, jti = 'jti-managers-test') =>
  ttlCache.set(authCacheKey(userId, jti), { userID: userId }, 30_000);
const isAuthCached = (userId, jti = 'jti-managers-test') => ttlCache.get(authCacheKey(userId, jti)) !== undefined;

test('сброс пароля владельца своего клиента: хэш, обрыв прежних сессий, кэш авторизации владельца сброшен, пароля в журнале нет', async () => {
  const pool = resetPool();
  const { service, audit } = makeCabinet({ pool });
  seedAuthCache(DIRECTOR_ID);
  seedAuthCache(OTHER_MANAGER_ID);
  try {
    assert.deepEqual(await service.resetOwnerPassword(managerActor(), TENANT_ID, 'NewPass123'), { ok: true });

    assert.deepEqual(pool.calls[0].params, [TENANT_ID, MANAGER_ID], 'область менеджера — в запросе тенанта');
    assert.match(
      pool.calls[1].text,
      /WHERE tenant_id = \$1 AND role = 'director' AND is_active = true AND dismissed_at IS NULL AND purged_at IS NULL ORDER BY created_at ASC LIMIT 1$/,
    );
    const update = pool.calls[2];
    assert.deepEqual([update.params.length, update.params[1]], [2, DIRECTOR_ID]);
    assert.notEqual(update.params[0], 'NewPass123');
    assert.equal(bcrypt.compareSync('NewPass123', update.params[0]), true);

    assert.equal(isAuthCached(DIRECTOR_ID), false, 'старые токены владельца не должны жить ещё 30 с из кэша');
    assert.equal(isAuthCached(OTHER_MANAGER_ID), true, 'чужие сессии не задеты');

    assert.deepEqual(audit.entries, [
      {
        actor: AS_MANAGER,
        action: 'owner_password_reset',
        target: {
          targetType: 'user',
          targetId: DIRECTOR_ID,
          targetName: 'Пётр Директоров',
          detail: { tenantId: TENANT_ID, tenantName: 'Автосервис «Восток»' },
        },
      },
    ]);
    const journal = JSON.stringify(audit.entries);
    assert.equal(journal.includes('NewPass123'), false);
    assert.equal(journal.includes(update.params[0]), false, 'и хэш в журнал не попадает');
  } finally {
    ttlCache.invalidate(authCacheKey(DIRECTOR_ID, 'jti-managers-test'));
    ttlCache.invalidate(authCacheKey(OTHER_MANAGER_ID, 'jti-managers-test'));
  }
});

test('сброс пароля: чужой клиент — 404 после одного запроса; нет владельца — 404; суперадмин сбрасывает любому', async () => {
  const foreign = resetPool({ ownedBy: OTHER_MANAGER_ID });
  const foreignService = makeCabinet({ pool: foreign });
  seedAuthCache(DIRECTOR_ID);
  try {
    await expectHttp(
      () => foreignService.service.resetOwnerPassword(managerActor(), TENANT_ID, 'NewPass123'),
      404,
      'Тенант не найден',
    );
    assert.equal(foreign.calls.length, 1, 'владельца чужого клиента не ищем и пароль не трогаем');
    assert.equal(isAuthCached(DIRECTOR_ID), true, 'кэш чужого владельца не сброшен');
    assert.equal(foreignService.audit.entries.length, 0);

    const unassigned = resetPool({ ownedBy: null });
    await expectHttp(
      () => makeCabinet({ pool: unassigned }).service.resetOwnerPassword(managerActor(), TENANT_ID, 'NewPass123'),
      404,
      'Тенант не найден',
    );

    const noOwner = resetPool({ owners: [] });
    const noOwnerService = makeCabinet({ pool: noOwner });
    await expectHttp(
      () => noOwnerService.service.resetOwnerPassword(managerActor(), TENANT_ID, 'NewPass123'),
      404,
      'У тенанта нет активного владельца',
    );
    assert.equal(
      noOwner.calls.some((call) => call.text.startsWith('UPDATE')),
      false,
    );
    assert.equal(noOwnerService.audit.entries.length, 0);

    const anyTenant = resetPool({ ownedBy: OTHER_MANAGER_ID });
    const asOwner = makeCabinet({ pool: anyTenant });
    assert.deepEqual(await asOwner.service.resetOwnerPassword(superActor(), TENANT_ID, 'NewPass123'), { ok: true });
    assert.equal(anyTenant.calls[0].params[1], null, 'у суперадмина область не задана');
    assert.equal(asOwner.audit.entries[0].actor.userId, SUPERADMIN_ID);
  } finally {
    ttlCache.invalidate(authCacheKey(DIRECTOR_ID, 'jti-managers-test'));
  }
});

test('лента и журнал кабинета: только записи самого актора; окно и страница зажаты', async () => {
  const ledgerCalls = [];
  const finance = {
    async ledger(...args) {
      ledgerCalls.push(args);
      return { payments: [], settlements: [], balance: 0 };
    },
  };
  const { service, audit } = makeCabinet({ finance });
  await service.ledger(managerActor(), '6');
  await service.ledger(superActor(), undefined);
  assert.deepEqual(ledgerCalls, [
    [MANAGER_ID, '6'],
    [SUPERADMIN_ID, undefined],
  ]);

  for (const [limit, offset, expectedLimit, expectedOffset] of [
    [undefined, undefined, 50, 0],
    ['25', '40', 25, 40],
    [1000, 5, 200, 5],
    [200, 0, 200, 0],
    [201, 0, 200, 0],
    [0, -3, 1, 0],
    [-5, 'abc', 1, 0],
    ['abc', NaN, 50, 0],
    [7.9, 2.9, 7, 2],
  ]) {
    audit.entries.length = 0;
    await service.auditLog(managerActor(), limit, offset);
    assert.deepEqual(
      audit.entries,
      [{ listByActor: { actorUserId: MANAGER_ID, limit: expectedLimit, offset: expectedOffset } }],
      `limit=${limit} offset=${offset}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Л. AdminManagersService: заведение и правка менеджера, расчёты с владельцем, перенос клиента
// ───────────────────────────────────────────────────────────────────────────

/** Маршрут пула по ТОЧНОМУ тексту SQL (без регулярок: нечего экранировать и нечему «почти совпасть»). */
const exactSql = (text) => ({ test: (sql) => sql === flat(text) });
/** Маршрут пула по началу текста SQL. */
const sqlStart = (text) => ({ test: (sql) => sql.startsWith(flat(text)) });

/** Колонки менеджера — ровно то, что сервис читает и отдаёт: пароля и служебных полей среди них нет. */
const MANAGER_COLUMNS = 'id, full_name, phone, is_active, owner_share_percent, owner_notes, created_at';
const MANAGER_BY_ID = exactSql(`SELECT ${MANAGER_COLUMNS} FROM users WHERE id = $1 AND role = 'manager'`);
const MANAGER_LIST = exactSql(
  `SELECT ${MANAGER_COLUMNS} FROM users WHERE role = 'manager' ORDER BY created_at DESC, id DESC`,
);
const PHONE_FREE = exactSql('SELECT 1 FROM users WHERE phone = $1 LIMIT 1');
const PHONE_FREE_EXCEPT = exactSql('SELECT 1 FROM users WHERE phone = $1 AND id <> $2 LIMIT 1');
const UPDATE_USERS = sqlStart('UPDATE users SET');
const BALANCE_QUERY = sqlStart('SELECT COALESCE((SELECT SUM(sp.owner_share_amount)');
const AUTH_TEST_JTI = 'jti-managers-test';

const managerRow = (overrides = {}) => ({
  id: MANAGER_ID,
  full_name: 'Пётр Менеджеров',
  phone: '+79991112233',
  is_active: true,
  owner_share_percent: '60.00',
  owner_notes: null,
  created_at: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

/** Три запроса ManagerFinanceService.statsFor: клиенты, платежи, расчёты (по умолчанию — пусто). */
const statsRoutes = ({ tenantRows = [], paymentRows = [], settlementRows = [] } = {}) => [
  [/GROUP BY t\.manager_id/, tenantRows],
  [/FROM subscription_payments sp WHERE sp\.manager_id = ANY/, paymentRows],
  [/FROM manager_settlements ms WHERE ms\.manager_id = ANY/, settlementRows],
];

function makeAdmin({
  pool = fakePool(),
  tenants = tenantsStub(),
  audit = fakeAudit(),
  finance,
  settings = settingsWith(30),
} = {}) {
  const money = finance ?? new ManagerFinanceService(pool, tenants);
  return { service: new AdminManagersService(pool, tenants, audit, money, settings), pool, tenants, audit };
}

const dropSeededAuth = (...userIds) => userIds.forEach((id) => ttlCache.invalidate(authCacheKey(id, AUTH_TEST_JTI)));

const OTHER_STATS = {
  tenantRows: [{ manager_id: MANAGER_ID, total: 4, active: 3, expired: 1, suspended: 0, expiring_in_7d: 1 }],
  paymentRows: [
    {
      manager_id: MANAGER_ID,
      paid_month: '5000.00',
      share_month: '3000.00',
      paid_total: '8000.00',
      share_total: '4800.00',
    },
  ],
  settlementRows: [{ manager_id: MANAGER_ID, settled_total: '1000.00' }],
};

test('список менеджеров: без менеджеров — один запрос; иначе три запроса статистики на ВЕСЬ список, NULL-доля = 60, лишние колонки не отдаются', async () => {
  const empty = fakePool([[MANAGER_LIST, []]]);
  assert.deepEqual(await makeAdmin({ pool: empty }).service.list(), []);
  assert.equal(empty.calls.length, 1, 'нет менеджеров — нет и запросов за статистикой');

  const pool = fakePool([
    [
      MANAGER_LIST,
      [
        { ...managerRow(), password: 'хеш-которого-не-должно-быть-в-ответе' },
        managerRow({
          id: OTHER_MANAGER_ID,
          full_name: 'Анна Иванова',
          phone: '+79994445566',
          is_active: false,
          owner_share_percent: null,
          owner_notes: 'в отпуске',
          created_at: '2026-08-01T10:00:00.000Z',
        }),
      ],
    ],
    ...statsRoutes(OTHER_STATS),
  ]);
  const list = await makeAdmin({ pool }).service.list();

  assert.equal(pool.calls.length, 4, 'список + клиенты + платежи + расчёты — независимо от числа менеджеров');
  for (const call of pool.calls.slice(1)) assert.deepEqual(call.params, [[MANAGER_ID, OTHER_MANAGER_ID]]);
  assert.deepEqual(list, [
    {
      id: MANAGER_ID,
      fullName: 'Пётр Менеджеров',
      phone: '+79991112233',
      isActive: true,
      ownerSharePercent: 60,
      note: null,
      tenantsCount: 4,
      activeTenantsCount: 3,
      paidThisMonth: 5000,
      ownerShareThisMonth: 3000,
      balance: 3800,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: OTHER_MANAGER_ID,
      fullName: 'Анна Иванова',
      phone: '+79994445566',
      isActive: false,
      ownerSharePercent: 60,
      note: 'в отпуске',
      tenantsCount: 0,
      activeTenantsCount: 0,
      paidThisMonth: 0,
      ownerShareThisMonth: 0,
      balance: 0,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
  ]);
  assert.equal(JSON.stringify(list).includes('хеш-которого'), false);
});

test('карточка менеджера: профиль + сводка как в кабинете + ВСЕ его клиенты; баланс шапки и сводки — одно число', async () => {
  const pool = fakePool([
    [MANAGER_BY_ID, [managerRow({ owner_share_percent: '45.50' })]],
    ...statsRoutes({
      tenantRows: [{ manager_id: MANAGER_ID, total: 2, active: 2, expired: 0, suspended: 0, expiring_in_7d: 0 }],
      paymentRows: [
        {
          manager_id: MANAGER_ID,
          paid_month: '5000.00',
          share_month: '2275.00',
          paid_total: '9000.00',
          share_total: '4095.00',
        },
      ],
      settlementRows: [{ manager_id: MANAGER_ID, settled_total: '1000.00' }],
    }),
  ]);
  const views = [{ id: TENANT_ID }, { id: FOREIGN_TENANT_ID }];
  const tenants = tenantsStub({ views });
  const detail = await makeAdmin({ pool, tenants, settings: settingsWith(14) }).service.get(MANAGER_ID);

  assert.deepEqual(detail.summary, {
    tenants: { total: 2, active: 2, expired: 0, suspended: 0, expiringIn7d: 0 },
    paidThisMonth: 5000,
    ownerShareThisMonth: 2275,
    myShareThisMonth: 2725,
    paidTotal: 9000,
    ownerShareTotal: 4095,
    settledTotal: 1000,
    balance: 3095,
    ownerSharePercent: 45.5,
    maxFreeDays: 14,
  });
  assert.equal(detail.balance, detail.summary.balance);
  assert.equal(detail.ownerSharePercent, 45.5);
  assert.equal(detail.tenantsCount, 2);
  assert.equal(detail.tenants, views, 'клиенты — ровно то, что вернул TenantsService.getAll');
  assert.deepEqual(
    tenants.callsOf('getAll').map((call) => call.args),
    [[{ managerId: MANAGER_ID }]],
  );
  assert.equal('password' in detail, false);
});

test('любой id, кроме менеджера (директор, чужой тенант, мусор), — 404 «Менеджер не найден» после ОДНОГО запроса и без записи в журнал', async () => {
  const attempts = {
    get: (service) => service.get(DIRECTOR_ID),
    update: (service) => service.update(DIRECTOR_ID, { fullName: 'Взлом' }, AS_SUPERADMIN),
    ledger: (service) => service.ledger(DIRECTOR_ID, 12),
    addSettlement: (service) => service.addSettlement(DIRECTOR_ID, { amount: 100 }, AS_SUPERADMIN),
    removeSettlement: (service) => service.removeSettlement(DIRECTOR_ID, SETTLEMENT_ID, AS_SUPERADMIN),
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    const { service, pool, audit } = makeAdmin();
    await expectHttp(() => attempt(service), 404, 'Менеджер не найден');
    assert.equal(pool.calls.length, 1, `${name}: кроме проверки «это менеджер» запросов быть не должно`);
    assert.equal(pool.calls[0].text, flat(`SELECT ${MANAGER_COLUMNS} FROM users WHERE id = $1 AND role = 'manager'`));
    assert.deepEqual(pool.calls[0].params, [DIRECTOR_ID]);
    assert.deepEqual(audit.entries, [], `${name}: отказ не должен оставлять следов в журнале`);
  }
});

const CREATE_INPUT = { fullName: 'Пётр Менеджеров', phone: '+7 (999) 111-22-33', password: 'manager-pass-1' };

function createManagerPool({ taken = false, insertResult } = {}) {
  return fakePool([
    [PHONE_FREE, taken ? [{ '?column?': 1 }] : []],
    [sqlStart('INSERT INTO users'), insertResult ?? [managerRow()]],
  ]);
}

test('создание менеджера: роль manager без тенанта зашита в SQL, вместо пароля bcrypt-хеш, в журнале доля без пароля', async () => {
  const pool = createManagerPool({ insertResult: [managerRow({ owner_notes: 'первый менеджер' })] });
  const { service, audit } = makeAdmin({ pool });

  const created = await service.create(
    { ...CREATE_INPUT, fullName: '  Пётр Менеджеров  ', note: '  первый менеджер  ' },
    AS_SUPERADMIN,
  );

  assert.equal(pool.calls.length, 2, 'проверка телефона и INSERT — больше ничего');
  const [check, insert] = pool.calls;
  assert.equal(check.text, 'SELECT 1 FROM users WHERE phone = $1 LIMIT 1');
  assert.deepEqual(check.params, ['+79991112233']);
  assert.equal(
    insert.text,
    `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, owner_share_percent, owner_notes) VALUES ($1, $2, $3, 'manager', true, NULL, $4, $5) RETURNING ${MANAGER_COLUMNS}`,
  );
  assert.equal(insert.params.length, 5, 'роль и тенант — литералы SQL, из тела запроса их не взять');
  const [phone, hash, fullName, percent, note] = insert.params;
  assert.deepEqual([phone, fullName, percent, note], ['+79991112233', 'Пётр Менеджеров', 60, 'первый менеджер']);
  assert.notEqual(hash, 'manager-pass-1', 'пароль хранится только хешем');
  assert.equal(await bcrypt.compare('manager-pass-1', hash), true);

  assert.deepEqual(created, {
    id: MANAGER_ID,
    fullName: 'Пётр Менеджеров',
    phone: '+79991112233',
    isActive: true,
    ownerSharePercent: 60,
    note: 'первый менеджер',
    tenantsCount: 0,
    activeTenantsCount: 0,
    paidThisMonth: 0,
    ownerShareThisMonth: 0,
    balance: 0,
    createdAt: '2026-09-01T10:00:00.000Z',
  });
  assert.deepEqual(audit.entries, [
    {
      actor: AS_SUPERADMIN,
      action: 'manager_create',
      target: {
        targetType: 'user',
        targetId: MANAGER_ID,
        targetName: 'Пётр Менеджеров',
        detail: { ownerSharePercent: 60 },
      },
    },
  ]);
  const journal = JSON.stringify(audit.entries);
  assert.equal(journal.includes('manager-pass-1'), false, 'пароль не должен попасть в журнал');
  assert.equal(journal.includes(hash), false, 'хеш пароля не должен попасть в журнал');
});

test('создание менеджера: доля не передана — 60, 0 % сохраняется как 0 (а не «по умолчанию»), пустая заметка — NULL', async () => {
  for (const [percent, expected] of [
    [undefined, 60],
    [0, 0],
    [100, 100],
    [37.5, 37.5],
  ]) {
    const pool = createManagerPool();
    await makeAdmin({ pool }).service.create({ ...CREATE_INPUT, ownerSharePercent: percent }, AS_SUPERADMIN);
    assert.equal(pool.calls[1].params[3], expected, `доля ${percent}`);
  }
  for (const note of [undefined, null, '', '   ']) {
    const pool = createManagerPool();
    await makeAdmin({ pool }).service.create({ ...CREATE_INPUT, note }, AS_SUPERADMIN);
    assert.equal(pool.calls[1].params[4], null, `заметка ${JSON.stringify(note)}`);
  }
});

test('создание менеджера: пустое имя и негодный телефон — 400 ДО любого запроса к БД', async () => {
  for (const [dto, expected] of [
    [{ ...CREATE_INPUT, fullName: '   ' }, 'Укажите имя менеджера'],
    [{ ...CREATE_INPUT, fullName: undefined }, 'Укажите имя менеджера'],
    [{ ...CREATE_INPUT, phone: 'abc' }, /телефон/],
    [{ ...CREATE_INPUT, phone: '+7' }, /телефон/],
  ]) {
    const { service, pool, audit } = makeAdmin();
    await expectHttp(() => service.create(dto, AS_SUPERADMIN), 400, expected);
    assert.equal(pool.calls.length, 0, 'валидация раньше БД');
    assert.deepEqual(audit.entries, []);
  }
});

test('создание менеджера: занятый телефон — 409 PHONE_TAKEN без INSERT и журнала; гонка (23505) — тот же 409; чужие ошибки БД не маскируются', async () => {
  const taken = createManagerPool({ taken: true });
  const first = makeAdmin({ pool: taken });
  await expectHttp(() => first.service.create(CREATE_INPUT, AS_SUPERADMIN), 409, {
    message: PHONE_TAKEN_MESSAGE,
    code: 'PHONE_TAKEN',
  });
  assert.equal(taken.calls.length, 1, 'INSERT не выполнялся');
  assert.deepEqual(first.audit.entries, []);

  const raced = createManagerPool({
    insertResult: Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), {
      code: '23505',
      constraint: 'users_phone_key',
    }),
  });
  const second = makeAdmin({ pool: raced });
  await expectHttp(() => second.service.create(CREATE_INPUT, AS_SUPERADMIN), 409, {
    message: PHONE_TAKEN_MESSAGE,
    code: 'PHONE_TAKEN',
  });
  assert.deepEqual(second.audit.entries, [], 'проигравший гонку ничего не пишет в журнал');

  for (const failure of [
    Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    Object.assign(new Error('duplicate key value violates unique constraint "users_pkey"'), {
      code: '23505',
      constraint: 'users_pkey',
    }),
  ]) {
    const service = makeAdmin({ pool: createManagerPool({ insertResult: failure }) }).service;
    await assert.rejects(
      () => service.create(CREATE_INPUT, AS_SUPERADMIN),
      (error) => error === failure,
    );
  }
});

/** Пул для PATCH /admin/managers/:id: чтение менеджера, проверка телефона, UPDATE и статистика для ответа. */
function updatePool({ current = managerRow(), updated, phoneTaken = false, updateResult } = {}) {
  return fakePool([
    [MANAGER_BY_ID, [current]],
    [PHONE_FREE_EXCEPT, phoneTaken ? [{ '?column?': 1 }] : []],
    [UPDATE_USERS, updateResult ?? [updated ?? current]],
    ...statsRoutes(),
  ]);
}
const updateCall = (pool) => pool.calls.find((call) => call.text.startsWith('UPDATE users SET'));
const updateSql = (sets) =>
  `UPDATE users SET ${sets}, updated_at = now() WHERE id = $1 AND role = 'manager' RETURNING ${MANAGER_COLUMNS}`;

test('правка менеджера: пустое тело — 400 после одного запроса (только проверка, что это менеджер)', async () => {
  const { service, pool, audit } = makeAdmin({ pool: updatePool() });
  await expectHttp(() => service.update(MANAGER_ID, {}, AS_SUPERADMIN), 400, 'Не переданы поля для изменения');
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(audit.entries, []);
});

test('правка менеджера: те же значения (имя с пробелами, телефон в другой записи, доля, статус, пустая заметка) — no-op: ни UPDATE, ни журнала, ни сброса сессий', async () => {
  seedAuthCache(MANAGER_ID);
  try {
    const pool = updatePool();
    const { service, audit } = makeAdmin({ pool });
    const result = await service.update(
      MANAGER_ID,
      {
        fullName: '  Пётр Менеджеров ',
        phone: '8 (999) 111-22-33',
        ownerSharePercent: 60,
        isActive: true,
        note: '   ',
      },
      AS_SUPERADMIN,
    );

    assert.equal(updateCall(pool), undefined, 'фактических изменений нет — писать в БД нечего');
    assert.equal(
      pool.calls.some((call) => call.text.startsWith('SELECT 1 FROM users')),
      false,
      'телефон не менялся — занятость не проверяем',
    );
    assert.deepEqual(audit.entries, []);
    assert.equal(isAuthCached(MANAGER_ID), true, 'no-op не должен разлогинивать менеджера');
    assert.equal(result.id, MANAGER_ID);
    assert.equal(result.fullName, 'Пётр Менеджеров');
  } finally {
    dropSeededAuth(MANAGER_ID);
  }
});

test('правка менеджера: имя, доля и заметка — один UPDATE, параметры по номерам, в журнале «было/стало»; сессии не трогаются', async () => {
  seedAuthCache(MANAGER_ID);
  try {
    const updated = managerRow({ full_name: 'Пётр Новый', owner_share_percent: '40.00', owner_notes: 'важный' });
    const pool = updatePool({ updated });
    const { service, audit } = makeAdmin({ pool });

    const result = await service.update(
      MANAGER_ID,
      { fullName: ' Пётр Новый ', ownerSharePercent: 40, note: ' важный ' },
      AS_SUPERADMIN,
    );

    const update = updateCall(pool);
    assert.equal(update.text, updateSql('full_name = $2, owner_share_percent = $3, owner_notes = $4'));
    assert.deepEqual(update.params, [MANAGER_ID, 'Пётр Новый', 40, 'важный']);
    assert.deepEqual(audit.entries, [
      {
        actor: AS_SUPERADMIN,
        action: 'manager_update',
        target: {
          targetType: 'user',
          targetId: MANAGER_ID,
          targetName: 'Пётр Новый',
          detail: {
            fullName: { from: 'Пётр Менеджеров', to: 'Пётр Новый' },
            ownerSharePercent: { from: 60, to: 40 },
            noteChanged: true,
          },
        },
      },
    ]);
    assert.equal(isAuthCached(MANAGER_ID), true, 'имя, доля и заметка не должны разлогинивать менеджера');
    assert.equal(result.ownerSharePercent, 40);
    assert.equal(result.note, 'важный');
  } finally {
    dropSeededAuth(MANAGER_ID);
  }
});

test('правка менеджера: новый пароль — bcrypt-хеш и граница сессий; кэш авторизации именно этого менеджера сброшен; пароля и хеша в журнале нет', async () => {
  seedAuthCache(MANAGER_ID);
  seedAuthCache(OTHER_MANAGER_ID);
  try {
    const pool = updatePool();
    const { service, audit } = makeAdmin({ pool });

    await service.update(MANAGER_ID, { password: 'new-manager-pass' }, AS_SUPERADMIN);

    const update = updateCall(pool);
    assert.equal(update.text, updateSql('password = $2, sessions_valid_from = now()'));
    assert.equal(update.params.length, 2);
    const hash = update.params[1];
    assert.notEqual(hash, 'new-manager-pass', 'пароль хранится только хешем');
    assert.equal(await bcrypt.compare('new-manager-pass', hash), true);
    assert.equal(isAuthCached(MANAGER_ID), false, 'старые токены менеджера не должны жить до истечения TTL кэша');
    assert.equal(isAuthCached(OTHER_MANAGER_ID), true, 'чужие сессии не трогаем');
    assert.deepEqual(audit.entries[0].target.detail, { passwordChanged: true });
    const journal = JSON.stringify(audit.entries);
    assert.equal(journal.includes('new-manager-pass'), false);
    assert.equal(journal.includes(hash), false);
  } finally {
    dropSeededAuth(MANAGER_ID, OTHER_MANAGER_ID);
  }
});

test('правка менеджера: отключение и включение — is_active в UPDATE, «было/стало» в журнале, сессии менеджера сброшены', async () => {
  for (const [from, to] of [
    [true, false],
    [false, true],
  ]) {
    seedAuthCache(MANAGER_ID);
    try {
      const pool = updatePool({ current: managerRow({ is_active: from }), updated: managerRow({ is_active: to }) });
      const { service, audit } = makeAdmin({ pool });

      const result = await service.update(MANAGER_ID, { isActive: to }, AS_SUPERADMIN);

      const update = updateCall(pool);
      assert.equal(update.text, updateSql('is_active = $2'));
      assert.deepEqual(update.params, [MANAGER_ID, to]);
      assert.deepEqual(audit.entries[0].target.detail, { isActive: { from, to } });
      assert.equal(isAuthCached(MANAGER_ID), false, `${from} -> ${to}: кэш авторизации должен быть сброшен`);
      assert.equal(result.isActive, to);
    } finally {
      dropSeededAuth(MANAGER_ID);
    }
  }
});

test('правка менеджера: смена телефона — номер нормализуется, занятость проверяется КРОМЕ самого менеджера, номера в журнал не попадают', async () => {
  const pool = updatePool({ updated: managerRow({ phone: '+79995556677' }) });
  const { service, audit } = makeAdmin({ pool });

  const result = await service.update(MANAGER_ID, { phone: '8 (999) 555-66-77' }, AS_SUPERADMIN);

  const check = pool.calls.find((call) => call.text.startsWith('SELECT 1 FROM users'));
  assert.equal(check.text, 'SELECT 1 FROM users WHERE phone = $1 AND id <> $2 LIMIT 1');
  assert.deepEqual(check.params, ['+79995556677', MANAGER_ID]);
  const update = updateCall(pool);
  assert.equal(update.text, updateSql('phone = $2'));
  assert.deepEqual(update.params, [MANAGER_ID, '+79995556677']);
  assert.deepEqual(audit.entries[0].target.detail, { phoneChanged: true });
  const journal = JSON.stringify(audit.entries);
  assert.equal(journal.includes('79995556677'), false, 'новый номер не пишем в журнал');
  assert.equal(journal.includes('79991112233'), false, 'старый номер — тоже');
  assert.equal(result.phone, '+79995556677');
});

test('правка менеджера: чужой телефон — 409 PHONE_TAKEN без UPDATE и журнала; гонка на уникальном индексе — тот же ответ', async () => {
  const taken = updatePool({ phoneTaken: true });
  const first = makeAdmin({ pool: taken });
  await expectHttp(() => first.service.update(MANAGER_ID, { phone: '+7 999 555 66 77' }, AS_SUPERADMIN), 409, {
    message: PHONE_TAKEN_MESSAGE,
    code: 'PHONE_TAKEN',
  });
  assert.equal(updateCall(taken), undefined);
  assert.deepEqual(first.audit.entries, []);

  const raced = updatePool({
    updateResult: Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), {
      code: '23505',
      constraint: 'users_phone_key',
    }),
  });
  const second = makeAdmin({ pool: raced });
  await expectHttp(() => second.service.update(MANAGER_ID, { phone: '+7 999 555 66 77' }, AS_SUPERADMIN), 409, {
    message: PHONE_TAKEN_MESSAGE,
    code: 'PHONE_TAKEN',
  });
  assert.deepEqual(second.audit.entries, [], 'проигравший гонку ничего не пишет в журнал');
});

test('правка менеджера: заметка — пробелы дают NULL, та же заметка — no-op, null стирает, пустая поверх пустой — no-op', async () => {
  const blank = updatePool({ current: managerRow({ owner_notes: 'старая' }), updated: managerRow() });
  const first = makeAdmin({ pool: blank });
  await first.service.update(MANAGER_ID, { note: '   ' }, AS_SUPERADMIN);
  assert.deepEqual(updateCall(blank).params, [MANAGER_ID, null]);
  assert.deepEqual(first.audit.entries[0].target.detail, { noteChanged: true });

  const same = updatePool({ current: managerRow({ owner_notes: 'старая' }) });
  const second = makeAdmin({ pool: same });
  await second.service.update(MANAGER_ID, { note: ' старая ' }, AS_SUPERADMIN);
  assert.equal(updateCall(same), undefined);
  assert.deepEqual(second.audit.entries, []);

  const cleared = updatePool({ current: managerRow({ owner_notes: 'старая' }), updated: managerRow() });
  const third = makeAdmin({ pool: cleared });
  await third.service.update(MANAGER_ID, { note: null }, AS_SUPERADMIN);
  assert.deepEqual(updateCall(cleared).params, [MANAGER_ID, null]);

  for (const note of [null, '', '  ']) {
    const empty = updatePool();
    const fourth = makeAdmin({ pool: empty });
    await fourth.service.update(MANAGER_ID, { note }, AS_SUPERADMIN);
    assert.equal(updateCall(empty), undefined, `заметка ${JSON.stringify(note)} поверх пустой`);
    assert.deepEqual(fourth.audit.entries, []);
  }
});

test('правка менеджера: пустое имя — 400 и ни одного UPDATE', async () => {
  for (const fullName of ['', '   ']) {
    const { service, pool, audit } = makeAdmin({ pool: updatePool() });
    await expectHttp(() => service.update(MANAGER_ID, { fullName }, AS_SUPERADMIN), 400, 'Укажите имя менеджера');
    assert.equal(updateCall(pool), undefined);
    assert.deepEqual(audit.entries, []);
  }
});

test('правка менеджера: доля 0 % — законное значение; у менеджера с NULL-долей «текущая» = 60', async () => {
  const zero = updatePool({ updated: managerRow({ owner_share_percent: '0.00' }) });
  const first = makeAdmin({ pool: zero });
  const result = await first.service.update(MANAGER_ID, { ownerSharePercent: 0 }, AS_SUPERADMIN);
  assert.deepEqual(updateCall(zero).params, [MANAGER_ID, 0]);
  assert.deepEqual(first.audit.entries[0].target.detail, { ownerSharePercent: { from: 60, to: 0 } });
  assert.equal(result.ownerSharePercent, 0, '0 % — не «значение по умолчанию»');

  const legacy = updatePool({ current: managerRow({ owner_share_percent: null }) });
  const second = makeAdmin({ pool: legacy });
  await second.service.update(MANAGER_ID, { ownerSharePercent: 60 }, AS_SUPERADMIN);
  assert.equal(updateCall(legacy), undefined, 'NULL трактуется как 60 — менять нечего');

  const legacyChange = updatePool({
    current: managerRow({ owner_share_percent: null }),
    updated: managerRow({ owner_share_percent: '50.00' }),
  });
  const third = makeAdmin({ pool: legacyChange });
  await third.service.update(MANAGER_ID, { ownerSharePercent: 50 }, AS_SUPERADMIN);
  assert.deepEqual(third.audit.entries[0].target.detail, { ownerSharePercent: { from: 60, to: 50 } });
});

test('правка менеджера: все поля сразу — порядок SET фиксирован, литерал sessions_valid_from не сдвигает номера параметров', async () => {
  seedAuthCache(MANAGER_ID);
  try {
    const pool = updatePool({
      updated: managerRow({ full_name: 'Пётр Новый', phone: '+79995556677', is_active: false }),
    });
    const { service, audit } = makeAdmin({ pool });

    await service.update(
      MANAGER_ID,
      {
        fullName: 'Пётр Новый',
        phone: '+7 999 555 66 77',
        password: 'another-pass-1',
        ownerSharePercent: 40,
        isActive: false,
        note: 'важный',
      },
      AS_SUPERADMIN,
    );

    const update = updateCall(pool);
    assert.equal(
      update.text,
      updateSql(
        'full_name = $2, phone = $3, password = $4, sessions_valid_from = now(), owner_share_percent = $5, is_active = $6, owner_notes = $7',
      ),
    );
    assert.equal(update.params.length, 7);
    assert.deepEqual(
      update.params.filter((_, index) => index !== 3),
      [MANAGER_ID, 'Пётр Новый', '+79995556677', 40, false, 'важный'],
    );
    assert.equal(await bcrypt.compare('another-pass-1', update.params[3]), true);
    assert.deepEqual(audit.entries[0].target.detail, {
      fullName: { from: 'Пётр Менеджеров', to: 'Пётр Новый' },
      phoneChanged: true,
      passwordChanged: true,
      ownerSharePercent: { from: 60, to: 40 },
      isActive: { from: true, to: false },
      noteChanged: true,
    });
    assert.equal(isAuthCached(MANAGER_ID), false);
  } finally {
    dropSeededAuth(MANAGER_ID);
  }
});

test('правка менеджера: UPDATE не вернул строку (менеджера удалили между чтением и записью) — 404 без журнала и без сброса сессий', async () => {
  seedAuthCache(MANAGER_ID);
  try {
    const { service, audit } = makeAdmin({ pool: updatePool({ updateResult: [] }) });
    await expectHttp(() => service.update(MANAGER_ID, { isActive: false }, AS_SUPERADMIN), 404, 'Менеджер не найден');
    assert.deepEqual(audit.entries, []);
    assert.equal(isAuthCached(MANAGER_ID), true);
  } finally {
    dropSeededAuth(MANAGER_ID);
  }
});

test('журнал менеджера: месяцы уходят в ManagerFinanceService как есть (зажимает их он сам), проверка «это менеджер» — первой', async () => {
  const seen = [];
  const finance = {
    ledger: async (...args) => {
      seen.push(args);
      return { payments: [], settlements: [], balance: 0 };
    },
  };
  const { service, pool } = makeAdmin({ pool: fakePool([[MANAGER_BY_ID, [managerRow()]]]), finance });

  await service.ledger(MANAGER_ID, '6');
  await service.ledger(MANAGER_ID, undefined);

  assert.deepEqual(seen, [
    [MANAGER_ID, '6'],
    [MANAGER_ID, undefined],
  ]);
  assert.equal(pool.calls.length, 2, 'на каждый вызов — ровно одна проверка менеджера');
});

const settlementRow = (overrides = {}) => ({
  id: SETTLEMENT_ID,
  manager_id: MANAGER_ID,
  amount: '3000.00',
  note: null,
  settled_on: '2026-09-30',
  created_by: SUPERADMIN_ID,
  created_at: '2026-09-30T09:00:00.000Z',
  ...overrides,
});

/** Пул для расчётов: чтение менеджера, INSERT/DELETE расчёта и остаток (доля владельца минус расчёты). */
function settlementPool({
  insert = [settlementRow()],
  remove = [settlementRow()],
  share = '3000.00',
  settled = '3000.00',
} = {}) {
  return fakePool([
    [MANAGER_BY_ID, [managerRow()]],
    [sqlStart('INSERT INTO manager_settlements'), insert],
    [sqlStart('DELETE FROM manager_settlements'), remove],
    [BALANCE_QUERY, [{ share_total: share, settled_total: settled }]],
  ]);
}
const insertCall = (pool) => pool.calls.find((call) => call.text.startsWith('INSERT INTO manager_settlements'));

test('расчёт с менеджером: дата по умолчанию считается в БД по Москве, ответ — контрактный, в журнале расчёт и остаток ПОСЛЕ него', async () => {
  const pool = settlementPool({ insert: [settlementRow({ note: 'наличные' })] });
  const { service, audit } = makeAdmin({ pool });

  const created = await service.addSettlement(MANAGER_ID, { amount: 3000, note: '  наличные  ' }, AS_SUPERADMIN);

  const insert = insertCall(pool);
  assert.equal(insert.text.includes('COALESCE($4::date, (now() AT TIME ZONE $5)::date)'), true);
  assert.deepEqual(insert.params, [MANAGER_ID, 3000, 'наличные', null, DEFAULT_TIMEZONE, SUPERADMIN_ID]);
  assert.deepEqual(created, {
    id: SETTLEMENT_ID,
    managerId: MANAGER_ID,
    amount: 3000,
    note: 'наличные',
    settledOn: '2026-09-30',
    createdBy: SUPERADMIN_ID,
    createdAt: '2026-09-30T09:00:00.000Z',
  });
  assert.deepEqual(audit.entries, [
    {
      actor: AS_SUPERADMIN,
      action: 'manager_settlement',
      target: {
        targetType: 'user',
        targetId: MANAGER_ID,
        targetName: 'Пётр Менеджеров',
        detail: {
          operation: 'create',
          settlementId: SETTLEMENT_ID,
          amount: 3000,
          settledOn: '2026-09-30',
          note: 'наличные',
          balanceAfter: 0,
        },
      },
    },
  ]);
});

test('расчёт: сумма округляется до копеек, заметка — необязательна (NULL), явная дата уходит параметром как есть', async () => {
  for (const [amount, expected] of [
    [1234.567, 1234.57],
    [0.1 + 0.2, 0.3],
    [10, 10],
  ]) {
    const pool = settlementPool();
    await makeAdmin({ pool }).service.addSettlement(MANAGER_ID, { amount }, AS_SUPERADMIN);
    assert.deepEqual(insertCall(pool).params.slice(0, 4), [MANAGER_ID, expected, null, null], `сумма ${amount}`);
  }
  for (const settledOn of ['2024-02-29', '2026-09-30', '2026-01-01']) {
    const pool = settlementPool();
    await makeAdmin({ pool }).service.addSettlement(MANAGER_ID, { amount: 100, settledOn }, AS_SUPERADMIN);
    assert.equal(insertCall(pool).params[3], settledOn, `дата ${settledOn}`);
  }
});

test('расчёт: отрицательная сумма (возврат, корректировка) без причины — 400 после одной проверки менеджера; с причиной проходит', async () => {
  for (const note of [undefined, null, '', '   ']) {
    const { service, pool, audit } = makeAdmin({ pool: settlementPool() });
    await expectHttp(
      () => service.addSettlement(MANAGER_ID, { amount: -500, note }, AS_SUPERADMIN),
      400,
      'Для отрицательной суммы укажите причину',
    );
    assert.equal(pool.calls.length, 1, `заметка ${JSON.stringify(note)}: писать в БД нельзя`);
    assert.deepEqual(audit.entries, []);
  }

  const pool = settlementPool({ insert: [settlementRow({ amount: '-500.00', note: 'возврат переплаты' })] });
  const { service, audit } = makeAdmin({ pool });
  const created = await service.addSettlement(MANAGER_ID, { amount: -500, note: 'возврат переплаты' }, AS_SUPERADMIN);
  assert.deepEqual(insertCall(pool).params, [
    MANAGER_ID,
    -500,
    'возврат переплаты',
    null,
    DEFAULT_TIMEZONE,
    SUPERADMIN_ID,
  ]);
  assert.equal(created.amount, -500);
  assert.equal(audit.entries[0].target.detail.amount, -500);
});

test('расчёт: нулевая сумма (в том числе после округления до копеек) — 400 без записи', async () => {
  for (const amount of [0, -0, 0.004, -0.004]) {
    const { service, pool, audit } = makeAdmin({ pool: settlementPool() });
    await expectHttp(
      () => service.addSettlement(MANAGER_ID, { amount, note: 'ноль' }, AS_SUPERADMIN),
      400,
      'Сумма расчёта не может быть равна нулю',
    );
    assert.equal(pool.calls.length, 1, `сумма ${amount}`);
    assert.deepEqual(audit.entries, []);
  }
});

test('расчёт: несуществующая календарная дата — 400 до записи (иначе PostgreSQL вернул бы 500)', async () => {
  for (const settledOn of [
    '',
    '0000-01-01',
    '2025-02-29',
    '2026-09-31',
    '2026-13-01',
    '2026-00-10',
    '2026-9-1',
    'вчера',
    '2026-09-30T10:00:00Z',
  ]) {
    const { service, pool, audit } = makeAdmin({ pool: settlementPool() });
    await expectHttp(
      () => service.addSettlement(MANAGER_ID, { amount: 100, settledOn }, AS_SUPERADMIN),
      400,
      'Укажите существующую дату расчёта в формате ГГГГ-ММ-ДД',
    );
    assert.equal(pool.calls.length, 1, `дата ${JSON.stringify(settledOn)}`);
    assert.deepEqual(audit.entries, []);
  }
});

test('отмена расчёта: DELETE только по паре (расчёт, менеджер); удалённая запись целиком и остаток уходят в журнал', async () => {
  const removed = settlementRow({ note: 'ошибочно', settled_on: '2026-09-29' });
  const pool = settlementPool({ remove: [removed], settled: '0.00' });
  const { service, audit } = makeAdmin({ pool });

  const result = await service.removeSettlement(MANAGER_ID, SETTLEMENT_ID, AS_SUPERADMIN);

  assert.deepEqual(result, { ok: true });
  const deleted = pool.calls.find((call) => call.text.startsWith('DELETE FROM manager_settlements'));
  assert.equal(deleted.text.includes('WHERE ms.id = $1 AND ms.manager_id = $2'), true);
  assert.deepEqual(
    deleted.params,
    [SETTLEMENT_ID, MANAGER_ID],
    'чужой расчёт по id не удалить: он привязан к менеджеру из URL',
  );
  assert.deepEqual(audit.entries, [
    {
      actor: AS_SUPERADMIN,
      action: 'manager_settlement',
      target: {
        targetType: 'user',
        targetId: MANAGER_ID,
        targetName: 'Пётр Менеджеров',
        detail: {
          operation: 'remove',
          settlementId: SETTLEMENT_ID,
          amount: 3000,
          settledOn: '2026-09-29',
          note: 'ошибочно',
          balanceAfter: 3000,
        },
      },
    },
  ]);
});

test('отмена расчёта: чужой или несуществующий расчёт — 404 без журнала и без пересчёта остатка', async () => {
  const { service, pool, audit } = makeAdmin({ pool: settlementPool({ remove: [] }) });
  await expectHttp(() => service.removeSettlement(MANAGER_ID, SETTLEMENT_ID, AS_SUPERADMIN), 404, 'Расчёт не найден');
  assert.deepEqual(audit.entries, []);
  assert.equal(
    pool.calls.some((call) => call.text.startsWith('SELECT COALESCE((SELECT SUM(sp.owner_share_amount)')),
    false,
    'остаток не считаем: ничего не изменилось',
  );
});

const TRANSFER_TARGET = exactSql(
  `SELECT id, full_name FROM users WHERE id = $1 AND role = 'manager' AND is_active = true`,
);
const TRANSFER_UPDATE = sqlStart('UPDATE tenants t SET manager_id = $2::uuid');
const TENANT_EXISTS = exactSql('SELECT id FROM tenants WHERE id = $1::uuid');
const NAME_LOOKUP = exactSql('SELECT full_name FROM users WHERE id = $1');
const TRANSFER_UPDATE_SQL = flat(`UPDATE tenants t
          SET manager_id = $2::uuid, updated_at = now()
         FROM (SELECT id, manager_id FROM tenants WHERE id = $1::uuid FOR UPDATE) old
        WHERE t.id = old.id
          AND t.manager_id IS DISTINCT FROM $2::uuid
       RETURNING t.id, t.name, old.manager_id AS previous_manager_id`);

function transferPool({
  target = [{ id: MANAGER_ID, full_name: 'Пётр Менеджеров' }],
  moved = [{ id: TENANT_ID, name: 'Автосервис Восток', previous_manager_id: OTHER_MANAGER_ID }],
  existing = [{ id: TENANT_ID }],
  previous = [{ full_name: 'Анна Иванова' }],
} = {}) {
  return fakePool([
    [TRANSFER_TARGET, target],
    [TRANSFER_UPDATE, moved],
    [TENANT_EXISTS, existing],
    [NAME_LOOKUP, previous],
  ]);
}

test('перенос клиента: новый менеджер проверяется до записи, прежний читается из блокируемой строки; платежи и расчёты не трогаются; в журнале «откуда/куда»', async () => {
  const pool = transferPool();
  const { service, audit } = makeAdmin({ pool });

  const result = await service.transferTenant(TENANT_ID, MANAGER_ID, AS_SUPERADMIN);

  assert.deepEqual(result, { ok: true, tenantId: TENANT_ID, managerId: MANAGER_ID, managerName: 'Пётр Менеджеров' });
  assert.deepEqual(
    pool.calls.map((call) => call.params),
    [[MANAGER_ID], [TENANT_ID, MANAGER_ID], [OTHER_MANAGER_ID]],
  );
  assert.equal(pool.calls[1].text, TRANSFER_UPDATE_SQL);
  for (const call of pool.calls) {
    assert.equal(
      /subscription_payments|manager_settlements/.test(call.text),
      false,
      'история платежей остаётся у прежнего менеджера: меняется только tenants.manager_id',
    );
  }
  assert.deepEqual(audit.entries, [
    {
      actor: AS_SUPERADMIN,
      action: 'tenant_transfer_manager',
      target: {
        targetType: 'tenant',
        targetId: TENANT_ID,
        targetName: 'Автосервис Восток',
        detail: { from: OTHER_MANAGER_ID, to: MANAGER_ID, fromName: 'Анна Иванова', toName: 'Пётр Менеджеров' },
      },
    },
  ]);
});

test('перенос клиента: целевой менеджер не найден, отключён или вообще не менеджер — 400 после одной проверки, тенант не тронут', async () => {
  const pool = transferPool({ target: [] });
  const { service, audit } = makeAdmin({ pool });

  await expectHttp(
    () => service.transferTenant(TENANT_ID, DIRECTOR_ID, AS_SUPERADMIN),
    400,
    'Менеджер не найден или отключён',
  );

  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [DIRECTOR_ID]);
  assert.equal(pool.calls[0].text.includes("role = 'manager' AND is_active = true"), true);
  assert.deepEqual(audit.entries, []);
});

test('перенос клиента: снять с менеджера (null) — проверять некого, первый же запрос UPDATE; в журнале to = null', async () => {
  const pool = transferPool({
    moved: [{ id: TENANT_ID, name: 'Автосервис Восток', previous_manager_id: MANAGER_ID }],
    previous: [{ full_name: 'Пётр Менеджеров' }],
  });
  const { service, audit } = makeAdmin({ pool });

  const result = await service.transferTenant(TENANT_ID, null, AS_SUPERADMIN);

  assert.deepEqual(result, { ok: true, tenantId: TENANT_ID, managerId: null, managerName: null });
  assert.equal(pool.calls[0].text, TRANSFER_UPDATE_SQL);
  assert.deepEqual(pool.calls[0].params, [TENANT_ID, null]);
  assert.deepEqual(audit.entries[0].target.detail, {
    from: MANAGER_ID,
    to: null,
    fromName: 'Пётр Менеджеров',
    toName: null,
  });
});

test('перенос клиента: тот же менеджер (или снятие с уже свободного) — no-op: UPDATE вернул ноль строк, журнала нет', async () => {
  const same = transferPool({ moved: [] });
  const first = makeAdmin({ pool: same });
  const result = await first.service.transferTenant(TENANT_ID, MANAGER_ID, AS_SUPERADMIN);
  assert.deepEqual(result, { ok: true, tenantId: TENANT_ID, managerId: MANAGER_ID, managerName: 'Пётр Менеджеров' });
  assert.deepEqual(first.audit.entries, []);
  assert.equal(same.calls.length, 3, 'проверка менеджера, UPDATE, проверка существования тенанта');
  assert.equal(same.calls[2].text, 'SELECT id FROM tenants WHERE id = $1::uuid');

  const detach = transferPool({ moved: [] });
  const second = makeAdmin({ pool: detach });
  const detached = await second.service.transferTenant(TENANT_ID, null, AS_SUPERADMIN);
  assert.deepEqual(detached, { ok: true, tenantId: TENANT_ID, managerId: null, managerName: null });
  assert.deepEqual(second.audit.entries, []);
});

test('перенос клиента: у тенанта не было менеджера — прежнее имя не ищем, from = null; прежнего менеджера уже нет — fromName = null, from сохранён', async () => {
  const unowned = transferPool({ moved: [{ id: TENANT_ID, name: 'Автосервис Восток', previous_manager_id: null }] });
  const first = makeAdmin({ pool: unowned });
  await first.service.transferTenant(TENANT_ID, MANAGER_ID, AS_SUPERADMIN);
  assert.equal(unowned.calls.length, 2, 'без прежнего менеджера поиск его имени не нужен');
  assert.deepEqual(first.audit.entries[0].target.detail, {
    from: null,
    to: MANAGER_ID,
    fromName: null,
    toName: 'Пётр Менеджеров',
  });

  const gone = transferPool({ previous: [] });
  const second = makeAdmin({ pool: gone });
  await second.service.transferTenant(TENANT_ID, MANAGER_ID, AS_SUPERADMIN);
  assert.deepEqual(second.audit.entries[0].target.detail, {
    from: OTHER_MANAGER_ID,
    to: MANAGER_ID,
    fromName: null,
    toName: 'Пётр Менеджеров',
  });
});

test('перенос клиента: несуществующий тенант — 404 без журнала', async () => {
  const { service, audit } = makeAdmin({ pool: transferPool({ moved: [], existing: [] }) });
  await expectHttp(() => service.transferTenant(FOREIGN_TENANT_ID, MANAGER_ID, AS_SUPERADMIN), 404, 'Тенант не найден');
  assert.deepEqual(audit.entries, []);
});

// ───────────────────────────────────────────────────────────────────────────
// М. Ответы и тела запросов сверяются с контрактом shared/ (он — источник истины и здесь не правится)
// ───────────────────────────────────────────────────────────────────────────

const contractTypes = readRepo('shared', 'types', 'index.ts');
const contractApi = readRepo('shared', 'api', 'types.ts');

/** Код без комментариев: в JSDoc контракта есть `{ days }`, `{@link ...}` — скобки сломали бы счёт. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** Поля верхнего уровня `name?: type` → Map(имя → { optional, type }); вложенное ({}, (), [], <>) не разбирается. */
function propsOfBody(body) {
  const props = new Map();
  let depth = 0;
  let current = '';
  const flush = () => {
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]*)$/.exec(current);
    if (match) props.set(match[1], { optional: match[2] === '?', type: match[3].trim() });
    current = '';
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '{' || char === '(' || char === '[' || char === '<') depth += 1;
    if (char === '}' || char === ')' || char === ']' || (char === '>' && body[index - 1] !== '=')) depth -= 1;
    if (depth === 0 && (char === ';' || char === ',')) flush();
    else current += char;
  }
  flush();
  return props;
}

/** Поля `export interface <name> { ... }` из исходника контракта (счёт фигурных скобок). */
function contractProps(source, name) {
  const text = stripComments(source);
  const head = new RegExp(`export interface ${name}\\b[^{]*\\{`).exec(text);
  assert.ok(head, `в контракте нет интерфейса ${name}`);
  const start = head.index + head[0].length;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < text.length) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}') depth -= 1;
    end += 1;
  }
  const props = propsOfBody(text.slice(start, end - 1));
  assert.ok(props.size > 0, `интерфейс ${name} разобран пустым`);
  return props;
}

/** Поля вложенного литерального типа `{ a: string; b: number }`. */
const inlineProps = (type) => propsOfBody(type.trim().replace(/^\{/, '').replace(/\}$/, ''));

/** Значение годится под простой тип контракта; сложные (вложенные объекты, массивы) проверяются отдельно. */
function matchesType(value, type) {
  return type
    .split('|')
    .map((member) => member.trim())
    .some((member) => {
      if (member === 'string') return typeof value === 'string';
      if (member === 'number') return typeof value === 'number' && Number.isFinite(value);
      if (member === 'boolean') return typeof value === 'boolean';
      if (member === 'null') return value === null;
      if (member === 'true') return value === true;
      if (/^'.*'$/.test(member)) return value === member.slice(1, -1);
      return true;
    });
}

/**
 * Форма ответа == контракт: обязательные поля присутствуют, типы простых полей совпадают,
 * лишних (клиентам неизвестных) полей нет — кроме явно разрешённых `allowExtra`.
 */
function assertShape(actual, contract, label, { allowExtra = [] } = {}) {
  assert.ok(actual !== null && typeof actual === 'object', `${label}: ожидался объект`);
  const keys = Object.keys(actual);
  for (const [key, spec] of contract) {
    if (actual[key] === undefined) {
      assert.ok(spec.optional, `${label}: в ответе нет поля ${key}, обязательного по контракту`);
      continue;
    }
    assert.ok(
      matchesType(actual[key], spec.type),
      `${label}: поле ${key} = ${JSON.stringify(actual[key])} не соответствует типу ${spec.type}`,
    );
  }
  for (const key of keys) {
    assert.ok(contract.has(key) || allowExtra.includes(key), `${label}: поле ${key} не описано в контракте`);
  }
}

test('разбор контракта: скобки в JSDoc и вложенные типы не сбивают список полей', () => {
  const summary = contractProps(contractTypes, 'ManagerSummary');
  assert.ok(summary.has('tenants') && summary.has('balance') && summary.has('maxFreeDays'));
  assert.deepEqual(
    [...inlineProps(summary.get('tenants').type).keys()],
    ['total', 'active', 'expired', 'suspended', 'expiringIn7d'],
  );
  assert.equal(contractProps(contractTypes, 'PlatformManager').get('note').optional, true);
  assert.equal(contractProps(contractTypes, 'PlatformManagerDetail').has('summary'), true);
  assert.equal(
    contractProps(contractTypes, 'PlatformManagerDetail').has('balance'),
    false,
    'унаследованные поля не считаются',
  );
  assert.match(stripComments(contractTypes), /export interface PlatformManagerDetail extends PlatformManager\b/);
  assert.equal(contractProps(contractApi, 'ExtendSubscriptionRequest').get('creditManager').optional, true);
});

test('контракт: PlatformManager — список и создание отдают ровно поля контракта нужных типов', async () => {
  const contract = contractProps(contractTypes, 'PlatformManager');
  const pool = fakePool([[MANAGER_LIST, [managerRow()]], ...statsRoutes(OTHER_STATS)]);
  const [listed] = await makeAdmin({ pool }).service.list();
  assertShape(listed, contract, 'список менеджеров');

  const created = await makeAdmin({ pool: createManagerPool() }).service.create(CREATE_INPUT, AS_SUPERADMIN);
  assertShape(created, contract, 'создание менеджера');
});

test('контракт: ManagerSummary — включая вложенные счётчики клиентов', () => {
  const contract = contractProps(contractTypes, 'ManagerSummary');
  const finance = new ManagerFinanceService(fakePool(), tenantsStub());
  const summary = finance.buildSummary(emptyManagerStats(), DEFAULT_OWNER_SHARE_PERCENT, DEFAULT_MANAGER_MAX_FREE_DAYS);
  assertShape(summary, contract, 'сводка менеджера');
  assertShape(summary.tenants, inlineProps(contract.get('tenants').type), 'сводка менеджера: клиенты');
});

test('контракт: ManagerSettlement — созданный и прочитанный расчёт (в том числе с удалённым автором)', async () => {
  const contract = contractProps(contractTypes, 'ManagerSettlement');
  const created = await makeAdmin({ pool: settlementPool() }).service.addSettlement(
    MANAGER_ID,
    { amount: 3000 },
    AS_SUPERADMIN,
  );
  assertShape(created, contract, 'созданный расчёт');
  assertShape(ManagerFinanceService.mapSettlement(settlementRow({ created_by: null })), contract, 'расчёт без автора');
});

test('контракт: PlatformManagerDetail — карточка = PlatformManager + summary + tenants', async () => {
  const contract = new Map([
    ...contractProps(contractTypes, 'PlatformManager'),
    ...contractProps(contractTypes, 'PlatformManagerDetail'),
  ]);
  const pool = fakePool([[MANAGER_BY_ID, [managerRow()]], ...statsRoutes(OTHER_STATS)]);
  const detail = await makeAdmin({ pool }).service.get(MANAGER_ID);
  assertShape(detail, contract, 'карточка менеджера');
  assertShape(detail.summary, contractProps(contractTypes, 'ManagerSummary'), 'карточка менеджера: сводка');
});

test('контракт: ManagerLedger — платежи в форме SubscriptionPayment + tenantName, расчёты, остаток за всё время', async () => {
  const contract = contractProps(contractTypes, 'ManagerLedger');
  const pool = fakePool([
    [
      sqlStart('SELECT sp.*, t.name AS tenant_name'),
      [
        {
          id: 'p-1',
          tenant_id: TENANT_ID,
          amount: '5000.00',
          is_free: false,
          period_from: '2026-09-30T00:00:00.000Z',
          period_to: '2026-10-30T00:00:00.000Z',
          previous_end: null,
          note: null,
          created_by: SUPERADMIN_ID,
          created_at: '2026-09-30T09:00:00.000Z',
          manager_id: MANAGER_ID,
          owner_share_percent: '60.00',
          owner_share_amount: '3000.00',
          plan_id: PLAN_ID,
          plan_name: 'Стандарт',
          tenant_name: 'Автосервис Восток',
        },
      ],
    ],
    [sqlStart('SELECT ms.id, ms.manager_id'), [settlementRow({ amount: '1000.00' })]],
    [BALANCE_QUERY, [{ share_total: '3000.00', settled_total: '1000.00' }]],
  ]);

  const ledger = await new ManagerFinanceService(pool, makeTenants(pool)).ledger(MANAGER_ID, 12);

  assertShape(ledger, contract, 'журнал менеджера');
  assert.equal(ledger.payments.length, 1);
  assertShape(ledger.payments[0], contractProps(contractTypes, 'SubscriptionPayment'), 'платёж журнала', {
    allowExtra: ['tenantName'],
  });
  assert.equal(ledger.payments[0].tenantName, 'Автосервис Восток');
  assertShape(ledger.settlements[0], contractProps(contractTypes, 'ManagerSettlement'), 'расчёт журнала');
  assert.equal(ledger.balance, 2000, 'остаток = доля владельца − расчёты, за всё время');
});

test('контракт: ManagerPhoneTakenError — тело 409 при занятом телефоне', () => {
  const contract = contractProps(contractTypes, 'ManagerPhoneTakenError');
  const error = phoneTakenError();
  assert.equal(error.getStatus(), 409);
  assertShape(error.getResponse(), contract, 'PHONE_TAKEN');
  assert.equal(contract.get('code').type, "'PHONE_TAKEN'");
});

test('контракт: TransferTenantManagerResponse — перенос и снятие с менеджера', async () => {
  const contract = contractProps(contractApi, 'TransferTenantManagerResponse');
  const moved = await makeAdmin({ pool: transferPool() }).service.transferTenant(TENANT_ID, MANAGER_ID, AS_SUPERADMIN);
  assertShape(moved, contract, 'перенос клиента');
  const detached = await makeAdmin({ pool: transferPool({ moved: [] }) }).service.transferTenant(
    TENANT_ID,
    null,
    AS_SUPERADMIN,
  );
  assertShape(detached, contract, 'снятие клиента с менеджера');
});

/** Тела запросов из контракта: каждое поле должно пройти ValidationPipe (whitelist) БЕЗ потерь. */
const CONTRACT_BODIES = [
  [
    'CreateManagerRequest',
    CreateManagerDto,
    {
      fullName: 'Пётр Менеджеров',
      phone: '+79991112233',
      password: 'manager-pass-1',
      ownerSharePercent: 60,
      note: 'заметка',
    },
  ],
  [
    'UpdateManagerRequest',
    UpdateManagerDto,
    {
      fullName: 'Пётр Новый',
      phone: '+79995556677',
      password: 'manager-pass-2',
      ownerSharePercent: 40,
      isActive: false,
      note: 'заметка',
    },
  ],
  ['CreateSettlementRequest', CreateSettlementDto, { amount: 3000, note: 'наличные', settledOn: '2026-09-30' }],
  ['TransferTenantManagerRequest', TransferTenantManagerDto, { managerId: MANAGER_ID }],
  ['ResetOwnerPasswordRequest', ResetOwnerPasswordDto, { password: 'owner-pass-1' }],
  [
    'CreateManagerTenantRequest',
    CreateManagerTenantDto,
    {
      name: 'Автосервис Восток',
      phone: '+79991112233',
      address: 'Москва, Тверская 1',
      planId: PLAN_ID,
      director: { name: 'Иван Директоров', phone: '+79995556677', password: 'director-pass' },
      trialDays: 14,
      note: 'заметка менеджера',
    },
  ],
];
const EXTEND_BODY = {
  days: 30,
  type: 'paid',
  amount: 5000,
  until: '2027-01-01T00:00:00.000Z',
  note: 'оплата',
  creditManager: true,
};

test('контракт: DTO принимают ВСЕ поля тел запросов из shared/api/types.ts и не вводят лишних', async () => {
  for (const [name, Dto, body] of CONTRACT_BODIES) {
    const contract = contractProps(contractApi, name);
    assert.deepEqual(
      Object.keys(body).sort(),
      [...contract.keys()].sort(),
      `${name}: образец тела в тесте должен покрывать все поля контракта (контракт изменился?)`,
    );
    const dto = await validateBody(Dto, body);
    assert.deepEqual(Object.keys(dto).sort(), [...contract.keys()].sort(), `${name}: whitelist вырезал поле контракта`);
    for (const [key, spec] of contract) {
      if (spec.type.startsWith('{')) {
        assert.deepEqual(
          Object.keys(dto[key]).sort(),
          [...inlineProps(spec.type).keys()].sort(),
          `${name}.${key}: вложенный DTO потерял поля`,
        );
      } else {
        assert.deepEqual(dto[key], body[key], `${name}.${key}: значение изменилось при валидации`);
      }
    }
  }
});

test('контракт: продление — суперадминский DTO принимает creditManager, менеджерский — нет (это единственное расхождение)', async () => {
  const contract = contractProps(contractApi, 'ExtendSubscriptionRequest');
  assert.deepEqual(Object.keys(EXTEND_BODY).sort(), [...contract.keys()].sort(), 'образец должен покрывать контракт');

  const superadminDto = await validateBody(ExtendSubscriptionDto, EXTEND_BODY);
  assert.deepEqual(Object.keys(superadminDto).sort(), [...contract.keys()].sort());
  assert.equal(superadminDto.creditManager, true);

  const managerDto = await validateBody(ManagerExtendDto, EXTEND_BODY);
  assert.deepEqual(
    Object.keys(managerDto).sort(),
    [...contract.keys()].filter((key) => key !== 'creditManager').sort(),
  );
  assert.equal(
    'creditManager' in managerDto,
    false,
    'менеджерский маршрут флаг игнорирует: его платные продления несут долю всегда',
  );

  await expectHttp(() => validateBody(ExtendSubscriptionDto, { ...EXTEND_BODY, creditManager: 'yes' }), 400);
});

test('контракт: UpdateManagerRequest.note = null (очистить) и TransferTenantManagerRequest.managerId = null (снять) проходят как есть', async () => {
  const update = await validateBody(UpdateManagerDto, { note: null });
  assert.equal(update.note, null);
  assert.equal(contractProps(contractApi, 'UpdateManagerRequest').get('note').type, 'string | null');

  const transfer = await validateBody(TransferTenantManagerDto, { managerId: null });
  assert.equal(transfer.managerId, null);
  assert.equal(contractProps(contractApi, 'TransferTenantManagerRequest').get('managerId').type, 'string | null');
});

// ───────────────────────────────────────────────────────────────────────────
// Н. ManagerFinanceService: единственный источник денег менеджера (список, карточка, кабинет)
// ───────────────────────────────────────────────────────────────────────────

const financeOf = (pool = fakePool(), tenants = tenantsStub()) => new ManagerFinanceService(pool, tenants);
const SHARE_PERCENT_QUERY = exactSql("SELECT owner_share_percent FROM users WHERE id = $1 AND role = 'manager'");

test('toMoney / subtractMoney: копейки без float-хвостов, мусор из БД — 0, переплата — отрицательный остаток', () => {
  assert.equal(toMoney('5000.00'), 5000);
  assert.equal(toMoney('1234.567'), 1234.57);
  assert.equal(toMoney(740.74), 740.74);
  assert.equal(toMoney('-100.10'), -100.1);
  for (const junk of [null, undefined, '', 'abc', NaN, Infinity]) assert.equal(toMoney(junk), 0, String(junk));

  assert.equal(subtractMoney(0.3, 0.1), 0.2, '0.3 − 0.1 без хвоста 0.19999999999999998');
  assert.equal(subtractMoney(4800, 1000), 3800);
  assert.equal(subtractMoney(3000, 3000), 0);
  assert.equal(subtractMoney(1234.56, 740.74), 493.82);
  assert.equal(subtractMoney(100, 100.01), -0.01, 'менеджер расплатился с запасом — остаток отрицательный, а не ноль');
});

test('clampLedgerMonths: окно лент 1..36, по умолчанию 12; мусор и бесконечность — по умолчанию', () => {
  assert.equal(LEDGER_DEFAULT_MONTHS, 12);
  for (const junk of [undefined, null, '', 'abc', NaN, Infinity, -Infinity, {}]) {
    assert.equal(clampLedgerMonths(junk), 12, String(junk));
  }
  assert.equal(clampLedgerMonths(0), 1);
  assert.equal(clampLedgerMonths(-5), 1);
  assert.equal(clampLedgerMonths('1'), 1);
  assert.equal(clampLedgerMonths('6'), 6);
  assert.equal(clampLedgerMonths(6.9), 6);
  assert.equal(clampLedgerMonths(36), 36);
  assert.equal(clampLedgerMonths(37), 36);
  assert.equal(clampLedgerMonths('1000000'), 36);
});

test('statsFor: пустой список — пустая карта и ни одного запроса', async () => {
  const pool = fakePool();
  const stats = await financeOf(pool).statsFor([]);
  assert.equal(stats.size, 0);
  assert.equal(pool.calls.length, 0);
});

test('statsFor: три запроса на весь список; менеджер без строк — нули; баланс = доля − расчёты', async () => {
  const pool = fakePool(statsRoutes(OTHER_STATS));
  const stats = await financeOf(pool).statsFor([MANAGER_ID, OTHER_MANAGER_ID]);

  assert.equal(pool.calls.length, 3, 'клиенты + платежи + расчёты — независимо от числа менеджеров');
  for (const call of pool.calls) assert.deepEqual(call.params, [[MANAGER_ID, OTHER_MANAGER_ID]]);
  assert.deepEqual(stats.get(MANAGER_ID), {
    tenants: { total: 4, active: 3, expired: 1, suspended: 0, expiringIn7d: 1 },
    money: {
      paidThisMonth: 5000,
      ownerShareThisMonth: 3000,
      paidTotal: 8000,
      ownerShareTotal: 4800,
      settledTotal: 1000,
      balance: 3800,
    },
  });
  assert.deepEqual(
    stats.get(OTHER_MANAGER_ID),
    emptyManagerStats(),
    'нет клиентов, платежей и расчётов — нули, а не «нет записи»',
  );
});

test('statsFor: деньги — по платёжной строке менеджера (sp.manager_id) и только платные; клиенты — по нынешнему владельцу; статус подписки — единое правило', async () => {
  const pool = fakePool(statsRoutes());
  await financeOf(pool).statsFor([MANAGER_ID]);
  const [tenantSql, paymentSql, settlementSql] = pool.calls.map((call) => call.text);

  assert.match(tenantSql, /FROM tenants t WHERE t\.manager_id = ANY\(\$1::uuid\[\]\) GROUP BY t\.manager_id$/);
  assert.ok(
    tenantSql.includes('(t.suspended_at IS NOT NULL OR t.is_active IS FALSE)'),
    'suspended: как computeSubscriptionStatusOf',
  );
  assert.match(
    paymentSql,
    /FROM subscription_payments sp WHERE sp\.manager_id = ANY\(\$1::uuid\[\]\) AND sp\.is_free = false GROUP BY sp\.manager_id$/,
  );
  assert.match(
    paymentSql,
    /SUM\(sp\.owner_share_amount\)/,
    'долг — сумма СНИМКОВ доли, а не пересчёт по нынешнему проценту',
  );
  assert.doesNotMatch(paymentSql, /tenants/, 'передача клиента другому менеджеру не переписывает историю долга');
  assert.match(
    settlementSql,
    /FROM manager_settlements ms WHERE ms\.manager_id = ANY\(\$1::uuid\[\]\) GROUP BY ms\.manager_id$/,
  );
});

test('statsFor: строки менеджеров, которых не просили, игнорируются; NULL и мусор в агрегатах — нули; float-хвост баланса не всплывает', async () => {
  const pool = fakePool(
    statsRoutes({
      tenantRows: [
        { manager_id: OTHER_MANAGER_ID, total: 9, active: 9, expired: 0, suspended: 0, expiring_in_7d: 0 },
        { manager_id: MANAGER_ID, total: null, active: undefined, expired: 'x', suspended: 2, expiring_in_7d: null },
      ],
      paymentRows: [
        {
          manager_id: OTHER_MANAGER_ID,
          paid_month: '1.00',
          share_month: '1.00',
          paid_total: '1.00',
          share_total: '1.00',
        },
        { manager_id: MANAGER_ID, paid_month: null, share_month: null, paid_total: '0.30', share_total: '0.30' },
      ],
      settlementRows: [{ manager_id: MANAGER_ID, settled_total: '0.10' }],
    }),
  );
  const stats = await financeOf(pool).statsFor([MANAGER_ID]);

  assert.equal(stats.size, 1);
  assert.equal(stats.has(OTHER_MANAGER_ID), false, 'чужой менеджер в результат не попадает');
  assert.deepEqual(stats.get(MANAGER_ID).tenants, { total: 0, active: 0, expired: 0, suspended: 2, expiringIn7d: 0 });
  assert.deepEqual(stats.get(MANAGER_ID).money, {
    paidThisMonth: 0,
    ownerShareThisMonth: 0,
    paidTotal: 0.3,
    ownerShareTotal: 0.3,
    settledTotal: 0.1,
    balance: 0.2,
  });
});

test('platformTenantCounters: один запрос по всей таблице tenants без параметров; пусто — нули', async () => {
  const pool = fakePool([[/FROM tenants t$/, [{ total: 10, active: 6, expired: 3, suspended: 1, expiring_in_7d: 2 }]]]);
  assert.deepEqual(await financeOf(pool).platformTenantCounters(), {
    total: 10,
    active: 6,
    expired: 3,
    suspended: 1,
    expiringIn7d: 2,
  });
  assert.equal(pool.calls.length, 1);
  assert.equal(pool.calls[0].params, undefined, 'счётчики платформы — без фильтра по менеджеру');
  assert.deepEqual(await financeOf().platformTenantCounters(), emptyManagerStats().tenants);
});

test('balanceOf: платная доля владельца по платежам менеджера минус его расчёты — за ВСЁ время; нет строк — 0; переплата — минус', async () => {
  const pool = fakePool([[BALANCE_QUERY, [{ share_total: '4800.00', settled_total: '1000.00' }]]]);
  assert.equal(await financeOf(pool).balanceOf(MANAGER_ID), 3800);
  assert.deepEqual(pool.calls[0].params, [MANAGER_ID]);
  const sql = pool.calls[0].text;
  assert.match(sql, /FROM subscription_payments sp WHERE sp\.manager_id = \$1 AND sp\.is_free = false/);
  assert.match(sql, /FROM manager_settlements ms WHERE ms\.manager_id = \$1/);
  assert.doesNotMatch(sql, /created_at|date_trunc|interval/, 'окно ленты на баланс не влияет');

  assert.equal(await financeOf().balanceOf(MANAGER_ID), 0, 'у менеджера без платежей и расчётов баланс 0');
  const overpaid = fakePool([[BALANCE_QUERY, [{ share_total: '1000.00', settled_total: '1500.50' }]]]);
  assert.equal(await financeOf(overpaid).balanceOf(MANAGER_ID), -500.5);
});

test('ownerSharePercentOf: текущая доля из профиля менеджера; NULL, нет строки и мусор — 60; ноль — это 0, а не «не задано»', async () => {
  const percentOf = async (rows) => {
    const pool = fakePool([[SHARE_PERCENT_QUERY, rows]]);
    const percent = await financeOf(pool).ownerSharePercentOf(MANAGER_ID);
    assert.deepEqual(pool.calls[0].params, [MANAGER_ID]);
    return percent;
  };
  assert.equal(await percentOf([{ owner_share_percent: '45.50' }]), 45.5);
  assert.equal(await percentOf([{ owner_share_percent: '0.00' }]), 0);
  assert.equal(await percentOf([{ owner_share_percent: '100.00' }]), 100);
  assert.equal(await percentOf([{ owner_share_percent: null }]), DEFAULT_OWNER_SHARE_PERCENT);
  assert.equal(await percentOf([]), DEFAULT_OWNER_SHARE_PERCENT);
  assert.equal(await percentOf([{ owner_share_percent: 'abc' }]), DEFAULT_OWNER_SHARE_PERCENT);
});

test('buildSummary: «моя доля» = оплачено − доля владельца за месяц (копейки точно), остальное — как пришло', () => {
  const stats = {
    tenants: { total: 5, active: 4, expired: 1, suspended: 0, expiringIn7d: 2 },
    money: {
      paidThisMonth: 1234.56,
      ownerShareThisMonth: 740.74,
      paidTotal: 5000,
      ownerShareTotal: 3000,
      settledTotal: 500,
      balance: 2500,
    },
  };
  const summary = financeOf().buildSummary(stats, 60, 14);
  assert.equal(summary.myShareThisMonth, 493.82);
  assert.equal(summary.paidThisMonth, 1234.56);
  assert.equal(summary.ownerShareThisMonth, 740.74);
  assert.equal(summary.balance, 2500);
  assert.equal(summary.ownerSharePercent, 60);
  assert.equal(summary.maxFreeDays, 14);
  assert.deepEqual(summary.tenants, stats.tenants);
});

/** Пул ленты: платежи с названием автосервиса, расчёты и баланс за всё время. */
const ledgerPool = ({ payments = [], settlements = [], share = '0', settled = '0' } = {}) =>
  fakePool([
    [sqlStart('SELECT sp.*, t.name AS tenant_name'), payments],
    [sqlStart('SELECT ms.id, ms.manager_id'), settlements],
    [BALANCE_QUERY, [{ share_total: share, settled_total: settled }]],
  ]);
const listCalls = (pool) => pool.calls.filter((call) => !call.text.startsWith('SELECT COALESCE'));

test('ledger: окно месяцев зажимается 1..36 (по умолчанию 12) для обеих лент; баланс — отдельным запросом и за всё время', async () => {
  for (const [raw, months] of [
    [undefined, 12],
    ['999', 36],
    ['0', 1],
    [3, 3],
  ]) {
    const pool = ledgerPool({ share: '3000.00', settled: '1000.00' });
    const ledger = await financeOf(pool).ledger(MANAGER_ID, raw);
    assert.equal(ledger.balance, 2000, 'баланс от окна не зависит');
    assert.equal(pool.calls.length, 3);
    for (const call of listCalls(pool)) assert.deepEqual(call.params, [MANAGER_ID, months], `окно ${String(raw)}`);
    assert.deepEqual(pool.calls.find((call) => call.text.startsWith('SELECT COALESCE')).params, [MANAGER_ID]);
  }
});

test('ledger: платежи — только платные и только ЭТОГО менеджера, с названием автосервиса; обе ленты ограничены сверху', async () => {
  const pool = ledgerPool();
  await financeOf(pool).ledger(MANAGER_ID, 12);
  const [paymentSql, settlementSql] = listCalls(pool).map((call) => call.text);

  assert.match(
    paymentSql,
    /JOIN tenants t ON t\.id = sp\.tenant_id WHERE sp\.manager_id = \$1 AND sp\.is_free = false AND/,
  );
  assert.match(paymentSql, /ORDER BY sp\.created_at DESC, sp\.id DESC LIMIT 2000$/);
  assert.match(settlementSql, /FROM manager_settlements ms WHERE ms\.manager_id = \$1 AND ms\.settled_on >=/);
  assert.match(settlementSql, /ORDER BY ms\.settled_on DESC, ms\.created_at DESC, ms\.id DESC LIMIT 2000$/);
  assert.ok(
    settlementSql.includes("to_char(ms.settled_on, 'YYYY-MM-DD') AS settled_on"),
    'дата расчёта — строкой, без сдвига пояса',
  );
});

test('ledger: платёж собирает TenantsService.mapSubscriptionPayment + tenantName; расчёт — mapSettlement; пусто — пустые ленты', async () => {
  const tenants = {
    ...tenantsStub(),
    mapSubscriptionPayment: (row) => ({ id: row.id, mappedBy: 'TenantsService' }),
  };
  const pool = ledgerPool({
    payments: [{ id: 'p-1', tenant_name: 'Автосервис Восток' }],
    settlements: [settlementRow()],
    share: '3000.00',
    settled: '3000.00',
  });
  const ledger = await financeOf(pool, tenants).ledger(MANAGER_ID, 12);
  assert.deepEqual(ledger.payments, [{ id: 'p-1', mappedBy: 'TenantsService', tenantName: 'Автосервис Восток' }]);
  assert.deepEqual(ledger.settlements, [ManagerFinanceService.mapSettlement(settlementRow())]);
  assert.equal(ledger.balance, 0);

  assert.deepEqual(await financeOf(ledgerPool(), tenants).ledger(MANAGER_ID, 12), {
    payments: [],
    settlements: [],
    balance: 0,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// О. PlatformSettingsService: потолок бесплатных дней менеджера (managerMaxFreeDays)
// ───────────────────────────────────────────────────────────────────────────

const READ_MINUTES_SQL = 'SELECT global_free_voice_minutes FROM platform_settings WHERE id = 1';
const READ_DAYS_SQL = 'SELECT manager_max_free_days FROM platform_settings WHERE id = 1';
const READ_MINUTES = exactSql(READ_MINUTES_SQL);
const READ_DAYS = exactSql(READ_DAYS_SQL);
const SETTINGS_UPSERT = sqlStart(
  'INSERT INTO platform_settings (id, global_free_voice_minutes, manager_max_free_days, updated_at)',
);

/** Дефолт минут берётся из env: тест не должен зависеть от окружения разработчика. */
async function withVoiceEnv(value, run) {
  const saved = process.env.GLOBAL_FREE_VOICE_MINUTES;
  if (value === undefined) delete process.env.GLOBAL_FREE_VOICE_MINUTES;
  else process.env.GLOBAL_FREE_VOICE_MINUTES = value;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.GLOBAL_FREE_VOICE_MINUTES;
    else process.env.GLOBAL_FREE_VOICE_MINUTES = saved;
  }
}

const settingsOf = (pool) => new PlatformSettingsService(pool);

test('getManagerMaxFreeDays: значение из БД; нет строки, ноль/минус/мусор и сбой чтения — дефолт 30, а не «без ограничений»', async () => {
  const daysWith = (routeValue) => settingsOf(fakePool([[READ_DAYS, routeValue]])).getManagerMaxFreeDays();
  assert.equal(DEFAULT_MANAGER_MAX_FREE_DAYS, 30);
  assert.equal(await daysWith([{ manager_max_free_days: 14 }]), 14);
  assert.equal(await daysWith([{ manager_max_free_days: '45' }]), 45);
  assert.equal(await daysWith([{ manager_max_free_days: 365 }]), 365);
  for (const raw of [0, -3, '0', null, undefined, 'abc', '']) {
    assert.equal(await daysWith([{ manager_max_free_days: raw }]), 30, `значение ${String(raw)}`);
  }
  assert.equal(await daysWith([]), 30, 'строки настроек нет');
  assert.equal(
    await daysWith(new Error('connection terminated')),
    30,
    'сбой чтения не превращается ни в ошибку, ни в «без ограничений»',
  );

  const pool = fakePool([[READ_DAYS, []]]);
  await settingsOf(pool).getManagerMaxFreeDays();
  assert.equal(pool.calls.length, 1, 'нет строки — дефолт без записи в БД (строку сидирует чтение минут / PATCH)');
});

test('getSettings: минуты и потолок дней — два чтения по порядку; свежая база — дефолты и один сид минут без дней', async () => {
  await withVoiceEnv(undefined, async () => {
    const seeded = fakePool([
      [READ_MINUTES, [{ global_free_voice_minutes: 25 }]],
      [READ_DAYS, [{ manager_max_free_days: 45 }]],
    ]);
    assert.deepEqual(await settingsOf(seeded).getSettings(), { globalFreeVoiceMinutes: 25, managerMaxFreeDays: 45 });
    assert.deepEqual(
      seeded.calls.map((call) => call.text),
      [READ_MINUTES_SQL, READ_DAYS_SQL],
      'сначала минуты (они сидируют синглтон), потом дни',
    );

    const fresh = fakePool();
    assert.deepEqual(await settingsOf(fresh).getSettings(), { globalFreeVoiceMinutes: 10, managerMaxFreeDays: 30 });
    const writes = fresh.calls.filter((call) => call.text.startsWith('INSERT'));
    assert.equal(writes.length, 1, 'сид синглтона — один INSERT');
    assert.deepEqual(writes[0].params, [10]);
    assert.doesNotMatch(writes[0].text, /manager_max_free_days/, 'колонка дней получает DEFAULT миграции 173');
    assert.match(writes[0].text, /ON CONFLICT \(id\) DO NOTHING$/);
  });
});

test('updateSettings: пустой патч — только чтение, без UPSERT', async () => {
  await withVoiceEnv(undefined, async () => {
    const pool = fakePool([
      [READ_MINUTES, [{ global_free_voice_minutes: 10 }]],
      [READ_DAYS, [{ manager_max_free_days: 30 }]],
    ]);
    assert.deepEqual(await settingsOf(pool).updateSettings({}), { globalFreeVoiceMinutes: 10, managerMaxFreeDays: 30 });
    assert.equal(
      pool.calls.some((call) => call.text.startsWith('INSERT')),
      false,
    );
  });
});

test('updateSettings: передаётся только то, что пришло (остальное — null, COALESCE оставит текущее); ответ — числа из RETURNING', async () => {
  await withVoiceEnv(undefined, async () => {
    const upsertPool = (returned) => fakePool([[SETTINGS_UPSERT, [returned]]]);

    const onlyDays = upsertPool({ global_free_voice_minutes: '10', manager_max_free_days: 45 });
    assert.deepEqual(await settingsOf(onlyDays).updateSettings({ managerMaxFreeDays: 45 }), {
      globalFreeVoiceMinutes: 10,
      managerMaxFreeDays: 45,
    });
    assert.deepEqual(onlyDays.calls[0].params, [null, 45, 10, 30]);
    assert.match(
      onlyDays.calls[0].text,
      /global_free_voice_minutes = COALESCE\(\$1::int, platform_settings\.global_free_voice_minutes\)/,
    );
    assert.match(
      onlyDays.calls[0].text,
      /manager_max_free_days = COALESCE\(\$2::int, platform_settings\.manager_max_free_days\)/,
    );

    const onlyMinutes = upsertPool({ global_free_voice_minutes: 20, manager_max_free_days: '30' });
    assert.deepEqual(await settingsOf(onlyMinutes).updateSettings({ globalFreeVoiceMinutes: 20 }), {
      globalFreeVoiceMinutes: 20,
      managerMaxFreeDays: 30,
    });
    assert.deepEqual(onlyMinutes.calls[0].params, [20, null, 10, 30]);

    const both = upsertPool({ global_free_voice_minutes: 5, manager_max_free_days: 7 });
    await settingsOf(both).updateSettings({ globalFreeVoiceMinutes: 5, managerMaxFreeDays: 7 });
    assert.deepEqual(both.calls[0].params, [5, 7, 10, 30]);
  });
});

test('updateSettings: значения нормализуются поверх DTO (дни ≥ 1, целые; минуты ≥ 0, целые); дефолт минут берётся из env', async () => {
  await withVoiceEnv(undefined, async () => {
    const paramsOf = async (patch) => {
      const pool = fakePool([[SETTINGS_UPSERT, [{ global_free_voice_minutes: 1, manager_max_free_days: 1 }]]]);
      await settingsOf(pool).updateSettings(patch);
      return pool.calls[0].params;
    };
    assert.deepEqual(await paramsOf({ managerMaxFreeDays: -5 }), [null, 1, 10, 30]);
    assert.deepEqual(await paramsOf({ managerMaxFreeDays: 45.9 }), [null, 45, 10, 30]);
    assert.deepEqual(await paramsOf({ globalFreeVoiceMinutes: -3 }), [0, null, 10, 30]);
    assert.deepEqual(await paramsOf({ globalFreeVoiceMinutes: 7.8 }), [7, null, 10, 30]);
  });
  await withVoiceEnv('15', async () => {
    const pool = fakePool([[SETTINGS_UPSERT, [{ global_free_voice_minutes: 15, manager_max_free_days: 30 }]]]);
    await settingsOf(pool).updateSettings({ managerMaxFreeDays: 30 });
    assert.deepEqual(
      pool.calls[0].params,
      [null, 30, 15, 30],
      'env GLOBAL_FREE_VOICE_MINUTES — начальное значение сида',
    );
  });
  await withVoiceEnv('мусор', async () => {
    const pool = fakePool([[SETTINGS_UPSERT, [{ global_free_voice_minutes: 10, manager_max_free_days: 30 }]]]);
    await settingsOf(pool).updateSettings({ managerMaxFreeDays: 30 });
    assert.deepEqual(pool.calls[0].params, [null, 30, 10, 30], 'кривой env — продуктовый дефолт 10');
  });
});

test('UpdatePlatformSettingsDto: managerMaxFreeDays — целое 1..365, необязательное (но не null), whitelist его не вырезает', async () => {
  const kept = await validateBody(UpdatePlatformSettingsDto, {
    managerMaxFreeDays: 45,
    globalFreeVoiceMinutes: 10,
    foreign: 1,
  });
  assert.deepEqual({ ...kept }, { managerMaxFreeDays: 45, globalFreeVoiceMinutes: 10 });
  assert.deepEqual(
    { ...(await validateBody(UpdatePlatformSettingsDto, {})) },
    {},
    'PATCH-семантика: всё необязательно',
  );
  for (const days of [1, 30, 365])
    assert.equal(
      (await validateBody(UpdatePlatformSettingsDto, { managerMaxFreeDays: days })).managerMaxFreeDays,
      days,
    );
  // null — не «поле не передано»: раньше проходил IsOptional и сервис молча сбрасывал лимит к 30.
  for (const bad of [0, -1, 366, 1.5, '30', 'abc', null]) {
    await expectHttp(() => validateBody(UpdatePlatformSettingsDto, { managerMaxFreeDays: bad }), 400);
  }
});

test('AdminSettingsController: GET/PATCH /admin/settings — только superadmin; менеджер не поднимет себе потолок бесплатных дней', () => {
  const routes = routesOf(AdminSettingsController);
  assert.deepEqual(routes.map((route) => `${route.verb} ${route.path}`).sort(), [
    'GET /admin/settings',
    'PATCH /admin/settings',
  ]);
  const guard = new RolesGuard(new Reflector());
  for (const route of routes) {
    assert.deepEqual(route.roles, ['superadmin'], `${route.verb} ${route.path}`);
    const allowed = (user) => guard.canActivate(guardContext(AdminSettingsController, route.name, user));
    assert.equal(allowed(superadminUser()), true, `${route.verb}: суперадмин`);
    assert.equal(allowed(managerUser()), false, `${route.verb}: менеджер`);
    assert.equal(allowed(directorUser()), false, `${route.verb}: директор`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// П. UsersService: менеджера платформы через «Сотрудники» не заведёт и не назначит никто
// ───────────────────────────────────────────────────────────────────────────

const MANAGER_ROLE_REFUSAL = 'Менеджера платформы создаёт только суперадмин в разделе «Менеджеры»';
const USER_BODY = { phone: '+79990001122', password: 'password-123', fullName: 'Сотрудник Тестов' };
const usersOf = (pool = fakePool()) => new UsersService(pool, { sendDataToTenant: async () => undefined });

test('UsersService.create: роль manager не назначает никто (ни суперадмин, ни директор), в любом тенанте; отказ ДО любого запроса к БД', async () => {
  for (const actorRole of ['superadmin', 'director', 'admin', 'master']) {
    for (const tenantId of [TENANT_ID, NO_TENANT_ID]) {
      const pool = fakePool();
      await expectHttp(
        () => usersOf(pool).create(tenantId, actorRole, { ...USER_BODY, role: 'manager' }),
        400,
        MANAGER_ROLE_REFUSAL,
      );
      assert.equal(pool.calls.length, 0, `${actorRole}/${tenantId}: БД не трогается`);
    }
  }
});

test('UsersService.create: остальная матрица ролей не изменилась — неизвестная роль 400, superadmin только суперадмином, director только директором', async () => {
  await expectHttp(
    () => usersOf().create(TENANT_ID, 'director', { ...USER_BODY, role: 'owner' }),
    400,
    'Недопустимая роль: owner',
  );
  await expectHttp(
    () => usersOf().create(TENANT_ID, 'director', { ...USER_BODY, role: 'MANAGER' }),
    400,
    'Недопустимая роль: MANAGER',
  );
  await expectHttp(
    () => usersOf().create(TENANT_ID, 'director', { ...USER_BODY, role: 'superadmin' }),
    403,
    'Только суперадмин может назначить эту роль',
  );
  await expectHttp(
    () => usersOf().create(TENANT_ID, 'admin', { ...USER_BODY, role: 'director' }),
    403,
    'Только директор может назначить роль «Директор»',
  );
});

test('UsersService.update: сменить роль на manager нельзя никому, включая суперадмина — отказ сразу после проверки цели, без UPDATE', async () => {
  const target = { role: 'master', salary_percent: '0', product_salary_percent: '0', permissions: {} };
  for (const actorRole of ['superadmin', 'director', 'admin']) {
    const pool = fakePool([[/FROM users WHERE id=\$1 AND tenant_id=\$2$/, [target]]]);
    await expectHttp(
      () => usersOf(pool).update(DIRECTOR_ID, TENANT_ID, actorRole, SUPERADMIN_ID, { role: 'manager' }),
      400,
      MANAGER_ROLE_REFUSAL,
    );
    assert.equal(pool.calls.length, 1, `${actorRole}: только чтение цели`);
    assert.deepEqual(pool.calls[0].params, [DIRECTOR_ID, TENANT_ID]);
  }
});

test('UsersService.update: менеджер (tenant_id NULL) через «Сотрудников» не находится — цель ищется по (id, tenant_id)', async () => {
  const pool = fakePool();
  await expectHttp(
    () => usersOf(pool).update(MANAGER_ID, TENANT_ID, 'director', DIRECTOR_ID, { fullName: 'Переименован' }),
    404,
    'Пользователь не найден',
  );
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].text, /FROM users WHERE id=\$1 AND tenant_id=\$2$/);
  assert.deepEqual(pool.calls[0].params, [MANAGER_ID, TENANT_ID]);
});

test('UsersService: список ролей, доступных для назначения, по-прежнему без manager', () => {
  const source = read('src/users/users.service.ts');
  const match = /const ALLOWED_ROLES = new Set\(\[([^\]]*)\]\)/.exec(source);
  assert.ok(match, 'ALLOWED_ROLES не найден');
  assert.deepEqual(
    match[1].split(',').map((role) => role.trim().replace(/'/g, '')),
    ['master', 'admin', 'director', 'superadmin'],
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Р. AuthService и JwtStrategy: вход, /auth/me, филиалы, продление и выход менеджера, регистрация
// ───────────────────────────────────────────────────────────────────────────

const POINT_ID = '88888888-8888-4888-8888-888888888888';
const MASTER_ID = '99999999-9999-4999-8999-999999999999';
const DIRECTOR_ROLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AUTH_PASSWORD = 'Manager-pass-7';
const AUTH_HASH = bcrypt.hashSync(AUTH_PASSWORD, 4);
const LOGIN_PHONE = '8 (999) 111-22-33';
const SESSION_IAT = 1_780_000_000;
const SESSION_EXP = 1_790_000_000;

// Общий кусок колонок пользователя содержит комментарии `--`, поэтому маршруты пула привязаны к ХВОСТУ запроса.
const AUTH_LOGIN_SQL = /WHERE u\.phone = \$1 OR u\.phone = \$2 LIMIT 1$/;
const AUTH_BY_ID_SQL = /WHERE u\.id = \$1$/;
const AUTH_REFRESH_SQL = /FROM users u WHERE u\.id=\$1$/;
const AUTH_CLAIM_SQL = /^INSERT INTO revoked_tokens/;
const AUTH_CLAIMED = { rows: [], rowCount: 1 };
const NO_POINTS_ROUTE = [/FROM tenant_points WHERE tenant_id=\$1 AND is_active/, [{ has_points: false }]];
const CANONICAL_KEYS = [...new Set(CANONICAL_PERMISSION_KEYS)].sort();

const authRow = (overrides = {}) => ({
  id: MANAGER_ID,
  phone: '+79991112233',
  password: AUTH_HASH,
  full_name: 'Пётр Менеджеров',
  avatar: null,
  role: 'manager',
  role_id: null,
  role_name: null,
  role_matrix: null,
  salary_percent: '0',
  owner_share_percent: '40.00',
  is_active: true,
  dismissed_at: null,
  purged_at: null,
  tenant_id: null,
  current_point_id: null,
  created_at: NOW_ISO,
  tenant_json: null,
  session_stale: false,
  ...overrides,
});
// Доля владельца лежит в колонке и у директора/суперадмина «на всякий случай» — в ответ она попадать не должна.
const directorAuthRow = (overrides = {}) =>
  authRow({
    id: DIRECTOR_ID,
    phone: '+79992223344',
    role: 'director',
    tenant_id: TENANT_ID,
    owner_share_percent: '60.00',
    ...overrides,
  });
const superadminAuthRow = (overrides = {}) =>
  authRow({ id: SUPERADMIN_ID, phone: '+79990000001', role: 'superadmin', owner_share_percent: '60.00', ...overrides });

const authPool = (row, extra = []) =>
  fakePool([[AUTH_LOGIN_SQL, row ? [row] : []], [AUTH_BY_ID_SQL, row ? [row] : []], ...extra]);
const authOf = (pool, jwt = fakeJwt()) => new AuthService(pool, jwt);
const selectTokenOf = (userId, extra = {}) =>
  fakeJwt().sign(
    { sub: userId, tenantId: null, jti: 'jti-select', purpose: POINT_SELECT_PURPOSE, ...extra },
    { expiresIn: 300 },
  );
const sessionActor = (userId, overrides = {}) => ({
  userID: userId,
  tenantID: NO_TENANT_ID,
  currentPointId: null,
  jti: 'jti-a',
  ...overrides,
});
const rawSessionToken = (extra = {}) => JSON.stringify({ jti: 'jti-a', iat: SESSION_IAT, exp: SESSION_EXP, ...extra });
const refreshPool = (row, claim = AUTH_CLAIMED) =>
  fakePool([
    [AUTH_REFRESH_SQL, row ? [row] : []],
    [AUTH_CLAIM_SQL, claim],
  ]);
const liveRow = (overrides = {}) => ({
  is_active: true,
  dismissed_at: null,
  purged_at: null,
  session_stale: false,
  ...overrides,
});
const noGrantedPermissions = (permissions) => Object.entries(permissions).filter(([, granted]) => granted);

test('вход менеджера: один запрос к БД, токен без тенанта и без филиала, в ответе роль и доля владельца, пароля нет', async () => {
  const jwt = fakeJwt();
  const pool = authPool(authRow());
  const result = await authOf(pool, jwt).login({ phone: LOGIN_PHONE, password: AUTH_PASSWORD });

  assert.equal(pool.calls.length, 1, 'ни филиалов, ни tenant_points, ни запоминания филиала — менеджеру они не нужны');
  assert.deepEqual(pool.calls[0].params, [normalizePhone(LOGIN_PHONE), LOGIN_PHONE]);
  assert.match(pool.calls[0].text, /u\.owner_share_percent/, 'долю владельца запрос обязан отдать');

  assert.equal(jwt.signCalls.length, 1, 'ровно один токен, и это токен сессии, а не «выбор филиала»');
  const { payload } = jwt.signCalls[0];
  assert.equal(payload.sub, MANAGER_ID);
  assert.equal(payload.tenantId ?? null, null, 'менеджер живёт без тенанта — в токен тенант не попадает');
  assert.equal(payload.pointId, null);
  assert.equal(typeof payload.jti, 'string');
  assert.equal('purpose' in payload, false);
  assert.equal(JSON.parse(result.token).sub, MANAGER_ID);

  const { user } = result;
  assert.equal(user.id, MANAGER_ID);
  assert.equal(user.role, 'manager');
  assert.equal(user.tenantId, null);
  assert.equal(user.currentPointId, null);
  assert.equal(user.ownerSharePercent, 40);
  assert.equal('tenant' in user, false);
  assert.equal('password' in user, false);
  assert.equal(JSON.stringify(result).includes(AUTH_HASH), false, 'хэш пароля в ответ не уходит');
  assert.deepEqual(Object.keys(user.permissions).sort(), CANONICAL_KEYS);
  assert.deepEqual(noGrantedPermissions(user.permissions), [], 'менеджеру платформы не выдано ни одно тенантное право');
});

test('/auth/me менеджера: доля владельца из БД (NULL и мусор — 60 по умолчанию), запрос один и по id из токена', async () => {
  const cases = [
    [null, DEFAULT_OWNER_SHARE_PERCENT],
    [undefined, DEFAULT_OWNER_SHARE_PERCENT],
    ['0', 0],
    ['0.00', 0],
    ['100', 100],
    ['37.50', 37.5],
    ['abc', DEFAULT_OWNER_SHARE_PERCENT],
  ];
  for (const [stored, expected] of cases) {
    const pool = authPool(authRow({ owner_share_percent: stored }));
    const me = await authOf(pool).me({ userID: MANAGER_ID, currentPointId: null });
    assert.equal(me.ownerSharePercent, expected, `owner_share_percent = ${String(stored)}`);
    assert.equal(me.role, 'manager');
    assert.equal(pool.calls.length, 1);
    assert.deepEqual(pool.calls[0].params, [MANAGER_ID]);
  }
  await expectHttp(() => authOf(authPool(null)).me({ userID: MANAGER_ID }), 401, 'Пользователь не найден');
});

test('вход менеджера: деактивирован, уволен, удалён, чужой пароль, неизвестный телефон — 401, один запрос, токен не выпускается', async () => {
  const cases = [
    ['деактивирован', authRow({ is_active: false }), AUTH_PASSWORD, 'Аккаунт деактивирован'],
    ['уволен', authRow({ dismissed_at: NOW_ISO }), AUTH_PASSWORD, 'Аккаунт уволен'],
    ['удалён', authRow({ purged_at: NOW_ISO }), AUTH_PASSWORD, 'Аккаунт уволен'],
    ['чужой пароль', authRow(), 'Wrong-pass-1', 'Неверный телефон или пароль'],
    ['телефона нет', null, AUTH_PASSWORD, 'Неверный телефон или пароль'],
  ];
  for (const [label, row, password, message] of cases) {
    const jwt = fakeJwt();
    const pool = authPool(row);
    await expectHttp(() => authOf(pool, jwt).login({ phone: LOGIN_PHONE, password }), 401, message);
    assert.equal(pool.calls.length, 1, label);
    assert.equal(jwt.signCalls.length, 0, `${label}: токен не выпускается`);
  }
  for (const body of [{ phone: LOGIN_PHONE }, { password: AUTH_PASSWORD }, {}]) {
    const pool = authPool(authRow());
    await expectHttp(() => authOf(pool).login(body), 400, 'Телефон и пароль обязательны');
    assert.equal(pool.calls.length, 0);
  }
});

test('вход суперадмина и директора не изменился: доли владельца в ответе нет, права «всё выдано», токен как прежде', async () => {
  const saJwt = fakeJwt();
  const saPool = authPool(superadminAuthRow());
  const sa = await authOf(saPool, saJwt).login({ phone: LOGIN_PHONE, password: AUTH_PASSWORD });
  assert.equal(saPool.calls.length, 1);
  assert.equal(sa.user.role, 'superadmin');
  assert.equal(sa.user.tenantId, null);
  assert.equal('ownerSharePercent' in sa.user, false, 'доля владельца едет только с менеджером');
  assert.equal(Object.values(sa.user.permissions).every(Boolean), true);
  assert.equal(saJwt.signCalls[0].payload.tenantId ?? null, null);

  const tenantJson = JSON.stringify({ id: TENANT_ID, name: 'Автосервис «Восток»' });
  const dirJwt = fakeJwt();
  const dirPool = authPool(directorAuthRow({ tenant_json: tenantJson }), [NO_POINTS_ROUTE]);
  const director = await authOf(dirPool, dirJwt).login({ phone: LOGIN_PHONE, password: AUTH_PASSWORD });
  assert.equal(director.user.role, 'director');
  assert.equal(director.user.tenantId, TENANT_ID);
  assert.equal('ownerSharePercent' in director.user, false, 'даже если колонка заполнена — директору доля не уходит');
  assert.equal(director.user.tenant.id, TENANT_ID);
  assert.equal(Object.values(director.user.permissions).every(Boolean), true);
  assert.equal(dirJwt.signCalls[0].payload.tenantId, TENANT_ID);
  assert.equal(dirJwt.signCalls[0].payload.pointId, null);
});

test('выбор филиала: менеджеру и суперадмину — 403 «У этой роли нет филиалов» после одного чтения пользователя', async () => {
  for (const row of [authRow(), superadminAuthRow()]) {
    const jwt = fakeJwt();
    const pool = authPool(row);
    await expectHttp(
      () => authOf(pool, jwt).selectPoint({ selectToken: selectTokenOf(row.id), pointId: POINT_ID }),
      403,
      'У этой роли нет филиалов',
    );
    assert.equal(pool.calls.length, 1, `${row.role}: только чтение пользователя`);
    assert.match(pool.calls[0].text, AUTH_BY_ID_SQL);
    assert.deepEqual(pool.calls[0].params, [row.id]);
    assert.equal(jwt.signCalls.length, 0, `${row.role}: токен не выпускается`);
  }
});

test('выбор филиала: деактивированный менеджер отбивается общим 401 раньше; токен сессии не годится как «выбор филиала»', async () => {
  const inactive = authPool(authRow({ is_active: false }));
  await expectHttp(
    () => authOf(inactive).selectPoint({ selectToken: selectTokenOf(MANAGER_ID), pointId: POINT_ID }),
    401,
    'Аккаунт деактивирован',
  );

  const sessionToken = JSON.stringify({ sub: MANAGER_ID, tenantId: null, jti: 'jti-x' });
  const pool = authPool(authRow());
  await expectHttp(
    () => authOf(pool).selectPoint({ selectToken: sessionToken, pointId: POINT_ID }),
    401,
    'Неверный токен',
  );
  assert.equal(pool.calls.length, 0, 'обычным токеном сессии «выбор филиала» не пройти — БД не трогается');
});

test('выбор филиала директором работает как прежде: токен с филиалом, без доли владельца', async () => {
  const jwt = fakeJwt();
  const pool = authPool(directorAuthRow(), [
    [/FROM autexa_available_points/, [{ id: POINT_ID, name: 'Основной', address: null, is_main: true }]],
    [AUTH_CLAIM_SQL, AUTH_CLAIMED],
  ]);
  const result = await authOf(pool, jwt).selectPoint({
    selectToken: selectTokenOf(DIRECTOR_ID, { tenantId: TENANT_ID }),
    pointId: POINT_ID,
  });
  const { payload } = jwt.signCalls[0];
  assert.deepEqual([payload.sub, payload.tenantId, payload.pointId], [DIRECTOR_ID, TENANT_ID, POINT_ID]);
  assert.equal(result.user.currentPointId, POINT_ID);
  assert.equal('ownerSharePercent' in result.user, false);
});

test('смена филиала: менеджеру и суперадмину — 403 «У этой роли нет филиалов», в том числе «в тот же филиал»; устаревшая сессия — 401 раньше', async () => {
  for (const row of [authRow(), superadminAuthRow()]) {
    for (const currentPointId of [null, POINT_ID]) {
      const jwt = fakeJwt();
      const pool = authPool(row);
      await expectHttp(
        () =>
          authOf(pool, jwt).switchPoint(sessionActor(row.id, { currentPointId }), rawSessionToken(), {
            pointId: POINT_ID,
          }),
        403,
        'У этой роли нет филиалов',
      );
      assert.equal(pool.calls.length, 1, `${row.role}/${currentPointId}: только чтение профиля`);
      assert.deepEqual(pool.calls[0].params, [row.id, SESSION_IAT]);
      assert.equal(jwt.signCalls.length, 0, `${row.role}/${currentPointId}: токен не выпускается`);
    }
  }
  const stale = authPool(authRow({ session_stale: true }));
  await expectHttp(
    () => authOf(stale).switchPoint(sessionActor(MANAGER_ID), rawSessionToken(), { pointId: POINT_ID }),
    401,
    SESSION_STALE_MESSAGE,
  );
});

test('смена филиала директором работает как прежде: новый токен с тенантом и филиалом, без доли владельца', async () => {
  const jwt = fakeJwt();
  const pool = authPool(directorAuthRow(), [
    [/autexa_can_manage_staff/, [{ can_manage: true, point_allowed: true }]],
    [AUTH_CLAIM_SQL, AUTH_CLAIMED],
  ]);
  const result = await authOf(pool, jwt).switchPoint(
    sessionActor(DIRECTOR_ID, { tenantID: TENANT_ID }),
    rawSessionToken(),
    { pointId: POINT_ID },
  );
  assert.equal(result.switched, true);
  assert.equal(result.currentPointId, POINT_ID);
  const { payload } = jwt.signCalls[0];
  assert.deepEqual([payload.sub, payload.tenantId, payload.pointId], [DIRECTOR_ID, TENANT_ID, POINT_ID]);
  assert.equal('ownerSharePercent' in result.user, false);
});

test('продление сессии менеджера: claim старого jti, новый токен без тенанта и без филиала, ровно два запроса', async () => {
  const jwt = fakeJwt();
  const pool = refreshPool(liveRow());
  const result = await authOf(pool, jwt).refresh(sessionActor(MANAGER_ID), rawSessionToken());

  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0].text, AUTH_REFRESH_SQL);
  assert.deepEqual(pool.calls[0].params, [MANAGER_ID, SESSION_IAT]);
  const claim = pool.calls[1];
  assert.match(claim.text, AUTH_CLAIM_SQL);
  assert.match(claim.text, /ON CONFLICT \(jti\) DO NOTHING$/);
  assert.deepEqual(claim.params, ['jti-a', MANAGER_ID, null, 120000, new Date(SESSION_EXP * 1000)]);

  assert.equal(jwt.signCalls.length, 1);
  const { payload } = jwt.signCalls[0];
  assert.equal(payload.sub, MANAGER_ID);
  assert.equal(payload.tenantId, undefined, 'нулевой тенант в новый токен не зашивается');
  assert.equal(payload.pointId, null);
  assert.notEqual(payload.jti, 'jti-a');
  assert.equal(JSON.parse(result.token).sub, MANAGER_ID);
});

test('продление сессии: отказы (недоступен, устарела, токен уже обменян, вход «под пользователем», чужой jti) — без нового токена', async () => {
  const dead = [
    ['деактивирован', liveRow({ is_active: false })],
    ['уволен', liveRow({ dismissed_at: NOW_ISO })],
    ['удалён', liveRow({ purged_at: NOW_ISO })],
    ['строки нет', null],
  ];
  for (const [label, row] of dead) {
    const jwt = fakeJwt();
    const pool = refreshPool(row);
    await expectHttp(
      () => authOf(pool, jwt).refresh(sessionActor(MANAGER_ID), rawSessionToken()),
      401,
      'Аккаунт недоступен',
    );
    assert.equal(pool.calls.length, 1, label);
    assert.equal(jwt.signCalls.length, 0, label);
  }

  const staleJwt = fakeJwt();
  const stalePool = refreshPool(liveRow({ session_stale: true }));
  await expectHttp(
    () => authOf(stalePool, staleJwt).refresh(sessionActor(MANAGER_ID), rawSessionToken()),
    401,
    SESSION_STALE_MESSAGE,
  );
  assert.equal(stalePool.calls.length, 1, 'после смены пароля claim не пишется');
  assert.equal(staleJwt.signCalls.length, 0);

  const lostJwt = fakeJwt();
  const lostPool = refreshPool(liveRow(), { rows: [], rowCount: 0 });
  await expectHttp(
    () => authOf(lostPool, lostJwt).refresh(sessionActor(MANAGER_ID), rawSessionToken()),
    401,
    'Токен отозван',
  );
  assert.equal(lostPool.calls.length, 2);
  assert.equal(lostJwt.signCalls.length, 0);

  const refusals = [
    [
      sessionActor(MANAGER_ID),
      rawSessionToken({ impersonatedBy: SUPERADMIN_ID }),
      403,
      'Сессия входа под пользователем не продлевается',
    ],
    [sessionActor(MANAGER_ID, { jti: undefined }), rawSessionToken(), 401, 'Сессия устарела — войдите заново'],
    [sessionActor(MANAGER_ID), rawSessionToken({ jti: 'jti-other' }), 401, 'Неверный токен'],
    [sessionActor(MANAGER_ID), '', 401, 'Неверный токен'],
  ];
  for (const [actor, rawToken, status, message] of refusals) {
    const pool = refreshPool(liveRow());
    await expectHttp(() => authOf(pool).refresh(actor, rawToken), status, message);
    assert.equal(pool.calls.length, 0, message);
  }
});

test('продление сессии директора работает как прежде: тенант и филиал переезжают в новый токен', async () => {
  const jwt = fakeJwt();
  const pool = refreshPool(liveRow());
  await authOf(pool, jwt).refresh(
    sessionActor(DIRECTOR_ID, { tenantID: TENANT_ID, currentPointId: POINT_ID }),
    rawSessionToken(),
  );
  assert.equal(pool.calls[1].params[2], TENANT_ID);
  const { payload } = jwt.signCalls[0];
  assert.deepEqual([payload.sub, payload.tenantId, payload.pointId], [DIRECTOR_ID, TENANT_ID, POINT_ID]);
});

test('выход менеджера: в blacklist пишется NULL вместо нулевого тенанта, кэш авторизации токена сброшен', async () => {
  for (const [tenantId, stored] of [
    [NO_TENANT_ID, null],
    ['', null],
    [TENANT_ID, TENANT_ID],
  ]) {
    const pool = fakePool([[AUTH_CLAIM_SQL, AUTH_CLAIMED]]);
    seedAuthCache(MANAGER_ID, 'jti-out');
    try {
      await authOf(pool).logout('jti-out', MANAGER_ID, tenantId);
      assert.equal(pool.calls.length, 1, String(tenantId));
      const [call] = pool.calls;
      assert.match(call.text, AUTH_CLAIM_SQL);
      assert.match(call.text, /ON CONFLICT \(jti\) DO UPDATE SET/);
      assert.deepEqual(call.params.slice(0, 4), ['jti-out', MANAGER_ID, stored, 0]);
      assert.ok(call.params[4] instanceof Date && call.params[4].getTime() > Date.now(), 'expires_at — в будущем');
      assert.equal(isAuthCached(MANAGER_ID, 'jti-out'), false, 'следующий запрос с этим токеном пойдёт в БД');
    } finally {
      ttlCache.invalidate(authCacheKey(MANAGER_ID, 'jti-out'));
    }
  }
});

test('регистрация: роль и доля владельца из тела вырезаются, создаётся директор нового тенанта; менеджером не зарегистрироваться', async () => {
  const dto = await validateBody(RegisterDto, {
    phone: '+7 (999) 222-33-44',
    password: 'Strong-pass-1',
    fullName: 'Иван Директоров',
    role: 'manager',
    ownerSharePercent: 100,
    tenantId: TENANT_ID,
  });
  assert.deepEqual(
    Object.keys(dto)
      .filter((key) => dto[key] !== undefined)
      .sort(),
    ['fullName', 'password', 'phone'],
    'global whitelist: role / ownerSharePercent / tenantId не доезжают до сервиса',
  );

  const phone = normalizePhone(dto.phone);
  const registerRoutes = (phoneTaken) => [
    [/SELECT EXISTS\(SELECT 1 FROM users WHERE phone=\$1\)/, [{ exists: phoneTaken }]],
    [/^INSERT INTO tenants/, [{ id: TENANT_ID }]],
    [/FROM roles WHERE system_key = 'director'/, [{ id: DIRECTOR_ROLE_ID }]],
    [
      /^INSERT INTO users/,
      [
        {
          id: DIRECTOR_ID,
          phone,
          full_name: dto.fullName,
          role: 'director',
          role_id: DIRECTOR_ROLE_ID,
          salary_percent: '0',
          is_active: true,
          tenant_id: TENANT_ID,
          created_at: NOW_ISO,
        },
      ],
    ],
  ];

  const jwt = fakeJwt();
  const pool = fakePool(registerRoutes(false));
  const result = await authOf(pool, jwt).register(dto);
  const insert = pool.calls.find((call) => /^INSERT INTO users/.test(call.text));
  assert.ok(insert, 'пользователь создан');
  assert.match(insert.text, /VALUES \(\$1, \$2, \$3, 'director', true, \$4, '\{\}'::jsonb, \$5\)/);
  assert.equal(insert.params.length, 5);
  assert.deepEqual(
    [insert.params[0], insert.params[2], insert.params[3], insert.params[4]],
    [phone, dto.fullName, TENANT_ID, DIRECTOR_ROLE_ID],
  );
  assert.equal(bcrypt.compareSync(dto.password, insert.params[1]), true, 'пароль хэшируется');
  assert.equal(insert.params.includes('manager'), false);

  assert.equal(result.user.role, 'director');
  assert.equal('ownerSharePercent' in result.user, false);
  const { payload } = jwt.signCalls[0];
  assert.deepEqual([payload.sub, payload.tenantId, payload.pointId], [DIRECTOR_ID, TENANT_ID, null]);
  assert.deepEqual([pool.connects, pool.released], [1, 1]);
  assert.ok(
    pool.calls.some((call) => call.text === 'COMMIT'),
    'транзакция зафиксирована',
  );

  const takenPool = fakePool(registerRoutes(true));
  await expectHttp(() => authOf(takenPool).register(dto), 400, 'Пользователь с таким телефоном уже существует');
  assert.equal(takenPool.connects, 0, 'номер менеджера (или любой занятый) самозарегистрировать нельзя');
});

test('JwtStrategy: менеджер без тенанта проходит как безтенантная роль — нулевой тенант, без филиала, без тенантных прав', async () => {
  const userRow = (overrides = {}) => ({
    is_active: true,
    tenant_id: null,
    role: 'manager',
    dismissed_at: null,
    purged_at: null,
    role_matrix: null,
    session_stale: false,
    tenant_has_points: false,
    point_allowed: null,
    default_point_id: null,
    ...overrides,
  });
  const strategyFor = (row) =>
    new JwtStrategy(
      fakePool([
        [/FROM revoked_tokens/, []],
        [/FROM users u LEFT JOIN roles r/, [row]],
      ]),
    );
  const jtis = ['jti-jwt-mgr', 'jti-jwt-mgr-off', 'jti-jwt-mgr-gone'];
  try {
    const user = await strategyFor(userRow()).validate({ sub: MANAGER_ID, jti: jtis[0], iat: SESSION_IAT });
    assert.equal(user.userID, MANAGER_ID);
    assert.equal(user.role, 'manager');
    assert.equal(user.tenantID, NO_TENANT_ID, 'тенанта нет — подставляется нулевой UUID, как у суперадмина');
    assert.equal(user.currentPointId, null);
    assert.equal(user.jti, jtis[0]);
    for (const key of CANONICAL_KEYS) {
      assert.equal(userHasPermission(user, key), false, `менеджеру платформы право ${key} не выдаётся`);
    }

    await expectHttp(
      () => strategyFor(userRow({ is_active: false })).validate({ sub: MANAGER_ID, jti: jtis[1], iat: SESSION_IAT }),
      401,
      'Аккаунт деактивирован',
    );
    await expectHttp(
      () =>
        strategyFor(userRow({ dismissed_at: NOW_ISO })).validate({ sub: MANAGER_ID, jti: jtis[2], iat: SESSION_IAT }),
      401,
      'Аккаунт уволен',
    );
  } finally {
    for (const jti of jtis) ttlCache.invalidate(authCacheKey(MANAGER_ID, jti));
  }
});

// ───────────────────────────────────────────────────────────────────────────
// С. AccountService: «удалить аккаунт» не должен анонимизировать менеджера платформы
// ───────────────────────────────────────────────────────────────────────────

const ACCOUNT_SELECT = /FROM users WHERE id = \$1 LIMIT 1$/;
const accountRow = (overrides = {}) => ({
  id: MANAGER_ID,
  password: AUTH_HASH,
  role: 'manager',
  tenant_id: '',
  ...overrides,
});
const accountPool = (row) => fakePool([[ACCOUNT_SELECT, row ? [row] : []]]);
const accountOf = (pool) => new AccountService(pool, {}, {});
const deleteBody = (overrides = {}) => ({ password: AUTH_PASSWORD, confirm: true, ...overrides });

test('удаление аккаунта: без явного confirm === true — 400 и ни одного запроса к БД (менеджеру так же, как всем)', async () => {
  for (const confirm of [undefined, false, null, 'true', 1]) {
    const pool = accountPool(accountRow());
    await expectHttp(
      () => accountOf(pool).deleteAccount(managerUser(), deleteBody({ confirm })),
      400,
      'Удаление аккаунта требует подтверждения',
    );
    assert.equal(pool.calls.length, 0, `confirm = ${String(confirm)}`);
  }
});

test('удаление аккаунта: чужой пароль — 401 раньше любых ролевых отказов; нет строки пользователя — 401', async () => {
  for (const role of ['manager', 'superadmin', 'director', 'master']) {
    const pool = accountPool(accountRow({ role }));
    await expectHttp(
      () => accountOf(pool).deleteAccount(managerUser(), deleteBody({ password: 'Wrong-pass-1' })),
      401,
      'Неверный пароль',
    );
    assert.equal(pool.calls.length, 1, role);
    assert.equal(pool.connects, 0, role);
  }
  await expectHttp(
    () => accountOf(accountPool(null)).deleteAccount(managerUser(), deleteBody()),
    401,
    'Пользователь не найден',
  );
});

test('удаление аккаунта менеджером платформы — 403: строка не анонимизируется, транзакция не открывается, кэш авторизации цел', async () => {
  const pool = accountPool(accountRow());
  seedAuthCache(MANAGER_ID, 'jti-acc');
  try {
    await expectHttp(
      () => accountOf(pool).deleteAccount(managerUser(), deleteBody()),
      403,
      'Аккаунт менеджера платформы удаляет только владелец',
    );
    assert.equal(pool.calls.length, 1, 'только чтение своей строки');
    assert.equal(pool.connects, 0, 'транзакция удаления не открывалась');
    assert.equal(isAuthCached(MANAGER_ID, 'jti-acc'), true, 'сессия менеджера не сброшена');
  } finally {
    ttlCache.invalidate(authCacheKey(MANAGER_ID, 'jti-acc'));
  }

  const saPool = accountPool(accountRow({ id: SUPERADMIN_ID, role: 'superadmin' }));
  await expectHttp(
    () => accountOf(saPool).deleteAccount(superadminUser(), deleteBody()),
    403,
    'Аккаунт владельца платформы нельзя удалить из приложения',
  );
  assert.equal(saPool.connects, 0);
});

test('удаление аккаунта мастером работает как прежде: анонимизация в транзакции, push-токены удалены, кэш авторизации сброшен', async () => {
  const pool = accountPool(accountRow({ id: MASTER_ID, role: 'master', tenant_id: TENANT_ID }));
  seedAuthCache(MASTER_ID, 'jti-acc');
  try {
    const result = await accountOf(pool).deleteAccount(
      { userID: MASTER_ID, role: 'master', tenantID: TENANT_ID },
      deleteBody(),
    );
    assert.deepEqual(result, { status: 'account_deleted', message: 'Аккаунт удалён' });
    assert.deepEqual([pool.connects, pool.released], [1, 1]);
    assert.ok(pool.calls.some((call) => call.text.startsWith("UPDATE users SET full_name = 'Удалённый пользователь'")));
    assert.ok(
      pool.calls.some(
        (call) => call.text === 'DELETE FROM push_tokens WHERE user_id = $1' && call.params[0] === MASTER_ID,
      ),
    );
    assert.equal(isAuthCached(MASTER_ID, 'jti-acc'), false);
  } finally {
    ttlCache.invalidate(authCacheKey(MASTER_ID, 'jti-acc'));
  }
});

// ProfileService (миграция 173): у менеджера платформы нет тенанта, а значит и директора, который
// мог бы одобрить запрос на смену профиля (profile_change_requests.tenant_id NOT NULL). Раньше он
// падал в ветку «запрос» с tenant_id = '' и получал 400/500 — править свой профиль было нечем.

const PROFILE_SELF_SELECT = /COALESCE\(tenant_id::text, ''\) AS tenant_id FROM users WHERE id=\$1 LIMIT 1$/;
const PROFILE_USER_SELECT = /FROM users u LEFT JOIN tenants t ON t\.id = u\.tenant_id WHERE u\.id=\$1$/;
const PROFILE_REQUEST_SELECT =
  /FROM profile_change_requests r LEFT JOIN users u ON u\.id = r\.user_id WHERE r\.id=\$1 AND r\.tenant_id=\$2 LIMIT 1$/;

const profileSelfRow = (overrides = {}) => ({
  id: MANAGER_ID,
  role: 'manager',
  full_name: 'Менеджер Тестов',
  phone: '+79991112233',
  avatar: null,
  password: AUTH_HASH,
  tenant_id: '',
  ...overrides,
});
const profileUserRow = (overrides = {}) => ({
  id: MANAGER_ID,
  phone: '+79991112233',
  full_name: 'Менеджер Тестов',
  avatar: null,
  role: 'manager',
  salary_percent: '0',
  permissions: '{}',
  owner_share_percent: null,
  is_active: true,
  tenant_id: null,
  created_at: '2026-09-30T09:00:00.000Z',
  tenant_json: null,
  ...overrides,
});
function profilePool(self, userRow = profileUserRow({ id: self.id, role: self.role })) {
  return fakePool([
    [PROFILE_SELF_SELECT, [self]],
    [PROFILE_USER_SELECT, [userRow]],
    [/^INSERT INTO profile_change_requests/, [{ id: 'request-1' }]],
    [
      PROFILE_REQUEST_SELECT,
      [{ id: 'request-1', tenant_id: self.tenant_id, user_id: self.id, changes: '[]', status: 'pending' }],
    ],
  ]);
}
const profileOf = (pool) => new ProfileService(pool, { sendToUserInTenant: async () => undefined });
const userUpdate = (pool) => pool.calls.find((call) => call.text.startsWith('UPDATE users SET'));

test('ProfileService.updateProfile: менеджер платформы правит свой профиль СРАЗУ, запрос на одобрение не создаётся', async () => {
  const pool = profilePool(profileSelfRow());
  seedAuthCache(MANAGER_ID, 'jti-prof');
  try {
    const result = await profileOf(pool).updateProfile(managerUser(), {
      fullName: '  Новое Имя  ',
      phone: '+7 999 222-33-44',
    });
    assert.equal(result.status, 'applied');
    assert.equal(result.applied, true);
    const update = userUpdate(pool);
    assert.ok(update, 'строка users обновлена');
    assert.equal(update.text, 'UPDATE users SET full_name=$1, phone=$2, updated_at=now() WHERE id=$3');
    assert.deepEqual(
      update.params,
      ['Новое Имя', '+79992223344', MANAGER_ID],
      'только СВОЯ строка, значения нормализованы',
    );
    assert.ok(
      !pool.calls.some((call) => /profile_change_requests/.test(call.text)),
      'у менеджера нет тенанта: profile_change_requests не трогается вовсе',
    );
    assert.equal(isAuthCached(MANAGER_ID, 'jti-prof'), false, 'кэш авторизации сброшен: имя в токене-контексте свежее');
    // Ответ — той же формы, что /auth/me: менеджер видит свою долю, тенанта нет.
    assert.equal(result.user.role, 'manager');
    assert.equal(result.user.tenantId, null);
    assert.equal(result.user.ownerSharePercent, DEFAULT_OWNER_SHARE_PERCENT, 'NULL в колонке = 60 % по умолчанию');
  } finally {
    ttlCache.invalidate(authCacheKey(MANAGER_ID, 'jti-prof'));
  }
});

test('ProfileService.updateProfile: ответ менеджера несёт заданную долю владельца; у остальных ролей ключа нет', async () => {
  const custom = await profileOf(
    profilePool(profileSelfRow(), profileUserRow({ owner_share_percent: '40.00' })),
  ).updateProfile(managerUser(), {});
  assert.equal(custom.status, 'applied', 'ничего не изменилось — идемпотентный «применено»');
  assert.equal(custom.user.ownerSharePercent, 40);

  const broken = await profileOf(
    profilePool(profileSelfRow(), profileUserRow({ owner_share_percent: 'не число' })),
  ).updateProfile(managerUser(), {});
  assert.equal(broken.user.ownerSharePercent, DEFAULT_OWNER_SHARE_PERCENT, 'битое значение не даёт NaN клиенту');

  const director = await profileOf(
    profilePool(
      profileSelfRow({ id: DIRECTOR_ID, role: 'director', tenant_id: TENANT_ID }),
      profileUserRow({ id: DIRECTOR_ID, role: 'director', tenant_id: TENANT_ID }),
    ),
  ).updateProfile(directorUser(), {});
  assert.ok(!('ownerSharePercent' in director.user), 'payload директора байт-в-байт прежний');
});

test('ProfileService.updateProfile: остальные роли — как прежде (владелец применяет сразу, сотрудник — через запрос)', async () => {
  for (const role of ['director', 'superadmin']) {
    const pool = profilePool(
      profileSelfRow({ id: DIRECTOR_ID, role, tenant_id: role === 'director' ? TENANT_ID : '' }),
    );
    const result = await profileOf(pool).updateProfile(
      { userID: DIRECTOR_ID, role, tenantID: TENANT_ID },
      { fullName: 'Иван Иванов' },
    );
    assert.equal(result.status, 'applied', role);
    assert.ok(userUpdate(pool), `${role}: строка users обновлена`);
  }
  for (const role of ['admin', 'master']) {
    const pool = profilePool(profileSelfRow({ id: MASTER_ID, role, tenant_id: TENANT_ID }));
    const result = await profileOf(pool).updateProfile(
      { userID: MASTER_ID, role, tenantID: TENANT_ID },
      { fullName: 'Иван Иванов' },
    );
    assert.equal(result.status, 'requested', role);
    assert.equal(result.applied, false, role);
    assert.equal(userUpdate(pool), undefined, `${role}: строка users не тронута до одобрения`);
    assert.ok(
      pool.calls.some((call) => call.text.startsWith('INSERT INTO profile_change_requests')),
      `${role}: создан запрос`,
    );
  }
});

test('ProfileService.changePassword: менеджер меняет пароль сам — один UPDATE по своему id с границей сессий, чужие пароли не проверяются', async () => {
  const pool = profilePool(profileSelfRow());
  seedAuthCache(MANAGER_ID, 'jti-prof');
  try {
    const result = await profileOf(pool).changePassword(managerUser(), {
      currentPassword: AUTH_PASSWORD,
      newPassword: 'Another-pass-8',
    });
    assert.equal(result.message, 'Пароль изменён — войдите заново');
    const update = userUpdate(pool);
    assert.equal(update.text, 'UPDATE users SET password=$1, sessions_valid_from=now(), updated_at=now() WHERE id=$2');
    assert.equal(update.params[1], MANAGER_ID);
    assert.equal(await bcrypt.compare('Another-pass-8', update.params[0]), true, 'в БД лежит хэш нового пароля');
    assert.notEqual(update.params[0], 'Another-pass-8', 'пароль не хранится открытым текстом');
    assert.equal(isAuthCached(MANAGER_ID, 'jti-prof'), false, 'прежние сессии не живут ещё 30 с из кэша');
  } finally {
    ttlCache.invalidate(authCacheKey(MANAGER_ID, 'jti-prof'));
  }

  const bad = async (body, status, message) => {
    const guarded = profilePool(profileSelfRow());
    await expectHttp(() => profileOf(guarded).changePassword(managerUser(), body), status, message);
    assert.equal(userUpdate(guarded), undefined, 'при отказе пароль не пишется');
  };
  await bad({ currentPassword: 'Wrong-pass-1', newPassword: 'Another-pass-8' }, 401, 'Неверный текущий пароль');
  await bad({ currentPassword: AUTH_PASSWORD, newPassword: 'Short1A' }, 400, 'Пароль должен быть не менее 8 символов');
  await bad(
    { currentPassword: AUTH_PASSWORD, newPassword: 'alllowercase12' },
    400,
    'Пароль должен содержать заглавную букву и цифру',
  );
  await bad(
    { currentPassword: AUTH_PASSWORD, newPassword: AUTH_PASSWORD },
    400,
    'Новый пароль должен отличаться от текущего',
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Т. СТАТИЧЕСКИЕ ЗАМКИ: то, что нельзя сломать незаметно (права, область менеджера, деньги)
// ───────────────────────────────────────────────────────────────────────────

/** `*.controller.js` в dist, рекурсивно: набор контроллеров берётся из сборки, а не из списка в тесте. */
function distControllerFiles(dir = join(backendRoot, 'dist'), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) distControllerFiles(full, found);
    else if (entry.name.endsWith('.controller.js')) found.push(full);
  }
  return found;
}

function allDistControllers() {
  const controllers = [];
  for (const file of distControllerFiles()) {
    for (const [name, Controller] of Object.entries(require(file))) {
      if (typeof Controller === 'function' && name.endsWith('Controller')) controllers.push(Controller);
    }
  }
  return controllers;
}

/** Все `*.ts` под backend/src, рекурсивно. */
function backendSourceFiles(dir = join(backendRoot, 'src'), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) backendSourceFiles(full, found);
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Индекс сразу за строковым литералом, который открывается в позиции `start` (апостроф, кавычка или backtick). */
function endOfString(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length && source[index] !== quote) index += source[index] === '\\' ? 2 : 1;
  assert.ok(index < source.length, `строковый литерал в позиции ${start} не закрыт — разбор исходника сломался`);
  return index + 1;
}

/** Строковые литералы исходника (комментарии уже вырезаны): { text, start, end }. */
function stringLiterals(source) {
  const found = [];
  for (let index = 0; index < source.length; ) {
    if ('\'"`'.includes(source[index])) {
      const end = endOfString(source, index);
      found.push({ text: source.slice(index + 1, end - 1), start: index, end });
      index = end;
    } else {
      index += 1;
    }
  }
  return found;
}

/** Текст вызова от открывающей скобки в позиции `open` до парной закрывающей (вложенные скобки и строки учтены). */
function callText(source, open) {
  assert.equal(source[open], '(');
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if ('\'"`'.includes(source[index])) {
      index = endOfString(source, index) - 1;
    } else if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return assert.fail(`у вызова в позиции ${open} нет парной закрывающей скобки`);
}

test("RolesGuard: файл guard'а не тронут — обход @Roles только для superadmin, о менеджере и «платформенных ролях» он не знает", () => {
  const source = stripComments(read('src/common/guards/roles.guard.ts'));
  assert.equal([...source.matchAll(/'superadmin'/g)].length, 1, "в коде guard'а ровно одно упоминание 'superadmin'");
  assert.ok(
    flat(source).includes("if (user?.role === 'superadmin') return true; return requiredRoles.includes(user?.role);"),
    'обход @Roles — строго `user?.role === superadmin`, остальные роли проверяются по списку @Roles',
  );
  assert.doesNotMatch(source, /manager|isPlatformRole|PLATFORM_ROLES|auth-cache/);
});

test('по всему API роль manager названа в @Roles ТОЛЬКО на 14 маршрутах кабинета менеджера', () => {
  const controllers = allDistControllers();
  const namedManager = [];
  let routeCount = 0;
  for (const Controller of controllers) {
    const classRoles = Reflect.getMetadata(ROLES_KEY, Controller);
    if (Array.isArray(classRoles) && classRoles.includes('manager'))
      namedManager.push(`${Controller.name} (весь класс)`);
    for (const route of routesOf(Controller)) {
      routeCount += 1;
      // Как в RolesGuard: роли handler'а переопределяют роли класса.
      const effective = route.roles ?? classRoles ?? [];
      if (effective.includes('manager')) namedManager.push(`${Controller.name}.${route.name}`);
    }
  }
  assert.ok(
    controllers.length > 30 && routeCount > 200,
    `сканирование dist сломалось: ${controllers.length} / ${routeCount}`,
  );
  assert.ok(controllers.includes(ManagerCabinetController), 'кабинет менеджера не найден в dist');
  assert.deepEqual(
    namedManager.sort(),
    routesOf(ManagerCabinetController)
      .map((route) => `ManagerCabinetController.${route.name}`)
      .sort(),
    'менеджеру открыт только его кабинет: любой другой @Roles с manager — расширение прав, его нужно осознанно согласовать',
  );
});

test('кабинет менеджера: каждый запрос к tenants несёт manager_id, каждый вызов TenantsService — область менеджера', () => {
  const source = stripComments(read('src/platform-managers/manager-cabinet.service.ts'));

  const tenantQueries = stringLiterals(source).filter((literal) =>
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+tenants\b/i.test(flat(literal.text)),
  );
  assert.ok(tenantQueries.length >= 1, 'сброс пароля владельца читает tenants напрямую — запрос не найден');
  assert.equal(
    [...source.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+tenants\b/gi)].length,
    tenantQueries.length,
    'обращение к tenants вне строкового литерала (конкатенация?) — разбор не может его проверить',
  );
  for (const query of tenantQueries) {
    const sql = flat(query.text);
    assert.match(sql, /manager_id\s*=\s*\$2::uuid/, `запрос к tenants без manager_id: ${sql}`);
    assert.match(
      sql,
      /\$2::uuid IS NULL OR/,
      'область «без ограничения» — только у суперадмина (NULL), и это видно в запросе',
    );
    assert.match(
      source.slice(query.end, query.end + 160),
      /^\s*,\s*\[\s*id\s*,\s*actor\.scope\.managerId \?\? null\s*\]/,
      `параметры запроса к tenants: [id, actor.scope.managerId ?? null] — ${sql}`,
    );
  }

  const scopedMethods = new Set([
    'getAll',
    'getCabinet',
    'assignPlan',
    'suspend',
    'unsuspend',
    'impersonate',
    'extend',
  ]);
  const calls = [...source.matchAll(/this\.tenants\.(\w+)\(/g)];
  assert.ok(calls.length >= 9, `вызовов TenantsService в кабинете ожидалось не меньше 9, найдено ${calls.length}`);
  assert.equal(
    [...source.matchAll(/\bthis\.tenants\b/g)].length,
    calls.length,
    'this.tenants используется не только как вызов метода (передача сервиса дальше обходит область)',
  );
  for (const call of calls) {
    const method = call[1];
    const text = callText(source, call.index + call[0].length - 1);
    if (scopedMethods.has(method)) {
      assert.match(text, /actor\.scope/, `this.tenants.${method}(…) вызван без области менеджера actor.scope`);
    } else if (method === 'createWithOwnerAndTrialTx') {
      assert.match(text, /\bmanagerId\b/, 'новый клиент менеджера обязан быть закреплён за ним (managerId)');
    } else {
      assert.fail(`this.tenants.${method}(…): новый вызов — проверьте область менеджера и добавьте его в этот тест`);
    }
  }
});

test('деньги менеджеров: писать в subscription_payments и manager_settlements умеют ровно четыре известных места', () => {
  const writeRe =
    /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(subscription_payments|manager_settlements)\b/gi;
  const files = backendSourceFiles();
  assert.ok(files.length > 200, `сканирование src сломалось: ${files.length} файлов`);
  const writes = [];
  for (const file of files) {
    for (const match of stripComments(readFileSync(file, 'utf8')).matchAll(writeRe)) {
      const verb = match[1].toUpperCase().replace(/\s+/g, ' ');
      writes.push(`${file.slice(backendRoot.length + 1)}: ${verb} ${match[2].toLowerCase()}`);
    }
  }
  assert.deepEqual(
    writes.sort(),
    [
      'src/platform-managers/admin-managers.service.ts: DELETE FROM manager_settlements',
      'src/platform-managers/admin-managers.service.ts: INSERT INTO manager_settlements',
      'src/tenants/tenants.service.ts: INSERT INTO subscription_payments',
      'src/tenants/tenants.service.ts: INSERT INTO subscription_payments',
    ],
    'новый писатель в денежные таблицы — это учёт: его нужно осознанно проверить и добавить сюда',
  );
});

test('менеджер платформы не получает ни одного тенантного права; /my-company закрыт PermissionsGuard, директору и суперадмину открыт', async () => {
  for (const key of CANONICAL_KEYS) {
    assert.equal(userHasPermission({ role: 'manager', permissions: {} }, key), false, `permissions {} / ${key}`);
    assert.equal(userHasPermission({ role: 'manager' }, key), false, `без permissions / ${key}`);
    assert.equal(userHasPermission({ role: 'director', permissions: {} }, key), true, `директор / ${key}`);
    assert.equal(userHasPermission({ role: 'superadmin', permissions: {} }, key), true, `суперадмин / ${key}`);
  }

  const guards = (Reflect.getMetadata('__guards__', TenantsController) || []).map((guard) => guard.name);
  assert.ok(
    guards.includes('PermissionsGuard'),
    'без PermissionsGuard на классе @RequirePermission на /my-company не действует',
  );
  const guard = new PermissionsGuard(new Reflector());
  for (const handler of ['getMyCompany', 'updateMyCompany']) {
    await expectHttp(
      async () => guard.canActivate(guardContext(TenantsController, handler, managerUser({ permissions: {} }))),
      403,
      'Недостаточно прав для этого действия',
    );
    assert.equal(guard.canActivate(guardContext(TenantsController, handler, directorUser({ permissions: {} }))), true);
    assert.equal(
      guard.canActivate(guardContext(TenantsController, handler, superadminUser({ permissions: {} }))),
      true,
    );
  }
});

test('маршруты суперадмина в tenants и admin-audit: менеджеру и директору закрыты RolesGuard; без @Roles остаются ровно три', () => {
  const guard = new RolesGuard(new Reflector());
  const reflector = new Reflector();
  const withoutRoles = [];
  let closed = 0;
  for (const Controller of [TenantsController, AdminAuditController]) {
    for (const route of routesOf(Controller)) {
      const roles = reflector.getAllAndOverride(ROLES_KEY, [Controller.prototype[route.name], Controller]);
      if (!roles) {
        withoutRoles.push(`${Controller.name}.${route.name}`);
        continue;
      }
      const label = `${route.verb} ${route.path}`;
      assert.deepEqual(roles, ['superadmin'], label);
      assert.equal(guard.canActivate(guardContext(Controller, route.name, managerUser())), false, `${label}: менеджер`);
      assert.equal(
        guard.canActivate(guardContext(Controller, route.name, directorUser())),
        false,
        `${label}: директор`,
      );
      assert.equal(
        guard.canActivate(guardContext(Controller, route.name, superadminUser())),
        true,
        `${label}: суперадмин`,
      );
      closed += 1;
    }
  }
  assert.equal(closed, 17, 'закрытых маршрутов суперадмина: 14 в TenantsController + 3 в AdminAuditController');
  assert.deepEqual(
    withoutRoles.sort(),
    ['TenantsController.getMyCompany', 'TenantsController.getSubscription', 'TenantsController.updateMyCompany'],
    'без @Roles остались только «свои» маршруты тенанта: /my-company (закрыт PermissionsGuard) и /subscription',
  );
});

test('ProfileController: менеджеру открыты только «свои» маршруты (правка профиля, пароль, свой запрос); очередь запросов закрыта правом', async () => {
  // Менеджер платформы обслуживается admin-пулом на /api/profile/* (см. TenantContextInterceptor):
  // это допустимо ровно потому, что обработчики без ключа трогают только строку req.user.userID,
  // а всё, что читает или меняет чужое, закрыто @RequirePermission — которого у менеджера нет.
  const guards = (Reflect.getMetadata('__guards__', ProfileController) || []).map((guard) => guard.name);
  assert.deepEqual(guards, ['JwtAuthGuard', 'RolesGuard', 'PermissionsGuard'], 'guard-цепочка класса');

  const open = [];
  const gated = [];
  for (const route of routesOf(ProfileController)) {
    assert.equal(route.roles, undefined, `${route.verb} ${route.path}: @Roles на профиле не ставим`);
    const key = Reflect.getMetadata(PERMISSION_KEY, ProfileController.prototype[route.name]);
    (key === undefined ? open : gated).push(`${route.verb} ${route.path}${key ? ` [${key}]` : ''}`);
  }
  assert.deepEqual(
    open.sort(),
    ['GET /profile/change-requests/mine', 'PATCH /profile', 'POST /profile/password'].sort(),
    'без ключа права — только самообслуживание; любой новый маршрут здесь получит admin-пул менеджера',
  );
  assert.deepEqual(
    gated.sort(),
    [
      'GET /profile/change-requests [employees_approve_profile]',
      'POST /profile/change-requests/:id/approve [employees_approve_profile]',
      'POST /profile/change-requests/:id/reject [employees_approve_profile]',
    ].sort(),
  );

  // Живой PermissionsGuard: менеджеру очередь закрыта, владельцам открыта, самообслуживание — всем.
  const guard = new PermissionsGuard(new Reflector());
  for (const handler of ['listChangeRequests', 'approve', 'reject']) {
    await expectHttp(
      async () => guard.canActivate(guardContext(ProfileController, handler, managerUser({ permissions: {} }))),
      403,
      'Недостаточно прав для этого действия',
    );
    assert.equal(guard.canActivate(guardContext(ProfileController, handler, directorUser({ permissions: {} }))), true);
    assert.equal(
      guard.canActivate(guardContext(ProfileController, handler, superadminUser({ permissions: {} }))),
      true,
    );
  }
  for (const handler of ['updateProfile', 'changePassword', 'myChangeRequest']) {
    assert.equal(guard.canActivate(guardContext(ProfileController, handler, managerUser({ permissions: {} }))), true);
  }

  // Запись в свой профиль/пароль не блокируется «записью без тенанта» (409 NO_TENANT_CONTEXT).
  for (const handler of ['updateProfile', 'changePassword']) {
    assert.equal(
      Reflect.getMetadata(ALLOW_NO_TENANT_KEY, ProfileController.prototype[handler]),
      true,
      `${handler}: нужен @AllowNoTenant()`,
    );
  }
});
