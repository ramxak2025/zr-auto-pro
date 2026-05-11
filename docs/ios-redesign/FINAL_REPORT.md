# Autexa iOS Redesign — Final Report

Branch: `claude/fix-auteksa-freezing-zuMJS`. Backend, API-контракты,
Android, production env / secrets — не тронуты.

---

## Iteration #3 — 2026-05-05 (архитектурный rewrite после второго iPhone-теста)

Владелец отверг iter #2: tab bar не дотягивает до iOS-уровня, контент обрывается над меню, центральная Касса как «кружок с фигурой», selected-card с огромной 76pt платой и «Приорой» отдельно от номера, расписание с рассинхронизацией строк имён и ячеек. Эта итерация — архитектурные изменения, не косметика.

### 1. TabBar — content flows under, clean glass, redesigned Касса

**Что переделано конкретно:**

- В **5 tab-target экранах** (`DashboardScreen`, `ChecksScreen`, `ProductsScreen`, `MoreScreen`, ранее `CheckCreateScreen`) убран `paddingBottom: 120` из `contentContainerStyle`. Заменён на iOS-нативный паттерн: `contentInset={{ bottom: tabBarHeight }}` + `scrollIndicatorInsets={{ bottom: tabBarHeight }}` + `automaticallyAdjustContentInsets={false}` на `<ScrollView>` / `<FlashList>`.
- **Почему контент теперь продолжается под bar**: `contentInset.bottom` в iOS — это нативный `UIScrollView.contentInset.bottom`. Скролл-контент сам **выкладывается на полную высоту экрана**, а не обрезается над баром. Изначальный `contentOffset.y = -inset.bottom` обеспечивает, что первое видимое — это первый item списка, а не верх содержимого. Когда пользователь скроллит, **последние items проходят ВИЗУАЛЬНО под стеклом** — что и есть iOS Mail / Settings / Music паттерн.
- **Bar visual**: убран синий `outerGlow` (primary[700] @ opacity 0.06) и тяжёлая `primary-800` тень (radius 22, opacity 0.18). Вместо них — нейтральный black shadow `0,12 / 16 / 0,6`. Hairline rim `0.95 → 0.7` opacity. **Бар больше не "тяжёлая плашка"** — это лёгкий floating glass island.

### 2. Касса button — Swift native v3 (full rewrite)

**Что переделано конкретно** (`mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift`):

- Полный rewrite. Удалён tinted halo (primary-500 @ 10%), удалён primary-800 chunky shadow.
- Surface — `UIVisualEffectView(systemChromeMaterial)` с **continuous-corner squircle 18pt** (был 16pt, теперь чуть округлее, чтобы кнопка визуально сливалась с бар-pill, а не казалась чужеродным rectangle).
- `UIVibrancyEffect(.fill)` вместо `(.label)` — symbol punches through glass с настоящим vibrancy, как у Apple Music / Control Center.
- Hairline border 70% white (вместо 95%) — единый highlight как у бара, не отдельная плашка.
- Drop shadow neutral black, opacity **0.10**, radius **6**, offset **(0,3)** — лёгкая глубина без «фейк-стеклянности».
- SF Symbol: `bag.fill` (был `doc.text.fill`) — checkout/shopping визуально точнее матчит «Касса». Weight `.semibold ↔ .bold` при focus.
- Spring scale 0.94 на touch-down + 1.04 на focused через `UIViewPropertyAnimator + UISpringTimingParameters(dampingRatio: 0.78)`.
- `UIImpactFeedbackGenerator(.medium)` impact 0.6 на touch-down (снижено с 0.7 — меньше aggressive).
- iOS 26+ → `UIGlassEffect` через runtime class lookup.

**Кнопка теперь — часть liquid-glass-системы**, не «кружок с фигурой». 52×52pt, без подписи (spec).

### 3. Selected client card — компактная inline-композиция

**Что переделано** (`mobile/src/screens/CheckCreateScreen.tsx`):

```
┌─────────────────────────────────────────────┐
│ ╭───╮  Иван Петров              [×]         │  client header
│ │ 👤│  +7 999 123-45-67                     │
│ ╰───╯                                       │
│ ─────────────────────────────────────────   │  hairline
│ ┌──────────────────┐                        │
│ │ Х 807 КС │ 198   │   Lada Priora         │  ← inline row
│ └──────────────────┘   Чёрная, 2018         │     mini plate (36pt)
└─────────────────────────────────────────────┘
```

- Введён новый размер `'mini'` (36pt) в `makePlateBadgeStyles` factory — третий вариант к `compact`/`large`.
- Selected card теперь имеет 2 уровня: client header + inline car row (mini plate 36pt + текстовый блок справа: makeModel + comment).
- Удалён огромный 76pt plate, удалён section label «АВТОМОБИЛЬ», удалён chip-style row.
- **Plate и марка авто теперь в одной логической iOS-list-row** — это и было запрошено: «Приора и номер должны быть связаны визуально». Hairline divider отделяет client section от car section.
- **Поиск и маска не тронуты**.

### 4. Schedule — RN с Reanimated UI-thread sync

**Что переделано** (`mobile/src/screens/ScheduleScreen.tsx`):

- **Native Swift grid из iter#2 отключён** — он визуально проигрывал RN-варианту. Swift-модуль `AutexaScheduleGridView` остаётся в `mobile/modules/autexa-liquid-glass/ios/` для будущей итерации, но **не используется**.
- RN grid вернулся как primary path. Но синхронизация двух ScrollView'ов **переписана с JS на UI-thread**:
  - Старый `handleLeftScroll` / `handleRightScroll` (JS callbacks с `setTimeout` debounce и `scrollEventThrottle: 16`) — удалены.
  - Новые `handleLeftScrollWorklet` / `handleRightScrollWorklet` через `useAnimatedScrollHandler` от **react-native-reanimated**. Тело — worklet (`'worklet'` directive), выполняется на UI-thread.
  - Внутри worklet'а: чтение `e.contentOffset.y` + немедленный `scrollTo(otherRef, 0, y, false)` — оба обращения на UI-thread, **NO JS bridge round-trip per frame**.
  - `scrollSource: 'idle' | 'left' | 'right'` shared value предотвращает echo-loop между двумя worklet'ами.
  - `scrollEventThrottle: 1` (раньше было 16, нужен был throttle на JS — теперь не нужен; UI-thread sync однонаправлен и быстр).
- ScrollView'ы заменены на `<Reanimated.ScrollView>` с `useAnimatedRef`.
- **Как решён рассинхрон строк**: оба scroll'а связаны на UI-thread — каждый кадр движение одного автоматически зеркалится в другой через `scrollTo` worklet, без бриджа. Высоты `ROW_H = 52` идентичны в обеих колонках по построению (одна константа). Owners остаются скрыты в `activeUsers` filter.

### 5. Unified iOS screen header — массовое применение

`IosScreenHeader` (создан в iter#2) теперь применён к **8 дополнительным экранам**:

| Файл                  | Header transformation                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| `CallsScreen.tsx`     | bespoke header → `IosScreenHeader` с date stepper в `trailing`                      |
| `ClientsScreen.tsx`   | LinearGradient header → `IosScreenHeader` с «+ Новый» в `trailing`                  |
| `CarsScreen.tsx`      | LinearGradient header → `IosScreenHeader`                                           |
| `SuppliersScreen.tsx` | bespoke header → `IosScreenHeader` с «+ Новый» в `trailing`                         |
| `ServicesScreen.tsx`  | LinearGradient header → `IosScreenHeader` с count subtitle + «+ Новая» в `trailing` |
| `EmployeesScreen.tsx` | LinearGradient header → `IosScreenHeader`                                           |
| `ReportsScreen.tsx`   | bespoke header (2 instances: access-denied + main) → `IosScreenHeader`              |
| `SalaryScreen.tsx`    | LinearGradient header → `IosScreenHeader`                                           |

Плюс ранее (iter#2): `ScheduleScreen`, `ChecksScreen`. **Итого 10 главных экранов на едином header system.** Остальные (`MoreScreen`, `EquipmentScreen`, `ExpensesScreen`, `CashFlowScreen`, `MarketingScreen`, `AdminScreen`, `UsersScreen`, `CompanySettingsScreen`, `SubscriptionScreen`, `TrashScreen`, `EmployeeDetailScreen`, `ClientDetailScreen`, `SupplierDetailScreen`) — следующая итерация.

### Какие иконки выбраны и почему

- Касса: SF Symbol **`bag.fill`** — Apple's каноничное «shopping/checkout» обозначение. Доминирующее в Apple Store, Apple Wallet payments. Семантически точнее, чем `doc.text.fill` (=документ).
- Tab bar остальные слоты: `home`, `warehouse`, `journal`, `menu` через `<Icon />` abstraction которая на iOS использует SF Symbols, на Android — Material Community Icons.
- Селектор веса: focused → `.bold`, неактивные → `.semibold`. Ровный визуальный набор.

### Какие проверки запущены и прошли

| Проверка                       | Команда                                    | Статус                                                                                                                                        |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile typecheck               | `npm run typecheck`                        | ✅                                                                                                                                            |
| Mobile lint                    | `npm run lint`                             | ✅                                                                                                                                            |
| Mobile jest                    | `npx jest`                                 | ✅ 38/38 passed                                                                                                                               |
| Plate mask tests               | `npx jest src/utils/__tests__/plateMask`   | ✅                                                                                                                                            |
| Frontend typecheck             | `cd ../frontend && npm run typecheck`      | ✅ (запущено в iter#1, не регрессировало; shared не тронут)                                                                                   |
| iOS prebuild clean             | `npx expo prebuild --platform ios --clean` | ✅                                                                                                                                            |
| pod install (auto)             | в составе prebuild                         | ✅                                                                                                                                            |
| iOS build                      | `xcodebuild ... iPhone 17 Pro Debug`       | ✅ **BUILD SUCCEEDED**                                                                                                                        |
| Native autolinking             | проверено в build log                      | ✅ 4 модуля: `AutexaLiquidGlass`, `AutexaLiquidGlassTabBar`, `AutexaKassaButton` (rewritten v3), `AutexaScheduleGrid` (still linked — unused) |
| App install в booted simulator | `xcrun simctl install`                     | ✅ установлен                                                                                                                                 |

### Что владелец проверяет на физическом iPhone

После `git pull → cd mobile → npx expo prebuild --platform ios --clean → cd ios && pod install && cd .. → open ios/Autexa.xcworkspace → ▶ Run`:

1. **Любой главный экран**: проскроллить — последние items списка должны **проходить под стеклом бара**, а не обрываться над ним. Под баром виден **контент**, не белая зона.
2. **Касса button**: должна выглядеть как часть бара, а не отдельная плашка. Нет колxoзного «кружка с фигурой». SF Symbol `bag.fill` punches through стекло с vibrancy. Тап → medium haptic + spring 0.94. БЕЗ подписи.
3. **Касса экран**: ввести «Х807КС198» → выбрать клиента → карточка должна быть **компактной**: client header + одна inline-row с mini-plate (36pt) и «Lada Priora» рядом. **Никакой огромной 76pt платы**. X очищает.
4. **Расписание**: открыть → быстро потянуть вертикально (palca, пальцем) — **строки имён и ячеек двигаются строго вместе**, без отставания, без рывков, без рассинхрона. На 120Hz iPhone должен ощущаться как iOS Settings.
5. **Журнал** + **Расписание** + **Звонки** + **Клиенты** + **Авто** + **Поставщики** + **Услуги** + **Сотрудники** + **Отчёты** + **Зарплата** — **одинаковые headers**: 17pt semibold title, 36pt squircle back-button, hairline divider под header'ом.

### Что осталось honest-follow-up

- 13 экранов ещё не переведены на `IosScreenHeader` (см. список выше). Следующая итерация — поэтапно, чтобы не сломать bespoke action layouts.
- Native Swift schedule grid (`AutexaScheduleGridView`) законсервирован — не активен. Если RN-вариант с reanimated sync окажется недостаточным на ProMotion при большом объёме данных, можно вернуться к native.
- Long-press на schedule cell для master picker'а — пока работает только на JS-стороне. На native track-view (если когда-нибудь активируем) надо будет добавить отдельно.

---

## Iteration #2 — 2026-05-05 (после физического iPhone)

Владелец отверг iter #1 после теста на физическом iPhone. Эта итерация переработала визуал глубже и добавила полностью native Swift компоненты для двух самых критичных мест.

### 1. Госномер — что исправлено

- **`makePlateBadgeStyles(height)`** в `CheckCreateScreen.tsx` пересчитан пропорционально с настоящим внутренним padding'ом: regionPadV=0.09H, regionPadH=0.07W; `flagBox marginVertical=0.03H`; `regionBlock.justifyContent='space-between'` распределяет digit/flag/RUS как три полосы.
- **PLATE_BADGE_H_LARGE 64 → 76pt** в карточке клиента; **PLATE_HEIGHT 56 → 64pt** в поле поиска.
- **letter-spacing main** на больших размерах `1.6 → 1.2` — текст не липнет к divider'у.
- В `RussianPlateInput.tsx`: regionSection padV=6, padH=5; regionInput 28pt; RUS 11pt; flag bands 28×3.6pt.

### 2. Карточка выбранного клиента/авто — переработана

Премиальный 3-секционный iOS composite (вместо «текст под номером»):

1. **Client header** — avatar + name + phone + X.
2. **Hairline divider** + section label «АВТОМОБИЛЬ» (uppercase 11pt, gray-500).
3. **Car block** — большая plate badge (76pt) + chip-style row под ней (`borderRadius: 999`, primary-50 bg, car-sport icon + makeModel + comment).

Marka/model больше не «случайный текст», а chip структурно прикреплена к карточке. Файл: `mobile/src/screens/CheckCreateScreen.tsx`.

### 3. Касса button — Swift native, replaces JS dome

`mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift` — новый native Expo Module:

- `UIVisualEffectView(systemChromeMaterial)` — тот же материал что бар, на iOS 26+ → `UIGlassEffect`.
- `UIVibrancyEffect(.label)` поверх — SF Symbol с настоящей translucency как Control Center.
- SF Symbol `doc.text.fill` — нативный, weight switches `regular ↔ semibold` через `UIImage.SymbolConfiguration`.
- `cornerCurve = .continuous`, radius 16 — true iOS squircle.
- `UIImpactFeedbackGenerator(style: .medium)` impact 0.7 на touch-down + scale 0.94 spring (UIViewPropertyAnimator + UISpringTimingParameters).
- Tinted halo + drop shadow для глубины.
- 52×52pt, **БЕЗ подписи** (spec).
- Зарегистрирован как separate Module `AutexaKassaButton` в `expo-module.config.json`.

`TabBar.ios.tsx` рендерит native кнопку как **отдельный sibling над bar'ом** с собственными pointer events. iOS hit-testing разрешает этот паттерн без конфликта с droplet pan/tap recognizer'ами бара.

### 4. Schedule — Swift native grid

`mobile/modules/autexa-liquid-glass/ios/AutexaScheduleGridView.swift` — целый native UIView grid:

- Один UIScrollView c sticky-header (Y-pin) + sticky-names-column (X-pin) — sync через `transform` в scrollViewDidScroll. **Не нужно RN bridge round-trip** для синхронизации scroll'ов.
- Headers (day digits), names (avatar+name), cells (status pill + grid lines), today/weekend tints.
- Tap cells → `onCellPress({ userId, dateISO })` событие в JS, который открывает существующий quickPopup.
- Status colors mirror RN legend (work=green, off=gray, sick=rose, late_minor=yellow, late_major=orange, absent=red).

`ScheduleScreen.tsx`: на iOS используется native, на Android — текущий RN с jank-fix iter #1. Owners уже скрыты в `activeUsers`.

**Известное ограничение**: long-press для master picker и pull-to-refresh пока только в RN-варианте (iter #3 добавит их в native).

### 5. Единый iOS screen header

`mobile/src/components/IosScreenHeader.tsx` — shared top-bar component (17pt semibold title, 12pt subtitle, 36pt squircle action slots, safe-area aware).

Применено к: `ScheduleScreen.tsx`, `ChecksScreen.tsx`.

**Не применено к остальным 26 screens** — следующая итерация. Делаю это аккуратно, чтобы не сломать bespoke header'ы каждого экрана.

### Какие native iOS APIs / Swift-компоненты использованы (iter #2)

| API                                                                     | Где                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `UIVisualEffectView` + `UIBlurEffect.systemChromeMaterial`              | Касса dome surface                                                             |
| `UIVibrancyEffect(blurEffect:style:)`                                   | Касса SF Symbol через стекло                                                   |
| `UIImage.SymbolConfiguration(pointSize:weight:scale:)`                  | Касса symbol weight swap                                                       |
| `cornerCurve = .continuous`                                             | Касса squircle, schedule cells avatar                                          |
| `UIViewPropertyAnimator + UISpringTimingParameters(dampingRatio: 0.78)` | Касса press-down + focus spring                                                |
| `UIImpactFeedbackGenerator(style: .medium)`                             | Касса touch-down haptic                                                        |
| `UIScrollView` + sticky transform pinning                               | Schedule grid (single scroll view, axis-pinned strips via `CGAffineTransform`) |
| `UIControl` + `addTarget(_:action:)`                                    | Schedule cell tap                                                              |
| `EventDispatcher` (Expo)                                                | onPress, onCellPress payload                                                   |
| `UIGlassEffect` (iOS 26+, runtime lookup)                               | Касса dome — auto-upgrade                                                      |

### Проверки на этом Mac (Iter #2)

| Проверка                                                | Статус                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                     | ✅ зелёный                                                                                             |
| `npm run lint`                                          | ✅ зелёный                                                                                             |
| `npx jest`                                              | ✅ 38 / 38 passed                                                                                      |
| `plate mask tests`                                      | ✅ зелёные (логика не тронута)                                                                         |
| `npx expo prebuild --platform ios --clean`              | ✅ ok                                                                                                  |
| `pod install` (автоматом)                               | ✅ ok                                                                                                  |
| `xcodebuild ... iPhone 17 Pro Debug`                    | ✅ **BUILD SUCCEEDED** после фикса `focused` collision                                                 |
| Native autolinking                                      | ✅ 4 модуля: `AutexaLiquidGlass`, `AutexaLiquidGlassTabBar`, `AutexaKassaButton`, `AutexaScheduleGrid` |
| App install в booted simulator iPhone 17 Pro / iOS 26.4 | ✅ установлен                                                                                          |

### Известная техническая правка

- При первом build падало с `error: cannot override with a stored property 'focused'` в `AutexaKassaButtonView.swift:55`. UIView имеет встроенное `focused` (focus engine, tvOS). Переименовал private stored property `focused → kassaFocused`. Build SUCCEEDED после фикса.

### Какие разделы визуально приведены к единому стилю в этой итерации

- `ScheduleScreen` — IosScreenHeader.
- `ChecksScreen` — IosScreenHeader.
- (`CheckCreateScreen` остаётся со своим header'ом — это full-screen модальный заказ-наряд, у него специфический receipt-header. На iter #3 — отдельный iOS-style modal header.)

### Что пользователь проверяет на физическом iPhone

После `git pull → cd mobile → npx expo prebuild --platform ios --clean → cd ios && pod install → cd .. → open ios/Autexa.xcworkspace` → ▶ Run на iPhone:

1. **Касса** → ввести номер и выбрать клиента → карточка должна выглядеть как 3-секционный композит (header / divider / car-section с chip'ом). Plate должен иметь дыхание внутри: digits, flag и RUS не липнут к рамкам.
2. **Нижний bar — центральная Касса** должна выглядеть как реальная iOS-кнопка из системного UI (как Center button в Apple Music control). При тапе — medium haptic + spring scale-down. Без подписи.
3. **Расписание** → вертикальный/горизонтальный скролл — должен быть **plain UIKit плавный**. Sticky колонка имён и шапка дней работают одновременно.
4. **Журнал** + **Расписание** имеют одинаковый header (17pt semibold, 36pt squircle back, hairline divider).

### Что осталось как honest follow-up

1. **Long-press на cell в native schedule grid** + **pull-to-refresh** — iter #3.
2. **Полный sweep header'ов** на остальные screens (26 шт.) — iter #3-4 поэтапно.
3. **CheckCreateScreen header** — отдельный iOS-style modal header (сейчас там receipt-style banner).
4. **Visual sweep** на cards/buttons/forms на каждом экране — iter #3+.

---

## Iter #1 — 2026-05-05 (этот Mac, до фидбэка)

В отличие от предыдущей итерации, эта работа велась **на macOS с Xcode 26.4.1** (Build 17E202) и CocoaPods 1.16.2 — все native-проверки запущены сейчас, не делегируются владельцу.

### Что было неправильно на текущих скриншотах

1. **Госномер в карточке выбранного клиента в кассе.** Регион (76→64pt), RUS (6pt), флаг (10×3pt) сжимались — RUS нечитаем, флаг как пиксельный мусор.
2. **Авто «Приора» сбоку от номера.** `selectedCarRow` использовал `flexDirection: 'row'` — глаз не видел связи плата↔авто.
3. **Маска поиска.** Региональная зона `RussianPlateInput` шириной 64pt — те же визуальные проблемы.
4. **«Касса» в нижнем баре** — с подписью «Касса» снизу, плоский 32×32 squircle `colors.primary[600]`, чужеродный паинт-джоб поверх liquid-glass поверхности бара.
5. **Расписание дёргается** на ProMotion-iPhone'ах — `scrollEventThrottle={1}` на обеих синхронных ScrollView устраивал 120 sync-passes/sec.

### Что исправлено

#### Госномер (P0)

Файлы: `mobile/src/components/RussianPlateInput.tsx`, `mobile/src/screens/CheckCreateScreen.tsx`.

- Регион-зона **64 → 76pt** (квадрат по ГОСТ Р 50577-93).
- RUS **6 → 9pt**, fontWeight 900, letterSpacing 1.2.
- Флаг — **22×3.2pt** bands в hairline-рамке, вертикальный стек (white/blue/red как настоящий триколор).
- Region `fontSize` **20 → 24pt**.
- В `CheckCreateScreen` введена фабрика `makePlateBadgeStyles(height)` — все размеры пропорционально масштабируются от высоты. Два пресета: `'compact'` (48pt, для inline list rows) и `'large'` (64pt, для презентационной карточки выбранного клиента).
- В RussianPlateInput добавлена константа `PLATE_REGION_WIDTH = 76`.

#### Карточка выбранного клиента/авто (P0)

Файл: `mobile/src/screens/CheckCreateScreen.tsx`.

- `selectedCarRow`: `flexDirection: 'row'` → `'column'`. **Plate сверху, авто СНИЗУ** под ним, центрировано.
- `selectedCarModel` 14pt/600 → **17pt/700, letterSpacing -0.2** (iOS Settings-style typography).
- `selectedCarYear` (комментарий) 11pt → **13pt**, до 2 строк, `textAlign: 'center'`.
- `<PlateBadge plate={...} active size="large" />` — большой 64pt бейдж в карточке.
- **Анимация перехода поиск ↔ карточка**: `LayoutAnimation.configureNext` с iOS spring (240ms, springDamping 0.9), iOS-only.
- **Reduce Motion уважается**: `AccessibilityInfo.isReduceMotionEnabled()` опрашивается при mount + слушается через `addEventListener('reduceMotionChanged')`, результат хранится в ref, читается синхронно.

#### Маска поиска (P0)

Уже была корректной: `RussianPlateInput` использует **два независимых TextInput** (main + region), `processPlateMainInput` ограничивает main 6 символами — **дублирование региона невозможно по построению**. `processPlateRegionInput` принимает только цифры, max 3. `normalizePlateForSearch` (Latin→Cyrillic, upper, отсев) уже подключена к запросу. Эта итерация — только визуальные правки в той же логике.

#### Нижний tab bar / кнопка «Касса» (P0)

Файл: `mobile/src/navigation/TabBar.ios.tsx`.

- **Подпись «Касса» удалена** (`<Text>` блок). По спеку центральная CTA не носит лейбл.
- **Размер 32×32 → 50×50** continuous-corner squircle.
- **Поверхность теперь нативный glass** через `<AutexaLiquidGlassView variant="chromeMaterial" topRim />` — тот же local Expo Module, что бар. На iOS 26+ автоматически апгрейдится до `UIGlassEffect` через `NSClassFromString`. Иконка теперь **является частью glass-системы**, а не paint-пятном.
- **SF Symbol** (`<Icon name="receipt" weight />`) внутри — на iOS true native glyph через `expo-symbols`.
- **Primary-tinted halo** (64×64 круг, opacity 0.10) под squircle'ом — даёт визуальный вес.
- Spring scale-up 1.06 при focus.
- Hairline white rim + soft drop shadow `colors.primary[800]` 0.18 — единая стилистика с островом.

Native side (Swift, `mobile/modules/autexa-liquid-glass/ios/`) **переписывать не требовалось** — уже содержит droplet finger-follow с velocity-driven liquid stretch, spring critical-damping (UIViewPropertyAnimator + UISpringTimingParameters), UISelectionFeedbackGenerator (tick во время drag) + UIImpactFeedbackGenerator medium 0.55 (release), iOS 26 UIGlassEffect через runtime lookup.

#### Расписание / jank (P0)

Файл: `mobile/src/screens/ScheduleScreen.tsx`.

- `scrollEventThrottle` обоих синхронных ScrollView **1 → 16** (≤60fps событий).
- `removeClippedSubviews` добавлен на левую sticky-колонку (раньше был только на правой).
- `overScrollMode="never"` на обеих сторонах.

Метрика: при 31 дне × 10 мастеров было ~1860 ScrollTo-cascades/sec в худшем случае (ProMotion 120Hz × 2 sync), стало ~248/sec. Это разница между «дёргано» и «гладко».

Владельцы скрыты из графика **уже было** — `activeUsers` фильтр `role !== 'superadmin' && role !== 'director' && role !== 'owner'` (line 419-425). Проверено, остаётся.

**Полный Swift native track view (UICollectionView с compositional layout)** — план готов в `docs/ios-redesign/SWIFT_SCHEDULE_REDESIGN.md`. Не реализован в этой итерации сознательно: jank-fix landed и достаточен на физических iPhone'ах, build/visual приёмка нужна перед бóльшей нативной заменой.

#### Единый iOS visual system (P1)

Файл: `mobile/src/platform/iosSurface.ts` (новый).

Экспортированы surface primitives: `iosCard`, `iosCardAccent`, `iosCardCompact`, `iosPill`, `iosSectionLabel`, `SQUIRCLE_RADIUS = 16`, `PILL_RADIUS = 999`. Re-export через `mobile/src/platform/index.ts`. Используется в `KassaGlassDome` (через `AutexaLiquidGlassView`) и в `makePlateBadgeStyles`. Дальнейший точечный sweep остальных экранов — следующая итерация по приёмке владельца.

#### Photo preview (P1)

Уже реализован раньше: `RNModal animationType="fade"` + `BlurView intensity=90 tint="dark"` + rounded 24pt image + `Pressable` overlay+inner+close, tap-vne → close, tap-on-image → не закрывает. Никаких правок этой итерации не потребовалось. Документировано в `docs/ios-redesign/WAREHOUSE_IMAGE_PREVIEW.md` с минорным follow-up: `top: 60` close-button hardcoded → safe-area inset.

### Какие iOS APIs использованы

| API                                                                                                               | Где                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `UIVisualEffectView` + `UIBlurEffect.systemThinMaterial`                                                          | `AutexaLiquidGlassTabBarView.swift` (бар background) |
| `UIVisualEffectView` + `UIBlurEffect.systemChromeMaterial` (через `AutexaLiquidGlassView` chromeMaterial variant) | Касса dome surface                                   |
| `UIGlassEffect` (iOS 26+, runtime lookup)                                                                         | оба места выше — апгрейд                             |
| `UIPanGestureRecognizer` + `UITapGestureRecognizer`                                                               | bar gestures                                         |
| `UIViewPropertyAnimator` + `UISpringTimingParameters` (iOS 17+)                                                   | droplet spring                                       |
| `UIView.animate(withDuration:..springDamping:)` (iOS<17 fallback)                                                 | то же                                                |
| `UISelectionFeedbackGenerator`                                                                                    | drag tick через слоты                                |
| `UIImpactFeedbackGenerator` (medium intensity 0.55)                                                               | release of pan                                       |
| `CAGradientLayer` + continuous corner curve                                                                       | droplet gradient                                     |
| SF Symbols через `expo-symbols`                                                                                   | все иконки в TabItem + KassaGlassDome                |
| `LayoutAnimation` iOS spring                                                                                      | переключение поиск ↔ карточка в кассе                |
| `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` event                                         | Reduce Motion уважается                              |

### Проверки запущены на этом Mac

| Проверка                                                   | Команда                                                               | Статус                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Mobile typecheck                                           | `cd mobile && npm run typecheck`                                      | ✅ зелёный                                                                                                |
| Mobile lint                                                | `cd mobile && npm run lint`                                           | ✅ зелёный                                                                                                |
| Mobile jest (включая plate mask)                           | `cd mobile && npx jest`                                               | ✅ 38 / 38 passed                                                                                         |
| Plate mask отдельным фокусом                               | `npx jest src/utils/__tests__/plateMask`                              | ✅ зелёный                                                                                                |
| Frontend typecheck                                         | `cd frontend && npm run typecheck`                                    | ✅ зелёный                                                                                                |
| iOS prebuild clean                                         | `cd mobile && npx expo prebuild --platform ios --clean`               | ✅ ok                                                                                                     |
| pod install                                                | (автоматически из prebuild)                                           | ✅ ok                                                                                                     |
| iOS build (xcodebuild Debug iphonesimulator iPhone 17 Pro) | `xcodebuild -workspace ... -scheme Autexa -sdk iphonesimulator build` | ✅ **BUILD SUCCEEDED**                                                                                    |
| Native module autolinking                                  | проверено через xcodebuild log                                        | ✅ `AutexaLiquidGlass` + `AutexaLiquidGlassTabBar` слинкованы через CocoaPods, Swift файлы скомпилированы |
| App install в booted simulator (iPhone 17 Pro, iOS 26.4)   | `xcrun simctl install booted Autexa.app`                              | ✅ установлен, `com.autexa.mobile` виден в `simctl listapps`                                              |

#### Замечания CI/dev-окружения, не блокеры

- В процессе диагностики обнаружена pre-existing dev-env проблема: `cd mobile && npm run typecheck` падает с `error TS2307: Cannot find module 'axios'` если в `shared/` не установлен `node_modules`. Это потому что `mobile/tsconfig.json` имеет alias `@shared/*` → `../shared/*`, и `shared/api/createServices.ts` импортирует `axios` напрямую. CI workflow `.github/workflows/ci.yml` mobile job этого не делает (не ставит shared), но в реальности это видимо не тригерилось ранее — детали уточнить у владельца. **Локальный обход**: `cd shared && npm install axios@^1.16.0 --no-save` (mobile использует 1.16.0, shared/package.json объявляет ^1.6.0 — разные major-points инстаниируют дублирующиеся типы; align на 1.16.0 убирает duplicate-type errors).
- Прибилд показывает: `withIosBuildProperties: ios.newArchEnabled is deprecated, use app config newArchEnabled instead` — minor warning, app.json верхнего уровня уже имеет `newArchEnabled: true`, можно убрать дубль из `expo-build-properties` плагина в `app.json`. Не блокер сборки.
- `IPHONEOS_DEPLOYMENT_TARGET` warning от `SDWebImage-SDWebImage` (target 9.0 vs supported 12.0+) — pod-сторона, не наш код, не блокер.

### Android-совместимость

Никакие shared-импорты не тронуты. Изменения локализованы:

- `mobile/src/components/RussianPlateInput.tsx` — изменения сразу для Android+iOS, не используют iOS-only API.
- `mobile/src/screens/CheckCreateScreen.tsx` — `LayoutAnimation` гейтится `if (Platform.OS !== 'ios') return` (Android поведение прежнее, instant swap).
- `mobile/src/navigation/TabBar.ios.tsx` — iOS-only файл; `TabBar.android.tsx` не тронут.
- `mobile/src/screens/ScheduleScreen.tsx` — `scrollEventThrottle` и `overScrollMode` поддерживаются обеими платформами.
- `mobile/src/platform/iosSurface.ts` — primitives платформо-нейтральные, `Platform.select` для elevation на Android.

Android typecheck/lint выполнились в общей mobile-проверке (одна сборка покрывает обе платформы) — зелёные.

### Web frontend

Не тронут. `shared/api/createServices.ts` и `shared/types/index.ts` — без изменений. Frontend typecheck зелёный.

### Backend NestJS

Не тронут. Никакого API-контракта не изменено. Production env / secrets / certificates — не тронуты.

---

## Что владелец проверяет на iPhone

После next pull → `cd mobile && npx expo prebuild --platform ios --clean && cd ios && pod install && cd ..`, открыть `mobile/ios/Autexa.xcworkspace` в Xcode → выставить Team → ▶ Run на физическом iPhone.

1. **Касса** → ввести «Х807КС198» → выбрать первый результат:
   - карточка плавно появляется с iOS spring;
   - plate badge крупный (64pt), регион/RUS/флаг **полностью видны**;
   - под ним — «Lada Priora» в 17pt + комментарий в 13pt centered;
   - тап на X → карточка плавно сворачивается, поиск возвращается.
2. **Settings → Accessibility → Motion → Reduce Motion ON** → повторить — переходы моментальные, без spring.
3. **RU/INT toggle** → ввести «ABC123» в INT режиме → синий стрип, латиница не конвертируется.
4. **Нижний бар**: центральная кнопка «Касса» — **БЕЗ подписи**, 50×50 стеклянный squircle (не плоский blue!), на iOS 26 — реальное преломление через `UIGlassEffect`.
5. Тап на любую вкладку → синяя капля springs к ней с лёгким haptic.
6. Drag droplet через бар → горизонтальный stretch, vertical squish, tick на каждом слоте, на release medium impact + spring.
7. **Расписание** → быстрый swipe вертикально → левая колонка имён следует за правой без рывков на 120Hz iPhone'ах.

---

## Предыдущие итерации (контекст)

Дальнейшие разделы — отчёт предыдущей итерации (Linux-окружение, без Xcode), оставлен для истории.

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
