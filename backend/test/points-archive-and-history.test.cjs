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
 *    без филиала к ОСНОВНОМУ сервису ТОЛЬКО тем тенантам, у кого точки уже
 *    были на момент прогона. Для всех остальных этот момент наступает в
 *    PointsService.adminCreate — и если там привязки нет, автосервис в день
 *    заведения первой точки теряет журнал, отчёты, зарплату, смены и расходы.
 *    Для владельца это выглядит как «данные пропали».
 *
 *    Кому именно достаётся история — проверяет points-main-service: здесь
 *    только сам факт привязки, её транзакционность и состав таблиц.
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

// Настоящий uuid: админ-пути архивации проверяют форму id ДО запроса — иначе
// не-uuid в сравнении с uuid дал бы 22P02 → 500 вместо честного 404.
const POINT_ID = '11111111-1111-4111-8111-111111111111';

// ── 1. Архивация: оба пути имеют ОДНИ последствия ───────────────────────────

test('PATCH isActive:false отвязывает сотрудников ровно как DELETE', async () => {
  // Точка существует и НЕ основная — иначе архивация запрещена (см.
  // points-main-service): гейт спрашивает про is_main до самого UPDATE.
  const pool = fakePool((text) => {
    if (/SELECT is_main FROM tenant_points/.test(text)) return [{ is_main: false }];
    return /UPDATE tenant_points/.test(text) ? [{ id: POINT_ID, is_active: false }] : [];
  });
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', POINT_ID, { isActive: false });

  const reset = pool.calls.find((c) => /UPDATE users SET current_point_id=NULL/.test(c.text));
  assert.ok(
    reset,
    'архивация через PATCH оставляет сотрудников на погашенной точке — они продолжают штамповать в неё деньги',
  );
  assert.deepEqual(reset.params, [POINT_ID, 't-1'], 'сброс обязан быть адресным: точка + тенант');
});

test('обычная правка точки сотрудников НЕ трогает', async () => {
  const pool = fakePool((text) => {
    if (/SELECT is_main FROM tenant_points/.test(text)) return [{ is_main: false }];
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    // Основной сервис у тенанта уже есть — разархивация ничего не разбирает.
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [{ id: 'p-main' }];
    return /UPDATE tenant_points/.test(text) ? [{ id: POINT_ID, is_active: true }] : [];
  });
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', POINT_ID, { name: 'Новое имя', sortOrder: 3 });
  await service.adminUpdate('t-1', POINT_ID, { isActive: true });

  assert.ok(
    !pool.calls.some((c) => /UPDATE users SET current_point_id=NULL/.test(c.text)),
    'переименование и РАЗархивация не имеют права выкидывать людей из филиала',
  );
  assert.ok(
    !pool.calls.some((c) => /point_id IS NULL AND \w+\.tenant_id = mp\.tenant_id/.test(c.text)),
    'основной сервис уже был — «ничьи» строки после него мог родить только владелец в режиме «Все точки»',
  );
});

test('переименование НЕ берёт строку тенанта под FOR UPDATE', async () => {
  // Лишний row-lock на tenants из-за смены вывески блокировал бы параллельные
  // админ-операции по тому же тенанту. Число живых точек переименование не
  // меняет, значит и инвариант «есть живая точка → есть основной сервис»
  // трогать нечего.
  const pool = fakePool((text) => (/UPDATE tenant_points/.test(text) ? [{ id: POINT_ID, is_active: true }] : []));
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', POINT_ID, { name: 'Новое имя' });

  assert.ok(
    !pool.calls.some((c) => /FOR UPDATE/.test(c.text)),
    'переименование не имеет права лочить строку тенанта',
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

// ── 2. Основной сервис забирает историю тенанта ─────────────────────────────

/**
 * Из миграций достаём ИМЕННО те таблицы, историю которых они разбирают:
 *   • `SET point_id = mp.point_id` — чеки и клиенты (160): их колонку завела
 *     ещё 156, поэтому оставшийся NULL честно означает «старше филиалов»;
 *   • `SET point_id = COALESCE(` — семь денежных таблиц волны 3 (161), где
 *     колонка заводится тут же и NULL ничего не доказывает: их разбирает
 *     лестница доказательств.
 */
function historyTablesOfMigration(sql) {
  return [...sql.matchAll(/UPDATE\s+(\w+)\s+\w+\s*\n?\s*SET point_id = (?:mp\.point_id|COALESCE\()/g)].map(
    (m) => m[1],
  );
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

test('основной сервис забирает ВСЮ историю тенанта — в одной транзакции', async () => {
  // Тенант ZR AUTO без единой точки; суперадмин заводит филиал «ТопГаз».
  // Ожидание: сервер сам создаёт основную точку «ZR AUTO» и отдаёт историю ЕЙ.
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/UPDATE tenant_points SET is_main=true/.test(text)) return []; // одноимённой точки нет
    if (/INSERT INTO tenant_points[\s\S]*is_main/.test(text)) return [{ id: 'p-main' }];
    if (/INSERT INTO tenant_points/.test(text))
      return [{ id: 'p-new', name: 'ТопГаз', sort_order: 0, is_active: true }];
    return [];
  });
  const service = new PointsService(pool);

  const created = await service.adminCreate('t-1', { name: 'ТопГаз' });
  assert.equal(created.id, 'p-new', 'суперадмину возвращается ровно та точка, которую он завёл');

  const sql = sqlOf(pool.calls);
  const begin = sql.findIndex((t) => t === 'BEGIN');
  const commit = sql.findIndex((t) => t === 'COMMIT');
  assert.ok(begin >= 0 && commit > begin, 'основная точка, филиал и привязка обязаны коммититься вместе');

  for (const table of PointsService.HISTORY_TABLES) {
    const call = pool.calls.find((c) => c.text.startsWith(`UPDATE ${table} `));
    assert.ok(call, `история таблицы ${table} осталась без филиала — раздел покажет пустоту`);
    assert.deepEqual(
      call.params,
      ['t-1'],
      `${table}: разбор истории адресуется тенантом — основной сервис находится подзапросом по is_main`,
    );
    assert.ok(
      /tp\.is_main AND tp\.is_active AND tp\.tenant_id = \$1/.test(call.text),
      `${table}: история ушла филиалу вместо основного сервиса — различить их обратно будет нечем`,
    );
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
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    // Основная точка у тенанта уже есть — история к ней давно привязана.
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [{ id: 'p-main' }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-2', name: 'Вторая', sort_order: 1, is_active: true }];
    return [];
  });
  const service = new PointsService(pool);

  await service.adminCreate('t-1', { name: 'Вторая' });

  assert.ok(
    !pool.calls.some((c) => /^UPDATE (checks|shifts|expenses|salary_\w+|cash_shifts|clients) /.test(c.text)),
    'у второй точки «ничьи» строки может родить только владелец в режиме «Все точки» — утащить их в новый филиал = переписать чужую выручку',
  );
});

test('падение привязки откатывает и саму точку', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/UPDATE tenant_points SET is_main=true/.test(text)) return [];
    if (/INSERT INTO tenant_points[\s\S]*is_main/.test(text)) return [{ id: 'p-main' }];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-new', name: 'ТопГаз', sort_order: 0 }];
    if (/^UPDATE checks ch/.test(text)) throw new Error('boom');
    return [];
  });
  const service = new PointsService(pool);

  await assert.rejects(() => service.adminCreate('t-1', { name: 'ТопГаз' }), /boom/);
  assert.ok(
    sqlOf(pool.calls).includes('ROLLBACK'),
    'иначе остаётся живая точка с полупривязанной историей — состояния, из которого нет автоматического выхода',
  );
  assert.equal(pool.released, 1);
});

test('дубль имени по-прежнему отвечает 409, а не 500', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [{ id: 'p-main' }];
    if (/INSERT INTO tenant_points/.test(text)) {
      const err = new Error('duplicate');
      err.code = '23505';
      throw err;
    }
    return [];
  });
  const service = new PointsService(pool);

  await assert.rejects(
    () => service.adminCreate('t-1', { name: 'ТопГаз' }),
    (err) => {
      assert.equal(err.getStatus(), 409);
      assert.deepEqual(err.getResponse(), { message: 'Точка с таким названием уже есть' });
      return true;
    },
  );
});
