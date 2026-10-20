import type { MotivationTarget, Product } from '../../../../shared/types';
import { productFolderParts, productFolderPath } from '../../../../shared/utils/productFolders';

export interface MotivationChoice {
  target: MotivationTarget;
  title: string;
  warehouseId: string | null;
  path: string;
  detail: string;
}

export function motivationTargetKey(target: MotivationTarget): string {
  return target.kind === 'product'
    ? `product:${target.productId}`
    : JSON.stringify(['folder', target.warehouseId, productFolderPath(target.path)]);
}

export function coversChoice(parent: MotivationChoice, child: MotivationChoice): boolean {
  if (motivationTargetKey(parent.target) === motivationTargetKey(child.target)) return true;
  return (
    parent.target.kind === 'folder' &&
    parent.warehouseId === child.warehouseId &&
    (child.path === parent.path || child.path.startsWith(`${parent.path}/`))
  );
}

/** Explicit targets are independent: including a parent never discards an override. */
export function toggleMotivationChoice(selected: MotivationChoice[], choice: MotivationChoice): MotivationChoice[] {
  const key = motivationTargetKey(choice.target);
  if (selected.some((item) => motivationTargetKey(item.target) === key)) {
    return selected.filter((item) => motivationTargetKey(item.target) !== key);
  }
  return [...selected, choice];
}

/** A deliberate legacy conversion creates an effective individual sales rule. */
export function motivationApplyTargets(
  targets: MotivationTarget[],
  replacements: { productId: string }[],
): MotivationTarget[] {
  const unique = new Map(targets.map((target) => [motivationTargetKey(target), target]));
  for (const { productId } of replacements) {
    const target: MotivationTarget = { kind: 'product', productId };
    unique.set(motivationTargetKey(target), target);
  }
  return [...unique.values()];
}

export function buildMotivationChoices(
  products: Product[],
  categories: { id: string; path: string }[],
  warehouseId: string | null,
): { products: MotivationChoice[]; folders: MotivationChoice[] } {
  const categoryIds = new Map(categories.map((category) => [productFolderPath(category.path), category.id]));
  const folders = new Set<string>();
  for (const path of [...products.map((product) => product.category), ...categories.map((category) => category.path)]) {
    const parts = productFolderParts(path);
    for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join('/'));
  }
  return {
    products: products.map((product) => ({
      target: { kind: 'product', productId: product.id },
      title: product.name,
      warehouseId: product.warehouseId ?? warehouseId,
      path: productFolderPath(product.category),
      detail: [product.category || 'Без папки', product.article, product.barcode].filter(Boolean).join(' · '),
    })),
    folders: [...folders]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((path) => ({
        target: {
          kind: 'folder',
          warehouseId,
          path,
          ...(categoryIds.get(path) ? { categoryId: categoryIds.get(path) } : {}),
        },
        title: productFolderParts(path).at(-1) || path,
        warehouseId,
        path,
        detail: path,
      })),
  };
}

export function filterMotivationChoices(choices: MotivationChoice[], search: string): MotivationChoice[] {
  const terms = search.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  return choices.filter((choice) =>
    terms.every((term) => `${choice.title} ${choice.detail}`.toLocaleLowerCase('ru').includes(term)),
  );
}

export function parseMotivationPercent(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent > 0 && percent <= 100 ? percent : null;
}

export function motivationError(error: unknown, fallback: string): { message: string; stale: boolean } {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[]; code?: string } } })
    ?.response;
  const message = response?.data?.message;
  return {
    message: Array.isArray(message)
      ? message.join('\n')
      : message || (error instanceof Error ? error.message : fallback),
    stale: response?.status === 409 || response?.data?.code === 'MOTIVATION_PREVIEW_STALE',
  };
}
