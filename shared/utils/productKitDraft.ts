import type { AssembleKitRequest, KitComponentInput } from '../api/productKits';
import { parsePurchaseOrderCost, parsePurchaseOrderQuantity } from './purchaseOrderInput';

export interface KitDraftLine {
  productId: string;
  name: string;
  quantity: string;
}
/** Read-only unit basis can contain sub-cent fractions; do not display it as zero. */
export function formatKitUnitCost(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(value)} ₽`;
}
export function kitComponents(lines: readonly KitDraftLine[]): KitComponentInput[] {
  if (!lines.length || lines.length > 100 || new Set(lines.map((line) => line.productId)).size !== lines.length)
    throw new Error('Выберите от 1 до 100 разных компонентов.');
  return lines.map((line) => {
    const quantity = parsePurchaseOrderQuantity(line.quantity);
    if (quantity === null) throw new Error(`Проверьте количество компонента «${line.name}».`);
    return { productId: line.productId, quantity };
  });
}
export function kitDraftPayload(
  draft: { name: string; quantity: string; sellPrice: string; lines: readonly KitDraftLine[]; warehouseId?: string },
  requestId: string,
): AssembleKitRequest {
  const quantity = Number(draft.quantity);
  const sellPrice = parsePurchaseOrderCost(draft.sellPrice);
  if (
    !draft.name.trim() ||
    !/^\d+$/.test(draft.quantity) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000 ||
    sellPrice === null
  )
    throw new Error('Укажите название, целое количество комплектов и корректную цену продажи.');
  return {
    requestId,
    name: draft.name.trim(),
    quantity,
    sellPrice,
    components: kitComponents(draft.lines),
    ...(draft.warehouseId ? { warehouseId: draft.warehouseId } : {}),
  };
}
