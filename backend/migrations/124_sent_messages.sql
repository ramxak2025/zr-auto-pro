-- 124_sent_messages.sql
-- ============================================================================
-- Единый журнал ИСХОДЯЩИХ клиентских сообщений + анти-спам / анти-дубль контур
-- для раздела «Рассылки» (marketing mailings).
--
-- ЗАЧЕМ. Каждое SMS стоит денег, и явное требование владельца —
-- «НЕ ДУБЛИРОВАТЬ SMS и НЕ СПАМИТЬ клиентов». До этой миграции исходящие
-- сообщения (запрос отзыва, «машина готова», напоминания рассрочки,
-- напоминания «давно не обслуживались», win-back, подтверждение записи) уходили
-- КАЖДОЕ по своему пути, без общего лога и без общей проверки на дубль. Этот
-- журнал — единая точка, через которую MarketingService.guardAndLogSend
-- пропускает все отправки: до отправки читает лог и ОТКАЗЫВАЕТ, если сообщение
-- было бы дублем; после отправки пишет строку (sent/failed).
--
-- ТРИ уровня защиты (реализованы в guardAndLogSend, БД — их носитель):
--   1. Авто-типы: одна отправка на сущность (dedup_key = `review:<checkId>`,
--      `car_ready:<checkId>`, `installment_reminder:<planId>:<date>:<phase>`,
--      `service_reminder:<clientId>:<YYYY-MM>`) — гарантируется UNIQUE-индексом
--      (tenant_id, dedup_key) + ON CONFLICT DO NOTHING (race-safe «claim»).
--   2. Точный дубль: одно и то же тело (content_hash) на один и тот же телефон
--      в коротком окне (1 час) — SELECT по (tenant_id, phone, sent_at DESC).
--   3. Глобальный потолок: не более N сообщений одному клиенту за скользящие
--      24 часа поперёк ВСЕХ типов — count(*) по (tenant_id, client_id, sent_at).
--
-- ХРАНЕНИЕ ТЕЛЕФОНА. `phone` хранится в нормализованном виде — национальный
-- ключ из последних 10 цифр (phoneSearchKey / common/normalize-phone.ts,
-- совместимо с индексами 104): «+7 (988) 444-44-85» и «89884444485» дают один
-- ключ, поэтому дубль ловится независимо от формата ввода.
--
-- content_hash — sha1(тело сообщения), для дешёвого сравнения на точный дубль.
--
-- ADDITIVE и идемпотентно: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS + CREATE POLICY. Не трогает ни одну существующую таблицу/путь. Повторный
-- прогон сходится к тому же состоянию. Никогда не редактируется после применения.
--
-- client_id / created_by БЕЗ FK — намеренно (как в sms_history, 109): удаление
-- клиента/пользователя не должно рушить журнал отправок; осиротевшие UUID просто
-- перестают джойниться. tenant_id — с FK + ON DELETE CASCADE (удаление тенанта
-- уносит его журнал).
-- ============================================================================

CREATE TABLE IF NOT EXISTS sent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Кому (soft-ссылка, без FK). NULL для типов без клиента (напр. телеграм-
    -- уведомление в чат владельца).
    client_id UUID,
    -- review | reminder | car_ready | winback | booking | manual | broadcast.
    -- Без CHECK-домена намеренно (как sms_history): значения задаёт код, новые
    -- типы не должны требовать миграцию.
    message_type TEXT NOT NULL,
    -- Канал, которым реально ушло сообщение: whatsapp | smsru | moizvonki |
    -- telegram | sms | email (messaging_integrations.provider_type).
    provider_type TEXT,
    -- Нормализованный телефон = последние 10 цифр (phoneSearchKey). '' не
    -- пишем — guardAndLogSend отбивает пустой номер до вставки.
    phone TEXT NOT NULL,
    -- sha1(тело) для проверки на точный дубль.
    content_hash TEXT NOT NULL,
    -- sent — ушло; failed — провайдер вернул ошибку/нет провайдера; skipped_dedup
    -- зарезервирован (отказы анти-спама МЫ в таблицу НЕ пишем — только считаем,
    -- чтобы не занимать dedup_key и не раздувать журнал).
    status TEXT NOT NULL DEFAULT 'sent',
    -- Ключ идемпотентности. Для авто-типов — по сущности; для ручных рассылок —
    -- синтезируется из типа/телефона/хэша/часового окна. UNIQUE(tenant_id,
    -- dedup_key) + ON CONFLICT DO NOTHING = гонко-безопасный «claim».
    dedup_key TEXT NOT NULL,
    -- Текст ошибки провайдера (для status='failed'); NULL для 'sent'.
    error TEXT,
    -- Кто инициировал (для ручной рассылки — id пользователя). Soft, без FK.
    created_by UUID,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Гонко-безопасный claim: две одновременные отправки с одинаковым dedup_key
-- столкнутся здесь; ON CONFLICT DO NOTHING отдаст пустой RETURNING второму —
-- он НЕ отправляет. Это и есть железная защита «одно SMS ровно один раз».
CREATE UNIQUE INDEX IF NOT EXISTS uq_sent_messages_tenant_dedup
    ON sent_messages (tenant_id, dedup_key);

-- CHECK 1 (кулдаун по клиенту+типу) и обзор истории клиента: ведём по
-- (tenant_id, client_id, message_type, sent_at DESC).
CREATE INDEX IF NOT EXISTS idx_sent_messages_tenant_client_type_sent
    ON sent_messages (tenant_id, client_id, message_type, sent_at DESC);

-- CHECK 2 (точный дубль на телефон) и CHECK 3 (24h-потолок читает по клиенту,
-- но телефонный скан нужен для дубля): (tenant_id, phone, sent_at DESC).
CREATE INDEX IF NOT EXISTS idx_sent_messages_tenant_phone_sent
    ON sent_messages (tenant_id, phone, sent_at DESC);

-- ── Row Level Security (в связке с миграцией 112 / dual-pool) ────────────────
-- Обязательно: путь ручной рассылки / win-back / «машина готова» исполняется в
-- request-контексте → идёт через роль autexa_app (NOBYPASSRLS). Без политики
-- default-deny запретил бы и SELECT, и INSERT в этот журнал. Фоновые джобы
-- (обзор отзывов, крон напоминаний) идут через admin-пул и RLS обходят.
ALTER TABLE sent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sent_messages;
CREATE POLICY tenant_isolation ON sent_messages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
