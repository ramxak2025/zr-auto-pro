-- 151_notification_settings.sql
-- ============================================================================
-- Round 14, зона 5: ГИБКИЕ настройки уведомлений.
--
-- notification_mutes (066) остаётся источником правды по КАТЕГОРИЯМ (opt-out:
-- строка == категория выключена). Эта таблица добавляет ГЛОБАЛЬНЫЕ настройки
-- пользователя, которые категориями не выражаются:
--
--   • master_enabled     — мастер-тумблер «Все уведомления». false ⇒ ни одного
--                          категорийного пуша, независимо от mutes. Броадкасты
--                          поддержки (sendBroadcastToUser) и тихие data-пуши
--                          (sendDataToTenant) НЕ подчиняются ему by design:
--                          первые — важные объявления, вторые — невидимая
--                          инвалидация кеша, не «уведомление».
--   • quiet_from/quiet_to — тихие часы (локальное стенное время). Оба NULL ⇒
--                          выключены. Окно через полночь (22:00→07:00)
--                          поддержано: from > to читается как «через ночь».
--                          Внутри окна категорийный пуш НЕ отправляется вовсе
--                          (а не «шлём без звука») — честнее и не оставляет
--                          беззвучных баннеров на залоченном экране.
--   • tz_offset_minutes  — смещение устройства от UTC в минутах на момент
--                          сохранения (МСК = 180). Нужно, потому что сервер
--                          живёт в UTC, а «22:00» пользователь имеет в виду
--                          своё. NULL ⇒ бэкенд берёт 180 (все тенанты — РФ),
--                          см. QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN.
--   • sound              — звук/вибрация. false ⇒ пуш доставляется без звука
--                          (Expo sound:null → APNs без sound ⇒ тихий баннер).
--
-- Строки нет ⇒ дефолты (всё включено, тихих часов нет) — поэтому бэкфилла нет
-- и НИ ОДИН существующий пользователь не теряет уведомления от этой миграции.
--
-- RLS: таблица ключуется user_id и НЕ имеет tenant_id — тот же класс, что
-- notification_mutes и push_tokens, которые миграция 112 намеренно оставила
-- без RLS (список в её шапке). Политика здесь была бы неприменима (нет колонки
-- для предиката), а закрыть FORCE RLS без политики = сломать роль autexa_app.
-- GRANT'ы роли выдаёт MigrationRunner.bootstrapAppRole после миграций.
--
-- ADDITIVE и идемпотентно: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS. После применения не редактируется.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_settings (
    user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    master_enabled    BOOLEAN     NOT NULL DEFAULT true,
    sound             BOOLEAN     NOT NULL DEFAULT true,
    quiet_from        TIME        NULL,
    quiet_to          TIME        NULL,
    tz_offset_minutes INTEGER     NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Догоняющие ADD COLUMN на случай, если таблица уже создана более ранней
-- (частичной) версией файла на чьей-то базе: миграция обязана быть сходящейся.
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS master_enabled    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS sound             BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS quiet_from        TIME    NULL;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS quiet_to          TIME    NULL;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS tz_offset_minutes INTEGER NULL;

-- Смещение вне [-12ч, +14ч] — заведомо мусор от кривого клиента; отсекаем на
-- уровне схемы, чтобы вычисление тихих часов не уехало на сутки.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'notification_settings_tz_offset_sane'
    ) THEN
        ALTER TABLE notification_settings
            ADD CONSTRAINT notification_settings_tz_offset_sane
            CHECK (tz_offset_minutes IS NULL OR (tz_offset_minutes BETWEEN -720 AND 840));
    END IF;
END
$$;

-- Индекс не нужен: доступ всегда по PK (user_id) — и из чтения настроек, и из
-- LEFT JOIN в push-гейте.
