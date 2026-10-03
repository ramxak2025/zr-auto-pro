import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import { buildProductFolderLevel, productFolderPath } from '../../../../shared/utils/productFolders';
import type { Product } from '../../../../shared/types';

const product = (id: number, category = ''): Product =>
  ({ id: String(id), name: `Товар ${id}`, category, stock: 0, minStock: 1 }) as Product;

describe('complete product catalog shared by purchase orders and checkout', () => {
  test('a 2813-product catalog includes the 111 cylinders beyond the first page and exposes nested folders', async () => {
    const catalog = Array.from({ length: 2813 }, (_, i) => product(i, i >= 2702 ? 'БАЛЛОНЫ / Тороидальные' : 'Другое'));
    const getPage = jest.fn(async ({ page = 1, limit = 1000 }) => ({
      data: { data: catalog.slice((page - 1) * limit, page * limit), total: catalog.length, page, limit },
    }));
    const loaded = await loadProductCatalog(getPage, { warehouseId: 'warehouse-a' });
    expect(loaded).toHaveLength(2813);
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(getPage).toHaveBeenLastCalledWith({ warehouseId: 'warehouse-a', page: 3, limit: 1000 });
    expect(buildProductFolderLevel(loaded, []).subfolders).toContainEqual({
      name: 'БАЛЛОНЫ',
      count: 111,
      hasLow: true,
      sortOrder: 0,
    });
    expect(buildProductFolderLevel(loaded, ['БАЛЛОНЫ']).subfolders[0].name).toBe('Тороидальные');
    expect(buildProductFolderLevel(loaded, ['БАЛЛОНЫ', 'Тороидальные']).currentProducts).toHaveLength(111);
  });

  test('uses the server page size when the API caps the requested limit', async () => {
    const catalog = Array.from({ length: 7 }, (_, i) => product(i));
    const getPage = jest.fn(async ({ page = 1 }) => ({
      data: { data: catalog.slice((page - 1) * 3, page * 3), total: 7, page, limit: 3 },
    }));
    expect(await loadProductCatalog(getPage)).toEqual(catalog);
    expect(getPage).toHaveBeenCalledTimes(3);
  });

  test('empty and legacy array catalogs remain supported', async () => {
    expect(await loadProductCatalog(async () => ({ data: { data: [], total: 0, page: 1, limit: 1000 } }))).toEqual([]);
    expect(await loadProductCatalog(async () => ({ data: [product(1)] }))).toEqual([product(1)]);
  });

  test('does not present a repeated or truncated final page as a complete catalog', async () => {
    const getPage = jest.fn(async () => ({ data: { data: [product(1)], total: 2, page: 1, limit: 1 } }));
    await expect(loadProductCatalog(getPage)).rejects.toThrow('не полностью');
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  test('page failures propagate instead of caching a partial catalog', async () => {
    const getPage = jest
      .fn()
      .mockResolvedValueOnce({ data: { data: [product(1)], total: 2, page: 1, limit: 1 } })
      .mockRejectedValueOnce(new Error('offline'));
    await expect(loadProductCatalog(getPage)).rejects.toThrow('offline');
  });
});

describe('imported product folder paths', () => {
  test('whitespace variants lead to the same folder without changing stored categories', () => {
    const products = [
      product(1, ' БАЛЛОНЫ / Тороидальные '),
      product(2, 'БАЛЛОНЫ/Тороидальные'),
      product(3, 'БАЛЛОНЫ / Цилиндрические'),
    ];
    expect(buildProductFolderLevel(products, []).subfolders).toHaveLength(1);
    expect(buildProductFolderLevel(products, ['БАЛЛОНЫ', 'Тороидальные']).currentProducts.map((p) => p.id)).toEqual([
      '1',
      '2',
    ]);
    expect(products[0].category).toBe(' БАЛЛОНЫ / Тороидальные ');
    const selectedChip = 'БАЛЛОНЫ';
    expect(products.filter((p) => productFolderPath(p.category).startsWith(`${selectedChip}/`))).toHaveLength(3);
  });

  test('retains empty folders, order and uncategorized products without confusing a prefix with another folder', () => {
    const level = buildProductFolderLevel(
      [product(1, 'Баллоны2/Другие'), product(2), product(3, 'Баллоны / Тороидальные')],
      [],
      [{ path: 'Пустая ', sort_order: -1 }],
    );
    expect(level.subfolders[0]).toEqual({ name: 'Пустая', count: 0, hasLow: false, sortOrder: -1 });
    expect(level.currentProducts.map((p) => p.id)).toEqual(['2']);
    expect(buildProductFolderLevel([product(1, 'Баллоны2/Другие')], ['Баллоны']).subfolders).toEqual([]);
  });
});
