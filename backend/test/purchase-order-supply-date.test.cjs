const assert = require('node:assert/strict');
const test = require('node:test');

/**
 * Правка #4 бэклога 2026-09-09 — «поставка задним числом» (миграция 159).
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА: (1) при приёмке заказа можно выбрать дату поставки, в
 * том числе прошедшую; (2) у уже ПРОВЕДЁННОЙ поставки дату можно изменить
 * задним числом.
 *
 * КОНТРАКТ, который проверяется здесь на живом сервисе с фейковым пулом:
 *   1. дата в будущем → 400 «Дата поставки не может быть в будущем», в базу
 *      не уходит НИЧЕГО (транзакция даже не открывается);
 *   2. дата старше 3 лет → 400 «Дата поставки не может быть старше 3 лет»;
 *   3. приёмка задним числом датирует ОДНОЙ меткой времени все четыре записи:
 *      движение склада (occurredAt + purchase_order_id), накладную и
 *      авто-платёж (recordOrderSupplyTx.occurredAt), purchase_orders.received_at;
 *   4. приёмка задним числом НЕ затирает известную себестоимость (older-cost не
 *      должен перебивать более свежий last-cost), а приёмка «сегодня» — как
 *      раньше, перезаписывает;
 *   5. смену даты пускаем только у статуса 'received' (иначе 400);
 *   6. смена даты переносит ВСЕ связанные записи (заказ, накладные, платежи по
 *      ним, движения склада) на одну и ту же метку времени, сохраняя время
 *      суток исходной приёмки.
 */

const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');

const TENANT = 'tenant-1';
const ORDER = 'order-1';
const USER = 'user-1';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const mskDay = (ts) => new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Фейковый pg.Pool: отвечает по СОВПАДЕНИЮ SQL (порядок запросов внутри
 * сервиса не зашит в тест) + журнал всех запросов, включая BEGIN/COMMIT.
 */
function makePool(handler, timezone) {
  const log = [];
  const query = async (sql, params) => {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    log.push({ sql: flat, params });
    // Пояс тенанта (157): сервис читает его перед КАЖДОЙ операцией с датой.
    // Отдаём то, что просил тест; по умолчанию — Москва (дефолт миграции).
    if (flat.startsWith('SELECT timezone FROM tenants')) {
      return { rows: [{ timezone: timezone || 'Europe/Moscow' }], rowCount: 1 };
    }
    return { rows: handler(flat, params) || [], rowCount: 0 };
  };
  return {
    log,
    query,
    connect: async () => ({ query, release: () => {} }),
    find: (needle) => log.filter((e) => e.sql.includes(needle)),
    // Только настоящие записи: `SELECT ... FOR UPDATE` — это чтение под локом.
    writes: () => log.filter((e) => /^(UPDATE|INSERT|DELETE)\b/.test(e.sql)),
    // Всё, кроме служебного чтения пояса тенанта: им меряем «сервис не полез в
    // заказ», не завися от того, попал пояс в кеш или нет.
    business: () => log.filter((e) => !e.sql.startsWith('SELECT timezone FROM tenants')),
  };
}

/** Позиция заказа: заказано 5, принято 0. */
const itemRow = () => ({
  id: 'item-1',
  product_id: 'product-1',
  name: 'Масло',
  quantity: '5',
  cost_price: '100',
  received_quantity: '0',
});

/** Пул для receive(): ordered-заказ с одной позицией, полностью принимаемой. */
function receivePool(timezone) {
  return makePool((sql) => {
    if (sql.startsWith('SELECT id, status, supplier_id FROM purchase_orders')) {
      return [{ id: ORDER, status: 'ordered', supplier_id: 'supplier-1' }];
    }
    if (sql.startsWith('SELECT id, product_id, name, quantity, cost_price, received_quantity')) {
      return [itemRow()];
    }
    if (sql.startsWith('SELECT quantity, received_quantity FROM purchase_order_items')) {
      return [{ quantity: '5', received_quantity: '5' }];
    }
    if (sql.startsWith('SELECT po.*')) {
      return [{ id: ORDER, status: 'received', total: '500', created_at: '2026-09-01T00:00:00.000Z' }];
    }
    if (sql.startsWith('SELECT * FROM purchase_order_items')) return [];
    return [];
  }, timezone);
}

function makeService(pool) {
  const stockCalls = [];
  const supplyCalls = [];
  const service = new PurchaseOrdersService(
    pool,
    {
      applyIncomeTx: async (_client, _tenantID, _userID, params) => {
        stockCalls.push(params);
        return { id: 'movement-1', stockAfter: 5, warehouseId: 'wh-1' };
      },
    },
    {
      recordOrderSupplyTx: async (_client, _tenantID, _userID, params) => {
        supplyCalls.push(params);
        return { deliveryId: 'delivery-1', paymentId: 'payment-1', invoiceTotal: 500 };
      },
    },
  );
  return { service, stockCalls, supplyCalls };
}

// ── 1. Будущее запрещено ────────────────────────────────────────────────────
test('приёмка с датой в будущем отклоняется и ничего не пишет', async () => {
  const pool = receivePool();
  const { service } = makeService(pool);
  const tomorrow = mskDay(Date.now() + DAY_MS);

  await assert.rejects(
    () => service.receive(ORDER, TENANT, USER, { paymentMode: 'debt', receivedAt: tomorrow }),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.equal(err.getResponse().message, 'Дата поставки не может быть в будущем');
      return true;
    },
  );
  // Валидация до транзакции: ни BEGIN, ни единого запроса по заказу (чтение
  // пояса тенанта не в счёт — оно не меняет данных и кешируется).
  assert.equal(pool.business().length, 0);
});

// ── 2. Слишком старая дата ──────────────────────────────────────────────────
test('приёмка с датой старше 3 лет отклоняется', async () => {
  const pool = receivePool();
  const { service } = makeService(pool);
  const tooOld = mskDay(Date.now() - 4 * 365 * DAY_MS);

  await assert.rejects(
    () => service.receive(ORDER, TENANT, USER, { paymentMode: 'debt', receivedAt: tooOld }),
    (err) => {
      assert.equal(err.getResponse().message, 'Дата поставки не может быть старше 3 лет');
      return true;
    },
  );
  assert.equal(pool.business().length, 0);
});

// ── 3. Одна дата на все записи приёмки ──────────────────────────────────────
test('приёмка задним числом датирует склад, накладную и заказ ОДНОЙ меткой', async () => {
  const pool = receivePool();
  const { service, stockCalls, supplyCalls } = makeService(pool);
  const threeDaysAgo = mskDay(Date.now() - 3 * DAY_MS);

  await service.receive(ORDER, TENANT, USER, { paymentMode: 'paid', receivedAt: threeDaysAgo });

  // Движение склада: дата поставки + связь с заказом (по ней переносится дата).
  assert.equal(stockCalls.length, 1);
  const occurredAt = stockCalls[0].occurredAt;
  assert.ok(occurredAt, 'occurredAt передан в applyIncomeTx');
  assert.equal(mskDay(new Date(occurredAt).getTime()), threeDaysAgo);
  assert.equal(stockCalls[0].purchaseOrderId, ORDER);

  // Накладная + авто-платёж — та же метка.
  assert.equal(supplyCalls.length, 1);
  assert.equal(supplyCalls[0].occurredAt, occurredAt);

  // purchase_orders.received_at — та же метка.
  const statusUpdate = pool.find("SET status='received'")[0];
  assert.ok(statusUpdate, 'заказ переведён в received');
  assert.equal(statusUpdate.params[2], occurredAt);
});

// ── 4. Себестоимость при back-date ──────────────────────────────────────────
test('back-date не затирает известную себестоимость, приёмка «сегодня» — затирает', async () => {
  const backPool = receivePool();
  const back = makeService(backPool);
  await back.service.receive(ORDER, TENANT, USER, {
    paymentMode: 'paid',
    receivedAt: mskDay(Date.now() - 3 * DAY_MS),
  });
  const backCost = backPool.find('UPDATE products SET cost_price')[0];
  assert.ok(backCost, 'себестоимость трогается и при back-date (для нулевой)');
  assert.match(backCost.sql, /COALESCE\(cost_price,0\)=0/);

  const todayPool = receivePool();
  const today = makeService(todayPool);
  await today.service.receive(ORDER, TENANT, USER, { paymentMode: 'paid', receivedAt: mskDay(Date.now()) });
  const todayCost = todayPool.find('UPDATE products SET cost_price')[0];
  assert.ok(todayCost);
  assert.doesNotMatch(todayCost.sql, /COALESCE\(cost_price,0\)=0/);
});

// ── 5. Смена даты — только у проведённой поставки ───────────────────────────
test('смена даты у непроведённого заказа отклоняется', async () => {
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT status, received_at FROM purchase_orders')) {
      return [{ status: 'ordered', received_at: null }];
    }
    return [];
  });
  const { service } = makeService(pool);

  await assert.rejects(
    () => service.changeReceivedDate(ORDER, TENANT, USER, { receivedAt: mskDay(Date.now() - DAY_MS) }),
    (err) => {
      assert.equal(err.getStatus(), 400);
      assert.equal(err.getResponse().message, 'Дату можно изменить только у проведённой поставки');
      return true;
    },
  );
  // Ни одной записи — только чтение статуса под локом и откат.
  assert.equal(pool.writes().length, 0);
});

// ── 6. Смена даты переносит ВСЕ связанные записи ────────────────────────────
test('смена даты переносит заказ, накладные, платежи и движения склада на одну дату', async () => {
  // Исходная приёмка: 2026-09-01 15:20 МСК.
  const priorIso = '2026-09-01T12:20:00.000Z';
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT status, received_at FROM purchase_orders')) {
      return [{ status: 'received', received_at: new Date(priorIso) }];
    }
    if (sql.startsWith('SELECT po.*')) {
      return [{ id: ORDER, status: 'received', total: '500', created_at: '2026-09-01T00:00:00.000Z' }];
    }
    return [];
  });
  const { service } = makeService(pool);

  const target = mskDay(new Date(priorIso).getTime() - 5 * DAY_MS);
  await service.changeReceivedDate(ORDER, TENANT, USER, { receivedAt: target });

  const poUpdate = pool.find('UPDATE purchase_orders SET received_at')[0];
  const delUpdate = pool.find('UPDATE deliveries SET date')[0];
  const payUpdate = pool.find('UPDATE supplier_payments sp SET date')[0];
  const smUpdate = pool.find('UPDATE stock_movements SET created_at')[0];
  assert.ok(poUpdate && delUpdate && payUpdate && smUpdate, 'все четыре записи переносятся');

  const newIso = poUpdate.params[2];
  assert.equal(mskDay(new Date(newIso).getTime()), target);
  // Время суток исходной приёмки сохранено (документ не прыгает внутри дня).
  assert.equal(new Date(newIso).getTime() % DAY_MS, new Date(priorIso).getTime() % DAY_MS);
  // Ровно одна и та же метка во всех четырёх запросах.
  assert.equal(delUpdate.params[2], newIso);
  assert.equal(payUpdate.params[2], newIso);
  assert.equal(smUpdate.params[2], newIso);
  // Удалённые накладные и сторнированные платежи не трогаем.
  assert.match(delUpdate.sql, /deleted_at IS NULL/);
  assert.match(payUpdate.sql, /reversed_at IS NULL/);
  // Аудит правки.
  assert.match(poUpdate.sql, /date_corrected_at = now\(\)/);
  assert.equal(poUpdate.params[3], USER);
});

// ── 7. Эхо той же даты — без записей ────────────────────────────────────────
test('смена даты на ту же самую не пишет ничего', async () => {
  const priorIso = '2026-09-01T12:20:00.000Z';
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT status, received_at FROM purchase_orders')) {
      return [{ status: 'received', received_at: new Date(priorIso) }];
    }
    if (sql.startsWith('SELECT po.*')) {
      return [{ id: ORDER, status: 'received', total: '500', created_at: '2026-09-01T00:00:00.000Z' }];
    }
    return [];
  });
  const { service } = makeService(pool);

  await service.changeReceivedDate(ORDER, TENANT, USER, {
    receivedAt: mskDay(new Date(priorIso).getTime()),
  });
  assert.equal(pool.writes().length, 0);
});

// ── 8. Пояс тенанта (157): «сегодня» считается по МЕСТНОМУ дню ───────────────
// РЕГРЕССИЯ, из-за которой правка и заводилась: даты поставки жили на жёстком
// московском сдвиге. У владивостокского сервиса (UTC+10) с 00:00 до 06:59 по
// местному времени московский день ещё вчерашний, поэтому «сегодня» из пикера
// отвергалось как будущее, а «вчера» уезжало на сутки. Тест не зависит от
// того, который сейчас час: он всегда спрашивает МЕСТНЫЙ день тенанта.
//
// ВАЖНО: у пояса свой tenantID — getTenantTimezone кеширует значение на 5 минут
// по тенанту, и переиспользование 'tenant-1' подсунуло бы Москву.
const { zonedDateKey } = require('../dist/common/timezone');
const TENANT_VLAD = 'tenant-vladivostok';
const VLAD = 'Asia/Vladivostok';

test('приёмка «сегодня» по местному дню тенанта проходит и датируется этим днём', async () => {
  const pool = receivePool(VLAD);
  const { service, stockCalls } = makeService(pool);
  const localToday = zonedDateKey(new Date(), VLAD);

  await service.receive(ORDER, TENANT_VLAD, USER, { paymentMode: 'debt', receivedAt: localToday });

  assert.equal(stockCalls.length, 1);
  assert.equal(zonedDateKey(new Date(stockCalls[0].occurredAt), VLAD), localToday);
});

test('приёмка «завтра» по местному дню тенанта отклоняется', async () => {
  const pool = receivePool(VLAD);
  const { service } = makeService(pool);
  const localTomorrow = zonedDateKey(new Date(Date.now() + DAY_MS), VLAD);

  await assert.rejects(
    () => service.receive(ORDER, TENANT_VLAD, USER, { paymentMode: 'debt', receivedAt: localTomorrow }),
    (err) => {
      assert.equal(err.getResponse().message, 'Дата поставки не может быть в будущем');
      return true;
    },
  );
  assert.equal(pool.business().length, 0);
});

test('смена даты сохраняет время суток и кладёт документ в местный день тенанта', async () => {
  const priorIso = '2026-09-01T12:20:00.000Z';
  const pool = makePool((sql) => {
    if (sql.startsWith('SELECT status, received_at FROM purchase_orders')) {
      return [{ status: 'received', received_at: new Date(priorIso) }];
    }
    if (sql.startsWith('SELECT po.*')) {
      return [{ id: ORDER, status: 'received', total: '500', created_at: '2026-09-01T00:00:00.000Z' }];
    }
    return [];
  }, VLAD);
  const { service } = makeService(pool);

  const target = zonedDateKey(new Date(new Date(priorIso).getTime() - 5 * DAY_MS), VLAD);
  await service.changeReceivedDate(ORDER, TENANT_VLAD, USER, { receivedAt: target });

  const poUpdate = pool.find('UPDATE purchase_orders SET received_at')[0];
  const newIso = poUpdate.params[2];
  // Документ лёг в ЗАПРОШЕННЫЙ местный день, а не в московский.
  assert.equal(zonedDateKey(new Date(newIso), VLAD), target);
  // Время суток исходной приёмки сохранено (позиция внутри дня не прыгает).
  assert.equal(new Date(newIso).getTime() % DAY_MS, new Date(priorIso).getTime() % DAY_MS);
});
