import type { CheckTemplate, Product } from '../types';

export type TemplateProduct = CheckTemplate['products'][number];
export type KitBatchChoice = { productId: string; quantity: number };
export type TemplateKitChoiceRequest = {
  line: TemplateProduct;
  candidates: Product[];
};
export type PreparedTemplateProduct = TemplateProduct & { catalogProduct?: Product; sellPrice: number };

/** Exact allocation only. Never silently select FIFO, truncate, or turn a missing recipe into a manual SKU. */
export function validateKitAllocation(
  line: TemplateProduct,
  candidates: readonly Product[],
  allocation: readonly KitBatchChoice[],
): void {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error('Проверьте количество комплектов.');
  const seen = new Set<string>();
  let total = 0;
  for (const choice of allocation) {
    const product = candidates.find((item) => item.id === choice.productId);
    if (
      !product?.assemblyId ||
      seen.has(choice.productId) ||
      !Number.isInteger(choice.quantity) ||
      choice.quantity < 1 ||
      choice.quantity > product.stock
    )
      throw new Error('Проверьте выбранные партии и их остатки.');
    seen.add(choice.productId);
    total += choice.quantity;
  }
  if (total !== line.quantity) throw new Error(`Выберите ровно ${line.quantity} комплектов.`);
}

/** Prepares every row before the caller changes any cart state. Null means an explicit cancellation. */
export async function prepareTemplateProducts(
  template: CheckTemplate,
  getProduct: (id: string, requireFresh?: boolean) => Promise<Product>,
  choose: (request: TemplateKitChoiceRequest) => Promise<KitBatchChoice[] | null>,
): Promise<PreparedTemplateProduct[] | null> {
  const result: PreparedTemplateProduct[] = [];
  const reserved = new Map<string, number>();
  for (const line of template.products) {
    if (line.kind !== 'kitRecipe') {
      const product = line.productId ? await getProduct(line.productId, false) : undefined;
      if (line.sellPrice === undefined && !product?.assemblyId)
        throw new Error('Не удалось проверить цену товара шаблона.');
      result.push({
        ...line,
        sellPrice: product?.assemblyId ? product.sellPrice : line.sellPrice!,
        catalogProduct: product,
      });
      continue;
    }
    if (!line.kitRecipeId || !line.kitRecipeVersion || !line.sourceTemplateProduct || !line.kitResolution)
      throw new Error('Обновите шаблоны для загрузки сохранённого состава.');
    const candidates = await Promise.all(
      line.kitResolution.candidates.map(async (snapshot) => {
        const product = await getProduct(snapshot.productId, true);
        if (product.assemblyId !== snapshot.assemblyId || product.assemblyRevision !== snapshot.revision)
          throw new Error('Партия комплекта изменилась. Обновите шаблоны и повторите.');
        return { ...product, stock: Math.max(0, product.stock - (reserved.get(product.id) ?? 0)) };
      }),
    );
    const active = candidates.filter((product) => product.stock > 0);
    let allocation: KitBatchChoice[] | null;
    if (active.length === 1 && active[0].stock >= line.quantity)
      allocation = [{ productId: active[0].id, quantity: line.quantity }];
    else allocation = await choose({ line, candidates: active });
    if (allocation === null) return null;
    validateKitAllocation(line, active, allocation);
    for (const choice of allocation) {
      const product = active.find((item) => item.id === choice.productId)!;
      reserved.set(product.id, (reserved.get(product.id) ?? 0) + choice.quantity);
      result.push({
        ...line,
        productId: product.id,
        name: product.name,
        quantity: choice.quantity,
        sellPrice: product.sellPrice,
        costPrice: product.assemblyExactCost ?? product.costPrice,
        sourceTemplateProduct: { ...line.sourceTemplateProduct, expectedAssemblyRevision: product.assemblyRevision! },
        catalogProduct: product,
      });
    }
  }
  return result;
}
