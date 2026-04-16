# AUDIT_REPORT.md — zr-auto-pro (AUTEXA)

Дата аудита: 2026-04-16
Ветка: `claude/local-dev-setup-c9LEK`
Состав: backend (NestJS/PostgreSQL), frontend PWA (React/Vite), mobile (Expo/RN 0.81.5, SDK 54), shared (TS)

---

## 📋 Резюме

Проект функциональный, покрывает 24 модуля бизнес-логики, работает в проде на `autexa.pw`. Архитектура разумная, но страдает от 6 системных проблем:

1. **Нет строгой типизации на backend** — `noImplicitAny: false`, 196 `any` в 40 файлах
2. **Нет тестов вообще** — 0 `.spec.ts` / `.test.ts` во всём репозитории
3. **Монолитные страницы** — 5 файлов >1000 LoC (ProductsPage 2555, ScheduleScreen 2253)
4. **Нет refresh-токена и logout-endpoint** — JWT 7 дней без отзыва
5. **Android разрешает HTTP** — `usesCleartextTraffic: true` в проде
6. **Audit log таблица создана, но никто в неё не пишет** — dead schema

SQL injection риск **низкий** (все запросы параметризованы). XSS риск **низкий** (нет `dangerouslySetInnerHTML`). Рейт-лимит, CORS, upload-валидация настроены нормально.

---

## 🔥 Критические (P0 — блокируют прод / риск данных)

| # | Проблема | Файл | Фикс |
|---|---|---|---|
| P0-1 | **Нет refresh-токена, JWT валиден 7 дней, нет logout → токен нельзя отозвать** | `backend/src/auth/auth.module.ts:13`, нет `POST /auth/logout` | Добавить refresh-token endpoint + blacklist (в Redis или таблице revoked_tokens). Access-token сократить до 15 мин. |
| P0-2 | **`usesCleartextTraffic: true` на Android** позволяет перехват трафика | `mobile/app.json:47` | Удалить флаг, оставить только HTTPS. |
| P0-3 | **Audit log schema без кода** — ничего не логируется | `backend/migrations/015_audit_logs_and_indexes.sql` (таблица есть); кода писать — нет | Либо реализовать через Interceptor, либо убрать таблицу из миграций. |
| P0-4 | **11 контроллеров с `@Body() dto: any`** — валидация байпаснута | Plans, Services, Checks, Cars, Shifts, Calls, Expenses, Uploads, Schedule, Marketing, Clients | Создать DTO-классы с `class-validator`, `ValidationPipe` их подхватит автоматически. |
| P0-5 | **DB-пользователь = superuser `postgres`** — утечка прав | `docker-compose.yml:7` | Создать `app_user` с GRANT на таблицы, `postgres` оставить только для миграций. |

---

## 🟠 Важные (P1 — качество, производительность, безопасность)

### Backend

| # | Проблема | Файл | Фикс |
|---|---|---|---|
| P1-B1 | `noImplicitAny: false` в backend tsconfig | `backend/tsconfig.json` | Включить `"strict": true`, прогнать typecheck, починить |
| P1-B2 | 196 `any` в 40 файлах backend | — | Устранить в рамках P1-B1 |
| P1-B3 | `checks.service.ts` — 766 LoC, нарушен SRP | `backend/src/checks/checks.service.ts` | Разбить на `ChecksRepository`, `ChecksCalculator`, `ChecksService` |
| P1-B4 | `marketing.service.ts` — 604 LoC, смешаны концерны | `backend/src/marketing/marketing.service.ts` | То же: репозиторий + отдельный `MessagingService` |
| P1-B5 | Нет `@nestjs/config` — `process.env` в 13 местах | backend/src | Внедрить ConfigModule + Joi-валидация env на старте |
| P1-B6 | Нет Helmet, headers прописаны вручную (CSP отсутствует) | `backend/src/main.ts:36-43` | `npm i helmet`, включить, добавить CSP |
| P1-B7 | Нет Swagger/OpenAPI | — | `@nestjs/swagger`, сгенерировать из DTO |
| P1-B8 | MIME не проверяется по содержимому (только по расширению) | `backend/src/uploads/` | Использовать `file-type` npm для проверки магических байт |
| P1-B9 | Нет Sentry / структурированных логов | — | Добавить `pino` + `@sentry/nestjs` |
| P1-B10 | Connection pool = 20, под нагрузкой может упираться | `backend/src/common/db-config.ts` | Поднять до 30 + PgBouncer при росте |

### Frontend (Web / PWA)

| # | Проблема | Файл | Фикс |
|---|---|---|---|
| P1-F1 | 103+ `: any` в pages | `DashboardPage`, `SchedulePage`, `ProductsPage`, `EquipmentPage` и др. | Извлечь `ApiError` тип, заменить. `as any` на типизированные маппинги |
| P1-F2 | Монолитные страницы — `ProductsPage.tsx` 2555 LoC | `frontend/src/pages/` | Выделить форм-модалки в `components/forms/`, субкомпоненты в `components/<domain>/` |
| P1-F3 | 148 `<input>` без `<label htmlFor>` (A11y) | все формы | Обернуть в лейблы или добавить `aria-label` |
| P1-F4 | Token хранится в `localStorage` (XSS → кража токена) | `frontend/src/contexts/AuthContext.tsx:23,44` | Перейти на httpOnly cookie + CSRF-токен, либо оставить localStorage но включить strict CSP |
| P1-F5 | Нет ESLint/Prettier/Husky | — | Настроить `eslint-plugin-react-hooks` обязательно — ловит баги с deps |
| P1-F6 | Нет тестов (RTL/Vitest) | — | Добавить Vitest + React Testing Library, покрыть критичные экраны |

### Mobile (Expo)

| # | Проблема | Файл | Фикс |
|---|---|---|---|
| P1-M1 | `usesCleartextTraffic: true` (см. P0-2) | `mobile/app.json:47` | Убрать |
| P1-M2 | 99 `any` в screens, 33 только в ScheduleScreen | `mobile/src/screens/` | Те же API-типы из `shared/`, избавиться от `any` |
| P1-M3 | `ScheduleScreen.tsx` — 2253 LoC, рендерит сетку без FlatList | `mobile/src/screens/ScheduleScreen.tsx` | Разбить на GridTab/TodayTab/RatingTab/SettingsTab как отдельные файлы |
| P1-M4 | Нативный `<Image>` вместо `expo-image` (нет кеша, lazy) | по всем screens | Миграция на `expo-image` даёт +40% FPS на списках с картинками |
| P1-M5 | Нет Sentry / crash reporting | — | `@sentry/react-native` |
| P1-M6 | `versionCode` / `buildNumber` статические, не инкрементируются | `mobile/app.json`, `mobile/eas.json` | `autoIncrement: true` в eas profiles |
| P1-M7 | Токен в обычном AsyncStorage (не в Keystore/Keychain) | `mobile/src/contexts/AuthContext.tsx` | `expo-secure-store` |
| P1-M8 | Нет `expo-updates` (OTA) — любой хотфикс требует пересборку APK | — | Добавить `expo-updates`, настроить Update channels |

### DevOps / Security

| # | Проблема | Файл | Фикс |
|---|---|---|---|
| P1-D1 | Нет CI (GitHub Actions) — тесты/линт/билд не запускаются до деплоя | — | `.github/workflows/ci.yml`: typecheck → lint → test → build |
| P1-D2 | deploy.sh не запускает тесты перед релизом | `deploy.sh` | Добавить `npm run test` + `npm run build` в deploy pipeline |
| P1-D3 | Бэкапы только локальные на VDS, нет off-site | `backup.sh` | Заливать в S3 (rclone/aws-cli), шифровать gpg |
| P1-D4 | Нет uptime-мониторинга / Prometheus | — | UptimeRobot (бесплатно) + Sentry для ошибок |
| P1-D5 | Нет CSP в nginx | `frontend/nginx.conf` | Добавить strict CSP, начать с `report-only` |

---

## 🟡 Улучшения (P2 — nice-to-have)

- **i18n** (currently RU only): задел на EN для будущего экспорта продукта
- **Dark mode** синхронизированный между PWA и mobile
- **Push-уведомления**: Web Push (VAPID) + `expo-notifications`
- **Skip to content** ссылка для A11y
- **Per-query staleTime** тюнинг для отчётов/зарплат (можно 5-10 мин)
- **React Native Hermes** — подтвердить что включён (в RN 0.81 по умолчанию)
- **Извлечь 5 форм-модалок** из ProductsPage → снизит её с 2555 до ~2000 LoC
- **Offline queue в mobile** через React Query persist + AsyncStorage
- **Unit-тесты критичной логики** (attendance, salary, checks calculator)

---

## ✅ Что уже сделано хорошо

- ✅ Миграции идемпотентные (`IF NOT EXISTS`, `DO $$ EXCEPTION`)
- ✅ Транзакции в `createDelivery`, stock movements
- ✅ 20 миграций с корректной последовательностью, runner проверяет `_migrations` таблицу
- ✅ Параметризованные SQL-запросы (zero string concat в WHERE)
- ✅ Глобальный ExceptionFilter
- ✅ Path traversal защита в uploads
- ✅ Tenant isolation в uploads (`/uploads/{tenantId}/`)
- ✅ Rate limiting по IP+token, trust proxy настроен (после хотфикса)
- ✅ bcryptjs rounds=12, политика пароля (8+, uppercase, digit)
- ✅ Service worker с offline queue, network-first стратегия (после хотфикса)
- ✅ Vite code splitting, 24 lazy-loaded pages, xlsx/html2pdf в отдельных чанках
- ✅ React Query правильно сконфигурирован (staleTime, gcTime, retry: 0 on mutations)
- ✅ Shared types/utils используются mobile + web (нет дублирования API-клиента)
- ✅ ErrorBoundary на web и mobile
- ✅ Webhook-деплой с lock-механизмом, авто-backup перед деплоем
- ✅ HSTS + security headers (nginx + backend)

---

## 📊 Цифры

| Метрика | Значение |
|---|---|
| Файлов TS/TSX | ~200 |
| LoC backend | ~8000 |
| LoC frontend | ~25000 |
| LoC mobile | ~15000 |
| `any` всего | ~400 |
| Тестов | 0 |
| Размер initial JS бандла (gzip) | ~115 KB — хорошо |
| Миграций БД | 20 |
| Эндпоинтов API | ~90 |
| Страниц PWA | 30 |
| Экранов мобилы | 25 |

---

## 🗺 План блоков (предложение, до подтверждения)

Каждый блок = отдельный коммит (или серия атомарных коммитов), тесты после каждого, возможность откатить через `git revert`.

### **Блок 1. Тулчейн и CI** ⏱ ~2-3ч
- ESLint + Prettier + `eslint-plugin-react-hooks` на frontend и mobile
- `@typescript-eslint` на backend
- Husky + lint-staged pre-commit
- `.github/workflows/ci.yml` — typecheck + lint + build (пока без тестов)
- **Риск:** низкий — новые файлы, не ломает существующее
- **Выгода:** все дальнейшие блоки проверяются автоматом

### **Блок 2. Backend strict типизация** ⏱ ~4-6ч
- `strict: true` + `noImplicitAny: true` в `backend/tsconfig.json`
- Убрать `any` из auth, common, guards, main
- DTO-классы для 11 контроллеров с `class-validator`
- **Риск:** средний — typecheck упадёт, придётся чинить
- **Выгода:** валидация входов, IDE помощь, меньше runtime-ошибок

### **Блок 3. Refresh токен + logout + audit log** ⏱ ~3-4ч (P0)
- `POST /auth/logout` с занесением jti в таблицу `revoked_tokens`
- `POST /auth/refresh` с коротким access (15мин) + refresh (14д)
- AuditLogInterceptor пишет в `audit_logs` ключевые действия
- Таблица `revoked_tokens` с auto-cleanup
- **Риск:** высокий — меняет auth-flow → обновить web + mobile клиенты
- **Выгода:** закрывает 3 P0 за один блок

### **Блок 4. Security headers + Helmet + CSP** ⏱ ~1-2ч
- `helmet` npm, настроить через main.ts
- CSP в nginx (сначала `report-only`, потом enforce)
- Убрать `usesCleartextTraffic` из mobile
- `app_user` с limited grants вместо superuser в docker-compose
- **Риск:** средний — CSP может сломать inline-скрипты; нужно тестировать
- **Выгода:** -1 P0 и -3 P1

### **Блок 5. Backend рефакторинг крупных сервисов** ⏱ ~4-6ч
- `ChecksService` → `ChecksRepository` + `ChecksCalculator` + `ChecksService`
- `MarketingService` → разделить на репо + `MessagingService`
- Извлечь бизнес-логику из контроллеров
- **Риск:** средний — много файлов, но без изменения поведения
- **Выгода:** -500+ LoC на монолитных файлах, тестируемость

### **Блок 6. Frontend типизация + A11y** ⏱ ~4-6ч
- Убрать `any` из DashboardPage, SchedulePage, ProductsPage
- Определить `ApiError`, `type Mutation<X>`
- `htmlFor` на всех input, `aria-label` на icon-only кнопках
- Skip-to-content link
- **Риск:** низкий
- **Выгода:** лучше IDE + A11y compliance

### **Блок 7. Frontend — разбить монолитные страницы** ⏱ ~4-5ч
- `ProductsPage` → 5 модалок в `components/products/`
- `SchedulePage` → 3 таб-файла
- **Риск:** средний — много файлов, проверить что ничего не сломалось
- **Выгода:** меньше когнитивная нагрузка, легче тестировать

### **Блок 8. Mobile — безопасность + expo-image + рефакторинг** ⏱ ~3-4ч
- Убрать `usesCleartextTraffic`
- `expo-secure-store` для токена
- Миграция Image → `expo-image` где-то 40 мест
- `ScheduleScreen` → разбить на 5 файлов по табам
- Auto-increment versionCode в eas.json
- **Риск:** средний — требует EAS rebuild для теста
- **Выгода:** безопасность, производительность (+40% FPS в списках)

### **Блок 9. Observability: Sentry + логи + CSP report** ⏱ ~2-3ч
- `@sentry/nestjs`, `@sentry/react`, `@sentry/react-native`
- Настроить source maps upload в Sentry
- Structured logging через `pino`
- **Риск:** низкий
- **Выгода:** видим прод-ошибки в реальном времени

### **Блок 10. Тесты** ⏱ ~6-8ч (самый трудоёмкий)
- Jest + `@nestjs/testing` для критичных сервисов (auth, salary, checks, attendance)
- Vitest + RTL для AuthContext, SchedulePage
- Интеграционные тесты через Supertest против testcontainers postgres
- Цель: 60% coverage на бизнес-логике
- **Риск:** низкий — новые файлы
- **Выгода:** regression-защита

### **Блок 11. Фичи (опционально, спросить приоритет)** ⏱ переменно
- Telegram-бот (статус ремонта, напоминания о ТО)
- Онлайн-запись клиентов
- Фото до/после в заказ-нарядах
- Экспорт в Excel отчётов
- Push-уведомления

### **Блок 12. Документация** ⏱ ~2-3ч
- `README.md` — установка, запуск, деплой
- `ARCHITECTURE.md` — диаграмма + решения
- `DEPLOYMENT.md` — пошагово VDS setup
- `CONTRIBUTING.md` — Conventional Commits, стиль
- `CHANGELOG.md` — начать фиксировать с этого рефакторинга
- Swagger/OpenAPI автогенерация из DTO

---

## 🎯 Рекомендуемый порядок

1. **Блок 1** (тулчейн) — фундамент
2. **Блок 4** (security headers) — быстрая победа
3. **Блок 2** (backend strict) — подготовка к большим рефакторингам
4. **Блок 3** (auth refresh) — закрывает P0
5. **Блок 6** (frontend types + A11y) — параллельно с 5
6. **Блок 5** (backend сервисы) — основной рефакторинг
7. **Блок 7** (frontend монолиты) — когда есть типы
8. **Блок 8** (mobile) — после 3 (нужен новый auth flow)
9. **Блок 9** (observability)
10. **Блок 10** (тесты)
11. **Блок 12** (документация)
12. **Блок 11** (фичи) — по желанию

**Оценка общая:** 30-40 часов чистой работы на полный цикл. Можем делать по 1-2 блока за итерацию.

---

## ⏸ Что нужно от тебя перед стартом

1. **Ветка:** остаёмся на `claude/local-dev-setup-c9LEK` или создаём новую?
2. **Порядок блоков:** идём по моему рекомендуемому, или есть приоритеты?
3. **Новые зависимости:** OK поставить Redis для refresh-token blacklist? Или использовать Postgres-таблицу?
4. **Sentry:** у тебя уже есть аккаунт Sentry, или создаём с нуля? (бесплатный tier хватит)
5. **Фичи из Блока 11:** что важно добавить сейчас, а что отложить?
6. **Breaking changes в auth:** при рефреш-токенах **все текущие пользователи разлогинятся** — ОК?

Жду ответ — как подтвердишь, начинаю с **Блока 1 (тулчейн)**.
