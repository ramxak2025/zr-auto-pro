import type { CheckProductLine, Product } from '../types';
import type { KitSplitIntent, PhysicalProductKit } from '../api/productKits';

export type KitCartLine = CheckProductLine & { assemblyId?: string | null };

export const KIT_SPLIT_NOTE = 'При проведении остаток вернётся на склад; возврат — товарами, без сборки комплекта.';

/** Ordinary selections never merge into captured components, even for the same SKU. */
export function ordinaryProductIndex(
  lines: readonly { productId?: string; kitSource?: CheckProductLine['kitSource'] }[],
  productId: string,
): number {
  return lines.findIndex((line) => line.productId === productId && !line.kitSource);
}

/** Pure cart conversion: no stock API is called until the receipt is confirmed. */
export function splitKitCartLine(
  kit: PhysicalProductKit,
  quantity: number,
  intentId: string,
  catalog: readonly Product[],
) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Укажите целое количество комплектов');
  const intent: KitSplitIntent = { intentId, productId: kit.productId, expectedRevision: kit.revision, quantity };
  const lines: CheckProductLine[] = kit.components.map((component) => {
    const product = catalog.find((item) => item.id === component.productId);
    if (!product) throw new Error(`Не удалось загрузить товар «${component.name}». Повторите разделение.`);
    const qty = component.quantity * quantity;
    return {
      productId: component.productId,
      name: component.name,
      sellPrice: product.sellPrice,
      costPrice: component.costPrice ?? product.costPrice,
      quantity: qty,
      totalSell: product.sellPrice * qty,
      totalCost: (component.costPrice ?? product.costPrice) * qty,
      unit: product.unit,
      kitSource: { intentId, sourceProductId: component.productId },
    };
  });
  return { intent, lines };
}

/** Already committed conversions remain part of check history. Unused new intentions do not. */
export function usedKitSplits(
  intents: readonly KitSplitIntent[],
  lines: readonly { kitSource?: CheckProductLine['kitSource'] }[],
  saved: ReadonlySet<string> = new Set(),
): KitSplitIntent[] {
  const used = new Set(lines.flatMap((line) => (line.kitSource ? [line.kitSource.intentId] : [])));
  return intents.filter((intent) => used.has(intent.intentId) || saved.has(intent.intentId));
}
