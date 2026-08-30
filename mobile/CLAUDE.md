# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Autexa

Autexa — SaaS для автосервисов. Один backend обслуживает три клиента:

- **Web frontend** (`frontend/`) — React.
- **Android app** — React Native (этот же `mobile/` проект).
- **iOS app** — React Native + Swift/UIKit/SwiftUI (этот же `mobile/` проект, iOS-приоритет).
- **Backend** (`backend/`) — NestJS + TypeScript (decorators, modules, controllers, services, DTO, guards/interceptors).

## Главное правило

**Работай так, чтобы iOS можно было активно улучшать, но при этом не ломать Android, сайт и NestJS backend.** Любая iOS-фича должна жить с существующим API без правок контрактов.

## Жёсткие границы (не трогать без явного разрешения)

1. **NestJS backend** — модули, controllers, services, DTO, database logic, auth logic, business logic. Не менять.
2. **API-контракты** — никаких новых endpoints/полей/изменений сигнатур ради iOS. Используй то, что уже есть.
3. **Production-секреты** — env, secrets, certificates, provisioning profiles, private keys. Не трогать.
4. **Android-приложение** — не ломать. Любая правка в shared-коде (`src/api/`, `src/contexts/`, бизнес-логика) проверяется на Android-совместимость.
5. **React-сайт** — не ломать. Если меняешь `shared/` (типы, API-фабрики) — это касается и frontend.

Если задача требует править backend/API — **остановись и спроси**, не делай молча.

## iOS-приоритет

iOS можно и нужно активно улучшать. Можно использовать:

- React Native + Reanimated/Gesture Handler;
- **Swift / UIKit / SwiftUI** через native modules;
- **local Expo Modules** (как `modules/autexa-liquid-glass/`);
- любые iOS-only API.

Где RN не даёт нужного визуального качества, плавности или нативности — **уходи в Swift/native**.

### Цель визуала

- ощущение качественного современного iPhone-продукта;
- Apple Human Interface Guidelines;
- iOS 26 / Liquid Glass-inspired стилистика там, где уместно;
- Safe Area, Dynamic Island, Home Indicator учтены везде;
- плавные native-анимации;
- haptics там, где улучшает UX (`expo-haptics` или native);
- скорость: кеш, prefetch, виртуализация списков, устранение лишних ререндеров.

### Приоритетные iOS-зоны

- касса / заказ-наряд;
- правильный российский и иностранный госномер;
- выбранный клиент/авто;
- нижний Swift-native Liquid Glass tab bar;
- расписание / график;
- склад;
- звонки;
- журнал;
- клиенты;
- товары;
- услуги;
- единая iOS visual system.

## Правила по госномеру (RU plate)

Структура российского номера в UI: **основная часть** = 1 буква + 3 цифры + 2 буквы; **регион** — отдельный блок справа, через разделитель.

- Правильно: `Х 807 КС | 198`
- Неправильно: `Х 807 КС 198 | 198` (регион не должен дублироваться в основной части).
- Регион, `RUS` и флаг должны помещаться без обрезаний на любых iPhone.
- Когда клиент **выбран**: поиск по номеру скрывается, на его месте — карточка клиента/авто. Под номером авто отображается крупно/красиво.
- Кнопка `X` очищает выбор и возвращает поле поиска.

Соответствующая логика: `src/utils/plateMask.ts` (есть тесты в `src/utils/__tests__/plateMask.test.ts` — поддерживай зелёными), `src/components/RussianPlateInput.tsx`, `src/components/PlateModeSwitcher.tsx`.

## Правило клавиатуры

Любая форма с `TextInput` — только через `src/components/KeyboardAware.tsx`
(`KeyboardAwareView` для нескроллящихся контейнеров/шторок, `KeyboardAwareScroll`
для форм со скроллом). Raw `KeyboardAvoidingView` из `'react-native'` и
`automaticallyAdjustKeyboardInsets` **запрещены к новому использованию**: на iOS
без offset они «уносят» поле вверх, на Android — no-op (миграция завершена
2026-08-30, не откатывать).

## Правила по нижнему tab bar

- Swift-native / UIKit / SwiftUI bar (а не RN-only).
- Стиль: iOS premium, Liquid Glass-inspired, по качеству анимаций уровня Telegram.
- **Плавающий островок поверх контента** (контент скроллится под стеклом). В `AppNavigator.tsx` это уже задано: `tabBarStyle.position: 'absolute'`, transparent. Не убирай.
- Центральная кнопка «Касса» — большая, **без подписи**.
- Активный индикатор — в стиле жидкой капли (liquid droplet). Никаких точек, чёрточек, Android-style ripple.
- Bottom Safe Area + Home Indicator учтены.

Файлы: `src/navigation/TabBar.ios.tsx` (iOS), `src/navigation/TabBar.android.tsx` (Android — отдельная реализация, не уродуй её ради iOS), `src/navigation/KassaButton.tsx`, `modules/autexa-liquid-glass/`.

## Правила по расписанию

- Если RN-реализация дёргается на iPhone — вынеси график или его ключевые части в Swift/UIKit/SwiftUI native module.
- График должен скроллиться плавно (60/120 fps).
- **Владельцы (owners) НЕ отображаются в графике.**
- Дизайн — современный, iOS-style.
- Качественные loading / empty / error states.

Файл: `src/screens/ScheduleScreen.tsx`.

## Документация решений

Все важные iOS-решения (архитектурные, визуальные, отказ от RN в пользу native, новые модули) — фиксируй в `docs/ios-redesign/`. Папка живёт в корне репо `zr-auto-pro/docs/ios-redesign/`. Один файл на решение, дата в имени, кратко: проблема → выбранный путь → последствия.

## Поведение в работе

- **Никаких handoff'ов** другому разработчику. Работаешь автономно до результата.
- **Косметика ≠ задача выполнена.** Если визуал поправлен, но плата всё ещё рендерится с дублирующимся регионом — задача не закрыта.
- **Проверки обязательны.** Не утверждай «готово», если ничего не запускал.
- Если команда упала — **разберись в причине и запусти повторно**, не игнорируй и не комментируй проверку.

## Repo layout

`mobile/` — один из workspace'ов монорепы `zr-auto-pro`: `backend/`, `frontend/`, `mobile/`, `shared/`. Backend — `https://autexa.pw/api` (зашит в `app.json` → `extra.apiUrl`).

Кросс-workspace связи (легко проглядеть):

- `metro.config.js` добавляет `../shared` в `watchFolders`. Импорты вида `../../../shared/api/createServices` резолвятся в исходники монорепы.
- `tsconfig.json` алиасит `@shared/*` → `../shared/*`.
- API-контракты (request/response типы, `createXxxApi` фабрики) — в `shared/api/createServices.ts` и `shared/types/`. Mobile и frontend оба их потребляют — изменение сигнатуры фабрики затронет веб.
- `src/api/services.ts` инстанциирует shared-фабрики mobile-овым axios; платформо-специфичный код (загрузка файла через `FormData`) — только тут.

## Common commands

```bash
# dev loop
npm start                 # Metro bundler
npm run ios               # build + run на iOS-симуляторе
npm run android           # build + run на Android-эмуляторе
npm run start:dev         # Metro для установленного dev client

# quality
npm run typecheck         # tsc --noEmit (strict)
npm run lint              # eslint src/**/*.{ts,tsx}
npm run lint:fix

# tests — jest + ts-jest установлены, npm-скрипта `test` нет.
# Запускай напрямую:
npx jest                                       # все тесты
npx jest src/utils/__tests__/plateMask         # один файл (plate mask — обязательны зелёные)

# native iOS rebuild (когда менялись native deps / app.json / plugins)
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..

# release builds (EAS)
npm run build:preview-ios       # internal distribution
npm run build:production-ios    # App Store / TestFlight
```

`IOS_DEPLOY.md` — полный TestFlight/App Store walkthrough. Сверяться перед изменениями signing / bundle ID / `eas.json`.

## Чек-лист проверок после крупных изменений

Запускай по порядку. Падает шаг — чини причину и повторяй.

```bash
git status                          # понимай что трогалось
npm run typecheck                   # строгий TS
npm run lint
npx jest                            # все тесты
npx jest src/utils/__tests__/plateMask   # plate mask — отдельным фокусом
```

Если менялся **native iOS** (Swift, podspec, app.json plugins, native modules):

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
# затем сборка через Xcode (Autexa.xcworkspace) или:
xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa -configuration Debug -sdk iphonesimulator build
```

Если менялся **shared-код** (`shared/*`, `src/api/`, `src/contexts/`, бизнес-логика):

```bash
# проверь Android-совместимость
npm run android
# и не сломал ли веб
cd ../frontend && npm run typecheck && npm run lint
```

Не утверждай, что задача выполнена, без зелёного чек-листа.

## Architecture (части, которые тянутся через несколько файлов)

### Auth + navigation gating

`App.tsx` → `AuthProvider` → `AppNavigator`. Корневой стек переключается между `Login` и `Main` по `useAuth().user`. Аутентифицированное дерево — bottom-tab navigator (`Dashboard`, `Products`, `NewCheck`, `Checks`, `MoreTab`); деталки лежат во вложенных native-стеках (`MoreStack`, `ChecksStack`), чтобы push сохранял tab bar — это сознательно, как Apple Mail.

`CheckCreate`, `ClientDetail`, `SupplierDetail` пушатся на **корневой** стек — они должны перекрывать tab bar. Тоже сознательно.

### Subscription-based feature gates

`src/navigation/AppNavigator.tsx` оборачивает экраны `MoreStack` через `gated('feature_key', ScreenComponent)`. `FeatureGate` читает `subscriptionApi.get()` через React Query и показывает paywall, если фича не входит в план тенанта. `superadmin` обходит. Новый закрытый экран = (1) запись в `FEATURE_GATES` в `AppNavigator.tsx` + (2) ключ фичи в backend-описании плана.

### TanStack Query + persistent cache

`App.tsx`:

- `staleTime: 2min`, `gcTime: 30min`;
- `placeholderData: prev => prev` — глобальный stale-while-revalidate. **Не отключай** случайно — это главная причина «мгновенного» ощущения при пагинации/фильтрах.

`src/utils/persistentCache.ts` зеркалит whitelist query-ключей в AsyncStorage. `hydrateCache` блокирует первый рендер (~50мс) до прогрева, `attachPersistence` пишет на каждом успехе. Чтобы новый экран был мгновенный на cold-start, добавь префикс ключа в `PERSISTED_KEYS`. Не добавляй user-volatile ключи (search-debounced списки) — это кеш статики.

`AuthContext.prefetchAfterLogin` греет тяжёлые reference-запросы (products, services, users, warehouse categories) сразу после логина.

### Платформо-зависимый tab bar

`src/navigation/TabBar.tsx` — TS-stub. Metro подменит на `TabBar.ios.tsx` или `TabBar.android.tsx` при бандлинге. iOS-вариант использует Liquid Glass module; меняешь структуру табов — синхронно правь оба файла, иначе Android рассинхронится.

### Local Expo module: autexa-liquid-glass

`modules/autexa-liquid-glass/` — **local Expo Module** (не config plugin), линкуется через `package.json` как `"file:./modules/autexa-liquid-glass"`. Оборачивает `UIVisualEffectView` и автоматически апгрейдится до iOS 26 `UIGlassEffect` через runtime class lookup. Переживает `expo prebuild --clean` потому что native-файлы лежат в `node_modules` (через symlinked `file:` dep) и автолинкуются через `expo-module.config.json`. JS-обёртка fallback-ит на `expo-blur`, на Android — translucent View. Подробности — `modules/autexa-liquid-glass/README.md`.

### Статус iOS native проекта

**`mobile/ios/` не коммитится** (внесён в `mobile/.gitignore` рядом с `android/`); он регенерируется через `npx expo prebuild --platform ios --clean` из `app.json` + plugins. Native iOS-код живёт в `mobile/modules/*/ios/` и подключается через Expo autolinking при каждом prebuild — закоммиченный Xcode-проект ему не нужен. **Не правь файлы в `ios/` руками** — они регенерируются. Меняй `app.json` (e.g. `infoPlist`, plugins) и пересобирай.

`plugins/withDisableUserScriptSandboxing.js` — config plugin, применяется при prebuild и патчит build settings Xcode. Трогать аккуратно.

### Auth-expiry contract

`src/api/axios.ts` — 401-перехватчик чистит AsyncStorage и зовёт `onAuthExpired` listeners. `AuthContext` подписан и принудительно делает logout. **Не дублируй** 401-логику по экранам — пусть единственный источник истины.

### Theme

`src/theme/index.ts` зеркалит Tailwind-палитру веба. Держи в синхроне с `frontend/` tailwind config — это один продукт.

## Conventions

- TypeScript strict. Не отключай локально — чини тип.
- Русский — продуктовый язык. UI-строки, ошибки, контекстные комментарии — на русском. Не переводи их.
- Bundle ID `com.autexa.mobile` зашит во многих местах (`app.json`, `eas.json`, native project). Не переименовывай мимоходом.
- `version` (semver) видна юзерам, `ios.buildNumber` строго возрастает на каждый TestFlight-аплоад (`autoIncrement: true` уже в EAS preview/production).
- Hermes + New Architecture (Fabric/TurboModules) включены. Native-модули должны быть совместимы с New Arch.

## Когда задача выходит за границы mobile/

Правка `shared/api/createServices.ts` или `shared/types/index.ts` бьёт и по `frontend/`, и по `mobile/`. Прогони typecheck в обоих (`cd frontend && npm run typecheck`, `cd mobile && npm run typecheck`) **до того как** заявишь готовность.
