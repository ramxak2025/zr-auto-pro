const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * Филиалы, волна 3 (миграция 161): скоуп остальных модулей + закрытие обходных
 * путей в базе клиентов.
 *
 * ЧТО ОХРАНЯЕТ ЭТОТ ТЕСТ — инварианты, поломка каждого из которых означает
 * НЕВЕРНЫЕ ДЕНЬГИ или утечку чужой базы, а не косметику:
 *
 *   1. Зарплата скоупится ЦЕЛИКОМ. Начисления по филиалу чека И выплаты /
 *      премии / штрафы по своей колонке. Половинчатый скоуп («режем только
 *      начисления») загоняет остаток филиала в минус — проверено арифметикой
 *      ниже, а не на глаз.
 *   2. Кассовая смена — своя у каждого филиала, и Z-отчёт считает по точке
 *      САМОЙ СМЕНЫ, а не по точке читающего.
 *   3. «Одна открытая смена» осталась защитой и для одноточечного тенанта:
 *      NULL в Postgres не конфликтует сам с собой, поэтому уникальный индекс
 *      использует суррогат COALESCE(point_id, нулевой uuid).
 *   4. База клиентов и гараж не обходятся ни одной ручкой: поиск по телефону,
 *      поиск по госномеру, карточка, правки, экспорт, импорт и рассылки
 *      подчиняются ОДНОМУ предикату видимости.
 *   5. Точка в SQL — всегда плейсхолдер.
 *
 * Тест статический (читает исходники) + чистая арифметическая модель: живой БД
 * в CI нет, а именно текст этих мест и формула обязаны оставаться неизменными.
 * Конвенция — points-scoping / salary-payout-double-pay.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const migration = read('migrations/161_points_scoping_modules.sql');
const salary = read('src/salary/salary.service.ts');
const cashShifts = read('src/cash-shifts/cash-shifts.service.ts');
const shifts = read('src/shifts/shifts.service.ts');
const schedule = read('src/schedule/schedule.service.ts');
const expenses = read('src/expenses/expenses.service.ts');
const clients = read('src/clients/clients.service.ts');
const cars = read('src/cars/cars.service.ts');
const imports = read('src/imports/imports.service.ts');
const marketing = read('src/marketing/marketing.service.ts');
const reminder = read('src/marketing/reminder.service.ts');
const points = read('src/points/points.service.ts');
const users = read('src/users/users.service.ts');

// ── 1. Миграция 161 ─────────────────────────────────────────────────────────

test('161 заводит point_id у всех денежных модулей волны', () => {
  for (const table of [
    'shifts',
    'expenses',
    'cash_shifts',
    'salary_payouts',
    'salary_premiums',
    'salary_penalties',
    'salary_payments',
  ]) {
    assert.ok(
      new RegExp(`ALTER TABLE\\s+${table}\\s+ADD COLUMN IF NOT EXISTS point_id UUID`).test(migration),
      `нет идемпотентного ADD COLUMN point_id для ${table}`,
    );
  }
});

test('161 привязывает историю к ОСНОВНОЙ живой точке и идемпотентна', () => {
  const updates = migration.match(/^UPDATE \w+ \w+\n\s+SET point_id[\s\S]*?;/gm) ?? [];
  assert.equal(updates.length, 7, 'ожидалось ровно семь привязок — по одной на таблицу волны');
  for (const stmt of updates) {
    assert.ok(/point_id IS NULL/.test(stmt), 'привязка не ограничена строками без точки — неидемпотентно');
    assert.ok(
      /tp\.is_main AND tp\.is_active/.test(stmt),
      'смены, расходы, касса и зарплата обязаны уходить ОСНОВНОМУ сервису, а не филиалу, открытому позже',
    );
    assert.ok(
      !/DISTINCT ON/.test(stmt) && !/sort_order/.test(stmt),
      '«первой точки» как понятия больше нет: основная ровно одна (uq_tenant_points_one_main)',
    );
  }
});

test('161: индексы идемпотентны, без CONCURRENTLY и с точкой сразу после тенанта', () => {
  // uq_tenant_points_one_main — не филиальный индекс, а гарантия «ровно одна
  // основная точка на тенанта» (проверяется в points-main-service): у неё нет
  // и не должно быть point_id.
  const indexes = (migration.match(/^CREATE (UNIQUE )?INDEX[^;]*;/gm) ?? []).filter(
    (idx) => !idx.includes('uq_tenant_points_one_main'),
  );
  assert.ok(indexes.length >= 8, 'ожидались индексы под смены, расходы, кассу и зарплатные компоненты');
  for (const idx of indexes) {
    assert.ok(idx.includes('IF NOT EXISTS'), 'CREATE INDEX без IF NOT EXISTS — не идемпотентно');
    assert.ok(!idx.includes('CONCURRENTLY'), 'CONCURRENTLY запрещён внутри транзакции миграции');
    assert.ok(/\(tenant_id, (point_id|COALESCE\(point_id)/.test(idx), 'point_id обязан идти сразу после tenant_id');
  }
});

test('161 снимает тенантный уникальный индекс кассовой смены и ставит филиальный', () => {
  // 080 физически запрещал вторую открытую смену у тенанта: филиал Б получал
  // 409 «Смена уже открыта». Редактировать 080 нельзя — снимаем здесь.
  assert.ok(
    /DROP INDEX IF EXISTS uq_cash_shifts_one_open_per_tenant;/.test(migration),
    'старый тенантный индекс не снят — второй филиал не сможет открыть кассу',
  );

  // КРИТИЧНО: суррогат для NULL. Без него одноточечный тенант (point_id всегда
  // NULL) мог бы открыть сколько угодно параллельных смен — NULL не
  // конфликтует сам с собой, и защита из 080 исчезла бы молча.
  const unique = migration.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_one_open_per_point[^;]*;/);
  assert.ok(unique, 'нет нового уникального индекса «одна открытая смена на филиал»');
  assert.ok(
    /COALESCE\(point_id, '00000000-0000-0000-0000-000000000000'::uuid\)/.test(unique[0]),
    'NULL-точка обязана конфликтовать сама с собой через суррогат, иначе одноточечный тенант теряет защиту',
  );
  assert.ok(/WHERE status = 'open'/.test(unique[0]), 'индекс обязан оставаться частичным по открытым сменам');
});

test('161 не заводит точку у сейфа (осознанное решение зафиксировано в файле)', () => {
  assert.ok(
    !/ALTER TABLE\s+safe_transactions/.test(migration),
    'точка у части строк сейфа сделала бы подсуммы по филиалам неверными',
  );
  assert.ok(/safe_transactions \(сейф\)/.test(migration), 'решение по сейфу должно быть объяснено в миграции');
});

// ── 2. Точка уходит параметром во всех новых местах ─────────────────────────

test('ни один сервис волны не склеивает point_id со значением в SQL', () => {
  for (const [name, src] of [
    ['salary.service', salary],
    ['cash-shifts.service', cashShifts],
    ['shifts.service', shifts],
    ['schedule.service', schedule],
    ['expenses.service', expenses],
    ['clients.service', clients],
    ['cars.service', cars],
    ['imports.service', imports],
    ['marketing.service', marketing],
    ['reminder.service', reminder],
    ['users.service', users],
  ]) {
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/point_id\s*=\s*'/.test(code), `${name}: point_id сравнивается со строковым литералом`);
    assert.ok(
      !/point_id\s*=\s*\$\{(?!\w*[Pp]arams\.length|pointPh|ph\b)/.test(code),
      `${name}: point_id склеен через интерполяцию`,
    );
  }
});

// ── 3. Зарплата: скоуп ПОЛНЫЙ, иначе остаток уходит в минус ────────────────

test('getAll скоупит и начисления (точка чека), и выплаты/премии/штрафы (своя точка)', () => {
  // Начисления — по чеку.
  assert.ok(
    /checkPoint = ` AND ch\.point_id = \$\$\{mainParams\.length\}`/.test(salary),
    'salary.getAll: начисления не режутся точкой чека',
  );
  const svcCte = salary.slice(salary.indexOf('WITH svc AS ('), salary.indexOf('SELECT u.id as master_id'));
  assert.equal(
    (svcCte.match(/\$\{checkPoint\}/g) ?? []).length,
    2,
    'точка чека обязана стоять в ОБОИХ CTE (услуги и товары), иначе половина начислений уедет',
  );

  // Выплаты / премии / штрафы / легаси-выплаты — по собственной колонке.
  for (const [what, marker] of [
    ['legacy payments', "pointFilterSql('sp', pointId, paymentParams)"],
    ['premiums', "pointFilterSql('sp', pointId, premiumParams)"],
    ['penalties', "pointFilterSql('pen', pointId, penaltyParams)"],
    ['payouts', "pointFilterSql('p', pointId, payoutParams)"],
  ]) {
    assert.ok(salary.includes(marker), `salary.getAll: ${what} не режутся филиалом — остаток филиала станет неверным`);
  }

  // Мотивация своей точки не имеет — берётся у чека, к которому привязана.
  assert.ok(
    /EXISTS \(SELECT 1 FROM checks ch WHERE ch\.id = ma\.check_id/.test(salary),
    'salary: мотивация не режется точкой чека',
  );
});

test('карточка месяца скоупится тем же полным набором, что и список', () => {
  for (const marker of [
    "pointFilterSql(null, pointId, earnParams)", // товарные начисления
    "pointFilterSql('ch', pointId, svcParams)", // начисления по услугам
    "pointFilterSql('sp', pointId, premParams)", // премии
    "pointFilterSql('pen', pointId, fineParams)", // штрафы
    "pointFilterSql('p', pointId, payoutParams)", // выплаты
    "pointFilterSql('sp', pointId, legacyParams)", // легаси-выплаты
  ]) {
    assert.ok(salary.includes(marker), `getEmployeeMonth: пропущен скоуп — ${marker}`);
  }
});

test('АРИФМЕТИКА: сумма остатков по филиалам равна сетевому остатку', () => {
  // Формула сервиса: remaining = (начислено + премии + мотивация) − выплачено − штрафы.
  const rows = [
    { point: 'A', kind: 'earn', amount: 100 },
    { point: 'B', kind: 'earn', amount: 60 },
    { point: 'A', kind: 'premium', amount: 10 },
    { point: 'B', kind: 'premium', amount: 5 },
    { point: 'A', kind: 'penalty', amount: 3 },
    { point: 'B', kind: 'penalty', amount: 1 },
    { point: 'A', kind: 'payout', amount: 70 },
    { point: 'B', kind: 'payout', amount: 40 },
  ];
  const sum = (point, kind) =>
    rows.filter((r) => (point === null || r.point === point) && r.kind === kind).reduce((a, r) => a + r.amount, 0);

  /** ПОЛНЫЙ скоуп — как сделано в сервисе. */
  const remainingFull = (point) =>
    sum(point, 'earn') + sum(point, 'premium') - sum(point, 'payout') - sum(point, 'penalty');

  /** ПОЛОВИНЧАТЫЙ скоуп — режем только начисления (ошибка, от которой страхуемся). */
  const remainingHalf = (point) =>
    sum(point, 'earn') + sum(point, 'premium') - sum(null, 'payout') - sum(null, 'penalty');

  const network = remainingFull(null);
  assert.equal(network, 61, 'сетевой остаток: (160 начислено + 15 премий) − 110 выплачено − 4 штрафа');
  assert.equal(remainingFull('A'), 37, 'филиал А: (100 + 10) − 70 − 3');
  assert.equal(remainingFull('B'), 24, 'филиал Б: (60 + 5) − 40 − 1');
  assert.equal(
    remainingFull('A') + remainingFull('B'),
    network,
    'ИНВАРИАНТ: деньги не исчезают и не двоятся — сумма филиалов равна сетевому остатку',
  );

  // И тот же расчёт при половинчатом скоупе — доказательство, что «скоупим
  // только начисления» ломает деньги, а не просто выглядит неаккуратно.
  assert.equal(remainingHalf('A'), -4, 'половинчатый скоуп загоняет филиал А в минус');
  assert.equal(remainingHalf('B'), -49, 'половинчатый скоуп загоняет филиал Б в минус');
  assert.notEqual(remainingHalf('A') + remainingHalf('B'), network);
});

test('выплата и её зеркальный расход всегда получают ОДНУ точку', () => {
  // createPayout — точка владельца в обе строки.
  assert.ok(
    /VALUES \(\$1, \$2, \$3, \$4, 'accepted', \$5, \$6, \$7, now\(\), \$8\)/.test(salary),
    'createPayout не штампует point_id у выплаты',
  );
  // decide / settle — точка БЕРЁТСЯ У ВЫПЛАТЫ (решение принимает получатель,
  // фиксировать может третий человек — их филиал к источнику денег не относится).
  assert.equal(
    (salary.match(/pointId: \(payout\.point_id as string \| null\) \?\? null/g) ?? []).length,
    2,
    'decidePayout и settlePayout обязаны брать филиал у самой выплаты, а не у актора',
  );
});

test('«моя зарплата» филиалом НЕ режется — и это записано как решение', () => {
  const getMy = salary.slice(salary.indexOf('async getMy('), salary.indexOf('async createPayout('));
  assert.ok(!/point_id/.test(getMy), 'getMy: собственный заработок сотрудника не должен падать при смене филиала');
  assert.ok(
    /ФИЛИАЛОМ НЕ РЕЖЕТСЯ, И ЭТО СОЗНАТЕЛЬНО/.test(salary),
    'решение по getMy обязано быть зафиксировано в коде, иначе следующий агент «починит» его обратно',
  );
});

// ── 4. Кассовая смена ──────────────────────────────────────────────────────

test('Z-отчёт считает по точке САМОЙ СМЕНЫ, а не по точке читающего', () => {
  // Регулярка терпит перенос аргументов по строкам: prettier форматирует
  // длинный вызов в столбик, и утверждение про ПОВЕДЕНИЕ не должно падать от
  // расстановки переводов строки.
  assert.ok(
    /computeFigures\(\s*db,\s*tenantID,\s*shiftRow\.id,\s*openedAt,\s*windowEnd,\s*shiftRow\.point_id \?\? null,?\s*\)/.test(
      cashShifts,
    ),
    'assembleReport обязан передавать точку смены — иначе исторический Z-отчёт меняется от того, кто его открыл',
  );
  assert.ok(
    /computeFigures\(client, user\.tenantID, id, openedAt, closedAt, shift\.point_id \?\? null\)/.test(cashShifts),
    'close: расчёт при закрытии обязан идти по точке смены',
  );
  // Все три агрегата окна режутся точкой: продажи, наличные расходы, разбивка
  // по принявшим. Пропуск любого = Z-отчёт филиала считает чужие деньги.
  for (const marker of [
    "pointFilterSql(null, pointId, salesParams)",
    "pointFilterSql(null, pointId, expParams)",
    "pointFilterSql('c', pointId, accParams)",
  ]) {
    assert.ok(cashShifts.includes(marker), `computeFigures: не режется точкой — ${marker}`);
  }
});

test('открыть кассовую смену без филиала нельзя, когда точки у тенанта есть', () => {
  const open = cashShifts.slice(cashShifts.indexOf('async open(user: JwtPayload'), cashShifts.indexOf('async close('));
  // 163: смена открывается в ФИЛИАЛЕ СЕССИИ кассира — он выбран при входе,
  // поэтому «ничьей» смены на тенанте с филиалами не бывает по построению, а
  // прежний резолв с отказом «Выберите филиал» удалён вместе с болезнью.
  // Гарантию «одноточечный тенант ничего не замечает» держит points-write-gate.
  assert.ok(
    /const pointId = actorPointId\(user\);/.test(open),
    '«ничья» смена посчитала бы чеки всей сети и задвоила бы их с Z-отчётом филиала',
  );
  assert.ok(
    /pointFilterSql\(null, pointId, existingParams\)/.test(open),
    '«смена уже открыта» обязана проверяться НА ФИЛИАЛ, иначе второй филиал не откроется',
  );
  assert.ok(
    /pointFilterSql\(null, pointId, lastParams\)/.test(open),
    'размен обязан переноситься внутри филиала',
  );
});

test('сейф остаётся тенантным и это обосновано в коде', () => {
  assert.ok(/СЕЙФ ОСТАЁТСЯ ОДИН НА КОМПАНИЮ/.test(cashShifts), 'решение по сейфу должно быть зафиксировано');
  const safeBalance = cashShifts.slice(cashShifts.indexOf('private async safeBalance('));
  const body = safeBalance.slice(0, safeBalance.indexOf('\n  }'));
  assert.ok(!/point_id/.test(body), 'частичная точка у ленты сейфа сделала бы подсуммы неверными');
});

// ── 5. Смены и график ──────────────────────────────────────────────────────

test('смена штампуется филиалом в момент открытия и режется им в ленте', () => {
  assert.ok(
    /INSERT INTO shifts \(user_id, date, tenant_id, point_id\)/.test(shifts),
    'рабочая смена не штампуется филиалом',
  );
  assert.ok(/pointFilterSql\('s', actorPointId\(actor\), params\)/.test(shifts), 'лента смен не режется филиалом');
});

test('пуш «пришёл/ушёл» уходит только ответственным за ЭТОТ филиал', () => {
  assert.ok(
    /assignedToPointSql\('u', '\$1', pointId, params\)/.test(shifts),
    'адресаты пуша не режутся филиалом — админ каждой точки получал бы уведомления всей сети',
  );
  assert.ok(
    /fullRows\[0\]\.point_id \?\? null,/.test(shifts),
    'при закрытии филиал обязан браться У СМЕНЫ, а не у актора (закрыть может админ другого филиала)',
  );
});

test('график режется назначениями сотрудников, а не колонкой у строки', () => {
  assert.equal(
    (schedule.match(/assignedToPointSql\('u', '\$1', actorPointId\(actor\)/g) ?? []).length,
    2,
    'и сетка месяца, и «кто сейчас на работе» обязаны использовать один предикат назначений',
  );
  assert.ok(
    !/schedule_entries[\s\S]{0,400}point_id/.test(schedule),
    'у строки графика точки быть не должно — источник правды один: user_points',
  );
});

test('сотрудник без назначений виден на всех филиалах (безопасный дефолт 156)', () => {
  const helper = read('src/users/user-points-sql.ts');
  assert.ok(
    /NOT EXISTS \(SELECT 1 FROM user_points up_none/.test(helper),
    'без ветки «назначений нет» внедрение филиалов молча спрячет всю команду',
  );
  assert.ok(/EXISTS \(SELECT 1 FROM user_points up_at/.test(helper));
  assert.ok(!/point_id\s*=\s*'/.test(helper), 'точка обязана уходить параметром');
});

test('сводка филиалов заполняет «мастеров на работе» и различает выключенный учёт', () => {
  assert.ok(/s\.point_id, COUNT\(DISTINCT s\.user_id\)/.test(points), 'сводка не считает смены по точке');
  assert.ok(
    /shiftsEnabled \? \(onShiftByPoint\.get\(id\) \?\? 0\) : null/.test(points),
    'выключенный учёт смен обязан давать null (прочерк), а не 0 («никто не работает»)',
  );
});

// ── 6. Расходы: и чтение, и ВСЕ пути создания ──────────────────────────────

test('расходы режутся филиалом, включая производные строки «Гарантия (убыток)»', () => {
  assert.ok(/where \+= pointFilterSql\('e', pointId, params\);/.test(expenses), 'список расходов не режется филиалом');
  assert.ok(
    /wWhere \+= pointFilterSql\('ch', pointId, wParams\);/.test(expenses),
    'убыток по гарантии — это чек, он обязан резаться точкой чека',
  );
});

test('все восемь путей создания расхода проставляют точку', () => {
  const inserts = [
    ['expenses.create (ручной)', expenses, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10\) RETURNING \*/],
    ['expenses.recordSalaryExpense', expenses, /'owner', 'approved', \$6, \$7, \$8\)\n\s+RETURNING id, amount, date/],
    ['expenses.recordOutsideProgramPayout', expenses, /'owner', 'approved', \$6, \$7, \$8, \$9\)/],
    ['salary.createPayment (легаси)', salary, /INSERT INTO expenses \([^)]*point_id\)\n\s+VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)/],
    ['products.updateStock (списание)', read('src/products/products.service.ts'), /INSERT INTO expenses \([^)]*point_id\)\n\s+VALUES \(\$1, \$2, \$3, now\(\), \$4, \$5, \$6\)/],
    ['stock-movements.applyWriteoff', read('src/stock-movements/stock-movements.service.ts'), /INSERT INTO expenses \([^)]*point_id\)\n\s+VALUES \(\$1,\$2,\$3,now\(\),\$4,\$5,\$6\)/],
    ['equipment.createStorageItem', read('src/equipment/equipment.service.ts'), /storage_item_id, point_id\)\n\s+VALUES \(\$1, \$2, \$3, now\(\), \$4, \$4, 'owner', 'approved', \$5, \$6, \$7\)/],
    ['equipment.updateStorageItem', read('src/equipment/equipment.service.ts'), /storage_item_id, point_id\)\n\s+VALUES \(\$1, \$2, \$3, now\(\), 'owner', 'approved', \$4, \$5, \$6\)/],
  ];
  for (const [name, src, re] of inserts) {
    assert.ok(re.test(src), `${name}: расход создаётся без филиала`);
  }
});

// ── 7. База клиентов и гараж: обходных путей не осталось ───────────────────

test('предикат видимости клиента — ОДИН на все ручки', () => {
  assert.ok(
    /separatePointWhere\(alias: string \| null, point: string \| null, params: unknown\[\]\): string/.test(clients),
    'общий хелпер видимости пропал — копии предиката неизбежно разъедутся',
  );
  // Каждая ручка, через которую раньше можно было достать чужую карточку.
  for (const marker of [
    'findByPhone', // поиск по телефону
    'getById', // карточка по прямой ссылке
    'exportCsv', // выгрузка всей базы одним файлом
  ]) {
    const body = clients.slice(clients.indexOf(`async ${marker}(`), clients.indexOf(`async ${marker}(`) + 2000);
    assert.ok(/separatePointWhere\(/.test(body), `clients.${marker}: обходной путь не закрыт`);
  }
  for (const marker of ['async update(', 'async updateSource(', 'async updateNotes(', 'async remove(']) {
    const body = clients.slice(clients.indexOf(marker), clients.indexOf(marker) + 2200);
    assert.ok(/separatePointWhere\(/.test(body), `clients: мутация ${marker} не проверяет филиал`);
  }
});

test('дубль телефона из чужого филиала не раскрывает карточку', () => {
  const conflict = clients.slice(clients.indexOf('private phoneConflict('));
  assert.ok(/CLIENT_PHONE_EXISTS_OTHER_POINT/.test(conflict), 'нет отдельного нейтрального ответа');
  const otherPointBranch = conflict.slice(0, conflict.indexOf("return new ConflictException({\n      message: 'Клиент с этим номером уже добавлен'"));
  assert.ok(!/fullName/.test(otherPointBranch), 'нейтральный ответ не должен содержать имя чужого клиента');
  assert.ok(!/clientId:/.test(otherPointBranch), 'нейтральный ответ не должен содержать id чужой карточки');
  assert.ok(
    /Попросите владельца перевести клиента/.test(otherPointBranch),
    'текст обязан объяснять, что делать, иначе владелец в тупике',
  );
  // Оба пути дедупа (пре-проверка и гонка на уникальном индексе) обязаны идти
  // через одну сборку ответа.
  assert.ok(/throw this\.phoneConflict\(dupe\[0\], creationPoint\)/.test(clients));
  assert.ok(/return this\.phoneConflict\(rows\[0\], viewerPoint\)/.test(clients));
});

test('гараж режется через владельца тем же предикатом, что база клиентов', () => {
  assert.ok(/private async ownerVisibleSql\(/.test(cars), 'нет общего фрагмента видимости владельца');
  assert.ok(
    /this\.clients\.separatePointFor\(tenantID, actorPoint\)/.test(cars),
    'cars обязан переиспользовать ClientsService, а не заводить вторую копию правила',
  );
  // findByPlate — самая заметная утечка: ФИО и телефон владельца по госномеру.
  const byPlate = cars.slice(cars.indexOf('async findByPlate('), cars.indexOf('private mapCar('));
  assert.ok(/ownerVisibleSql\('ca'/.test(byPlate), 'поиск по госномеру всё ещё отдаёт владельца чужого филиала');
  for (const marker of ['async getAll(', 'async getById(', 'async getChecks(', 'async remove(']) {
    const body = cars.slice(cars.indexOf(marker), cars.indexOf(marker) + 1600);
    assert.ok(/ownerVisibleSql\(/.test(body), `cars: ${marker} не режется филиалом`);
  }
  // Привязка/перенос на клиента чужого филиала запрещены.
  assert.ok(
    /assertClientInTenant\(newClientId, tenantID, actorPoint\)/.test(cars),
    'transferOwner: перенос на клиента чужого филиала уносил бы историю и рассрочку в другой филиал',
  );
});

test('PATCH /cars/:id не даёт перепривязать машину чужого филиала', () => {
  // Последний путь ЗАПИСИ по машине, у которого предиката видимости не было:
  // мастер филиала А мог перевесить чужую машину на СВОЕГО клиента (и увести
  // вместе с ней историю чеков), потому что проверялся только новый владелец.
  const update = cars.slice(cars.indexOf('async update('), cars.indexOf('async remove('));
  assert.ok(update.length > 0, 'cars.update не найден — тест устарел');
  // Сам UPDATE.
  assert.ok(
    /UPDATE cars SET \$\{sets\.join\(', '\)\} WHERE id=\$\$\{idx\+\+\} AND tenant_id=\$\$\{idx\}\$\{ownerWhere\}/.test(
      update,
    ),
    'финальный UPDATE машины не режется предикатом видимости владельца',
  );
  // Предварительная выборка текущего владельца — тем же предикатом: иначе она
  // отдавала бы client_id и госномер машины чужого филиала.
  assert.ok(
    /SELECT client_id, plate_number FROM cars WHERE id=\$1 AND tenant_id=\$2\$\{currentOwnerWhere\}/.test(update),
    'выборка текущего владельца в update не режется филиалом',
  );
  // Оба фрагмента — из ОДНОГО хелпера, а не вторая копия правила, и филиал
  // берётся ОДИН раз на весь метод: два разных значения между запросами
  // означали бы, что проверка дедупа и сам UPDATE режут разные филиалы.
  assert.equal((update.match(/ownerVisibleSqlFor\('cars', viewerPoint/g) || []).length, 2);
  assert.ok(
    /const viewerPoint = await this\.clients\.separatePointFor\(tenantID, actorPoint\)/.test(update),
    'филиал сессии обязан браться один раз на весь update',
  );
});

test('возврат по чеку режется филиалом прямо в локе', () => {
  // Возврат РЕВЕРСИРУЕТ выручку и склад — это запись, и она обязана быть не
  // слабее чтения. Деталь чека читается межфилиально сознательно (история
  // клиента), поэтому id чужого чека узнаваем, и без фильтра в локе мастер
  // филиала А сторнировал бы продажу филиала Б.
  const returns = read('src/returns/returns.service.ts');
  const createReturn = returns.slice(returns.indexOf('async createReturn('), returns.indexOf('async list('));
  assert.ok(createReturn.length > 0, 'returns.createReturn не найден — тест устарел');
  assert.ok(
    /pointFilterSql\(null, actorPointId\(actor\), lockParams\)/.test(createReturn),
    'лок чека в возврате не режется филиалом актора',
  );
  assert.ok(
    /AND deleted_at IS NULL\$\{lockPointFilter\} LIMIT 1 FOR UPDATE/.test(createReturn),
    'фильтр филиала обязан стоять в самом SELECT ... FOR UPDATE, а не отдельным гейтом',
  );
  assert.ok(
    /createReturn\(user\.tenantID, user\.userID, checkId, dto, user\)/.test(read('src/returns/returns.controller.ts')),
    'контроллер не передаёт актора — фильтр филиала окажется пустым',
  );
});

test('история клиента и авто остаётся общей на сеть (исключение не сломано)', () => {
  for (const [name, src] of [
    ['clients.service', clients],
    ['cars.service', cars],
  ]) {
    assert.ok(/ИСКЛЮЧЕНИЕ, НЕ «ЧИНИТЬ»/.test(src), `${name}: предупреждение об исключении пропало`);
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/ch\.point_id/.test(code), `${name}: история фильтруется точкой чека`);
  }
});

// ── 8. Импорт и рассылки ───────────────────────────────────────────────────

test('импорт штампует филиал и не раскрывает карточки чужого филиала', () => {
  assert.ok(
    /INSERT INTO clients \(full_name, phone, comment, tenant_id, point_id\)/.test(imports),
    'импортированный клиент рождается без филиала',
  );
  assert.ok(/blockedPhoneKeys/.test(imports), 'телефоны чужих филиалов должны честно пропускаться, а не переиспользоваться');
  assert.ok(
    /уже занят карточкой другого филиала/.test(imports),
    'пропуск обязан объяснять причину, молчаливое «создано 0» хуже',
  );
  assert.ok(
    /уже привязан к клиенту другого филиала/.test(imports),
    'сообщение о занятом госномере не должно раскрывать ФИО владельца чужого филиала',
  );
});

test('рассылки режутся филиалом отправителя, а фоновая — итерируется по точкам', () => {
  assert.ok(/separatePointWhere\('cl', point, params\)/.test(marketing), 'win-back не режется филиалом');
  assert.ok(
    /this\.clients\.separatePointWhere\('cl', point, params\)/.test(marketing),
    'сегментная рассылка не режется филиалом',
  );
  // Предпросмотр обязан считать РОВНО тот же сегмент, что и отправка.
  assert.ok(/const previewPoint = await this\.segmentPoint\(tenantId, actorPoint\);/.test(marketing));
  // 163 — вниз течёт ФИЛИАЛ СЕССИИ, а не userID: у отправителя рассылки роль
  // автора (createdBy) и роль «чей филиал» разные, и одним полем их не покрыть.
  assert.ok(
    /createdBy\?: string \| null,[\s\S]{0,400}actorPoint\?: string \| null,/.test(marketing),
    'сегментная рассылка снова определяет филиал по автору — при раздельной базе клиентов это чужой сегмент',
  );

  // Фоновая рассылка: строгие непересекающиеся проходы (иначе одному человеку
  // может уйти два сообщения) + отдельный проход по «ничьим».
  assert.ok(/private async sendScheduledForTenant\(/.test(reminder), 'фоновый прогон не итерируется по точкам');
  assert.ok(/kind: 'point', pointId: r\.id as string/.test(reminder));
  assert.ok(/kind: 'orphan'/.test(reminder), 'клиенты без филиала останутся без напоминаний');
  assert.ok(/AND cl\.point_id = \$\$\{params\.length\}/.test(reminder), 'проход по филиалу обязан быть СТРОГИМ');
  assert.ok(/AND cl\.point_id IS NULL/.test(reminder), 'проход по «ничьим» обязан быть строгим и без пересечения');
});

// ── 9. Пикер мастера ───────────────────────────────────────────────────────

test('список сотрудников скоупится ЯВНО, чтобы не сломать резолв имён', () => {
  // Актор нужен списку не только ради филиала: от него же зависит ОБЪЁМ строки
  // (ПДн и деньги — только руководителю кадров и самому сотруднику).
  assert.ok(/async getAll\(actor: JwtPayload, pointId: string \| null = null\)/.test(users));
  assert.ok(/async getMasters\(actor: JwtPayload, pointId: string \| null = null\)/.test(users));
  const controller = read('src/users/users.controller.ts');
  assert.ok(
    /scope === 'point' \? actorPointId\(user\) : null/.test(controller),
    'скоуп обязан включаться параметром запроса, а не менять поведение всех экранов',
  );
});
