import type { Product } from '../types';
export interface ProductBarcodeParams {
  barcode: string;
  warehouseId?: string;
  page?: number;
  limit?: number;
}
export interface ProductBarcodeResult {
  status: 'found' | 'ambiguous' | 'not_found';
  matches: Product[];
  total: number;
  page: number;
  limit: number;
}
/** Exact lookup stays server scoped. Ambiguity is never reduced to the first match or a partial page. */
export async function loadProductBarcodeMatches(
  lookup: (params: ProductBarcodeParams) => Promise<{ data: ProductBarcodeResult }>,
  params: Pick<ProductBarcodeParams, 'barcode' | 'warehouseId'>,
): Promise<ProductBarcodeResult> {
  if (!params.barcode.trim()) throw new Error('Отсканируйте или введите штрихкод.');
  const matches = new Map<string, Product>();
  let page = 1;
  let total: number | undefined;
  let ambiguous = false;
  for (;;) {
    const { data } = await lookup({ ...params, page, limit: 100 });
    if (!data || !Array.isArray(data.matches) || !Number.isInteger(data.total) || data.total < 0)
      throw new Error('Не удалось проверить штрихкод. Повторите поиск.');
    if (total !== undefined && total !== data.total) throw new Error('Список совпадений изменился. Повторите поиск.');
    total = data.total;
    ambiguous ||= data.status === 'ambiguous';
    const before = matches.size;
    for (const product of data.matches) matches.set(product.id, product);
    if (matches.size >= total)
      return {
        ...data,
        status: total === 0 ? 'not_found' : ambiguous || total > 1 ? 'ambiguous' : 'found',
        matches: [...matches.values()],
        total,
      };
    if (before === matches.size) throw new Error('Не удалось загрузить все совпадения. Повторите поиск.');
    page++;
  }
}
