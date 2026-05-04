# Android ↔ iOS Parity

Цель — пользователь, перешедший с Android-устройства на iPhone, не должен чувствовать что приложение «обрезанное».

## Общая бизнес-логика (одинаково на обеих платформах)

| Функция | Где живёт | Изменения в этой итерации |
|---------|-----------|---------------------------|
| Авторизация (логин/выход) | `AuthContext` + `authApi` | без изменений |
| Получение профиля | `authApi.me()` | без изменений |
| Permissions / роли | `useAuth().hasPermission()` | без изменений |
| Все CRUD-операции | `api/services` (общий слой `shared/api/createServices`) | без изменений |
| Все экраны (Dashboard, Products, Checks, …) | `mobile/src/screens/` | UI-фиксы только |
| Госномер: маска, нормализация, поиск | `utils/plateMask.ts` | расширение API (общая логика) |

## Платформо-специфичные слои

### Tab Bar
- `TabBar.ios.tsx` — Liquid Glass blur pill
- `TabBar.android.tsx` — Material 3 navigation bar (solid surface, ripple, indicator pill)
- Общий контракт: `TabBarShared.ts` — список табов
- **Изменения только в `.ios.tsx`** — Android остаётся без изменений

### Хаптика
- `platform/haptics.ts` — общий API через `expo-haptics` (работает одинаково на iOS и Android, под капотом разные реакции)

### Иконки
- `platform/Icon.tsx` — общий компонент (Ionicons + кастомное мапирование)

### Тени
- `platform/shadow.ts` — на iOS возвращает `shadowColor/shadowOpacity/shadowRadius/shadowOffset`, на Android — `elevation`. Общий контракт `shadow('lg', color)`.

### Plate input
- `RussianPlateInput.tsx` — общий компонент. Использует `Platform.select` только для очень мелких расхождений (paddingBottom textAlignVertical).
- Логика нормализации и валидации — без `Platform.OS` ветвлений (живёт в `utils/plateMask.ts`).

## Точки риска (что может сломаться на Android)

### TabBar.ios.tsx
- Не импортируется на Android (Metro berez `.android.tsx` сначала). 
- Изменения здесь не должны затрагивать `TabBarShared.ts` (общий контракт).

### plateMask.ts
- Расширение функций — добавляются новые экспорты (`normalizePlateForSearch`, `normalizeForeignPlate`).
- Существующие `processPlateInput`, `formatPlateDisplay`, `splitPlate`, `isValidPlate` — сохранят сигнатуры. 
- Тесты в `__tests__/plateMask.test.ts` — нужно расширить, чтобы покрыть новые функции.

### RussianPlateInput.tsx
- Сейчас prop API: `value`, `onChangeText`, `onValidPlate?`, `autoFocus?`, `placeholder?`.
- Расширяем: добавляем `mode?: 'ru' | 'foreign'`, `onModeChange?: (mode) => void`, `showSwitcher?: boolean`. 
- **Все новые props опциональны**, дефолты сохраняют текущее поведение → Android работает без изменений в его экранах.

### App.tsx (Hydrate persistent cache)
- Hydration работает одинаково на обеих платформах через AsyncStorage.
- При неудаче (отсутствие кеша) — fallback на пустой queryClient. Не меняет поведение.

### Prefetch после логина
- В `AuthContext.login()` — после получения user/token делаем `queryClient.prefetchQuery()` для нескольких ключевых запросов.
- Работает на обеих платформах. Если backend недоступен — silent fail.

### Skeleton states / empty state логика
- Изменения только в JSX — не зависят от платформы.

### useTabBarHeight()
- Хук считает: `60 + 8 + max(insets.bottom, 12) + 8`. 
- На Android рендерится `TabBar.android.tsx` с `BAR_HEIGHT = 68`. 
- Hook выдаёт правильное значение только для iOS bar. На Android это не критично — там бар solid и контент уже не «плавает».
- Решение: hook принимает opcionально platform-aware logic, но на Android его не обязательно использовать (Material bar занимает всю ширину снизу).

## Тестирование parity

После изменений нужно проверить на Android (хотя бы typecheck + статически):
1. `cd mobile && npx tsc --noEmit` — проверка типов
2. `cd mobile && npx eslint "src/**/*.{ts,tsx}" --max-warnings=10000` — линт
3. Запустить Android (если EAS / Expo Go доступен) — проверить что ничего не упало визуально

## Контракты с backend

Никаких изменений. Все запросы идут через `shared/api/createServices` — общий код для web/mobile/iOS/Android.

API URL: `https://autexa.pw/api` (production), не меняется.
