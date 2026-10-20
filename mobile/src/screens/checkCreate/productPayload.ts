import type { CheckProductLine } from '../../../../shared/types';
import type { CreateCheckRequest } from '../../../../shared/api/types';

/** Capture only identities returned by the original saved check, never catalogue/template IDs. */
export function savedProductLineIds(lines: readonly CheckProductLine[]): ReadonlySet<string> {
  return new Set(lines.flatMap((line) => (line.id ? [line.id] : [])));
}

export function checkProductPayload(
  line: CheckProductLine,
  originalIds: ReadonlySet<string>,
): CreateCheckRequest['products'][number] {
  return {
    ...(line.id && originalIds.has(line.id) ? { id: line.id } : {}),
    sourceTemplateProduct: line.sourceTemplateProduct,
    productId: line.productId,
    name: line.name,
    sellPrice: line.sellPrice,
    costPrice: line.costPrice,
    quantity: line.quantity,
  };
}
