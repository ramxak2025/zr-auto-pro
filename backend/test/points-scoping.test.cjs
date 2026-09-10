const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Филиалы (мульти-точки): скоуп чтения и записи.
 *
 * ЧТО ОХРАНЯЕТ ЭТОТ ТЕСТ — четыре инварианта, каждый из которых при поломке
 * означает НЕВЕРНЫЕ ДЕНЬГИ, а не косметику:
 *
 *   1. Точка в SQL уходит ПАРАМЕТРОМ. Значение приезжает из БД, но склейка
 *      строки в запрос — инъекция независимо от происхождения значения.
 *   2. Сегмент точки в ключах кеша стоит СРАЗУ ПОСЛЕ tenantID. Инвалидация
 *      отчётов (common/reports-cache.ts) чистит по префиксу
 *      `reports:<kind>:<tenantID>`; точка перед тенантом вывела бы ключ
 *      из-под неё, и филиал показывал бы дореализационные цифры.
 *   3. Активация отложенного заказа НЕ переписывает point_id: чек остаётся за
 *      филиалом создания. Иначе кассир другой точки, закрывающий чужой драфт,
 *      переносил бы выручку в свой филиал.
 *   4. История клиента и авто НЕ фильтруется точкой — единственное исключение,
 *      которое владелец оставил общим на всю сеть.
 *
 * Тест статический (читает исходники), как auth-rate-limit / salary-*: живой
 * БД в CI нет, а именно текст этих мест и обязан оставаться неизменным.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const moneySql = read('src/common/check-money-sql.ts');
const checksService = read('src/checks/checks.service.ts');
const reportsService = read('src/reports/reports.service.ts');
const pointsService = read('src/points/points.service.ts');
const reportsCache = read('src/common/reports-cache.ts');
const jwtStrategy = read('src/auth/jwt.strategy.ts');
const clientsService = read('src/clients/clients.service.ts');
const carsService = read('src/cars/cars.service.ts');
const migration = read('migrations/160_points_scoping.sql');

// ── 1. Точка уходит параметром, а не склейкой ───────────────────────────────

test('pointFilterSql всегда параметризует точку и молчит без неё', () => {
  const { pointFilterSql, actorPointId, pointCacheSegment } = require('../dist/common/point-scope');

  // Без точки — пустой фрагмент и НИ ОДНОГО лишнего параметра: запрос
  // одноточечного тенанта обязан остаться дословно прежним.
  const noneParams = ['tenant'];
  assert.equal(pointFilterSql('ch', null, noneParams), '');
  assert.deepEqual(noneParams, ['tenant']);

  // С точкой — плейсхолдер ровно на позицию только что положенного значения.
  const params = ['tenant', 'from', 'to'];
  assert.equal(pointFilterSql('ch', 'p-1', params), ' AND ch.point_id = $4');
  assert.deepEqual(params, ['tenant', 'from', 'to', 'p-1']);

  // Без алиаса — колонка без префикса (запросы вида `FROM checks`).
  const bare = ['tenant'];
  assert.equal(pointFilterSql(null, 'p-1', bare), ' AND point_id = $2');

  // Значение точки НИКОГДА не попадает в текст SQL.
  assert.ok(!pointFilterSql('ch', 'p-1', ['t']).includes('p-1'));

  // Пустая строка = «точки нет»: '' в uuid-сравнении дал бы 22P02 → 500.
  assert.equal(actorPointId({ currentPointId: '' }), null);
  assert.equal(actorPointId({ currentPointId: null }), null);
  assert.equal(actorPointId(undefined), null);
  assert.equal(actorPointId({ currentPointId: 'p-9' }), 'p-9');

  assert.equal(pointCacheSegment(null), 'all');
  assert.equal(pointCacheSegment('p-9'), 'p-9');
});

test('ни один сервис не склеивает point_id со значением в SQL', () => {
  // Разрешён ровно один вид сравнения: `point_id = $n`. Любое `point_id = '`
  // или `point_id = ${` — склейка.
  for (const [name, src] of [
    ['checks.service', checksService],
    ['reports.service', reportsService],
    ['points.service', pointsService],
  ]) {
    assert.ok(!/point_id\s*=\s*'/.test(src), `${name}: point_id сравнивается со строковым литералом`);
    assert.ok(!/point_id\s*=\s*\$\{(?!\w*Params\.length)/.test(src), `${name}: point_id склеен через интерполяцию`);
  }
});

// ── 2. Сегмент точки в ключах кеша — СРАЗУ ПОСЛЕ tenantID ───────────────────

test('ключи кешируемых агрегатов содержат точку сразу после tenantID', () => {
  const keys = [
    // reports:dashboard-chart:<tenant>:<point>:<period>:<offset>
    /reports:dashboard-chart:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}:/,
    // reports:ranking:<tenant>:<point>
    /reports:ranking:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}`/,
  ];
  for (const re of keys) {
    assert.ok(re.test(checksService), `checks.service: ключ кеша без сегмента точки — ${re}`);
  }

  const reportKeys = [
    /reports:dashboard-v2:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}:\$\{period\}/,
    /reports:alerts:\$\{tenantID\}:\$\{pointCacheSegment\(pointId\)\}`/,
  ];
  for (const re of reportKeys) {
    assert.ok(re.test(reportsService), `reports.service: ключ кеша без сегмента точки — ${re}`);
  }

  // Сводка по филиалам обязана начинаться с reports: и нести тенанта, иначе
  // её не почистит invalidateReportsForTenant.
  assert.ok(/reports:points-summary:\$\{user\.tenantID\}/.test(pointsService));
});

test('invalidateReportsForTenant покрывает каждое кешируемое семейство', () => {
  for (const family of [
    'reports:dashboard-v2',
    'reports:dashboard-chart',
    'reports:ranking',
    'reports:alerts',
    'reports:points-summary',
  ]) {
    assert.ok(
      reportsCache.includes(`invalidatePrefix(\`${family}:\${tenantID}\`)`),
      `reports-cache: нет префиксной чистки для ${family}`,
    );
  }
});

// ── 3. Актор несёт точку из JWT, переключение сбрасывает auth-кеш ───────────

test('current_point_id читается тем же SELECT, что роль (без лишнего DB-hop)', () => {
  assert.ok(
    /u\.current_point_id::text as current_point_id/.test(jwtStrategy),
    'jwt.strategy: точка не читается вместе с ролью',
  );
  assert.ok(/currentPointId: rows\[0\]\.current_point_id \?\? null/.test(jwtStrategy));

  // Лишний SELECT точки внутри транзакции создания чека должен быть удалён.
  assert.ok(
    !/SELECT current_point_id FROM users/.test(checksService),
    'checks.service: точка снова читается отдельным запросом на каждый чек',
  );
});

test('переключение и архив филиала инвалидируют auth-кеш', () => {
  // Без сброса кеша актор до 30 секунд ходит со СТАРОЙ точкой и видит деньги
  // чужого филиала — это и есть самый дорогой баг этой волны.
  const switchBody = pointsService.slice(
    pointsService.indexOf('async switchPoint('),
    pointsService.indexOf('private async defaultPointForMember('),
  );
  assert.ok(switchBody.includes('invalidateAuthUser(user.userID)'), 'switchPoint не сбрасывает auth-кеш');

  // Последствия архивации живут в ОДНОМ хелпере, и оба пути архивации
  // (DELETE и PATCH isActive:false) обязаны его звать — иначе сотрудники
  // остаются приколотыми к погашенной точке (см. points-archive-and-first-point).
  const detachBody = pointsService.slice(
    pointsService.indexOf('private async detachMembersFromPoint('),
    pointsService.indexOf('async adminArchive('),
  );
  assert.ok(
    detachBody.includes('invalidateAuthUser('),
    'сброс с архивной точки не чистит auth-кеш «застрявших» акторов',
  );
  const archiveBody = pointsService.slice(pointsService.indexOf('async adminArchive('));
  assert.ok(
    archiveBody.includes('await this.detachMembersFromPoint(tenantId, pointId);'),
    'adminArchive не отвязывает сотрудников от архивной точки',
  );
});

// ── 4. Активация драфта НЕ переносит чек в другой филиал ────────────────────

test('активация отложенного заказа не переписывает point_id', () => {
  // Берём блок, в котором активация собирает список SET-полей: там появляются
  // date / accepted_by / accepted_at / discount / payment_method / ноги оплаты.
  const start = checksService.indexOf("const sets: string[] = ['is_deferred=false'];");
  assert.ok(start > 0, 'не найден блок активации отложенного заказа');
  const end = checksService.indexOf('await client.query(`UPDATE checks SET ${sets.join', start);
  assert.ok(end > start, 'не найден UPDATE активации');
  const activationBlock = checksService.slice(start, end);

  assert.ok(activationBlock.includes('sets.push(`date=$'), 'блок активации опознан неверно');
  assert.ok(
    !/sets\.push\(`point_id=/.test(activationBlock),
    'активация переписывает point_id — выручка драфта уедет в филиал того, кто его закрыл',
  );
  assert.ok(
    !/point_id/.test(activationBlock.replace(/\/\/.*$/gm, '')),
    'в SET-полях активации появилась точка (комментарии не считаются)',
  );
});

// ── 5. История клиента и авто — исключение из скоупа ────────────────────────

test('журнал не фильтрует точку при запросе истории клиента или авто', () => {
  assert.ok(
    /const journalPointId = query\.clientId \|\| query\.carId \? null : actorPointId\(actor\);/.test(checksService),
    'checks.getAll: исключение «история клиента/авто» пропало',
  );
});

test('история в clients/cars помечена как сознательное исключение', () => {
  for (const [name, src] of [
    ['clients.service', clientsService],
    ['cars.service', carsService],
  ]) {
    assert.ok(
      /ИСКЛЮЧЕНИЕ, НЕ «ЧИНИТЬ»/.test(src),
      `${name}: нет предупреждения о том, что история намеренно не фильтруется по филиалу`,
    );
    // В SQL этих сервисов не должно быть НИ ОДНОГО сравнения по точке чека:
    // комментарии не в счёт (в них колонка упомянута умышленно).
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/ch\.point_id/.test(code), `${name}: история фильтруется точкой чека`);
  }
});

// ── 6. Формула денег — одна на все экраны ───────────────────────────────────

test('дашборд, dashboard-v2 и сводка филиалов берут формулу из общего модуля', () => {
  // Гарантия исключена из выручки и заменена реальным убытком — ровно один
  // источник этой формулы, иначе экраны снова разъедутся (это уже случалось).
  assert.ok(moneySql.includes("payment_method IS DISTINCT FROM 'warranty'"));
  assert.ok(moneySql.includes('product_cost_total + ${p}service_salary_total + COALESCE(${p}product_salary_total, 0)'));

  for (const [name, src] of [
    ['checks.service', checksService],
    ['reports.service', reportsService],
    ['points.service', pointsService],
  ]) {
    assert.ok(src.includes('checkRevenueExpr'), `${name}: не использует общее выражение выручки`);
    assert.ok(src.includes('checkProfitExpr'), `${name}: не использует общее выражение прибыли`);
  }

  const { checkRevenueExpr, checkProfitExpr, checkMoneyBaseWhere } = require('../dist/common/check-money-sql');
  assert.equal(
    checkRevenueExpr('ch'),
    "CASE WHEN ch.payment_method IS DISTINCT FROM 'warranty' THEN ch.total_revenue ELSE 0 END",
  );
  assert.ok(checkProfitExpr().startsWith("CASE WHEN payment_method = 'warranty' THEN -("));
  assert.equal(checkMoneyBaseWhere('ch'), 'ch.is_deferred = false AND ch.deleted_at IS NULL');
});

// ── 7. Миграция 160 ─────────────────────────────────────────────────────────

test('миграция 160 привязывает историю к ОСНОВНОЙ точке и идемпотентна', () => {
  // Привязка адресует ТОЛЬКО строки без точки: повторный прогон не может
  // «перенести» уже привязанные деньги в другой филиал.
  // Якорим на начало строки: в шапке миграции те же слова встречаются в
  // пояснительном комментарии.
  const updates = migration.match(/^UPDATE (checks|clients)[\s\S]*?;/gm) ?? [];
  assert.equal(updates.length, 2, 'ожидались ровно две привязки: чеки и клиенты');
  for (const stmt of updates) {
    assert.ok(/point_id IS NULL/.test(stmt), 'привязка не ограничена строками без точки — неидемпотентно');
    // САМОЕ ВАЖНОЕ УТВЕРЖДЕНИЕ ФАЙЛА. «Первая живая точка» приписала бы всю
    // многолетнюю историю ZR AUTO филиалу ТопГаз, заведённому в прошлом
    // месяце, и различить их обратно было бы нечем.
    assert.ok(
      /tp\.is_main AND tp\.is_active/.test(stmt),
      'история обязана уходить ОСНОВНОМУ сервису тенанта, а не первой попавшейся живой точке',
    );
    assert.ok(
      !/DISTINCT ON/.test(stmt) && !/sort_order/.test(stmt),
      '«первой точки» как понятия больше нет: основная ровно одна (uq_tenant_points_one_main)',
    );
  }

  // Индексы — идемпотентно и без CONCURRENTLY (MigrationRunner гоняет файл в
  // транзакции, CREATE INDEX CONCURRENTLY там запрещён).
  const indexes = migration.match(/^CREATE INDEX[^;]*;/gm) ?? [];
  assert.ok(indexes.length >= 3, 'ожидались индексы под журнал, деньги и доску филиала');
  for (const idx of indexes) {
    assert.ok(idx.includes('IF NOT EXISTS'), 'CREATE INDEX без IF NOT EXISTS — не идемпотентно');
    assert.ok(!idx.includes('CONCURRENTLY'), 'CONCURRENTLY запрещён внутри транзакции миграции');
    assert.ok(/\(tenant_id, point_id/.test(idx), 'point_id обязан идти сразу после tenant_id');
  }

  // Keyset-журнал филиала обязан повторять порядок сортировки 139.
  assert.ok(
    /idx_checks_tenant_point_date_created_id[\s\S]*date DESC, created_at DESC, id DESC/.test(migration),
    'нет keyset-индекса под курсорный журнал филиала',
  );
});

// ── 8. Явная точка офлайн-очереди принимается только по доступу ─────────────

test('явный pointId из офлайн-очереди проверяется на доступ автора', () => {
  const start = checksService.indexOf('const requestedPointId =');
  assert.ok(start > 0, 'приём явной точки из офлайн-очереди пропал');
  const block = checksService.slice(start, start + 1400);
  assert.ok(/UUID_RE\.test\(requestedPointId\)/.test(block), 'форма uuid не проверяется — 22P02 → 500 на досылке');
  assert.ok(/tenant_id = \$2/.test(block), 'чужой тенант не отсекается');
  assert.ok(/is_active = true/.test(block), 'архивная точка принимается');
  assert.ok(/user_points/.test(block), 'доступ автора к точке не проверяется');
  // Отказ должен быть МОЛЧАЛИВЫМ: 400 подвесил бы чек в очереди навсегда.
  assert.ok(
    !/throw new (BadRequest|Forbidden|NotFound)Exception/.test(block),
    'непрошедшая проверку точка обязана молча игнорироваться, а не ронять досылку',
  );
});
