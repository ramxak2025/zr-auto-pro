const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * «НИ ОДНОЙ ДЕНЕЖНОЙ ЗАПИСИ БЕЗ ФИЛИАЛА» (волна 4, переписана под 163).
 *
 * ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ — не стиль, а деньги. Денежная строка с point_id = NULL
 * не видна НИ ОДНОМУ филиалу (срезы фильтруют строгим равенством):
 *   • чек выпадал из журнала филиала, его Z-отчёта и карточки «Филиалы»;
 *   • выплата не вычиталась из «к выплате» ни в одном филиале — и владелец,
 *     глядя на филиальный экран, выдавал зарплату ВТОРОЙ РАЗ.
 *
 * ЧТО ИЗМЕНИЛОСЬ В 163. Раньше такие строки рождал режим «все филиалы» —
 * сессия без филиала, — и лечил их резолв на месте
 * (point-scope.resolvePointForWrite: своя точка → единственная доступная →
 * 400 «Выберите филиал»). Теперь филиал выбирается ПРИ ВХОДЕ и живёт в токене,
 * поэтому сессии без филиала на тенанте с филиалами не существует, резолв
 * удалён, а инвариант остался прежним и охраняется здесь же — только теперь
 * проверяется, что денежные пути штампуют ФИЛИАЛ СЕССИИ и ничего не резолвят
 * сами (второй копии правила быть не должно).
 *
 * Инварианты теста:
 *   1. Денежные пути берут филиал из сессии, а не резолвят его сами.
 *   2. Денежные INSERT штампуются этим филиалом, а не «чем попало».
 *   3. Филиал офлайн-очереди применяется РАНЬШЕ филиала сессии.
 *   4. Снятие с филиала обесточивает сессию сотрудника в нём.
 *   5. Лист зарплаты филиала не теряет мастера, подменявшего на другой точке.
 *   6. Пуш про инкассацию уходит кассирам ФИЛИАЛА СМЕНЫ, а не всей сети.
 *
 * Тест статический (читает исходники) + поведенческий на собранном dist с
 * фейковым пулом: живой БД в CI нет. Конвенция — points-scoping.
 * Сам двухшаговый вход и обесточивание сессий — points-session-login.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const pointScope = read('src/common/point-scope.ts');
const points = read('src/points/points.service.ts');
const salary = read('src/salary/salary.service.ts');
const checks = read('src/checks/checks.service.ts');
const expenses = read('src/expenses/expenses.service.ts');
const cashShifts = read('src/cash-shifts/cash-shifts.service.ts');

// ── 1. Филиал денежной записи = филиал СЕССИИ ───────────────────────────────

test('денежные пути берут филиал из сессии и не резолвят его сами', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const [name, src] of [
    ['чек', checks],
    ['ручной расход', expenses],
    ['кассовая смена', cashShifts],
    ['зарплата', salary],
  ]) {
    const code = strip(src);
    assert.ok(
      !/resolvePointForWrite/.test(code),
      `${name}: денежный путь снова резолвит филиал сам — при филиале в сессии это вторая копия правила`,
    );
    assert.ok(
      !/Выберите филиал/.test(code),
      `${name}: отказ «Выберите филиал» вернулся — спрашивать нечего, филиал выбран при входе`,
    );
  }
  assert.ok(
    /const pointId = actorPointId\(actor\);/.test(expenses),
    'expenses.create обязан штамповать расход филиалом сессии автора',
  );
  assert.ok(
    /const pointId = actorPointId\(user\);/.test(cashShifts),
    'кассовая смена обязана открываться в филиале сессии кассира',
  );
  assert.ok(
    /let authorPointId: string \| null = actorPointId\(actor\);/.test(checks),
    'чек обязан штамповаться филиалом сессии автора',
  );
});

test('филиал денежной записи НЕ читается из users.current_point_id', () => {
  for (const [name, src] of [
    ['чек', checks],
    ['расход', expenses],
    ['зарплата', salary],
    ['кассовая смена', cashShifts],
  ]) {
    assert.ok(
      !/current_point_id/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
      `${name}: колонка «последнего выбранного филиала» одна на все устройства человека — читать её здесь значит писать деньги в филиал ДРУГОЙ его сессии`,
    );
  }
});

test('денежные INSERT штампуются филиалом, а не пустотой', () => {
  // Ни одна из этих строк не имеет права уехать в базу без филиала: каждая —
  // деньги, и каждая без филиала выпадает из всех филиальных срезов сразу.
  for (const marker of [
    '[tenantID, dto.employeeId, type, amount, comment, createdBy, periodMonth, pointId]',
    '[tenantID, dto.userId, amount, comment, dto.date ?? null, createdBy, pointId]',
    '[categoryId, dto.amount, description, payment.date, createdBy, tenantID, pointId]',
    'pointId: pointId,',
  ]) {
    assert.ok(salary.includes(marker), `salary: денежная строка пишется без филиала — ${marker}`);
  }
});

test('филиал офлайн-очереди проверяется общим предикатом и ДО транзакции', () => {
  const create = checks.slice(checks.indexOf('let authorPointId: string | null = actorPointId(actor);'));
  const check = create.indexOf('autexa_point_is_allowed');
  const connect = create.indexOf('await this.pool.connect()');
  assert.ok(check > 0, 'филиал из payload офлайн-очереди снова проверяется собственной копией предиката доступа');
  assert.ok(connect > check, 'проверка обязана идти до pool.connect(): вторая коннекция под первой = дедлок');
  assert.ok(
    create.indexOf('if (allowed[0]?.ok === true) authorPointId = requestedPointId;') < connect,
    'проверенный филиал офлайн-очереди обязан применяться до записи, иначе выручка уедет в филиал досылки',
  );
});

// ── 3–4. Филиал выдаётся входом; снятие доступа обесточивает сессию ────────

test('филиал не подставляется на чтении и не переключается на лету', () => {
  const list = points.slice(points.indexOf('async listForTenant('), points.indexOf('async switchPoint('));
  assert.ok(
    !/UPDATE users/.test(list),
    'GET /points снова пишет филиал пользователю: два устройства одного человека начнут перетягивать его друг у друга',
  );
  assert.ok(/currentPointId: actorPointId\(user\)/.test(list), 'отдавать нужно филиал ЭТОЙ сессии, а не колонку users');
  // 165: ручка смены филиала жива ради сборок 3.5/3.6, но НЕ переключает
  // сессию — она пишет подсказку следующего входа и возвращает филиал ЭТОЙ
  // сессии. Филиал живёт в подписанном токене, и «переключение» на лету
  // сработало бы только в UI: человек видит филиал Б, а чеки уходят в А.
  const switchBody = points.slice(points.indexOf('async switchPoint('), points.indexOf('applyMembership'));
  assert.ok(
    /return \{ currentPointId: actorPointId\(user\) \}/.test(switchBody),
    'ручка смены филиала снова переключает сессию — филиал лежит в подписанном токене',
  );
  assert.ok(
    /UPDATE users SET current_point_id=/.test(switchBody),
    'подсказка следующего входа не пишется — старый клиент заперт в одном филиале навсегда',
  );
});

test('снятие доступа обесточивает сессии сотрудника, а не правит колонку', () => {
  const body = points.slice(points.indexOf('private async applyMembership('), points.indexOf('async setMembers('));
  assert.ok(
    /SELECT user_id FROM user_points WHERE point_id=\$1 AND tenant_id=\$2/.test(body),
    'состав ДО замены не читается — затронутых вычислить не из чего',
  );
  assert.ok(
    // \s* без обязательного \n: prettier в pre-commit складывает это выражение то в
    // одну строку, то в две — проверка смысла не должна зависеть от переноса.
    /before\.filter\(\(id\) => !after\.includes\(id\)\),\s*\.\.\.after\.filter\(\(id\) => !before\.includes\(id\)\)/.test(
      body,
    ),
    'сбрасывать кеш надо и снятым, и ДОБАВЛЕННЫМ: первое же назначение запирает сотрудника без назначений в одном филиале',
  );
  const commitAt = body.indexOf("await client.query('COMMIT')");
  assert.ok(
    commitAt > 0 && body.indexOf('for (const id of affected) invalidateAuthUser(id);') > commitAt,
    'кеш чистится только ПОСЛЕ коммита — откат не должен оставлять пустой кеш при неизменённых назначениях',
  );
  assert.ok(
    /setUserPoints\(tenantID: string, userID: string, pointIds: string\[\]\)/.test(points) &&
      /applyMembership\(tenantID, \{ userID, pointIds: clean \}\)/.test(points),
    'настройка доступа со стороны карточки сотрудника обязана идти тем же путём, что и со стороны филиала',
  );
});

// ── 5. Зарплатный лист филиала не теряет подменявшего мастера ───────────────

test('состав листа филиала = денежные строки филиала ИЛИ назначение на него', () => {
  assert.ok(/touched AS \(/.test(salary), 'salary.getAll: нет предиката «есть денежные строки этого филиала»');
  const cteStart = salary.indexOf('touched AS (');
  const cte = salary.slice(cteStart, salary.indexOf('memberWhere =', cteStart));
  for (const [what, table] of [
    ['начисления по услугам', 'FROM svc'],
    ['начисления по товарам', 'FROM prod'],
    ['легаси-выплаты', 'FROM salary_payments sp'],
    ['премии', 'FROM salary_premiums pr'],
    ['штрафы', 'FROM salary_penalties pen'],
    ['принятые выплаты', 'FROM salary_payouts p'],
    ['мотивация', 'FROM motivation_accruals ma'],
  ]) {
    assert.ok(cte.includes(table), `touched: ${what} не учитываются — сотрудник с такой строкой выпадет из листа`);
  }
  assert.ok(
    /EXISTS \(SELECT 1 FROM touched t WHERE t\.user_id = u\.id\)/.test(salary) &&
      /assignedToPointSql\('ua', '\$1', pointId, mainParams\)/.test(salary),
    'оба основания обязаны стоять через OR: только назначения = потеря заработка подменявшего мастера',
  );
  assert.ok(
    /\$\{memberWhere\}\n\s*ORDER BY total_earnings DESC/.test(salary),
    'предикат состава не подставлен в главный запрос',
  );
});

test('АРИФМЕТИКА: заработок подменявшего мастера не исчезает из филиалов', () => {
  // Мастер M назначен на филиал A, но в периоде подменял коллегу на филиале B.
  const rows = [
    { point: 'A', user: 'M', kind: 'earn', amount: 100 },
    { point: 'B', user: 'M', kind: 'earn', amount: 40 },
    { point: 'B', user: 'N', kind: 'earn', amount: 60 },
  ];
  const assignedTo = { M: ['A'], N: ['B'] };

  const sum = (point, user) =>
    rows.filter((r) => (point === null || r.point === point) && r.user === user).reduce((a, r) => a + r.amount, 0);

  /** СТАРЫЙ состав листа: только назначения. */
  const listedOld = (point, user) => assignedTo[user].includes(point);
  /** НОВЫЙ состав: денежные строки филиала ИЛИ назначение. */
  const listedNew = (point, user) => sum(point, user) > 0 || assignedTo[user].includes(point);

  const branchTotal = (listed, point) =>
    ['M', 'N'].reduce((acc, user) => acc + (listed(point, user) ? sum(point, user) : 0), 0);

  const network = sum(null, 'M') + sum(null, 'N');
  assert.equal(network, 200, 'сетевой заработок: 100 (M на A) + 40 (M на B) + 60 (N на B)');

  // Старое поведение: 40 ₽ мастера M, заработанные на филиале B, не попадали
  // НИ В ОДИН лист — ни в B (не назначен), ни в A (там нет чеков B).
  assert.equal(branchTotal(listedOld, 'A') + branchTotal(listedOld, 'B'), 160);
  assert.notEqual(branchTotal(listedOld, 'A') + branchTotal(listedOld, 'B'), network);

  // Новое поведение: сумма по филиалам сходится с сетевой до копейки.
  assert.equal(branchTotal(listedNew, 'A'), 100);
  assert.equal(branchTotal(listedNew, 'B'), 100);
  assert.equal(
    branchTotal(listedNew, 'A') + branchTotal(listedNew, 'B'),
    network,
    'ИНВАРИАНТ: деньги не исчезают и не двоятся — сумма филиалов равна сетевой',
  );
});

test('в режиме «Все точки» запрос зарплатного листа остаётся прежним дословно', () => {
  assert.ok(
    /let touchedCte = '';\s*\n\s*let memberWhere = '';\s*\n\s*if \(pointId\) \{/.test(salary),
    'фрагменты обязаны быть пустыми без выбранной точки — иначе сетевой лист потеряет команду с нулями',
  );
});

// ── 6. Пуш про инкассацию — кассирам филиала смены ─────────────────────────

test('инкассация из кассы уведомляет кассиров ФИЛИАЛА СМЕНЫ', () => {
  assert.ok(
    /private async getCashierUserIds\(tenantID: string, pointId: string \| null = null\)/.test(cashShifts),
    'получатели не умеют резаться филиалом',
  );
  assert.equal(
    (cashShifts.match(/assignedToPointSql\('u', '\$1', pointId, params\)/g) ?? []).length,
    2,
    'фильтр обязан стоять в ОБЕИХ ветках (allowlist владельца и матрица ролей), иначе дыра остаётся в одной',
  );
  assert.ok(
    /this\.getCashierUserIds\(actor\.tenantID, pointId\)/.test(cashShifts),
    'fireCollectionPush не передаёт филиал события',
  );
  // Филиал берётся У СМЕНЫ: инкассировать может владелец из другого филиала.
  assert.ok(
    /SELECT status, point_id FROM cash_shifts WHERE id = \$1 AND tenant_id = \$2/.test(cashShifts),
    'точка смены не читается — филиал события взять неоткуда',
  );
  assert.ok(
    /shiftPointId = \(rows\[0\]\.point_id as string \| null\) \?\? null;/.test(cashShifts) &&
      /fireCollectionPush\(user, round2\(num\(dto\.amount\)\), 'кассы', report\.expectedAmount, shiftPointId\)/.test(
        cashShifts,
      ),
    'пуш про остаток ящика филиала А уходит кассирам всей сети',
  );
  // Сейф один на компанию — его инкассация остаётся тенантной сознательно.
  assert.ok(
    /fireCollectionPush\(user, amount, 'сейфа', state\.balance\)/.test(cashShifts),
    'сейф общий: сужать его получателей филиалом было бы неверно',
  );
});
