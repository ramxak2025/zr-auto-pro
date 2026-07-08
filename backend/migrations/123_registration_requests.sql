-- 123_registration_requests.sql
-- ============================================================================
-- Self-service ЗАЯВКИ НА РЕГИСТРАЦИЮ (registration_requests).
--
-- ПРОБЛЕМА: раньше новый автосервис мог появиться только двумя путями — либо
-- суперадмин создаёт тенанта вручную (POST /tenants), либо кто-то регистрируется
-- напрямую через /auth/register (сразу создаёт тенант+владельца без модерации).
-- Продукту нужна ВОРОНКА С МОДЕРАЦИЕЙ: заявка с формы логина (БЕЗ авторизации) →
-- суперадмин смотрит в кабинете → ОДОБРЯЕТ (создаёт тенант + владельца + бесплатный
-- пробный период, чтобы человек сразу вошёл и протестировал) либо ОТКЛОНЯЕТ.
--
-- РЕШЕНИЕ: одна таблица заявок. Владелец сам ВЫБИРАЕТ пароль на форме (телефон +
-- пароль). Пароль хранится ТОЛЬКО в виде bcrypt-хэша (password_hash) — на одобрении
-- аккаунт владельца создаётся с ЭТИМ ЖЕ хэшем (без повторного хэширования), поэтому
-- человек сразу входит по своему телефону+паролю. Сырой пароль в БД не попадает
-- НИКОГДА, и наружу (в list-эндпоинт) password_hash тоже не отдаётся.
--
-- PRE-TENANT: у заявки НЕТ tenant_id — она существует ДО тенанта. created_tenant_id
-- заполняется на одобрении (ссылка на созданный тенант, ON DELETE SET NULL — заявка
-- переживает удаление тенанта, как строка реестра платежей в 122).
--
-- RLS СОЗНАТЕЛЬНО НЕ ВКЛЮЧЁН: скоупить не по чему (нет tenant_id), а включение
-- FORCE RLS без политики закрыло бы таблицу для роли autexa_app (NOBYPASSRLS)
-- наглухо (default-deny). Доступ к таблице идёт ТОЛЬКО через admin-пул
-- (суперпользователь): публичный submit — безтенантный путь → admin-пул; суперадмин
-- (role='superadmin') интерцептором не заворачивается в тенантный контекст → тоже
-- admin-пул. Тенантный (app-пул) трафик сюда не ходит вообще. См. tenant-pool.ts +
-- tenant-context.interceptor.ts.
--
-- Идемпотентно: CREATE TABLE/INDEX IF NOT EXISTS (+ CHECK внутри CREATE TABLE).
-- ============================================================================

CREATE TABLE IF NOT EXISTS registration_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name       TEXT NOT NULL,                       -- название автосервиса
  owner_name         TEXT NOT NULL,                       -- имя будущего владельца
  phone              TEXT NOT NULL,                       -- нормализованный (+7XXXXXXXXXX)
  password_hash      TEXT NOT NULL,                       -- bcrypt-хэш выбранного пароля; наружу НЕ отдаётся
  comment            TEXT,                                -- необязательный комментарий заявителя
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  reject_reason      TEXT,                                -- причина отказа (для status='rejected')
  reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,  -- суперадмин, принявший решение
  reviewed_at        TIMESTAMPTZ,                         -- когда рассмотрено
  created_tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL, -- созданный на одобрении тенант
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Кабинет суперадмина: список заявок с фильтром по статусу, свежие сверху.
CREATE INDEX IF NOT EXISTS idx_registration_requests_status_created
  ON registration_requests (status, created_at DESC);

-- Дедуп-гонка: не даём двум одновременным submit создать две PENDING-заявки на один
-- телефон. Частичный уникальный индекс срабатывает ТОЛЬКО на pending — отклонённый
-- заявитель может подать заявку повторно, а одобренный уже стал users-строкой.
-- Нарушение (23505) сервис ловит и превращает в вежливое «заявка уже на рассмотрении».
CREATE UNIQUE INDEX IF NOT EXISTS uq_registration_requests_pending_phone
  ON registration_requests (phone) WHERE status = 'pending';
