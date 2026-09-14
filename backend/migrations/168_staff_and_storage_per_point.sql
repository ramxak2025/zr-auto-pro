-- 168_staff_and_storage_per_point.sql
-- ============================================================================
-- ШТАТ И ИМУЩЕСТВО — У КАЖДОГО ФИЛИАЛА СВОИ.
--
-- ТРЕБОВАНИЕ ВЛАДЕЛЬЦА (2026-09-14, дословно): «система филиалов это значит,
-- что владелец автосервиса имеет несколько точек и у каждой свой товар и
-- остатки, свои мастера и так далее… каждый филиал это грубо говоря отдельный
-- автосервис просто под одним владельцем и одной подпиской».
--
-- ЧТО БЫЛО НЕ ТАК. Назначения сотрудников на филиалы (user_points, 156) были
-- НЕОБЯЗАТЕЛЬНЫМИ: сотрудник без единого назначения считался «не ограничен» и
-- показывался в КАЖДОМ филиале — в пикере мастера, в графике, в «Сотрудниках».
-- Это был безопасный дефолт внедрения (никого не запирать, пока владелец не
-- расставил людей), но у автосервиса, который людей не расставлял, оба филиала
-- показывали один и тот же штат — то есть «свои мастера» не существовали.
-- Имущество (storage_items) филиала не имело вовсе: подъёмник филиала лежал в
-- подсобке основного сервиса.
--
-- РЕШЕНИЕ.
--   1. ШТАТ. Каждый сотрудник, кроме владельца/директора и суперадмина,
--      ПРИПИСАН к филиалу. Кто ещё не приписан, получает филиал по свидетелям:
--      филиал его последнего чека (как мастера) → филиал его последней смены →
--      основной сервис. Владелец/директор НЕ приписывается: у него нет
--      филиалов именно потому, что он владелец всех — он входит в любой и
--      переключается между ними (163/167). Дальше новые сотрудники получают
--      филиал сессии того, кто их завёл (UsersService.create), а списки
--      сотрудников по умолчанию отдают штат текущего филиала
--      (UsersController: дефолт стал `scope=point`, `scope=all` — явно).
--      Конвенция «нет назначений → доступны все» в autexa_available_points
--      НЕ меняется: она нужна владельцу, а у остального штата назначения
--      теперь есть всегда.
--   2. ИМУЩЕСТВО. storage_items.point_id — штамп филиала сессии при
--      создании, строгое равенство при чтении, гейт записи (как у расходов).
--      История: филиал зеркального расхода «Покупка имущества» → основной.
--      Выданное сотрудникам (equipment_issued) следует за человеком и своей
--      колонки не получает: сводка «по сотрудникам» режется штатом филиала.
--
-- Та же логика продублирована в PointsService (attachStaffToMain +
-- HISTORY_ATTACH_SQL) для тенантов, которым первый филиал заведут позже.
--
-- ИДЕМПОТЕНТНО: ADD COLUMN IF NOT EXISTS, INSERT … ON CONFLICT DO NOTHING
-- только для тех, у кого назначений нет, UPDATE только по point_id IS NULL.
-- У тенантов без филиалов не меняется ничего.
-- ============================================================================

-- ── 1. Имущество: колонка + привязка истории ────────────────────────────────
ALTER TABLE storage_items ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES tenant_points(id) ON DELETE SET NULL;
COMMENT ON COLUMN storage_items.point_id IS
  'Филиал, в котором стоит имущество (168). Штампуется филиалом сессии; NULL только у тенантов без филиалов.';

-- >>> ATTRIBUTION-BLOCK-168
UPDATE storage_items si
   SET point_id = COALESCE(
         (SELECT e.point_id FROM expenses e
           WHERE e.storage_item_id = si.id AND e.tenant_id = si.tenant_id AND e.point_id IS NOT NULL
           ORDER BY e.created_at DESC LIMIT 1),
         mp.main_id)
  FROM (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp
 WHERE si.point_id IS NULL
   AND si.tenant_id = mp.tenant_id;
-- <<< ATTRIBUTION-BLOCK-168

CREATE INDEX IF NOT EXISTS idx_storage_items_tenant_point
  ON storage_items (tenant_id, point_id);

-- ── 2. Штат: каждый не-владелец приписан к филиалу ──────────────────────────
-- Свидетели — те же, что у истории денег (161): где человек реально работал.
-- Чеки после появления филиалов несут филиал сессии; чеки до них 160
-- прибила к основному, поэтому у «старого» мастера свидетель честно даст
-- основной сервис. Владелец потом перекладывает людей в карточке сотрудника.
-- >>> STAFF-BLOCK-168
INSERT INTO user_points (user_id, point_id, tenant_id)
SELECT u.id,
       COALESCE(
         (SELECT ch.point_id FROM checks ch
           WHERE ch.tenant_id = u.tenant_id AND ch.master_id = u.id
             AND ch.point_id IS NOT NULL AND ch.deleted_at IS NULL
           ORDER BY ch.created_at DESC LIMIT 1),
         (SELECT s.point_id FROM shifts s
           WHERE s.tenant_id = u.tenant_id AND s.user_id = u.id AND s.point_id IS NOT NULL
           ORDER BY s.opened_at DESC LIMIT 1),
         mp.main_id),
       u.tenant_id
  FROM users u
  JOIN (
        SELECT tp.tenant_id, tp.id AS main_id
          FROM tenant_points tp
         WHERE tp.is_main AND tp.is_active
       ) mp ON mp.tenant_id = u.tenant_id
 WHERE u.role NOT IN ('director', 'superadmin')
   AND u.purged_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM user_points up WHERE up.user_id = u.id AND up.tenant_id = u.tenant_id)
ON CONFLICT DO NOTHING;
-- <<< STAFF-BLOCK-168
