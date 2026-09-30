# Адресное хранение на складе (правка №1, 2026-09-30)

**Запрос владельца.** «Нужно реализовать удобное адресное хранение на складе — и на сайте,
и в приложении». У каждого товара появляется адрес хранения (ячейка), по адресу можно
искать, адрес виден в списке склада, в карточке товара и в подборе товара в Кассе, чтобы
мастер сразу знал, где лежит запчасть.

**Что есть в коде сейчас (разведка 2026-09-30).** Поля адреса нет ни в `products`, ни в
`warehouses`, ни в `stock_movements`. Товар лежит ровно на одном складе
(`products.warehouse_id`), остаток — одно число `products.stock`. Папки — строковый путь в
`products.category`. Слова «место» и `location` заняты: `tenant_locations` — это боксы во
дворе автосервиса (`checks.location_id`, миграция 146). Поэтому здесь везде термин
**«ячейка хранения»** (`storage_cell`), а не «место».

## 0. Модель

- **Ячейка принадлежит складу** (`storage_cells.warehouse_id`). У каждого филиала три склада
  (`main` / `defect` / `used`), ячейки заводятся на каждом складе отдельно. Филиал ячейки
  ограничивает склад — как у товаров (`warehousePointFilterSql`); свой `point_id` у ячейки
  **не нужен** (`common/point-scope.ts:165-169`, «не денормализуем филиал на товар»).
- **Один товар — одна ячейка** (`products.storage_cell_id`, nullable). Остаток по ячейкам
  не делится: строка `products` и так одна на склад. Если владелец захочет один товар в
  нескольких ячейках — это другая модель (остаток по ячейкам) и отдельная задача.
- **Код ячейки** — короткая строка, которую произносят и печатают: `A-01-03`, `Стеллаж 2 · Полка 4`,
  `Б3`. Формат свободный; при создании нормализуем: `trim`, схлопнуть пробелы, буквы в
  верхний регистр. Уникален в пределах склада без учёта регистра. Опционально `name` —
  подпись («у входа», «масла»).
- Массовое создание — сетка «стеллажи × полки × ячейки»: клиент генерирует коды
  (`shared/utils/storageCells.ts` → `generateCellCodes({ racks, shelves, cells, separator })`,
  пример: `racks: ['A','B'], shelves: 3, cells: 4, separator: '-'` → `A-1-1 … B-3-4`, номера
  без ведущих нулей, если `pad` не задан), сервер принимает список кодов.
  **Уточнено в фазе 0:** лимит — `MAX_BULK_CELLS = 2000` в `shared/utils/storageCells.ts`.
  `generateCellCodes` при сетке больше лимита **бросает `Error`** с русским текстом ДО генерации
  и ничего не усекает; экран заранее считает размер через `countCellCodes(params)` (не бросает),
  показывает «будет создано N» и блокирует «Создать», если N > 2000. Поле «Стеллажи» разбирает
  `expandRacks(text)` (`A-C` → A,B,C; `1-5` → 1..5; `A, B, C` как есть; всё или ничего: если
  токен не разобрать или стеллажей > `MAX_RACKS = 100` — `[]`, UI показывает подсказку формата).
- Ячейка — справочник, а не документ: удаляется физически, но **только пустой** или с
  переносом товаров (`moveTo`) / отвязкой (`detach=true`). `deleted_at` не нужен.
- Копии товара на другой склад (частичное перемещение, возврат брака, Б/У) создаются с
  `storage_cell_id = NULL` — ячейка чужого склада им не принадлежит. Полное перемещение
  (`UPDATE products SET warehouse_id = …`) обязано сбрасывать `storage_cell_id`.

## 1. Данные (backend) — миграция `172_storage_cells.sql` (идемпотентная)

```sql
CREATE TABLE IF NOT EXISTS storage_cells (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT,
  sort_order   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_cells_wh_code ON storage_cells (warehouse_id, lower(code));
CREATE INDEX IF NOT EXISTS idx_storage_cells_tenant_wh ON storage_cells (tenant_id, warehouse_id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS storage_cell_id UUID REFERENCES storage_cells(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_storage_cell ON products (storage_cell_id) WHERE storage_cell_id IS NOT NULL;
-- RLS по образцу 146_tenant_locations.sql:44-51: ENABLE + FORCE + политика tenant_isolation.
```

Никаких изменений уже применённых миграций. Хвост сейчас — `171_cars_vin.sql`.

## 2. Backend

Новый модуль `backend/src/storage-cells/` (`storage-cells.module.ts`, `.controller.ts`,
`.service.ts`, `dto/`), зарегистрировать в `app.module.ts`. Гарды как у `products`:
`JwtAuthGuard, RolesGuard, PermissionsGuard`; чтение — `warehouse_access`, изменение —
`warehouse_manage`. Склад проверять через `WarehousesService.assertInTenant` + филиал
через `assertWarehouseInPoint` (как папки в `warehouse.service.ts:81-88`).

| Маршрут                                                 | Тело / параметры                                                                                                   | Ответ                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET /storage-cells?warehouseId=`                       | обязательный склад                                                                                                 | `StorageCell[]` с `productsCount`, `ORDER BY sort_order, code`                |
| `POST /storage-cells`                                   | `{ warehouseId, code, name? }`                                                                                     | `StorageCell`; дубль кода → `409 { code: 'STORAGE_CELL_EXISTS' }`             |
| `POST /storage-cells/bulk`                              | `{ warehouseId, codes: string[] }` (≤ 2000)                                                                        | `{ created: number, skipped: string[] }` — существующие пропускаем, не ошибка |
| `PATCH /storage-cells/:id`                              | `{ code?, name?, sortOrder? }`                                                                                     | `StorageCell`                                                                 |
| `PATCH /storage-cells/order`                            | `{ orderedIds: string[] }`                                                                                         | как у папок                                                                   |
| `DELETE /storage-cells/:id?moveTo=<cellId>&detach=true` | если в ячейке есть товары и нет ни `moveTo`, ни `detach` → `409 { code: 'STORAGE_CELL_NOT_EMPTY', productsCount }` | `{ ok: true }`                                                                |

**Уточнено в фазе 0 (контракт зафиксирован в `shared/`, backend обязан ему соответствовать):**

- Маршрут `PATCH /storage-cells/order` объявить в контроллере **раньше** `PATCH /storage-cells/:id`,
  иначе `:id` перехватит `order`. Ответ — `{ message: 'OK' }`.
- `PATCH /storage-cells/:id`: `name: ''` или `null` снимает подпись, поле не передано — подпись не
  меняется. Смена `code` на существующий на складе → `409 STORAGE_CELL_EXISTS`.
- `POST /storage-cells/bulk`: сервер сам нормализует каждый код (`normalizeCellCode`), выбрасывает
  пустые и повторы внутри списка; `skipped` — нормализованные коды, которые на складе уже были;
  список длиннее 2000 → `400`.
- `DELETE`: `moveTo` — ячейка **того же склада** (иначе `400 STORAGE_CELL_WRONG_WAREHOUSE`); клиенты
  не шлют `moveTo` и `detach` вместе, оба сразу — `400`.
- Тело ошибок ячеек описано типом `StorageCellError` (`shared/types/index.ts`): клиенты сверяют
  `code`, а не текст `message`.
- `POST /products/bulk-assign-cell` отвечает `{ updated: number }` (сколько товаров реально сменили адрес).

`products` (`backend/src/products/`):

- `mapProduct` (`products.service.ts:55-79`) → новые поля `storageCellId`, `storageCellCode`,
  `storageCellName` (все `null`, если ячейки нет). Во все запросы, которые кормят `mapProduct`
  (`getAll`, `getById`, `getLowStock`, `getTrash`, `getWarehouseStats` если отдаёт товары),
  добавить `LEFT JOIN storage_cells sc ON sc.id = p.storage_cell_id` и `sc.code AS storage_cell_code,
sc.name AS storage_cell_name`. Проекция `fields` (`common/field-filter.ts`) работает по
  именам — ничего дополнительно не нужно.
- `GET /products`: `search` дополнительно матчит `sc.code ILIKE $n`; новый параметр
  `storageCellId=<uuid>` (фильтр «содержимое ячейки»); `storageCellId=none` — товары без адреса.
- `CreateProductDto` / `UpdateProductDto`: `storageCellId?: string | null` (`@IsOptional()
@IsUUID()`; `null` — снять адрес). Сервис проверяет, что ячейка принадлежит тенанту и
  **тому же складу**, что и товар (после применения `warehouseId` из того же запроса), иначе
  `400 { code: 'STORAGE_CELL_WRONG_WAREHOUSE' }`. Если в `update` меняется `warehouseId`, а
  `storageCellId` не пришёл — сбросить в `NULL`.
- `POST /products/bulk-assign-cell { productIds: string[] (≤ 2000), storageCellId: string | null }`
  (`warehouse_manage`): все товары обязаны быть на складе ячейки; чужие → 400 со списком id.
- Полное перемещение и `point_transfer` в `stock-movements.service.ts` (L643-648 и блок
  `point_transfer`): в `UPDATE products SET warehouse_id = …` добавить `storage_cell_id = NULL`.
  Копии через `INSERT … SELECT` (`stock-movements.service.ts:674-678`, `returns.service.ts:433-437`,
  `suppliers.service.ts:322-327`) колонку **не** перечисляют — остаётся `NULL`, менять не нужно.
- `exportCsv` — новая последняя колонка `Ячейка`; `importCsv` — поле `storageCell?: string`
  в элементах: ячейка ищется по коду на складе импорта, если нет — создаётся. Веб-разбор
  заголовка (`ProductsPage.tsx:757-790`) — регулярка `/ячейк|адрес|cell|bin/i`.
  **Уточнено в фазе 0:** тело `import-csv` склада не содержит — товары импорта всегда попадают на
  ОСНОВНОЙ склад филиала сессии (`resolveWarehouseId(tenantID, null, {}, pointId)`), ячейка ищется
  и создаётся именно на нём. Пустая или отсутствующая `storageCell` адрес не меняет.
- Корзина: восстановление товара адрес не трогает.

## 3. Shared

`shared/types/index.ts`:

```ts
export interface StorageCell {
  id: string;
  warehouseId: string;
  code: string;
  name: string | null;
  sortOrder: number;
  productsCount: number;
}
// Product: + storageCellId?: string | null; storageCellCode?: string | null; storageCellName?: string | null;
```

`shared/api/types.ts`: `CreateProductRequest.storageCellId?`, `UpdateProductRequest.storageCellId?: string | null`,
`ProductsQuery extends PaginationParams` (`warehouseId?`, `storageCellId?: string` — uuid ячейки или
`'none'`) — **уточнено в фазе 0:** общий `PaginationParams` не трогаем, `productsApi.getAll(params?: ProductsQuery)`.
`shared/api/createServices.ts`: `createStorageCellsApi` (`list(warehouseId)`, `create`,
`bulkCreate`, `update`, `updateOrder`, `remove(id, { moveTo?, detach? })`);
`createProductsApi.bulkAssignCell({ productIds, storageCellId })`; `importCsv` — `storageCell?`.
`shared/utils/storageCells.ts`: `normalizeCellCode`, `generateCellCodes` (+ тест
`mobile/src/utils/__tests__/storageCells.test.ts`, как `vin.test.ts`). **Уточнено в фазе 0** —
в файле ещё `MAX_BULK_CELLS`, `MAX_RACKS`, `countCellCodes`, `expandRacks`, `CellGridParams`
(`racks?`, `shelves?`, `cells?`, `separator?`, `pad?`), а также типы `StorageCell`, `StorageCellError`,
`BulkAssignCellRequest/Response`, `CreateStorageCellRequest`, `BulkCreateStorageCells*`,
`UpdateStorageCellRequest`, `RemoveStorageCellParams` — экспорты и сигнатуры см. в самих файлах.
Подключить фабрику в `frontend/src/api/services.ts` и `mobile/src/api/services.ts`.

## 4. Web (`web-engineer`)

1. **Склад → «Ячейки хранения»** (кнопка в меню «Ещё» `ProductsPage.tsx:980-988` и ссылка
   в тулбаре при `warehouse_manage`): `Drawer` со списком ячеек текущего склада
   (`код · подпись · N товаров`), поиск по коду, «Добавить ячейку», «Создать сетку»
   (стеллажи `A–C` или `1–5`, полок, ячеек, разделитель — предпросмотр первых кодов и итог
   «будет создано 60»), переименовать, удалить (если не пустая — диалог «Перенести товары в
   … / Оставить без адреса»). Клик по ячейке → список товаров фильтруется по ней
   (`?cell=<id>` в URL рядом с `wh/path/q`), крошка «Ячейка A-01-03 ×».
2. **Форма товара** (`ProductFormModal.tsx`, после блока «Остаток | Мин. остаток»): поле
   «Ячейка хранения» — `Select`/комбобокс по ячейкам склада товара с поиском по коду и
   пунктом «+ Создать ячейку «…»» (создаёт и подставляет). Пусто — «Без адреса».
3. **Таблица** (`ProductTable.tsx`): под названием справа от папки — моноширинный бейдж кода
   (`A-01-03`); колонка сортировки не нужна. Поиск на вкладке склада — на клиенте
   (`ProductsPage.tsx:488-492`): добавить `storageCellCode` в поля поиска. Карточка товара
   (`ProductDetailModal.tsx`): бейдж «Ячейка A-01-03» рядом со штрихкодом, действие
   «Изменить адрес».
4. **Выделение** (режим «Выбрать» `ProductsPage.tsx:1095-1124`): действие «Назначить ячейку»
   → `bulkAssignCell`.
5. **Подбор товара в Кассе** (`components/checks/ProductPickerDrawer.tsx:117-164`): код ячейки
   моноширинным рядом с остатком; поиск (`L94-100`) — и по коду. То же в
   `components/warehouse/ProductPickerDrawer.tsx` (поставки/заказы) и в инвентаризации
   `GlobalStockForms.tsx` (строка «В системе: N · A-01-03»).
6. Импорт/экспорт: колонка «Ячейка» в `ImportPreviewModal` и в разборе файла.
7. Без ячеек (у тенанта их нет) ни один экран визуально не меняется.

## 5. Mobile (`ios-engineer`, парити `android-engineer`)

1. `constants/productFields.ts:21-22` — `PRODUCT_LIST_FIELDS` + `storageCellId,storageCellCode`.
   `utils/persistentCache.helpers.ts` `PERSISTED_KEYS` + `'storage-cells'`.
2. **Строка склада** (`ProductsScreen.tsx` `ProductRow` L257-393, высота 76 pt не меняется):
   в метастроке после цены — компактный моноширинный чип кода (`A-01-03`, `iosCaption`,
   фон `fillTertiary`); при поиске путь папки остаётся; «с/с» для manage — как сейчас, чип
   стоит перед ним и обрезается первым (`flexShrink`). Без адреса — рендер байт-в-байт прежний.
3. **Форма товара** (`ProductsScreen.tsx` модалка L2541+, после «Остаток | Мин.») и **режим
   правки карточки** (`ProductDetailScreen.tsx` L624-790): строка «Ячейка хранения» → пикер
   (`components/StorageCellPickerModal.tsx`: список ячеек склада товара, поиск по коду,
   «+ Создать ячейку», «Без адреса»). В просмотре карточки — `InfoRow` «Ячейка» в блоке
   «Информация» (L936-959), тап → пикер (при `warehouse_manage`).
4. **Управление ячейками**: «Склад → меню в шапке → Ячейки хранения» → экран
   `StorageCellsScreen.tsx` (список с количеством товаров, поиск, добавить, создать сетку —
   та же форма, что на вебе, переименовать по лонг-тапу/свайпу, удалить с диалогом
   перенести/оставить). Тап по ячейке → `ProductsScreen` с фильтром по ячейке (чип-фильтр
   над списком, как усечение «N из M» L1002).
5. **Подбор в Кассе** (`ProductPickerScreen.tsx` `PickerProductRow` L135-246): код ячейки
   рядом с остатком; клиентский поиск (L377-394) — и по `storageCellCode`.
   Инвентаризация (`InventoryScreen.tsx`) — код в строке.
6. Серверный поиск склада (`['products', {search…}]`) начинает находить по коду автоматически.
7. Документ: `docs/ios-redesign/STORAGE_CELLS_2026-09-30.md` (проблема, архитектура,
   fallback без ячеек, чек-лист приёмки на iPhone).

**Уточнено при реализации (mobile):**

- Токенов `iosCaption` и `fillTertiary` в теме мобилки нет: чип кода — `palette.bg.muted`,
  моноширинный шрифт 11/14 (`CELL_CODE_FONT`, тот же, что у VIN). Чип вынесен в общий компонент
  `components/StorageCellChip.tsx` (Склад, подбор в Кассе, инвентаризация): `flexShrink` и потолок
  ширины — он сжимается первым и не сдвигает цену и остаток; без адреса не рендерится вовсе.
- Фильтр «по ячейке» на Складе — клиентский, по уже загруженному списку: `StorageCellsScreen`
  пушит `ProductsHome` с параметрами `storageCellId` / `storageCellCode` / `warehouseId`.
  Серверный параметр `storageCellId` мобилка не использует: ключ `['products', …]` не меняется,
  персистентный кэш и prefetch не затронуты. Если товаров больше лимита списка, над списком
  честная плашка об усечении. В отфильтрованном списке чип кода скрыт как лишний.
- Вход на `StorageCellsScreen` — пункт «Ячейки хранения» в меню ⇄ в шапке Склада (только при
  `warehouse_manage`). Сам экран зарегистрирован в `ProductsStack`, открывается по
  `warehouse_access`; создание, переименование и удаление — по `warehouse_manage`.
  Переименовать и удалить — долгим нажатием на строку или кнопкой «⋯» (свайпа нет).
- `StorageCellPickerModal` закрывается сам после выбора (`haptic('select')`). В форме товара на
  Складе он вложен внутрь модалки формы: соседний RN-Modal поверх открытого на iOS Fabric не
  показывается. Между закрытием одной модалки и открытием другой — пауза 300 мс, как на Складе.
- Удаление ячейки: число товаров известно по `productsCount` → сразу диалог «Перенести N товаров /
  Открепить / Отмена». Если счётчик устарел, сервер вернёт 409 `STORAGE_CELL_NOT_EMPTY` с
  `productsCount`, и вопрос задаётся повторно. Пустая ячейка — обычное подтверждение.
- Форма «Создать сетку»: разделитель — чипы «-», «.», «/» и «Слитно», «Ведущие нули» —
  переключатель. Предпросмотр считают `countCellCodes` / `generateCellCodes` из
  `shared/utils/storageCells`; больше 2000 ячеек — создание заблокировано.
- Карточка товара: `PATCH /products/:id` может вернуть товар без склейки с ячейкой (нет кода) —
  экран дополняет ответ выбранной ячейкой и инвалидирует `['product', id]` и `['storage-cells']`.
  В просмотре смена ячейки применяется сразу (`{ storageCellId }`), в режиме правки — вместе с
  формой и только если изменена.
- В мобильной форме товара нет выбора склада: ячейка всегда в пределах склада товара (при создании —
  активного). Логика «смена склада сбрасывает ячейку» нужна только серверу.
- Клиентский поиск по коду (подбор в Кассе, инвентаризация) идёт тем же правилом, каким сервер
  хранит код (`normalizeCellCode`: регистр и пробелы), без склейки латиницы и кириллицы.
  Потолки при вводе: код до 32 символов, подпись до 60.
- `components/ProductPickerModal` (подбор в поставках, заказах и мотивации) в §5 не входил — код
  ячейки там не показан.

## 6. Проверки

- backend: `npm test` (включая новый `backend/test/storage-cells.test.cjs`: (а) миграция 172
  содержит `ENABLE ROW LEVEL SECURITY` / `FORCE` / `tenant_isolation`; (б) статическая
  проверка — каждый `SET warehouse_id` в `products.service.ts` и `stock-movements.service.ts`
  сопровождается `storage_cell_id = NULL`; (в) `ProductsService.update` на фейковом пуле
  (образец `products-cost-price-update.test.cjs`) отклоняет ячейку чужого склада) +
  `typecheck` + `lint` + `build`; миграция прогнана на локальном `autexa-pg`.
- shared → typecheck во всех трёх потребителях; frontend `typecheck + lint + build`;
  mobile `typecheck + lint + npx jest` (включая `storageCells.test.ts`).
- Ручная приёмка: создать сетку `A × 2 полки × 3 ячейки` → 6 ячеек; назначить товару
  `A-1-2` в форме; найти товар поиском «A-1»; в Кассе в подборе виден код; удалить ячейку с
  товаром → предложение перенести; переместить товар на склад Б/У → адрес снят.
