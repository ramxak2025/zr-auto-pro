import type { Product } from '../../../../shared/types';
import { buildProductFolderLevel } from '../../../../shared/utils/productFolders';
import { cellCodeMatchesQuery } from '../../utils/storageCellsUi';

/** Inventory is an absolute count. Keep the original text, never round or strip it. */
export function parseInventoryQuantity(raw: string): number | null {
  if (!/^(?:\d+(?:[.,]\d{0,3})?|[.,]\d{1,3})$/.test(raw)) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 && value <= 999999999.999 ? value : null;
}

export interface InventoryStockRequest {
  type: 'inventory';
  quantity: number;
  reason: string;
  requestId: string;
  expectedStock: number;
  expectedWarehouseId: string;
}
export interface InventoryDraft {
  name?: string;
  unavailable?: boolean;
  raw: string;
  expectedStock: number;
  pending?: Readonly<InventoryStockRequest>;
  needsReview?: boolean;
  reviewReady?: boolean;
}
export type InventoryDrafts = Record<string, InventoryDraft>;
export type InventoryRow =
  | { type: 'folder'; key: string; name: string; count: number }
  | { type: 'product'; key: string; product: Product };

export function inventoryRows(
  products: Product[],
  path: string[],
  search: string,
  folders: { path?: string; name?: string; sort_order?: number }[],
): InventoryRow[] {
  const query = search.trim().toLowerCase();
  if (query) {
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          String(p.barcode ?? '')
            .toLowerCase()
            .includes(query) ||
          cellCodeMatchesQuery(p.storageCellCode, query),
      )
      .map((product) => ({ type: 'product', key: product.id, product }));
  }
  const level = buildProductFolderLevel(products, path, folders);
  return [
    ...level.subfolders.map((folder) => ({ type: 'folder' as const, key: `folder:${folder.name}`, ...folder })),
    ...level.currentProducts.map((product) => ({ type: 'product' as const, key: product.id, product })),
  ];
}

export function inventorySummary(drafts: InventoryDrafts, products: Product[]) {
  let counted = 0,
    changed = 0,
    invalid = 0,
    review = 0;
  const ids = new Set(products.map((p) => p.id));
  for (const [id, draft] of Object.entries(drafts)) {
    if (draft.needsReview) {
      review++;
      continue;
    }
    if (!draft.raw) continue;
    const value = parseInventoryQuantity(draft.raw);
    if (value === null || (!draft.pending && !ids.has(id))) {
      invalid++;
      continue;
    }
    counted++;
    if (value !== draft.expectedStock) changed++;
  }
  return { counted, changed, invalid, review };
}

export function inventoryError(error: unknown): { conflict: boolean; message: string } {
  const response = (error as { response?: { status?: number; data?: { message?: unknown; code?: string } } })?.response;
  return {
    conflict: response?.status === 409 && response.data?.code === 'INVENTORY_STOCK_CONFLICT',
    message:
      typeof response?.data?.message === 'string'
        ? response.data.message
        : 'Проверьте соединение и повторите проведение.',
  };
}

/** Only a full successful catalogue refresh can resolve a stock-conflict review. */
export function reconcileInventoryDrafts(drafts: InventoryDrafts, products: Product[]): InventoryDrafts {
  const next = { ...drafts };
  for (const [id, draft] of Object.entries(drafts)) {
    if (!draft.needsReview) continue;
    const product = products.find((item) => item.id === id);
    next[id] = {
      ...draft,
      expectedStock: product?.stock ?? draft.expectedStock,
      reviewReady: true,
      unavailable: !product,
    };
  }
  return next;
}
