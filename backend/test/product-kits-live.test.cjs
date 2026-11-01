const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { fixture, options, status } = require('./helpers/nov01-inventory-fixture.cjs');
const { ProductKitsService } = require('../dist/product-kits/product-kits.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { ReturnsService } = require('../dist/returns/returns.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { SuppliersService } = require('../dist/suppliers/suppliers.service');

async function kitFixture(f, work) {
  const kits = new ProductKitsService(f.pool, f.products);
  const a = await f.product({ name: 'A', costPrice: 4000, sellPrice: 7000 }),
    b = await f.product({ name: 'B', costPrice: 6000, sellPrice: 8000 });
  const input = (more = {}) => ({
    requestId: randomUUID(),
    name: 'Комплект',
    quantity: 1,
    sellPrice: 13000,
    warehouseId: f.main,
    components: [
      { productId: a.id, quantity: 1 },
      { productId: b.id, quantity: 1 },
    ],
    ...more,
  });
  const assemble = (more = {}) => f.run(() => kits.assemble(input(more), f.actor));
  const stock = async (id) => Number((await f.q('SELECT stock FROM products WHERE id=$1', [id]))[0].stock);
  const value = async () =>
    Number(
      (
        await f.q('SELECT SUM(stock*COALESCE(assembly_exact_cost,cost_price)) value FROM products WHERE tenant_id=$1', [
          f.tenant,
        ])
      )[0].value,
    );
  await work({ kits, a, b, input, assemble, stock, value });
}

test(
  'physical assembly preserves 10k cost with 13k retail instead of 15k components, no money/debt and exact retry',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const before = await k.value(),
          dto = k.input();
        const [a, b] = await Promise.all([
          f.run(() => k.kits.assemble(dto, f.actor)),
          f.run(() => k.kits.assemble(dto, f.actor)),
        ]);
        assert.equal(a.productId, b.productId);
        assert.equal(a.costPrice, 10000);
        assert.equal(a.sellPrice, 13000);
        assert.equal(await k.stock(k.a.id), 9);
        assert.equal(await k.stock(k.b.id), 9);
        assert.equal(await k.stock(a.productId), 1);
        assert.equal(await k.value(), before);
        assert.equal((await f.q('SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1', [f.tenant]))[0].n, 3);
        assert.equal((await f.q('SELECT count(*)::int n FROM expenses WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
        assert.equal(
          (await f.q('SELECT count(*)::int n FROM supplier_payments WHERE tenant_id=$1', [f.tenant]))[0].n,
          0,
        );
        await assert.rejects(
          f.run(() => k.kits.assemble({ ...dto, sellPrice: 14000 }, f.actor)),
          status(409),
        );
        const snapshot = await f.run(() => k.kits.get(a.productId, f.actor));
        assert.equal(snapshot.components.length, 2);
        const visible = await f.run(() =>
          k.kits.get(a.productId, {
            ...f.actor,
            role: 'master',
            permissions: { warehouse_access: true, warehouse_manage: false },
          }),
        );
        assert.equal(visible.costPrice, undefined);
        assert.ok(visible.components.every((component) => component.costPrice === undefined));
      }),
    ),
);

test(
  'disassembly restores captured cost/place into a compatible position without repricing moved source stock',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const cell = randomUUID();
        await f.q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$2,$3,'A-01')", [
          cell,
          f.tenant,
          f.main,
        ]);
        await f.q("INSERT INTO warehouse_categories(tenant_id,warehouse_id,path) VALUES($1,$2,'Полка')", [
          f.tenant,
          f.main,
        ]);
        await f.run(() =>
          f.products.update(k.a.id, f.tenant, { category: 'Полка', storageCellId: cell }, f.owner, f.point),
        );
        const assembled = await k.assemble();
        await f.run(() =>
          f.products.update(k.a.id, f.tenant, { costPrice: 9000, warehouseId: f.used, category: '' }, f.owner, f.point),
        );
        const before = await k.value();
        const result = await f.run(() =>
          k.kits.disassemble(
            assembled.productId,
            { requestId: randomUUID(), expectedRevision: 1, quantity: 1 },
            f.actor,
          ),
        );
        const restored = result.sources.find((source) => source.sourceProductId === k.a.id);
        assert.notEqual(restored.productId, k.a.id);
        const row = (await f.q('SELECT * FROM products WHERE id=$1', [restored.productId]))[0];
        assert.equal(row.warehouse_id, f.main);
        assert.equal(row.category, 'Полка');
        assert.equal(row.storage_cell_id, cell);
        assert.equal(Number(row.cost_price), 4000);
        const original = (await f.q('SELECT * FROM products WHERE id=$1', [k.a.id]))[0];
        assert.equal(Number(original.cost_price), 9000);
        assert.equal(Number(original.stock), 9);
        assert.equal(original.warehouse_id, f.used);
        assert.equal(await k.value(), before);
        assert.equal(await k.stock(assembled.productId), 0);
      }),
    ),
);

test(
  'missing place, insufficient stock and generic mutations fail atomically while fine kit basis is preserved',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        await assert.rejects(k.assemble({ quantity: 11 }), status(409));
        const fractional = await f.product({ name: 'Fractional cent', costPrice: 0.01, sellPrice: 1 });
        const fine = await k.assemble({ components: [{ productId: fractional.id, quantity: 0.5 }] });
        assert.equal(fine.costPrice, 0.005);
        assert.equal(
          (await f.q('SELECT count(*)::int n FROM product_assemblies WHERE tenant_id=$1', [f.tenant]))[0].n,
          1,
        );
        const cell = randomUUID();
        await f.q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$2,$3,'A-02')", [
          cell,
          f.tenant,
          f.main,
        ]);
        await f.run(() => f.products.update(k.a.id, f.tenant, { storageCellId: cell }, f.owner, f.point));
        const assembled = await k.assemble(),
          before = await k.value();
        await assert.rejects(
          f.run(() => f.products.update(assembled.productId, f.tenant, { costPrice: 1 }, f.owner, f.point)),
          status(409),
        );
        await assert.rejects(
          f.run(() => f.products.update(assembled.productId, f.tenant, { stock: 5 }, f.owner, f.point)),
          status(409),
        );
        await assert.rejects(
          f.run(() =>
            f.products.updateStock(assembled.productId, f.tenant, { type: 'income', quantity: 1 }, f.owner, f.point),
          ),
          status(409),
        );
        await assert.rejects(
          f.run(() =>
            f.movements.create(
              f.tenant,
              f.owner,
              { type: 'income', productId: assembled.productId, quantity: 1 },
              f.point,
              f.actor,
            ),
          ),
          status(409),
        );
        await assert.rejects(
          f.q('UPDATE products SET cost_price=1 WHERE id=$1', [assembled.productId]),
          (error) => error.code === 'P0001',
        );
        await f.q('DELETE FROM storage_cells WHERE id=$1', [cell]);
        await assert.rejects(
          f.run(() =>
            k.kits.disassemble(
              assembled.productId,
              { requestId: randomUUID(), expectedRevision: 1, quantity: 1 },
              f.actor,
            ),
          ),
          (error) => error.getResponse().code === 'KIT_SOURCE_PLACE_UNAVAILABLE',
        );
        assert.equal(await k.value(), before);
        assert.equal(await k.stock(assembled.productId), 1);
      }),
    ),
);

test(
  'concurrent disassembly cannot duplicate components; recipe edits and recomposition create a fresh immutable batch',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const recipe = await f.run(() =>
          k.kits.saveRecipe({ name: 'Recipe', components: k.input().components }, f.actor),
        );
        const assembled = await k.assemble({ recipeId: recipe.id, expectedRecipeVersion: recipe.version });
        await f.run(() =>
          k.kits.saveRecipe(
            { name: 'New recipe', components: [{ productId: k.a.id, quantity: 2 }] },
            f.actor,
            recipe.id,
            1,
          ),
        );
        assert.equal((await f.run(() => k.kits.get(assembled.productId, f.actor))).components.length, 2);
        const before = await k.value();
        const changed = await f.run(() =>
          k.kits.recompose(
            assembled.productId,
            {
              ...k.input({
                components: [
                  { productId: k.a.id, quantity: 1 },
                  { productId: k.b.id, quantity: 2 },
                ],
              }),
              expectedRevision: 1,
            },
            f.actor,
          ),
        );
        assert.notEqual(changed.productId, assembled.productId);
        assert.equal(changed.costPrice, 16000);
        assert.equal(await k.value(), before);
        const results = await Promise.allSettled(
          [1, 2].map(() =>
            f.run(() =>
              k.kits.disassemble(
                changed.productId,
                { requestId: randomUUID(), expectedRevision: 1, quantity: 1 },
                f.actor,
              ),
            ),
          ),
        );
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(await k.stock(changed.productId), 0);
        assert.equal(await k.stock(k.a.id), 10);
        assert.equal(await k.stock(k.b.id), 10);
      }),
    ),
);

test(
  'whole-kit POS consumes one kit; delete/restore/return preserve it and oversell cannot fabricate assembled units',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble();
        const checks = new ChecksService(f.pool, new WarrantyService(f.pool), new ClientsService(f.pool));
        const create = (quantity = 1) =>
          f.run(() =>
            checks.create(
              f.tenant,
              f.owner,
              'director',
              {
                masterId: f.owner,
                products: [{ productId: assembled.productId, name: 'Комплект', quantity, sellPrice: 13000 }],
                services: [],
                isDeferred: false,
                paymentMethod: 'cash',
              },
              f.actor,
            ),
          );
        await assert.rejects(create(2), status(409));
        assert.equal(await k.stock(assembled.productId), 1);
        const sale = await create();
        assert.equal(await k.stock(assembled.productId), 0);
        assert.equal(await k.stock(k.a.id), 9);
        await f.run(() => checks.remove(sale.id, f.tenant, 'director', f.owner, f.actor));
        assert.equal(await k.stock(assembled.productId), 1);
        await f.run(() => checks.restore(sale.id, f.tenant, f.actor));
        assert.equal(await k.stock(assembled.productId), 0);
        const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
        await f.run(() =>
          returns.createReturn(f.tenant, f.owner, sale.id, { destination: 'warehouse', scope: 'full' }, f.actor),
        );
        assert.equal(await k.stock(assembled.productId), 1);
        assert.equal(await k.stock(k.a.id), 9);
        const supplier = randomUUID();
        await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Supplier')", [supplier, f.tenant]);
        const suppliers = new SuppliersService(f.pool, f.movements, new WarehousesService(f.pool));
        await assert.rejects(
          f.run(() =>
            suppliers.createDelivery(
              f.tenant,
              { supplierId: supplier, items: [{ productId: assembled.productId, quantity: 1, price: 1 }] },
              f.point,
              f.owner,
            ),
          ),
          status(409),
        );
      }),
    ),
);

function splitFlows(f, k, assembled) {
  const checks = new ChecksService(f.pool, new WarrantyService(f.pool), new ClientsService(f.pool));
  const intent = { intentId: randomUUID(), productId: assembled.productId, expectedRevision: 1, quantity: 1 };
  const lines = [k.a, k.b].map((product) => ({
    productId: product.id,
    name: product.name,
    quantity: 1,
    sellPrice: product.sellPrice,
    costPrice: 999999,
    kitSource: { intentId: intent.intentId, sourceProductId: product.id },
  }));
  const input = (more = {}) => ({
    clientRequestId: randomUUID(),
    masterId: f.owner,
    kitSplits: [intent],
    products: lines,
    services: [],
    isDeferred: false,
    paymentMethod: 'cash',
    discount: 2000,
    ...more,
  });
  const create = (body) => f.run(() => checks.create(f.tenant, f.owner, 'director', body, f.actor));
  const edit = (id, body) => f.run(() => checks.update(id, f.tenant, 'director', body, f.owner, f.actor));
  return { checks, intent, lines, input, create, edit };
}

test(
  'POS split commits one conversion, actual component sales and existing discount with request replay',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled),
          body = x.input();
        const [a, b] = await Promise.all([x.create(body), x.create(body)]);
        assert.equal(a.id, b.id);
        assert.equal(a.productCostTotal, 10000);
        assert.equal(a.totalRevenue, 13000);
        assert.equal(a.products.length, 2);
        assert.equal(a.kitSplits.length, 1);
        assert.ok(a.products.every((line) => line.kitSource));
        assert.equal(await k.stock(assembled.productId), 0);
        assert.equal(await k.stock(k.a.id), 9);
        assert.equal(await k.stock(k.b.id), 9);
        assert.equal(
          (await f.q("SELECT count(*)::int n FROM kit_operations WHERE tenant_id=$1 AND kind='split'", [f.tenant]))[0]
            .n,
          1,
        );
        await x.edit(a.id, { products: a.products, kitSplits: a.kitSplits, discount: 2000 });
        assert.equal(
          (await f.q("SELECT count(*)::int n FROM kit_operations WHERE tenant_id=$1 AND kind='split'", [f.tenant]))[0]
            .n,
          1,
        );
        await assert.rejects(x.create({ ...body, clientRequestId: randomUUID() }), status(409));
      }),
    ),
);

test(
  'draft split/cancel has no stock effect; bare activation uses captured cost after source moved/repriced',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled);
        await f.run(() =>
          f.products.update(k.a.id, f.tenant, { costPrice: 9000, warehouseId: f.used }, f.owner, f.point),
        );
        const cancelled = await x.create(x.input({ isDeferred: true }));
        await f.run(() => x.checks.remove(cancelled.id, f.tenant, 'director', f.owner, f.actor));
        assert.equal(await k.stock(assembled.productId), 1);
        const draft = await x.create(x.input({ isDeferred: true }));
        assert.equal(draft.productCostTotal, 10000);
        assert.equal(await k.stock(assembled.productId), 1);
        assert.equal(
          (await f.q("SELECT count(*)::int n FROM kit_operations WHERE tenant_id=$1 AND kind='split'", [f.tenant]))[0]
            .n,
          0,
        );
        const active = await x.edit(draft.id, { isDeferred: false });
        assert.equal(active.productCostTotal, 10000);
        assert.equal(await k.stock(assembled.productId), 0);
        assert.equal(await k.stock(k.a.id), 9);
        const source = active.products.find((line) => line.kitSource.sourceProductId === k.a.id);
        assert.notEqual(source.productId, k.a.id);
        assert.equal(source.costPrice, 4000);
        assert.equal(await k.stock(source.productId), 0);
      }),
    ),
);

test(
  'full draft activation removes a component, sells replacement separately and returns leftover source stock',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled),
          replacement = await f.product({ name: 'Replacement', costPrice: 2000, sellPrice: 5000 });
        const draft = await x.create(x.input({ isDeferred: true }));
        const active = await x.edit(draft.id, {
          isDeferred: false,
          products: [
            x.lines[0],
            { productId: replacement.id, name: replacement.name, quantity: 1, sellPrice: 5000, costPrice: 0 },
          ],
          discount: 1000,
        });
        assert.equal(active.productCostTotal, 6000);
        assert.equal(active.totalRevenue, 11000);
        assert.equal(await k.stock(k.a.id), 9);
        assert.equal(await k.stock(k.b.id), 10);
        assert.equal(await k.stock(replacement.id), 9);
        assert.equal(await k.stock(assembled.productId), 0);
      }),
    ),
);

test(
  'split check edit/delete/restore/return resolve captured source basis without reassembly or repricing unrelated stock',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled);
        let sale = await x.create(x.input());
        await f.run(() =>
          f.products.update(k.a.id, f.tenant, { costPrice: 9000, warehouseId: f.used }, f.owner, f.point),
        );
        sale = await x.edit(sale.id, { products: sale.products, kitSplits: sale.kitSplits, discount: 2000 });
        assert.equal(sale.productCostTotal, 10000);
        const source = sale.products.find((line) => line.kitSource.sourceProductId === k.a.id);
        assert.notEqual(source.productId, k.a.id);
        assert.equal(await k.stock(source.productId), 0);
        await f.run(() => x.checks.remove(sale.id, f.tenant, 'director', f.owner, f.actor));
        assert.equal(await k.stock(source.productId), 1);
        assert.equal(await k.stock(k.a.id), 9);
        assert.equal(await k.stock(assembled.productId), 0);
        await f.run(() => x.checks.restore(sale.id, f.tenant, f.actor));
        assert.equal(await k.stock(source.productId), 0);
        const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
        await f.run(() =>
          returns.createReturn(f.tenant, f.owner, sale.id, { destination: 'warehouse', scope: 'full' }, f.actor),
        );
        assert.equal(await k.stock(source.productId), 1);
        assert.equal(await k.stock(k.b.id), 10);
        assert.equal(await k.stock(assembled.productId), 0);
        assert.equal((await f.q('SELECT cost_price FROM products WHERE id=$1', [k.a.id]))[0].cost_price, '9000.00');
        assert.equal(
          (await f.q("SELECT count(*)::int n FROM kit_operations WHERE tenant_id=$1 AND kind='split'", [f.tenant]))[0]
            .n,
          1,
        );
        const history = await f.run(() =>
          f.movements.history(f.tenant, { productId: k.a.id, includeSales: true }, f.point, f.actor),
        );
        assert.ok(history.data.some((row) => row.sourceProductId === k.a.id));
      }),
    ),
);

test(
  'split return to defect preserves captured basis after catalog source changes; sale/disassembly race has one winner',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled);
        const sale = await x.create(x.input());
        await f.run(() =>
          f.products.update(k.a.id, f.tenant, { costPrice: 9000, warehouseId: f.used }, f.owner, f.point),
        );
        const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
        await f.run(() =>
          returns.createReturn(
            f.tenant,
            f.owner,
            sale.id,
            { destination: 'defect', scope: 'full', reason: 'Damaged' },
            f.actor,
          ),
        );
        const defect = (
          await f.q(
            "SELECT p.* FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.tenant_id=$1 AND w.kind='defect' AND p.name='A'",
            [f.tenant],
          )
        )[0];
        assert.equal(Number(defect.cost_price), 4000);
        assert.equal(Number(defect.stock), 1);
        assert.equal(await k.stock(k.a.id), 9);
        const race = await k.assemble();
        const whole = () =>
          f.run(() =>
            x.checks.create(
              f.tenant,
              f.owner,
              'director',
              {
                masterId: f.owner,
                products: [{ productId: race.productId, name: 'Комплект', quantity: 1, sellPrice: 13000 }],
                services: [],
                isDeferred: false,
                paymentMethod: 'cash',
              },
              f.actor,
            ),
          );
        const outcomes = await Promise.allSettled([
          whole(),
          f.run(() =>
            k.kits.disassemble(race.productId, { requestId: randomUUID(), expectedRevision: 1, quantity: 1 }, f.actor),
          ),
        ]);
        assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(await k.stock(race.productId), 0);
      }),
    ),
);

test('split source identity retains product motivation/commission after physical basis remap and return', options, () =>
  fixture((f) =>
    kitFixture(f, async (k) => {
      await f.q(
        "INSERT INTO motivation_rules(tenant_id,target_kind,product_id,percent,before_discount) VALUES($1,'product',$2,10,true)",
        [f.tenant, k.a.id],
      );
      await f.q('INSERT INTO product_commissions(tenant_id,user_id,product_id,percent) VALUES($1,$2,$3,5)', [
        f.tenant,
        f.owner,
        k.a.id,
      ]);
      const assembled = await k.assemble(),
        x = splitFlows(f, k, assembled);
      await f.run(() =>
        f.products.update(k.a.id, f.tenant, { costPrice: 9000, warehouseId: f.used }, f.owner, f.point),
      );
      let sale = await x.create(x.input({ assigneeIds: [f.owner], assigneesConfirmed: true }));
      const source = sale.products.find((line) => line.kitSource.sourceProductId === k.a.id);
      assert.notEqual(source.productId, k.a.id);
      assert.equal(sale.productSalaryTotal, 150);
      let accruals = await f.q("SELECT * FROM motivation_accruals WHERE check_id=$1 AND scheme='revenue_v2'", [
        sale.id,
      ]);
      assert.equal(accruals.length, 1);
      assert.equal(accruals[0].snapshot_product_id, k.a.id);
      assert.equal(Number(accruals[0].amount), 700);
      sale = await x.edit(sale.id, { products: sale.products, kitSplits: sale.kitSplits, discount: 2000 });
      accruals = await f.q("SELECT * FROM motivation_accruals WHERE check_id=$1 AND scheme='revenue_v2'", [sale.id]);
      assert.equal(Number(accruals[0].amount), 700);
      assert.equal(sale.productSalaryTotal, 150);
      const history = await f.run(() =>
        f.movements.history(f.tenant, { productId: k.a.id, includeSales: true }, f.point, f.actor),
      );
      assert.ok(
        history.data.some(
          (event) => event.type === 'sale' && event.sourceProductId === k.a.id && event.checkId === sale.id,
        ),
      );
      const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
      await f.run(() =>
        returns.createReturn(f.tenant, f.owner, sale.id, { destination: 'warehouse', scope: 'full' }, f.actor),
      );
      assert.equal(
        (
          await f.q("SELECT count(*)::int n FROM motivation_accruals WHERE check_id=$1 AND scheme='revenue_v2'", [
            sale.id,
          ])
        )[0].n,
        0,
      );
      assert.ok(
        (
          await f.run(() => f.movements.history(f.tenant, { productId: k.a.id, includeSales: true }, f.point, f.actor))
        ).data.some((event) => event.type === 'customer_return' && event.sourceProductId === k.a.id),
      );
    }),
  ),
);

test(
  '0.5 × 99.99 keeps exact kit inventory basis; 1000-unit sale, edit, partial return and gross analysis round once per line',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const hose = await f.product({ name: 'Шланг', unit: 'м', stock: 1000, costPrice: 99.99, sellPrice: 150 });
        const before = await k.value();
        const assembled = await k.assemble({
          quantity: 1000,
          sellPrice: 60,
          components: [{ productId: hose.id, quantity: 0.5 }],
        });
        assert.equal(assembled.costPrice, 49.995);
        assert.equal(await k.value(), before);
        const read = await f.run(() => f.products.getById(assembled.productId, f.tenant, f.actor));
        assert.equal(read.costPrice, 50);
        assert.equal(read.assemblyExactCost, 49.995);
        const stats = await f.run(() => f.products.getWarehouseStats(f.tenant, f.point));
        assert.equal(stats.totalCostValue, before);
        const { WarehouseAnalyticsService } = require('../dist/warehouse-analytics/warehouse-analytics.service');
        const analytics = new WarehouseAnalyticsService(f.pool);
        assert.equal(
          (await f.run(() => analytics.getSummary(f.tenant, { period: 'month' }, f.point))).stockValueCurrent,
          before,
        );
        const { ProductsBuilder } = require('../dist/reports/builder/builders/products.builder');
        const stale = await f.run(() =>
          new ProductsBuilder(f.pool).stale({
            tenantId: f.tenant,
            pointId: f.point,
            dateFrom: '2026-01-01',
            dateTo: '2027-01-01',
            tz: 'Europe/Moscow',
            refDate: '2026-11-01',
          }),
        );
        assert.equal(stale.section.rows.find((row) => row._id === assembled.productId).value, 49995);
        const checks = new ChecksService(f.pool, new WarrantyService(f.pool), new ClientsService(f.pool));
        let sale = await f.run(() =>
          checks.create(
            f.tenant,
            f.owner,
            'director',
            {
              masterId: f.owner,
              products: [
                {
                  productId: assembled.productId,
                  name: 'Шланг в комплекте',
                  quantity: 1000,
                  sellPrice: 60,
                  costPrice: 0,
                },
              ],
              services: [],
              paymentMethod: 'cash',
            },
            f.actor,
          ),
        );
        assert.equal(sale.productCostTotal, 49995);
        assert.equal(sale.products[0].kitExactUnitCost, 49.995);
        const saved = (
          await f.q('SELECT cost_price,kit_exact_unit_cost,total_cost FROM check_product_lines WHERE check_id=$1', [
            sale.id,
          ])
        )[0];
        assert.equal(saved.cost_price, '50.00');
        assert.equal(saved.kit_exact_unit_cost, '49.99500');
        assert.equal(saved.total_cost, '49995.00');
        sale = await f.run(() =>
          checks.update(sale.id, f.tenant, 'director', { products: sale.products }, f.owner, f.actor),
        );
        assert.equal(sale.productCostTotal, 49995);
        const { loadAnalysis } = require('../dist/reports/builder/analysis-query');
        const ctx = {
          tenantId: f.tenant,
          pointId: f.point,
          dateFrom: '2026-01-01',
          dateTo: '2027-01-01',
          tz: 'Europe/Moscow',
          days: 366,
        };
        const gross = await f.run(() => loadAnalysis(f.pool, ctx, { kind: 'products', basis: 'gross' }));
        assert.equal(gross.totals.cost, 49995);
        assert.equal(gross.totals.gross, 10005);
        const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
        await f.run(() =>
          returns.createReturn(
            f.tenant,
            f.owner,
            sale.id,
            {
              destination: 'warehouse',
              scope: 'partial',
              lines: [{ productLineId: sale.products[0].id, quantity: 1 }],
            },
            f.actor,
          ),
        );
        assert.equal(await k.stock(assembled.productId), 1);
        assert.equal((await f.run(() => checks.getById(sale.id, f.tenant, f.actor))).productCostTotal, 49945);
        const afterReturn = await f.run(() => loadAnalysis(f.pool, ctx, { kind: 'products', basis: 'gross' }));
        assert.equal(afterReturn.totals.cost, 49945);
        assert.equal(afterReturn.totals.gross, 9995);
        const inventory = (
          await f.q('SELECT stock*assembly_exact_cost AS value FROM products WHERE id=$1', [assembled.productId])
        )[0];
        assert.equal(Number(inventory.value), 49.995);
      }),
    ),
);

test(
  'fine-basis whole-kit defect return and disassembly conserve the exact original fractional component value',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const hose = await f.product({ name: 'Трубка', unit: 'м', stock: 1, costPrice: 99.99, sellPrice: 150 }),
          before = await k.value();
        const assembled = await k.assemble({ sellPrice: 60, components: [{ productId: hose.id, quantity: 0.5 }] });
        assert.equal(await k.value(), before);
        const checks = new ChecksService(f.pool, new WarrantyService(f.pool), new ClientsService(f.pool));
        const sale = await f.run(() =>
          checks.create(
            f.tenant,
            f.owner,
            'director',
            {
              masterId: f.owner,
              products: [{ productId: assembled.productId, name: 'Трубка', quantity: 1, sellPrice: 60 }],
              services: [],
              paymentMethod: 'cash',
            },
            f.actor,
          ),
        );
        assert.equal(sale.productCostTotal, 50);
        const returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
        await f.run(() =>
          returns.createReturn(
            f.tenant,
            f.owner,
            sale.id,
            { destination: 'defect', scope: 'full', reason: 'Повреждение' },
            f.actor,
          ),
        );
        assert.equal(await k.value(), before);
        const defect = (
          await f.q(
            "SELECT p.id,p.assembly_exact_cost FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.tenant_id=$1 AND p.assembly_id=$2 AND w.kind='defect'",
            [f.tenant, assembled.assemblyId],
          )
        )[0];
        assert.equal(defect.assembly_exact_cost, '49.99500');
        await f.run(() =>
          k.kits.disassemble(defect.id, { requestId: randomUUID(), expectedRevision: 1, quantity: 1 }, f.actor),
        );
        assert.equal(await k.stock(hose.id), 1);
        assert.equal(await k.value(), before);
      }),
    ),
);

test(
  'unused new split intent and over-allocated duplicate source lines roll back; ordinary same-SKU replacement keeps separate cost basis',
  options,
  () =>
    fixture((f) =>
      kitFixture(f, async (k) => {
        const assembled = await k.assemble(),
          x = splitFlows(f, k, assembled);
        await assert.rejects(
          x.create(
            x.input({ products: [{ productId: k.a.id, name: 'Replacement only', quantity: 1, sellPrice: 7000 }] }),
          ),
          status(400),
        );
        await assert.rejects(
          x.create(
            x.input({
              products: [
                { ...x.lines[0], quantity: 0.75 },
                { ...x.lines[0], quantity: 0.75 },
              ],
            }),
          ),
          status(400),
        );
        assert.equal(await k.stock(assembled.productId), 1);
        assert.equal(
          (await f.q("SELECT count(*)::int n FROM kit_operations WHERE tenant_id=$1 AND kind='split'", [f.tenant]))[0]
            .n,
          0,
        );
        await f.run(() => f.products.update(k.a.id, f.tenant, { costPrice: 9000 }, f.owner, f.point));
        const sale = await x.create(
          x.input({
            discount: 0,
            products: [x.lines[0], { productId: k.a.id, name: 'Replacement', quantity: 1, sellPrice: 7000 }],
          }),
        );
        assert.equal(sale.productCostTotal, 13000);
        assert.deepEqual(
          sale.products.map((line) => line.costPrice).sort((a, b) => a - b),
          [4000, 9000],
        );
        assert.equal(await k.stock(k.a.id), 8);
        assert.equal(await k.stock(k.b.id), 10);
      }),
    ),
);
