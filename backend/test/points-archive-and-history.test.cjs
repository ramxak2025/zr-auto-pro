const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * ФИЛИАЛЫ, ОСТАТОК РЕВИЗИИ: ДВА ПУТИ, ГДЕ ДЕНЬГИ ВСЁ ЕЩЁ ПРОПАДАЛИ.
 *
 * 1. АРХИВАЦИЯ ЧЕРЕЗ PATCH. `DELETE /points/:id` гасил точку И отвязывал от
 *    неё сотрудников, а `PATCH { isActive: false }` — только гасил. Сотрудники
 *    оставались приколоты к архивной точке: их скоуп чтения фильтровал по
 *    мёртвому филиалу (пустые журнал, склад, зарплата), а денежная запись
 *    продолжала штамповаться в филиал, которого нет ни в одном живом срезе.
 *    Страховка второго уровня — проверка is_active в самом резолве записи
 *    (см. points-write-gate).
 *
 * 2. ПЕРВАЯ ТОЧКА У СУЩЕСТВУЮЩЕГО ТЕНАНТА. Миграции 160/161 прибили историю
 *    без филиала к первой живой точке ТОЛЬКО тем тенантам, у кого точки уже
 *    были на момент прогона. Для всех остальных этот момент наступает в
 *    PointsService.adminCreate — и если там привязки нет, автосервис в день
 *    заведения первой точки теряет журнал, отчёты, зарплату, смены и расходы.
 *    Для владельца это выглядит как «данные пропали».
 *
 * Тест статический (читает исходники) + поведенческий на собранном dist с
 * фейковым пулом: живой БД в CI нет. Конвенция — points-write-gate.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const points = read('src/points/points.service.ts');
const migration160 = read('migrations/160_points_scoping.sql');
const migration161 = read('migrations/161_points_scoping_modules.sql');

const { PointsService } = require('../dist/points/points.service');

/**
 * Пул-заглушка с транзакцией: пишет ВСЕ запросы (и по пулу, и по клиенту) в
 * один журнал, чтобы можно было проверить и состав, и порядок.
 * `rowsFor` подставляет ответ по подстроке запроса.
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

const sqlOf = (calls) => calls.map((c) => c.text.replace(/\s+/g, ' ').trim());

// ── 1. Архивация: оба пути имеют ОДНИ последствия ───────────────────────────

test('PATCH isActive:false отвязывает сотрудников ровно как DELETE', async () => {
  const pool = fakePool((text) => (/UPDATE tenant_points/.test(text) ? [{ id: 'p-1', is_active: false }] : []));
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', 'p-1', { isActive: false });

  const reset = pool.calls.find((c) => /UPDATE users SET current_point_id=NULL/.test(c.text));
  assert.ok(
    reset,
    'архивация через PATCH оставляет сотрудников на погашенной точке — они продолжают штамповать в неё деньги',
  );
  assert.deepEqual(reset.params, ['p-1', 't-1'], 'сброс обязан быть адресным: точка + тенант');
});

test('обычная правка точки сотрудников НЕ трогает', async () => {
  const pool = fakePool((text) => (/UPDATE tenant_points/.test(text) ? [{ id: 'p-1', is_active: true }] : []));
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', 'p-1', { name: 'Новое имя', sortOrder: 3 });
  await service.adminUpdate('t-1', 'p-1', { isActive: true });

  assert.ok(
    !pool.calls.some((c) => /UPDATE users SET current_point_id=NULL/.test(c.text)),
    'переименование и РАЗархивация не имеют права выкидывать людей из филиала',
  );
});

test('последствия архивации живут в одном хелпере, а не двумя копиями', () => {
  const detachCalls = points.match(/await this\.detachMembersFromPoint\(tenantId, pointId\);/g) ?? [];
  assert.equal(detachCalls.length, 2, 'путей архивации два (DELETE и PATCH) — хелпер обязан зваться из обоих');
  assert.ok(
    /private async detachMembersFromPoint\(/.test(points) &&
      /for \(const r of reset\) invalidateAuthUser\(/.test(points),
    'без сброса auth-кеша «застрявший» актор ещё 30 секунд пишет деньги в архивный филиал',
  );
});

// ── 2. Первая живая точка забирает историю тенанта ──────────────────────────

/**
 * Из миграций достаём ИМЕННО те таблицы, историю которых они прибивали к
 * первой живой точке: `UPDATE <table> <alias> SET point_id = fp.point_id`.
 */
function historyTablesOfMigration(sql) {
  return [...sql.matchAll(/UPDATE\s+(\w+)\s+\w+\s*\n?\s*SET point_id = fp\.point_id/g)].map((m) => m[1]);
}

test('состав привязки один в один с миграциями 160 и 161', () => {
  const fromMigrations = [...historyTablesOfMigration(migration160), ...historyTablesOfMigration(migration161)];
  assert.ok(fromMigrations.length >= 9, 'парсер миграций сломался — сверять список не с чем');
  assert.deepEqual(
    [...PointsService.HISTORY_TABLES].sort(),
    [...new Set(fromMigrations)].sort(),
    'список таблиц разъехался с миграциями: тенант, которому точку заводят СЕГОДНЯ, увидит по забытой таблице пустоту',
  );
});

test('первая живая точка забирает ВСЮ историю тенанта — в одной транзакции', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1' }];
    if (/INSERT INTO tenant_points/.test(text))
      return [{ id: 'p-new', name: 'Первая', sort_order: 0, is_active: true }];
    return []; // других живых точек нет
  });
  const service = new PointsService(pool);

  const created = await service.adminCreate('t-1', { name: 'Первая' });
  assert.equal(created.id, 'p-new');

  const sql = sqlOf(pool.calls);
  const begin = sql.findIndex((t) => t === 'BEGIN');
  const commit = sql.findIndex((t) => t === 'COMMIT');
  assert.ok(begin >= 0 && commit > begin, 'точка и привязка обязаны коммититься вместе');

  for (const table of PointsService.HISTORY_TABLES) {
    const call = pool.calls.find((c) => c.text.startsWith(`UPDATE ${table} SET point_id=$1`));
    assert.ok(call, `история таблицы ${table} осталась без филиала — раздел покажет пустоту`);
    assert.deepEqual(call.params, ['p-new', 't-1']);
    assert.ok(
      /point_id IS NULL/.test(call.text),
      `${table}: без «point_id IS NULL» повторный проход перенёс бы уже привязанные деньги в другой филиал`,
    );
    const idx = sql.indexOf(call.text.replace(/\s+/g, ' ').trim());
    assert.ok(idx > begin && idx < commit, `${table}: привязка выполняется вне транзакции`);
  }
  assert.equal(pool.released, 1, 'соединение пула обязано возвращаться в пул');
});

test('вторая точка историю НЕ забирает', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1' }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-2', name: 'Вторая', sort_order: 1, is_active: true }];
    if (/FROM tenant_points WHERE tenant_id=\$1 AND is_active=true AND id<>\$2/.test(text)) return [{ '?column?': 1 }];
    return [];
  });
  const service = new PointsService(pool);

  await service.adminCreate('t-1', { name: 'Вторая' });

  assert.ok(
    !pool.calls.some((c) => /SET point_id=\$1 WHERE tenant_id=\$2 AND point_id IS NULL/.test(c.text)),
    'у второй точки «ничьи» строки может родить только владелец в режиме «Все точки» — утащить их в новый филиал = переписать чужую выручку',
  );
});

test('падение привязки откатывает и саму точку', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1' }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-new', name: 'Первая', sort_order: 0 }];
    if (/UPDATE checks SET point_id/.test(text)) throw new Error('boom');
    return [];
  });
  const service = new PointsService(pool);

  await assert.rejects(() => service.adminCreate('t-1', { name: 'Первая' }), /boom/);
  assert.ok(
    sqlOf(pool.calls).includes('ROLLBACK'),
    'иначе остаётся живая точка с полупривязанной историей — состояния, из которого нет автоматического выхода',
  );
  assert.equal(pool.released, 1);
});

test('дубль имени по-прежнему отвечает 409, а не 500', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1' }];
    if (/INSERT INTO tenant_points/.test(text)) {
      const err = new Error('duplicate');
      err.code = '23505';
      throw err;
    }
    return [];
  });
  const service = new PointsService(pool);

  await assert.rejects(
    () => service.adminCreate('t-1', { name: 'Первая' }),
    (err) => {
      assert.equal(err.getStatus(), 409);
      assert.deepEqual(err.getResponse(), { message: 'Точка с таким названием уже есть' });
      return true;
    },
  );
});
