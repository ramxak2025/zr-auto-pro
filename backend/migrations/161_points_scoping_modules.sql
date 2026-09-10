-- 161_points_scoping_modules.sql
-- ============================================================================
-- Филиалы, волна 3: точка появляется у ОСТАЛЬНЫХ денежных модулей.
-- Продолжение 156 (tenant_points / user_points / checks.point_id /
-- clients.point_id) и 160 (скоуп журнала, дашбордов и отчётов).
--
-- ЗАЧЕМ. 160 разрезала по филиалам чеки. Всё, что вокруг чеков — рабочие
-- смены, расходы, кассовая смена, зарплатные выплаты/премии/штрафы — осталось
-- общим на тенанта, и это НЕ косметика: филиал А видел расходы филиала Б в
-- своём «Движении денег», Z-отчёт филиала А сходился по чекам ВСЕЙ сети, а
-- вторая кассовая смена вообще не открывалась (см. блок 4 ниже).
--
-- РЕШЕНИЯ ВЛАДЕЛЬЦА, зашитые в эту миграцию:
--   • кассовая смена — СВОЯ у каждого филиала;
--   • расходы получают филиал: ручные — филиал автора, автоматические
--     (выплата ЗП, списание товара, покупка имущества) — филиал связанной
--     операции;
--   • зарплата считается по филиалам: начисления берутся через точку ЧЕКА
--     (колонка не нужна — она уже есть у checks), а выплаты / премии / штрафы
--     получают собственную точку;
--   • рабочая смена штампуется филиалом В МОМЕНТ ОТКРЫТИЯ (переключивший
--     филиал в середине смены остаётся в смене того филиала, где её открыл);
--   • график филиала скоупится по НАЗНАЧЕНИЯМ сотрудников (user_points) —
--     отдельной колонки у строки графика нет и не будет;
--   • склад (products / warehouse) остаётся ОБЩИМ на все филиалы.
--
-- ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ:
--   • safe_transactions (сейф). Баланс сейфа — running total insert-only
--     ledger'а: Σ deposit + Σ adjustment − Σ collection. Депозит рождается при
--     закрытии смены (точка есть), а инкассация из сейфа делается владельцем и
--     точки может не иметь вовсе (режим «Все точки»). Точка у части строк =
--     подсумма по филиалу перестаёт сходиться с реальным остатком, и владелец
--     получает либо запрет законной инкассации, либо «лишние» деньги в
--     филиале. Сейф остаётся ОДИН на компанию — это и физически так (один
--     сейф в кабинете), и арифметически безопасно.
--   • cash_collections (инкассация из кассы). Своя точка не нужна: строка
--     жёстко привязана к shift_id, а у смены точка теперь есть.
--   • products / warehouse / stock_movements — склад общий (решение владельца).
--
-- ИДЕМПОТЕНТНОСТЬ. ADD COLUMN IF NOT EXISTS; UPDATE'ы адресуют ТОЛЬКО строки
-- с point_id IS NULL (повторный прогон не может «перенести» уже привязанные
-- деньги в другой филиал); CREATE INDEX IF NOT EXISTS; DROP INDEX IF EXISTS.
-- Файл после применения не редактируется.
-- ============================================================================

-- ── 1. Колонки ──────────────────────────────────────────────────────────────
-- ON DELETE SET NULL — как у checks.point_id (156): физическое удаление точки
-- (архив им не является) не должно уносить деньги каскадом.

ALTER TABLE shifts            ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE expenses          ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE cash_shifts       ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE salary_payouts    ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE salary_premiums   ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
ALTER TABLE salary_penalties  ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
-- salary_payments — ЛЕГАСИ-путь выплат (012). Новые выплаты идут через
-- salary_payouts, но старые строки живьём участвуют в «выплачено» и в сторно,
-- поэтому точка нужна и им: без неё филиал вычитал бы из своей доли начислений
-- выплаты ВСЕЙ сети.
ALTER TABLE salary_payments   ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;

-- ── 2. Разовая привязка истории к первой живой точке ────────────────────────
-- Та же процедура и тот же детерминированный порядок, что в 160: DISTINCT ON
-- по тенанту, сортировка sort_order → created_at → id (как в пикере точек).
-- Трогаем ТОЛЬКО тенантов, у которых точки уже заведены: у одноточечного
-- тенанта привязывать не к чему, его строки остаются NULL, и фильтра по точке
-- у него всё равно никогда не будет.
--
-- ПОЧЕМУ ЭТО ОБЯЗАТЕЛЬНО: фильтр филиала — СТРОГОЕ равенство
-- (common/point-scope.ts). Без привязки вся история смен, расходов, кассовых
-- смен и зарплатных операций одномоментно стала бы «ничьей» и исчезла из
-- филиального среза — владелец прочитал бы это как потерю денег.

UPDATE shifts s
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE s.point_id IS NULL
   AND s.tenant_id = fp.tenant_id;

UPDATE expenses e
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE e.point_id IS NULL
   AND e.tenant_id = fp.tenant_id;

UPDATE cash_shifts cs
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE cs.point_id IS NULL
   AND cs.tenant_id = fp.tenant_id;

UPDATE salary_payouts p
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE p.point_id IS NULL
   AND p.tenant_id = fp.tenant_id;

UPDATE salary_premiums pr
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE pr.point_id IS NULL
   AND pr.tenant_id = fp.tenant_id;

UPDATE salary_penalties pe
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE pe.point_id IS NULL
   AND pe.tenant_id = fp.tenant_id;

UPDATE salary_payments sp
   SET point_id = fp.point_id
  FROM (
        SELECT DISTINCT ON (tp.tenant_id) tp.tenant_id, tp.id AS point_id
          FROM tenant_points tp
         WHERE tp.is_active
         ORDER BY tp.tenant_id, tp.sort_order ASC, tp.created_at ASC, tp.id ASC
       ) fp
 WHERE sp.point_id IS NULL
   AND sp.tenant_id = fp.tenant_id;

-- ── 3. Индексы под новые фильтры ────────────────────────────────────────────
-- Везде point_id идёт СРАЗУ ПОСЛЕ tenant_id: все запросы начинаются с
-- tenant_id = $1 и добавляют point_id = $n, поэтому такой префикс покрывает и
-- филиальный, и сетевой («Все точки») режим.

-- Лента смен филиала (shifts.getAll: ORDER BY opened_at DESC LIMIT 100).
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_point_opened
  ON shifts (tenant_id, point_id, opened_at DESC);

-- «Кто сейчас на работе» филиала (schedule.getToday и сводка «Филиалы»):
-- открытые смены сегодняшней бизнес-даты. Частичный по closed_at IS NULL —
-- открытых смен единицы, индекс остаётся крошечным и горячим.
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_point_open_date
  ON shifts (tenant_id, point_id, date)
  WHERE closed_at IS NULL;

-- Список расходов филиала за период (expenses.getAll: ORDER BY date DESC) и
-- наличный расход в окне кассовой смены (cash-shifts.computeFigures).
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_point_date
  ON expenses (tenant_id, point_id, date DESC);

-- Открытая кассовая смена филиала + история смен филиала.
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant_point_opened
  ON cash_shifts (tenant_id, point_id, opened_at DESC);

-- Зарплатные компоненты филиала: во всех трёх запросах фильтр — тенант +
-- точка + сотрудник.
CREATE INDEX IF NOT EXISTS idx_salary_payouts_tenant_point_emp
  ON salary_payouts (tenant_id, point_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_premiums_tenant_point_user
  ON salary_premiums (tenant_id, point_id, user_id);
CREATE INDEX IF NOT EXISTS idx_salary_penalties_tenant_point_user
  ON salary_penalties (tenant_id, point_id, user_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_tenant_point_user
  ON salary_payments (tenant_id, point_id, user_id);

-- ── 4. Кассовая смена: «одна открытая» — теперь НА ФИЛИАЛ ───────────────────
-- ПРОБЛЕМА. Миграция 080 завела частичный уникальный индекс
-- uq_cash_shifts_one_open_per_tenant по (tenant_id) WHERE status='open'. Он
-- ФИЗИЧЕСКИ запрещает вторую открытую смену у тенанта: филиал Б, открывая свою
-- кассу, получал 23505 → 409 «Смена уже открыта». Редактировать 080 нельзя
-- (уже применена), поэтому старый индекс снимаем здесь и ставим новый.
--
-- ПОЧЕМУ COALESCE, А НЕ ПРОСТО (tenant_id, point_id). В Postgres NULL не
-- конфликтует сам с собой: у обычного индекса по (tenant_id, point_id)
-- одноточечный тенант (точек нет вовсе → point_id всегда NULL) мог бы открыть
-- СКОЛЬКО УГОДНО параллельных смен — защита, работавшая с 080, молча
-- исчезла бы, а вместе с ней и весь смысл Z-отчёта (два окна на один ящик =
-- касса пересчитывается дважды). Нулевой uuid как суррогат «филиала нет»
-- возвращает NULL'у способность конфликтовать с самим собой:
--   • тенант без точек   → все смены попадают в один слот → максимум одна
--     открытая, ровно как было до этой миграции;
--   • тенант с точками   → по одной открытой смене на филиал;
--   • «ничья» смена (актор в режиме «Все точки») — отдельный слот; открыть её
--     сервис не даёт (CashShiftsService.open требует выбранный филиал, когда у
--     тенанта есть точки), так что слот остаётся пустым, а индекс остаётся
--     последней линией обороны.
-- Нулевой uuid безопасен как суррогат: gen_random_uuid() его не порождает, и
-- FK на tenant_points сюда не смотрит (индекс — выражение, не колонка).
DROP INDEX IF EXISTS uq_cash_shifts_one_open_per_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_one_open_per_point
  ON cash_shifts (tenant_id, COALESCE(point_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
