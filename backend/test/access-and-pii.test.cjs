const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ДОСТУП И ПЕРСОНАЛЬНЫЕ ДАННЫЕ (аудит 2026-09).
 *
 * Шесть инвариантов. Каждый при поломке — это не косметика, а чужие документы,
 * чужие деньги или живой доступ у того, кого уже выгнали:
 *
 *   1. Документы сотрудника (паспорт, трудовой договор) и его полный профиль
 *      видит только руководитель кадров или сам сотрудник. Классовые guard'ы
 *      БЕЗ ключа не ограничивают никого — правило живёт в сервисе.
 *   2. Денежная часть профиля закрыта правом видеть финансы, а выручка
 *      считается в разрезе ФИЛИАЛА СЕССИИ; филиал и объём прав входят в ключ
 *      кеша, иначе филиал Б получит цифры филиала А.
 *   3. Открытые списки сотрудников (пикер мастера, график) не везут телефоны,
 *      логины, проценты зарплаты и лимиты расходов коллег.
 *   4. Архивация филиала ОТНИМАЕТ доступ, а не выдаёт: «доступ не настроен» и
 *      «доступ есть, но филиал закрыт» — разные состояния.
 *   5. Старая сборка (3.5/3.6) может сменить филиал: ручка пишет подсказку
 *      следующего входа (тест — в points-session-login/points-write-gate).
 *   6. Смена пароля гасит ВСЕ ранее выданные сессии.
 *
 * Тесты статические (читают исходники) там, где инвариант — это текст места, и
 * рантаймовые (через dist) там, где можно проверить поведение: живой БД в CI
 * нет, поэтому БД подменяется заглушкой пула.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const employeesService = read('src/employees/employees.service.ts');
const employeesController = read('src/employees/employees.controller.ts');
const usersService = read('src/users/users.service.ts');
const usersController = read('src/users/users.controller.ts');
const profileService = read('src/profile/profile.service.ts');
const jwtStrategy = read('src/auth/jwt.strategy.ts');
const authService = read('src/auth/auth.service.ts');
const migration165 = read('migrations/165_access_hardening.sql');
const migration163 = read('migrations/163_point_session_login.sql');

// ── 1. Документы и профиль сотрудника ──────────────────────────────────────

test('чтение карточки сотрудника проходит через ОДНО правило доступа', () => {
  assert.ok(
    /private assertCanViewEmployee\(actor: EmployeeActor, employeeId: string\)/.test(employeesService),
    'правило «руководитель или сам сотрудник» снова размазано по методам — копии разъедутся',
  );
  // Все три чтения обязаны его звать.
  for (const method of ['async listDocuments(', 'async getDocumentStoredPath(', 'async fullProfile(']) {
    const body = employeesService.slice(
      employeesService.indexOf(method),
      employeesService.indexOf(method) + 1200,
    );
    assert.ok(
      /this\.assertCanViewEmployee\(actor/.test(body),
      `${method} снова открыт любому аутентифицированному — мастер скачает паспорт коллеги`,
    );
  }
});

test('контроллер передаёт АКТОРА, а не только тенанта', () => {
  assert.ok(/this\.employees\.listDocuments\(user, user\.tenantID, id\)/.test(employeesController));
  assert.ok(/this\.employees\.getDocumentStoredPath\(user, user\.tenantID, id, docId\)/.test(employeesController));
  assert.ok(/this\.employees\.fullProfile\(user, user\.tenantID, id, include\)/.test(employeesController));
});

test('проверка доступа к файлу идёт ДО чтения диска', () => {
  const body = employeesController.slice(employeesController.indexOf('async serveDocument('));
  const check = body.indexOf('getDocumentStoredPath');
  const disk = body.indexOf('this.storage.createReadStream');
  assert.ok(check > 0 && disk > check, 'файл отдаётся раньше проверки доступа');
});

// ── 2. Деньги в профиле: право + филиал + ключ кеша ─────────────────────────

test('денежная часть профиля закрыта правом видеть финансы', () => {
  assert.ok(
    /const canSeeMoney = isSelf \|\| userHasPermission\(actor, 'profit_view'\)/.test(employeesService),
    'выручка сотрудника снова открыта всем, кто добрался до карточки',
  );
  // Рублёвые поля обязаны уходить нулями, а не значениями.
  assert.ok(/const totalRevenue = canSeeMoney \? parseFloat\(totals\[0\]\?\.revenue\) \|\| 0 : 0;/.test(employeesService));
  assert.ok(/value: canSeeMoney \? parseFloat\(bestDayRows\[0\]\.revenue\) \|\| 0 : 0,/.test(employeesService));
  assert.ok(/value: canSeeMoney \? parseFloat\(bestMonthRows\[0\]\.revenue\) \|\| 0 : 0,/.test(employeesService));
});

test('выручка сотрудника считается в разрезе филиала сессии', () => {
  // Ни одного агрегата по чекам БЕЗ фильтра филиала: иначе карточка мастера в
  // филиале Б покажет деньги филиала А и не сойдётся с журналом этого филиала.
  const aggregates = employeesService.match(/FROM checks\b/g) ?? [];
  const filters = employeesService.match(/pointFilterSql\(/g) ?? [];
  assert.ok(aggregates.length >= 6, 'агрегаты по чекам исчезли — тест потерял предмет');
  assert.ok(
    filters.length >= aggregates.length,
    'появился агрегат по чекам без фильтра филиала — цифры карточки разъедутся с журналом',
  );
  assert.ok(/const pointId = actorPointId\(actor\);/.test(employeesService), 'филиал обязан браться из сессии');
});

test('ключ кеша профиля несёт филиал и объём прав, но остаётся под префиксом инвалидации', () => {
  const key = employeesService.slice(
    employeesService.indexOf('const cacheKey ='),
    employeesService.indexOf('return ttlCache.wrap(cacheKey'),
  );
  assert.ok(/employee:\$\{tenantID\}:\$\{employeeId\}:full:\$\{pointCacheSegment\(pointId\)\}/.test(key),
    'филиал выпал из ключа — филиал Б получит цифры филиала А');
  assert.ok(/isManager \? 'n' : ''/.test(key) && /canSeeMoney \? 'm' : ''/.test(key),
    'объём прав выпал из ключа — мастер прочитает payload, посчитанный для владельца');
  // Инвалидация чистит по префиксу `employee:<тенант>:<сотрудник>` — сегмент
  // филиала обязан стоять ПОСЛЕ id, иначе мутации перестанут сбрасывать кеш.
  assert.ok(
    /ttlCache\.invalidatePrefix\(`employee:\$\{tenantID\}:\$\{employeeId\}`\)/.test(employeesService),
    'инвалидация профиля исчезла',
  );
  assert.ok(
    !/employee:\$\{tenantID\}:\$\{pointCacheSegment/.test(employeesService),
    'филиал уехал ПЕРЕД id сотрудника — инвалидация по префиксу перестанет попадать в ключ',
  );
});

test('личные заметки владельца видит только руководитель кадров', () => {
  assert.ok(/ownerNotes: canSeeNotes \? r\.owner_notes : null,/.test(employeesService));
  assert.ok(
    /canSeeNotes: isManager/.test(employeesService),
    'заметки руководителя О человеке снова видны самому человеку',
  );
});

test('РАНТАЙМ: профиль коллеги закрыт, свой — открыт, а кеш не путает права и филиалы', async () => {
  const { EmployeesService } = require('../dist/employees/employees.service');
  let profileReads = 0;
  const pool = {
    query: async (sql) => {
      if (/hire_date/.test(sql)) {
        profileReads += 1;
        return {
          rows: [
            {
              id: 'emp-1',
              full_name: 'Мастер',
              role: 'master',
              hire_date: null,
              specializations: [],
              position_title: null,
              custom_title: null,
              monthly_kpi_revenue: null,
              monthly_kpi_checks: null,
              owner_notes: `notes-${profileReads}`,
              photo_url: null,
              whatsapp: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const service = new EmployeesService(pool);

  // Коллега без права управления персоналом — отказ, а не чужой паспорт.
  const stranger = { userID: 'emp-2', role: 'master', permissions: {}, currentPointId: 'p-1' };
  await assert.rejects(() => service.fullProfile(stranger, 't-1', 'emp-1'), /Нет доступа к этому сотруднику/);
  await assert.rejects(() => service.listDocuments(stranger, 't-1', 'emp-1'), /Нет доступа к этому сотруднику/);
  await assert.rejects(
    () => service.getDocumentStoredPath(stranger, 't-1', 'emp-1', 'doc-1'),
    /Нет доступа к этому сотруднику/,
  );

  // Руководитель в филиале p-1 и он же в филиале p-2 — РАЗНЫЕ расчёты, значит
  // и разные ключи кеша (иначе второй ответ пришёл бы из первого).
  const boss = { userID: 'boss', role: 'director', permissions: {}, currentPointId: 'p-1' };
  const atP1 = await service.fullProfile(boss, 't-1', 'emp-1');
  const atP2 = await service.fullProfile({ ...boss, currentPointId: 'p-2' }, 't-1', 'emp-1');
  assert.notEqual(atP1.profile.ownerNotes, atP2.profile.ownerNotes, 'филиал не участвует в ключе кеша');

  // Тот же филиал и тот же сотрудник, но смотрит он сам: заметок руководителя
  // о нём он не видит — и payload руководителя ему не отдаётся из кеша.
  const self = { userID: 'emp-1', role: 'master', permissions: {}, currentPointId: 'p-1' };
  const own = await service.fullProfile(self, 't-1', 'emp-1');
  assert.equal(own.profile.ownerNotes, null, 'сотруднику отдали личные заметки руководителя о нём');
});

// ── 3. Открытые списки сотрудников не везут ПДн и деньги ───────────────────

test('объём строки сотрудника решает одно правило', () => {
  assert.ok(
    /private canSeeFullUser\(/.test(usersService),
    'предикат объёма снова размазан — список и карточка разойдутся',
  );
  assert.ok(/return userHasPermission\(actor, 'user_management'\) \|\| actor\.userID === rowId;/.test(usersService));
  // Списки и карточка спрашивают именно его.
  const calls = usersService.match(/this\.mapUser\(r?o?w?s?\[?0?\]?, this\.canSeeFullUser\(actor, /g) ?? [];
  assert.ok(calls.length >= 3, 'какой-то из открытых GET снова отдаёт полный состав всем');
  assert.ok(/getById\(id: string, tenantID: string, actor: JwtPayload\)/.test(usersService));
  assert.ok(/this\.usersService\.getById\(id, tenantID, user\)/.test(usersController));
});

test('РАНТАЙМ: мастер видит в списке имя и график, но не телефон и не процент', async () => {
  const { UsersService } = require('../dist/users/users.service');
  const row = {
    id: 'emp-1',
    phone: '+79990000000',
    full_name: 'Мастер',
    username: 'master1',
    avatar: null,
    role: 'master',
    salary_percent: '40',
    product_salary_percent: '10',
    permissions: {},
    days_off: [],
    sort_order: 0,
    is_active: true,
    team: null,
    can_add_expenses: false,
    daily_expense_limit: '5000',
    hidden_from_schedule: false,
    hidden_everywhere: false,
    dismissed_at: null,
    purged_at: null,
    role_id: null,
    tenant_id: 't-1',
    created_at: '2026-01-01',
  };
  const colleague = { ...row, id: 'emp-2', full_name: 'Коллега' };
  // Карточка (`WHERE id = $1`) обязана отдавать ИМЕННО запрошенного человека —
  // иначе тест сам себе подсунет строку смотрящего и «полный состав» сойдётся.
  const pool = {
    query: async (sql) => ({ rows: /WHERE id = \$1 AND tenant_id = \$2/.test(sql) ? [colleague] : [row, colleague] }),
  };
  const service = new UsersService(pool, { sendDataToTenant: async () => {} });

  const asColleague = await service.getAll({ userID: 'emp-1', tenantID: 't-1', role: 'master', permissions: {} });
  const [own, other] = asColleague;

  // Пикеру нужно ровно это — и оно на месте.
  assert.equal(other.id, 'emp-2');
  assert.equal(other.fullName, 'Коллега');
  assert.equal(other.role, 'master');
  assert.deepEqual(other.daysOff, []);
  assert.equal(other.hiddenEverywhere, false);

  // А этого в пикере не нужно — и его нет.
  for (const key of [
    'phone',
    'username',
    'salaryPercent',
    'productSalaryPercent',
    'permissions',
    'canAddExpenses',
    'dailyExpenseLimit',
  ]) {
    assert.ok(!(key in other), `в открытом списке снова уезжает ${key} коллеги`);
  }

  // Своя строка — целиком: это его собственные данные.
  assert.equal(own.phone, '+79990000000');
  assert.equal(own.salaryPercent, 40);

  // Держателю права управления персоналом — полный состав по всем.
  const asManager = await service.getAll({
    userID: 'boss',
    tenantID: 't-1',
    role: 'master',
    permissions: { user_management: true },
  });
  assert.equal(asManager[1].phone, '+79990000000');
  assert.equal(asManager[1].dailyExpenseLimit, 5000);

  // /users/masters — тот же предикат (пикер мастера в Кассе).
  const masters = await service.getMasters({ userID: 'emp-1', tenantID: 't-1', role: 'master', permissions: {} });
  assert.ok(!('phone' in masters[1]));

  // Карточка /users/:id — тоже.
  const card = await service.getById('emp-2', 't-1', {
    userID: 'emp-1',
    tenantID: 't-1',
    role: 'master',
    permissions: {},
  });
  assert.ok(!('salaryPercent' in card), 'карточка коллеги снова везёт его процент зарплаты');
});

// ── 4. Архивация филиала не должна повышать права ──────────────────────────

test('«доступ не настроен» и «филиал закрыт» — разные состояния', () => {
  // Ветка «доступны все живые» включается ТОЛЬКО отсутствием строк user_points
  // у сотрудника. Прежняя формулировка (`NOT EXISTS (SELECT 1 FROM mine)`)
  // означала «нет доступа к ЖИВЫМ», и архивация последнего назначенного
  // филиала открывала человеку всю сеть, включая основной сервис.
  assert.ok(/CREATE OR REPLACE FUNCTION autexa_available_points\(/.test(migration165));
  // Комментарии вырезаем: в них ЦИТИРУЕТСЯ старая формулировка, и без вырезания
  // тест ловил бы собственное объяснение вместо кода.
  const fn = migration165
    .slice(migration165.indexOf('CREATE OR REPLACE FUNCTION autexa_available_points('))
    .replace(/--.*$/gm, '');
  assert.ok(
    !/NOT EXISTS \(SELECT 1 FROM mine\)/.test(fn),
    'вернулась конвенция «нет доступа к живым → доступны все живые»: закрытие филиала снова раздаёт доступ ко всей сети',
  );
  assert.ok(
    /SELECT \* FROM live\s+WHERE NOT EXISTS \(\s*SELECT 1 FROM user_points up\s+WHERE up\.user_id = p_user/.test(fn),
    'безопасный дефолт обязан опираться на ОТСУТСТВИЕ назначений вообще',
  );
  // Файл 163 не редактируется — он уже применён на проде.
  assert.ok(
    /NOT EXISTS \(SELECT 1 FROM mine\)/.test(migration163),
    'отредактирован уже применённый файл миграции — MigrationRunner его не перевыполнит',
  );
});

test('сотрудник без единого доступного филиала не получает сессию без филиала', () => {
  // Вход: отказ с объяснением вместо молчаливого входа «в никуда».
  assert.ok(
    /Вам не назначен ни один действующий филиал — обратитесь к руководителю/.test(authService),
    'вход снова пускает сотрудника без филиала у тенанта С филиалами — его деньги не попадут ни в один срез',
  );
  // Живые сессии (токен без филиала) обязаны умереть тем же текстом.
  assert.ok(/tenant_has_points/.test(jwtStrategy), 'стратегия не отличает одноточечный тенант от «нет доступа»');
  assert.ok(
    /!tokenPointId && rows\[0\]\.tenant_has_points === true && !rows\[0\]\.default_point_id/.test(jwtStrategy),
    'сессия без филиала у тенанта с филиалами снова живёт',
  );
});

// ── 6. Смена пароля гасит все прежние сессии ───────────────────────────────

test('смена пароля пишет границу жизни сессий и сбрасывает auth-кеш', () => {
  assert.ok(
    /UPDATE users SET password=\$1, sessions_valid_from=now\(\), updated_at=now\(\) WHERE id=\$2/.test(profileService),
    'самостоятельная смена пароля снова оставляет старые токены живыми на 30 суток',
  );
  const body = profileService.slice(profileService.indexOf('async changePassword('));
  assert.ok(/invalidateAuthUser\(self\.id\)/.test(body), '30-секундный auth-кеш продержит украденный токен ещё полминуты');

  // Сброс пароля владельцем — то же самое.
  const passwordBranch = usersService.slice(usersService.indexOf('if (dto.password) {'));
  assert.ok(
    /sets\.push\(`sessions_valid_from=now\(\)`\)/.test(passwordBranch.slice(0, 900)),
    'сброс пароля владельцем не отбирает доступ: старый токен сотрудника живёт дальше',
  );
});

test('стратегия сверяет возраст токена с границей В БАЗЕ, а не в Node', () => {
  assert.ok(/const tokenIat = typeof payload\.iat === 'number' \? payload\.iat : null;/.test(jwtStrategy));
  assert.ok(
    /u\.sessions_valid_from IS NOT NULL[\s\S]{0,200}to_timestamp\(\$3::double precision\) < u\.sessions_valid_from/.test(
      jwtStrategy,
    ),
    'сравнение уехало в Node — расхождение часов Node и Postgres станет дырой или ложным разлогином',
  );
  assert.ok(
    /if \(rows\[0\]\.session_stale === true\)/.test(jwtStrategy) && /Пароль изменён — войдите заново/.test(jwtStrategy),
    'токен старше границы снова проходит',
  );
  // Токен без iat при выставленной границе — стухший (fail-closed).
  assert.ok(/\$3::double precision IS NULL\s+OR/.test(jwtStrategy), 'токен без iat обязан считаться старым');
});

test('колонка границы сессий добавляется БЕЗ дефолта — иначе миграция разлогинит весь прод', () => {
  assert.ok(/ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;/.test(migration165));
  assert.ok(
    !/sessions_valid_from TIMESTAMPTZ[^;]*DEFAULT/.test(migration165),
    'у границы появился DEFAULT now(): применение миграции выкинет из приложения всех разом',
  );
});
