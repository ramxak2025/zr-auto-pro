-- 131_backfill_check_line_cost_profit.sql
-- ============================================================================
-- ФИНАНСОВАЯ ЦЕЛОСТНОСТЬ (round-11 #10): исправление ЗАВЫШЕННОЙ прибыли на
-- ИСТОРИЧЕСКИХ чеках. Владелец: «исправить старые чеки».
--
-- КОРНЕВАЯ ПРИЧИНА (подтверждена диагностикой + живыми данными прода, это НЕ
-- импорт):
--   ProductsService.mapProduct ОБНУЛЯЕТ costPrice для любого актора без права
--   'warehouse_manage' (мастеров) — себестоимость это чувствительное поле
--   склада. Мастер, создающий чек, отправлял на запись costPrice: 0, поэтому
--   строка чека сохранялась с total_cost = 0. Итог: прибыль строки = полная
--   цена продажи → прибыль завышена ВЕЗДЕ (по товару, по чеку, в дашборде).
--   Цена ПРОДАЖИ перекрывалась сервером (loadWarehouseSellPrices), а
--   себестоимость — НЕТ. Код-фикс (loadWarehouseCostPrices) закрывает это для
--   НОВЫХ чеков; эта миграция чинит УЖЕ записанные.
--
-- ФОРМУЛА ПРИБЫЛИ (как в коде, checks.service.ts):
--   profit = total_revenue - total_cost
--   total_cost = product_cost_total + service_salary_total + product_salary_total
-- То есть checks.total_cost — это НЕ Σ(check_product_lines.total_cost); в него
-- ещё входят зарплатные начисления. Поэтому мы НЕ пересчитываем profit с нуля,
-- а применяем ДЕЛЬТУ: на сколько выросла себестоимость строк — на столько же
-- растут product_cost_total и total_cost и на столько же ПАДАЕТ profit. Это
-- ровно та величина, на которую прибыль была завышена, и это не трогает
-- зарплатные начисления (product_salary_total) — их ретро-пересчёт изменил бы
-- уже выплаченную мастерам ЗП и здесь ВНЕ ЗОНЫ (см. КАВЕАТ 2).
--
-- ТАБЛИЦЫ/КОЛОНКИ (подтверждено по 001_init.sql + 120_fractional_quantities):
--   check_product_lines(product_id, quantity NUMERIC(12,3), cost_price, total_cost)
--   products(id, cost_price)
--   checks(product_cost_total, total_cost, profit, is_returned, is_deferred,
--          deleted_at, tenant_id)
--
-- RLS (belt-and-braces, как в 120): checks и products под FORCE ROW LEVEL
-- SECURITY (112). Суперпользовательский пул RLS обходит всегда (миграция тогда
-- инертна к RLS), но если владельцем таблиц окажется НЕ-суперпользователь,
-- политика tenant_isolation без app.tenant_id отфильтровала бы ВСЕ строки и
-- UPDATE стал бы тихим no-op. row_security = off переводит это в честный
-- обход/ошибку (fail-loud), а не в молчаливый пропуск.
--
-- ИДЕМПОТЕНТНОСТЬ: обе операции опираются на предикат «строка с total_cost = 0,
-- у товара cost_price > 0». Шаг (b) (дельта прибыли) читает ещё-нулевые строки
-- ПЕРЕД шагом (a); после того как шаг (a) выставит им реальную себестоимость,
-- повторный прогон не найдёт ни одной такой строки → и (b), и (a) становятся
-- no-op. Порядок (b перед a) обязателен — иначе после первого прогона дельту
-- уже не вычислить.
--
-- КАВЕАТ 1 (текущая себестоимость вместо исторической): исходная
-- себестоимость на момент продажи НЕ была записана (её обнулили). Мы берём
-- ТЕКУЩУЮ products.cost_price как наилучшее доступное приближение. Если с
-- момента продажи закупочная цена менялась — восстановленная себестоимость
-- приблизительна, но заведомо ближе к правде, чем ноль.
-- КАВЕАТ 2 (нулевая себестоимость остаётся нулём): строки, где у товара
-- сейчас cost_price = 0 (или он NULL/удалён), НЕ трогаются — их total_cost
-- остаётся 0. Отличить «настоящий 0-cost товар» от «cost ещё не заведён»
-- задним числом невозможно; трогаем только те строки, где точно есть чем
-- заполнить (p.cost_price > 0).
-- КАВЕАТ 3 (возвраты): чек с is_returned = true ИСКЛЮЧЁН из пересчёта profit.
-- Возврат (returns.service) уже уменьшил его profit и total_revenue на сумму
-- возврата (refund_amount) — повторное вычитание дельты по себестоимости было
-- бы вторым, несогласованным изменением заголовка. Строки-снимки такого чека
-- шаг (a) всё же чинит (для консистентности), но per-product аналитика
-- возвращённые чеки после fix-3 и так исключает.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;

-- ── Шаг (b): пересчёт profit заголовка по ДЕЛЬТЕ себестоимости ───────────────
-- Читаем строки, которые СЕЙЧАС ещё нулевые (до шага a). Для каждого затронутого
-- чека added_cost = Σ ROUND(p.cost_price * qty, 2) по его нулевым строкам —
-- ровно та сумма, что шаг (a) впишет в total_cost этих строк (старое было 0).
-- product_cost_total += added_cost, total_cost += added_cost, profit -= added_cost.
-- Исключаем возвращённые (is_returned) и удалённые (deleted_at) чеки. Дефферы
-- включаем — у них profit хранится по той же формуле; учётного следа они не
-- несут и при закрытии всё равно пересчитаются, но колонка остаётся честной.
-- SUM(ROUND(...)) — округляем ПО-СТРОЧНО, потом суммируем: это ровно та сумма,
-- что шаг (a) впишет в total_cost каждой строки (round2 на строку), поэтому
-- дельта заголовка бит-в-бит равна Σ(новых total_cost) — без копеечного дрейфа.
WITH check_deltas AS (
  SELECT
    cpl.check_id,
    SUM(ROUND(p.cost_price * cpl.quantity, 2)) AS added_cost
  FROM check_product_lines cpl
  JOIN products p ON p.id = cpl.product_id
  WHERE cpl.total_cost = 0
    AND p.cost_price > 0
  GROUP BY cpl.check_id
)
UPDATE checks ch
   SET product_cost_total = COALESCE(ch.product_cost_total, 0) + d.added_cost,
       total_cost         = COALESCE(ch.total_cost, 0)         + d.added_cost,
       profit             = COALESCE(ch.profit, 0)             - d.added_cost
  FROM check_deltas d
 WHERE ch.id = d.check_id
   AND ch.is_returned = false
   AND ch.deleted_at IS NULL
   AND d.added_cost <> 0;

-- ── Шаг (a): восстановление себестоимости на самих строках ──────────────────
-- Только строки, где сейчас total_cost = 0, а у товара реальная себестоимость
-- (> 0). Уже корректные снимки и настоящие 0-cost товары не трогаем. Чиним ВСЕ
-- такие строки, включая строки возвращённых чеков (per-line снимок должен быть
-- корректным; заголовок возвращённого чека шаг b намеренно не трогал).
UPDATE check_product_lines cpl
   SET cost_price = p.cost_price,
       total_cost = ROUND(p.cost_price * cpl.quantity, 2)
  FROM products p
 WHERE cpl.product_id = p.id
   AND cpl.total_cost = 0
   AND p.cost_price > 0;
