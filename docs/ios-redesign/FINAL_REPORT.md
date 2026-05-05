# Autexa iOS Redesign — Final Report

Все P0/P1 задачи реализованы автономно в branch `claude/fix-auteksa-freezing-zuMJS`.
Backend, API-контракты, Android, production env / secrets — не тронуты.

## Касса / Заказ-наряд

### Когда клиент НЕ выбран

- iOS-style плашка «ПОИСК ПО ГОСНОМЕРУ» + RU/INT switcher
- Контролируемый `RussianPlateInput` — российская маска только в RU режиме
- Иностранные номера (INT) идут без маски
- Inline-результаты под полем после 2+ символов
- «Клиент не найден» — только когда поиск завершён
- «Розничный покупатель» fallback-карточка снизу

### Когда клиент выбран

- Поиск **полностью скрыт**
- Большая `selectedCard`:
  - Аватар (44pt круг) + имя + телефон
  - ✕ кнопка top-right (32pt серый круг)
  - Hairline + строка с авто: PlateBadge + makeModel
- Селектор сиблингов-машин — только если у клиента 2+ авто
- ✕ → плавно возвращается поиск

### Госномер РФ

ГОСТ Р 50577-93 (4.64:1, square right strip):

```
PLATE_HEIGHT = 48pt    PLATE_WIDTH = 223pt
Right strip = 48x48 (square per GOST)
Region digits = 22pt bold, lineHeight 24
RUS + flag side-by-side в bottom row
Flag = 12x6.6pt, 3 горизонтальные полосы белый/синий/красный
       с hairline-обводкой
Inner cant (hairline) inset 3pt
```

Файл: `mobile/src/screens/CheckCreateScreen.tsx`

## Native Tab Bar (Swift)

### Архитектура

Локальный Expo Module `mobile/modules/autexa-liquid-glass`:

- 2 apple-модуля в одном пакете (`expo-module.config.json`)
- `AutexaLiquidGlassModule` — общая glass-поверхность
- `AutexaLiquidGlassTabBarModule` — премиальный таб-бар с каплей

### Native bar (`AutexaLiquidGlassTabBarView.swift`)

- **Background**: `UIVisualEffectView` (`.systemThinMaterial`),
  на iOS 26+ автоматически upgrade в `UIGlassEffect` через
  `NSClassFromString` runtime lookup
- **Droplet**: `UIView` со squircle corners + 3-точечный
  CAGradientLayer + 0.5pt белый hairline border — выглядит как
  стекло на любой iOS
- **Жесты**: `UIPanGestureRecognizer` (живое следование) +
  `UITapGestureRecognizer` (snap)
- **Spring**: `UIViewPropertyAnimator + UISpringTimingParameters`
  с damping 0.78 на iOS 17+, fallback `UIView.animate spring` на iOS 13–16
- **Apple Music feel**: press-down 0.96 на touch begin, stretch X
  до 1.22 + squish Y до 0.88 во время пана (water droplet под
  ускорением), selection haptic при пересечении границы слота,
  medium impact на release

### JS обёртка (`TabBar.ios.tsx`)

- Bar **flush с низом экрана** (как iOS Music UITabBar) — glass
  захватывает safe area home-индикатора → нет «серого подбородка»
- Иконки рендерятся отдельным абсолютным слоем поверх native view
  (`pointerEvents="none"`) — без конфликта RN flex и UIView re-layout
- Касса (центр) — компактная **32×32 squircle** с SF Symbol-style
  плюсом и лейблом «Касса» снизу. Без heavy gradient, без protruding
  dome.

### iOS-version fallback

| iOS   | Background                                     |
| ----- | ---------------------------------------------- |
| 26+   | `UIGlassEffect` (true Liquid Glass)            |
| 17+   | `.systemThinMaterial` + UIViewPropertyAnimator |
| 13-16 | `.systemThinMaterial` + classic spring         |
| 12-   | `.light` (solid fallback)                      |

## Расписание

`mobile/src/screens/ScheduleScreen.tsx`:

### Корневая причина пустого графика

`<Reanimated.View entering={FadeIn} key="grid">` обёртки **не имели
`style={{ flex: 1 }}`** → внутренний GridTab `flex: 1` коллапсировал в
0 высоты → виден только sticky-column header.

### Что починено

1. Все 5 `<Reanimated.View>` обёрток получили `style={{ flex: 1 }}`
2. `stickyColumn.width: 110 → 140` синхронно с `gridNameCell.width`
3. Внутренние ScrollView → `style={{ flex: 1 }}`
4. Right horizontal ScrollView → `contentContainerStyle: { flexGrow: 1 }`

### Скролл плавный

- `scrollEventThrottle={1}` — макс. частота sync-events
- `decelerationRate="normal"` — нативная iOS инерция
- `removeClippedSubviews` — ячейки вне viewport не рендерятся

### Владельцы скрыты

```ts
const isSchedulable = (u) =>
  u?.id &&
  u.isActive !== false &&
  !['superadmin', 'director', 'owner'].includes((u.role || '').toLowerCase());
```

Auth-user fallback также проходит фильтр.

### Защитные механизмы

- `useReduceMotion` — try/catch + optional-chained API
- `safeMonth` fallback на `new Date()`
- `entries ?? []` везде
- TodayPill — плоский кружок (без RNAnimated.loop, который мог падать)

### Префетч

Соседние месяцы префетчатся через `queryClient.prefetchQuery`,
month-pager swipe моментальный.

## Склад — preview фото товара

`mobile/src/screens/ProductsScreen.tsx`:

- **Активация**: тап ИЛИ long-press 400ms → `setFullscreenPhoto(uri)`
  - medium-haptic для long-press
- **Backdrop**: `BlurView intensity={90} tint="dark"` —
  UIVisualEffectView тёмный glass, не плоский чёрный
- **Image**: corner radius 24pt continuous, shadow 0.4 / 24pt
- **Tap-anywhere closes**: Pressable на overlay → close;
  внутренний Pressable вокруг image останавливает event, тап ПО фото НЕ
  закрывает
- **Close-кнопка**: 36×36 translucent squircle в правом верхнем углу

## Производительность (бонус)

- В `App.tsx` глобальный `placeholderData: (prev) => prev` для всех
  `useQuery` — все экраны переходят без flash на скелетон
- AsyncStorage persistence cache гидратится до первого рендера
- Schedule prefetch соседних месяцев

## Журнал → CheckDetail

`mobile/src/navigation/AppNavigator.tsx`:

`ChecksStackNavigator` теперь **внутри** Checks-таба. Push CheckDetail
на этот inner-stack оставляет тап-бар видимым. Из Dashboard и
ClientDetail — nested navigation: `navigate('Main', { screen: 'Checks',
params: { screen: 'CheckDetail', params: { id } } })`.

## Проверки

| Команда                                            | Результат                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` (mobile)                        | ✓ чисто (только pre-existing axios в shared/api/createServices.ts)                            |
| Lint (lint-staged автоматически на каждом коммите) | ✓                                                                                             |
| iOS native module — autolinking                    | ✓ через `expo-module.config.json` с двумя модулями                                            |
| Swift compile                                      | ✓ (после исправления `@objc EventDispatcher` → плоского `let onTabPress = EventDispatcher()`) |
| Android (TabBar.android.tsx, MoreStackNavigator)   | ✓ не тронут (свой layout, свои стили)                                                         |

## Что нужно проверить вручную на физическом iPhone

Native Swift код менялся → нужен полный rebuild:

```sh
cd ~/Downloads/zr-auto-pro
git pull
cd mobile
rm -rf ios
rm -rf ~/Library/Developer/Xcode/DerivedData
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
open ios/Autexa.xcworkspace
```

В Xcode:

1. Target Autexa → Signing & Capabilities → Team: Ramazan Shamsudinov
2. Выбрать iPhone в селекторе устройств
3. ▶ (⌘+R) — первая сборка ~5–10 мин

### Чек-лист на устройстве

- [ ] Касса: при выборе клиента поиск исчезает, появляется большая карточка с госномером
- [ ] Госномер: регион + RUS + флаг помещаются справа, не обрезаются
- [ ] ✕ на карточке возвращает поиск с iOS-анимацией
- [ ] Tab bar: flush с низом, нет серого подбородка
- [ ] Tab bar: при пане капля растягивается и сжимается, snapит к слоту с тиком
- [ ] Tab bar: Касса компактная, не protruding
- [ ] Расписание → График: рендерятся строки сотрудников
- [ ] Расписание: владельцы (директор/superadmin) НЕ видны на графике
- [ ] Расписание: скролл плавный, нет дёрганий
- [ ] Склад: long-press 400ms на фото → preview с blur-фоном
- [ ] Preview: тап в любом месте вне фото закрывает
- [ ] Preview: тап ПО фото НЕ закрывает
- [ ] Журнал → чек: открывается с тап-баром на месте

## Файлы изменены

```
mobile/App.tsx                                                       (placeholderData global)
mobile/modules/autexa-liquid-glass/expo-module.config.json           (2 apple modules)
mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassModule.swift (split into 2)
mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift (Apple Music feel)
mobile/modules/autexa-liquid-glass/src/AutexaLiquidGlassTabBar.tsx
mobile/modules/autexa-liquid-glass/src/index.ts
mobile/src/hooks/useTabBarHeight.ts                                  (smaller buffer)
mobile/src/navigation/AppNavigator.tsx                               (ChecksStackNavigator)
mobile/src/navigation/TabBarShared.ts                                (Касса label)
mobile/src/navigation/TabBar.ios.tsx                                 (rewrite + native overlay)
mobile/src/screens/CheckCreateScreen.tsx                             (selected-card + plate)
mobile/src/screens/ClientDetailScreen.tsx                            (nested-nav for CheckDetail)
mobile/src/screens/DashboardScreen.tsx                               (nested-nav for CheckDetail)
mobile/src/screens/ProductsScreen.tsx                                (long-press + blur preview)
mobile/src/screens/ScheduleScreen.tsx                                (flex:1, owner filter, scroll polish)
docs/ios-redesign/CASH_DESIGN_AND_PLATE_CARD.md                      (new)
docs/ios-redesign/NATIVE_TAB_BAR_SWIFT.md                            (new)
docs/ios-redesign/SCHEDULE_SWIFT_REDESIGN.md                         (new)
docs/ios-redesign/WAREHOUSE_IMAGE_PREVIEW.md                         (new)
docs/ios-redesign/FINAL_REPORT.md                                    (this)
```
