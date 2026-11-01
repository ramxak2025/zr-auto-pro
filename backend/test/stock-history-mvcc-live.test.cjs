const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { fixture, options, status } = require('./helpers/nov01-inventory-fixture.cjs');
const { loadStockHistory } = require('../dist/stock-movements/stock-history');
const { captureCheckProductHistory } = require('../dist/checks/check-product-events');
const stale = (error) => error.getStatus?.() === 409 && error.getResponse().code === 'HISTORY_CURSOR_STALE';
const page = (f, query = {}, point = f.point) => f.run(() => f.movements.history(f.tenant, query, point, f.actor));
async function rows(f, productId, count = 3) {
  return f.q(
    `INSERT INTO stock_movements(product_id,tenant_id,type,quantity,stock_before,stock_after,warehouse_id,created_at)
    SELECT $1,$2,'income',1,0,1,$3,'2026-09-01'::timestamptz-g*interval '1 hour'
    FROM generate_series(1,$4::int) g RETURNING id`,
    [productId, f.tenant, f.main, count],
  );
}

test(
  'history native snapshot excludes an earlier INSERT committed after first page, without holding a connection',
  options,
  () =>
    fixture(async (f) => {
      const p = await f.product({ stock: 0 });
      await rows(f, p.id);
      const writer = new Pool({ connectionString: process.env.NOV01_INVENTORY_LIVE_DB, max: 1 });
      const client = await writer.connect();
      try {
        await client.query('BEGIN');
        const delayed = (
          await client.query(
            `INSERT INTO stock_movements(product_id,tenant_id,type,quantity,stock_before,stock_after,warehouse_id,created_at)
      VALUES($1,$2,'income',1,0,1,$3,'2026-08-01') RETURNING id`,
            [p.id, f.tenant, f.main],
          )
        ).rows[0].id;
        let current = await page(f, { productId: p.id, limit: 1 });
        const ids = current.data.map((row) => row.id);
        const firstCursor = current.nextCursor;
        await client.query('COMMIT');
        while (current.nextCursor) {
          current = await page(f, { productId: p.id, limit: 1, cursor: current.nextCursor });
          ids.push(...current.data.map((row) => row.id));
        }
        assert.equal(ids.length, 3);
        assert.equal(new Set(ids).size, 3);
        assert.ok(!ids.includes(delayed));
        assert.equal((await page(f, { productId: p.id })).data.length, 4);
        const old = JSON.parse(Buffer.from(firstCursor, 'base64url'));
        old.v = 1;
        await assert.rejects(
          page(f, { productId: p.id, cursor: Buffer.from(JSON.stringify(old)).toString('base64url') }),
          stale,
        );
        old.v = 2;
        old.transactionSnapshot = '0:18446744073709551616:';
        await assert.rejects(
          page(f, { productId: p.id, cursor: Buffer.from(JSON.stringify(old)).toString('base64url') }),
          status(400),
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await writer.end();
      }
    }, 1),
);

test(
  'first-page header and rows share one snapshot even when legacy baseline cutover commits between them',
  options,
  () =>
    fixture(async (f) => {
      const p = await f.product({ stock: 0 }),
        checkId = randomUUID();
      await f.q('INSERT INTO checks(id,tenant_id,point_id,master_id) VALUES($1,$2,$3,$4)', [
        checkId,
        f.tenant,
        f.point,
        f.owner,
      ]);
      await f.q(
        "INSERT INTO check_product_lines(check_id,product_id,name,quantity) VALUES($1,$2,'Legacy original',1),($1,$2,'Legacy second',1)",
        [checkId, p.id],
      );
      const writer = new Pool({ connectionString: process.env.NOV01_INVENTORY_LIVE_DB, max: 1 });
      let cutover = false;
      const hooked = {
        query: f.pool.query.bind(f.pool),
        connect: async () => {
          const client = await f.pool.connect(),
            realQuery = client.query.bind(client);
          // Do not mutate the pooled client's method: its RLS RESET must use the original.
          return {
            release: client.release.bind(client),
            query: async (sql, values) => {
              const result = await realQuery(sql, values);
              if (!cutover && sql.includes('pg_current_snapshot()')) {
                cutover = true;
                const change = await writer.connect();
                try {
                  await change.query('BEGIN');
                  await captureCheckProductHistory(change, f.tenant, checkId, 'sale_correction', f.owner);
                  await change.query('COMMIT');
                } finally {
                  await change.query('ROLLBACK');
                  change.release();
                }
              }
              return result;
            },
          };
        },
      };
      try {
        const first = await f.run(() =>
          loadStockHistory(hooked, f.tenant, { productId: p.id, includeSales: true, limit: 1 }, f.point, f.actor),
        );
        assert.equal(cutover, true);
        assert.equal(first.data.length, 1);
        assert.ok(first.data[0].id.startsWith('sale:'));
        assert.ok(first.nextCursor);
        await assert.rejects(
          page(f, { productId: p.id, includeSales: true, limit: 1, cursor: first.nextCursor }),
          stale,
        );
        const fresh = await page(f, { productId: p.id, includeSales: true });
        assert.equal(fresh.data.length, 1);
        assert.equal(fresh.data[0].type, 'legacy_baseline');
      } finally {
        await writer.end();
      }
    }, 1),
);

test('committed sort-key mutation and deletion invalidate cursors; unchanged reads do not', options, () =>
  fixture(async (f) => {
    const p = await f.product({ stock: 0 }),
      inserted = await rows(f, p.id);
    let first = await page(f, { productId: p.id, limit: 1 });
    await page(f, { productId: p.id, limit: 1, cursor: first.nextCursor });
    await f.q("UPDATE stock_movements SET created_at=created_at-interval '1 day' WHERE id=$1", [inserted[0].id]);
    await assert.rejects(page(f, { productId: p.id, limit: 1, cursor: first.nextCursor }), stale);
    first = await page(f, { productId: p.id, limit: 1 });
    await f.q('DELETE FROM stock_movements WHERE id=$1', [inserted[1].id]);
    await assert.rejects(page(f, { productId: p.id, limit: 1, cursor: first.nextCursor }), stale);
  }),
);

test('future transfers retain one global event and exact source/target identity and balances', options, () =>
  fixture(async (f) => {
    const source = await f.product({ stock: 10 });
    const target = await f.product({ stock: 7, warehouseId: f.used });
    const move = await f.run(() =>
      f.movements.create(
        f.tenant,
        f.owner,
        {
          type: 'used_transfer',
          productId: source.id,
          quantity: 3,
          sourceWarehouseId: f.main,
          targetWarehouseId: f.used,
        },
        f.point,
        f.actor,
      ),
    );
    assert.equal(move.targetProductId, target.id);
    const outgoing = (await page(f, { productId: source.id, type: 'used_transfer' })).data[0];
    assert.equal(outgoing.productId, source.id);
    assert.equal(outgoing.stockBefore, 10);
    assert.equal(outgoing.stockAfter, 7);
    assert.equal(outgoing.direction, 'out');
    const incoming = (await page(f, { productId: target.id, type: 'used_transfer' })).data[0];
    assert.equal(incoming.productId, target.id);
    assert.equal(incoming.stockBefore, 7);
    assert.equal(incoming.stockAfter, 10);
    assert.equal(incoming.stockDelta, 3);
    assert.equal(incoming.direction, 'in');
    assert.equal(incoming.userId, f.owner);
    assert.equal(incoming.sourceProductId, source.id);
    assert.equal((await page(f, { type: 'used_transfer' })).data.length, 1);
    assert.equal((await page(f, { warehouseId: f.used, type: 'used_transfer' })).data[0].stockAfter, 10);
    // A full move carries its own row to the target. It is not merged into the other target row.
    await f.run(() =>
      f.movements.create(
        f.tenant,
        f.owner,
        {
          type: 'used_transfer',
          productId: source.id,
          quantity: 7,
          sourceWarehouseId: f.main,
          targetWarehouseId: f.used,
        },
        f.point,
        f.actor,
      ),
    );
    const full = (await page(f, { warehouseId: f.used, productId: source.id, type: 'used_transfer' })).data[0];
    assert.equal(full.productId, source.id);
    assert.equal(full.stockBefore, 0);
    assert.equal(full.stockAfter, 7);
  }),
);

test(
  'cross-point incoming projection hides foreign balances and never guesses an old missing target SKU',
  options,
  () =>
    fixture(async (f) => {
      const p = await f.product({ stock: 5 });
      const move = await f.run(() =>
        f.movements.create(
          f.tenant,
          f.owner,
          {
            type: 'point_transfer',
            productId: p.id,
            quantity: 2,
            sourceWarehouseId: f.main,
            targetWarehouseId: f.secondWh,
          },
          f.point,
          f.actor,
        ),
      );
      const source = (await page(f, { type: 'point_transfer' })).data[0];
      assert.equal(source.direction, 'out');
      assert.equal(source.stockBefore, 5);
      assert.equal(source.stockAfter, 3);
      assert.equal(source.targetStockBefore, null);
      const target = (await page(f, { type: 'point_transfer' }, f.secondPoint)).data[0];
      assert.equal(target.productId, move.targetProductId);
      assert.equal(target.direction, 'in');
      assert.equal(target.stockBefore, 0);
      assert.equal(target.stockAfter, 2);
      assert.equal((await page(f, { type: 'point_transfer', productId: move.targetProductId })).data.length, 0);
      await f.q(
        `INSERT INTO stock_movements(product_id,tenant_id,type,quantity,stock_before,stock_after,warehouse_id,source_warehouse_id,target_warehouse_id)
    VALUES($1,$2,'point_transfer',1,3,2,$3,$4,$3)`,
        [p.id, f.tenant, f.secondWh, f.main],
      );
      assert.equal(
        (await page(f, { type: 'point_transfer', productId: move.targetProductId }, f.secondPoint)).data.length,
        1,
      );
      const legacy = (await page(f, { type: 'point_transfer' }, f.secondPoint)).data.find(
        (row) => row.targetProductId === null,
      );
      assert.equal(legacy.stockBefore, null);
      assert.equal(legacy.stockAfter, null);
      assert.equal(legacy.stockDelta, null);
    }),
);

test('legacy warehouse relocation and receipt visibility/purge changes invalidate dependent pages', options, () =>
  fixture(async (f) => {
    const p = await f.product({ stock: 0 }),
      checkId = randomUUID();
    await f.q('INSERT INTO checks(id,tenant_id,point_id,master_id) VALUES($1,$2,$3,$4)', [
      checkId,
      f.tenant,
      f.point,
      f.owner,
    ]);
    await f.q(
      "INSERT INTO check_product_lines(check_id,product_id,name,quantity) VALUES($1,$2,'Legacy first',1),($1,$2,'Legacy second',1)",
      [checkId, p.id],
    );
    const query = { productId: p.id, includeSales: true, limit: 1 };
    let first = await page(f, query);
    assert.ok(first.nextCursor);
    await f.q('UPDATE products SET warehouse_id=$1 WHERE id=$2', [f.used, p.id]);
    await assert.rejects(page(f, { ...query, cursor: first.nextCursor }), stale);
    first = await page(f, query);
    await f.q('UPDATE checks SET master_id=$1 WHERE id=$2', [f.other, checkId]);
    await assert.rejects(page(f, { ...query, cursor: first.nextCursor }), stale);
    first = await page(f, query);
    await f.q('DELETE FROM checks WHERE id=$1', [checkId]);
    await assert.rejects(page(f, { ...query, cursor: first.nextCursor }), stale);
    assert.equal((await page(f, query)).data.length, 0);
  }),
);
