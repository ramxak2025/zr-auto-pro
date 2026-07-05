-- 120_fractional_quantities.sql
-- Дробные количества товара: «шланг метровый, 50 см = пробить 0.5».
--
-- Состояние до миграции: 002_decimal_stock.sql уже перевёл товарные
-- quantity-колонки из INT в NUMERIC(12,2) (products.stock/min_stock,
-- stock_movements.quantity/stock_before/stock_after,
-- check_product_lines.quantity, delivery_items.quantity), а 084 создал
-- purchase_order_items.quantity/received_quantity как NUMERIC(14,2).
-- Точности 2 знака мало для «0.125 кг» и хвостов пересчёта — выравниваем
-- ВСЕ товарные потоки на 3 знака (как уже сделано в 040 для
-- check_return_lines.quantity NUMERIC(10,3)).
--
-- НЕ трогаем:
--   • check_service_lines.quantity (INT) — услуги считаются в целых;
--   • equipment_items.quantity (INT) — имущество, отдельный поток;
--   • check_return_lines.quantity — уже NUMERIC(10,3).
--
-- Дополнительно выравниваем motivation_accruals.qty (095, NUMERIC(12,2)) —
-- туда копируется количество товарной строки чека, дробь 0.125 не должна
-- терять хвост при начислении бонуса.
--
-- Идемпотентность: каждая колонка проверяется через
-- information_schema.columns (data_type + numeric_scale) — повторный прогон
-- ничего не перезаписывает. ALTER TYPE numeric(x,2)→numeric(x,3) — это
-- table rewrite + ACCESS EXCLUSIVE, поэтому, как в 117: lock_timeout 5s —
-- не взяли лок за 5с → миграция быстро падает, транзакция откатывается,
-- сервис перезапускается и повторяет (health-gate не пустит трафик раньше).
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    spec RECORD;
    cur RECORD;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('products',             'stock',             12),
            ('products',             'min_stock',         12),
            ('stock_movements',      'quantity',          12),
            ('stock_movements',      'stock_before',      12),
            ('stock_movements',      'stock_after',       12),
            ('check_product_lines',  'quantity',          12),
            ('delivery_items',       'quantity',          12),
            ('purchase_order_items', 'quantity',          14),
            ('purchase_order_items', 'received_quantity', 14),
            ('motivation_accruals',  'qty',               12)
        ) AS t(tbl, col, prec)
    LOOP
        SELECT data_type, numeric_scale INTO cur
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = spec.tbl
           AND column_name = spec.col;

        -- Колонки нет (усечённая среда) — молча пропускаем, как ADD COLUMN
        -- IF NOT EXISTS-паттерн в остальных миграциях.
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        -- Уже numeric со scale >= 3 — конвертация не нужна (повторный прогон).
        IF cur.data_type = 'numeric' AND COALESCE(cur.numeric_scale, 0) >= 3 THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC(%s,3) USING %I::NUMERIC(%s,3)',
            spec.tbl, spec.col, spec.prec, spec.col, spec.prec
        );
    END LOOP;
END $$;

-- Единица измерения: исторический дефолт 'pcs' — данные-дрейф (клиенты и UI
-- работают с русскими метками: 'шт','м','кг','л','уп','компл'). Дефолт и
-- существующие legacy-коды приводим к русским меткам. Выражения идемпотентны.
ALTER TABLE products ALTER COLUMN unit SET DEFAULT 'шт';

-- products под FORCE ROW LEVEL SECURITY (112): если миграцию запустит роль
-- без BYPASSRLS (не-superuser владелец), политика tenant_isolation молча
-- отфильтровала бы ВСЕ строки и UPDATE стал бы тихим no-op. row_security=off
-- переводит это в громкую ошибку (fail-loud): либо RLS обойдён и данные
-- реально конвертированы, либо миграция падает и деплой не проходит.
SET LOCAL row_security = off;
UPDATE products
   SET unit = CASE unit
                WHEN 'pcs' THEN 'шт'
                WHEN 'pc'  THEN 'шт'
                WHEN 'm'   THEN 'м'
                WHEN 'l'   THEN 'л'
                WHEN 'kg'  THEN 'кг'
                ELSE unit
              END
 WHERE unit IN ('pcs', 'pc', 'm', 'l', 'kg');
