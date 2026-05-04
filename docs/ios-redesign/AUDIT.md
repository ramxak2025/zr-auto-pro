# Autexa iOS — Полный аудит проекта

Дата: 2026-05-04
Ветка: `claude/fix-auteksa-freezing-zuMJS`
Команда: senior RN/iOS engineer + mobile architect + perf engineer + QA + product designer

## Стек

| Слой | Технология |
|------|------------|
| Платформа | Expo SDK 54 (managed bare через `prebuild`) |
| Языки | TypeScript 5, React 19, React Native 0.81 |
| Навигация | `@react-navigation/native` v7 + native-stack + bottom-tabs |
| Состояние сервера | `@tanstack/react-query` v5, staleTime 30s |
| Состояние клиента | React Context (Auth) + locals |
| Хранилище | `@react-native-async-storage/async-storage` |
| Списки | `@shopify/flash-list` v2 (используется только в `ProductsScreen`) |
| Анимации | `react-native-reanimated` v4 + worklets |
| Безопасные зоны | `react-native-safe-area-context` |
| Glass / Blur | `expo-blur` (BlurView) |
| Иконки | `@expo/vector-icons/Ionicons` + кастомный platform `Icon` |
| Шрифты | `expo-font` |
| Хаптика | `expo-haptics` |
| Изображения | `expo-image` (CachedImage обёртка) |

## Структура `mobile/src`

```
api/         axios.ts (interceptors + auth) + services.ts (24 модуля API)
components/  21 переиспользуемых (Button, Card, BottomSheet, Skeleton, RussianPlateInput, …)
contexts/    AuthContext (token + user + permissions)
navigation/  AppNavigator + TabBar.ios + TabBar.android + KassaButton + TabBarShared
platform/    Icon, Typography, PressableScale, motion, shadow, haptics, hairline
screens/     29 экранов (Login, Dashboard, Products, Cars, Checks, …)
theme/       index.ts (colors, spacing, fontSize, fontWeight, borderRadius)
utils/       plateMask.ts, haptics.ts (+ __tests__)
```

## Навигация

**RootStack** (native-stack):
- `Login` → когда `!user`
- `Main` (TabNavigator) — иначе
- `CheckCreate` — modal-стиль `slide_from_bottom`
- `CheckDetail`, `ClientDetail`, `SupplierDetail` — push

**TabNavigator** (5 табов) с кастомным `tabBar` (Metro выбирает `.ios.tsx` / `.android.tsx`):
- Главная — `DashboardScreen`
- Склад — `ProductsScreen`
- 🪙 Касса — `CheckCreateScreen` (центральная плавающая кнопка `KassaButton`)
- Журнал — `ChecksScreen`
- Ещё — `MoreStackNavigator` (вложенный stack из 19 экранов с feature gates)

## UI / Safe Area — текущее состояние

| Экран | `edges` | paddingBottom для floating tabBar |
|-------|---------|-----------------------------------|
| DashboardScreen | `['top']` | ⚠ нет явного отступа (полагается на ScrollView contentContainerStyle) |
| ProductsScreen | `['top']` | ✅ FlashList contentContainer |
| CheckCreateScreen | `['top']` | ⚠ `paddingBottom: spacing[12]` (48px) — мало для floating bar |
| ScheduleScreen | `['top']` | ⚠ tabs выше, скроллы внутри без bottom inset |
| ChecksScreen | `['top']` | ⚠ list paddingBottom: spacing[8] (32px) — мало |
| MoreScreen, и т. д. | `['top']` | разнобой |

iOS-floating tabBar (TabBar.ios.tsx) занимает: `60 + 8 (paddingTop) + max(insets.bottom, 12)` ≈ 95–100 pt над контентом. Все ScrollView/FlatList должны иметь `paddingBottom` ≥ 110pt чтобы последний элемент не скрывался под таб-баром.

## Найденные UI/UX-проблемы

### 1. Нижнее меню (TabBar.ios.tsx)
- Floating pill 60pt с BlurView `systemThinMaterialLight` + LinearGradient в `KassaButton` — **уже хорошо**, но:
  - Контраст `borderColor: rgba(255,255,255,0.55)` на светлом фоне теряется
  - Нет inset shadow / subtle glow
  - `intensity={85}` — на iOS 17+ можно поднять до 100 для более стеклянного эффекта
  - Нет explicit dark-mode реакции (есть только `systemThinMaterialLight`)
- KassaButton — отлично анимирован, но имеет `marginTop: -28` что заставляет его «вылезать» вверх над pill — на iPhone X-стайл девайсах с очень малым `inset.bottom` (как в landscape) может конфликтовать с safe area

### 2. Ложный «0 товаров»
- `ProductsScreen.tsx:702` — header badge `<Text>{warehouseStats.count} товаров</Text>`. Когда query грузится впервые (нет кеша) — `data === undefined` → `allProducts = []` → `warehouseStats.count = 0` → пользователь видит «0 товаров» рядом с заголовком, а ниже крутится `<ListSkeleton count={8} />`.
- Нет персистентного кеша TanStack Query — после холодного старта приложение всегда проходит через `0 товаров → реальное число`.

### 3. Маска госномера и поиск клиента
- `RussianPlateInput.tsx` уже хорошо разделяет main (`А 123 АА`) и region (`77 + флаг`) в визуально отдельные блоки. **Дубля региона в визуальной части нет.** Однако:
  - Авто-детект режима RU/INT через `isRussianInput(value)` ломается при первом символе: если пользователь вводит `1` или иную цифру — `isRussianInput` вернёт `false` → переключится на foreign-mode → если потом он введёт `Р332РА05`, foreign-mode уже залип и буквы не нормализуются
  - Нет явного UI-переключателя между RU и INT
  - Поиск в backend идёт сырым `plateSearch` (`clientsApi.getAll({ search: plateSearch })`) — если пользователь напечатал `P332PA05` (латиница) или `р 332 ра 05` (с пробелами / нижним регистром) — сервер их не нормализует и не найдёт клиента у которого в базе сохранено `Р332РА05`
- В CheckCreateScreen — placeholder `"А 000 АА"` для main — ок, но региона нет и не показывается, что регион вводится в правом блоке

### 4. Иностранные номера
- В foreign-mode (определяемом по `!isRussianInput(value)`) input просто становится `<TextInput maxLength=20>` с `autoCapitalize="characters"`
- Backend поиск `clientsApi.getAll({ search })` тоже работает, но проблема в том что **переключиться обратно в RU режим невозможно** не очистив поле. Пользователю не очевидно что произошло переключение
- Латинские буквы в foreign не валидируются (норма), но и нормализация в RU не делается

### 5. Расписание (ScheduleScreen)
- 89K строк, 4 таба (grid, today, shifts, rating, settings)
- Использует `SafeAreaView edges=['top']` — норм
- Внутри `GridTab` есть кастомный `ScrollView` с горизонтальной и вертикальной синхронизацией — на iOS jest scroll bouncing может вызывать рассинхрон
- Нет явного `paddingBottom: tabBarHeight` в табах → последний день / последняя строка перекрывается под floating bar
- Нет skeleton для grid — `<LoadingSpinner />` на весь экран при загрузке
- Pendings overlay (`pendingChanges`) показывает temp-записи до синхронизации — это норма

### 6. Performance
- TanStack Query staleTime 30s — мало для warehouse (он редко меняется). Прайс-листы и каталоги услуг — staleTime должен быть 5-10 минут
- Нет `gcTime` (бывш. cacheTime) override — defaults 5 минут — данные выбрасываются сразу после unmount компонента
- Нет persistent cache (AsyncStorage) — каждый холодный старт = пустой UI
- Нет prefetch ключевых данных после логина — Dashboard, Products, Clients, Services грузятся только при заходе пользователя на экран
- ProductsScreen использует FlashList ✅
- ChecksScreen использует обычный FlatList — на больших списках чеков может быть janky
- ScheduleScreen GridTab ре-рендерит весь grid на каждом изменении — есть `memo(GridDayRow)` ✅, но `entryMap` пересчитывается без shallow check

### 7. Архитектурные риски
- Нет общего `<ScreenContainer>` обёртки → каждый экран вручную задаёт SafeAreaView, header, paddingBottom
- API URL `https://autexa.pw/api` зашит через `extra.apiUrl` в app.json — для devbuild может потребоваться LAN-IP, есть fallback но трудно переключаться
- Backend контракты на `clients/getAll({ search })` — поиск делается сервером по ILIKE/regex, нужно проверить что строка нормализуется перед отправкой

## Что уже хорошо

- TanStack Query + axios interceptors + AsyncStorage token — добротная инфраструктура
- Отдельные TabBar.ios / TabBar.android — правильное разделение
- BlurView + Liquid Glass-style KassaButton с реанимациями — премиальная база, нужно докрутить
- platform/Icon, platform/Typography, platform/shadow — есть design-system primitives
- RussianPlateInput с реальной плашкой (с разделителем + флагом + RUS) — почти как настоящий гос-знак

## Ключевые файлы для правок

| Цель | Файл |
|------|------|
| Маска и нормализация номеров | `mobile/src/utils/plateMask.ts` |
| Plate input + RU/INT toggle | `mobile/src/components/RussianPlateInput.tsx` + новый `PlateModeSwitcher.tsx` |
| Персистентный кеш | новый `mobile/src/utils/persistentCache.ts` |
| Hydration кеша на старте | `mobile/App.tsx` |
| Prefetch после логина | `mobile/src/contexts/AuthContext.tsx` |
| Premium tab bar | `mobile/src/navigation/TabBar.ios.tsx` |
| useTabBarHeight() | новый `mobile/src/hooks/useTabBarHeight.ts` |
| Ложный «0 товаров» | `mobile/src/screens/ProductsScreen.tsx` (header badge) |
| Расписание iOS-фиксы | `mobile/src/screens/ScheduleScreen.tsx` |
| Чек: plate switcher + нормализация | `mobile/src/screens/CheckCreateScreen.tsx` |

## Решения, принятые автономно

1. **Не добавляем `@tanstack/query-async-storage-persister`** — пишем свой минимальный hydrate через AsyncStorage. Это меньше зависимостей и проще fix-up.
2. **Не трогаем backend** — нормализация номеров перед отправкой делается на клиенте.
3. **Tab bar остаётся floating pill** — соответствует «iOS 26 / Liquid Glass» духу. Усиливаем blur + glow + active-indicator.
4. **PlateModeSwitcher** — отдельный segmented control над input. Контроллируется родительским экраном.
5. **Foreign-mode** = свободный текст с `autoCapitalize="characters"`, без cyrillic нормализации, но с trim+upper перед отправкой на сервер.
