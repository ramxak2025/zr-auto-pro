const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { fixture, options } = require('./helpers/nov01-inventory-fixture.cjs');
const { ProductKitsService } = require('../dist/product-kits/product-kits.service');

test(
  'future nonzero product creation records atomic opening with actor and no supplier debt/expense; zero is eventless',
  options,
  () =>
    fixture(async (f) => {
      const supplier = randomUUID();
      await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Opening supplier')", [supplier, f.tenant]);
      const product = await f.run(() =>
        f.products.create(
          f.tenant,
          {
            name: 'Opening positive',
            stock: 5.25,
            costPrice: 10,
            sellPrice: 20,
            supplierId: supplier,
            warehouseId: f.main,
          },
          f.point,
          undefined,
          f.owner,
        ),
      );
      const rows = await f.q('SELECT * FROM stock_movements WHERE product_id=$1', [product.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].type, 'income');
      assert.equal(Number(rows[0].stock_before), 0);
      assert.equal(Number(rows[0].stock_after), 5.25);
      assert.equal(rows[0].reason, 'Начальный остаток');
      assert.equal(rows[0].user_id, f.owner);
      assert.equal(rows[0].supplier_id, null);
      const empty = await f.run(() =>
        f.products.create(
          f.tenant,
          { name: 'Opening zero', stock: 0, warehouseId: f.main },
          f.point,
          undefined,
          f.owner,
        ),
      );
      assert.equal((await f.q('SELECT count(*)::int n FROM stock_movements WHERE product_id=$1', [empty.id]))[0].n, 0);
      assert.equal((await f.q('SELECT count(*)::int n FROM expenses WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
      assert.equal((await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [supplier]))[0].current_debt, '0.00');
    }),
);

test('failed opening event rolls the new product back on a one-connection app pool', options, () =>
  fixture(async (f) => {
    await f.q(
      `CREATE FUNCTION nov01_reject_opening() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.tenant}'::uuid AND NEW.reason='Начальный остаток' THEN RAISE EXCEPTION 'fixture opening failure'; END IF; RETURN NEW; END $$`,
    );
    await f.q(
      'CREATE TRIGGER nov01_reject_opening BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION nov01_reject_opening()',
    );
    try {
      await assert.rejects(
        f.run(() =>
          f.products.create(
            f.tenant,
            { name: 'Must rollback opening', stock: 7, warehouseId: f.main },
            f.point,
            undefined,
            f.owner,
          ),
        ),
      );
    } finally {
      await f.q('DROP TRIGGER nov01_reject_opening ON stock_movements');
      await f.q('DROP FUNCTION nov01_reject_opening()');
    }
    assert.equal(
      (
        await f.q("SELECT count(*)::int n FROM products WHERE tenant_id=$1 AND name='Must rollback opening'", [
          f.tenant,
        ])
      )[0].n,
      0,
    );
    assert.equal((await f.q('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
  }, 1),
);

test(
  'CSV records real new openings and locked existing-stock corrections, preserves omitted-stock default0 and avoids noop duplicate events',
  options,
  () =>
    fixture(async (f) => {
      const existing = await f.run(() =>
        f.products.create(
          f.tenant,
          { name: 'CSV existing', stock: 5, costPrice: 100, sellPrice: 150, warehouseId: f.main },
          f.point,
          undefined,
          f.owner,
        ),
      );
      const input = [
        { name: 'CSV existing' },
        { name: 'CSV new', stock: 3.5, costPrice: 25, sellPrice: 50, unit: 'м' },
      ];
      const result = await f.run(() => f.products.importCsv(f.tenant, input, f.point, f.owner));
      assert.equal(result.created, 1);
      assert.equal(result.updated, 1);
      const after = (await f.q('SELECT * FROM products WHERE id=$1', [existing.id]))[0];
      assert.equal(Number(after.stock), 0);
      assert.equal(Number(after.cost_price), 100);
      assert.equal(Number(after.sell_price), 150);
      const correction = (
        await f.q("SELECT * FROM stock_movements WHERE product_id=$1 AND reason='Импорт товаров'", [existing.id])
      )[0];
      assert.equal(correction.type, 'inventory');
      assert.equal(Number(correction.stock_before), 5);
      assert.equal(Number(correction.stock_after), 0);
      assert.equal(correction.user_id, f.owner);
      const added = (await f.q("SELECT id FROM products WHERE tenant_id=$1 AND name='CSV new'", [f.tenant]))[0];
      const opening = (await f.q('SELECT * FROM stock_movements WHERE product_id=$1', [added.id]))[0];
      assert.equal(Number(opening.stock_before), 0);
      assert.equal(Number(opening.stock_after), 3.5);
      assert.equal(opening.reason, 'Импорт товаров');
      const beforeCount = (await f.q('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [f.tenant]))[0]
        .n;
      await f.run(() => f.products.importCsv(f.tenant, input, f.point, f.owner));
      assert.equal(
        (await f.q('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [f.tenant]))[0].n,
        beforeCount,
      );
    }),
);

test(
  'CSV history failure rolls back product/stock changes together, and used/kit helper zero creation never duplicates legs',
  options,
  () =>
    fixture(async (f) => {
      const existing = await f.run(() =>
        f.products.create(
          f.tenant,
          { name: 'CSV rollback existing', stock: 5, warehouseId: f.main },
          f.point,
          undefined,
          f.owner,
        ),
      );
      await f.q(
        `CREATE FUNCTION nov01_reject_csv_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.tenant}'::uuid AND NEW.reason='Импорт товаров' THEN RAISE EXCEPTION 'fixture CSV history failure'; END IF; RETURN NEW; END $$`,
      );
      await f.q(
        'CREATE TRIGGER nov01_reject_csv_history BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION nov01_reject_csv_history()',
      );
      try {
        await assert.rejects(
          f.run(() =>
            f.products.importCsv(
              f.tenant,
              [
                { name: 'CSV rollback existing', stock: 2 },
                { name: 'CSV rollback new', stock: 4 },
              ],
              f.point,
              f.owner,
            ),
          ),
        );
      } finally {
        await f.q('DROP TRIGGER nov01_reject_csv_history ON stock_movements');
        await f.q('DROP FUNCTION nov01_reject_csv_history()');
      }
      assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [existing.id]))[0].stock, '5.000');
      assert.equal(
        (
          await f.q("SELECT count(*)::int n FROM products WHERE tenant_id=$1 AND name='CSV rollback new'", [f.tenant])
        )[0].n,
        0,
      );
      const used = await f.run(() =>
        f.intake.create(
          { requestId: randomUUID(), name: 'Used no duplicate opening', quantity: 2, costPrice: 10, sellPrice: 20 },
          f.actor,
        ),
      );
      assert.equal(
        (await f.q('SELECT count(*)::int n FROM stock_movements WHERE product_id=$1', [used.product.id]))[0].n,
        1,
      );
      const component = await f.run(() =>
        f.products.create(
          f.tenant,
          { name: 'Kit source', stock: 5, costPrice: 10, warehouseId: f.main },
          f.point,
          undefined,
          f.owner,
        ),
      );
      const kits = new ProductKitsService(f.pool, f.products);
      const kit = await f.run(() =>
        kits.assemble(
          {
            requestId: randomUUID(),
            name: 'Kit no duplicate opening',
            quantity: 1,
            sellPrice: 20,
            warehouseId: f.main,
            components: [{ productId: component.id, quantity: 1 }],
          },
          f.actor,
        ),
      );
      const kitRows = await f.q('SELECT * FROM stock_movements WHERE product_id=$1', [kit.productId]);
      assert.equal(kitRows.length, 1);
      assert.equal(kitRows[0].type, 'kit_assembly');
    }),
);
