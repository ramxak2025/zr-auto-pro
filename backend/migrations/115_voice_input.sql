-- 115_voice_input.sql
-- Голосовой ввод комментария (Яндекс SpeechKit STT + YandexGPT-полировка) —
-- помесячные пакеты минут по тарифам.
--
-- Модель квоты:
--   • plans.voice_minutes         — пакет минут в месяц, входящий в тариф
--     (0 = в тариф не входит; редактирует суперадмин через PATCH /plans/:id);
--   • tenants.voice_minutes_extra — индивидуальная надбавка тенанту ПОВЕРХ
--     тарифа (суперадмин, PATCH /tenants/:id);
--   • voice_usage                 — счётчик потребления за календарный месяц
--     ПО МОСКОВСКОМУ ВРЕМЕНИ (period = 'YYYY-MM'; МСК = UTC+3 круглый год, без
--     DST — сдвиг вычисляется в коде, БД ничего про таймзоны не знает).
--     Одна строка на (tenant, месяц). Списание идёт 15-секундными блоками
--     (зеркало биллинга Яндекса: 0.1626 ₽/блок) атомарным
--     INSERT ... ON CONFLICT ... DO UPDATE с проверкой лимита в WHERE —
--     при гонке на краю квоты проходит РОВНО ОДНА из конкурирующих записей
--     (доказано на одноразовом PG16, см. отчёт волны).
--
-- Доступ к фиче гейтится ключом тарифа 'voice_input' (features JSONB) — 24-й
-- ключ каталога (backend/src/plans/feature-catalog.ts + зеркало
-- shared/constants/features.ts). Ни на один существующий тариф ключ НЕ
-- бэкфиллится: фича продаётся пакетами минут, включает её суперадмин
-- сознательно. DEFAULT 0 в обеих колонках ⇒ деплой не меняет поведение ни
-- одного тенанта ни на байт.
--
-- RLS: voice_usage — тенантная таблица ⇒ политика tenant_isolation по образцу
-- миграции 112 (ENABLE + FORCE + USING/WITH CHECK на GUC app.tenant_id;
-- NULLIF против reset-значения '' — см. комментарий в 112). GRANT'ы роли
-- autexa_app выдаёт MigrationRunner.bootstrapAppRole (GRANT ON ALL TABLES
-- после миграций) — в файле они не нужны.
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- DROP POLICY IF EXISTS + CREATE POLICY; ENABLE/FORCE RLS идемпотентны сами.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS voice_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS voice_minutes_extra INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS voice_usage (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period CHAR(7) NOT NULL, -- 'YYYY-MM' календарного месяца по МСК
  seconds_used INT NOT NULL DEFAULT 0,
  requests INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period)
);

ALTER TABLE voice_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON voice_usage;
CREATE POLICY tenant_isolation ON voice_usage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
