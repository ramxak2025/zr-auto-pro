# iOS 26 / Liquid Glass-inspired visual system

Дата: 2026-05-05. Ветка: `claude/fix-auteksa-freezing-zuMJS`.

---

## Iteration #3 — массовое применение IosScreenHeader

Iter#2 покрывал 2 экрана. Iter#3 расширил до **10 экранов** — все ключевые iOS-разделы теперь используют единый header system:

| Экран           | Применено                                         |
| --------------- | ------------------------------------------------- |
| ScheduleScreen  | iter#2                                            |
| ChecksScreen    | iter#2                                            |
| CallsScreen     | iter#3 (date stepper в `trailing`)                |
| ClientsScreen   | iter#3 («+ Новый» в `trailing`)                   |
| CarsScreen      | iter#3                                            |
| SuppliersScreen | iter#3 («+ Новый» в `trailing`)                   |
| ServicesScreen  | iter#3 (count subtitle + «+ Новая» в `trailing`)  |
| EmployeesScreen | iter#3                                            |
| ReportsScreen   | iter#3 (двойное применение: access-denied + main) |
| SalaryScreen    | iter#3                                            |

### Эффект

Каждый из этих экранов теперь имеет:

- 17pt semibold title с letter-spacing −0.4 (San Francisco headline rule).
- 12pt subtitle gray-500.
- 36pt squircle leading slot (`onBack` → chevron.left) и trailing slot (custom node).
- `useSafeAreaInsets().top` — Dynamic Island / notch обрабатываются автоматически.
- Hairline bottom-border.

Остальные 13 экранов (`MoreScreen`, `EquipmentScreen`, `ExpensesScreen`, `CashFlowScreen`, `MarketingScreen`, и т. д.) — следующая итерация.

---

## Iteration #2 — единый screen header

`mobile/src/components/IosScreenHeader.tsx` — общий top-bar component:

- 17pt semibold title с letter-spacing -0.4 (San Francisco headline tracking).
- 12pt subtitle gray-500.
- 36pt squircle leading slot (`onBack` → chevron.left) + trailing custom node.
- Respects `useSafeAreaInsets().top` — Dynamic Island / notch автоматически.
- Hairline bottom-border (`noDivider` opt-out).
- `centerTitle: boolean` — Mail-style центр или Settings-style left.

Применено к:

- `ScheduleScreen.tsx` — заменил bespoke LinearGradient header.
- `ChecksScreen.tsx` — заменил own header.

**Что не сделано** (честно): полный sweep 28 экранов НЕ выполнен. Сделаны 2 главных для подтверждения паттерна. Остальные — следующая итерация по приёмке.

---

## Цель

Привести визуальный язык iOS-версии Autexa к одному набору примитивов: одинаковые радиусы, поверхности, отступы, типографика. Чтобы пользователь не воспринимал приложение как «набор отдельных RN-экранов», а как единый продукт уровня iOS Settings / Apple Music.

## Где живёт визуальная система

| Файл                                     | Что там                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/src/theme/index.ts`              | палитра (`colors`), `spacing`, `borderRadius`, `fontSize`, `fontWeight` — зеркалит web Tailwind                                               |
| `mobile/src/platform/iosSurface.ts`      | **новый** — surface primitives (`iosCard`, `iosCardAccent`, `iosCardCompact`, `iosPill`, `iosSectionLabel`, `SQUIRCLE_RADIUS`, `PILL_RADIUS`) |
| `mobile/src/platform/Typography.tsx`     | `Text` с variants (caption, body, title, …)                                                                                                   |
| `mobile/src/platform/Icon.tsx`           | SF Symbols через `expo-symbols` (iOS) → MCI (Android)                                                                                         |
| `mobile/src/platform/motion.ts`          | `SPRING_TIGHT`, `SPRING_SOFT`, `SPRING_PRESS`, `TIMING_*` — единый набор анимационных пресетов                                                |
| `mobile/src/platform/haptics.ts`         | helpers под `expo-haptics`, унифицированы intent → impact mapping                                                                             |
| `mobile/src/platform/PressableScale.tsx` | универсальная press-scale обёртка (0.97 на press)                                                                                             |
| `mobile/modules/autexa-liquid-glass/`    | native `<AutexaLiquidGlassView />` — UIVisualEffectView с iOS 26 апгрейдом                                                                    |

## Принципы

1. **Continuous corners.** Squircle-радиус 16pt для кнопок, 20-24pt для карточек. NSStringFromCALayerCornerCurve.continuous реализован через `overflow: 'hidden'` на iOS-side liquid glass контейнерах (UIView CALayer cornerCurve = .continuous). На JS-side mimic'ается через стандартный `borderRadius`.
2. **Hairline borders.** `StyleSheet.hairlineWidth` (= 1/scale) — единственный «edge» внутри светлых поверхностей. Тяжёлый shadow исключён.
3. **Material для bars / sheets / overlay'ев.** Везде, где есть «парящий» элемент над контентом — нативный glass через `<AutexaLiquidGlassView />`. iOS 26+ автоматически апгрейдится до `UIGlassEffect`. iOS 13-25 — `systemThinMaterial`. Android — translucent View. Это уже применено: tab bar, Касса dome.
4. **Primary tint = blue 600/700.** Не выходим за пределы: `colors.primary[500..800]` для interactive accents. Серый scale — для нейтральных surface'ов и текста.
5. **SF Symbols vs Material.** На iOS — никаких Ionicons / Material иконок без необходимости (есть исключения: уже встроенный `Ionicons` в нескольких местах, миграция планомерная, не блокер).
6. **Reduce Motion.** Везде, где используется spring или layout animation — `AccessibilityInfo.isReduceMotionEnabled()`. Уже применено в CheckCreateScreen `animateClientToggle`, в Schedule TodayPill (там было заранее).

## Что применено в этой итерации

### `mobile/src/platform/iosSurface.ts` — новый файл

Экспортирует:

- **`iosCard`** — стандартная карточка на экране (radius 24, hairline `colors.gray[200]`, background white, soft shadow). Аналог `<View>` секций в iOS Settings.
- **`iosCardAccent`** — primary-tinted variant (для focused/важных карточек).
- **`iosCardCompact`** — для inline list rows (radius 16, без elevation).
- **`iosPill`** — pill/chip с radius 999, нейтральный bg.
- **`iosSectionLabel`** — uppercase 11pt text style для заголовков групп (`gray[500]` letter-spacing 1).
- **`SQUIRCLE_RADIUS = 16`** — каноничный iOS-кнопочный радиус.
- **`PILL_RADIUS = 999`** — full-pill для tab bars и chip'ов.

Все эти примитивы вынесены так, чтобы:

1. Будущие экраны импортировали `import { iosCard } from '../platform'` и не хардкодили radius/shadow заново.
2. Можно было поменять глобальную «температуру» surface'ов одной правкой в одном файле.

### `mobile/src/platform/index.ts`

Re-export всего `iosSurface.ts` рядом с существующими `Text/Icon/PressableScale/...` — единый импорт-сайт.

## Что не сделано в этой итерации (честно)

Полного refactor'а 28 экранов под новый visual system **не было**. Это сознательное решение:

- риск регрессии Android,
- риск регрессии web (некоторые компоненты завязаны на shared types — но не на стили; стили mobile-only, поэтому web не задет),
- скриншот-приёмка по 28 экранам без физического iPhone — невозможна.

**Что сделано:** primitives готовы, `KassaGlassDome` уже использует glass surface, `selectedCard*` стили в кассе подняты под единый формат. Дальнейший miграtion на `iosCard` будет точечно по приёмке владельца — экран за экраном, с проверкой Android-snapshot'а.

## Acceptance criteria

| Требование                               | Статус                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Минимальный набор iOS-tokens             | ✅ `mobile/src/platform/iosSurface.ts`                                                                      |
| Применены к видимым касса/таб-бар точкам | ✅ `KassaGlassDome` использует `AutexaLiquidGlassView`, plate badge — единая `makePlateBadgeStyles` фабрика |
| Не сломан Android                        | ✅ все примитивы — plain ViewStyle/TextStyle, `Platform.select` для elevation                               |
| Не сломан web                            | ✅ нет правок в `frontend/`                                                                                 |
| Нет regress в shared API                 | ✅ `shared/` не тронут                                                                                      |

## Следующие шаги (после приёмки)

1. Применить `iosCard` к секциям внутри `CheckCreateScreen` (товары, услуги, итог по чеку) — единый radius и elevation.
2. Применить `iosCard` к `ProductsScreen` карточкам товара.
3. Применить `iosSectionLabel` везде, где сейчас inline 11pt uppercase.
4. Постепенный sweep остальных экранов.

Документировать каждую такую правку отдельным commit'ом, чтобы в случае регрессии откат локализован.

## Файлы

- `mobile/src/platform/iosSurface.ts` — новый
- `mobile/src/platform/index.ts` — re-export
- `mobile/src/navigation/TabBar.ios.tsx` — `KassaGlassDome` использует glass surface
- `mobile/src/screens/CheckCreateScreen.tsx` — `makePlateBadgeStyles` фабрика
