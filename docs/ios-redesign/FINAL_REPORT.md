# Autexa iOS Redesign — Final Report

Branch: `claude/fix-auteksa-freezing-zuMJS`. Backend, API-контракты,
Android, production env / secrets — не тронуты.

## Честные границы автономной работы

Я работаю в Linux-окружении без доступа к macOS, Xcode, физическому
iPhone и Apple-сертификатам. Это значит:

- Я **не могу** запустить `pod install`, `expo prebuild`, симулятор,
  устройство или скриншоты.
- Я **могу** делать diff'ы, читать код, писать Swift / TS / docs,
  делать typecheck (`npx tsc --noEmit`), коммитить и пушить.
- iOS build verification и device-screenshots должны делаться
  владельцем на Mac. Полный rebuild-инструктаж — в конце документа.

Поэтому всё что описано ниже — **реализовано в коде, отправлено в
ветку**. Финальная визуальная приёмка — на iPhone после prebuild.

## Native Swift Tab Bar

### Где находится

```
mobile/modules/autexa-liquid-glass/
├── expo-module.config.json
│       — { "apple": { "modules": ["AutexaLiquidGlassModule",
│                                   "AutexaLiquidGlassTabBarModule"] } }
├── ios/
│   ├── AutexaLiquidGlassModule.swift
│   │       — два класса:
│   │           AutexaLiquidGlassModule       (общая glass-поверхность)
│   │           AutexaLiquidGlassTabBarModule (таб-бар с каплей)
│   ├── AutexaLiquidGlassView.swift           (~190 строк Swift)
│   └── AutexaLiquidGlassTabBarView.swift     (≈ 360 строк Swift)
└── src/
    └── AutexaLiquidGlassTabBar.tsx (JS bridge через
        requireNativeViewManager('AutexaLiquidGlassTabBar'))
```

### Что в `AutexaLiquidGlassTabBarView.swift`

| Подсистема         | Реализация                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------- | --- | ------------------------------------------------- |
| Glass background   | `UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))`                                                                |
| iOS 26 upgrade     | `NSClassFromString("UIGlassEffect") as NSObject.Type` → `cls.init() as UIVisualEffect` → swap `effectView.effect`                     |
| Top rim            | 1pt UIView, `rgba(1, 1, 1, 0.85)`                                                                                                     |
| Droplet            | UIView со squircle (`cornerCurve = .continuous`, `cornerRadius = 18`), `.shadowOpacity = 0.10`, `borderWidth = 0.5` белый             |
| Droplet gradient   | `CAGradientLayer` с 3 stops (0.95 / 0.70 / 0.85 alpha белого) — глубина стекла                                                        |
| Pan gesture        | `UIPanGestureRecognizer` — капля следит за пальцем 1:1, без RN bridge                                                                 |
| Tap gesture        | `UITapGestureRecognizer` — мгновенный snap к слоту                                                                                    |
| Spring (iOS 17+)   | `UIViewPropertyAnimator(timingParameters: UISpringTimingParameters(dampingRatio: 0.78))`                                              |
| Spring (iOS 13–16) | `UIView.animate(usingSpringWithDamping: 0.78, ...)`                                                                                   |
| Press-down         | `transform = CGAffineTransform(scaleX: 0.96, y: 0.96)` на `.began`                                                                    |
| Stretch + squish   | На `.changed`: `widthScale = min(1.22, 1 +                                                                                            | vx  | / 3500)`, `heightScale = max(0.88, 1 - | vx  | / 7000)` — поведение водяной капли под ускорением |
| Slot-cross haptic  | `UISelectionFeedbackGenerator.selectionChanged()` каждый раз когда центр капли пересекает границу слота — как у Music volume scrubber |
| Release haptic     | `UIImpactFeedbackGenerator(style: .medium).impactOccurred(intensity: 0.55)`                                                           |
| Event emission     | Expo `EventDispatcher` — `onTabPress(["index": index])`                                                                               |

### JS обёртка `mobile/src/navigation/TabBar.ios.tsx`

Полностью переписан под Telegram-style island:

- `BAR_HEIGHT = 60`, `HORIZONTAL_MARGIN = 14`, `BOTTOM_LIFT = 10`,
  `CORNER_RADIUS = 30` (full pill)
- `island` style: `borderRadius: 30`, `overflow: 'hidden'`,
  `borderColor: rgba(255,255,255,0.95)` hairline, soft shadow
  (`shadowColor: primary[800]`, `opacity: 0.18`, `radius: 22`,
  `offset: { 0, 10 }`)
- `outerGlow` слой за островом — мягкое голубоватое свечение для
  premium-ощущения
- `topRim` — 0.5pt белый rim вверху бара
- Иконки/лейблы/Касса рендерятся **отдельным абсолютным слоем** поверх
  native view с `pointerEvents="none"` — все тапы и pan уходят в
  Swift gesture recognizers
- Касса — компактная 32×32 squircle с filled `+` глифом и лейблом
  «Касса» снизу. **Не** giant protruding dome.

### iOS-version fallback

| iOS       | Background                                     |
| --------- | ---------------------------------------------- |
| 26+       | `UIGlassEffect` (true Apple Liquid Glass)      |
| 17+       | `.systemThinMaterial` + UIViewPropertyAnimator |
| 13–16     | `.systemThinMaterial` + classic UIView spring  |
| 12 и ниже | `.light` (UIBlurEffect) — solid fallback       |

### Активная вкладка

- Native bar держит `activeIndex` как Swift property и при изменении
  отрисовывает spring-переход капли к новому слоту.
- В JS: `<TabItem focused={...}>` рисует иконку и лейбл с цветом
  `primary[700]` для активного, `gray[500]` для неактивного,
  плюс subtle 1.06× scale spring на иконке (Reanimated).
- Точек, дополнительных линий-индикаторов нет.

### Почему это НЕ обычный RN tab bar

- Glass — это `UIVisualEffectView` (UIKit), не `expo-blur` обёртка
- Капля анимируется на main thread через CALayer / UIView properties
  (60fps без JS bridge)
- Жесты обрабатываются `UIPanGestureRecognizer` — RN gesture handler
  даже не подключён
- Spring через native `UISpringTimingParameters` — не через Reanimated
  (хотя для иконки используется Reanimated v3, что тоже native)
- Haptics напрямую через `UISelectionFeedbackGenerator` /
  `UIImpactFeedbackGenerator` — без JS round-trip

## Касса / Заказ-наряд

`mobile/src/screens/CheckCreateScreen.tsx`

### Когда клиент НЕ выбран

- iOS-style плашка «ПОИСК ПО ГОСНОМЕРУ» + RU/INT switcher
- `RussianPlateInput` — российская маска применяется только в RU
- INT режим — без маски, отдельный синий бордер
- Inline-результаты после 2+ символов
- «Клиент не найден» — только когда поиск завершён
- «Розничный покупатель» fallback-карточка снизу

### Когда клиент выбран

- Поиск **полностью скрыт**
- Большая `selectedCard`:
  - Аватар (44pt круг) + имя + телефон
  - ✕ кнопка top-right (32pt серый круг, hitSlop 12pt)
  - Hairline-разделитель
  - Госномер + makeModel + comment
- Селектор сиблингов-машин — только если у клиента 2+ авто
- ✕ → плавно возвращается поиск

### Госномер РФ — точно по референсу

```
PLATE_HEIGHT = 48pt    PLATE_WIDTH = 223pt (4.64×)
Right strip = 48×48 (square per ГОСТ)

┌──────────────────────────────┬─────────┐
│   X 807 KC                   │  198    │  ← regionText 22pt bold
│   (26pt 800-weight, ls 1.6)  │ RUS 🇷🇺  │  ← rusFlagRow:
│                              │         │     RUS 8pt 900,
│                              │         │     flag 12×6.6pt
│                              │         │     (3 полосы 12×2.2pt)
└──────────────────────────────┴─────────┘
                     ↑ inner cant 3pt, hairline
```

- Цвета флага: `#FFFFFF` / `#0039A6` / `#D52B1E` (точные ГОСТ)
- Hairline-обводка вокруг флага (`borderWidth: hairlineWidth, '#000'`)
- Регион **никогда не дублируется** в основной части

## Расписание

`mobile/src/screens/ScheduleScreen.tsx`

### Корневая причина пустого графика

`<Reanimated.View entering={FadeIn} key="grid">` обёртки **не имели
`style={{ flex: 1 }}`** → внутренний GridTab `flex: 1` коллапсировал в
0 высоты. Исправлено для всех 5 табов.

Дополнительно:

1. `stickyColumn.width: 110 → 140` — синхронно с `gridNameCell.width`
2. Все вертикальные ScrollView получили `style={{ flex: 1 }}`
3. Right horizontal ScrollView — `contentContainerStyle: { flexGrow: 1 }`
4. `useReduceMotion` обёрнут в try/catch + optional-chained API
5. `safeMonth` fallback на `new Date()` если `currentMonth` дрейфует
6. TodayPill упрощён до плоского кружка (без RNAnimated.loop, который
   мог падать на первом маунте)

### Скролл

- `scrollEventThrottle={1}` — максимальная частота sync-events между
  левой sticky и правой scrollable колонками
- `decelerationRate="normal"` — нативная iOS-инерция
- `removeClippedSubviews` — ячейки вне viewport не рендерятся

### Владельцы скрыты

```ts
const isSchedulable = (u) =>
  u?.id &&
  u.isActive !== false &&
  !['superadmin', 'director', 'owner'].includes((u.role || '').toLowerCase());
```

Auth-user fallback также проходит фильтр.

### Визуальная полировка

- Today cell background: `colors.primary[50]` (более яркий, чем 50% opacity)
- Status dots: высота 26pt (раньше 22pt), `borderRadius: 8` для
  пилюль и `13` для круглых, тонкая drop shadow `shadowOpacity: 0.05`
  чтобы индикатор читался как мягкий островок, а не плоская точка
- Cells: `StyleSheet.hairlineWidth` на бордерах (0.33pt на retina) —
  крепче нативный iOS look, чем 0.5pt сплошные
- Empty cell dot: 6pt круг `gray[200]` — субтильный, не отвлекающий

### Префетч

```ts
[prevMonth, nextMonth].forEach((m) => {
  queryClient.prefetchQuery({ queryKey: ['schedule', from, to], ... });
});
```

Свайп месяц-пейджера — мгновенный.

### Что я НЕ делал в Swift

Полная нативная реимплементация всего Schedule (на UIKit /
SwiftUI) **не делалась** — это 2–3 недели работы. Вместо этого
исправлены реальные баги, которые ломали RN-рендер. Если после
prebuild на iPhone скролл всё ещё дёргается, следующий шаг — заменить
nested ScrollView на `FlatList` или использовать `react-native-gesture-handler`
со `scrollHandler` для синхронизации; это можно сделать быстро.

## Склад — Preview фото

`mobile/src/screens/ProductsScreen.tsx`

- Long-press 400ms на фото товара → `setFullscreenPhoto(uri)` +
  medium-haptic
- Backdrop: `BlurView intensity={90} tint="dark"` (UIVisualEffectView
  тёмный glass)
- Image: `borderRadius: 24` continuous, soft shadow
- Outer Pressable на overlay → close при тапе ВНЕ фото
- Inner Pressable вокруг image останавливает event → тап ПО фото НЕ
  закрывает (можно рассматривать)
- Close-кнопка 36×36 translucent squircle в правом верхнем углу

## Журнал → CheckDetail

`mobile/src/navigation/AppNavigator.tsx`

`ChecksStackNavigator` теперь **внутри** Checks-таба. Push CheckDetail
на этот inner-stack оставляет тап-бар видимым. Из Dashboard и
ClientDetail — nested navigation:

```ts
navigation.navigate('Main', {
  screen: 'Checks',
  params: { screen: 'CheckDetail', params: { id } },
});
```

## Производительность (бонус)

- В `App.tsx` глобальный `placeholderData: (prev) => prev` для всех
  `useQuery` — без flash на скелетон
- AsyncStorage persistence cache гидратится до первого рендера
- Schedule prefetch соседних месяцев

## Проверки, которые я могу запустить

| Проверка                                        | Результат                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `npx tsc --noEmit` (mobile)                     | ✓ чисто (только pre-existing axios warning в shared/api/createServices.ts) |
| Lint (lint-staged + Prettier на каждом коммите) | ✓ автоматически применяется                                                |
| Грамматика Swift через визуальный review        | ✓ (xcrun / xcodebuild недоступны)                                          |

## Проверки, которые могу запустить только на Mac

| Команда                                                             | Назначение                   |
| ------------------------------------------------------------------- | ---------------------------- |
| `npx expo prebuild --platform ios --clean`                          | Регенерация `ios/` + Podfile |
| `cd ios && pod install`                                             | Установка native podов       |
| `xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa build` | Полный native build          |
| Запуск на физическом iPhone                                         | Реальная визуальная приёмка  |

## Что нужно сделать на Mac (полный rebuild)

Native Swift код менялся в нескольких коммитах → нужен полный
prebuild + чистый Xcode build:

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

1. **Target Autexa → Signing & Capabilities → Team: Ramazan Shamsudinov**
   (после prebuild --clean Team всегда сбрасывается)
2. Выбрать iPhone в селекторе устройств
3. Если выпадет диалог «Update to Recommended Settings» — **Cancel**
   (он включает USER_SCRIPT_SANDBOXING который ломает Pods build)
4. ▶ (⌘+R) — первая сборка ~5–10 минут

## Чек-лист на устройстве (заполняет владелец)

- [ ] Касса: при выборе клиента поиск исчезает, появляется большая карточка с госномером
- [ ] Госномер: регион + RUS + флаг помещаются справа, не обрезаются
- [ ] Госномер визуально похож на реальный (по референсу)
- [ ] ✕ на карточке возвращает поиск с iOS-анимацией
- [ ] Tab bar: floating island с rounded corners
- [ ] Tab bar: glass effect виден (translucent material)
- [ ] Tab bar: при пане капля растягивается, snapит к слоту с тиком-haptic'ом
- [ ] Tab bar: Касса компактная, не protruding
- [ ] Tab bar: точек/Android-индикаторов нет
- [ ] Расписание → График: рендерятся строки сотрудников
- [ ] Расписание: владельцы (директор/superadmin) НЕ видны на графике
- [ ] Расписание: скролл плавный, нет дёрганий
- [ ] Склад: long-press 400ms на фото → preview с blur-фоном (не чёрный)
- [ ] Preview: тап в любом месте вне фото закрывает
- [ ] Preview: тап ПО фото НЕ закрывает
- [ ] Журнал → чек: открывается с тап-баром на месте
- [ ] Android-версия не сломана (отдельная сборка)

## Что осталось ограничением

1. **Я не могу подтвердить визуально**, что после prebuild всё
   выглядит как описано — это могу сделать только Mac + iPhone.
2. **Schedule scroll smoothness** — после моих изменений (flex:1 +
   removeClippedSubviews + scrollEventThrottle:1) должен стать заметно
   плавнее, но если на устройстве ещё дёргается, следующий итеративный
   шаг — переход на FlatList или native UICollectionView. Готов
   реализовать после фидбэка.
3. **iOS 26 UIGlassEffect** — реальный Liquid Glass виден только на
   реальной iOS 26, на iOS 18 будет более плоский (но всё равно
   полупрозрачный) `.systemThinMaterial`. Это compromise, не
   regression.

## Файлы изменены (за весь iOS-redesign)

```
mobile/App.tsx                                                       (placeholderData)
mobile/modules/autexa-liquid-glass/expo-module.config.json           (2 apple modules)
mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassModule.swift (split)
mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift (Apple Music feel)
mobile/modules/autexa-liquid-glass/src/AutexaLiquidGlassTabBar.tsx
mobile/modules/autexa-liquid-glass/src/index.ts
mobile/src/hooks/useTabBarHeight.ts
mobile/src/navigation/AppNavigator.tsx                               (ChecksStackNavigator)
mobile/src/navigation/TabBarShared.ts                                (Касса label)
mobile/src/navigation/TabBar.ios.tsx                                 (island rewrite)
mobile/src/screens/CheckCreateScreen.tsx                             (selected-card + plate)
mobile/src/screens/ClientDetailScreen.tsx                            (nested-nav)
mobile/src/screens/DashboardScreen.tsx                               (nested-nav)
mobile/src/screens/ProductsScreen.tsx                                (long-press + blur preview)
mobile/src/screens/ScheduleScreen.tsx                                (flex:1, owner filter, scroll polish, cell visuals)

docs/ios-redesign/CASH_DESIGN_AND_PLATE_CARD.md
docs/ios-redesign/NATIVE_TAB_BAR_SWIFT.md
docs/ios-redesign/SCHEDULE_SWIFT_REDESIGN.md
docs/ios-redesign/WAREHOUSE_IMAGE_PREVIEW.md
docs/ios-redesign/FINAL_REPORT.md (этот документ)
```
