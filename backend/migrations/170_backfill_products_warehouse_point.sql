-- 170_backfill_products_warehouse_point.sql
-- ============================================================================
-- ДОБИВКА СКЛАДА У ТОВАРОВ-СИРОТ ПОСЛЕ 169.
--
-- ЖАЛОБА ВЛАДЕЛЬЦА (2026-09-18): «товар на складе иногда не показывается,
-- хотя он там есть».
--
-- ПРОБЛЕМА. Строка products с warehouse_id IS NULL после 169 невидима ВЕЗДЕ:
-- список, «мало на складе», сводка остатков, КОРЗИНА и экспорт CSV фильтруют
--   AND EXISTS (SELECT 1 FROM warehouses wpt
--                WHERE wpt.id = p.warehouse_id AND wpt.point_id = $n)
-- а при warehouse_id IS NULL сравнение `wpt.id = NULL` даёт UNKNOWN, то есть
-- EXISTS ложь. До 169 корзина и экспорт фильтра по складу не имели вовсе —
-- там такие строки были ВИДНЫ, так что это регрессия 169.
--
-- Починить такую строку через API тоже нельзя: правка, восстановление,
-- удаление, изменение остатка и перемещение проходят через гейт филиала с тем
-- же EXISTS и отвечают «Товар не найден». Единственная дверь внутрь — карточка
-- товара, у которой фильтра по филиалу нет: карточка открывается, а в списке
-- товара нет. Ровно то, что видит владелец.
--
-- ПОЧЕМУ 130 НЕ ЗАКРЫЛА ВОПРОС. Миграция 130 чинила только строки с
-- deleted_at IS NULL, а MigrationRunner отмечает файл в _migrations ПО ИМЕНИ и
-- повторно не выполняет. Строки, лежавшие в корзине на момент 130 (и тенанты,
-- у которых тогда не было склада kind='main'), остались сиротами навсегда.
--
-- РЕШЕНИЕ. Сирота прибивается к ОСНОВНОМУ складу ОСНОВНОГО СЕРВИСА тенанта —
-- правило 160/169 «история старше филиалов принадлежит основному сервису».
-- Подзапрос дословно повторяет mainWarehouseOfPointSql(pointId = null) из
-- backend/src/common/point-scope.ts, чтобы SQL миграции и код смотрели на одну
-- и ту же строку. Источник появления новых сирот закрыт в коде
-- (ProductsService.resolveWarehouseId самолечит набор складов филиала).
--
-- ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ: ALTER COLUMN warehouse_id SET NOT NULL. Колонка
-- объявлена REFERENCES warehouses(id) ON DELETE SET NULL (029) — NOT NULL с
-- таким FK противоречив: удаление склада стало бы жёсткой ошибкой. Источник
-- закрыт кодом, а не схемой.
--
-- ИДЕМПОТЕНТНО: только UPDATE по IS NULL и INSERT по NOT EXISTS. Повторный
-- прогон — no-op. У тенантов без филиалов не меняется ничего.
-- ============================================================================

-- ── 1. Склад без филиала у тенанта, у которого филиалы ЕСТЬ ─────────────────
-- Повтор ATTRIBUTION-BLOCK-169 на случай склада, созданного между 169 и 170
-- (или тенанта, чей основной сервис появился позже). Без этого его товар
-- невидим в любой сессии: филиал у сессии всегда непустой (инвариант 163), а
-- point_id склада — NULL.
UPDATE warehouses w
   SET point_id = mp.main_id
  FROM (SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active) mp
 WHERE w.point_id IS NULL
   AND w.tenant_id = mp.tenant_id;

-- ── 2. Недостающие наборы складов живым филиалам ────────────────────────────
-- Повтор SEED-BLOCK-169: гарантирует, что у каждого живого филиала есть склад
-- kind='main', иначе резолв склада снова вернул бы пусто и сироты начали бы
-- рождаться заново.
INSERT INTO warehouses (tenant_id, point_id, name, kind, sort_order)
SELECT tp.tenant_id, tp.id, d.name, d.kind, d.sort_order
  FROM tenant_points tp
  CROSS JOIN (VALUES ('Основной склад', 'main', 0),
                     ('Склад брака',    'defect', 1),
                     ('Склад Б/У',      'used', 2)) AS d(name, kind, sort_order)
 WHERE tp.is_active
   AND NOT EXISTS (SELECT 1 FROM warehouses w
                    WHERE w.tenant_id = tp.tenant_id
                      AND w.point_id  = tp.id
                      AND w.kind      = d.kind)
ON CONFLICT (tenant_id, point_id, kind) DO NOTHING;

-- ── 3. Товары-сироты → основной склад ОСНОВНОГО сервиса ─────────────────────
-- ОТЛИЧИЕ ОТ 130: без `deleted_at IS NULL`. Строки в КОРЗИНЕ чиним тоже —
-- именно они и остались после 130, и именно они сейчас невидимы в корзине.
UPDATE products p
   SET warehouse_id = (
         SELECT w.id
           FROM warehouses w
           LEFT JOIN tenant_points tp ON tp.id = w.point_id
          WHERE w.tenant_id = p.tenant_id
            AND w.kind = 'main'
            AND (w.point_id IS NULL OR tp.is_main)
          ORDER BY (w.point_id IS NULL) DESC
          LIMIT 1
       )
 WHERE p.warehouse_id IS NULL
   -- Не трогаем тенанта, у которого основного склада всё ещё нет: подзапрос
   -- вернул бы NULL, и «UPDATE NULL → NULL» только шумел бы в WAL.
   AND EXISTS (SELECT 1 FROM warehouses w2
                WHERE w2.tenant_id = p.tenant_id AND w2.kind = 'main');

-- ── 4. Контроль (выполнить руками после прогона; оба ответа должны быть 0) ──
-- SELECT count(*) AS still_orphan FROM products WHERE warehouse_id IS NULL;
-- SELECT count(*) AS warehouses_without_point
--   FROM warehouses w
--  WHERE w.point_id IS NULL
--    AND EXISTS (SELECT 1 FROM tenant_points tp
--                 WHERE tp.tenant_id = w.tenant_id AND tp.is_active);
