-- 169_warehouses_per_point.sql
-- ============================================================================
-- СКЛАД — У КАЖДОГО ФИЛИАЛА СВОЙ.
--
-- ТРЕБОВАНИЕ ВЛАДЕЛЬЦА (2026-09-14, дословно): «у каждой [точки] свой товар и
-- остатки… каждый филиал это грубо говоря отдельный автосервис просто под
-- одним владельцем и одной подпиской».
--
-- ЧТО БЫЛО. Склад жил на уровне ТЕНАНТА: ровно три склада (основной / брак /
-- Б/У, UNIQUE (tenant_id, kind)), товары, папки, движения, поставки, заказы
-- поставщикам и аналитика — общие на всю сеть. Филиал видел товар и остатки
-- основного сервиса, пробивал их в чеке и списывал с общего остатка.
--
-- РЕШЕНИЕ. Склад принадлежит ФИЛИАЛУ (warehouses.point_id): у каждого живого
-- филиала СВОЙ набор из трёх складов, а всё, что привязано к складу
-- (products.warehouse_id, warehouse_categories, stock_movements,
-- stock_value_snapshots), становится филиальным автоматически. Поставки,
-- заказы поставщикам и оплаты поставщикам получают свой point_id — это
-- документы конкретного автосервиса. Справочник поставщиков и баланс долга
-- перед поставщиком остаются на сеть: контрагент один, договор с владельцем.
--
-- ПРИВЯЗКА ИСТОРИИ. Все существующие склады тенанта с филиалами уходят
-- ОСНОВНОМУ сервису (правило 160: история старше филиалов принадлежит ему) —
-- вместе с товаром и остатками. Для каждого живого филиала, у которого своих
-- складов ещё нет, заводится пустой набор из трёх. Перенос товара из основного
-- в филиал делает владелец штатным перемещением между складами
-- (stock_movements.transfer с целевым складом другого филиала — разрешено
-- держателю user_management).
--
-- УНИКАЛЬНОСТЬ. (tenant_id, kind) → (tenant_id, point_id, kind) NULLS NOT
-- DISTINCT: у тенанта без филиалов point_id = NULL, и три склада по-прежнему
-- ровно три (NULLS NOT DISTINCT считает NULL равным NULL — PostgreSQL 15+).
-- Все `ON CONFLICT (tenant_id, kind)` в коде переведены на новый ключ.
--
-- ИДЕМПОТЕНТНО: ADD COLUMN / CREATE INDEX IF NOT EXISTS, DROP CONSTRAINT IF
-- EXISTS, UPDATE только по point_id IS NULL, INSERT только недостающих
-- складов (NOT EXISTS). У тенантов без филиалов не меняется ничего, кроме
-- формы уникального ключа.
-- ============================================================================

-- ── 1. Склады ───────────────────────────────────────────────────────────────
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
COMMENT ON COLUMN warehouses.point_id IS
  'Филиал, которому принадлежит склад (169). NULL только у тенантов без филиалов.';

-- >>> ATTRIBUTION-BLOCK-169
UPDATE warehouses w
   SET point_id = mp.main_id
  FROM (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE w.point_id IS NULL
   AND w.tenant_id = mp.tenant_id;
-- <<< ATTRIBUTION-BLOCK-169

-- Ключ уникальности: один склад каждого вида на филиал (NULL = «без филиалов»).
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_tenant_id_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_tenant_point_kind
  ON warehouses (tenant_id, point_id, kind) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_point
  ON warehouses (tenant_id, point_id);

-- Пустой набор складов каждому живому филиалу, у которого их ещё нет.
-- >>> SEED-BLOCK-169
INSERT INTO warehouses (tenant_id, point_id, name, kind, sort_order)
SELECT tp.tenant_id, tp.id, d.name, d.kind, d.sort_order
  FROM tenant_points tp
  CROSS JOIN (VALUES ('Основной склад', 'main', 0),
                     ('Склад брака',    'defect', 1),
                     ('Склад Б/У',      'used', 2)) AS d(name, kind, sort_order)
 WHERE tp.is_active
   AND NOT EXISTS (SELECT 1 FROM warehouses w
                    WHERE w.tenant_id = tp.tenant_id AND w.point_id = tp.id AND w.kind = d.kind)
ON CONFLICT (tenant_id, point_id, kind) DO NOTHING;
-- <<< SEED-BLOCK-169

-- ── 2. Поставки, заказы поставщикам, оплаты поставщикам ─────────────────────
ALTER TABLE deliveries        ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders   ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
COMMENT ON COLUMN deliveries.point_id IS 'Филиал, принявший поставку (169). Штамп филиала сессии.';
COMMENT ON COLUMN purchase_orders.point_id IS 'Филиал, заказавший товар (169). Штамп филиала сессии.';
COMMENT ON COLUMN supplier_payments.point_id IS 'Филиал, оплативший поставщику (169). Штамп филиала сессии.';

-- Свидетели: филиал склада, куда лёг товар поставки/заказа; у оплаты — филиал
-- её поставки; иначе — основной сервис.
-- >>> ATTRIBUTION-BLOCK-169-SUPPLY
UPDATE deliveries d
   SET point_id = COALESCE(
         (SELECT w.point_id FROM delivery_items di
            JOIN products p ON p.id = di.product_id
            JOIN warehouses w ON w.id = p.warehouse_id AND w.point_id IS NOT NULL
           WHERE di.delivery_id = d.id
           ORDER BY di.id LIMIT 1),
         mp.main_id)
  FROM (SELECT tp.tenant_id, tp.id AS main_id FROM tenant_points tp WHERE tp.is_main AND tp.is_active) mp
 WHERE d.point_id IS NULL AND d.tenant_id = mp.tenant_id;

UPDATE purchase_orders po
   SET point_id = COALESCE(
         (SELECT w.point_id FROM purchase_order_items poi
            JOIN products p ON p.id = poi.product_id
            JOIN warehouses w ON w.id = p.warehouse_id AND w.point_id IS NOT NULL
           WHERE poi.purchase_order_id = po.id
           ORDER BY poi.created_at LIMIT 1),
         mp.main_id)
  FROM (SELECT tp.tenant_id, tp.id AS main_id FROM tenant_points tp WHERE tp.is_main AND tp.is_active) mp
 WHERE po.point_id IS NULL AND po.tenant_id = mp.tenant_id;

UPDATE supplier_payments sp
   SET point_id = COALESCE(
         (SELECT d.point_id FROM deliveries d
           WHERE d.id = sp.delivery_id AND d.tenant_id = sp.tenant_id AND d.point_id IS NOT NULL),
         mp.main_id)
  FROM (SELECT tp.tenant_id, tp.id AS main_id FROM tenant_points tp WHERE tp.is_main AND tp.is_active) mp
 WHERE sp.point_id IS NULL AND sp.tenant_id = mp.tenant_id;
-- <<< ATTRIBUTION-BLOCK-169-SUPPLY

CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_point_date        ON deliveries (tenant_id, point_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_point        ON purchase_orders (tenant_id, point_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_point_date ON supplier_payments (tenant_id, point_id, date DESC);

-- ── 3. Перемещение товара В ДРУГОЙ ФИЛИАЛ — новый тип движения ──────────────
-- После разделения складов по филиалам история владельца лежит в основном
-- сервисе, а филиал стартует с пустым складом. Перенос делает владелец штатным
-- перемещением между складами (StockMovementsService.applyTransfer с целевым
-- складом другого филиала; право — user_management). Тип 'point_transfer'
-- отличает его в ленте движений от переноса в брак / Б/У.
-- Паттерн — 074: снять текущий CHECK по типу (имя зависит от версии) и завести
-- именованный с расширенным списком. Идемпотентно (duplicate_object → NULL).
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'stock_movements'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%type%'
     AND pg_get_constraintdef(oid) NOT ILIKE '%point_transfer%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE stock_movements DROP CONSTRAINT %I', cname);
  END IF;
END$$;

DO $$ BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_type_chk
    CHECK (type IN (
      'inventory',
      'writeoff',
      'income',
      'expense',
      'defect_transfer',
      'used_transfer',
      'defect_return_to_supplier',
      'customer_return',
      'point_transfer'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
