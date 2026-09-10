const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ОСНОВНОЙ СЕРВИС ПРОТИВ ФИЛИАЛА — САМАЯ НЕОБРАТИМАЯ ОШИБКА ЭТОГО МОДУЛЯ.
 *
 * ЧТО СКАЗАЛ ВЛАДЕЛЕЦ: «Должен быть основной сервис, он называется ZR AUTO, а
 * филиал ТопГаз — это дополнительно открытый. Это два разных автосервиса
 * одного владельца просто».
 *
 * ЧЕМ ЭТО БЫЛО ОПАСНО. В модели 156 понятия основной точки не было вовсе:
 * tenant_points — плоский список, который заводит суперадмин. Первая редакция
 * миграций 160/161 (и волна 3 в PointsService.adminCreate) привязывала ВСЮ
 * историю тенанта — чеки, клиентов, смены, расходы, кассовые смены,
 * зарплатные строки — к «первой живой точке». У владельца, годами
 * работавшего как ZR AUTO и недавно открывшего ТопГаз, заведена в системе
 * ровно одна точка — ТопГаз. Вся многолетняя история ZR AUTO оказалась бы
 * помечена чужим филиалом, и различить их обратно нечем: до миграции у всех
 * строк точка пустая, признака «чьё это» не существует.
 *
 * ЧТО ПРОВЕРЯЕМ ЗДЕСЬ:
 *   1. схему — признак is_main и гарантию «ровно одна основная на тенанта»;
 *   2. миграции 160/161 — история уходит основной точке, не филиалу, и
 *      повторный прогон ничего не двигает;
 *   3. ремонтную миграцию 162 — переносит только строки, созданные ДО
 *      появления филиала, и ничего больше;
 *   4. adminCreate — тенант с единственной заведённой точкой-филиалом отдаёт
 *      историю ОСНОВНОЙ точке; тенант без точек не затронут;
 *   5. защиту основной точки от архивации и «удаления»;
 *   6. контракт: is_main едет клиенту, основная первая в любом списке.
 *
 * Тест статический (читает исходники и SQL) + поведенческий на собранном dist
 * с фейковым пулом: живой БД в CI нет. Конвенция — points-write-gate.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const points = read('src/points/points.service.ts');
const pointScope = read('src/common/point-scope.ts');
const migration160 = read('migrations/160_points_scoping.sql');
const migration161 = read('migrations/161_points_scoping_modules.sql');
const migration162 = read('migrations/162_points_main_repair.sql');
const sharedTypes = readFileSync(join(backendRoot, '..', 'shared', 'types', 'index.ts'), 'utf8');

const { PointsService } = require('../dist/points/points.service');

/**
 * Пул-заглушка с транзакцией: пишет ВСЕ запросы (и по пулу, и по клиенту) в
 * один журнал, чтобы можно было проверить и состав, и порядок.
 */
function fakePool(rowsFor = () => []) {
  const calls = [];
  const run = async (text, params) => {
    calls.push({ text, params });
    return { rows: rowsFor(text, params) ?? [] };
  };
  return {
    calls,
    released: 0,
    query: run,
    connect: async function () {
      const pool = this;
      return {
        query: run,
        release() {
          pool.released += 1;
        },
      };
    },
  };
}

// Запросы разбора истории: UPDATE <таблица> <алиас> SET point_id = …, всегда
// ограниченные строками без филиала. Основной сервис в них не приезжает
// параметром — его находит подзапрос mp по tp.is_main, ровно как в миграциях.
const bindCalls = (pool) =>
  pool.calls.filter(
    (c) => /^UPDATE \w+ \w+ SET point_id = /.test(flat(c.text)) && /point_id IS NULL/.test(c.text),
  );
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();

// Настоящий uuid: админ-пути архивации проверяют форму id ДО запроса.
const MAIN_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';

// ── 1. Схема: признак основного сервиса и «ровно одна основная» ─────────────

test('160 заводит is_main и физически запрещает две основные точки у тенанта', () => {
  assert.ok(
    /ALTER TABLE tenant_points ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;/.test(migration160),
    'без признака основной точки история снова достанется первой попавшейся',
  );
  const uq = migration160.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_points_one_main[^;]*;/);
  assert.ok(uq, 'нет гарантии «ровно одна основная точка на тенанта»');
  assert.ok(
    /\(tenant_id\)\s*WHERE is_main/.test(uq[0]),
    'индекс обязан быть частичным по (tenant_id) WHERE is_main: две основные снова сделали бы вопрос «чья история» неразрешимым',
  );
  assert.ok(!uq[0].includes('CONCURRENTLY'), 'CONCURRENTLY запрещён внутри транзакции миграции');
});

test('160 создаёт основную точку из названия компании ДО привязки истории', () => {
  const insertAt = migration160.indexOf('INSERT INTO tenant_points');
  const bindAt = migration160.indexOf('UPDATE checks ch');
  assert.ok(insertAt > 0, 'основная точка не заводится — привязывать историю будет не к чему');
  assert.ok(insertAt < bindAt, 'основная точка обязана появиться РАНЬШЕ привязки: иначе история снова уйдёт филиалу');

  const insert = migration160.slice(insertAt, migration160.indexOf(';', insertAt));
  assert.ok(/FROM tenants t/.test(insert), 'имя основной точки обязано браться из tenants.name');
  assert.ok(
    /NOT EXISTS \(SELECT 1 FROM tenant_points m WHERE m\.tenant_id = t\.id AND m\.is_main\)/.test(insert),
    'без NOT EXISTS повторный прогон завёл бы вторую «ZR AUTO»',
  );
  assert.ok(
    /EXISTS \(SELECT 1 FROM tenant_points p WHERE p\.tenant_id = t\.id AND p\.is_active\)/.test(insert),
    'тенанту без точек основная не нужна — иначе ему молча включится мульти-точечный режим',
  );

  // Одноимённую точку помечаем, а не дублируем.
  const mark = migration160.slice(
    migration160.indexOf('UPDATE tenant_points tp'),
    migration160.indexOf(';', migration160.indexOf('UPDATE tenant_points tp')),
  );
  assert.ok(
    /lower\(btrim\(p\.name\)\) = lower\(COALESCE\(NULLIF\(btrim\(t\.name\), ''\), 'Основной'\)\)/.test(mark),
    'точка, названная как компания, обязана становиться основной, а не получать дубль рядом',
  );
});

test('160 привязывает историю чеков и клиентов ИМЕННО к основной точке', () => {
  // Чеки и клиенты — единственные, у кого point_id завела ещё 156: филиальная
  // строка там УЖЕ помечена филиалом, поэтому оставшийся NULL честно означает
  // «строка старше филиалов». Семь денежных таблиц волны 3 так рассуждать не
  // могут — их разбирает лестница доказательств (points-history-attribution).
  const updates = migration160.match(/^UPDATE \w+ \w+\n\s+SET point_id = mp\.point_id[\s\S]*?;/gm) ?? [];
  assert.equal(updates.length, 2, '160 обязана привязывать ровно чеки и клиентов');
  for (const stmt of updates) {
    assert.ok(
      /WHERE tp\.is_main AND tp\.is_active/.test(stmt),
      '160: история уходит не основной точке — деньги двух разных автосервисов схлопнутся в один',
    );
    assert.ok(
      /point_id IS NULL/.test(stmt),
      '160: повторный прогон миграции обязан ничего не двигать (адресуем только строки без филиала)',
    );
  }
});

test('161 НЕ повторяет правило «NULL → основной» для денежных таблиц волны', () => {
  // Зеркальная катастрофа: колонку point_id этим семи таблицам заводит сама
  // 161, поэтому NULL в них стоит и у вчерашней кассы филиала. Слепая привязка
  // увела бы деньги ТопГаза на счёт ZR AUTO.
  for (const table of ['shifts', 'expenses', 'cash_shifts', 'salary_payouts', 'salary_payments']) {
    assert.ok(
      !new RegExp(`UPDATE ${table} \\w+\\n\\s+SET point_id = mp\\.point_id`).test(migration161),
      `${table}: слепое «NULL → основной сервис» отправляет историю филиала чужому автосервису`,
    );
  }
  assert.ok(
    /ATTRIBUTION-BLOCK/.test(migration161),
    '161 обязана разбирать историю по доказательствам — блок атрибуции пропал',
  );
});

test('161 не падает на базе, где 160 применилась в старой редакции', () => {
  // MigrationRunner прерывает старт на упавшей миграции и НЕ отмечает её
  // применённой. База, где 160 успела примениться СТАРОЙ (без is_main), а 161
  // упала, при следующем деплое получает 160 пропущенной и 161 уже новой:
  // без собственного ADD COLUMN она сослалась бы на несуществующую
  // tp.is_main, упала снова — и увела бы backend в вечный краш-луп.
  const schemaAt = migration161.indexOf('ADD COLUMN IF NOT EXISTS is_main');
  const bindAt = migration161.indexOf('UPDATE shifts s');
  assert.ok(schemaAt > 0, '161 обязана сама уметь завести is_main');
  assert.ok(schemaAt < bindAt, 'колонка обязана появиться раньше первой ссылки на неё');
  assert.ok(
    migration161.indexOf('INSERT INTO tenant_points') > 0 && migration161.indexOf('INSERT INTO tenant_points') < bindAt,
    '161 обязана сама обеспечить основную точку — иначе семь таблиц останутся «ничьими»',
  );
});

// ── 2. Ремонтная миграция 162 ───────────────────────────────────────────────

test('162 идемпотентна по схеме и по основной точке', () => {
  assert.ok(
    /ALTER TABLE tenant_points ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;/.test(migration162),
    '162 обязана чинить и базу, где 160 применилась в старой редакции (колонки там нет вовсе)',
  );
  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_points_one_main/.test(migration162),
    'гарантия «одна основная» обязана появиться и на уже применённой базе',
  );
  assert.ok(
    /NOT EXISTS \(SELECT 1 FROM tenant_points m WHERE m\.tenant_id = t\.id AND m\.is_main\)/.test(migration162),
    'повторный прогон 162 завёл бы вторую основную точку',
  );
  assert.ok(!/CONCURRENTLY/.test(migration162), 'CONCURRENTLY запрещён внутри транзакции миграции');
});

test('162 переносит на основную ТОЛЬКО строки, созданные раньше своей точки', () => {
  // Ремонтные UPDATE'ы — те, что джойнят филиал с основной точкой того же тенанта.
  const repairs = migration162.match(/^UPDATE \w+ \w+\n\s+SET point_id = m\.id[\s\S]*?;/gm) ?? [];
  assert.equal(repairs.length, 9, 'ремонт обязан покрывать все девять таблиц с point_id');

  for (const stmt of repairs) {
    // Единственное надёжное доказательство: строка старше самой точки.
    assert.ok(
      /(created_at|opened_at) < p\.created_at/.test(stmt),
      'без сравнения с датой создания точки ремонт превращается в угадывание, чьи это деньги',
    );
    assert.ok(
      /(created_at|opened_at) IS NOT NULL/.test(stmt),
      'строка без даты создания недоказуема — трогать её нельзя',
    );
    // Направление переноса ровно одно: филиал → основной сервис.
    assert.ok(
      /p\.is_main = false/.test(stmt),
      'без этого условия ремонт таскал бы строки С основной точки и во второй прогон',
    );
    assert.ok(
      /m\.is_main AND m\.is_active/.test(stmt),
      'переносить деньги в архивную или неосновную точку нельзя — это неотличимо от их пропажи',
    );
    assert.ok(/\.tenant_id = p\.tenant_id/.test(stmt), 'перенос обязан оставаться внутри своего тенанта');
  }

  // Кассовая смена — по opened_at: created_at у давно существовавшей таблицы
  // мог не добраться (в 080 он есть только в CREATE TABLE).
  assert.ok(
    /UPDATE cash_shifts cs[\s\S]*?cs\.opened_at < p\.created_at/.test(migration162),
    'у кассовой смены датой появления строки обязан быть opened_at',
  );
});

test('162 честно перечисляет случаи, которые сознательно не чинит', () => {
  for (const marker of [
    'НЕ трогает строки, созданные ПОЗЖЕ своей точки',
    'НЕ трогает строки без даты создания',
    'НЕ переносит строки МЕЖДУ филиалами',
    'НЕ трогает тенантов без живых точек',
  ]) {
    assert.ok(
      migration162.includes(marker),
      `в шапке 162 нет объяснения «${marker}» — следующий агент «дочинит» сомнительный случай и испортит хороший`,
    );
  }
});

// ── 3. adminCreate: история достаётся основному сервису ─────────────────────

test('единственная заведённая точка-филиал НЕ забирает историю тенанта', async () => {
  // Тенант ZR AUTO, точек нет. Суперадмин заводит «ТопГаз» — второй автосервис
  // владельца. История обязана уйти основной точке «ZR AUTO», а не ТопГазу.
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/UPDATE tenant_points SET is_main=true/.test(text)) return []; // одноимённой точки нет
    if (/INSERT INTO tenant_points[\s\S]*is_main/.test(text)) return [{ id: MAIN_ID }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: BRANCH_ID, name: 'ТопГаз', is_active: true }];
    return [];
  });
  const service = new PointsService(pool);

  const created = await service.adminCreate('t-1', { name: 'ТопГаз' });
  assert.equal(created.id, BRANCH_ID);
  assert.equal(created.isMain, false, 'дополнительно открытый сервис — филиал, а не основной');

  const mainInsert = pool.calls.find((c) => /INSERT INTO tenant_points[\s\S]*is_main/.test(c.text));
  assert.ok(mainInsert, 'основная точка не создана — истории некуда деваться, кроме филиала');
  assert.deepEqual(mainInsert.params, ['t-1', 'ZR AUTO'], 'имя основной точки берётся из названия компании');

  const binds = bindCalls(pool);
  assert.equal(binds.length, PointsService.HISTORY_TABLES.length, 'привязана не вся история');
  for (const call of binds) {
    assert.deepEqual(call.params, ['t-1'], 'разбор истории адресуется тенантом, точка находится по is_main');
    assert.ok(
      /tp\.is_main AND tp\.is_active AND tp\.tenant_id = \$1/.test(call.text),
      'история приписана филиалу ТопГаз вместо ZR AUTO — обратно различить их будет нечем',
    );
  }

  // Порядок обязателен: основная точка появляется РАНЬШЕ привязки.
  const mainAt = pool.calls.indexOf(mainInsert);
  assert.ok(
    binds.every((c) => pool.calls.indexOf(c) > mainAt),
    'привязка выполняется до появления основной точки',
  );
});

test('первую точку, названную как компания, помечаем основной — без дубля', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: MAIN_ID, name: 'ZR AUTO', is_main: true }];
    return [];
  });
  const service = new PointsService(pool);

  const created = await service.adminCreate('t-1', { name: '  zr auto  ' });
  assert.equal(created.isMain, true, 'точка с именем компании И ЕСТЬ основной сервис');

  const inserts = pool.calls.filter((c) => /INSERT INTO tenant_points/.test(c.text));
  assert.equal(inserts.length, 1, 'вторая «ZR AUTO» рядом с первой — владелец не поймёт, в какую смотреть');
  assert.ok(/is_main/.test(inserts[0].text), 'созданная точка обязана быть помечена основной');

  const binds = bindCalls(pool);
  assert.equal(binds.length, PointsService.HISTORY_TABLES.length);
  for (const call of binds) assert.deepEqual(call.params, ['t-1']);
});

test('тенант без точек не затронут: adminCreate у него никто не звал', () => {
  // Единственный путь, включающий филиалы существующему тенанту, — adminCreate
  // суперадмина. Ни один тенант-путь точку не заводит: иначе одноточечный
  // автосервис однажды проснулся бы с фильтром филиала, которого не просил.
  const tenantSide = points.slice(points.indexOf('// ── Тенант-сторона'), points.indexOf('// ── Суперадмин'));
  assert.ok(
    !/INSERT INTO tenant_points/.test(tenantSide),
    'тенант-сторона не имеет права заводить точки — мульти-точечный режим включает только суперадмин',
  );
  // И миграции трогают ровно тех, у кого живые точки уже есть.
  for (const [name, sql] of [
    ['160', migration160],
    ['162', migration162],
  ]) {
    assert.ok(
      /WHERE EXISTS \(SELECT 1 FROM tenant_points p WHERE p\.tenant_id = t\.id AND p\.is_active\)/.test(sql),
      `${name}: основная точка заводится тенанту без точек — это включило бы ему филиалы без спроса`,
    );
  }
});

test('повторное создание точки историю больше не двигает', async () => {
  // Основная точка уже есть → hadMain=true → привязки нет вовсе. Это и есть
  // «повторный прогон ничего не двигает» на стороне сервиса.
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [{ id: MAIN_ID }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: BRANCH_ID, name: 'Третий' }];
    return [];
  });
  const service = new PointsService(pool);

  await service.adminCreate('t-1', { name: 'Третий' });
  assert.equal(
    bindCalls(pool).length,
    0,
    'строки без филиала после этого рождает только владелец в режиме «Все точки»',
  );
});

test('создание точки сериализуется блокировкой строки тенанта', () => {
  const body = points.slice(points.indexOf('async adminCreate('), points.indexOf('async adminUpdate('));
  assert.ok(
    /SELECT id, name FROM tenants WHERE id=\$1 FOR UPDATE/.test(body),
    'без FOR UPDATE два параллельных создания оба решат, что основной точки ещё нет',
  );
  const beginAt = body.indexOf("await client.query('BEGIN')");
  assert.ok(beginAt >= 0 && body.indexOf('FOR UPDATE') > beginAt, 'блокировка обязана браться внутри транзакции');
});

// ── 4. Основную точку нельзя погасить ───────────────────────────────────────

test('основную точку нельзя заархивировать через DELETE', async () => {
  const pool = fakePool((text) => (/SELECT is_main FROM tenant_points/.test(text) ? [{ is_main: true }] : []));
  const service = new PointsService(pool);

  await assert.rejects(
    () => service.adminArchive('t-1', MAIN_ID),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.match(err.getResponse().message, /Основной сервис нельзя удалить/);
      return true;
    },
  );
  assert.ok(
    !pool.calls.some((c) => /UPDATE tenant_points SET is_active=false/.test(c.text)),
    'запрет обязан сработать ДО того, как точка погаснет',
  );
});

test('основную точку нельзя заархивировать и через PATCH', async () => {
  const pool = fakePool((text) => (/SELECT is_main FROM tenant_points/.test(text) ? [{ is_main: true }] : []));
  const service = new PointsService(pool);

  await assert.rejects(
    () => service.adminUpdate('t-1', MAIN_ID, { isActive: false }),
    (err) => {
      assert.equal(err.getStatus(), 400);
      return true;
    },
  );
  assert.ok(
    !pool.calls.some((c) => /UPDATE tenant_points SET/.test(c.text)),
    'PATCH — тот же архив, что DELETE: обходного пути быть не должно',
  );
});

test('переименовать основную точку можно — вывеска на историю не влияет', async () => {
  const pool = fakePool((text) =>
    /UPDATE tenant_points SET/.test(text) ? [{ id: MAIN_ID, name: 'ZR AUTO PRO', is_main: true, is_active: true }] : [],
  );
  const service = new PointsService(pool);

  const updated = await service.adminUpdate('t-1', MAIN_ID, { name: 'ZR AUTO PRO' });
  assert.equal(updated.name, 'ZR AUTO PRO');
  assert.equal(updated.isMain, true);
  assert.ok(
    !pool.calls.some((c) => /SELECT is_main FROM tenant_points/.test(c.text)),
    'гейт архивации не должен мешать переименованию — компания вправе сменить вывеску',
  );
});

test('филиал архивируется как раньше', async () => {
  const pool = fakePool((text) => {
    if (/SELECT is_main FROM tenant_points/.test(text)) return [{ is_main: false }];
    return /UPDATE tenant_points SET is_active=false/.test(text) ? [{ id: BRANCH_ID }] : [];
  });
  const service = new PointsService(pool);

  const res = await service.adminArchive('t-1', BRANCH_ID);
  assert.deepEqual(res, { success: true }, 'дополнительно открытый сервис закрыть можно — это не сам автосервис');
});

// ── 5. Контракт с клиентами ─────────────────────────────────────────────────

test('признак основной точки уезжает клиенту', () => {
  assert.ok(/isMain: !!row\.is_main/.test(points), 'mapPoint не отдаёт isMain — клиент не отличит сервис от филиала');
  assert.ok(/isMain: !!r\.is_main/.test(points), 'сводка «Филиалы» не отдаёт isMain');
  assert.ok(/^\s+isMain: boolean;/m.test(sharedTypes), 'в shared/types нет поля isMain — контракт не описан');
});

test('основная точка идёт первой в любом списке', () => {
  // Проверяем каждую сортировку точек адресно: списки, которые видит человек,
  // обязаны начинаться с основного сервиса. Единственное исключение —
  // ensureMainPoint: там основной ЕЩЁ НЕТ, и сортировка нужна лишь для
  // детерминированного выбора кандидата среди одноимённых.
  const between = (from, to) => points.slice(points.indexOf(from), points.indexOf(to));
  const cases = [
    ['пикер точек тенанта (GET /points)', between('async listForTenant(', 'async switchPoint(')],
    ['дефолтная точка сотрудника', between('private async defaultPointForMember(', 'async setMembers(')],
    ['карточки раздела «Филиалы»', between('private async computeSummary(', '// ── Суперадмин')],
    ['список точек в ЛК суперадмина', between('async adminList(', 'HISTORY_TABLES')],
  ];
  for (const [label, body] of cases) {
    const ordering = body.match(/ORDER BY[^`\n]*/g) ?? [];
    assert.ok(ordering.length > 0, `${label}: сортировка точек пропала`);
    assert.ok(
      ordering.some((o) => /is_main DESC/.test(o)),
      `${label}: без «is_main DESC» основной сервис оказывается посреди филиалов`,
    );
  }
  assert.ok(
    /ORDER BY is_main DESC, sort_order ASC, created_at ASC, id ASC/.test(pointScope),
    'резолв точки для денежной записи обязан предпочитать основной сервис',
  );
});
