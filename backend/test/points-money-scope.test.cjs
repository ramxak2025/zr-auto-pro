const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Филиалы, волна 5: ОТЧЁТЫ СЧИТАЮТ ДЕНЬГИ ФИЛИАЛА, А ЗАПИСЬ НЕ СЛАБЕЕ ЧТЕНИЯ.
 *
 * ЧТО ОХРАНЯЕТ ЭТОТ ТЕСТ — шесть инвариантов, поломка каждого означает неверные
 * деньги или чужую базу на экране, а не косметику:
 *
 *   1. РАСХОДЫ РЕЖУТСЯ ФИЛИАЛОМ во всех трёх местах отчётов (финотчёт,
 *      dashboard-v2, спарклайн). Выручка фильтровалась, а расходы вычитались
 *      по всей сети — чистая прибыль филиала занижалась на постоянку соседа.
 *   2. ОСТАТОК КАССЫ СЧИТАЕТСЯ ПО СВОЕЙ СМЕНЕ. После 161 открытых смен по
 *      одной на филиал, и «первая попавшаяся» отдавала ящик соседа.
 *   3. ЗАПИСЬ ПО ЧЕКУ ГЕЙТИТСЯ ФИЛИАЛОМ во ВСЕХ путях мутации.
 *   4. ЧТЕНИЕ ДЕТАЛИ ЧЕКА — МЕЖФИЛИАЛЬНОЕ (история клиента общая), и вернуть
 *      туда фильтр значит снова разорвать историю.
 *   5. СНЯТИЕ ФИЛЬТРА ПО ?clientId/?carId — только после проверки видимости, и
 *      предикат берётся из ClientsService, а не переписывается третий раз.
 *   6. «ПРИБЫЛЬ ЗА МЕСЯЦ» НА КАРТОЧКЕ ФИЛИАЛА = чистая прибыль (после
 *      расходов), тем же определением, что netProfitMonth на главной.
 *
 * Тест статический (читает исходники) + чистая арифметическая модель: живой БД
 * в CI нет, а именно текст этих мест и формула обязаны оставаться неизменными.
 * Конвенция — points-scoping / points-scoping-modules.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const reports = read('src/reports/reports.service.ts');
const checks = read('src/checks/checks.service.ts');
const checksModule = read('src/checks/checks.module.ts');
const checksController = read('src/checks/checks.controller.ts');
const points = read('src/points/points.service.ts');

/** Тело метода от его сигнатуры до сигнатуры следующего (грубо, но стабильно). */
const bodyBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  assert.ok(start > 0, `не найден маркер начала: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `не найден маркер конца: ${endMarker}`);
  return src.slice(start, end);
};

// ── 1. Расходы в отчётах режутся филиалом ───────────────────────────────────

test('финотчёт вычитает расходы ТОЛЬКО своего филиала', () => {
  const financial = bodyBetween(reports, 'async getFinancial(', 'async getTagAnalytics(');

  assert.ok(
    /const expParams: any\[\] = \[tenantID, dateFrom, dateTo, tz\];/.test(financial),
    'getFinancial: у запроса расходов нет собственного массива параметров — общий массив с запросом чеков развалит нумерацию обоих',
  );
  assert.ok(
    /pointFilterSql\('e', pointId, expParams\)/.test(financial),
    'getFinancial: расходы не фильтруются по филиалу — netProfit филиала занижается на расходы всей сети',
  );
  assert.ok(
    /<> 'Зарплата'\$\{expPointFilter\}`,\s*\n\s*expParams,/.test(financial),
    'getFinancial: фрагмент фильтра не подставлен в сам SQL расходов либо запрос получает не тот массив параметров',
  );
});

test('dashboard-v2 и спарклайн вычитают расходы ТОЛЬКО своего филиала', () => {
  const dash = bodyBetween(reports, 'private async computeDashboardV2(', 'async clientsNewVsReturning(');

  // Месячные/дневные агрегаты расходов.
  assert.ok(
    /const expenseParams: any\[\] = \[tenantID, todayStart, curYm, prevYm, tz, prevWindowEnd, prevWindowStart\];/.test(
      dash,
    ),
    'computeDashboardV2: фиксированные $1..$7 расходного запроса сдвинулись — все ${effMonth} собраны вокруг $5',
  );
  assert.ok(
    /pointFilterSql\('e', pointId, expenseParams\)/.test(dash),
    'computeDashboardV2: расходы не фильтруются по филиалу — netProfitToday/netProfitMonth филиала врут',
  );
  assert.ok(
    /<> 'Зарплата'\$\{expensePointFilter\}`,\s*\n\s*expenseParams,/.test(dash),
    'computeDashboardV2: фильтр не подставлен в SQL расходов либо запрос получает не тот массив параметров',
  );

  // Спарклайн: у прибыли и у расхода ОДИН И ТОТ ЖЕ филиал и ОДИН плейсхолдер.
  assert.ok(
    /const sparkExpPointFilter = pointId \? ` AND e\.point_id = \$\$\{sparkParams\.length\}` : '';/.test(dash),
    'спарклайн: расходы дня не режутся филиалом либо точка кладётся вторым параметром (Postgres отвергнет лишний, а разные значения = разные филиалы у прибыли и расхода)',
  );
  assert.ok(
    /<> 'Зарплата'\$\{sparkExpPointFilter\}/.test(dash),
    'спарклайн: фрагмент фильтра расходов не подставлен в SQL',
  );
});

test('устаревшие комментарии «у expenses точки ещё нет» убраны', () => {
  // 161 колонку завела, expenses.service по ней фильтрует. Комментарий-обещание
  // «следующая волна» — прямая инструкция следующему агенту НЕ чинить деньги.
  assert.ok(
    !/у expenses точки ещё нет/i.test(reports) && !/у `expenses` колонки точки ЕЩЁ НЕТ/i.test(reports),
    'reports.service: остался устаревший комментарий о том, что у расходов нет точки',
  );
});

// ── 2. Остаток кассы — по СВОЕЙ смене ───────────────────────────────────────

test('getWallets считает ящик своего филиала, а не первой попавшейся смены', () => {
  // Срез берём вместе с докблоком: решение «сейф один на компанию» живёт
  // именно там, и потерять его так же опасно, как потерять сам фильтр.
  const wallets = bodyBetween(reports, '155 — остатки кошельков тенанта.', '//  Owner dashboard v2');

  assert.ok(
    /private async getWallets\(tenantID: string, pointId: string \| null\)/.test(wallets),
    'getWallets: точка не передаётся — остаток снова считается по всей сети',
  );
  assert.ok(
    /pointFilterSql\('cs', pointId, openParams\)/.test(wallets),
    'getWallets: открытая смена выбирается без фильтра филиала (после 161 их по одной на филиал)',
  );
  assert.ok(
    !/ORDER BY opened_at DESC\s*\n\s*LIMIT 1/.test(wallets),
    'getWallets: вернулась «последняя открытая смена тенанта» — это ящик соседнего филиала',
  );

  // Выручка и расходы окна — по точке САМОЙ СМЕНЫ (как Z-отчёт), а не читающего.
  assert.ok(
    /const figPointFilter = pointFilterSql\(null, shiftPoint, figParams\);/.test(wallets),
    'getWallets: окно смены считается не по точке смены — Z-отчёт и «Движение денег» разъедутся',
  );
  assert.ok(
    /FROM checks[\s\S]*?\$\{figPointFilter\}/.test(wallets),
    'getWallets: наличная выручка окна не режется филиалом',
  );
  assert.ok(
    /FROM expenses[\s\S]*?\$\{figPointFilter\}/.test(wallets),
    'getWallets: расходы окна не режутся филиалом',
  );

  // Перенос размена — у последней закрытой смены ТОГО ЖЕ филиала.
  assert.ok(
    /DISTINCT ON \(cs\.point_id\)[\s\S]*?ORDER BY cs\.point_id, cs\.closed_at DESC NULLS LAST/.test(wallets),
    'getWallets: размен переносится не внутри филиала',
  );
  assert.ok(
    /liveSlots\.has\(row\.point_id \?\? null\)/.test(wallets),
    'getWallets: слот с живой сменой получит ЕЩЁ и размен прошлой закрытой — двойной счёт тех же денег',
  );

  // Сейф намеренно общий — и это подписано, чтобы не приняли за забытый фильтр.
  assert.ok(
    /СЕЙФ ОСТАЁТСЯ ОБЩИМ НА КОМПАНИЮ/.test(wallets),
    'getWallets: решение «сейф один на компанию» не подписано в коде',
  );
  assert.ok(
    /FROM safe_transactions\s*\n\s*WHERE tenant_id = \$1`/.test(wallets),
    'getWallets: сейф перестал быть общим на тенанта — подсумма филиала не сойдётся с реальным остатком (см. миграцию 161)',
  );
});

test('«Движение денег» передаёт в кошельки точку АКТОРА', () => {
  assert.ok(
    /this\.getWallets\(tenantID, cashFlowPointId\)/.test(reports),
    'getCashFlow: кошельки считаются без филиала актора',
  );
});

// ── 3. Запись по чеку гейтится филиалом ─────────────────────────────────────

test('все пути мутации чека проходят гейт филиала', () => {
  // Гейт остался единым, но сам предикат уехал в общий модуль
  // (common/point-scope.assertRowPointForWrite) — его теперь переиспользуют
  // зарплата и расходы, и трёх копий одного SQL быть не должно.
  assert.ok(
    /private assertCheckPointForWrite\(id: string, tenantID: string, actor\?: ChecksActor\): Promise<void>/.test(
      checks,
    ),
    'checks.service: пропал единый гейт записи по филиалу',
  );
  assert.ok(
    /return assertRowPointForWrite\(this\.pool, 'checks', id, tenantID, actorPointId\(actor\), 'Заказ-наряд не найден'\)/.test(
      checks,
    ),
    'checks.service: гейт филиала снова пишет собственный SQL вместо общего предиката',
  );

  // Гейт обязан стоять В САМОМ НАЧАЛЕ каждого пути — до ветвлений и до
  // pool.connect(), иначе часть путей уйдёт мимо него.
  const gated = [
    ['setWorkStatus', 'async setWorkStatus(', 'async updateOwnComment('],
    ['updateOwnComment', 'async updateOwnComment(', 'private fireCarReadyNotification('],
    ['update', '  async update(\n    id: string,', '// If services or products are provided'],
    ['acceptPayment', '  async acceptPayment(', 'const sanitized: any = { isDeferred: false };'],
  ];
  for (const [name, from, to] of gated) {
    const body = bodyBetween(checks, from, to);
    assert.ok(
      /await this\.assertCheckPointForWrite\(id, tenantID, actor\);/.test(body),
      `checks.${name}: запись в чек соседнего филиала не закрыта — деталь чека читается межфилиально, значит чужой id доходит сюда штатно`,
    );
  }

  // remove / restore лочат строку — фильтр вшит В САМ ЛОК (проверка и захват
  // одним оператором, без окна гонки).
  const remove = bodyBetween(checks, '  async remove(id: string, tenantID: string, userRole: string', 'private async reverseCheckFootprintTx(');
  assert.ok(
    /pointFilterSql\(null, actorPointId\(actor\), removeParams\)/.test(remove),
    'checks.remove: удаление чужого чека реверсирует склад и деньги соседнего филиала',
  );
  assert.ok(
    /deleted_at IS NULL\$\{removePointFilter\} FOR UPDATE`,\s*\n\s*removeParams,/.test(remove),
    'checks.remove: фильтр филиала не попал в сам лок строки',
  );

  const restore = bodyBetween(checks, '  async restore(id: string', 'async listTrash(');
  assert.ok(
    /pointFilterSql\(null, actorPointId\(actor\), restoreParams\)/.test(restore),
    'checks.restore: восстановление заново списывает склад и возвращает выручку — чужому филиалу это делать нельзя',
  );
  assert.ok(
    /deleted_at IS NOT NULL\$\{restorePointFilter\} FOR UPDATE`,\s*\n\s*restoreParams,/.test(restore),
    'checks.restore: фильтр филиала не попал в сам лок строки',
  );

  // Актор обязан ДОЕХАТЬ до remove — иначе гейт вычисляется по undefined.
  assert.ok(
    /this\.checksService\.remove\(id, user\.tenantID, user\.role, user\.userID, user\)/.test(checksController),
    'checks.controller: актор не передаётся в remove — гейт филиала всегда пустой',
  );
});

test('корзина показывает чеки своего филиала — как и восстановление из неё', () => {
  const trash = bodyBetween(checks, 'async listTrash(', 'async purgeExpiredTrash(');
  assert.ok(
    /pointFilterSql\('ch', actorPointId\(actor\), trashParams\)/.test(trash),
    'listTrash: корзина сетевая при филиальном restore — строка видна и не восстанавливается',
  );
  assert.ok(
    /this\.checksService\.listTrash\(user\.tenantID, user\)/.test(checksController),
    'checks.controller: актор не доезжает до корзины',
  );
});

// ── 4. Чтение детали — межфилиальное ────────────────────────────────────────

test('деталь чека читается между филиалами (история клиента не рвётся)', () => {
  const detail = bodyBetween(checks, 'async getByIdForActor(', 'async getById(');
  assert.ok(
    !/pointFilterSql/.test(detail),
    'getByIdForActor: фильтр филиала вернулся — тап по строке истории клиента снова даст «Заказ-наряд не найден»',
  );
  assert.ok(
    /ЧТЕНИЕ ДЕТАЛИ МЕЖФИЛИАЛЬНОЕ\. НЕ «ЧИНИТЬ»/.test(detail),
    'getByIdForActor: решение не закреплено комментарием — следующий «починит» обратно',
  );
});

// ── 5. Снятие фильтра по клиенту/авто — только после проверки видимости ─────

test('журнал проверяет видимость клиента ДО снятия фильтра филиала', () => {
  const getAll = bodyBetween(checks, 'async getAll(tenantID: string', 'async getByIdForActor(');

  const guard = getAll.indexOf('await this.assertClientHistoryVisible(tenantID, query.clientId, query.carId, actor);');
  const drop = getAll.indexOf('const journalPointId = query.clientId || query.carId ? null : actorPointId(actor);');
  assert.ok(guard > 0, 'checks.getAll: видимость клиента/авто не проверяется — перебор ?clientId отдаёт чужую базу');
  assert.ok(drop > 0, 'checks.getAll: исключение «история клиента/авто» пропало');
  assert.ok(guard < drop, 'checks.getAll: проверка видимости стоит ПОСЛЕ снятия фильтра — она уже ничего не защищает');

  // Предикат берётся из ClientsService, а не переписывается третий раз.
  assert.ok(
    /this\.clients\.separatePointFor\(tenantID, actor\?\.userID\)/.test(checks) &&
      /this\.clients\.separatePointWhere\(null, viewerPoint, params\)/.test(checks),
    'checks.service: видимость клиента считается собственной копией предиката — она разъедется с базой клиентов и гаражом',
  );
  assert.ok(
    !/points_shared_clients/.test(checks.replace(/^\s*(\/\/|\*).*$/gm, '')),
    'checks.service: раздельный режим читается напрямую из tenants — это и есть третья копия правила',
  );
  assert.ok(
    /ClientsModule/.test(checksModule),
    'checks.module: ClientsModule не подключён — обязательная зависимость уронит приложение на старте',
  );

  // Машина скоупится через ВЛАДЕЛЬЦА; машина без владельца видна везде.
  const visible = bodyBetween(checks, 'private async assertClientHistoryVisible(', 'private async applyDeferredActivation(');
  assert.ok(
    /SELECT client_id FROM cars WHERE id = \$1 AND tenant_id = \$2/.test(visible),
    'assertClientHistoryVisible: машина не проверяется через владельца',
  );
  assert.ok(/if \(ownerId\) \{/.test(visible), 'assertClientHistoryVisible: машина без владельца перестала быть общей');
  assert.ok(
    /message: 'Клиент не найден'/.test(visible) && /message: 'Машина не найдена'/.test(visible),
    'assertClientHistoryVisible: невидимый объект обязан быть неотличим от несуществующего (404)',
  );
});

// ── 6. «Прибыль за месяц» у филиала — ЧИСТАЯ ────────────────────────────────

test('карточка филиала показывает прибыль ПОСЛЕ расходов, тем же правилом, что главная', () => {
  const summary = bodyBetween(points, 'private async computeSummary(', '// ── Суперадмин');

  assert.ok(
    /profitMonth: \(parseFloat\(r\.profit_month\) \|\| 0\) - \(expenseByPoint\.get\(r\.id as string\) \?\? 0\)/.test(
      summary,
    ),
    'points.computeSummary: расходы филиала не вычитаются — «Прибыль за месяц» на карточке и на главной снова две разные метрики с одним именем',
  );

  // Определение расхода обязано СОВПАДАТЬ с reports.computeDashboardV2, иначе
  // цифры разойдутся снова, просто на меньшую величину.
  assert.ok(
    /COALESCE\(e\.period_month, to_char\(e\.date AT TIME ZONE \$2::text, 'YYYY-MM'\)\) = \$3/.test(summary),
    'points.computeSummary: отнесение расхода к месяцу не совпадает с dashboard-v2 (period_month, затем месяц даты факта в поясе тенанта)',
  );
  assert.ok(
    /COALESCE\(e\.approval_status, 'approved'\) = 'approved'/.test(summary),
    'points.computeSummary: в прибыль филиала попали неодобренные расходы',
  );
  assert.ok(
    /COALESCE\(ec\.name, ''\) <> 'Зарплата'/.test(summary),
    'points.computeSummary: выплата ЗП вычтена вторым разом — зарплатное начисление уже сидит внутри per-check profit',
  );
  assert.ok(
    /e\.point_id IS NOT NULL/.test(summary),
    'points.computeSummary: «ничей» расход раздаётся каждому филиалу',
  );
});

// ── 7. Арифметика: филиал не платит за соседа ───────────────────────────────

test('МОДЕЛЬ: чистая прибыль филиала не занижается расходами соседнего', () => {
  // Пример из разбора: филиал А — выручка 1 000 000 и расходы 100 000;
  // филиал Б — выручка 800 000 и расходы 400 000. Прибыль по чекам для
  // простоты равна выручке (себестоимость уже внутри неё).
  const A = { checkProfit: 1_000_000, expenses: 100_000 };
  const B = { checkProfit: 800_000, expenses: 400_000 };

  // Как считалось ДО фикса: расходы всей сети вычитались из прибыли филиала.
  const brokenA = A.checkProfit - (A.expenses + B.expenses);
  // Как считается ПОСЛЕ: каждый филиал вычитает только свои.
  const netA = A.checkProfit - A.expenses;
  const netB = B.checkProfit - B.expenses;

  assert.equal(netA, 900_000);
  assert.equal(netB, 400_000);
  assert.equal(netA - brokenA, 400_000, 'занижение среза филиала А ровно на расходы филиала Б');

  // ГЛАВНЫЙ ИНВАРИАНТ: сумма филиальных срезов = сетевой срез. Ни один рубль
  // расхода не потерян и ни один не посчитан дважды.
  const network = A.checkProfit + B.checkProfit - (A.expenses + B.expenses);
  assert.equal(netA + netB, network, 'филиальные срезы не складываются в сетевой — деньги двоятся или исчезают');
});

test('МОДЕЛЬ: ящик в режиме «Все точки» = сумма ящиков филиалов, без двойного счёта', () => {
  // Слот филиала даёт ЛИБО живой expected открытой смены, ЛИБО размен своей
  // последней закрытой — никогда и то, и другое.
  const slotDrawer = (slot) =>
    slot.open
      ? slot.open.opening + slot.open.cashSales - slot.open.cashExpenses - slot.open.collections
      : slot.lastClosedCarryover;

  const A = { open: { opening: 5_000, cashSales: 40_000, cashExpenses: 3_000, collections: 30_000 }, lastClosedCarryover: 5_000 };
  const B = { open: null, lastClosedCarryover: 7_000 };

  assert.equal(slotDrawer(A), 12_000, 'живой expected филиала А посчитан неверно');
  assert.equal(slotDrawer(B), 7_000, 'филиал без открытой смены обязан отдавать размен своей последней закрытой');
  assert.equal(slotDrawer(A) + slotDrawer(B), 19_000, 'сетевой ящик ≠ сумме филиальных');

  // Если бы слот с живой сменой ЕЩЁ и подхватывал свой прошлый размен, те же
  // 5 000 были бы посчитаны дважды — ровно это и стережёт liveSlots.
  assert.notEqual(slotDrawer(A) + A.lastClosedCarryover + slotDrawer(B), 19_000);
});
