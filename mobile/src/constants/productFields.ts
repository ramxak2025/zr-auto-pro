/**
 * Slim list payload (audit #5): the warehouse list + its row component only
 * render these columns. Asking the backend's `?fields=` projection
 * (backend/src/common/field-filter.ts) for exactly this set drops the
 * heaviest part of the response — the `bundle_items` JSONB, plus the nested
 * supplier object and other unrendered columns. The full product shape
 * (with bundleItems) is still fetched separately by CheckCreate / the
 * picker via their own `['all-products-check']` query, so nothing
 * downstream loses data. Field names are the camelCase keys produced by
 * the backend's `mapProduct`, because `?fields=` filters the mapped
 * object, not raw DB columns.
 *
 * Shared between ProductsScreen and the AuthContext login prefetch so the
 * prefetched payload is byte-identical to what the screen itself requests —
 * a diverging `fields` set would make the warm cache slot useless.
 *
 * NOTE: this is a constant, intentionally NOT part of the query KEY — the
 * key shape ['products', { search, limit, warehouseId }] must stay
 * byte-for-byte identical between the screen and the prefetch.
 */
export const PRODUCT_LIST_FIELDS =
  'id,name,stock,minStock,sellPrice,costPrice,photo,category,unit,warehouseId,supplierId,warrantyDays,barcode';
