import type { PaginatedResponse, Product } from '../types';
import type { ProductsQuery } from './types';

/** Fetch every page: a large requested limit is still capped by the API. */
export async function loadProductCatalog(
  getPage: (params: ProductsQuery) => Promise<{ data: PaginatedResponse<Product> | Product[] }>,
  params: Omit<ProductsQuery, 'page' | 'limit'> = {},
): Promise<Product[]> {
  const products = new Map<string, Product>();
  let page = 1;
  for (;;) {
    const { data } = await getPage({ ...params, page, limit: 1000 });
    if (Array.isArray(data)) return data;
    if (!data || !Array.isArray(data.data)) throw new Error('Не удалось загрузить каталог товаров');
    const before = products.size;
    for (const product of data.data) products.set(product.id, product);
    const limit = Number(data.limit) || 1000;
    const total = Number(data.total);
    if (!Number.isFinite(total) || total < 0 || limit <= 0) {
      throw new Error('Не удалось загрузить каталог товаров');
    }
    if (page * limit >= total && products.size >= total) return [...products.values()];
    // Do not silently call an incomplete catalogue complete if pagination stops advancing.
    if (data.data.length === 0 || products.size === before || page * limit >= total) {
      throw new Error('Каталог товаров загружен не полностью. Повторите загрузку');
    }
    page += 1;
  }
}
