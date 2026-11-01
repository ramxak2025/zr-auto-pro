const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { fixture, options, status } = require('./helpers/nov01-inventory-fixture.cjs');
const { LocalStorageAdapter } = require('../dist/uploads/storage.service');
const { SupplierInvoicesService } = require('../dist/supplier-invoices/supplier-invoices.service');
const { SuppliersService } = require('../dist/suppliers/suppliers.service');
const { WarehousesService } = require('../dist/warehouses/warehouses.service');
const { PurchaseOrdersService } = require('../dist/purchase-orders/purchase-orders.service');
const annotation = (rows) => ({
  fullText: 'Накладная 01.09.2026',
  tables: [
    {
      cells: rows.flatMap((cells, row) =>
        cells.map((text, col) => ({ rowIndex: String(row), columnIndex: String(col), text })),
      ),
    },
  ],
});

async function invoiceFixture(f, work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autexa-nov01-invoice-images-'));
  const old = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  const storage = new LocalStorageAdapter();
  const suppliers = new SuppliersService(f.pool, f.movements, new WarehousesService(f.pool));
  const orders = new PurchaseOrdersService(f.pool, f.movements, suppliers);
  const state = {
    calls: 0,
    response: annotation([
      ['Наименование', 'Артикул', 'Кол-во', 'Цена', 'Ед.'],
      ['Шина', 'TIRE1', '2', '900', 'шт'],
      ['Шина', 'TIRE1', '1', '1100', 'шт'],
    ]),
    error: null,
  };
  const ocr = {
    assertConfigured() {},
    async recognize() {
      state.calls++;
      if (state.error) throw state.error;
      return state.response;
    },
  };
  const service = new SupplierInvoicesService(f.pool, storage, ocr, suppliers, orders);
  const supplier = randomUUID();
  await f.q("INSERT INTO suppliers(id,tenant_id,name) VALUES($1,$2,'Invoice supplier')", [supplier, f.tenant]);
  const image = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: '#fff' } })
    .jpeg()
    .toBuffer();
  try {
    await work({ service, storage, suppliers, orders, state, supplier, image });
  } finally {
    if (old === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = old;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test(
  'invoice preview is private and stock-free; explicit aliases + duplicate rows confirm atomically once without backdating',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        const p = await f.product();
        const run = (fn) => f.run(fn);
        let doc = await run(() => i.service.prepare(i.supplier, f.actor));
        doc = await run(() => i.service.addPage(doc.id, i.image, f.actor));
        const uploadedVersion = doc.version;
        doc = await run(() => i.service.addPage(doc.id, i.image, f.actor));
        assert.equal(doc.pages.length, 1);
        assert.equal(doc.version, uploadedVersion);
        const page = (await f.q('SELECT stored_path FROM supplier_invoice_pages WHERE document_id=$1', [doc.id]))[0]
          .stored_path;
        assert.ok(page.startsWith(`private/${f.tenant}/`));
        assert.ok(!JSON.stringify(doc).includes('stored_path'));
        assert.equal((await sharp(i.storage.resolve(page)).metadata()).width, 1800);
        await assert.rejects(
          run(() => i.service.get(doc.id, { ...f.actor, currentPointId: f.secondPoint })),
          status(404),
        );
        await assert.rejects(
          run(() => i.service.addPage(doc.id, Buffer.from('<svg/>'), f.actor)),
          status(400),
        );
        doc = await run(() => i.service.extract(doc.id, doc.version, f.actor));
        assert.equal(i.state.calls, 1);
        assert.equal(doc.lines.length, 2);
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '10.000');
        assert.equal(
          (await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [i.supplier]))[0].current_debt,
          '0.00',
        );
        for (const line of doc.lines)
          doc = await run(() =>
            i.service.mapLine(
              doc.id,
              line.id,
              { expectedVersion: doc.version, productId: p.id, remember: true },
              f.actor,
            ),
          );
        const body = {
          expectedVersion: doc.version,
          requestId: randomUUID(),
          date: '2026-09-01',
          items: doc.lines.map((line) => ({
            lineId: line.id,
            productId: p.id,
            quantity: line.quantity,
            price: line.price,
          })),
        };
        const [a, b] = await Promise.all([
          run(() => i.service.confirm(doc.id, body, f.actor)),
          run(() => i.service.confirm(doc.id, body, f.actor)),
        ]);
        assert.equal(a.id, b.id);
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '13.000');
        assert.equal(
          (await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [i.supplier]))[0].current_debt,
          '2900.00',
        );
        assert.equal((await f.q('SELECT count(*)::int n FROM delivery_items WHERE delivery_id=$1', [a.id]))[0].n, 2);
        const saved = (
          await f.q('SELECT delivery_id,document_date::text FROM supplier_invoice_documents WHERE id=$1', [doc.id])
        )[0];
        assert.equal(saved.document_date, '2026-09-01');
        assert.equal(saved.delivery_id, a.id);
        assert.ok(
          Date.now() - new Date((await f.q('SELECT date FROM deliveries WHERE id=$1', [a.id]))[0].date).getTime() <
            60000,
        );
        await assert.rejects(
          run(() => i.service.confirm(doc.id, { ...body, requestId: randomUUID() }, f.actor)),
          status(409),
        );
        let duplicate = await run(() => i.service.prepare(i.supplier, f.actor));
        duplicate = await run(() => i.service.addPage(duplicate.id, i.image, f.actor));
        const canonical = await run(() => i.service.extract(duplicate.id, duplicate.version, f.actor));
        assert.equal(canonical.id, doc.id);
        assert.equal(i.state.calls, 1);
      }),
    ),
);

test('invoice failure/retry is bounded; provider errors never recognize data or mutate stock', options, () =>
  fixture((f) =>
    invoiceFixture(f, async (i) => {
      const p = await f.product();
      let doc = await f.run(() => i.service.prepare(i.supplier, f.actor));
      doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
      i.state.error = new (require('@nestjs/common').HttpException)(
        { code: 'OCR_ACCESS_DENIED', message: 'Denied' },
        502,
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(
          f.run(() => i.service.extract(doc.id, doc.version, f.actor)),
          status(502),
        );
        doc = await f.run(() => i.service.get(doc.id, f.actor));
        assert.equal(doc.status, 'error');
        assert.equal(doc.lines.length, 0);
      }
      await assert.rejects(
        f.run(() => i.service.extract(doc.id, doc.version, f.actor)),
        status(429),
      );
      assert.equal(i.state.calls, 2);
      assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '10.000');
      assert.equal((await f.q('SELECT count(*)::int n FROM deliveries WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
    }),
  ),
);

test(
  'invoice stale mappings, cross-point products, budget reservation and receipt-link failure preserve inventory',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        const p = await f.product({ article: 'TIRE1' }),
          wrongPoint = await f.run(() =>
            f.products.create(f.tenant, { name: 'Wrong-point product', warehouseId: f.secondWh }, f.secondPoint),
          );
        let doc = await f.run(() => i.service.prepare(i.supplier, f.actor));
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        const oldLimit = process.env.INVOICE_OCR_MONTHLY_PAGE_LIMIT;
        process.env.INVOICE_OCR_MONTHLY_PAGE_LIMIT = '1';
        const otherImage = await sharp({ create: { width: 1600, height: 2200, channels: 3, background: '#eee' } })
          .jpeg()
          .toBuffer();
        let budgetDoc = await f.run(() => i.service.prepare(i.supplier, f.actor));
        budgetDoc = await f.run(() => i.service.addPage(budgetDoc.id, i.image, f.actor));
        budgetDoc = await f.run(() => i.service.addPage(budgetDoc.id, otherImage, f.actor));
        try {
          await assert.rejects(
            f.run(() => i.service.extract(budgetDoc.id, budgetDoc.version, f.actor)),
            status(429),
          );
          assert.equal(i.state.calls, 0);
        } finally {
          if (oldLimit === undefined) delete process.env.INVOICE_OCR_MONTHLY_PAGE_LIMIT;
          else process.env.INVOICE_OCR_MONTHLY_PAGE_LIMIT = oldLimit;
        }
        doc = await f.run(() => i.service.extract(doc.id, doc.version, f.actor));
        assert.equal(doc.lines[0].suggestedProductId, p.id);
        assert.equal(doc.lines[0].productId, null);
        await assert.rejects(
          f.run(() =>
            i.service.mapLine(
              doc.id,
              doc.lines[0].id,
              { expectedVersion: doc.version, productId: wrongPoint.id },
              f.actor,
            ),
          ),
          status(400),
        );
        await assert.rejects(
          f.run(() =>
            i.service.mapLine(doc.id, doc.lines[0].id, { expectedVersion: doc.version - 1, productId: p.id }, f.actor),
          ),
          status(409),
        );
        for (const line of doc.lines)
          doc = await f.run(() =>
            i.service.mapLine(doc.id, line.id, { expectedVersion: doc.version, productId: p.id }, f.actor),
          );
        const body = {
          expectedVersion: doc.version,
          requestId: randomUUID(),
          date: '2026-09-01',
          items: doc.lines.map((line) => ({
            lineId: line.id,
            productId: p.id,
            quantity: line.quantity,
            price: line.price,
          })),
        };
        await f.q(`CREATE FUNCTION nov01_reject_invoice_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status='confirmed' THEN RAISE EXCEPTION 'fixture receipt link failure'; END IF; RETURN NEW; END $$`);
        await f.q(
          'CREATE TRIGGER nov01_reject_invoice_link BEFORE UPDATE ON supplier_invoice_documents FOR EACH ROW EXECUTE FUNCTION nov01_reject_invoice_link()',
        );
        try {
          await assert.rejects(
            f.run(() => i.service.confirm(doc.id, body, f.actor)),
            status(500),
          );
        } finally {
          await f.q('DROP TRIGGER nov01_reject_invoice_link ON supplier_invoice_documents');
          await f.q('DROP FUNCTION nov01_reject_invoice_link()');
        }
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '10.000');
        assert.equal((await f.q('SELECT count(*)::int n FROM deliveries WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
        assert.equal(
          (await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [i.supplier]))[0].current_debt,
          '0.00',
        );
        assert.equal((await f.run(() => i.service.get(doc.id, f.actor))).status, 'review');
        assert.ok((await f.run(() => i.service.confirm(doc.id, body, f.actor))).id);
      }),
    ),
);

test(
  'invoice order comparison and receipt update the order, supply, stock and document in one transaction',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        const p = await f.product();
        const order = randomUUID(),
          item = randomUUID();
        await f.q(
          "INSERT INTO purchase_orders(id,tenant_id,supplier_id,point_id,status,total) VALUES($1,$2,$3,$4,'ordered',2700)",
          [order, f.tenant, i.supplier, f.point],
        );
        await f.q(
          "INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,product_id,name,quantity,cost_price) VALUES($1,$2,$3,$4,'Шина',3,900)",
          [item, f.tenant, order, p.id],
        );
        i.state.response = annotation([
          ['Наименование', 'Артикул', 'Кол-во', 'Цена', 'Ед.'],
          ['Шина', 'TIRE1', '3', '1000', 'pcs'],
        ]);
        let doc = await f.run(() => i.service.prepare(i.supplier, f.actor, order));
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        doc = await f.run(() => i.service.extract(doc.id, doc.version, f.actor));
        doc = await f.run(() =>
          i.service.mapLine(doc.id, doc.lines[0].id, { expectedVersion: doc.version, productId: p.id }, f.actor),
        );
        assert.deepEqual(doc.comparison.lines[0].markers, ['different_price']);
        assert.equal(doc.comparison.lines[0].orderItemId, item);
        const body = {
          expectedVersion: doc.version,
          requestId: randomUUID(),
          date: '2026-09-01',
          items: [{ lineId: doc.lines[0].id, productId: p.id, orderItemId: item, quantity: 3, price: 1000 }],
        };
        // The standalone supplier endpoint cannot bypass the attached order lifecycle.
        await assert.rejects(
          f.run(() =>
            i.suppliers.createDelivery(
              f.tenant,
              {
                supplierId: i.supplier,
                requestId: randomUUID(),
                invoiceDocumentId: doc.id,
                expectedInvoiceVersion: doc.version,
                invoiceLineIds: [doc.lines[0].id],
                items: [{ productId: p.id, quantity: 3, price: 1000 }],
              },
              f.point,
              f.owner,
            ),
          ),
          status(400),
        );
        const result = await f.run(() => i.service.confirm(doc.id, body, f.actor));
        assert.equal((await f.q('SELECT status FROM purchase_orders WHERE id=$1', [order]))[0].status, 'received');
        assert.equal(
          (await f.q('SELECT received_quantity FROM purchase_order_items WHERE id=$1', [item]))[0].received_quantity,
          '3.000',
        );
        assert.equal(
          (await f.q('SELECT purchase_order_id FROM deliveries WHERE id=$1', [result.id]))[0].purchase_order_id,
          order,
        );
        assert.equal(
          (await f.q('SELECT delivery_id FROM supplier_invoice_documents WHERE id=$1', [doc.id]))[0].delivery_id,
          result.id,
        );
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '13.000');
      }),
    ),
);

test(
  'versioned page deletion preserves other images/order and allows replacement without inventory effects',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        let doc = await f.run(() => i.service.prepare(i.supplier, f.actor));
        const alternate = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: '#aaa' } })
          .jpeg()
          .toBuffer();
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        doc = await f.run(() => i.service.addPage(doc.id, alternate, f.actor));
        const first = doc.pages[0],
          second = doc.pages[1],
          savedPath = (await f.q('SELECT stored_path FROM supplier_invoice_pages WHERE id=$1', [first.id]))[0]
            .stored_path;
        await assert.rejects(
          f.run(() => i.service.deletePage(doc.id, first.id, doc.version - 1, f.actor)),
          status(409),
        );
        doc = await f.run(() => i.service.extract(doc.id, doc.version, f.actor));
        assert.equal(doc.status, 'review');
        doc = await f.run(() => i.service.deletePage(doc.id, first.id, doc.version, f.actor));
        assert.equal(doc.status, 'draft');
        assert.equal(doc.lines.length, 0);
        assert.equal(doc.pages.length, 1);
        assert.equal(doc.pages[0].id, second.id);
        assert.equal(doc.pages[0].index, 0);
        assert.equal(i.storage.exists(savedPath), false);
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        assert.equal(doc.pages.length, 2);
        assert.equal(doc.pages[0].id, second.id);
        await f.q("UPDATE supplier_invoice_documents SET status='processing',processing_at=now() WHERE id=$1", [
          doc.id,
        ]);
        await assert.rejects(
          f.run(() => i.service.deletePage(doc.id, second.id, doc.version, f.actor)),
          status(409),
        );
        assert.equal((await f.q('SELECT count(*)::int n FROM deliveries WHERE tenant_id=$1', [f.tenant]))[0].n, 0);
      }),
    ),
);

test(
  'unit mismatch requires explicit stock-unit quantity/price confirmation and rechecks changed catalog unit; used/assembly mapping forbidden',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        const p = await f.product({ unit: 'шт' }),
          used = await f.product({ warehouseId: f.used });
        i.state.response = annotation([
          ['Наименование', 'Артикул', 'Кол-во', 'Цена', 'Ед.'],
          ['Шина', 'TIRE1', '1', '1000', 'уп'],
        ]);
        let doc = await f.run(() => i.service.prepare(i.supplier, f.actor));
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        doc = await f.run(() => i.service.extract(doc.id, doc.version, f.actor));
        await assert.rejects(
          f.run(() =>
            i.service.mapLine(doc.id, doc.lines[0].id, { expectedVersion: doc.version, productId: used.id }, f.actor),
          ),
          status(400),
        );
        doc = await f.run(() =>
          i.service.mapLine(doc.id, doc.lines[0].id, { expectedVersion: doc.version, productId: p.id }, f.actor),
        );
        assert.equal(doc.lines[0].unitMismatch, true);
        assert.equal(doc.lines[0].unitConfirmed, false);
        assert.equal(doc.lines[0].quantity, 1);
        assert.equal(doc.lines[0].price, 1000);
        const body = {
          expectedVersion: doc.version,
          requestId: randomUUID(),
          date: '2026-09-01',
          items: [{ lineId: doc.lines[0].id, productId: p.id, quantity: 10, price: 100 }],
        };
        await assert.rejects(
          f.run(() => i.service.confirm(doc.id, body, f.actor)),
          (error) => error.getResponse().code === 'INVOICE_UNIT_CONFIRMATION_REQUIRED',
        );
        await f.run(() => f.products.update(p.id, f.tenant, { unit: 'кг' }, f.owner, f.point));
        await assert.rejects(
          f.run(() =>
            i.service.confirm(
              doc.id,
              { ...body, items: [{ ...body.items[0], unitConfirmed: true, productUnit: 'шт' }] },
              f.actor,
            ),
          ),
          (error) => error.getResponse().code === 'INVOICE_PRODUCT_UNIT_CHANGED',
        );
        await f.run(() => f.products.update(p.id, f.tenant, { unit: 'шт' }, f.owner, f.point));
        assert.ok(
          (
            await f.run(() =>
              i.service.confirm(
                doc.id,
                { ...body, items: [{ ...body.items[0], unitConfirmed: true, productUnit: 'шт' }] },
                f.actor,
              ),
            )
          ).id,
        );
        const confirmed = await f.run(() => i.service.get(doc.id, f.actor));
        assert.equal(confirmed.lines[0].quantity, 1);
        assert.equal(confirmed.lines[0].confirmedQuantity, 10);
        assert.equal(confirmed.lines[0].confirmedPrice, 100);
        assert.equal(confirmed.lines[0].unitConfirmed, true);
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '20.000');
        assert.equal(
          (await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [i.supplier]))[0].current_debt,
          '1000.00',
        );
      }),
    ),
);

test(
  'review exclusions preserve raw evidence; manual picker rows replay safely and never teach supplier aliases',
  options,
  () =>
    fixture((f) =>
      invoiceFixture(f, async (i) => {
        const p = await f.product();
        i.state.response = annotation([
          ['Наименование', 'Артикул', 'Кол-во', 'Цена', 'Ед.'],
          ['Шина', 'TIRE1', '2', '900', 'шт'],
          ['Ложный итог', '', '1', '55', 'шт'],
        ]);
        let doc = await f.run(() => i.service.prepare(i.supplier, f.actor));
        doc = await f.run(() => i.service.addPage(doc.id, i.image, f.actor));
        doc = await f.run(() => i.service.extract(doc.id, doc.version, f.actor));
        const goodId = doc.lines[0].id,
          badId = doc.lines[1].id,
          raw = { ...doc.lines[1] };
        assert.equal(raw.origin, 'ocr');
        assert.equal(raw.sourcePageIndex, 0);
        assert.equal(raw.sourceRowIndex, 2);
        doc = await f.run(() =>
          i.service.reviewLine(doc.id, badId, { expectedVersion: doc.version, excluded: true }, f.actor),
        );
        assert.equal(doc.lines.find((line) => line.id === badId).name, raw.name);
        assert.equal(doc.lines.find((line) => line.id === badId).quantity, raw.quantity);
        doc = await f.run(() =>
          i.service.mapLine(doc.id, goodId, { expectedVersion: doc.version, productId: p.id }, f.actor),
        );
        const manualRequest = {
          expectedVersion: doc.version,
          requestId: randomUUID(),
          productId: p.id,
          quantity: 2,
          price: 123.45,
        };
        const [first, replay] = await Promise.all([
          f.run(() => i.service.addManualLine(doc.id, manualRequest, f.actor)),
          f.run(() => i.service.addManualLine(doc.id, manualRequest, f.actor)),
        ]);
        doc = first;
        const manual = doc.lines.find((line) => line.origin === 'manual');
        assert.equal(replay.lines.find((line) => line.origin === 'manual').id, manual.id);
        assert.equal(doc.lines.filter((line) => line.origin === 'manual').length, 1);
        assert.equal(manual.sourcePageIndex, undefined);
        const refresh = await f.run(() =>
          i.service.addManualLine(doc.id, { ...manualRequest, expectedVersion: doc.version }, f.actor),
        );
        assert.equal(refresh.version, doc.version);
        await assert.rejects(
          f.run(() =>
            i.service.addManualLine(doc.id, { ...manualRequest, expectedVersion: doc.version, price: 124 }, f.actor),
          ),
          (error) => error.getResponse().code === 'INVOICE_MANUAL_REQUEST_CONFLICT',
        );
        doc = await f.run(() =>
          i.service.mapLine(
            doc.id,
            manual.id,
            { expectedVersion: doc.version, productId: p.id, remember: true },
            f.actor,
          ),
        );
        assert.equal(
          (await f.q('SELECT count(*)::int n FROM supplier_product_aliases WHERE tenant_id=$1', [f.tenant]))[0].n,
          1,
        );
        const active = () =>
          doc.lines
            .filter((line) => !line.excluded)
            .map((line) => ({
              lineId: line.id,
              productId: line.productId,
              quantity: line.quantity,
              price: line.price,
            }));
        const requestId = randomUUID();
        await assert.rejects(
          f.run(() =>
            i.service.confirm(
              doc.id,
              {
                expectedVersion: doc.version,
                requestId,
                date: '2026-09-01',
                items: [...active(), { lineId: badId, productId: p.id, quantity: 1, price: 55 }],
              },
              f.actor,
            ),
          ),
          status(400),
        );
        doc = await f.run(() =>
          i.service.reviewLine(doc.id, badId, { expectedVersion: doc.version, excluded: false }, f.actor),
        );
        await assert.rejects(
          f.run(() =>
            i.service.confirm(
              doc.id,
              {
                expectedVersion: doc.version,
                requestId,
                date: '2026-09-01',
                items: active().filter((line) => line.lineId !== badId),
              },
              f.actor,
            ),
          ),
          status(400),
        );
        doc = await f.run(() =>
          i.service.reviewLine(doc.id, badId, { expectedVersion: doc.version, excluded: true }, f.actor),
        );
        const result = await f.run(() =>
          i.service.confirm(
            doc.id,
            { expectedVersion: doc.version, requestId, date: '2026-09-01', items: active() },
            f.actor,
          ),
        );
        assert.ok(result.id);
        assert.equal((await f.q('SELECT stock FROM products WHERE id=$1', [p.id]))[0].stock, '14.000');
        assert.equal(
          (await f.q('SELECT current_debt FROM suppliers WHERE id=$1', [i.supplier]))[0].current_debt,
          '2046.90',
        );
        const late = await f.run(() => i.service.addManualLine(doc.id, manualRequest, f.actor));
        assert.equal(late.status, 'confirmed');
        assert.equal(late.lines.filter((line) => line.origin === 'manual').length, 1);
      }),
    ),
);
