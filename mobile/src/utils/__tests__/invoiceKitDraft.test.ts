import type { Product, Warehouse } from '../../../../shared/types';
import type { SupplierInvoiceDocument } from '../../../../shared/api/supplierInvoices';
import {
  invoiceRowDrafts,
  invoiceReceiptPayload,
  isReceivableProduct,
  invoiceUnitMismatch,
} from '../../../../shared/utils/supplierInvoiceReview';
import { kitDraftPayload } from '../../../../shared/utils/productKitDraft';
import { unitLabel } from '../units';

const product = { id: 'product', name: 'Фильтр', unit: 'шт', warehouseId: 'main', sellPrice: 100 } as Product;
const warehouses = [
  { id: 'main', kind: 'main' },
  { id: 'used', kind: 'used' },
] as Warehouse[];
const document = (): SupplierInvoiceDocument => ({
  id: 'document',
  supplierId: 'supplier',
  version: 3,
  status: 'review',
  date: '2026-10-25',
  orderId: null,
  comparison: null,
  pages: [],
  lines: [
    {
      id: 'line',
      name: 'ФИЛЬТР ПО НАКЛАДНОЙ',
      sku: 'A-1',
      unit: 'шт',
      quantity: 1,
      price: 12.5,
      productId: 'product',
      suggestedProductId: 'other',
      warnings: [],
    },
  ],
  warnings: [],
  deliveryId: null,
  duplicateOf: null,
  errorCode: null,
});
const options = {
  date: '2026-10-25',
  today: '2026-11-01',
  requestId: 'stable-request',
  products: [product],
  warehouses,
  unitLabel,
};

it('retains editable quantities/prices by immutable line ID without changing source document text/unit', () => {
  const doc = document(),
    drafts = invoiceRowDrafts(doc);
  drafts.line.quantity = '2,5';
  drafts.line.price = '0';
  const merged = invoiceRowDrafts({ ...doc, version: 4 }, drafts);
  expect(merged.line.quantity).toBe('2,5');
  expect(doc.lines[0].name).toBe('ФИЛЬТР ПО НАКЛАДНОЙ');
  expect(doc.lines[0].unit).toBe('шт');
  const payload = invoiceReceiptPayload(doc, merged, options);
  expect(payload.items).toEqual([
    { lineId: 'line', productId: 'product', quantity: 2.5, price: 0, productUnit: 'шт', unitConfirmed: true },
  ]);
  expect(payload.date).toBe('2026-10-25');
  expect(payload.receivedAt).toBeUndefined();
});

it('never treats an OCR suggestion as an approved product and never accepts used or assembled stock', () => {
  const doc = document();
  doc.lines[0].productId = null;
  doc.lines[0].suggestedProductId = 'product';
  expect(() => invoiceReceiptPayload(doc, invoiceRowDrafts(doc), options)).toThrow('Выберите');
  expect(isReceivableProduct({ ...product, warehouseId: 'used' }, warehouses)).toBe(false);
  expect(isReceivableProduct({ ...product, assemblyId: 'assembly' }, warehouses)).toBe(false);
  expect(isReceivableProduct(product, warehouses)).toBe(true);
});

it('receives exactly active reviewed lines while keeping excluded OCR evidence and user edits for restoration', () => {
  const doc = document();
  doc.lines.push({ ...doc.lines[0], id: 'noise', name: 'ИТОГО', productId: null, excluded: true });
  const drafts = invoiceRowDrafts(doc);
  drafts.noise.quantity = '99';
  expect(invoiceReceiptPayload(doc, drafts, options).items.map((line) => line.lineId)).toEqual(['line']);
  expect(doc.lines[1].name).toBe('ИТОГО');
  expect(drafts.noise.quantity).toBe('99');
  doc.lines[1].excluded = false;
  expect(() => invoiceReceiptPayload(doc, drafts, options)).toThrow('Выберите');
});

it('requires explicit unit/quantity acknowledgement and performs no conversion', () => {
  const doc = document();
  doc.lines[0].unit = 'уп';
  const drafts = invoiceRowDrafts(doc);
  expect(invoiceUnitMismatch(doc.lines[0], product, unitLabel)).toBe(true);
  expect(() => invoiceReceiptPayload(doc, drafts, options)).toThrow('единицу');
  drafts.line.unitAcknowledged = true;
  drafts.line.quantity = '12';
  expect(invoiceReceiptPayload(doc, drafts, options).items[0].quantity).toBe(12);
  expect(doc.lines[0].quantity).toBe(1);
});

it('keeps uncertain raw text visible and confirms the latest server catalog unit rather than a stale cached one', () => {
  const doc = document();
  doc.lines[0] = {
    ...doc.lines[0],
    quantity: null,
    quantityRaw: 'I2',
    price: null,
    priceRaw: 'I00',
    productUnit: 'л',
    unitMismatch: true,
  };
  const drafts = invoiceRowDrafts(doc);
  expect(drafts.line.quantity).toBe('I2');
  expect(drafts.line.price).toBe('I00');
  drafts.line.unitAcknowledged = true;
  expect(() => invoiceReceiptPayload(doc, drafts, options)).toThrow('количество');
  drafts.line.quantity = '12';
  drafts.line.price = '100';
  const item = invoiceReceiptPayload(doc, drafts, options).items[0];
  expect(item.productUnit).toBe('л');
  expect(item.unitConfirmed).toBe(true);
  expect(item.quantity).toBe(12);
});

it('preserves catalog retail when blank; sends explicit zero and rejects malformed money/dates', () => {
  const doc = document(),
    drafts = invoiceRowDrafts(doc);
  expect(invoiceReceiptPayload(doc, drafts, options).items[0].sellPrice).toBeUndefined();
  drafts.line.sellPrice = '0';
  expect(invoiceReceiptPayload(doc, drafts, options).items[0].sellPrice).toBe(0);
  drafts.line.sellPrice = '12abc';
  expect(() => invoiceReceiptPayload(doc, drafts, options)).toThrow('цены');
  drafts.line.sellPrice = '';
  expect(() => invoiceReceiptPayload(doc, drafts, { ...options, date: '2026-02-31' })).toThrow('дату документа');
  expect(() => invoiceReceiptPayload(doc, drafts, { ...options, receivedAt: '2026-11-02' })).toThrow('дату прихода');
});

it('requires one exact order position when the same SKU occurs twice and carries its identity', () => {
  const doc = document();
  doc.orderId = 'order';
  doc.comparison = {
    orderId: 'order',
    status: 'ordered',
    items: ['first', 'second'].map((orderItemId) => ({
      orderItemId,
      productId: product.id,
      name: product.name,
      orderedQuantity: 2,
      outstandingQuantity: 2,
      price: 12.5,
    })),
    lines: [],
    missingOrderItemIds: [],
  };
  const drafts = invoiceRowDrafts(doc);
  expect(() => invoiceReceiptPayload(doc, drafts, options)).toThrow('одной позицией');
  drafts.line.orderItemId = 'second';
  expect(invoiceReceiptPayload(doc, drafts, options).items[0].orderItemId).toBe('second');
});

it('validates batch counts and exact component quantities without sending stock, source costs or financial side effects', () => {
  const draft = {
    name: '  Комплект ТО ',
    quantity: '2',
    sellPrice: '123,45',
    warehouseId: 'main',
    lines: [
      { productId: 'oil', name: 'Масло', quantity: '3,5' },
      { productId: 'filter', name: 'Фильтр', quantity: '1' },
    ],
  };
  expect(kitDraftPayload(draft, 'request')).toEqual({
    requestId: 'request',
    name: 'Комплект ТО',
    quantity: 2,
    sellPrice: 123.45,
    warehouseId: 'main',
    components: [
      { productId: 'oil', quantity: 3.5 },
      { productId: 'filter', quantity: 1 },
    ],
  });
  expect(() => kitDraftPayload({ ...draft, quantity: '1,5' }, 'request')).toThrow('целое');
  expect(() => kitDraftPayload({ ...draft, lines: [...draft.lines, draft.lines[0]] }, 'request')).toThrow('разных');
  expect(() =>
    kitDraftPayload({ ...draft, lines: [{ productId: 'oil', name: 'Масло', quantity: '0.0001' }] }, 'request'),
  ).toThrow('количество');
});
