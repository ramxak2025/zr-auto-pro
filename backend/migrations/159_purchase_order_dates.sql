-- 159_purchase_order_dates.sql
-- ============================================================================
-- Поставка задним числом: выбор даты при приёмке заказа + смена даты уже
-- ПРОВЕДЁННОЙ поставки.
--
-- Требование владельца (2026-09): «при приёмке поставки хочу выбрать дату, в
-- том числе прошедшую» + «у проведённой поставки дату надо уметь изменить
-- задним числом».
--
-- Дата поставки — это не одна колонка. Приёмка заказа (purchase-orders.receive)
-- пишет ЧЕТЫРЕ датированные записи:
--   1. purchase_orders.received_at        — момент проведения заказа;
--   2. deliveries.date                    — накладная (поставка) поставщика;
--   3. supplier_payments.date             — авто-платёж «Оплатить сразу»;
--   4. stock_movements.created_at         — приход товара на склад.
-- Первые три уже связаны с заказом (084 + 098: deliveries.purchase_order_id,
-- supplier_payments.delivery_id), а движения склада — НЕТ: applyIncomeTx писал
-- их без ссылки на заказ. Без этой связи «перевезти» приход на новую дату
-- невозможно — поэтому миграция её добавляет.
--
-- ЧТО ДЕЛАЕТ:
--   • stock_movements.purchase_order_id — связь прихода с заказом, по которой
--     смена даты проведённой поставки переносит движения склада (FK ON DELETE
--     SET NULL: удаление заказа не рушит историю склада, только развязывает);
--   • purchase_orders.date_corrected_at / date_corrected_by — след «кто и когда
--     менял дату проведённой поставки» (по образцу deliveries.corrected_at 154
--     и supplier_payments.reversed_at 144);
--   • BACKFILL связи для УЖЕ проведённых заказов, два прохода. Движение приёмки
--     и строка накладной (а равно и purchase_orders.received_at) рождались в
--     ОДНОЙ транзакции, поэтому их метки времени побайтово равны (все — now() =
--     момент старта транзакции):
--       1) через накладную (deliveries.purchase_order_id) — supply-режим;
--       2) через purchase_orders.received_at — легаси-приёмки без накладной
--          (receive без paymentMode: только складской приход).
--     Совпадение по (тенант + поставщик + товар + точная метка времени +
--     reason) однозначно; неоднозначные случаи (HAVING COUNT(DISTINCT ...) = 1)
--     сознательно НЕ трогаем — лучше не связать, чем связать неверно.
--
-- ADDITIVE и идемпотентно: ADD COLUMN IF NOT EXISTS + FK в guarded DO-блоке +
-- CREATE INDEX IF NOT EXISTS + backfill, который смотрит только на строки с
-- purchase_order_id IS NULL (повторный прогон — no-op). Ничего не удаляется и
-- не переписывается; все существующие чтения сохраняют форму. Никогда не
-- редактируется после применения.
-- ============================================================================

-- ── stock_movements: связь прихода с заказом поставщику ─────────────────────
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_order_id UUID;

DO $$ BEGIN
  ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_purchase_order_id_fkey
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- Партиальный индекс — переносим движения только по конкретному заказу.
CREATE INDEX IF NOT EXISTS idx_stock_movements_purchase_order
  ON stock_movements (purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- ── purchase_orders: аудит смены даты проведённой поставки ──────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS date_corrected_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS date_corrected_by UUID;

DO $$ BEGIN
  ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_date_corrected_by_fkey
    FOREIGN KEY (date_corrected_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column THEN NULL; END $$;

-- ── BACKFILL: привязать движения ПРОШЛЫХ приёмок к их заказам ───────────────
-- Якорь — накладная поставки (deliveries.purchase_order_id, 098): движение и
-- накладная создавались в одной транзакции, значит created_at = date с
-- точностью до микросекунды. Дополнительно сверяем тенант, поставщика, товар,
-- количество и reason, а связь ставим ТОЛЬКО когда кандидат-заказ ровно один.
DO $$ BEGIN
  UPDATE stock_movements sm
     SET purchase_order_id = m.purchase_order_id
    FROM (
      SELECT sm2.id AS movement_id,
             MIN(d.purchase_order_id::text)::uuid AS purchase_order_id
        FROM stock_movements sm2
        JOIN deliveries d
          ON d.tenant_id = sm2.tenant_id
         AND d.supplier_id = sm2.supplier_id
         AND d.purchase_order_id IS NOT NULL
         AND d.date = sm2.created_at
        JOIN delivery_items di
          ON di.delivery_id = d.id
         AND di.product_id = sm2.product_id
         AND di.quantity = sm2.quantity
       WHERE sm2.purchase_order_id IS NULL
         AND sm2.type = 'income'
         AND sm2.reason = 'Приёмка заказа поставщику'
       GROUP BY sm2.id
      HAVING COUNT(DISTINCT d.purchase_order_id) = 1
    ) m
   WHERE sm.id = m.movement_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;

-- Второй проход — для ЛЕГАСИ-приёмок БЕЗ накладной (receive без paymentMode:
-- складской приход без поставки/долга). Якорь — purchase_orders.received_at:
-- он и created_at движения писались одним now() в одной транзакции, поэтому
-- совпадают побайтово. Сверяем тенанта, поставщика, reason и принадлежность
-- товара позициям заказа; связь ставим только при единственном кандидате.
DO $$ BEGIN
  UPDATE stock_movements sm
     SET purchase_order_id = m.purchase_order_id
    FROM (
      SELECT sm2.id AS movement_id,
             MIN(po.id::text)::uuid AS purchase_order_id
        FROM stock_movements sm2
        JOIN purchase_orders po
          ON po.tenant_id = sm2.tenant_id
         AND po.supplier_id = sm2.supplier_id
         AND po.received_at IS NOT NULL
         AND po.received_at = sm2.created_at
        JOIN purchase_order_items poi
          ON poi.purchase_order_id = po.id
         AND poi.product_id = sm2.product_id
       WHERE sm2.purchase_order_id IS NULL
         AND sm2.type = 'income'
         AND sm2.reason = 'Приёмка заказа поставщику'
       GROUP BY sm2.id
      HAVING COUNT(DISTINCT po.id) = 1
    ) m
   WHERE sm.id = m.movement_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;
