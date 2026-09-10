const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ВОЛНА 4: «НИ ОДНОЙ ДЕНЕЖНОЙ ЗАПИСИ БЕЗ ФИЛИАЛА».
 *
 * ЧТО ЗДЕСЬ ОХРАНЯЕТСЯ — не стиль, а деньги. Чтение в режиме «Все точки»
 * фильтра не применяет (владельцу нужна сводка по сети), а ЗАПИСЬ в том же
 * режиме рождала строку с point_id = NULL. Филиальные срезы фильтруют СТРОГИМ
 * равенством, поэтому такую строку не видел НИ ОДИН филиал:
 *   • чек выпадал из журнала филиала, его Z-отчёта и карточки «Филиалы»;
 *   • выплата не вычиталась из «к выплате» ни в одном филиале — и владелец,
 *     глядя на филиальный экран, выдавал зарплату ВТОРОЙ РАЗ.
 *
 * Инварианты теста:
 *   1. Правило живёт в ОДНОМ месте (common/point-scope.resolvePointForWrite),
 *      второй копии логики нет.
 *   2. Резолв ведёт себя ровно как договорено: своя точка → единственная
 *      доступная → 400; у тенанта без точек — NULL (одноточечный автосервис
 *      изменений не замечает).
 *   3. Хелпером пользуются ВСЕ денежные пути: чек, ручной расход, выплата,
 *      премия, штраф, легаси-выплата, внепрограммная выплата, кассовая смена.
 *   4. Пустой скоуп обычного сотрудника больше не означает «видно всё».
 *   5. Снятие с филиала выгоняет из филиала (и из auth-кеша).
 *   6. Лист зарплаты филиала не теряет мастера, подменявшего на другой точке.
 *   7. Пуш про инкассацию уходит кассирам ФИЛИАЛА СМЕНЫ, а не всей сети.
 *
 * Тест статический (читает исходники) + поведенческий на собранном dist с
 * фейковым пулом: живой БД в CI нет. Конвенция — points-scoping.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const pointScope = read('src/common/point-scope.ts');
const points = read('src/points/points.service.ts');
const salary = read('src/salary/salary.service.ts');
const checks = read('src/checks/checks.service.ts');
const expenses = read('src/expenses/expenses.service.ts');
const cashShifts = read('src/cash-shifts/cash-shifts.service.ts');

const { resolvePointForWrite } = require('../dist/common/point-scope');

/** Пул-заглушка: отдаёт заранее заданные строки и считает обращения. */
function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows };
    },
  };
}

// ── 1. Поведение резолва ────────────────────────────────────────────────────

test('своя точка возвращается после проверки, что она ЕЩЁ ЖИВАЯ', async () => {
  const db = fakeDb([{ '?column?': 1 }]);
  const got = await resolvePointForWrite(
    db,
    { tenantID: 't1', userID: 'u1', currentPointId: 'p-1' },
    'чтобы пробить чек',
  );
  assert.equal(got, 'p-1');
  assert.equal(db.calls.length, 1, 'живость точки проверяется ровно одним индексным поиском по PK');
  assert.deepEqual(db.calls[0].params, ['p-1', 't1']);
  assert.ok(/is_active = true/.test(db.calls[0].text), 'проверка живости точки исчезла');
});

test('заархивированная точка актора НЕ становится ответом — резолв идёт дальше', async () => {
  // Первый запрос (живость) отдаёт пусто, второй (доступные точки) — одну.
  const calls = [];
  const db = {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: calls.length === 1 ? [] : [{ id: 'p-live' }] };
    },
  };
  const got = await resolvePointForWrite(
    db,
    { tenantID: 't1', userID: 'u1', currentPointId: 'p-archived' },
    'чтобы пробить чек',
  );
  assert.equal(
    got,
    'p-live',
    'деньги, штампуемые в архивный филиал, не видит ни один живой срез — это та же дыра, что point_id = NULL',
  );
  assert.equal(calls.length, 2);
});

test('у тенанта без живых точек запись остаётся без филиала (одноточечный режим)', async () => {
  const db = fakeDb([]);
  const got = await resolvePointForWrite(db, { tenantID: 't1', userID: 'u1' }, 'чтобы пробить чек');
  assert.equal(got, null, 'одноточечный автосервис не должен заметить волну филиалов вообще');
});

test('единственная доступная точка подставляется молча', async () => {
  const db = fakeDb([{ id: 'p-only' }]);
  const got = await resolvePointForWrite(db, { tenantID: 't1', userID: 'u1', currentPointId: '' }, 'чтобы пробить чек');
  assert.equal(got, 'p-only', 'мастер одного филиала не должен видеть вопроса «какой филиал»');
});

test('доступных несколько — 400 с понятным русским текстом, а не «ничья» запись', async () => {
  const db = fakeDb([{ id: 'p-1' }, { id: 'p-2' }]);
  await assert.rejects(
    () => resolvePointForWrite(db, { tenantID: 't1', userID: 'u1', currentPointId: null }, 'чтобы выдать зарплату'),
    (err) => {
      assert.equal(err.getStatus(), 400, 'форма ошибки обязана совпадать с прежним гейтом кассовой смены');
      assert.deepEqual(err.getResponse(), { message: 'Выберите филиал, чтобы выдать зарплату' });
      return true;
    },
  );
});

test('точка уходит параметром, а не склейкой', async () => {
  const db = fakeDb([{ id: 'p-1' }]);
  await resolvePointForWrite(db, { tenantID: 't1', userID: 'u1' }, 'чтобы записать расход');
  const [call] = db.calls;
  assert.deepEqual(call.params, ['t1', 'u1']);
  assert.ok(!call.text.includes('t1') && !call.text.includes('u1'), 'значения не должны попадать в текст SQL');
  assert.ok(/LIMIT 2/.test(call.text), 'вопрос ровно один: «одна доступная точка или больше»');
});

test('доступность считается той же конвенцией 156, что и на чтении', () => {
  const body = pointScope.slice(pointScope.indexOf('export async function resolvePointForWrite('));
  // Есть назначения на живые точки — только они; нет — все живые точки
  // тенанта. Вторая ветка закрывает «назначен только на архивную точку»:
  // иначе сотрудник не смог бы ни провести чек, ни выбрать филиал.
  assert.ok(/WITH live AS \(/.test(body) && /mine AS \(/.test(body), 'резолв доступных точек переписан мимо конвенции');
  assert.ok(/SELECT \* FROM live WHERE NOT EXISTS \(SELECT 1 FROM mine\)/.test(body), 'нет ветки «назначений нет»');
  assert.ok(/is_active = true/.test(body), 'архивная точка не может быть доступной для записи');
});

// ── 2. Второй копии правила нет ─────────────────────────────────────────────

test('все денежные пути ходят через ОДИН хелпер', () => {
  const paths = [
    ['чек', checks, "resolvePointForWrite(\n        this.pool,"],
    ['ручной расход', expenses, "resolvePointForWrite(this.pool, actor, 'чтобы записать расход')"],
    ['кассовая смена', cashShifts, "resolvePointForWrite(this.pool, user, 'чтобы открыть кассовую смену')"],
  ];
  for (const [name, src, marker] of paths) {
    assert.ok(src.includes(marker), `${name}: денежная запись мимо общего резолва филиала`);
  }
  // Зарплата — пять путей через один приватный враппер writePoint.
  assert.ok(
    /private writePoint\(\s*tenantID: string,\s*actorID: string,\s*pointId: string \| null,\s*purpose: string,\s*\): Promise<string \| null> \{\s*return resolvePointForWrite\(/.test(
      salary,
    ),
    'salary: враппер writePoint обязан просто делегировать в общий резолв',
  );
  for (const [what, marker] of [
    ['выплата', "this.writePoint(tenantID, createdBy, pointId, 'чтобы выдать зарплату')"],
    ['премия', "this.writePoint(tenantID, awardedBy, pointId, 'чтобы начислить премию')"],
    ['штраф', "this.writePoint(tenantID, createdBy, pointId, 'чтобы наложить штраф')"],
    ['внепрограммная выплата', "this.writePoint(tenantID, createdBy, pointId, 'чтобы провести выплату')"],
  ]) {
    assert.ok(salary.includes(marker), `salary: ${what} пишется без резолва филиала`);
  }
  // Выплата ЗП есть в двух путях (новый payout + легаси payment) — оба гейтятся.
  assert.equal(
    (salary.match(/this\.writePoint\(tenantID, createdBy, pointId, 'чтобы выдать зарплату'\)/g) ?? []).length,
    2,
    'легаси-выплата (salary_payments) обязана гейтиться так же, как новая — иначе двойная выдача возвращается',
  );
});

test('денежные INSERT штампуются РЕЗОЛВНУТОЙ точкой, а не сырой точкой актора', () => {
  // Сырой pointId в VALUES = гейт стоит, но не применён — худший из вариантов.
  for (const marker of [
    '[tenantID, dto.employeeId, type, amount, comment, createdBy, periodMonth, writePointId]',
    '[tenantID, dto.userId, amount, comment, dto.date ?? null, createdBy, writePointId]',
    '[categoryId, dto.amount, description, payment.date, createdBy, tenantID, writePointId]',
    'pointId: writePointId,',
  ]) {
    assert.ok(salary.includes(marker), `salary: денежная строка пишется мимо резолва — ${marker}`);
  }
  const create = expenses.slice(
    expenses.indexOf('async create(actor: JwtPayload'),
    expenses.indexOf('private assertOwnPoint('),
  );
  assert.ok(!/actorPointId\(actor\)/.test(create), 'expenses.create снова штампует расход сырой точкой актора');
});

test('гейт чека стоит ДО открытия транзакции и не ломает офлайн-очередь', () => {
  const create = checks.slice(checks.indexOf('let authorPointId: string | null = actorPointId(actor);'));
  const gate = create.indexOf('resolvePointForWrite');
  const connect = create.indexOf('await this.pool.connect()');
  assert.ok(gate > 0 && connect > gate, 'резолв обязан идти до pool.connect(): вторая коннекция под первой = дедлок');
  // Точка из payload офлайн-очереди по-прежнему имеет приоритет над резолвом.
  assert.ok(
    create.indexOf('if (allowed.length > 0) authorPointId = requestedPointId;') < gate,
    'проверенная точка офлайн-очереди обязана применяться РАНЬШЕ резолва, иначе выручка уедет в чужой филиал',
  );
});

// ── 3. Пустой скоуп сотрудника больше не значит «видно всё» ─────────────────

test('сотрудник без назначений получает ПЕРВУЮ доступную точку, а не сеть', () => {
  const body = points.slice(points.indexOf('async listForTenant('), points.indexOf('async switchPoint('));
  assert.ok(
    /const available = assigned\.length > 0 \? assigned : points;/.test(body),
    'назначений нет (или все на архивные точки) — доступны все живые точки тенанта',
  );
  assert.ok(
    /if \(available\.length > 0\) \{/.test(body),
    'подстановка «только когда доступна ровно одна» оставляла мастера с деньгами ВСЕЙ сети',
  );
  assert.ok(/invalidateAuthUser\(user\.userID\)/.test(body), 'подставленная точка обязана сбросить auth-кеш');
  assert.ok(
    /!userHasPermission\(user, 'user_management'\)/.test(body),
    'режим «Все точки» остаётся привилегией владельца/админа — это его осознанный выбор',
  );
});

test('сброс в «Все точки» у сотрудника схлопывается в первую доступную точку', () => {
  const body = points.slice(points.indexOf('async switchPoint('), points.indexOf('private async defaultPointForMember('));
  assert.ok(/const fallback = await this\.defaultPointForMember\(user\);/.test(body));
  const helper = points.slice(points.indexOf('private async defaultPointForMember('));
  assert.ok(
    /ORDER BY is_main DESC, sort_order ASC, lower\(name\) ASC\s*\n\s*LIMIT 1/.test(helper),
    '«первая» точка обязана выбираться детерминированно, и первой обязан идти ОСНОВНОЙ сервис — иначе сотрудник без назначений попадает в случайный филиал',
  );
});

// ── 4. Снятие с филиала выгоняет из филиала ─────────────────────────────────

test('setMembers сбрасывает current_point_id снятым и чистит auth-кеш', () => {
  const body = points.slice(points.indexOf('async setMembers('), points.indexOf('// ── Сводка по филиалам'));
  assert.ok(
    /SELECT user_id FROM user_points WHERE point_id=\$1 AND tenant_id=\$2/.test(body),
    'состав ДО замены не читается — снятых вычислить не из чего',
  );
  assert.ok(
    /UPDATE users SET current_point_id=NULL\s*\n\s*WHERE tenant_id=\$1 AND current_point_id=\$2 AND id = ANY\(\$3::uuid\[\]\)/.test(
      body,
    ),
    'снятый мастер продолжает работать в филиале, из которого его убрали',
  );
  assert.ok(
    /for \(const id of resetUserIds\) invalidateAuthUser\(id\);/.test(body),
    'без сброса auth-кеша снятый сотрудник ещё 30 секунд пишет чеки в чужой филиал',
  );
  const commitAt = body.indexOf("await client.query('COMMIT')");
  assert.ok(
    commitAt > 0 && body.indexOf('for (const id of resetUserIds) invalidateAuthUser(id);') > commitAt,
    'кеш чистится только ПОСЛЕ коммита — откат не должен оставлять пустой кеш при неснятом назначении',
  );
  assert.ok(
    /current_point_id=\$2/.test(body),
    'обнуляем точку только у тех, кто сидит именно в этом филиале — работающих на другой точке не трогаем',
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
