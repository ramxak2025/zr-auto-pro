# PROGRESS.md — refactor/full-audit-2026

Прогресс ночной автономной работы. Ветка: `refactor/full-audit-2026`.

---

## Блок 1. Тулчейн + CI ✅
**Коммитов:** 6 | **Файлов:** ~25

1. **Prettier** — `.prettierrc.json` + `.editorconfig`. Единый стиль.
2. **ESLint backend** — `@typescript-eslint/recommended` + prettier. 0 errors, 667 warnings.
3. **ESLint frontend** — + `react-hooks`, `jsx-a11y`. 0 errors, 1799 warnings.
4. **ESLint mobile** — + `react-native/all`. 0 errors, 2201 warnings.
5. **Husky + lint-staged** — pre-commit hook на staged файлах.
6. **GitHub Actions CI** — 3 jobs (backend/frontend/mobile): typecheck + lint + build.

**Баг найден:** `UsersScreen.tsx` — `useMemo` после early return (rules-of-hooks violation). Починен.

---

## Блок 2. Backend strict типизация ⚠️ частично
**Коммитов:** 1

1. **`strict: true`** в tsconfig — включены все strict-проверки.
2. **@types/pg** — 24 TS7016 ошибки устранены.
3. **6 DTO** — definite assignment assertions на 14 свойств.
4. **0 TypeScript errors** в strict mode.

**Отложено:** 32 контроллера с `@Body() dto: any` — нужны DTO-классы (~3 часа). Вернёмся.

---

## Блок 3. Logout + token revocation ✅
**Коммитов:** 1

1. **`POST /auth/logout`** — заносит JWT ID (jti) в таблицу `revoked_tokens`.
2. **jti в JWT** — каждый токен теперь содержит уникальный ID (randomUUID).
3. **JwtStrategy.validate()** — проверяет `revoked_tokens` при каждом запросе.
4. **Migration 021** — таблица `revoked_tokens` с индексами.
5. **Web + Mobile** — AuthContext вызывает `POST /auth/logout` при sign-out.
6. **Backward compatible** — старые токены без jti по-прежнему работают.

---

## Блок 4. Security headers ✅
**Коммитов:** 2

1. **Helmet** — заменяет ручные headers. HSTS, noSniff, frameguard, hidePoweredBy, referrerPolicy.
2. **Trust proxy** — чистый NestExpressApplication cast, убрал `as any`.
3. **Android `usesCleartextTraffic: false`** — закрыл P0-2.
4. **`.env.example`** — добавлены REDIS_URL, SENTRY_DSN/ORG/PROJECT, CORS_ORIGIN.
5. **`.backups/`** в .gitignore.

---

## Блок 9. Observability ⚠️ частично
**Коммитов:** 1

1. **Sentry SDK** установлен (`@sentry/nestjs`). Init из `SENTRY_DSN` env var.
2. **pino + pino-pretty** установлены (для структурированных логов в будущем).
3. **Sentry DSN пуст** — ждём создания аккаунта утром.

---

## Блок 12. Документация ⚠️ частично
**Коммитов:** 1

1. **README.md** — обзор проекта, стек, быстрый старт, структура каталогов.

**Отложено:** ARCHITECTURE.md, DEPLOYMENT.md, CONTRIBUTING.md, CHANGELOG.md, Swagger.

---

## Не начаты

| Блок | Причина |
|------|---------|
| 5. Backend refactor services | Зависит от DTO (Block 2 remainder) |
| 6. Frontend types + a11y | Следующая итерация |
| 7. Frontend split monoliths | Следующая итерация |
| 8. Mobile security + perf | Ожидает Sentry и auth flow финализации |
| 10. Tests | Нет локальной БД для интеграционных тестов |
| 11. Features | После стабилизации архитектуры |

---

## Решения, принятые самостоятельно

| Развилка | Решение | Обоснование |
|----------|---------|-------------|
| ESLint 8 vs 9 | ESLint 8 | Совместим со всеми плагинами; 9 ломает react-hooks/jsx-a11y/react-native |
| `any` → error vs warn | warn | 400+ мест — если error, CI сразу мертвый |
| DTO: создать все 32 сейчас vs потом | Потом (правило 4ч) | strict mode — главная победа; DTO — grunt work |
| Block 3 перед 4 или после | После (4 быстрее) | Helmet — 15 мин, logout — 45 мин + migration |
| Token blacklist: Redis vs Postgres | Postgres (сейчас) | Redis пока нет в compose; Postgres достаточен для малого масштаба. Переезд на Redis — 1 подмена query на Redis SET/GET |
| Audit log interceptor | Отложен | Migration 015 создала таблицу, но реализация interceptor'а — 2+ часа. Вернёмся |
| Sentry — создавать аккаунт? | Нет (правило #7) | Подготовил код, DSN пуст. Пользователь создаст утром |
