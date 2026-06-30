-- 099_profile_change_requests.sql
-- «Мой профиль»: согласование изменений профиля сотрудника владельцем.
-- (Employee profile-change-request approval flow.)
--
-- WHY
--   Владелец (director + superadmin) меняет свой профиль (ФИО / телефон / аватар)
--   НАПРЯМУЮ. Сотрудник (admin + master) тем же действием НЕ меняет свою строку
--   `users`, а создаёт ЗАПРОС на изменение, который владелец одобряет или
--   отклоняет. При одобрении diff применяется к `users` (с проверкой уникальности
--   телефона — телефон это логин). Пароль НИКОГДА не проходит через этот поток —
--   смена пароля self-service для всех ролей и хранится только в `users.password`.
--
-- WHAT
--   Одна новая таблица `profile_change_requests`. Каждая строка — один запрос
--   одного сотрудника. Изменения хранятся как JSONB-diff в `changes`: массив
--   объектов { "field": "fullName"|"phone"|"avatar", "oldValue": ..., "newValue": ... }.
--   Поля diff — клиентские camelCase-имена (как их видит UI); сервис мапит их в
--   колонки users (fullName→full_name, phone→phone, avatar→avatar) при применении.
--   Пароль в diff НЕ попадает никогда.
--
--   status: 'pending' | 'approved' | 'rejected'.
--   decided_by / decided_at — кто из владельцев и когда обработал запрос.
--
-- ADDITIVE, append-only. Ничего не дропается и не переписывается — ни одна
-- существующая колонка/таблица не трогается, поэтому старые сборки клиентов
-- продолжают читать прежние формы ответов.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + guarded ADD COLUMN (DO-блоки глотают
-- duplicate_column / undefined_table) + CREATE INDEX IF NOT EXISTS, поэтому
-- частично применённая / уже существующая таблица сходится к полной форме при
-- повторном прогоне. Никогда не редактируется после применения.

-- ── profile_change_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Тенант запроса (изоляция). CASCADE: при удалении тенанта запросы уходят.
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- Автор запроса = сотрудник, чей профиль меняется. CASCADE: запросы живут,
    -- пока живёт строка пользователя (users никогда не хард-удаляются — soft
    -- dismiss, — так что на практике запросы остаются для истории).
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    -- JSONB-массив per-field diff'ов:
    --   [{ "field": "fullName"|"phone"|"avatar", "oldValue": <text|null>, "newValue": <text|null> }, ...]
    -- Хранится в клиентских camelCase-именах; маппинг в колонки users — в сервисе.
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Жизненный цикл запроса.
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Кто из владельцев одобрил/отклонил. SET NULL: удаление/чистка владельца
    -- не должна рушить историю обработанного запроса.
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ
);

-- Безопасные доборы колонок для уже существующей таблицы (на случай частичного
-- применения в прошлом).
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN changes JSONB NOT NULL DEFAULT '[]'::jsonb; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(); EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN decided_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profile_change_requests ADD COLUMN decided_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column OR undefined_table THEN NULL; END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Очередь владельца «на рассмотрении» по тенанту: WHERE tenant_id=$ AND status='pending'.
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_tenant_status
  ON profile_change_requests (tenant_id, status);
-- Один АКТИВНЫЙ (pending) запрос на сотрудника — частичный UNIQUE-индекс.
-- Делает getMyChangeRequest детерминированным и не даёт накопить дубли pending;
-- повторная отправка сотрудником ОБНОВЛЯЕТ существующий pending-запрос (supersede),
-- а одобрение/отклонение выводит строку из-под условия (status<>'pending'), после
-- чего сотрудник может создать новый запрос. Частичный — историю approved/rejected
-- индекс не покрывает.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_change_requests_user_pending
  ON profile_change_requests (user_id)
  WHERE status = 'pending';
