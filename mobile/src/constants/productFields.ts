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

/**
 * ПОЛНЫЙ КАТАЛОГ СКЛАДА ОДНОЙ СТРАНИЦЕЙ.
 *
 * ПОЧЕМУ НЕ 500. Экран «Склад», инвентаризация и пикер папок строят дерево
 * папок, счётчики, стоимость остатков и сессию пересчёта ИЗ ВЫДАЧИ. Сервер
 * сортирует по названию, поэтому лимит 500 молча срезал алфавитный ХВОСТ:
 * товар за 500-й позицией не попадал ни в список, ни в свою папку, ни в
 * счётчик, ни в стоимость склада, ни в поиск по штрих-коду — при этом
 * находился обычным поиском (он серверный, по всей таблице) и был виден в
 * пикере Кассы. Ровно это владелец описал словами «товар на складе иногда не
 * показывается, хотя он там есть». Пагинации у экрана нет и она бы не помогла:
 * дерево папок и суммы считаются по всему массиву и врали бы, пока человек не
 * домотает до конца.
 *
 * ЗНАЧЕНИЕ = потолок сервера (backend/src/common/cap-limit.ts: capLimit(...,
 * 100, 10000)). Просить больше бессмысленно — сервер всё равно срежет, а
 * честная цифра не вводит в заблуждение. Каталоги крупнее ловит плашка
 * усечения на экране.
 *
 * КРИТИЧНО: значение входит в ключ кеша ['products', { search, limit,
 * warehouseId }] и обязано быть одинаковым в ProductsScreen, InventoryScreen,
 * FolderPickerModal и прогреве AuthContext — иначе прогретый при входе слот
 * осиротеет и первое открытие «Склада» станет холодным.
 */
export const PRODUCT_LIST_LIMIT = 10000;
