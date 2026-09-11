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
 *      покупка имущества (create/update storage item). Каждый обязан штамповать
 *      расход ФИЛИАЛОМ СЕССИИ автора: расход с point_id = NULL не попадает НИ В
 *      ОДИН филиальный срез — ни в «Движение денег», ни в прибыль, ни в
 *      наличный расход окна кассовой смены. (До 163 филиал здесь резолвился на
 *      месте, потому что сессия могла существовать без филиала; теперь филиал
 *      выбирается при входе, и резолва быть не должно — это вторая копия
 *      правила и лишний запрос на каждую денежную строку.)
 *
 *   2. РАБОЧАЯ СМЕНА. Открывается в филиале сессии: смена без филиала не
 *      попадает ни в ленту смен филиала, ни в счётчик «мастеров на работе» —
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

test('списание со склада (обе ручки) штампует расход филиалом сессии', () => {
  for (const [name, src, body] of [
    ['stock-movements', stockMovements, bodyBetween(stockMovements, '  async create(tenantID: string', 'BEGIN')],
    ['products/:id/stock', products, bodyBetween(products, '  async updateStock(id: string', 'BEGIN')],
  ]) {
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(
      !/resolvePointForWrite/.test(code),
      `${name}: филиал снова резолвится на месте — при филиале в сессии это вторая копия правила`,
    );
    assert.ok(!/Выберите филиал/.test(code), `${name}: отказ «Выберите филиал» вернулся`);
    assert.ok(
      /pointId: string \| null/.test(src),
      `${name}: филиал обязан приезжать параметром из контроллера (actorPointId актора)`,
    );
  }
  assert.ok(
    /\[categoryId, amount, dto\.reason \?\? 'Списание со склада', userID, tenantID, expensePointId\]/.test(
      stockMovements,
    ),
    'stock-movements: расход списания пишется без филиала — он выпадет из всех филиальных срезов',
  );
  assert.ok(
    /\[categoryId, amount, reason \?\? 'Списание со склада', userId \|\| null, tenantID, pointId\]/.test(products),
    'products/:id/stock: расход списания пишется без филиала',
  );
});

test('покупка имущества штампуется филиалом сессии в обоих путях', () => {
  const create = bodyBetween(equipment, '  async createStorageItem(', 'private async getOrCreateEquipmentCategory(');
  const update = bodyBetween(equipment, '  async updateStorageItem(', '  async removeStorageItem(');
  for (const [name, body] of [
    ['createStorageItem', create],
    ['updateStorageItem', update],
  ]) {
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/resolvePointForWrite/.test(code), `${name}: филиал снова резолвится на месте`);
    assert.ok(!/Выберите филиал/.test(code), `${name}: отказ «Выберите филиал» вернулся`);
  }
  assert.ok(/item\.id, pointId\]/.test(create), 'createStorageItem: расход пишется без филиала');
  assert.ok(
    /\[categoryId, expenseAmount, `Покупка имущества: \$\{itemName\}`, tenantId, id, pointId\]/.test(update),
    'updateStorageItem: расход пишется без филиала',
  );
  assert.ok(
    /this\.service\.updateStorageItem\(id, user\.tenantID, dto, user\.userID, actorPointId\(user\)\)/.test(
      equipmentController,
    ),
    'контроллер имущества не передаёт филиал сессии — расход уедет в никуда',
  );
});

test('покупка имущества пишет расход в филиал сессии, а не в никуда', async () => {
  const db = fakeDb((text) => {
    if (/INSERT INTO storage_items/.test(text)) return [{ id: 'i-1', name: 'Подъёмник' }];
    if (/FROM expense_categories/.test(text)) return [{ id: 'cat-1' }];
    return [];
  });
  const service = new EquipmentService(db);

  await service.createStorageItem(
    't-1',
    'u-1',
    { name: 'Подъёмник', purchasePrice: 100000, quantity: 1 },
    'p-session',
  );
  const expense = db.calls.find((c) => /INSERT INTO expenses/.test(c.text));
  assert.ok(expense, 'расход за покупку имущества вообще не родился');
  assert.equal(
    expense.params[expense.params.length - 1],
    'p-session',
    'расход обязан лечь в филиал СЕССИИ покупателя: деньги ушли из кассы конкретного автосервиса',
  );
  assert.ok(
    !db.calls.some((c) => /FROM tenant_points p/.test(c.text)),
    'лишний резолв филиала на каждую денежную строку — филиал уже известен из сессии',
  );
});

test('бесплатное имущество расхода не рождает', async () => {
  const db = fakeDb((text) => (/INSERT INTO storage_items/.test(text) ? [{ id: 'i-1', name: 'Ключ' }] : []));
  const service = new EquipmentService(db);

  await service.createStorageItem('t-1', 'u-1', { name: 'Ключ', purchasePrice: 0, quantity: 1 }, 'p-session');
  assert.ok(
    !db.calls.some((c) => /INSERT INTO expenses/.test(c.text)),
    'бесплатное имущество денег не двигает — расход под него не создаётся',
  );
});

// ── 2. Рабочая смена ────────────────────────────────────────────────────────

test('рабочая смена открывается в филиале сессии', () => {
  const open = bodyBetween(shifts, '  async open(userID: string', 'BEGIN');
  assert.ok(
    /const pointId = actorPointId\(actor\);/.test(open),
    'смена обязана штамповаться филиалом сессии: без филиала она выпадает из ленты смен и из счётчика «на работе»',
  );
  assert.ok(
    !/resolvePointForWrite/.test(open.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
    'shifts.open: филиал снова резолвится на месте',
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
