const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
require('reflect-metadata');
const { RequestMethod } = require('@nestjs/common');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

/**
 * Ячейки хранения на складе (миграция 172, docs/specs/2026-09-30-STORAGE_CELLS.md).
 *
 * Что держит этот файл:
 *   • миграция — RLS как у 146, уникальность кода склада без учёта регистра;
 *   • инвариант «ячейка принадлежит СКЛАДУ товара»: чужая ячейка отклоняется до записи
 *     (create / update / bulk-assign), смена склада адрес сбрасывает, полное перемещение
 *     между складами тоже;
 *   • StorageCellsService: нормализация кодов, 409 STORAGE_CELL_EXISTS, bulk с `skipped`,
 *     удаление с `moveTo` / `detach` и 409 STORAGE_CELL_NOT_EMPTY;
 *   • порядок маршрутов (PATCH /order раньше PATCH /:id) и гейты прав;
 *   • DTO (лимиты, null в storageCellId) и CSV (колонка «Ячейка»).
 * Пул — фейковый: SQL и параметры видны как есть, база не нужна.
 */

const { ProductsService } = require('../dist/products/products.service');
const { ProductsController } = require('../dist/products/products.controller');
const { StorageCellsService } = require('../dist/storage-cells/storage-cells.service');
const { StorageCellsController } = require('../dist/storage-cells/storage-cells.controller');
const {
  MAX_BULK_CELLS,
  MAX_CELL_CODE_LENGTH,
  isUuidString,
  normalizeCellCode,
} = require('../dist/storage-cells/storage-cells.helpers');
const { CreateStorageCellDto } = require('../dist/storage-cells/dto/create-storage-cell.dto');
const { BulkCreateStorageCellsDto } = require('../dist/storage-cells/dto/bulk-create-storage-cells.dto');
const { UpdateStorageCellDto } = require('../dist/storage-cells/dto/update-storage-cell.dto');
const { UpdateStorageCellsOrderDto } = require('../dist/storage-cells/dto/update-storage-cells-order.dto');
const { BulkAssignCellDto } = require('../dist/products/dto/bulk-assign-cell.dto');
const { CreateProductDto } = require('../dist/products/dto/create-product.dto');
const { UpdateProductDto } = require('../dist/products/dto/update-product.dto');

const T = 't1';
const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const CA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const P2 = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const P3 = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const POINT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * Фейковый pg.Pool: `handler(sql, params)` отвечает по тексту запроса (SQL уже
 * с схлопнутыми пробелами), без ответа — пустой результат. `connect()` отдаёт клиента
 * с тем же журналом, поэтому транзакции видны; `released` — сколько клиентов вернули.
 * Параметры в журнал попадают копией: сервисы вроде getAll дописывают limit/offset
 * в тот же массив уже ПОСЛЕ счётного запроса.
 */
function makePool(handler = () => undefined) {
  const log = [];
  let released = 0;
  const query = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    const snapshot = Array.isArray(params) ? params.slice() : params;
    log.push({ sql: text, params: snapshot });
    return (await handler(text, snapshot)) || { rows: [] };
  };
  return {
    log,
    query,
    connect: async () => ({
      query,
      release: () => {
        released++;
      },
    }),
    get released() {
      return released;
    },
  };
}

const findAll = (pool, re) => pool.log.filter((q) => re.test(q.sql));
const findOne = (pool, re) => findAll(pool, re)[0];
const allSql = (pool) => pool.log.map((q) => q.sql).join('\n');

/** Ждём HttpException с нужным статусом и (если задан) машинным кодом; возвращает тело ответа. */
async function expectHttp(fn, status, code) {
  let body;
  await assert.rejects(fn, (err) => {
    assert.equal(typeof err.getStatus, 'function', `ожидалась HTTP-ошибка, а пришло: ${err && err.stack}`);
    assert.equal(err.getStatus(), status, JSON.stringify(err.getResponse()));
    body = err.getResponse();
    if (code) assert.equal(body.code, code);
    return true;
  });
  return body;
}

const productRow = (over = {}) => ({
  id: 'p1',
  name: 'Масло',
  category: 'Масла',
  photo: null,
  cost_price: '350',
  sell_price: '500',
  stock: '3',
  min_stock: '1',
  unit: 'шт',
  is_bundle: false,
  bundle_items: [],
  supplier_id: null,
  warehouse_id: W1,
  warranty_days: null,
  barcode: null,
  storage_cell_id: null,
  created_at: '2026-09-30T00:00:00.000Z',
  ...over,
});

/** Склады тенанта без филиалов: любой запрошенный склад «существует». */
const fakeWarehouses = { assertInTenant: async (_tenantID, warehouseId) => ({ id: warehouseId }) };

// ── чистые хелперы ─────────────────────────────────────────────────────────────

test('normalizeCellCode: trim, пробелы в один, верхний регистр (латиница и кириллица) — как в shared', () => {
  assert.equal(normalizeCellCode('  a-1 '), 'A-1');
  assert.equal(normalizeCellCode('а-01'), 'А-01'); // кириллическая «а»
  assert.equal(normalizeCellCode('стеллаж   1\t/\nполка  4'), 'СТЕЛЛАЖ 1 / ПОЛКА 4');
  assert.equal(normalizeCellCode(''), '');
  assert.equal(normalizeCellCode('   '), '');
  assert.equal(normalizeCellCode(null), '');
  assert.equal(normalizeCellCode(undefined), '');
  assert.equal(normalizeCellCode(12), '12');
  assert.equal(MAX_BULK_CELLS, 2000);
  assert.equal(MAX_CELL_CODE_LENGTH, 64);
  assert.equal(isUuidString(CA.toUpperCase()), true, 'регистр uuid не важен');
  assert.equal(isUuidString('undefined'), false);
  assert.equal(isUuidString(null), false);
});

// ── миграция и «одна точка сброса адреса» ──────────────────────────────────────

test('миграция 172: таблица, уникальный код склада без учёта регистра, FK на products и RLS как у 146', () => {
  // Комментарии убираем: в шапке файла «CREATE TABLE / INDEX IF NOT EXISTS» — это проза, не оператор.
  const sql = readFileSync(join(__dirname, '..', 'migrations', '172_storage_cells.sql'), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS storage_cells/);
  assert.match(sql, /warehouse_id UUID NOT NULL REFERENCES warehouses\(id\) ON DELETE CASCADE/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_cells_wh_code ON storage_cells \(warehouse_id, lower\(code\)\)/,
  );
  assert.match(
    sql,
    /ALTER TABLE products ADD COLUMN IF NOT EXISTS storage_cell_id UUID REFERENCES storage_cells\(id\) ON DELETE SET NULL/,
  );
  assert.match(sql, /ALTER TABLE storage_cells ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE storage_cells FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /DROP POLICY IF EXISTS tenant_isolation ON storage_cells/);
  assert.match(
    sql,
    /CREATE POLICY tenant_isolation ON storage_cells USING \(tenant_id = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)::uuid\) WITH CHECK \(tenant_id = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)::uuid\)/,
  );
  // Идемпотентность: ничего, что упадёт при повторном прогоне.
  assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /ADD COLUMN (?!IF NOT EXISTS)/);
});

/** Все .ts под src/. */
const collectTs = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTs(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
};

test('любой SQL, меняющий products.warehouse_id, обязан снимать адрес ячейки (ячейка живёт внутри склада)', () => {
  const offenders = [];
  let seen = 0;
  for (const file of collectTs(join(__dirname, '..', 'src'))) {
    const src = readFileSync(file, 'utf8');
    // Часть SET — до WHERE / RETURNING / конца литерала (динамический `${fields}` проверяют тесты update()).
    for (const m of src.matchAll(
      /UPDATE\s+products(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|[`'"])/gi,
    )) {
      const body = m[1];
      if (!/(^|[\s,])warehouse_id\s*=/.test(body)) continue;
      seen++;
      if (!/storage_cell_id\s*=/.test(body)) offenders.push(`${file}: UPDATE products SET ${body.slice(0, 80)}`);
    }
  }
  assert.ok(seen >= 1, 'страж ослеп: не нашёл ни одного UPDATE products SET warehouse_id (полное перемещение?)');
  assert.deepEqual(offenders, []);
});

test('полное перемещение товара на другой склад (брак / Б-У / другой филиал) снимает адрес', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'stock-movements', 'stock-movements.service.ts'), 'utf8');
  assert.match(src, /UPDATE products SET warehouse_id=\$1, storage_cell_id=NULL WHERE id=\$2 AND tenant_id=\$3/);
});

test('модуль ячеек зарегистрирован в app.module (импорт + массив imports)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'app.module.ts'), 'utf8');
  assert.match(src, /import \{ StorageCellsModule \} from '\.\/storage-cells\/storage-cells\.module'/);
  assert.equal(src.match(/StorageCellsModule/g).length, 2);
});

// ── маршруты и права ───────────────────────────────────────────────────────────

function routesOf(Controller) {
  const proto = Controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => ({
      name,
      path: Reflect.getMetadata('path', proto[name]),
      method: Reflect.getMetadata('method', proto[name]),
      permission: Reflect.getMetadata('requiredPermission', proto[name]),
    }));
}

test('PATCH /storage-cells/order объявлен РАНЬШЕ PATCH /storage-cells/:id (иначе order уйдёт в :id)', () => {
  const patches = routesOf(StorageCellsController).filter((r) => r.method === RequestMethod.PATCH);
  assert.deepEqual(
    patches.map((r) => r.path),
    ['order', ':id'],
  );
});

test('гейты прав: чтение ячеек — warehouse_access, любое изменение — warehouse_manage', () => {
  const byName = Object.fromEntries(routesOf(StorageCellsController).map((r) => [r.name, r]));
  assert.deepEqual(
    { method: byName.list.method, path: byName.list.path, permission: byName.list.permission },
    { method: RequestMethod.GET, path: '/', permission: 'warehouse_access' },
  );
  const writes = {
    create: [RequestMethod.POST, '/'],
    bulkCreate: [RequestMethod.POST, 'bulk'],
    updateOrder: [RequestMethod.PATCH, 'order'],
    update: [RequestMethod.PATCH, ':id'],
    remove: [RequestMethod.DELETE, ':id'],
  };
  for (const [name, [method, path]] of Object.entries(writes)) {
    assert.equal(byName[name].method, method, `${name}: HTTP-метод`);
    assert.equal(byName[name].path, path, `${name}: путь`);
    assert.equal(byName[name].permission, 'warehouse_manage', `${name}: право`);
  }
});

test('POST /products/bulk-assign-cell требует warehouse_manage, как правка товара', () => {
  const route = routesOf(ProductsController).find((r) => r.name === 'bulkAssignCell');
  assert.ok(route, 'маршрут bulk-assign-cell не найден');
  assert.equal(route.method, RequestMethod.POST);
  assert.equal(route.path, 'bulk-assign-cell');
  assert.equal(route.permission, 'warehouse_manage');
});

// ── DTO ────────────────────────────────────────────────────────────────────────

const invalidProps = async (Cls, plain) =>
  (await validate(plainToInstance(Cls, plain), { whitelist: true })).map((e) => e.property);

test('BulkAssignCellDto: uuid или null; ключ НЕ передан — ошибка; потолок 2000 товаров', async () => {
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: [P1], storageCellId: CA }), []);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: [P1], storageCellId: null }), []);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: [P1] }), ['storageCellId']);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: [P1], storageCellId: 'кухня' }), [
    'storageCellId',
  ]);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: [], storageCellId: CA }), ['productIds']);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: ['nope'], storageCellId: CA }), ['productIds']);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: Array(2000).fill(P1), storageCellId: CA }), []);
  assert.deepEqual(await invalidProps(BulkAssignCellDto, { productIds: Array(2001).fill(P1), storageCellId: CA }), [
    'productIds',
  ]);
});

test('BulkCreateStorageCellsDto: не больше 2000 кодов, коды — строки', async () => {
  assert.deepEqual(
    await invalidProps(BulkCreateStorageCellsDto, { warehouseId: W1, codes: Array(2000).fill('A') }),
    [],
  );
  assert.deepEqual(await invalidProps(BulkCreateStorageCellsDto, { warehouseId: W1, codes: Array(2001).fill('A') }), [
    'codes',
  ]);
  assert.deepEqual(await invalidProps(BulkCreateStorageCellsDto, { warehouseId: W1, codes: ['A', 5] }), ['codes']);
  assert.deepEqual(await invalidProps(BulkCreateStorageCellsDto, { warehouseId: 'x', codes: ['A'] }), ['warehouseId']);
  assert.deepEqual(await invalidProps(BulkCreateStorageCellsDto, { warehouseId: W1 }), ['codes']);
});

test('Create/Update StorageCellDto и порядок: границы полей', async () => {
  assert.deepEqual(await invalidProps(CreateStorageCellDto, { warehouseId: W1, code: 'A-1' }), []);
  assert.deepEqual(await invalidProps(CreateStorageCellDto, { warehouseId: W1, code: 'A-1', name: null }), []);
  assert.deepEqual(await invalidProps(CreateStorageCellDto, { warehouseId: W1, code: '' }), ['code']);
  assert.deepEqual(await invalidProps(CreateStorageCellDto, { code: 'A-1' }), ['warehouseId']);
  assert.deepEqual(await invalidProps(CreateStorageCellDto, { warehouseId: W1, code: 'A', name: 'я'.repeat(201) }), [
    'name',
  ]);

  assert.deepEqual(await invalidProps(UpdateStorageCellDto, {}), []);
  assert.deepEqual(await invalidProps(UpdateStorageCellDto, { name: null, sortOrder: 0 }), []);
  assert.deepEqual(await invalidProps(UpdateStorageCellDto, { sortOrder: -1 }), ['sortOrder']);
  assert.deepEqual(await invalidProps(UpdateStorageCellDto, { sortOrder: 1.5 }), ['sortOrder']);
  assert.deepEqual(await invalidProps(UpdateStorageCellDto, { sortOrder: 2_000_000 }), ['sortOrder']);

  assert.deepEqual(await invalidProps(UpdateStorageCellsOrderDto, { orderedIds: [CA, CB] }), []);
  assert.deepEqual(await invalidProps(UpdateStorageCellsOrderDto, { orderedIds: [CA, 'x'] }), ['orderedIds']);
  assert.deepEqual(await invalidProps(UpdateStorageCellsOrderDto, {}), ['orderedIds']);
});

test('DTO товара: storageCellId — uuid, null (снять адрес) или не передан; мусор отклоняется', async () => {
  assert.deepEqual(await invalidProps(CreateProductDto, { name: 'Масло' }), []);
  assert.deepEqual(await invalidProps(CreateProductDto, { name: 'Масло', storageCellId: null }), []);
  assert.deepEqual(await invalidProps(CreateProductDto, { name: 'Масло', storageCellId: CA }), []);
  assert.deepEqual(await invalidProps(CreateProductDto, { name: 'Масло', storageCellId: 'A-1' }), ['storageCellId']);
  assert.deepEqual(await invalidProps(UpdateProductDto, {}), []);
  assert.deepEqual(await invalidProps(UpdateProductDto, { storageCellId: null }), []);
  assert.deepEqual(await invalidProps(UpdateProductDto, { storageCellId: CA }), []);
  assert.deepEqual(await invalidProps(UpdateProductDto, { storageCellId: 'A-1' }), ['storageCellId']);
});

// ── StorageCellsService ────────────────────────────────────────────────────────

const cellRow = (over = {}) => ({
  id: CA,
  warehouse_id: W1,
  code: 'A-1',
  name: null,
  sort_order: 0,
  products_count: 0,
  ...over,
});

test('StorageCellsService.list: только склад из запроса, productsCount — числом', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT sc\.id, sc\.warehouse_id/.test(sql)) return { rows: [cellRow({ products_count: '3' })] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);

  assert.deepEqual(await service.list(T, W1, null), [
    { id: CA, warehouseId: W1, code: 'A-1', name: null, sortOrder: 0, productsCount: 3 },
  ]);
  const q = findOne(pool, /^SELECT sc\.id/);
  assert.match(q.sql, /WHERE sc\.tenant_id = \$1 AND sc\.warehouse_id = \$2 ORDER BY sc\.sort_order, sc\.code/);
  assert.deepEqual(q.params, [T, W1]);
  assert.match(q.sql, /p\.deleted_at IS NULL/, 'товары из корзины ячейку не «занимают»');

  await expectHttp(() => service.list(T, undefined, null), 400);
  await expectHttp(() => service.list(T, 'undefined', null), 400);
});

test('StorageCellsService.create: код нормализуется, подпись trim, дубль — 409 STORAGE_CELL_EXISTS', async () => {
  const pool = makePool((sql) => {
    if (/^INSERT INTO storage_cells/.test(sql)) return { rows: [cellRow({ code: 'A-1', name: null })] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);

  const created = await service.create(T, { warehouseId: W1, code: '  a-1 ', name: '   ' }, null);
  assert.equal(created.productsCount, 0);
  assert.deepEqual(findOne(pool, /^INSERT INTO storage_cells/).params, [T, W1, 'A-1', null]);

  await service.create(T, { warehouseId: W1, code: 'B-2', name: '  Верхняя полка ' }, null);
  assert.equal(findAll(pool, /^INSERT INTO storage_cells/)[1].params[3], 'Верхняя полка');

  const dup = makePool((sql) => {
    if (/^INSERT INTO storage_cells/.test(sql)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
  });
  const body = await expectHttp(
    () => new StorageCellsService(dup, fakeWarehouses).create(T, { warehouseId: W1, code: 'a-1' }, null),
    409,
    'STORAGE_CELL_EXISTS',
  );
  assert.equal(body.message, 'Ячейка «A-1» уже есть на этом складе');

  // Прочие ошибки БД не маскируются под «дубль».
  const broken = makePool(() => {
    throw Object.assign(new Error('boom'), { code: '08006' });
  });
  await assert.rejects(
    () => new StorageCellsService(broken, fakeWarehouses).create(T, { warehouseId: W1, code: 'A' }, null),
    /boom/,
  );
});

test('StorageCellsService.create: пустой код, слишком длинный код и не-uuid склад — 400 до обращения к БД', async () => {
  const pool = makePool((sql) => {
    if (/^INSERT INTO storage_cells/.test(sql)) return { rows: [cellRow()] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);
  await expectHttp(() => service.create(T, { warehouseId: W1, code: '   ' }, null), 400);
  await expectHttp(() => service.create(T, { warehouseId: W1, code: 'X'.repeat(MAX_CELL_CODE_LENGTH + 1) }, null), 400);
  await expectHttp(() => service.create(T, { warehouseId: 'не-uuid', code: 'A' }, null), 400);
  assert.equal(pool.log.length, 0);
  // Ровно лимит — можно.
  await service.create(T, { warehouseId: W1, code: 'X'.repeat(MAX_CELL_CODE_LENGTH) }, null);
  assert.equal(pool.log.length, 1);
});

test('StorageCellsService.bulkCreate: нормализация, повторы и пустые отброшены, skipped — уже существующие', async () => {
  const pool = makePool((sql) => {
    // База «уже знает» B-2: вставились только A-1 и C-3.
    if (/^INSERT INTO storage_cells/.test(sql)) return { rows: [{ code: 'A-1' }, { code: 'C-3' }] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);

  const result = await service.bulkCreate(
    T,
    { warehouseId: W1, codes: ['a-1', 'A-1', ' b-2 ', '', '   ', 'c-3'] },
    null,
  );

  assert.deepEqual(result, { created: 2, skipped: ['B-2'] });
  const insert = findOne(pool, /^INSERT INTO storage_cells/);
  assert.deepEqual(insert.params, [T, W1, ['A-1', 'B-2', 'C-3']]);
  assert.match(insert.sql, /ON CONFLICT DO NOTHING RETURNING code/, 'дубль — не ошибка, а «пропущено»');
  assert.equal(findAll(pool, /INSERT INTO storage_cells/).length, 1, 'один оператор = атомарно');
});

test('StorageCellsService.bulkCreate: 2000 — можно, 2001 — 400; пустой список и слишком длинный код', async () => {
  const pool = makePool((sql) => {
    if (/^INSERT INTO storage_cells/.test(sql)) return { rows: [] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);
  const many = (n) => Array.from({ length: n }, (_, i) => `A-${i + 1}`);

  await service.bulkCreate(T, { warehouseId: W1, codes: many(MAX_BULK_CELLS) }, null);
  assert.equal(pool.log.length, 1);
  assert.equal(pool.log[0].params[2].length, MAX_BULK_CELLS);

  const before = pool.log.length;
  await expectHttp(() => service.bulkCreate(T, { warehouseId: W1, codes: many(MAX_BULK_CELLS + 1) }, null), 400);
  await expectHttp(() => service.bulkCreate(T, { warehouseId: W1, codes: ['X'.repeat(65)] }, null), 400);
  await expectHttp(() => service.bulkCreate(T, { warehouseId: W1, codes: 'A-1' }, null), 400);
  assert.equal(pool.log.length, before, 'отказ — до записи');

  assert.deepEqual(await service.bulkCreate(T, { warehouseId: W1, codes: [' ', ''] }, null), {
    created: 0,
    skipped: [],
  });
  assert.equal(pool.log.length, before, 'пустой список запросов не делает');
});

test('StorageCellsService.update: нормализует код, дубль при переименовании — 409, пустое имя снимает подпись', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT sc\.id/.test(sql)) return { rows: [cellRow({ code: 'A-1', name: 'Старая' })] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);

  // Тот же код после нормализации + нет других полей — записи нет вовсе.
  await service.update(T, CA, { code: ' a-1 ' }, null);
  assert.equal(findAll(pool, /^UPDATE storage_cells/).length, 0);

  await service.update(T, CA, { name: '' }, null);
  const rename = findOne(pool, /^UPDATE storage_cells SET name = \$1 WHERE id = \$2 AND tenant_id = \$3/);
  assert.deepEqual(rename.params, [null, CA, T]);

  await service.update(T, CA, { code: 'b-7', sortOrder: 4 }, null);
  const both = findAll(pool, /^UPDATE storage_cells/)[1];
  assert.match(both.sql, /SET code = \$1, sort_order = \$2 WHERE id = \$3 AND tenant_id = \$4/);
  assert.deepEqual(both.params, ['B-7', 4, CA, T]);

  const dup = makePool((sql) => {
    if (/^SELECT sc\.id/.test(sql)) return { rows: [cellRow()] };
    if (/^UPDATE storage_cells/.test(sql)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
  });
  const body = await expectHttp(
    () => new StorageCellsService(dup, fakeWarehouses).update(T, CA, { code: 'b-2' }, null),
    409,
    'STORAGE_CELL_EXISTS',
  );
  assert.match(body.message, /B-2/);

  const missing = makePool();
  await expectHttp(() => new StorageCellsService(missing, fakeWarehouses).update(T, CA, { name: 'x' }, null), 404);
});

test('StorageCellsService: ячейка чужого филиала — «не найдена» (доступ через склад ячейки)', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT sc\.id/.test(sql)) return { rows: [] };
  });
  const service = new StorageCellsService(pool, fakeWarehouses);
  await expectHttp(() => service.update(T, CA, { name: 'x' }, POINT), 404);
  const q = findOne(pool, /^SELECT sc\.id/);
  assert.match(
    q.sql,
    /EXISTS \(SELECT 1 FROM warehouses wpt WHERE wpt\.id = sc\.warehouse_id AND wpt\.point_id = \$3\)/,
  );
  assert.deepEqual(q.params, [CA, T, POINT]);
});

test('StorageCellsService.updateOrder: один UPDATE, мусор и повторы отброшены, пустой список — без запроса', async () => {
  const pool = makePool();
  const service = new StorageCellsService(pool, fakeWarehouses);

  assert.deepEqual(await service.updateOrder(T, [CB, 'нет', CA, CB.toUpperCase(), null], null), { message: 'OK' });
  const q = findOne(pool, /^UPDATE storage_cells SET sort_order = v\.pos - 1/);
  assert.deepEqual(q.params, [[CB, CA, CB.toUpperCase()], T]);
  assert.equal(pool.log.length, 1);

  assert.deepEqual(await service.updateOrder(T, [], null), { message: 'OK' });
  assert.deepEqual(await service.updateOrder(T, ['нет'], null), { message: 'OK' });
  assert.equal(pool.log.length, 1);

  await service.updateOrder(T, [CA], POINT);
  const scoped = pool.log[1];
  assert.match(scoped.sql, /wpt\.id = storage_cells\.warehouse_id AND wpt\.point_id = \$3/);
  assert.deepEqual(scoped.params, [[CA], T, POINT]);
});

/** Пул под StorageCellsService.remove: ячейка A (склад W1, `count` товаров), опционально целевая B. */
function removePool({ count = 0, target, locked }) {
  return makePool((sql) => {
    if (/^SELECT sc\.id, sc\.warehouse_id/.test(sql)) return { rows: [cellRow({ products_count: count })] };
    if (/^SELECT warehouse_id FROM storage_cells/.test(sql)) return { rows: target ? [{ warehouse_id: target }] : [] };
    if (/^SELECT id FROM storage_cells WHERE id = ANY/.test(sql)) {
      return { rows: (locked || [CA, CB]).map((id) => ({ id })) };
    }
    if (/^SELECT COUNT\(\*\)::int AS n FROM products/.test(sql)) return { rows: [{ n: count }] };
  });
}

test('StorageCellsService.remove: пустая ячейка удаляется сразу, одной транзакцией', async () => {
  const pool = removePool({ count: 0 });
  const service = new StorageCellsService(pool, fakeWarehouses);

  assert.deepEqual(await service.remove(T, CA, {}, null), { ok: true });

  const sqls = pool.log.map((q) => q.sql);
  assert.ok(sqls.indexOf('BEGIN') < sqls.findIndex((s) => /^DELETE FROM storage_cells/.test(s)));
  assert.equal(sqls[sqls.length - 1], 'COMMIT');
  assert.match(allSql(pool), /ORDER BY id FOR UPDATE/, 'ячейка заблокирована до подсчёта товаров');
  assert.equal(pool.released, 1);
});

test('StorageCellsService.remove: с товарами без moveTo/detach — 409 STORAGE_CELL_NOT_EMPTY + productsCount', async () => {
  const pool = removePool({ count: 3 });
  const service = new StorageCellsService(pool, fakeWarehouses);

  const body = await expectHttp(() => service.remove(T, CA, {}, null), 409, 'STORAGE_CELL_NOT_EMPTY');
  assert.equal(body.productsCount, 3);
  assert.match(body.message, /A-1/);

  assert.equal(findAll(pool, /^DELETE FROM storage_cells/).length, 0, 'ячейка не удалена');
  assert.equal(findAll(pool, /^UPDATE products/).length, 0, 'адреса не тронуты');
  assert.equal(pool.log[pool.log.length - 1].sql, 'ROLLBACK');
  assert.equal(pool.released, 1, 'клиент возвращён в пул и при отказе');
});

test('StorageCellsService.remove: detach снимает адрес у товаров и удаляет ячейку', async () => {
  const pool = removePool({ count: 3, locked: [CA] });
  const service = new StorageCellsService(pool, fakeWarehouses);

  assert.deepEqual(await service.remove(T, CA, { detach: true }, null), { ok: true });

  const upd = findOne(
    pool,
    /^UPDATE products SET storage_cell_id = \$1 WHERE storage_cell_id = \$2 AND tenant_id = \$3/,
  );
  assert.deepEqual(upd.params, [null, CA, T]);
  assert.deepEqual(findOne(pool, /^DELETE FROM storage_cells/).params, [CA, T]);
  assert.equal(pool.log[pool.log.length - 1].sql, 'COMMIT');
});

test('StorageCellsService.remove: moveTo той же склад — товары переезжают, регистр uuid не важен', async () => {
  const pool = removePool({ count: 2, target: W1 });
  const service = new StorageCellsService(pool, fakeWarehouses);

  assert.deepEqual(await service.remove(T, CA.toUpperCase(), { moveTo: ` ${CB.toUpperCase()} ` }, null), { ok: true });

  assert.deepEqual(findOne(pool, /^SELECT sc\.id/).params, [CA, T], 'id из URL приведён к виду БД');
  assert.deepEqual(findOne(pool, /^SELECT id FROM storage_cells WHERE id = ANY/).params, [[CA, CB], T]);
  const upd = findOne(pool, /^UPDATE products SET storage_cell_id/);
  assert.deepEqual(upd.params, [CB, CA, T]);
  assert.equal(findAll(pool, /^DELETE FROM storage_cells/).length, 1);
});

test('StorageCellsService.remove: moveTo на ячейку ДРУГОГО склада или несуществующую — 400 STORAGE_CELL_WRONG_WAREHOUSE', async () => {
  const other = removePool({ count: 2, target: W2 });
  await expectHttp(
    () => new StorageCellsService(other, fakeWarehouses).remove(T, CA, { moveTo: CB }, null),
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );
  assert.equal(findAll(other, /^BEGIN/).length, 0, 'до транзакции дело не дошло');

  const absent = removePool({ count: 2 });
  await expectHttp(
    () => new StorageCellsService(absent, fakeWarehouses).remove(T, CA, { moveTo: CB }, null),
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );

  // Целевую удалили между проверкой и блокировкой — тот же отказ, транзакция откатывается.
  const raced = removePool({ count: 2, target: W1, locked: [CA] });
  await expectHttp(
    () => new StorageCellsService(raced, fakeWarehouses).remove(T, CA, { moveTo: CB }, null),
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );
  assert.equal(raced.log[raced.log.length - 1].sql, 'ROLLBACK');
  assert.equal(raced.released, 1);
});

test('StorageCellsService.remove: взаимоисключающие и кривые параметры — 400; чужая/пропавшая ячейка — 404', async () => {
  const both = removePool({ count: 1, target: W1 });
  await expectHttp(
    () => new StorageCellsService(both, fakeWarehouses).remove(T, CA, { moveTo: CB, detach: true }, null),
    400,
  );
  assert.equal(both.log.length, 0);

  const self = removePool({ count: 1, target: W1 });
  await expectHttp(() => new StorageCellsService(self, fakeWarehouses).remove(T, CA, { moveTo: CA }, null), 400);

  const junk = removePool({ count: 1 });
  await expectHttp(() => new StorageCellsService(junk, fakeWarehouses).remove(T, CA, { moveTo: 'кухня' }, null), 400);

  const gone = makePool();
  await expectHttp(() => new StorageCellsService(gone, fakeWarehouses).remove(T, CA, { detach: true }, null), 404);

  // Строку успели удалить между чтением и блокировкой.
  const lost = removePool({ count: 0, locked: [] });
  await expectHttp(() => new StorageCellsService(lost, fakeWarehouses).remove(T, CA, {}, null), 404);
  assert.equal(lost.log[lost.log.length - 1].sql, 'ROLLBACK');
  assert.equal(lost.released, 1);
});

// ── ProductsService: ячейка в create / update ──────────────────────────────────

test('ProductsService.update: ячейка другого склада отклоняется 400 STORAGE_CELL_WRONG_WAREHOUSE ДО записи', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT cost_price, sell_price, stock, warehouse_id FROM products/.test(sql)) {
      return { rows: [{ cost_price: '10', sell_price: '20', stock: '5', warehouse_id: W1 }] };
    }
    // storage_cells: ячейки на складе W1 нет.
  });
  const service = new ProductsService(pool, null);

  await expectHttp(() => service.update('p1', T, { storageCellId: CB }, 'u1'), 400, 'STORAGE_CELL_WRONG_WAREHOUSE');

  const lookup = findOne(pool, /^SELECT id, code, name FROM storage_cells/);
  assert.deepEqual(lookup.params, [CB, T, W1], 'проверка идёт против склада ТОВАРА');
  assert.equal(findAll(pool, /UPDATE products/).length, 0, 'ничего не записано');
});

test('ProductsService.update: ячейка склада товара сохраняется, в ответе — код и подпись', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT cost_price, sell_price, stock, warehouse_id FROM products/.test(sql)) {
      return { rows: [{ cost_price: '350', sell_price: '500', stock: '3', warehouse_id: W1 }] };
    }
    if (/^SELECT id, code, name FROM storage_cells/.test(sql))
      return { rows: [{ id: CA, code: 'A-1', name: 'Верхняя' }] };
    if (/^WITH upd AS/.test(sql)) {
      return {
        rows: [productRow({ storage_cell_id: CA, storage_cell_code: 'A-1', storage_cell_name: 'Верхняя' })],
      };
    }
  });
  const service = new ProductsService(pool, null);

  const result = await service.update('p1', T, { storageCellId: CA }, 'u1');

  assert.equal(result.storageCellId, CA);
  assert.equal(result.storageCellCode, 'A-1');
  assert.equal(result.storageCellName, 'Верхняя');
  const write = findOne(pool, /^WITH upd AS/);
  assert.match(write.sql, /UPDATE products SET storage_cell_id=\$1 WHERE id=\$2 AND tenant_id=\$3 RETURNING \*/);
  assert.deepEqual(write.params, [CA, 'p1', T]);
});

test('ProductsService.update: storageCellId=null снимает адрес без лишних запросов', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT cost_price, sell_price, stock, warehouse_id FROM products/.test(sql)) {
      return { rows: [{ cost_price: '350', sell_price: '500', stock: '3', warehouse_id: W1 }] };
    }
    if (/^WITH upd AS/.test(sql)) return { rows: [productRow({ storage_cell_id: null })] };
  });
  const service = new ProductsService(pool, null);

  const result = await service.update('p1', T, { storageCellId: null }, 'u1');

  assert.equal(result.storageCellId, null);
  assert.equal(result.storageCellCode, null);
  assert.equal(findAll(pool, /FROM storage_cells WHERE/).length, 0, 'снятие адреса ячейку не читает');
  const write = findOne(pool, /^WITH upd AS/);
  assert.match(write.sql, /UPDATE products SET storage_cell_id=NULL WHERE id=\$1 AND tenant_id=\$2 RETURNING \*/);
  assert.deepEqual(write.params, ['p1', T]);
});

test('ProductsService.update: смена склада без storageCellId сбрасывает адрес; с ячейкой нового склада — ставит её', async () => {
  const handler = (sql) => {
    if (/^SELECT cost_price, sell_price, stock, warehouse_id FROM products/.test(sql)) {
      return { rows: [{ cost_price: '350', sell_price: '500', stock: '3', warehouse_id: W1 }] };
    }
    if (/^SELECT id, kind FROM warehouses/.test(sql)) return { rows: [{ id: W2, kind: 'main' }] };
    if (/^SELECT id, code, name FROM storage_cells/.test(sql)) return { rows: [{ id: CB, code: 'B-9', name: null }] };
    if (/^WITH upd AS/.test(sql)) {
      return { rows: [productRow({ warehouse_id: W2, storage_cell_id: null })] };
    }
  };

  const reset = makePool(handler);
  const moved = await new ProductsService(reset, null).update('p1', T, { warehouseId: W2 }, 'u1');
  assert.equal(moved.warehouseId, W2);
  assert.equal(moved.storageCellId, null);
  const resetWrite = findOne(reset, /^WITH upd AS/);
  assert.match(
    resetWrite.sql,
    /UPDATE products SET warehouse_id=\$1, storage_cell_id=NULL WHERE id=\$2 AND tenant_id=\$3/,
  );

  const withCell = makePool(handler);
  await new ProductsService(withCell, null).update('p1', T, { warehouseId: W2, storageCellId: CB }, 'u1');
  assert.deepEqual(
    findOne(withCell, /^SELECT id, code, name FROM storage_cells/).params,
    [CB, T, W2],
    'ячейка проверяется против НОВОГО склада',
  );
  assert.match(findOne(withCell, /^WITH upd AS/).sql, /SET warehouse_id=\$1, storage_cell_id=\$2 WHERE id=\$3/);
});

test('ProductsService.update: склад не изменился и storageCellId не пришёл — адрес не трогаем', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT cost_price, sell_price, stock, warehouse_id FROM products/.test(sql)) {
      return { rows: [{ cost_price: '350', sell_price: '500', stock: '3', warehouse_id: W1 }] };
    }
    if (/^SELECT id, kind FROM warehouses/.test(sql)) return { rows: [{ id: W1, kind: 'main' }] };
    if (/^WITH upd AS/.test(sql)) return { rows: [productRow({ storage_cell_id: CA })] };
  });
  const service = new ProductsService(pool, null);

  await service.update('p1', T, { name: 'Новое имя', warehouseId: W1 }, 'u1');

  const setPart = findOne(pool, /^WITH upd AS/).sql.match(/UPDATE products SET (.*?) WHERE id=/)[1];
  assert.equal(setPart, 'name=$1, warehouse_id=$2');
  assert.equal(findAll(pool, /FROM storage_cells WHERE/).length, 0);
});

test('ProductsService.update: ячейку нельзя назначить несуществующему товару — 404, а не «неверная ячейка»', async () => {
  const pool = makePool(); // SELECT текущей строки вернёт пусто
  const service = new ProductsService(pool, null);

  await expectHttp(() => service.update('p1', T, { storageCellId: CA }, 'u1'), 404);
  assert.equal(findAll(pool, /FROM storage_cells WHERE/).length, 0);
});

test('ProductsService.create: ячейка другого склада — 400 до INSERT; своя — пишется и возвращается с кодом', async () => {
  const noCell = makePool((sql) => {
    if (/^SELECT id, kind FROM warehouses/.test(sql)) return { rows: [{ id: W1, kind: 'main' }] };
  });
  await expectHttp(
    () => new ProductsService(noCell, null).create(T, { name: 'Масло', warehouseId: W1, storageCellId: CB }, null),
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );
  assert.deepEqual(findOne(noCell, /^SELECT id, code, name FROM storage_cells/).params, [CB, T, W1]);
  assert.equal(findAll(noCell, /^INSERT INTO products/).length, 0);

  const ok = makePool((sql) => {
    if (/^SELECT id, kind FROM warehouses/.test(sql)) return { rows: [{ id: W1, kind: 'main' }] };
    if (/^SELECT id, code, name FROM storage_cells/.test(sql)) return { rows: [{ id: CA, code: 'A-1', name: null }] };
    if (/^INSERT INTO products/.test(sql)) return { rows: [productRow({ storage_cell_id: CA })] };
  });
  const created = await new ProductsService(ok, null).create(
    T,
    { name: 'Масло', category: 'Масла', warehouseId: W1, storageCellId: CA },
    null,
  );
  assert.equal(created.storageCellId, CA);
  assert.equal(created.storageCellCode, 'A-1');
  const insert = findOne(ok, /^INSERT INTO products/);
  assert.match(insert.sql, /storage_cell_id\) VALUES/);
  assert.equal(insert.params[15], CA);

  // Без storageCellId адреса нет, ячейки не читаются.
  const plain = makePool((sql) => {
    if (/^SELECT id, kind FROM warehouses/.test(sql)) return { rows: [{ id: W1, kind: 'main' }] };
    if (/^INSERT INTO products/.test(sql)) return { rows: [productRow()] };
  });
  const bare = await new ProductsService(plain, null).create(T, { name: 'Масло', warehouseId: W1 }, null);
  assert.equal(bare.storageCellId, null);
  assert.equal(bare.storageCellCode, null);
  assert.equal(findAll(plain, /FROM storage_cells WHERE/).length, 0);
  assert.equal(findOne(plain, /^INSERT INTO products/).params[15], null);
});

// ── ProductsService: список, фильтр, поиск ─────────────────────────────────────

test('ProductsService.getAll: поиск ищет и по коду ячейки, JOIN есть и в счётчике', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT COUNT/.test(sql)) return { rows: [{ total: '1' }] };
    if (/^SELECT p\.\*/.test(sql)) {
      return { rows: [productRow({ storage_cell_id: CA, storage_cell_code: 'A-1', storage_cell_name: 'Верх' })] };
    }
  });
  const service = new ProductsService(pool, null);

  const result = await service.getAll(T, { search: 'a-1' }, undefined);

  assert.equal(result.total, 1);
  assert.equal(result.data[0].storageCellCode, 'A-1');
  assert.equal(result.data[0].storageCellName, 'Верх');
  assert.equal(result.data[0].storageCellId, CA);
  for (const q of pool.log) {
    assert.match(q.sql, /LEFT JOIN storage_cells sc ON sc\.id = p\.storage_cell_id/);
    assert.match(q.sql, /OR sc\.code ILIKE \$2\)/);
    assert.equal(q.params[1], '%a-1%');
  }
  assert.match(pool.log[1].sql, /sc\.code AS storage_cell_code, sc\.name AS storage_cell_name/);
});

test('ProductsService.getAll: фильтр storageCellId — uuid | none; мусор игнорируется (не 22P02)', async () => {
  const run = async (query) => {
    const pool = makePool((sql) => (/^SELECT COUNT/.test(sql) ? { rows: [{ total: '0' }] } : undefined));
    await new ProductsService(pool, null).getAll(T, query, undefined);
    return pool.log[0];
  };

  const byCell = await run({ storageCellId: CA.toUpperCase() });
  assert.match(byCell.sql, /AND p\.storage_cell_id = \$2/);
  assert.equal(byCell.params[1], CA.toUpperCase());

  const withSearch = await run({ search: 'x', storageCellId: CA });
  assert.match(withSearch.sql, /sc\.code ILIKE \$2\)/);
  assert.match(withSearch.sql, /AND p\.storage_cell_id = \$3/);
  assert.deepEqual(withSearch.params.slice(0, 3), [T, '%x%', CA]);

  const none = await run({ storageCellId: 'none' });
  assert.match(none.sql, /AND p\.storage_cell_id IS NULL/);
  assert.equal(none.params.length, 1, 'none — без параметра');

  for (const junk of ['undefined', ' ', 'null', 'A-1', 42, undefined]) {
    const q = await run({ storageCellId: junk });
    assert.doesNotMatch(q.sql, /AND p\.storage_cell_id/, `мусор ${JSON.stringify(junk)} не должен попасть в WHERE`);
  }
});

// ── ProductsService.bulkAssignCell ─────────────────────────────────────────────

/** Пул bulk-assign: `cell` — склад ячейки (или null: не найдена), `products` — что вернёт SELECT товаров. */
function assignPool({ cell, products, updatedCount = 0 }) {
  return makePool((sql) => {
    if (/^SELECT sc\.warehouse_id FROM storage_cells/.test(sql)) return { rows: cell ? [{ warehouse_id: cell }] : [] };
    if (/^SELECT p\.id, p\.warehouse_id/.test(sql)) return { rows: products };
    if (/^UPDATE products SET storage_cell_id/.test(sql)) return { rowCount: updatedCount, rows: [] };
  });
}

test('bulkAssignCell: товары складa ячейки кладутся в неё одной транзакцией; в ответе — реально изменённые', async () => {
  const pool = assignPool({
    cell: W1,
    products: [
      { id: P1, warehouse_id: W1, trashed: false },
      { id: P2, warehouse_id: W1, trashed: false },
      { id: P3, warehouse_id: W1, trashed: true }, // корзина — пропускаем молча
    ],
    updatedCount: 1, // второй товар уже лежал в этой ячейке
  });
  const service = new ProductsService(pool, null);

  const result = await service.bulkAssignCell(
    T,
    { productIds: [P1.toUpperCase(), P2, P3, P1], storageCellId: CA },
    null,
  );

  assert.deepEqual(result, { updated: 1 });
  const sqls = pool.log.map((q) => q.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.equal(sqls[sqls.length - 1], 'COMMIT');
  assert.equal(pool.released, 1);

  const cellQ = findOne(pool, /^SELECT sc\.warehouse_id/);
  assert.match(cellQ.sql, /FOR SHARE$/);
  assert.deepEqual(cellQ.params, [CA, T]);
  const prodQ = findOne(pool, /^SELECT p\.id, p\.warehouse_id/);
  assert.match(prodQ.sql, /ORDER BY p\.id FOR UPDATE$/, 'порядок блокировок: ячейка, затем товары по id');
  assert.deepEqual(prodQ.params, [[P1, P2, P3], T], 'id приведены к нижнему регистру, повторы схлопнуты');
  const upd = findOne(pool, /^UPDATE products SET storage_cell_id = \$1::uuid/);
  assert.match(upd.sql, /storage_cell_id IS DISTINCT FROM \$1::uuid/);
  assert.deepEqual(upd.params, [CA, [P1, P2], T], 'корзина в запись не попала');
});

test('bulkAssignCell: товар другого склада или неизвестный id — 400 STORAGE_CELL_WRONG_WAREHOUSE со списком, запись не идёт', async () => {
  const pool = assignPool({
    cell: W1,
    products: [
      { id: P1, warehouse_id: W1, trashed: false },
      { id: P2, warehouse_id: W2, trashed: false }, // чужой склад
    ],
  });
  const service = new ProductsService(pool, null);

  const body = await expectHttp(
    () => service.bulkAssignCell(T, { productIds: [P1, P2, P3], storageCellId: CA }, null), // P3 не вернулся из БД
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );

  assert.deepEqual([...body.productIds].sort(), [P2, P3].sort());
  assert.equal(findAll(pool, /^UPDATE products/).length, 0);
  assert.equal(pool.log[pool.log.length - 1].sql, 'ROLLBACK');
  assert.equal(pool.released, 1);
});

test('bulkAssignCell: ячейка не найдена (чужой филиал / тенант) — 400 без чтения товаров', async () => {
  const pool = assignPool({ cell: null, products: [] });
  await expectHttp(
    () => new ProductsService(pool, null).bulkAssignCell(T, { productIds: [P1], storageCellId: CA }, null),
    400,
    'STORAGE_CELL_WRONG_WAREHOUSE',
  );
  assert.equal(findAll(pool, /^SELECT p\.id/).length, 0);
  assert.equal(pool.released, 1);
});

test('bulkAssignCell: storageCellId=null снимает адрес, неизвестные id молча пропускаются', async () => {
  const pool = assignPool({
    products: [
      { id: P1, warehouse_id: W1, trashed: false },
      { id: P2, warehouse_id: W2, trashed: false }, // склад значения не имеет — адрес снимаем у всех живых
    ],
    updatedCount: 2,
  });
  const service = new ProductsService(pool, null);

  assert.deepEqual(await service.bulkAssignCell(T, { productIds: [P1, P2, P3], storageCellId: null }, null), {
    updated: 2,
  });
  assert.equal(findAll(pool, /FROM storage_cells/).length, 0, 'ячейка не читается');
  assert.deepEqual(findOne(pool, /^UPDATE products SET storage_cell_id/).params, [null, [P1, P2], T]);
});

test('bulkAssignCell: филиал сессии режет и ячейку, и товары через склад', async () => {
  const pool = assignPool({ cell: W1, products: [{ id: P1, warehouse_id: W1, trashed: false }], updatedCount: 1 });
  await new ProductsService(pool, null).bulkAssignCell(T, { productIds: [P1], storageCellId: CA }, POINT);

  const cellQ = findOne(pool, /^SELECT sc\.warehouse_id/);
  assert.match(cellQ.sql, /wpt\.id = sc\.warehouse_id AND wpt\.point_id = \$3/);
  assert.deepEqual(cellQ.params, [CA, T, POINT]);
  const prodQ = findOne(pool, /^SELECT p\.id/);
  assert.match(prodQ.sql, /wpt\.id = p\.warehouse_id AND wpt\.point_id = \$3/);
  assert.deepEqual(prodQ.params, [[P1], T, POINT]);
});

test('bulkAssignCell: сбой БД — 500 с русским текстом и ROLLBACK, клиент возвращён в пул', async () => {
  const pool = makePool((sql) => {
    if (/^SELECT p\.id/.test(sql)) throw new Error('connection reset');
  });
  await expectHttp(
    () => new ProductsService(pool, null).bulkAssignCell(T, { productIds: [P1], storageCellId: null }, null),
    500,
  );
  assert.equal(pool.log[pool.log.length - 1].sql, 'ROLLBACK');
  assert.equal(pool.released, 1);
});

// ── CSV ────────────────────────────────────────────────────────────────────────

test('exportCsv: «Ячейка» — последняя колонка, прежние семь на месте, у товара без адреса — пусто', async () => {
  const pool = makePool((sql) => {
    if (/FROM products p LEFT JOIN storage_cells sc/.test(sql)) {
      return {
        rows: [
          {
            name: 'Масло',
            category: 'Масла',
            unit: 'шт',
            sell_price: '500',
            cost_price: '350',
            stock: '3',
            min_stock: '1',
            storage_cell_code: 'A-1',
          },
          {
            name: 'Фильтр',
            category: 'Фильтры',
            unit: 'шт',
            sell_price: '900',
            cost_price: '600',
            stock: '0',
            min_stock: '2',
            storage_cell_code: null,
          },
        ],
      };
    }
  });

  const lines = (await new ProductsService(pool, null).exportCsv(T, null)).split('\n');

  assert.equal(lines[0], 'Наименование;Группа;Единица измерения;Цена продажи;Цена закупки;Остаток;Мин. остаток;Ячейка');
  assert.equal(lines[1], 'Масло;Масла;шт;500;350;3;1;A-1');
  assert.equal(lines[2], 'Фильтр;Фильтры;шт;900;600;0;2;');
  for (const line of lines) assert.equal(line.split(';').length, 8);
});

/** Пул под importCsv: основной склад W1, `existing` — уже лежащие товары, ячейки `cells` (код → id) находятся по коду. */
function importPool({ existing = [], cells = {} } = {}) {
  return makePool((sql, params) => {
    if (/^SELECT \(SELECT/.test(sql)) return { rows: [{ id: W1 }] };
    if (/^SELECT id, name FROM products/.test(sql)) return { rows: existing };
    if (/^SELECT u\.code AS requested, sc\.id/.test(sql)) {
      return { rows: params[1].filter((code) => cells[code]).map((code) => ({ requested: code, id: cells[code] })) };
    }
  });
}

test('importCsv: колонка «Ячейка» — ячейки ищутся/создаются на складе импорта, адрес идёт и в INSERT, и в UPDATE', async () => {
  const pool = importPool({
    existing: [
      { id: 'p-old-1', name: 'Свеча' },
      { id: 'p-old-2', name: 'Лампа' },
    ],
    cells: { 'A-1': CA, 'B-2': CB },
  });
  const service = new ProductsService(pool, null);

  const result = await service.importCsv(
    T,
    [
      { name: 'Масло', storageCell: ' a-1 ' }, // новый, адрес A-1
      { name: 'Фильтр', storageCell: '' }, // новый, без адреса
      { name: 'Свеча', storageCell: 'b-2' }, // существующий, новый адрес
      { name: 'Лампа' }, // существующий, колонки нет — адрес не трогаем
    ],
    null,
  );

  assert.deepEqual(
    { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors },
    { created: 2, updated: 2, skipped: 0, errors: [] },
  );

  const mk = findOne(pool, /^INSERT INTO storage_cells/);
  assert.deepEqual(mk.params, [T, W1, ['A-1', 'B-2']], 'коды нормализованы и без повторов');
  assert.match(mk.sql, /ON CONFLICT DO NOTHING/);
  const look = findOne(pool, /^SELECT u\.code AS requested, sc\.id/);
  assert.deepEqual(look.params, [W1, ['A-1', 'B-2'], T]);
  assert.match(look.sql, /lower\(sc\.code\) = lower\(u\.code\)/);

  const insert = findOne(pool, /^INSERT INTO products/);
  assert.equal(insert.params[9], CA, 'Масло → A-1');
  assert.equal(insert.params[19], null, 'Фильтр → без адреса');
  const updates = findAll(pool, /^UPDATE products SET category/);
  assert.match(updates[0].sql, /storage_cell_id=COALESCE\(\$9::uuid, storage_cell_id\)/);
  assert.equal(updates[0].params[8], CB, 'Свеча → B-2');
  assert.equal(updates[1].params[8], null, 'Лампа: COALESCE сохранит прежний адрес');

  const sqls = pool.log.map((q) => q.sql);
  assert.ok(
    sqls.findIndex((s) => /^INSERT INTO storage_cells/.test(s)) <
      sqls.findIndex((s) => /^INSERT INTO products/.test(s)),
    'ячейки создаются раньше товаров, в той же транзакции',
  );
  assert.equal(sqls[sqls.length - 1], 'COMMIT');
});

test('importCsv: без колонки «Ячейка» ячейки не создаются и не читаются', async () => {
  const pool = importPool();
  const result = await new ProductsService(pool, null).importCsv(T, [{ name: 'Масло' }, { name: 'Фильтр' }], null);

  assert.equal(result.created, 2);
  assert.equal(findAll(pool, /storage_cells/).length, 0);
  assert.equal(findOne(pool, /^INSERT INTO products/).params[9], null);
});

test('importCsv: код ячейки длиннее лимита не режется — адрес пропущен, товар загружен, в errors заметка', async () => {
  const pool = importPool();
  const result = await new ProductsService(pool, null).importCsv(
    T,
    [
      { name: 'Масло', storageCell: 'Х'.repeat(MAX_CELL_CODE_LENGTH + 1) },
      { name: 'Фильтр', storageCell: 'A-1' },
    ],
    null,
  );

  assert.equal(result.created, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Адрес не сохранён у 1 тов\./);
  assert.deepEqual(findOne(pool, /^INSERT INTO storage_cells/).params[2], ['A-1'], 'длинный код в ячейки не попал');
});
