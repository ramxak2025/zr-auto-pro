import type { Product } from '../types';

/** Imported catalogues also use «БАЛЛОНЫ / Тороидальные». Compare the same segments we display. */
export function productFolderParts(path: string | null | undefined): string[] {
  return (path ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function productFolderPath(path: string | null | undefined): string {
  return productFolderParts(path).join('/');
}

/** One navigation level, using the same normalized paths for folders and products. */
export function buildProductFolderLevel(
  products: Product[],
  activePath: string[],
  extraFolders: { path?: string; name?: string; sort_order?: number }[] = [],
) {
  const folders = new Map<string, { name: string; count: number; hasLow: boolean; sortOrder: number }>();
  const currentProducts: Product[] = [];
  for (const product of products) {
    const parts = productFolderParts(product.category);
    if (!activePath.every((segment, index) => parts[index] === segment)) continue;
    if (parts.length === activePath.length) {
      currentProducts.push(product);
    } else {
      const name = parts[activePath.length];
      const folder = folders.get(name) ?? { name, count: 0, hasLow: false, sortOrder: 0 };
      folder.count++;
      folder.hasLow ||= product.minStock > 0 && product.stock <= product.minStock;
      folders.set(name, folder);
    }
  }
  for (const extra of extraFolders) {
    const parts = productFolderParts(extra.path || extra.name);
    if (parts.length <= activePath.length || !activePath.every((segment, index) => parts[index] === segment)) continue;
    const name = parts[activePath.length];
    const folder = folders.get(name) ?? { name, count: 0, hasLow: false, sortOrder: 0 };
    if (parts.length === activePath.length + 1) folder.sortOrder = extra.sort_order ?? 0;
    folders.set(name, folder);
  }
  const subfolders = [...folders.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'),
  );
  return { subfolders, currentProducts };
}
