const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ЗАВЕДЕНИЕ ПЕРВОГО ФИЛИАЛА КРУПНОМУ ТЕНАНТУ НЕ ИМЕЕТ ПРАВА ПАДАТЬ ПО ТАЙМАУТУ.
 *
 * ЧТО БЫЛО. PointsService.attachOrphanHistory гнал девять полнотабличных (по
 * тенанту) UPDATE'ов — checks, clients, shifts, cash_shifts, четыре зарплатные
 * таблицы и expenses — одним запросом на таблицу, внутри ОДНОЙ транзакции
 * веб-запроса. У рантайм-пула стоит statement_timeout = 8 секунд
 * (common/db-config.ts), и у автосервиса с многолетней историей первый же
 * UPDATE в него не укладывался: 57014 → ROLLBACK → «Не удалось создать точку».
 * Повторная попытка падала ровно так же, то есть завести филиал КРУПНОМУ
 * тенанту было нельзя вообще — а это единственная дверь в мульти-точечный
 * режим (вторая — разархивация, тот же код).
 *
 * ЧЕМ ПОЧИНЕНО. statement_timeout считается НА ЗАПРОС, а не на транзакцию,
 * поэтому каждый UPDATE режется на порции по HISTORY_BATCH строк: запрос
 * заведомо короткий, транзакция — по-прежнему одна и коммитится целиком.
 * Плюс `SET LOCAL statement_timeout` как страховка от одной патологически
 * тяжёлой порции; LOCAL — чтобы соединение вернулось в пул со штатным лимитом.
 *
 * ЧТО ПРОВЕРЯЕМ:
 *   1. у каждого UPDATE привязки есть хвост-порция с LIMIT $2 по своей таблице;
 *   2. цикл повторяется, пока порция приходит ПОЛНОЙ, и останавливается на
 *      неполной (иначе либо вечный цикл, либо недопривязанная история);
 *   3. лимит поднимается ровно SET LOCAL и ровно внутри транзакции;
 *   4. падение на середине порций откатывает всё — включая саму точку.
 *
 * Тест статический (читает исходник) + поведенческий на собранном dist с
 * фейковым пулом: живой БД в CI нет. Конвенция — points-main-service.
 */

const backendRoot = join(__dirname, '..');
const points = readFileSync(join(backendRoot, 'src/points/points.service.ts'), 'utf8');
const dbConfig = readFileSync(join(backendRoot, 'src/common/db-config.ts'), 'utf8');

const { PointsService } = require('../dist/points/points.service');

const flat = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const BATCH = PointsService.HISTORY_BATCH;

/**
 * Пул-заглушка с транзакцией и УПРАВЛЯЕМЫМ rowCount: цикл порций
 * останавливается именно по числу затронутых строк, поэтому фейк обязан уметь
 * его отдавать (обычный фейк из соседних тестов отдаёт только rows).
 */
function fakePool({ rowsFor = () => [], rowCountFor = () => 0 } = {}) {
  const calls = [];
  const run = async (text, params) => {
    calls.push({ text, params });
    const rows = rowsFor(text, params) ?? [];
    return { rows, rowCount: rowCountFor(text, params) ?? rows.length };
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

/** Тенант без единой точки: adminCreate обязан завести основную и разобрать историю. */
const freshTenantRows = (text) => {
  if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
  if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
  if (/UPDATE tenant_points SET is_main=true/.test(text)) return [];
  if (/INSERT INTO tenant_points[\s\S]*is_main/.test(text)) return [{ id: 'p-main' }];
  if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-branch', name: 'ТопГаз' }];
  return [];
};

const attachCalls = (pool) => pool.calls.filter((c) => /^UPDATE \w+ \w+ SET point_id = /.test(flat(c.text)));

// ── 1. Форма запроса: порция есть и она своя у каждой таблицы ───────────────

test('каждый UPDATE привязки ограничен порцией по своей таблице', async () => {
  const pool = fakePool({ rowsFor: freshTenantRows });
  await new PointsService(pool).adminCreate('t-1', { name: 'ТопГаз' });

  const calls = attachCalls(pool);
  assert.equal(calls.length, PointsService.HISTORY_TABLES.length, 'разобрана не вся история');

  for (const call of calls) {
    const table = /^UPDATE (\w+) (\w+) SET/.exec(flat(call.text));
    assert.ok(table, 'не разобрать таблицу привязки');
    const [, name, alias] = table;
    assert.ok(
      new RegExp(`AND ${alias}\\.id IN \\(SELECT o\\.id FROM ${name} o`).test(flat(call.text)),
      `${name}: порция обязана адресоваться первичным ключом СВОЕЙ таблицы — иначе UPDATE заденет чужие строки`,
    );
    assert.ok(
      /WHERE o\.tenant_id = \$1 AND o\.point_id IS NULL LIMIT \$2\)/.test(flat(call.text)),
      `${name}: порция обязана брать только строки своего тенанта БЕЗ филиала`,
    );
    assert.deepEqual(call.params, ['t-1', BATCH], `${name}: размер порции обязан ехать параметром`);
  }
});

test('размер порции конечен и с огромным запасом укладывается в лимит пула', () => {
  assert.ok(Number.isInteger(BATCH) && BATCH > 0, 'размер порции обязан быть положительным целым');
  assert.ok(
    BATCH <= 5000,
    'порция такого размера снова упрётся в statement_timeout — смысл дробления пропадёт',
  );
  // Сам лимит живёт в db-config: если его когда-нибудь снимут, этот тест
  // подскажет, что дробление больше не обязательно (но и не мешает).
  assert.ok(/statement_timeout/.test(dbConfig), 'лимит запроса исчез из конфига пула — перечитать обоснование');
});

// ── 2. Цикл: повторяем, пока порция полная ─────────────────────────────────

test('таблица с историей больше порции разбирается за несколько проходов', async () => {
  // checks: 1200 сирот → 500 + 500 + 200. Остальные таблицы пусты.
  let checksLeft = 1200;
  const pool = fakePool({
    rowsFor: freshTenantRows,
    rowCountFor: (text) => {
      if (!/^UPDATE checks ch SET point_id = /.test(flat(text))) return 0;
      const took = Math.min(BATCH, checksLeft);
      checksLeft -= took;
      return took;
    },
  });

  await new PointsService(pool).adminCreate('t-1', { name: 'ТопГаз' });

  const checksCalls = attachCalls(pool).filter((c) => /^UPDATE checks /.test(flat(c.text)));
  assert.equal(
    checksCalls.length,
    Math.ceil(1200 / BATCH) + (1200 % BATCH === 0 ? 1 : 0),
    'цикл обязан идти до НЕПОЛНОЙ порции: остановка раньше оставит часть журнала без филиала',
  );
  assert.equal(checksLeft, 0, 'часть истории осталась непривязанной — журнал покажет пустоту');

  // Ровно одна транзакция на всё: порции не имеют права коммититься по
  // отдельности, иначе обрыв оставит наполовину разобранную историю.
  const sql = pool.calls.map((c) => flat(c.text));
  assert.equal(sql.filter((t) => t === 'BEGIN').length, 1);
  assert.equal(sql.filter((t) => t === 'COMMIT').length, 1);
});

test('пустая таблица стоит ровно один запрос', async () => {
  const pool = fakePool({ rowsFor: freshTenantRows });
  await new PointsService(pool).adminCreate('t-1', { name: 'ТопГаз' });
  const perTable = new Map();
  for (const c of attachCalls(pool)) {
    const name = /^UPDATE (\w+) /.exec(flat(c.text))[1];
    perTable.set(name, (perTable.get(name) ?? 0) + 1);
  }
  for (const [name, count] of perTable) {
    assert.equal(count, 1, `${name}: лишний проход по пустой таблице — это лишний round-trip на каждом заведении точки`);
  }
});

// ── 3. Поднятый лимит: только LOCAL и только внутри транзакции ──────────────

test('лимит запроса поднимается SET LOCAL внутри транзакции привязки', async () => {
  const pool = fakePool({ rowsFor: freshTenantRows });
  await new PointsService(pool).adminCreate('t-1', { name: 'ТопГаз' });

  const sql = pool.calls.map((c) => flat(c.text));
  const setAt = sql.findIndex((t) => /^SET LOCAL statement_timeout/.test(t));
  assert.ok(setAt >= 0, 'страховка от одной тяжёлой порции пропала');
  assert.ok(setAt > sql.indexOf('BEGIN') && setAt < sql.indexOf('COMMIT'), 'SET LOCAL вне транзакции — это no-op');
  const firstAttachAt = sql.findIndex((t) => /^UPDATE \w+ \w+ SET point_id = /.test(t));
  assert.ok(setAt < firstAttachAt, 'лимит обязан подниматься ДО первой порции');

  assert.ok(
    !/\bSET statement_timeout/.test(points),
    'SET без LOCAL пережил бы транзакцию и вернул бы в пул соединение с поднятым лимитом — 8 секунд защиты пропали бы для всех',
  );
});

// ── 4. Половинчатого состояния не бывает ───────────────────────────────────

test('падение на середине порций откатывает и точку, и уже привязанное', async () => {
  const pool = fakePool({
    rowsFor: (text) => {
      if (/^UPDATE shifts /.test(flat(text))) throw Object.assign(new Error('canceling statement'), { code: '57014' });
      return freshTenantRows(text);
    },
  });

  await assert.rejects(() => new PointsService(pool).adminCreate('t-1', { name: 'ТопГаз' }));

  const sql = pool.calls.map((c) => flat(c.text));
  assert.ok(sql.includes('ROLLBACK'), 'без отката в базе останется точка с наполовину разобранной историей');
  assert.ok(!sql.includes('COMMIT'), 'коммитить нечего — привязка не доехала до конца');
  assert.equal(pool.released, 1, 'соединение пула обязано возвращаться в пул даже на ошибке');
});

test('обоснование дробления записано рядом с кодом', () => {
  for (const marker of ['statement_timeout', 'ПОВТОРЯЕМОСТЬ', 'ПОЧЕМУ ПОРЦИЯМИ']) {
    assert.ok(
      points.includes(marker),
      `в шапке attachOrphanHistory нет «${marker}» — следующий агент «упростит» дробление обратно в один UPDATE`,
    );
  }
});
