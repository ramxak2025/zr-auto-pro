/** Purchase-order fields match the receipt quantity boundary (three decimals) and per-unit price cents. */
export const MIN_PURCHASE_ORDER_QUANTITY = 0.001;
export interface PurchaseOrderLineValue {
  quantity: number;
  costPrice: number;
}
export interface PurchaseOrderPickerLine {
  productId: string;
  quantityText: string;
  costPriceText: string;
  receivedQuantity: number;
}
function decimal(value: string, places: number): number | null {
  const text = value.trim().replace(',', '.');
  if (!new RegExp(`^(?:\\d+(?:\\.\\d{0,${places}})?|\\.\\d{1,${places}})$`).test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
export function parsePurchaseOrderQuantity(text: string): number | null {
  const value = decimal(text, 3);
  return value !== null && value >= MIN_PURCHASE_ORDER_QUANTITY ? value : null;
}
export function parsePurchaseOrderCost(text: string): number | null {
  const value = decimal(text, 2);
  return value !== null && value >= 0 ? value : null;
}
export function purchaseOrderLineValue(
  quantityText: string,
  costPriceText: string,
  minimum = MIN_PURCHASE_ORDER_QUANTITY,
): PurchaseOrderLineValue | null {
  const quantity = parsePurchaseOrderQuantity(quantityText);
  const costPrice = parsePurchaseOrderCost(costPriceText);
  return quantity !== null && quantity >= minimum && costPrice !== null ? { quantity, costPrice } : null;
}
export function roundPurchaseOrderQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
export function formatPurchaseOrderMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(value * 100) / 100);
}
