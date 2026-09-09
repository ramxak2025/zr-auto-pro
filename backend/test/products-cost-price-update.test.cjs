const assert = require('node:assert/strict');
const test = require('node:test');

/**
 * Правка #1 бэклога 2026-09-09 — «не сохраняется закупочная цена товара».
 *
 * КОРНЕВАЯ ПРИЧИНА. Оверселл разрешён продуктово (checks.service: «сток уходит
 * в МИНУС»), поэтому проданный в минус товар лежит в базе с stock < 0, и GET
 * отдаёт это значение клиенту. Форма редактирования присылала товар целиком —
 * вместе с тем же минусом, — а схемная проверка @Min(0) в UpdateProductDto
 * отклоняла ВЕСЬ PATCH («stock must not be less than 0»). Новая себестоимость
 * до базы не доезжала, а клиент показывал немой Alert без текста сервера.
 *
 * КОНТРАКТ ПОСЛЕ ФИКСА (проверяется здесь на живом сервисе с фейковым пулом):
 *   1. эхо уже сохранённого отрицательного остатка — no-op, PATCH проходит,
 *      цена сохраняется, движение по складу НЕ пишется;
 *   2. попытка увести остаток в минус — 400 с русским сообщением;
 *   3. нечисловой остаток — 400 «Остаток должен быть числом»;
 *   4. частичный PATCH (только costPrice) не трогает остаток вообще.
 */

const { ProductsService } = require('../dist/products/products.service');

/**
 * Фейковый pg.Pool: очередь ответов по порядку запросов + журнал SQL.
 * `connect()` отдаёт тот же журнал, поэтому транзакция applyStockPatch видна.
 */
function makePool(responses) {
  const log = [];
  const query = async (sql, params) => {
    log.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    const next = responses.shift();
    return next || { rows: [] };
  };
  const pool = {
    log,
    query,
    connect: async () => ({ query, release: () => {} }),
  };
  return pool;
}

const productRow = (over = {}) => ({
  id: 'p1',
  name: 'Масло',
  category: 'Масла',
  photo: null,
  cost_price: '350',
  sell_price: '500',
  stock: '-3',
  min_stock: '1',
  unit: 'шт',
  is_bundle: false,
  bundle_items: [],
  supplier_id: null,
  warehouse_id: 'w1',
  warranty_days: null,
  barcode: null,
  created_at: '2026-09-09T00:00:00.000Z',
  ...over,
});

test('оверселл: PATCH с эхом отрицательного остатка сохраняет себестоимость', async () => {
  const pool = makePool([
    // SELECT cost_price, sell_price, stock
    { rows: [{ cost_price: '300', sell_price: '500', stock: '-3' }] },
    // основной UPDATE ... RETURNING *
    { rows: [productRow({ cost_price: '350' })] },
    // INSERT price_history
    { rows: [] },
    // applyStockPatch: BEGIN
    { rows: [] },
    // SELECT stock, warehouse_id ... FOR UPDATE
    { rows: [{ stock: '-3', warehouse_id: 'w1' }] },
    // COMMIT
    { rows: [] },
  ]);
  const service = new ProductsService(pool, null);

  const result = await service.update('p1', 't1', { costPrice: 350, stock: -3 }, 'u1');

  assert.equal(result.costPrice, 350, 'новая себестоимость должна вернуться клиенту');
  assert.equal(result.stock, -3, 'остаток остаётся прежним');
  const sql = pool.log.map((q) => q.sql).join('\n');
  assert.match(sql, /UPDATE products SET cost_price=\$1/, 'себестоимость должна уйти в UPDATE');
  assert.doesNotMatch(sql, /INSERT INTO stock_movements/, 'no-op остатка не пишет движение по складу');
  assert.match(sql, /INSERT INTO price_history/, 'смена цены пишется в историю цен');
});

test('увести остаток в минус нельзя — 400 с русским текстом', async () => {
  const pool = makePool([{ rows: [{ cost_price: '300', sell_price: '500', stock: '2' }] }]);
  const service = new ProductsService(pool, null);

  await assert.rejects(
    () => service.update('p1', 't1', { costPrice: 350, stock: -5 }, 'u1'),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.equal(err.getResponse().message, 'Остаток не может быть отрицательным');
      return true;
    },
  );
  assert.doesNotMatch(
    pool.log.map((q) => q.sql).join('\n'),
    /UPDATE products SET/,
    'отказ обязан случиться ДО любой записи (fail-fast)',
  );
});

test('нечисловой остаток — 400 «Остаток должен быть числом»', async () => {
  const pool = makePool([{ rows: [{ cost_price: '300', sell_price: '500', stock: '2' }] }]);
  const service = new ProductsService(pool, null);

  await assert.rejects(
    () => service.update('p1', 't1', { stock: 'abc' }, 'u1'),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.equal(err.getResponse().message, 'Остаток должен быть числом');
      return true;
    },
  );
});

test('частичный PATCH: без поля stock остаток не трогается вовсе', async () => {
  const pool = makePool([
    { rows: [{ cost_price: '300', sell_price: '500', stock: '-3' }] },
    { rows: [productRow({ cost_price: '350' })] },
    { rows: [] }, // price_history
  ]);
  const service = new ProductsService(pool, null);

  const result = await service.update('p1', 't1', { costPrice: 350 }, 'u1');

  assert.equal(result.costPrice, 350);
  const sql = pool.log.map((q) => q.sql).join('\n');
  assert.doesNotMatch(sql, /FOR UPDATE/, 'транзакция остатка не должна открываться');
  assert.doesNotMatch(sql, /INSERT INTO stock_movements/);
});
