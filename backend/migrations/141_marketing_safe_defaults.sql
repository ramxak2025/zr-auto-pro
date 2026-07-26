-- 141_marketing_safe_defaults.sql
-- ============================================================================
-- Безопасные дефолты авто-рассылок: НОВЫЙ тенант не шлёт клиентам НИЧЕГО,
-- пока владелец явно не включил сценарий.
--
-- ПРОБЛЕМА. Три сценария авто-отправки рождались ВКЛЮЧЁННЫМИ:
--   • review_settings.auto_send_enabled DEFAULT true (007) — подключил
--     интеграцию → «оцените обслуживание» уходит после КАЖДОГО закрытого
--     чека, молча, без единого действия владельца;
--   • booking_settings.notify_client_on_create DEFAULT true (076) — SMS
--     клиенту при создании записи;
--   • booking_settings.reminder_enabled DEFAULT true (076) — SMS-напоминание
--     перед записью.
-- Главный страх владельца — «пойдут ещё какие-то смс клиентам». Правильная
-- модель — как у Apple: любой канал наружу выключен, пока его не включили
-- осознанно (и при включении видно, ЧТО именно уйдёт).
--
-- ЧТО ДЕЛАЕТ. Меняет ТОЛЬКО DEFAULT колонок — то, что получают НОВЫЕ строки
-- (новые тенанты / lazy-create настроек при первом чтении).
--
-- ЧЕГО НЕ ДЕЛАЕТ (намеренно). НИКАКОГО backfill существующих строк: у уже
-- работающих тенантов рассылки могли быть включены и РЕАЛЬНО работать —
-- массовое выключение молча остановило бы их запросы отзывов и напоминания
-- о записи. Существующие значения не трогаем ни в одну сторону.
--
-- ALTER COLUMN SET DEFAULT идемпотентен по определению (повторный прогон
-- сходится к тому же состоянию), таблицы существуют с 007/076; DO-блок
-- страхует от отсутствующей таблицы на свежей базе, где порядок миграций
-- уже создал их — тогда это чистый no-op-ситуаций не бывает, но защита
-- ничего не стоит.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE review_settings ALTER COLUMN auto_send_enabled SET DEFAULT false;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE booking_settings ALTER COLUMN notify_client_on_create SET DEFAULT false;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE booking_settings ALTER COLUMN reminder_enabled SET DEFAULT false;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;

-- ── Индекс под журнал отправок (GET /marketing/sent-messages) ────────────────
-- Лента журнала читается keyset-ом (tenant_id, sent_at DESC, id DESC) — ровно
-- как чеки (139). Существующие индексы 124 ведут по (tenant_id, client_id, …)
-- и (tenant_id, phone, …) — под «все отправки тенанта по времени» нужен свой.
-- Аддитивно и идемпотентно.
CREATE INDEX IF NOT EXISTS idx_sent_messages_tenant_sent_id
    ON sent_messages (tenant_id, sent_at DESC, id DESC);
