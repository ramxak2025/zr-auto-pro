-- 116_platform_settings.sql
-- Глобальные (БЕЗ-тенантные) настройки платформы, редактируемые супер-админом.
-- Первый ключ — global_free_voice_minutes: бесплатный помесячный лимит минут
-- голосового ввода, который получают ВСЕ автосервисы (тест-доступ). Дефолт 10.
--
-- Модель хранения — единственная строка-СИНГЛТОН:
--   • id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1) — вторую строку вставить
--     нельзя (и PK-уникальность, и CHECK), UPSERT всегда по id = 1;
--   • строку НЕ сидируем здесь: PlatformSettingsService лениво вставляет её
--     значением из env GLOBAL_FREE_VOICE_MINUTES (или дефолтом 10) при первом
--     чтении/записи — так начальное значение можно задать через env на свежей
--     базе, не редактируя эту миграцию. Источник правды после старта — БД
--     (правит супер-админ через PATCH /api/admin/settings).
--
-- RLS: таблица ГЛОБАЛЬНАЯ (нет tenant_id) ⇒ политика tenant_isolation НЕ нужна
-- и НЕ навешивается (в отличие от tenant-таблиц миграций 112/115). RLS на
-- таблице выключен, поэтому роль autexa_app (NOBYPASSRLS) читает её без фильтра
-- — это нужно voice.service, который читает лимит уже В тенантном контексте
-- (app-пул). Запись гейтится на уровне приложения: только superadmin-роут
-- (RolesGuard @Roles('superadmin')). Модель безопасности идентична глобальным
-- таблицам plans/tenants — они тоже без RLS и защищены RolesGuard'ом.
-- GRANT'ы роли autexa_app выдаёт MigrationRunner.bootstrapAppRole
-- (GRANT ON ALL TABLES после миграций) — в файле они не нужны.
--
-- Идемпотентность: CREATE TABLE IF NOT EXISTS. Будущие ключи добавляются
-- отдельными миграциями через ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS platform_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_free_voice_minutes INT NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
