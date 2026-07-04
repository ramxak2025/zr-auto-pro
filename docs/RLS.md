# RLS — второй рубеж изоляции тенантов

**Что это.** Row Level Security в Postgres (миграция 112): на всех ~87 тенантных
таблицах политика `tenant_isolation` — строка видима/записываема только если её
`tenant_id` совпадает с тенантом текущей сессии. Даже запрос с забытым
`WHERE tenant_id` физически не получит чужие строки.

**Режимы (dual-mode).**

- `DB_APP_PASSWORD` в серверном `.env` **не задан** → один суперпользовательский
  пул, политики инертны (суперпользователь обходит RLS). Поведение прежнее.
- **Задан** → при старте бэкенд создаёт/обновляет роль `autexa_app`
  (LOGIN, NOSUPERUSER, NOBYPASSRLS) и весь тенантный HTTP-трафик идёт через неё:
  каждый запрос получает `app.tenant_id` из JWT (CLS + tenant-pool), политики
  активны. Безтенантные пути (login, health, вебхуки, кроны, superadmin) —
  через прежний admin-пул.

**Включение.** Одна строка в `/opt/zr-auto-pro/.env`:
`DB_APP_PASSWORD=<32+ случайных символов>` → следующий рестарт бэкенда
(любой деплой). В логе контейнера: `RLS dual-pool mode ACTIVE`.

**Откат.** Убрать строку → рестарт. Политики остаются в базе, но снова инертны.

**Проверка после включения.**

- приложение работает как обычно (журнал, создание чека);
- `docker exec -it <postgres> psql -U postgres zr_auto_pro -c "\du autexa_app"` —
  роль существует, без SUPERUSER/BYPASSRLS;
- негатив-тест (под psql): `SET ROLE autexa_app; SELECT count(*) FROM checks;`
  → `0` строк без установленного `app.tenant_id` (default-deny).

**Связанное.** Политики: `backend/migrations/112_row_level_security.sql`
(там же — почему NULLIF и особый случай users). Мост: `backend/src/common/
tenant-pool.ts`, `tenant-context.ts`. Верификация волны: 48+ проверок на
одноразовом PG в обоих режимах (транскрипт в отчёте волны B, 2026-07-03).

> Обновление 2026-07-04: RLS активен на проде (autexa_app, dual-pool) — включён
> владельцем через DB_APP_PASSWORD; резервный домен autexa-cloud.ru направлен
> на сервер, bootstrap выполняется деплоем.
