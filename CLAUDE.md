# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Скопировано отдельно: `mobile/CLAUDE.md` остаётся как дополнение для работы только внутри мобилки. Этот корневой файл — источник правды для всего монорепо.

---

## A. Что такое Autexa

**Autexa** — SaaS для автосервисов в России. Один backend и три клиента ходят в один API:

- **Web (PWA)** — `frontend/`, React 18 + Vite + Tailwind. Полноценная админка автосервиса в браузере.
- **iOS app** — `mobile/`, Expo + React Native + локальные Swift/UIKit/SwiftUI Expo Modules. **Это приоритетный клиент** — там идёт активный redesign.
- **Android app** — `mobile/` (тот же RN-проект), без native-кода кроме того, что приходит из Expo.
- **Backend** — `backend/`, NestJS 10 + TypeScript, PostgreSQL 16 через raw `pg.Pool` (без ORM).

Продуктовые ценности (по которым принимаются решения о компромиссах):

1. iOS должен ощущаться как качественный нативный iPhone-продукт (Liquid Glass, плавные анимации, haptics).
2. Скорость экранов (мгновенное появление данных за счёт persistent cache + prefetch).
3. Надёжность учёта: касса, склад, зарплата — потеря данных недопустима, миграции базы идемпотентные.
4. Один общий API для всех клиентов — ломая контракт, ломаем сразу три приложения.

## B. Структура репозитория

Реально существующие верхнеуровневые папки:

| Путь                                                                                | Что это                                                                                       | Стек                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/`                                                                          | NestJS API                                                                                    | TS, NestJS 10, `pg`, passport-jwt, class-validator, helmet, sharp, busboy, pino, sentry                                                                      |
| `frontend/`                                                                         | Web PWA                                                                                       | React 18, Vite 5, Tailwind 3, react-router-dom 6, @tanstack/react-query 5, framer-motion, react-hook-form, html2pdf.js, xlsx                                 |
| `mobile/`                                                                           | Expo RN-app + локальные Swift модули                                                          | Expo SDK 54, RN 0.81.5, Hermes, New Arch, react-navigation v7, react-query, expo-blur, reanimated 4                                                          |
| `shared/`                                                                           | Общий TS-код для frontend + mobile                                                            | typeless package, axios; `api/createServices.ts` (фабрики) + `types/index.ts` (40+ интерфейсов) + `utils/{attendance,formatters}.ts` + `validation/phone.ts` |
| `docs/`                                                                             | Документация. Подпапка `ios-redesign/` содержит 25+ markdown'ов по iOS-redesign               | —                                                                                                                                                            |
| `scripts/`                                                                          | Bash: `build-apk.sh`, `deploy-vds.sh`, `update.sh`, `full-setup.sh`, `backup.sh`              | —                                                                                                                                                            |
| `webhook/`                                                                          | Auto-deploy Docker-сервис, слушает GitHub webhook на пуш в `master`                           | —                                                                                                                                                            |
| `.github/workflows/`                                                                | CI: `ci.yml` (typecheck+lint+build для backend/frontend/mobile), `deploy.yml`                 | GitHub Actions, ubuntu-latest                                                                                                                                |
| `docker-compose.yml`                                                                | postgres 16 + backend + frontend (nginx) + webhook, общий volume `uploads`                    | Docker                                                                                                                                                       |
| `.env.example`                                                                      | Полный список env (DB_PASSWORD, JWT_SECRET, REDIS_URL, S3, EXPO_TOKEN, SENTRY, DEPLOY_SECRET) | —                                                                                                                                                            |
| `AUDIT_REPORT.md`, `PERF_REPORT.md`, `PROGRESS.md`, `ZR_AUTO_PRO_DOCUMENTATION.txt` | Исторические отчёты, не путать с актуальной правдой кода                                      | —                                                                                                                                                            |

Корневой `package.json` агрегирует workspace-команды: `npm run install:all`, `backend:dev`, `frontend:dev`, `lint`/`typecheck` по всем подпроектам, `format` (prettier), `mobile:start`, `mobile:android`. Husky + lint-staged настроены на pre-commit.

## C. Реальные функциональные разделы (только то, что есть в коде)

| Раздел                            | Backend module                                                                                        | Web (`frontend/src/pages/`)                                                                  | Mobile (`mobile/src/screens/`)                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Авторизация                       | `auth/` (`auth.controller.ts`: login/register/me/logout/avatar; `jwt.strategy.ts`; DTO в `auth/dto/`) | `LoginPage.tsx`                                                                              | `LoginScreen.tsx`                                                    |
| Главная / Дашборд                 | `reports/` (статистика, рейтинги)                                                                     | `DashboardPage.tsx`                                                                          | `DashboardScreen.tsx`                                                |
| Касса / Заказ-наряд               | `checks/`                                                                                             | `CheckCreatePage.tsx`, `CheckDetailPage.tsx`, `ChecksPage.tsx`, `RetailChecksPage.tsx`       | `CheckCreateScreen.tsx`, `CheckDetailScreen.tsx`, `ChecksScreen.tsx` |
| Склад / Товары                    | `products/`, `warehouse/`                                                                             | `ProductsPage.tsx`                                                                           | `ProductsScreen.tsx`                                                 |
| Услуги                            | `services/`                                                                                           | `ServicesPage.tsx`                                                                           | `ServicesScreen.tsx`                                                 |
| Клиенты                           | `clients/`                                                                                            | `ClientsPage.tsx`, `ClientDetailPage.tsx`                                                    | `ClientsScreen.tsx`, `ClientDetailScreen.tsx`                        |
| Автомобили клиентов               | `cars/`                                                                                               | `CarsPage.tsx`                                                                               | `CarsScreen.tsx`                                                     |
| Поставщики                        | `suppliers/`                                                                                          | `SuppliersPage.tsx`, `SupplierDetailPage.tsx`                                                | `SuppliersScreen.tsx`, `SupplierDetailScreen.tsx`                    |
| Расписание / График               | `schedule/`, `shifts/`                                                                                | `SchedulePage.tsx`                                                                           | `ScheduleScreen.tsx`                                                 |
| Зарплата                          | `salary/`                                                                                             | `SalaryPage.tsx`                                                                             | `SalaryScreen.tsx`                                                   |
| Движение денег / касса по дням    | `reports/` (используется как источник)                                                                | `CashFlowPage.tsx`                                                                           | `CashFlowScreen.tsx`                                                 |
| Расходы                           | `expenses/`                                                                                           | `ExpensesPage.tsx`                                                                           | `ExpensesScreen.tsx`                                                 |
| Отчёты                            | `reports/`                                                                                            | `ReportsPage.tsx`                                                                            | `ReportsScreen.tsx`                                                  |
| Сотрудники                        | `users/` (DTO + роли)                                                                                 | `EmployeesPage.tsx`, `EmployeeDetailPage.tsx`                                                | `EmployeesScreen.tsx`, `EmployeeDetailScreen.tsx`                    |
| Пользователи / роли               | `users/`                                                                                              | `UsersPage.tsx`                                                                              | `UsersScreen.tsx`                                                    |
| Маркетинг и отзывы                | `marketing/`                                                                                          | `MarketingPage.tsx`, `ReviewPublicPage.tsx`                                                  | `MarketingScreen.tsx`                                                |
| Звонки                            | `calls/`                                                                                              | `CallsPage.tsx`                                                                              | `CallsScreen.tsx`                                                    |
| Имущество / equipment             | `equipment/`                                                                                          | `EquipmentPage.tsx`                                                                          | `EquipmentScreen.tsx`                                                |
| Подписка / тарифы                 | `plans/`, `tenants/`                                                                                  | `TariffPage.tsx`, `SubscriptionBlockedPage.tsx`                                              | `SubscriptionScreen.tsx`                                             |
| Настройки компании                | `tenants/`                                                                                            | `CompanySettingsPage.tsx`                                                                    | `CompanySettingsScreen.tsx`                                          |
| Admin (superadmin)                | `tenants/`, `plans/`                                                                                  | `pages/admin/{AdminDashboardPage,AdminPlansPage,AdminTenantsPage,AdminTenantDetailPage}.tsx` | `AdminScreen.tsx`                                                    |
| Корзина / soft-delete             | реализовано через миграцию `023_soft_delete_products_categories.sql` (нет отдельного модуля)          | (страницы нет — функционал распределён)                                                      | `TrashScreen.tsx`                                                    |
| «Ещё» / меню                      | —                                                                                                     | `MorePage.tsx`                                                                               | `MoreScreen.tsx`                                                     |
| Аплоады (фото товаров и клиентов) | `uploads/` (multipart через busboy + sharp + S3)                                                      | используется через `axios` напрямую                                                          | `src/api/services.ts` → `uploadsApi.upload()` (FormData)             |
| Health                            | `health/`                                                                                             | —                                                                                            | —                                                                    |

Bottom-tab нижний бар iOS/Android (`mobile/src/navigation/TabBarShared.ts`) определяет 5 табов в одной точке: **Главная**, **Склад**, **Касса** (центральная, `isKassa: true`), **Журнал**, **Ещё**. Если меняешь таб-структуру — это единственное место.

## D. Правила работы с backend (NestJS)

Backend, его API, БД и бизнес-логика — **зона повышенной ответственности**. По умолчанию **не трогаем**.

1. **Не менять без явного разрешения владельца:**
   - модули из `backend/src/app.module.ts` (`auth`, `users`, `tenants`, `plans`, `clients`, `cars`, `services`, `products`, `checks`, `suppliers`, `salary`, `reports`, `shifts`, `schedule`, `uploads`, `warehouse`, `health`, `expenses`, `marketing`, `calls`, `equipment`);
   - controllers, services, DTO в этих модулях;
   - guards (`common/guards/{jwt-auth,rate-limit,roles}.guard.ts`), interceptors (`common/interceptors/etag.interceptor.ts`), filters (`common/filters/http-exception.filter.ts`), decorators (`common/decorators/current-user.decorator.ts`);
   - бизнес-логика и SQL-запросы внутри сервисов.

2. **API-контракт.** Сигнатуры запросов/ответов синхронизированы через `shared/api/createServices.ts` и `shared/types/index.ts`. Любое изменение поля или endpoint'а тянет одновременно frontend и mobile. Без обновления всех потребителей и полного `npm run typecheck` в каждом подпроекте — не коммитим.

3. **База данных.** Используется `pg.Pool` напрямую, без ORM. Миграции — `backend/migrations/NNN_*.sql`, прогоняются через `MigrationRunner` (`backend/src/migration-runner.ts`) при старте процесса, регистрируются в служебной таблице `_migrations`. **Правила миграций:**
   - идемпотентные (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`);
   - только дописываем новые файлы со следующим номером, **никогда не редактируем уже применённые** (текущий хвост — `024_users_team.sql`);
   - схему/индексы/типы данных не меняем без отдельного разрешения.

4. **Auth-логика.** JWT (`@nestjs/jwt`, `passport-jwt`), `JwtAuthGuard` + `RateLimitGuard` стоят глобально (`main.ts`). Black-list ревокаций — через миграцию `021_revoked_tokens.sql` + опционально Redis (`REDIS_URL`). `RolesGuard` + декоратор `@Roles(...)` в `common/guards/roles.guard.ts`. Эти механизмы — **трогать только с владельцем**.

5. **Глобально включено в `main.ts`:** helmet (HSTS 1y, frameguard deny), `ValidationPipe({ transform: true, whitelist: true })`, `HttpExceptionFilter`, `ETagInterceptor`, `RateLimitGuard`, `app.setGlobalPrefix('api')`, `app.use(json({ limit: '50mb' }))`. Не отключать, не понижать.

6. **Secrets.** Никогда не коммитим и не выводим в логи: `JWT_SECRET`, `DB_PASSWORD`, `S3_*`, `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN`, `DEPLOY_SECRET`, любые `.env*`. См. `.env.example` — это шаблон, а не источник секретов.

## E. Правила работы с iOS

iOS — **приоритетный клиент**. Можно и нужно улучшать активно.

1. **Когда уходим в native:** если RN не даёт нужной плавности (jank на скролле, перекошенные анимации, gesture conflicts, отсутствие материалов iOS 26) — пишем native module. Текущий пример — `mobile/modules/autexa-liquid-glass/` (два Expo Module: `AutexaLiquidGlassModule` для glass-поверхности и `AutexaLiquidGlassTabBarModule` для нижнего бара, оба зарегистрированы в `expo-module.config.json`).

2. **Liquid Glass / iOS 26.** На iOS 26+ через runtime class lookup поднимаем `UIGlassEffect` (см. `AutexaLiquidGlassView.swift`); fallback на iOS 13–25 — `UIVisualEffectView` + `UIBlurEffect.systemThinMaterial`; iOS < 13 — `UIBlurEffect.light`. Сборка одна и та же — module компилируется на любом Xcode SDK. На Android JS-обёртка падает в `expo-blur` или translucent View.

3. **Safe Area / Dynamic Island / Home Indicator.** Использовать `react-native-safe-area-context` (`useSafeAreaInsets`, `SafeAreaView edges={['top']}`). Нижний край НЕ оборачиваем — там работает floating tab bar, который сам учитывает `insets.bottom`. У всех скроллов `paddingBottom` ≥ `useTabBarHeight()` (хук в `mobile/src/hooks/useTabBarHeight.ts`). Никаких hardcoded `paddingTop: 44`. Подробнее — `docs/ios-redesign/SAFE_AREA_FIX.md` и `IOS_NATIVE_UX_SPEC.md`.

4. **Анимации.** В Swift — `UIViewPropertyAnimator` + `UISpringTimingParameters`. В RN — `react-native-reanimated` 4 + `react-native-gesture-handler` 2.28, spring-пресеты в `mobile/src/platform/motion.ts`. Уважать `UIAccessibility.isReduceMotionEnabled` (на native стороне) и `AccessibilityInfo.isReduceMotionEnabled` (RN-сторона).

5. **Haptics.** Native: `UISelectionFeedbackGenerator` (выбор таба, переключения), `UIImpactFeedbackGenerator` (тап/деструктив). На JS-стороне — `expo-haptics` через хелпер `mobile/src/platform/haptics.ts`. Не злоупотреблять — только там, где улучшает UX.

6. **Производительность.**
   - 60 fps скролл на всех списках (`@shopify/flash-list` уже в зависимостях для тяжёлых).
   - Persistent cache: `mobile/src/utils/persistentCache.ts` зеркалит whitelist query-keys в AsyncStorage; `hydrateCache` блокирует первый рендер (~50 мс), `attachPersistence` пишет на каждом успехе.
   - Глобальный `placeholderData: prev => prev` в QueryClient (`mobile/App.tsx`) — stale-while-revalidate для всех запросов. **Не отключать**.
   - Prefetch соседних данных после логина — `AuthContext.prefetchAfterLogin()` греет products / services / users / warehouse-categories.
   - Никаких visual flicker'ов: между экранами держим предыдущие данные через `placeholderData` + persistent cache.

7. **Native rebuild — обязателен**, если поменялся любой файл в `mobile/modules/*/ios/`, `mobile/app.json` (plugins / infoPlist / bundleIdentifier / buildNumber), `mobile/plugins/`, или версия Expo SDK:

   ```bash
   cd mobile
   npx expo prebuild --platform ios --clean
   cd ios && pod install && cd ..
   open ios/Autexa.xcworkspace   # или: xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa -configuration Debug -sdk iphonesimulator build
   ```

   Не редактируем файлы под `mobile/ios/` руками — они регенерируются.

8. **Документировать iOS-решения.** При каждом крупном iOS-изменении — отдельный markdown в `docs/ios-redesign/`. См. раздел I.

## F. Правила работы с Android

Android **не ломаем**. Базовый план:

1. Платформо-специфичные различия — через `Platform.OS === 'ios'` или через файлы `*.ios.tsx` / `*.android.tsx` (Metro сам выбирает по расширению). Уже работает для `mobile/src/navigation/TabBar.{ios,android}.tsx`.
2. Любое изменение в **shared-коде мобилки** (`mobile/src/api/*`, `mobile/src/contexts/*`, `mobile/src/utils/*`, бизнес-экраны без `.ios.tsx`-варианта) обязано быть Android-совместимым: типы, импорты, отсутствие iOS-only API в общих файлах. Минимально — `npm run typecheck && npm run lint` в `mobile/`. Если есть Mac/эмулятор — `npm run android` и smoke-проход по основным экранам.
3. Native iOS-модули (`mobile/modules/autexa-liquid-glass/`) на Android молча уходят в JS-fallback (`expo-blur` / простой `View`). Сохраняем этот контракт — нельзя писать iOS-only API в JS-обёртке без проверки платформы.
4. Версии: `mobile/app.json` → `android.versionCode` инкрементируется монотонно при релизе.

## G. Правила работы с web frontend (React)

1. Web `frontend/` **не ломаем**. Стек: React 18 + Vite 5 + Tailwind 3 + react-router-dom 6 + @tanstack/react-query 5. Все страницы lazy-loaded через `lazyWithRetry` (см. `frontend/src/App.tsx`) — это намеренно, для устойчивости к stale-cache chunk failures после деплоя.
2. Любое изменение API-контракта (типов в `shared/types/index.ts`, фабрик в `shared/api/createServices.ts`) обязано быть проверено на frontend: `cd frontend && npm run typecheck && npm run lint && npm run build`. Сборка фронта — **обязательный шаг** перед коммитом, который меняет shared.
3. Web и mobile делят `shared/` напрямую: web подтягивает через относительные пути и vite resolve, mobile — через Metro `watchFolders` (`mobile/metro.config.js`) и tsconfig alias `@shared/*` → `../shared/*`. Менять структуру `shared/` — значит менять оба resolver'а.

## H. Реальные команды для проверок

Все команды взяты из реальных `package.json`. Выдуманных нет.

### Backend (`cd backend`)

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/**/*.ts --max-warnings=10000
npm run build          # nest build
npm run start:dev      # nest start --watch
# тестов в backend нет (jest не установлен)
```

### Frontend (`cd frontend`)

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/**/*.{ts,tsx}
npm run build          # tsc && vite build  ← одновременно проверяет типы
npm run dev            # vite
# тестов нет
```

### Mobile (`cd mobile`)

```bash
npm run typecheck                                 # tsc --noEmit (strict)
npm run lint                                      # eslint src/**/*.{ts,tsx}
npm run lint:fix
npx jest                                          # все тесты (npm-скрипта `test` нет)
npx jest src/utils/__tests__/plateMask.test.ts    # plate mask тесты — обязательно зелёные
npm start                                         # Metro
npm run ios                                       # build + run в iOS Simulator
npm run android                                   # build + run в Android emulator
```

### iOS native (только когда менялся native)

```bash
cd mobile
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa -configuration Debug -sdk iphonesimulator build
# либо вручную через Xcode → ▶ Run
```

### Android (когда тронут shared-код)

Gradle-конфиг живёт под `mobile/android/` после `expo prebuild --platform android` (сейчас не закоммичен). Минимум — `cd mobile && npm run android`, чтобы убедиться, что Metro собирает и приложение стартует.

### Корневые workspace-команды (`cd <repo-root>`)

```bash
npm run lint           # backend → frontend → mobile
npm run typecheck      # backend → frontend → mobile
npm run format         # prettier --write по всему репо
npm run install:all    # npm install во всех трёх подпроектах
```

### CI (GitHub Actions, `.github/workflows/ci.yml`)

Запускается на push в `master` / `main` / `refactor/full-audit-2026` и на pull request в `master` / `main`. Три параллельные job'ы: backend (typecheck + lint + build), frontend (typecheck + lint + build), mobile (typecheck + lint). **Тестов в CI нет** — `npx jest` запускается только локально.

## I. Правила документации

1. Все значимые **iOS-решения и redesign-этапы** фиксируем в `docs/ios-redesign/`. Уже существуют (на момент аудита):
   - `FINAL_REPORT.md` — честный итог автономной работы (что сделано, что не проверено, ограничения).
   - `IOS_NATIVE_UX_SPEC.md`, `ANDROID_IOS_PARITY.md`, `AUDIT.md`, `ASSUMPTIONS.md`.
   - По нижнему бару: `NATIVE_TAB_BAR_SWIFT.md`, `TAB_BAR_NATIVE_IMPLEMENTATION.md`.
   - По расписанию: `SCHEDULE_FIX_PLAN.md`, `SCHEDULE_SWIFT_REDESIGN.md`.
   - По кассе/госномеру: `CASH_DESIGN_AND_PLATE_CARD.md`, `LICENSE_PLATE_FIX.md`, `LICENSE_PLATE_INPUT_SPEC.md`.
   - По складу: `WAREHOUSE_UI_REDESIGN.md`, `WAREHOUSE_IMAGE_PREVIEW.md`.
   - По Safe Area: `SAFE_AREA_FIX.md`.
   - По звонкам: `CALLS_FIX_PLAN.md`.
   - По производительности: `PERFORMANCE_PLAN.md`.
   - План и тестовая матрица: `IMPLEMENTATION_PLAN.md`, `TEST_PLAN.md`, `CRITICAL_FIX_PLAN.md`, `REVIEW_OF_FAILED_IMPLEMENTATION.md`.
   - Инструкции владельцу: `HOW_TO_RUN_FOR_OWNER.md`, `HANDOFF_TO_DEVELOPER.md`, `REPORT_FOR_DEVELOPER.md`.
2. Под каждый крупный блок (нижний таб-бар, расписание, касса, склад, image preview, и т. п.) — **отдельный markdown** с:
   - проблемой / motivation;
   - архитектурой решения;
   - fallback-стратегией (что происходит на старых iOS / Android / без native module);
   - acceptance criteria (как владелец проверяет на физическом iPhone).
3. `FINAL_REPORT.md` — честный текущий итог: что реализовано, что проверено, какие ограничения. Не превращать в маркетинговый отчёт.
4. Существующие отчёты на корне (`AUDIT_REPORT.md`, `PERF_REPORT.md`, `PROGRESS.md`, `ZR_AUTO_PRO_DOCUMENTATION.txt`) — исторические, **не актуальная правда кода**. Новые решения пишем в `docs/`, не в корень.

## J. Правила автономной работы

Claude Code работает автономно от изучения до коммита. При этом:

1. **Никогда не трогаем:**
   - `.env`, `.env.local`, `.env.production`, любые реальные secrets (только `.env.example` — шаблон);
   - certificates, provisioning profiles, private keys, App Store signing identities, Apple Developer credentials;
   - production-базу, `pgdata` volume, `backup.sh` / `restore.sh` без явной просьбы;
   - `eas.json` `submit.production` блок (Apple ID, ASC App ID, Team ID) — заполняет владелец;
   - bundle ID `com.autexa.mobile` (зашит в `app.json`, `eas.json`, native проекте) — без явной просьбы.
2. **Никаких handoff'ов** другому разработчику. Не пишем «нужен iOS-разработчик», «должен сделать DevOps», «оставлю TODO для команды». Если задачу можно решить — решаем; если нет — честно фиксируем причину.
3. **Косметика ≠ задача выполнена.** Если визуал поправлен, но плата всё ещё рендерит дублирующийся регион / тесты красные / typecheck не проходит — задача не закрыта.
4. **Ограничения окружения честны.** Если работаем без macOS / без физического iPhone / без Android-эмулятора — пишем это явно в `docs/ios-redesign/FINAL_REPORT.md`. Не симулируем «я проверил на устройстве», если не проверяли. См. как написано в текущем `FINAL_REPORT.md`.
5. **Команда упала — чиним и перезапускаем.** Не игнорируем красный typecheck, не комментируем тест.
6. **Не утверждаем «готово» без зелёных проверок** из раздела H.

## K. Definition of Done

Задача считается выполненной только когда:

- [ ] Код реализован полностью, без TODO в P0-местах.
- [ ] Запущены доступные проверки из раздела H для затронутых подпроектов:
  - menял backend → backend `typecheck` + `lint` + `build`;
  - менял frontend → frontend `typecheck` + `lint` + `build`;
  - менял mobile (JS) → mobile `typecheck` + `lint` + `npx jest`;
  - менял plate-mask → `npx jest src/utils/__tests__/plateMask.test.ts` зелёный;
  - менял `shared/` → typecheck во всех трёх потребителях;
  - менял native iOS → `expo prebuild --clean` + `pod install` + сборка через Xcode/`xcodebuild`.
- [ ] Все запущенные проверки проходят, либо ограничения честно зафиксированы в `docs/ios-redesign/FINAL_REPORT.md` (если, например, нет macOS — Xcode-сборку не запускали).
- [ ] Документация обновлена: для крупных iOS-изменений — отдельный markdown в `docs/ios-redesign/`, ссылка на него — в `FINAL_REPORT.md`.
- [ ] Есть либо подтверждение от владельца («работает на моём iPhone»), либо явный чек-лист для ручной приёмки (что нажать, что должно произойти, что считается багом).

## L. Карта зон риска

Файлы и пути, требующие особенно осторожного отношения. Перед изменением — спросить владельца, перед коммитом — отдельно обосновать.

| Путь                                                                                             | Почему опасно                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/**`                                                                                 | Бизнес-логика, авторизация, БД-запросы. Контракт API.                                                                                                                             |
| `backend/migrations/*.sql`                                                                       | Миграции применяются автоматически на старте сервиса. Уже применённый файл редактировать нельзя, новый файл — только следующий номер и идемпотентный.                             |
| `backend/src/auth/`, `backend/src/common/guards/`                                                | Auth: JWT-логика, ревокация, rate-limit. Ошибка → дыра в безопасности или массовый logout.                                                                                        |
| `shared/api/createServices.ts`, `shared/types/index.ts`                                          | Любая правка одновременно бьёт по mobile и web.                                                                                                                                   |
| `mobile/app.json`                                                                                | Bundle ID, version, buildNumber, plugins, infoPlist. После правки нужен `expo prebuild --clean` + `pod install` + новый buildNumber для TestFlight.                               |
| `mobile/modules/autexa-liquid-glass/expo-module.config.json`                                     | Регистрирует Expo Modules. Сломанный JSON → автолинкинг не находит модули → краш на старте.                                                                                       |
| `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlass.podspec`                               | CocoaPods spec. Ошибка → `pod install` падает.                                                                                                                                    |
| `mobile/ios/Podfile`, `mobile/ios/Podfile.lock`, `mobile/ios/Podfile.properties.json`            | Регенерируются prebuild'ом, но `Podfile.properties.json` хранит флаги (`newArchEnabled`, `expo.jsEngine`, `apple.privacyManifestAggregationEnabled`) — менять только сознательно. |
| `mobile/ios/Autexa.xcodeproj/`, `mobile/ios/Autexa.xcworkspace/`, `mobile/ios/Autexa/Info.plist` | Регенерируются prebuild'ом из `app.json`. Ручные правки потеряются. Signing settings (Team, Provisioning Profile) — задаются в Xcode UI, в файлы не коммитятся.                   |
| `mobile/plugins/withDisableUserScriptSandboxing.js`                                              | Config plugin, патчит build settings Xcode при prebuild. Сломаешь — не соберётся.                                                                                                 |
| `mobile/eas.json` (`submit.production`)                                                          | Apple ID, ASC App ID, Team ID — данные владельца, не наши.                                                                                                                        |
| `docker-compose.yml`, `webhook/`                                                                 | Прод-инфраструктура. Перезапуск ломает деплой.                                                                                                                                    |
| `.env.example`                                                                                   | Шаблон, не секреты. Реальные `.env*` — на сервере, локально, не в git.                                                                                                            |
| `scripts/build-apk.sh`, `scripts/deploy-vds.sh`, `deploy.sh`, `backup.sh`, `restore.sh`          | Прямой доступ к проду / EAS. Менять с осторожностью.                                                                                                                              |

## M. Глоссарий

Термины, которые реально встречаются в коде и UI:

- **Касса** — экран создания заказ-наряда / чека (`CheckCreateScreen` / `CheckCreatePage`). Центральный таб iOS, `isKassa: true` в `TabBarShared.ts`. Backend — `checks/`.
- **Заказ-наряд** — то же что чек в продуктовой терминологии. Хранится в таблице `checks`.
- **Чек** — строки услуг + товаров + клиент + авто + оплата. Типы — `Check`, `CheckServiceLine`, `CheckProductLine` в `shared/types/index.ts`.
- **Розничный чек** — отдельный поток в web (`RetailChecksPage.tsx`).
- **Журнал** — список чеков (`ChecksScreen` / `ChecksPage`). Лейбл четвёртого таба iOS.
- **Склад** — товары + остатки + категории. Backend `products/` + `warehouse/`. Лейбл второго таба iOS — «Склад» (UI-имя, в коде — `Products`).
- **Расписание / График** — смены и плановая загрузка мастеров. Backend `schedule/` + `shifts/`. **Владельцы (owner / superadmin) в графике не отображаются** — это требование продукта.
- **Госномер / плашка** — российский номер формата `1 буква + 3 цифры + 2 буквы | регион 2-3 цифры`. Логика валидации — `mobile/src/utils/plateMask.ts` (тесты в `__tests__/plateMask.test.ts`). Только кириллица из `АВЕКМНОРСТУХ`, latin-аналоги (A→А, B→В…) автоконвертируются. Регион хранится отдельно от основной части и **не дублируется** в ней. Компоненты: `RussianPlateInput.tsx`, `PlateModeSwitcher.tsx`.
- **Мастер** — `User` с ролью `master`, выполняет работы в чеке.
- **Директор** — `User` с ролью `director`, видит финансы своего тенанта.
- **Владелец / superadmin** — глобальная роль, обходит все feature gates (`FeatureGate.tsx`: `if (user?.role === 'superadmin') return <>{children}</>;`). Backend — `roles.guard.ts` + `@Roles(...)`.
- **Тенант (`tenants`)** — изолированная организация-автосервис. Каждый запрос привязан к `tenantID` из JWT.
- **Тариф / план (`plans`)** — набор разрешённых фич у тенанта. UI — `SubscriptionScreen` / `TariffPage`. `FeatureGate` блокирует экран, если ключ фичи не входит в `currentPlan.features`.
- **Имущество (equipment)** — оборудование автосервиса. Backend `equipment/`, миграции `016_equipment.sql` + `017_equipment_v2.sql`.
- **Маркетинг / отзывы** — backend `marketing/`, миграции `007_marketing_reviews.sql` + `008_messaging_provider_types.sql`. Публичная страница отзыва — `ReviewPublicPage.tsx`.
- **Касса по дням / cash flow** — экран движения денег (`CashFlowPage` / `CashFlowScreen`). Источник — backend `reports/`.
- **Liquid Glass** — визуальный материал iOS 26 (`UIGlassEffect`), на iOS 13–25 деградирует до `UIVisualEffectView` + `systemThinMaterial`. Реализация — `mobile/modules/autexa-liquid-glass/`.
- **Floating Island Tab Bar** — нижний бар iOS, плавающий поверх контента, центральная кнопка «Касса» без подписи, активный индикатор — жидкая капля (Swift, `AutexaLiquidGlassTabBarView.swift`).

---

## Что требует уточнения у владельца

Места, которые в коде не нашли, но в шаблоне правил есть — отметить как открытые вопросы:

1. **Backend tests.** `backend/package.json` не содержит ни `jest`, ни `test`-скрипта. Если в правилах требуется «backend юнит-тесты» — их сейчас просто нет. Уточнить у владельца, нужно ли заводить.
2. **Frontend tests.** Аналогично — в `frontend/package.json` нет тестового фреймворка. Web-проверки сейчас сводятся к `typecheck + lint + build`.
3. **Android native build.** Папки `mobile/android/` в репо нет (в gitignore через Expo). Полноценная Android-проверка возможна только после `expo prebuild --platform android` + `gradlew assembleDebug` или `npm run android`. Уточнить, есть ли у владельца Android-устройство для приёмки.
4. **`mobile/eas.json` → `submit.production`** содержит плейсхолдеры (`REPLACE_WITH_YOUR_APPLE_ID@example.com`, `REPLACE_WITH_APP_STORE_CONNECT_ID`, `REPLACE_WITH_TEAM_ID`). До TestFlight / App Store эти поля заполняет владелец вручную.
5. **Redis.** В `.env.example` есть `REDIS_URL`, но статус (обязательный или опциональный для прод) проверить у владельца. По коду — fallback на in-memory blacklist для single-instance.
6. **Sentry.** `SENTRY_DSN` опционален (пустой = выключен), но `@sentry/nestjs` подключён и инициализируется в `backend/src/common/sentry.ts`. Уточнить, активен ли в проде.
