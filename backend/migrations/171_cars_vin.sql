-- 171_cars_vin.sql
-- ============================================================================
-- VIN-КОД АВТОМОБИЛЯ (правка владельца №2, 2026-09-25).
--
-- ЗАПРОС ВЛАДЕЛЬЦА: к автомобилю можно добавить VIN, по нему марка и модель
-- определяются сами; при включённой опции клиента можно найти по VIN. Опция
-- включается в настройках компании и ПО УМОЛЧАНИЮ ВЫКЛЮЧЕНА — у тенантов, не
-- трогавших настройки, ни в API, ни в UI ничего не меняется.
--
-- ЧТО ДОБАВЛЯЕТСЯ.
--   • cars.vin TEXT NULL — хранится ТОЛЬКО нормализованный VIN (17 символов,
--     латиница верхним регистром, без I/O/Q). Нормализует сервер
--     (backend/src/vin/vin.util.ts, копия shared/utils/vin.ts).
--     Уникальность СОЗНАТЕЛЬНО НЕ на уровне БД: у одной машины бывает несколько
--     карточек (смена владельца, история), а дубль внутри тенанта проверяет
--     сервис и отвечает 409 VIN_DUPLICATE с именем клиента. Частичный индекс —
--     под точный поиск lookup-by-vin и проверку дубля.
--   • tenants.vin_enabled — сама опция.
--   • tenants.vin_decoder_provider / vin_decoder_credentials — платный сервис
--     расшифровки ПО КЛЮЧУ САМОГО КЛИЕНТА (Autexa за запросы не платит).
--     Учётные данные наружу никогда не отдаются (только флаг hasCredentials).
--     Хранятся так же, как ключи соседних интеграций (messaging_integrations.
--     api_key, telephony_integrations.api_key/api_salt): отдельного хелпера
--     шифрования секретов интеграций в проекте нет.
--
-- ИДЕМПОТЕНТНО: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Повторный
-- прогон — no-op. Данные не трогаются, дефолты не меняют поведение.
-- ============================================================================

ALTER TABLE cars ADD COLUMN IF NOT EXISTS vin TEXT;

CREATE INDEX IF NOT EXISTS idx_cars_tenant_vin ON cars (tenant_id, vin) WHERE vin IS NOT NULL;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vin_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vin_decoder_provider TEXT;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vin_decoder_credentials JSONB;
