import type { Product, Warehouse } from '../types';
import type {
  AddManualSupplierInvoiceLine,
  ConfirmSupplierInvoice,
  SupplierInvoiceDocument,
  SupplierInvoiceLine,
} from '../api/supplierInvoices';
import { parsePurchaseOrderCost, parsePurchaseOrderQuantity } from './purchaseOrderInput';

export interface InvoiceRowDraft {
  quantity: string;
  price: string;
  sellPrice: string;
  unitAcknowledged: boolean;
  orderItemId: string;
}
export type InvoiceRowDrafts = Record<string, InvoiceRowDraft>;
export interface ManualInvoiceDraft {
  productId: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  requestId: string;
  pending?: AddManualSupplierInvoiceLine;
}
export function manualInvoicePayload(
  document: SupplierInvoiceDocument,
  draft: ManualInvoiceDraft,
): AddManualSupplierInvoiceLine {
  if (draft.pending) return draft.pending;
  const quantity = parsePurchaseOrderQuantity(draft.quantity),
    price = parsePurchaseOrderCost(draft.price);
  if (quantity === null || price === null) throw new Error('Укажите количество и закупочную цену добавляемого товара.');
  return { expectedVersion: document.version, requestId: draft.requestId, productId: draft.productId, quantity, price };
}

export function invoiceRowDrafts(document: SupplierInvoiceDocument, previous: InvoiceRowDrafts = {}): InvoiceRowDrafts {
  return Object.fromEntries(
    document.lines.map((line) => [
      line.id,
      previous[line.id] ?? {
        quantity: line.quantity === null ? (line.quantityRaw ?? '') : String(line.quantity),
        price: line.price === null ? (line.priceRaw ?? '') : String(line.price),
        sellPrice: '',
        unitAcknowledged: !!line.unitConfirmed,
        orderItemId: document.comparison?.lines.find((item) => item.lineId === line.id)?.orderItemId ?? '',
      },
    ]),
  );
}

/** Supplier receipts do not create purchases on the used warehouse or assembled stock. */
export function isReceivableProduct(product: Product, warehouses: readonly Warehouse[]): boolean {
  return (
    !product.assemblyId &&
    (!product.warehouseId ||
      warehouses.some((warehouse) => warehouse.id === product.warehouseId && warehouse.kind !== 'used'))
  );
}

export function invoiceUnitMismatch(
  line: SupplierInvoiceLine,
  product: Product,
  unitLabel: (unit?: string | null) => string,
): boolean {
  if (typeof line.unitMismatch === 'boolean') return line.unitMismatch;
  return (
    !line.unit.trim() || unitLabel(line.unit).trim().toLowerCase() !== unitLabel(product.unit).trim().toLowerCase()
  );
}

/** Compare the reviewed values, while retaining the immutable OCR warnings as evidence. */
export function invoiceReviewWarnings(
  document: SupplierInvoiceDocument,
  line: SupplierInvoiceLine,
  draft?: InvoiceRowDraft,
): string[] {
  // The compact unit warning and one document acknowledgement cover this long
  // server explanation; keep the original warning in the immutable document.
  const warnings = line.warnings.filter((warning) => !(line.unitMismatch && warning.startsWith('Единица накладной')));
  if (!document.orderId) return warnings;
  const candidates =
    document.comparison?.items.filter(
      (item) => item.productId === line.productId && (!draft?.orderItemId || item.orderItemId === draft.orderItemId),
    ) ?? [];
  if (candidates.length !== 1) return [...warnings, candidates.length ? 'ambiguous' : 'extra'];
  const ordered = candidates[0];
  if (parsePurchaseOrderQuantity(draft?.quantity ?? '') !== ordered.outstandingQuantity)
    warnings.push('different_quantity');
  if (parsePurchaseOrderCost(draft?.price ?? '') !== ordered.price) warnings.push('different_price');
  return warnings;
}

export function validInvoiceDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function invoiceReceiptPayload(
  document: SupplierInvoiceDocument,
  drafts: InvoiceRowDrafts,
  options: {
    date: string;
    receivedAt?: string;
    today: string;
    requestId: string;
    products: readonly Product[];
    warehouses: readonly Warehouse[];
    unitLabel: (unit?: string | null) => string;
  },
): ConfirmSupplierInvoice {
  const active = document.lines.filter((line) => !line.excluded);
  if (document.status !== 'review' || !active.length)
    throw new Error('Сначала распознайте накладную и проверьте строки.');
  if (!validInvoiceDay(options.date)) throw new Error('Укажите дату документа.');
  if (options.receivedAt && (!validInvoiceDay(options.receivedAt) || options.receivedAt > options.today))
    throw new Error('Проверьте дату прихода на склад.');
  const usedOrderItems = new Set<string>();
  const items = active.map((line) => {
    const product = options.products.find((item) => item.id === line.productId);
    const draft = drafts[line.id];
    if (!product || !isReceivableProduct(product, options.warehouses))
      throw new Error(`Выберите доступный товар для «${line.name}».`);
    if (invoiceUnitMismatch(line, product, options.unitLabel) && !draft?.unitAcknowledged)
      throw new Error(`Проверьте единицу и количество для «${line.name}».`);
    const quantity = parsePurchaseOrderQuantity(draft?.quantity ?? '');
    const price = parsePurchaseOrderCost(draft?.price ?? '');
    const sellPrice = draft?.sellPrice.trim() ? parsePurchaseOrderCost(draft.sellPrice) : undefined;
    if (quantity === null || price === null || sellPrice === null)
      throw new Error(`Проверьте количество и цены для «${line.name}».`);
    const orderItem = document.orderId
      ? document.comparison?.items.filter(
          (item) => item.productId === product.id && (!draft.orderItemId || item.orderItemId === draft.orderItemId),
        )
      : [];
    if (document.orderId && orderItem?.length !== 1)
      throw new Error('Сопоставьте строку с одной позицией заказа или выберите приёмку без заказа.');
    const orderItemId = orderItem?.[0]?.orderItemId;
    if (orderItemId && usedOrderItems.has(orderItemId))
      throw new Error('Повторные строки товара примите без привязки к заказу.');
    if (orderItemId) usedOrderItems.add(orderItemId);
    return {
      lineId: line.id,
      productId: product.id,
      quantity,
      price,
      productUnit: line.productUnit ?? product.unit ?? options.unitLabel(product.unit),
      unitConfirmed: !invoiceUnitMismatch(line, product, options.unitLabel) || draft.unitAcknowledged,
      ...(sellPrice !== undefined ? { sellPrice } : {}),
      ...(orderItemId ? { orderItemId } : {}),
    };
  });
  return {
    expectedVersion: document.version,
    requestId: options.requestId,
    date: options.date,
    ...(options.receivedAt ? { receivedAt: options.receivedAt } : {}),
    items,
  };
}

export const invoiceWarningLabel = (warning: string): string =>
  ({
    extra: 'Нет в заказе',
    ambiguous: 'Несколько позиций в заказе',
    different_quantity: 'Количество отличается от заказа',
    different_price: 'Цена отличается от заказа',
    missing_quantity: 'Не распознано количество',
    missing_price: 'Не распознана закупочная цена',
    missing_name: 'Не распознано название',
  })[warning] ?? (/^[А-Яа-яЁё]/.test(warning) ? warning : 'Проверьте распознанную строку');
