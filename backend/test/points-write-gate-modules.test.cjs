const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ФИЛИАЛЫ, ОСТАТОК РЕВИЗИИ: ПУТИ, ОБХОДИВШИЕ ОБЩИЙ ГЕЙТ.
 *
 * points-write-gate охраняет ядро правила («ни одной денежной записи без
 * филиала») на чеке, ручном расходе, зарплате и кассовой смене. Ревизия нашла
 * ТРИ класса остатков — они и охраняются здесь:
 *
 *   1. ЧЕТЫРЕ ПУТИ СОЗДАНИЯ РАСХОДА мимо ExpensesService.create: списание со
 *      склада (две ручки — POST /stock-movements и POST /products/:id/stock) и
 *      покупка имущества (create/update storage item). Туда приезжала СЫРАЯ
 *      точка актора: в режиме «Все точки» расход рождался с point_id = NULL и
 *      не попадал НИ В ОДИН филиальный срез — ни в «Движение денег», ни в
 *      прибыль, ни в наличный расход окна кассовой смены.
 *
 *   2. РАБОЧАЯ СМЕНА. Штамповалась сырой точкой: смена без филиала не
 *      попадала ни в ленту смен филиала, ни в счётчик «мастеров на работе» —
 *      человек на работе, а карточка филиала показывает ноль.
 *
 *   3. АСИММЕТРИЯ «ЧИТАЕМ УЗКО — ПИШЕМ ШИРОКО» в зарплате и расходах.
 *      Мутации адресуются по id и фильтра филиала не имели: держатель права
 *      из филиала А отменял выплату филиала Б (там «к выплате» отрастало
 *      обратно, и человеку выдавали зарплату второй раз), удалял его премию,
 *      правил штраф, утверждал чужой расход. У чеков это правило появилось
 *      первым; здесь охраняется, что оно ОДНО на всех, а не третья копия.
 *
 * Тест статический (читает исходники) + поведенческий на собранном dist с
 * фейковым пулом: живой БД в CI нет. Конвенция — points-write-gate.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const stockMovements = read('src/stock-movements/stock-movements.service.ts');
const products = read('src/products/products.service.ts');
const equipment = read('src/equipment/equipment.service.ts');
const equipmentController = read('src/equipment/equipment.controller.ts');
const shifts = read('src/shifts/shifts.service.ts');
const salary = read('src/salary/salary.service.ts');
const salaryController = read('src/salary/salary.controller.ts');
const expenses = read('src/expenses/expenses.service.ts');
const expensesController = read('src/expenses/expenses.controller.ts');
const checks = read('src/checks/checks.service.ts');

const { assertRowPointForWrite } = require('../dist/common/point-scope');
const { EquipmentService } = require('../dist/equipment/equipment.service');

function fakeDb(rowsFor = () => []) {
  const calls = [];
  const run = async (text, params) => {
    calls.push({ text, params });
    return { rows: rowsFor(text, params) ?? [] };
  };
  return {
    calls,
    query: run,
    connect: async () => ({ query: run, release() {} }),
  };
}

/** Индекс первого вхождения либо -1; тело метода от маркера до маркера. */
const bodyBetween = (src, from, to) => {
  const start = src.indexOf(from);
  assert.ok(start > 0, `не найден фрагмент ${from}`);
  const end = to ? src.indexOf(to, start) : src.length;
  assert.ok(end > start, `не найден конец фрагмента ${from}`);
  return src.slice(start, end);
};

// ── 1. Четыре пути создания расхода ─────────────────────────────────────────

test('списание со склада (обе ручки) резолвит филиал зеркального расхода', () => {
  for (const [name, src, body] of [
    ['stock-movements', stockMovements, bodyBetween(stockMovements, '  async create(tenantID: string', 'BEGIN')],
    ['products/:id/stock', products, bodyBetween(products, '  async updateStock(id: string', 'BEGIN')],
  ]) {
    assert.ok(
      /resolvePointForWrite\(/.test(body),
      `${name}: расход списания снова штампуется сырой точкой актора и пропадает из всех филиалов`,
    );
    assert.ok(/'чтобы списать товар'/.test(body), `${name}: у гейта нет осмысленного текста цели`);
    // Резолв ДО pool.connect(): вторая коннекция под открытой транзакцией на
    // исчерпанном пуле = взаимная блокировка.
    const gate = body.indexOf('resolvePointForWrite');
    const connect = body.indexOf('await this.pool.connect()');
    assert.ok(gate > 0 && connect > gate, `${name}: резолв уехал за pool.connect() — риск взаимной блокировки`);
    // Гейт узкий НАМЕРЕННО: склад общий на сеть, и требовать филиал под
    // инвентаризацию/приход значило бы ловить 400 там, где денег нет.
    assert.ok(
      /'writeoff'/.test(body) && /recordAsExpense/.test(body),
      `${name}: резолв должен включаться только для списания, записываемого расходом`,
    );
    assert.ok(
      /writePointId/.test(src),
      `${name}: INSERT расхода обязан брать РЕЗОЛВНУТУЮ точку, а не исходный параметр`,
    );
  }
  assert.ok(
    /\[categoryId, amount, dto\.reason \?\? 'Списание со склада', userID, tenantID, pointId\]/.test(stockMovements) ===
      false,
    'stock-movements: расход списания снова пишется сырой точкой',
  );
});

test('покупка имущества резолвит филиал в обоих путях', () => {
  const create = bodyBetween(equipment, '  async createStorageItem(', 'private async getOrCreateEquipmentCategory(');
  assert.ok(/resolvePointForWrite\(/.test(create) && /'чтобы записать покупку имущества'/.test(create));
  assert.ok(
    create.indexOf('resolvePointForWrite') < create.indexOf('await this.pool.connect()'),
    'createStorageItem: резолв обязан идти до pool.connect()',
  );
  assert.ok(
    /purchasePrice > 0\s*\n?\s*\?/.test(create),
    'бесплатное имущество денег не двигает — требовать под него филиал незачем',
  );
  assert.ok(/item\.id, writePointId\]/.test(create), 'createStorageItem: расход пишется мимо резолва');

  const update = bodyBetween(equipment, '  async updateStorageItem(', '  async removeStorageItem(');
  assert.ok(/resolvePointForWrite\(\s*client,/.test(update), 'updateStorageItem: расход рождается без резолва филиала');
  assert.ok(
    /\[categoryId, expenseAmount, `Покупка имущества: \$\{itemName\}`, tenantId, id, writePointId\]/.test(update),
    'updateStorageItem: INSERT расхода снова берёт сырую точку',
  );
  // Резолв идёт по КЛИЕНТУ ТРАНЗАКЦИИ (второй коннекции из пула не берётся) —
  // иначе пришлось бы снаружи гадать, родится расход или нет, и отвечать 400
  // на безобидную правку цены уже существующего расхода.
  assert.ok(
    !/resolvePointForWrite\(\s*this\.pool,/.test(update),
    'updateStorageItem: резолв по пулу внутри транзакции = взаимная блокировка на исчерпанном пуле',
  );
  assert.ok(
    /updateStorageItem\(\s*id: string,\s*tenantId: string,\s*dto: any,\s*actorId: string \| null/.test(equipment),
    'updateStorageItem: без автора резолв не сможет посчитать ДОСТУПНЫЕ этому человеку точки',
  );
  assert.ok(
    /this\.service\.updateStorageItem\(id, user\.tenantID, dto, user\.userID, actorPointId\(user\)\)/.test(
      equipmentController,
    ),
    'контроллер имущества не передаёт автора в резолв филиала',
  );
});

test('покупка имущества без филиала отвечает 400, а не пишет расход в никуда', async () => {
  const db = fakeDb((text) => (/FROM tenant_points p/.test(text) ? [{ id: 'p-1' }, { id: 'p-2' }] : []));
  const service = new EquipmentService(db);

  await assert.rejects(
    () => service.createStorageItem('t-1', 'u-1', { name: 'Подъёмник', purchasePrice: 100000, quantity: 1 }, null),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.deepEqual(err.getResponse(), { message: 'Выберите филиал, чтобы записать покупку имущества' });
      return true;
    },
  );
  assert.ok(
    !db.calls.some((c) => /INSERT INTO storage_items/.test(c.text)),
    'отказ обязан приходить ДО транзакции: половина операции хуже честного отказа',
  );
});

test('бесплатное имущество филиала не требует', async () => {
  const db = fakeDb((text) => {
    if (/INSERT INTO storage_items/.test(text)) return [{ id: 'i-1', name: 'Ключ' }];
    if (/FROM tenant_points p/.test(text)) return [{ id: 'p-1' }, { id: 'p-2' }];
    return [];
  });
  const service = new EquipmentService(db);

  await service.createStorageItem('t-1', 'u-1', { name: 'Ключ', purchasePrice: 0, quantity: 1 }, null);
  assert.ok(
    !db.calls.some((c) => /FROM tenant_points p/.test(c.text)),
    'резолв не должен вызываться там, где расход не рождается',
  );
});

// ── 2. Рабочая смена ────────────────────────────────────────────────────────

test('рабочая смена открывается с РЕЗОЛВНУТЫМ филиалом', () => {
  const open = bodyBetween(shifts, '  async open(userID: string', 'BEGIN');
  assert.ok(
    /const pointId = await resolvePointForWrite\(/.test(open) && /'чтобы открыть смену'/.test(open),
    'смена снова штампуется сырой точкой: без филиала она выпадает из ленты смен и из счётчика «на работе»',
  );
  assert.ok(
    open.indexOf('resolvePointForWrite') < open.indexOf('await this.pool.connect()'),
    'shifts.open: резолв обязан идти до pool.connect()',
  );
  assert.ok(
    /INSERT INTO shifts \(user_id, date, tenant_id, point_id\) VALUES \(\$1, \$2, \$3, \$4\)/.test(shifts) &&
      /\[userID, today, tenantID, pointId\]/.test(shifts),
    'shifts.open: INSERT пишет не резолвнутую точку',
  );
});

// ── 3. Симметрия «читаем узко — пишем узко» ─────────────────────────────────

test('гейт чужой строки — ОДИН общий предикат, а не копия на модуль', () => {
  assert.ok(
    /export async function assertRowPointForWrite\(/.test(read('src/common/point-scope.ts')),
    'общий гейт записи по филиалу исчез из point-scope',
  );
  // Три потребителя, ноль собственных SQL-копий предиката.
  assert.ok(/return assertRowPointForWrite\(this\.pool, 'checks'/.test(checks), 'чек: гейт пишет свой SQL');
  assert.ok(/return assertRowPointForWrite\(this\.pool, table,/.test(salary), 'зарплата: гейт пишет свой SQL');
  assert.ok(/return assertRowPointForWrite\(this\.pool, 'expenses'/.test(expenses), 'расход: гейт пишет свой SQL');
});

test('все пути изменения зарплатной строки гейтятся филиалом', () => {
  const gated = [
    ['removePremium', "await this.assertOwnPoint('salary_premiums', id, tenantID, pointId, 'Премия не найдена');"],
    ['deletePenalty', "await this.assertOwnPoint('salary_penalties', id, tenantID, pointId, 'Штраф не найден');"],
    ['updatePenalty', "await this.assertOwnPoint('salary_penalties', id, tenantID, pointId, 'Штраф не найден');"],
    ['settlePayout', "await this.assertOwnPoint('salary_payouts', payoutId, tenantID, pointId, 'Выплата не найдена');"],
    ['cancelPayout', "await this.assertOwnPoint('salary_payouts', payoutId, tenantID, pointId, 'Выплата не найдена');"],
    [
      'updatePendingPayout',
      "await this.assertOwnPoint('salary_payouts', payoutId, tenantID, pointId, 'Выплата не найдена');",
    ],
    [
      'reversePayment',
      "await this.assertOwnPoint('salary_payments', paymentId, tenantID, pointId, 'Выплата не найдена');",
    ],
  ];
  for (const [name, marker] of gated) {
    assert.ok(salary.includes(marker), `salary.${name}: чужую денежную строку по-прежнему можно изменить по id`);
  }
  // Штраф и премия гейтятся дважды (удаление + правка) — считаем вхождения,
  // чтобы «переехавший» вызов не выглядел как покрытые оба пути.
  assert.equal(
    (salary.match(/assertOwnPoint\('salary_penalties'/g) ?? []).length,
    2,
    'у штрафа два пути изменения (правка и удаление) — гейт нужен обоим',
  );
  // Гейт ходит по пулу и обязан отработать ДО транзакции.
  for (const [name, from, to] of [
    ['deletePenalty', '  async deletePenalty(', 'BEGIN'],
    ['settlePayout', '  async settlePayout(', 'BEGIN'],
    ['updatePendingPayout', '  async updatePendingPayout(', 'BEGIN'],
    ['updatePenalty', '  async updatePenalty(', 'BEGIN'],
  ]) {
    const body = bodyBetween(salary, from, to);
    assert.ok(
      body.indexOf('assertOwnPoint') > 0 && body.indexOf('assertOwnPoint') < body.indexOf('this.pool.connect()'),
      `salary.${name}: гейт внутри транзакции = вторая коннекция под первой на исчерпанном пуле`,
    );
  }
  // Ретраи по дедлоку (40P01) гейт не переспрашивают: point_id строки неизменяем.
  for (const name of ['cancelPayout', 'reversePayment']) {
    const attempt = bodyBetween(salary, `  private async ${name}Attempt(`, 'BEGIN');
    assert.ok(!/assertOwnPoint/.test(attempt), `salary.${name}: гейт продублирован в ветку авторетрая`);
  }
});

test('контроллер зарплаты доносит точку актора до всех гейтов', () => {
  for (const marker of [
    'this.salaryService.removePremium(id, user.tenantID, point(user))',
    'this.salaryService.deletePenalty(id, user.tenantID, user.userID, point(user))',
    'this.salaryService.updatePenalty(id, user.tenantID, user.userID, dto || {}, point(user))',
    'this.salaryService.settlePayout(id, user.tenantID, user.userID, point(user))',
    'this.salaryService.cancelPayout(id, user.tenantID, user.userID, dto?.reason, point(user))',
    'this.salaryService.updatePendingPayout(id, user.tenantID, user.userID, dto || {}, point(user))',
    'this.salaryService.reversePayment(id, user.tenantID, user.userID, reason, point(user))',
  ]) {
    assert.ok(
      salaryController.includes(marker),
      `salary.controller: гейт есть, но точка до него не доезжает — ${marker}`,
    );
  }
});

test('решение по чужому расходу гейтится филиалом', () => {
  for (const name of ['approve', 'reject']) {
    const body = bodyBetween(expenses, `  async ${name}(id: string, tenantID: string, actor?: JwtPayload)`, 'UPDATE');
    assert.ok(
      /await this\.assertOwnPoint\(id, tenantID, actor\);/.test(body),
      `expenses.${name}: чужой расход по-прежнему можно утвердить/отклонить по id`,
    );
  }
  for (const marker of [
    'this.expensesService.approve(id, user.tenantID, user)',
    'this.expensesService.reject(id, user.tenantID, user)',
  ]) {
    assert.ok(expensesController.includes(marker), `expenses.controller: актор не доезжает до гейта — ${marker}`);
  }
});

// ── 4. Поведение общего гейта ───────────────────────────────────────────────

test('без выбранного филиала гейта нет вовсе — запрос прежний дословно', async () => {
  const db = fakeDb(() => []);
  await assertRowPointForWrite(db, 'salary_payouts', 'row-1', 't-1', null, 'Выплата не найдена');
  assert.equal(db.calls.length, 0, 'одноточечный тенант и режим «Все точки» не должны платить лишним запросом');
});

test('строка чужого филиала не изменяется — 404 тем же текстом', async () => {
  const db = fakeDb(() => []);
  await assert.rejects(
    () => assertRowPointForWrite(db, 'salary_payouts', 'row-1', 't-1', 'p-mine', 'Выплата не найдена'),
    (err) => {
      assert.equal(err.getStatus(), 404, 'существование чужой строки подтверждать нельзя');
      assert.deepEqual(err.getResponse(), { message: 'Выплата не найдена' });
      return true;
    },
  );
  const [call] = db.calls;
  assert.deepEqual(call.params, ['row-1', 't-1', 'p-mine']);
  assert.ok(
    /FROM salary_payouts t WHERE t\.id = \$1 AND t\.tenant_id = \$2 AND t\.point_id = \$3/.test(call.text),
    'предикат гейта разъехался с фильтром чтения — тогда список и мутация будут отвечать по-разному',
  );
  assert.ok(!call.text.includes('p-mine'), 'uuid обязан уходить плейсхолдером, а не склейкой');
});

test('своя строка проходит гейт', async () => {
  const db = fakeDb(() => [{ '?column?': 1 }]);
  await assertRowPointForWrite(db, 'salary_penalties', 'row-1', 't-1', 'p-mine', 'Штраф не найден');
  assert.equal(db.calls.length, 1);
});
