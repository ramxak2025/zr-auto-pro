const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, options, status } = require('./helpers/nov01-inventory-fixture.cjs');
const { ProductKitsService } = require('../dist/product-kits/product-kits.service');
const { ChecksService } = require('../dist/checks/checks.service');
const { ClientsService } = require('../dist/clients/clients.service');
const { WarrantyService } = require('../dist/warranty/warranty.service');
const { ReturnsService } = require('../dist/returns/returns.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { SuppliersService } = require('../dist/suppliers/suppliers.service');
const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');
const { SupplierInvoicesService } = require('../dist/supplier-invoices/supplier-invoices.service');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { loadAnalysis } = require('../dist/reports/builder/analysis-query');

function checksFor(f) {
  return new ChecksService(f.pool, new WarrantyService(f.pool), new ClientsService(f.pool));
}
async function kit(f, unitCost, componentQuantity, quantity = 2, more = {}) {
  const component = await f.product({
    name: 'Exact component',
    unit: 'м',
    costPrice: unitCost,
    sellPrice: 150,
    stock: 1000,
  });
  const kits = new ProductKitsService(f.pool, f.products);
  const assembled = await f.run(() =>
    kits.assemble(
      {
        requestId: randomUUID(),
        name: 'Exact kit',
        quantity,
        sellPrice: 25,
        warehouseId: f.main,
        components: [{ productId: component.id, quantity: componentQuantity }],
        ...more,
      },
      f.actor,
    ),
  );
  return { kits, component, assembled };
}

test(
  'restricted client-history detail omits exact acquisition shadow while authorized owner retains49.995',
  options,
  () =>
    fixture(async (f) => {
      const { assembled } = await kit(f, 99.99, 0.5, 1);
      const client = randomUUID();
      await f.q(
        "INSERT INTO clients(id,tenant_id,full_name,phone,point_id) VALUES($1,$2,'Privacy fixture','79990000123',$3)",
        [client, f.tenant, f.point],
      );
      const checks = checksFor(f);
      const sale = await f.run(() =>
        checks.create(
          f.tenant,
          f.owner,
          'director',
          {
            masterId: f.owner,
            clientId: client,
            products: [{ productId: assembled.productId, name: 'Kit', quantity: 1, sellPrice: 25 }],
            services: [],
            paymentMethod: 'cash',
          },
          f.actor,
        ),
      );
      const restricted = {
        ...f.actor,
        userID: f.other,
        role: 'master',
        permissions: {
          clients_view: true,
          checks_view: false,
          checks_view_all: false,
          profit_view: false,
          warehouse_manage: false,
        },
      };
      const detail = await f.run(() => checks.getClientHistoryCheck(sale.id, client, f.tenant, restricted));
      assert.equal(detail.products[0].costPrice, 0);
      assert.equal(detail.products[0].totalCost, 0);
      assert.equal(Object.hasOwn(detail.products[0], 'kitExactUnitCost'), false);
      assert.equal(JSON.stringify(detail).includes('49.995'), false);
      const owner = await f.run(() => checks.getClientHistoryCheck(sale.id, client, f.tenant, f.actor));
      assert.equal(owner.products[0].kitExactUnitCost, 49.995);
    }),
);

test(
  'kit19.994 partial return reverses19.99 and leaves20.00; separate full-line return reverses posted39.99 and gross stays aligned',
  options,
  () =>
    fixture(async (f) => {
      const { assembled } = await kit(f, 99.97, 0.2, 4);
      const checks = checksFor(f),
        returns = new ReturnsService(f.pool, new WarehousesService(f.pool));
      const create = () =>
        f.run(() =>
          checks.create(
            f.tenant,
            f.owner,
            'director',
            {
              masterId: f.owner,
              products: [{ productId: assembled.productId, name: 'Kit', quantity: 2, sellPrice: 25 }],
              services: [],
              paymentMethod: 'cash',
            },
            f.actor,
          ),
        );
      const partial = await create();
      assert.equal(partial.productCostTotal, 39.99);
      await f.run(() =>
        returns.createReturn(
          f.tenant,
          f.owner,
          partial.id,
          {
            destination: 'warehouse',
            scope: 'partial',
            lines: [{ productLineId: partial.products[0].id, quantity: 1 }],
          },
          f.actor,
        ),
      );
      const saved = await f.run(() => checks.getById(partial.id, f.tenant, f.actor));
      assert.equal(saved.productCostTotal, 20);
      const ctx = {
        tenantId: f.tenant,
        pointId: f.point,
        dateFrom: '2026-01-01',
        dateTo: '2027-01-01',
        tz: 'Europe/Moscow',
        days: 366,
      };
      const analysis = await f.run(() => loadAnalysis(f.pool, ctx, { kind: 'products', basis: 'gross' }));
      assert.equal(analysis.totals.cost, 20);
      assert.equal(analysis.totals.gross, 5);
      assert.equal(analysis.adjustment.cost, 0);
      await assert.rejects(
        f.run(() =>
          returns.createReturn(
            f.tenant,
            f.owner,
            partial.id,
            {
              destination: 'warehouse',
              scope: 'partial',
              lines: [{ productLineId: partial.products[0].id, quantity: 1 }],
            },
            f.actor,
          ),
        ),
        status(400),
      );
      const full = await create();
      assert.equal(full.productCostTotal, 39.99);
      await f.run(() =>
        returns.createReturn(f.tenant, f.owner, full.id, { destination: 'warehouse', scope: 'full' }, f.actor),
      );
      assert.equal((await f.run(() => checks.getById(full.id, f.tenant, f.actor))).productCostTotal, 0);
      assert.equal(
        (await f.run(() => loadAnalysis(f.pool, ctx, { kind: 'products', basis: 'gross' }))).totals.cost,
        20,
      );
    }),
);

test('template displayed unit/total and CSV export retain49.995 rather than multiplying rounded50', options, () =>
  fixture(async (f) => {
    const { assembled } = await kit(f, 99.99, 0.5, 1000);
    const templates = new CheckTemplatesService(f.pool);
    const saved = await f.run(() =>
      templates.create(f.tenant, f.actor, {
        name: 'Exact template',
        shared: true,
        services: [],
        products: [{ productId: assembled.productId, name: 'Kit', quantity: 1000, sellPrice: 25, costPrice: 50 }],
      }),
    );
    assert.equal(saved.products[0].costPrice, 49.995);
    assert.equal(saved.productCostTotal, 49995);
    const listed = (await f.run(() => templates.getAll(f.tenant, f.actor))).find(
      (template) => template.id === saved.id,
    );
    assert.equal(listed.productCostTotal, 49995);
    const staff = { ...f.actor, userID: f.other, role: 'master', permissions: { warehouse_manage: false } };
    const hidden = (await f.run(() => templates.getAll(f.tenant, staff))).find((template) => template.id === saved.id);
    assert.equal(hidden.products[0].costPrice, undefined);
    assert.equal(hidden.productCostTotal, undefined);
    const csv = await f.run(() => f.products.exportCsv(f.tenant, f.point));
    const row = csv.split('\n').find((line) => line.startsWith('Exact kit;'));
    assert.equal(Number(row.split(';')[4]), 49.995);
    assert.equal(Number(row.split(';')[4]) * Number(row.split(';')[5]), 49995);
    const fine = await kit(f, 20.15, 0.5, 1);
    const fineTemplate = await f.run(() =>
      templates.create(f.tenant, f.actor, {
        name: 'Exact half-cent template',
        services: [],
        products: [
          { productId: fine.assembled.productId, name: 'Fine kit', quantity: 1, sellPrice: 25, costPrice: 10.08 },
        ],
      }),
    );
    assert.equal(fineTemplate.products[0].costPrice, 10.075);
    assert.equal(fineTemplate.productCostTotal, 10.08);
  }),
);

test(
  'one-connection app pool completes used intake and assembly including supplier/warehouse/cell nested validation',
  options,
  () =>
    fixture(async (f) => {
      const usedCell = randomUUID(),
        mainCell = randomUUID(),
        supplier = randomUUID();
      await f.q("INSERT INTO storage_cells(id,tenant_id,warehouse_id,code) VALUES($1,$3,$4,'USED'),($2,$3,$5,'MAIN')", [
        usedCell,
        mainCell,
        f.tenant,
        f.used,
        f.main,
      ]);
      await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Pool fixture')", [supplier, f.tenant]);
      const client = await f.run(() => f.pool.connect());
      try {
        await client.query('BEGIN');
        await f.run(() =>
          f.products.create(
            f.tenant,
            { name: 'Supplied transaction', supplierId: supplier, warehouseId: f.main, storageCellId: mainCell },
            f.point,
            client,
          ),
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const used = await f.run(() =>
        f.intake.create(
          {
            requestId: randomUUID(),
            name: 'Used one connection',
            quantity: 1,
            costPrice: 10,
            sellPrice: 20,
            storageCellId: usedCell,
          },
          f.actor,
        ),
      );
      assert.equal(used.product.stock, 1);
      const { assembled } = await kit(f, 99.99, 0.5, 1, { storageCellId: mainCell });
      assert.equal(assembled.costPrice, 49.995);
    }, 1),
);

test(
  'one-connection app pool completes invoice setOrder and confirmed linked receipt without a second checkout',
  options,
  () =>
    fixture(async (f) => {
      const p = await f.product(),
        supplier = randomUUID(),
        order = randomUUID(),
        orderItem = randomUUID();
      await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Pool invoice supplier')", [supplier, f.tenant]);
      await f.q(
        "INSERT INTO purchase_orders(id,tenant_id,supplier_id,point_id,status,total) VALUES($1,$2,$3,$4,'ordered',20)",
        [order, f.tenant, supplier, f.point],
      );
      await f.q(
        "INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,product_id,name,quantity,cost_price) VALUES($1,$2,$3,$4,'Pool item',1,20)",
        [orderItem, f.tenant, order, p.id],
      );
      const suppliers = new SuppliersService(f.pool, f.movements, new WarehousesService(f.pool));
      const orders = new PurchaseOrdersService(f.pool, f.movements, suppliers);
      const invoices = new SupplierInvoicesService(f.pool, {}, {}, suppliers, orders);
      let doc = await f.run(() => invoices.prepare(supplier, f.actor));
      doc = await f.run(() =>
        invoices.addManualLine(
          doc.id,
          { expectedVersion: doc.version, requestId: randomUUID(), productId: p.id, quantity: 1, price: 20 },
          f.actor,
        ),
      );
      doc = await f.run(() => invoices.setOrder(doc.id, doc.version, order, f.actor));
      assert.equal(doc.orderId, order);
      const result = await f.run(() =>
        invoices.confirm(
          doc.id,
          {
            expectedVersion: doc.version,
            requestId: randomUUID(),
            date: '2026-09-01',
            items: [{ lineId: doc.lines[0].id, productId: p.id, quantity: 1, price: 20, orderItemId: orderItem }],
          },
          f.actor,
        ),
      );
      assert.ok(result.id);
      assert.equal((await f.q('SELECT status FROM purchase_orders WHERE id=$1', [order]))[0].status, 'received');
    }, 1),
);
