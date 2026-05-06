# Swift-native Liquid Glass tab bar

Дата: 2026-05-05. Ветка: `claude/fix-auteksa-freezing-zuMJS`.

---

## Iteration #3 — content flows under, clean glass, Касса v3

Iter#2 отвергнут. Эта итерация:

### Bar visual cleanup

- Удалён blue `outerGlow` (primary[700] @ opacity 0.06).
- Тяжёлая primary-800 тень (radius 22, opacity 0.18) → нейтральная black (opacity 0.12, radius 16, offset 0/6).
- Hairline rim opacity 0.95 → 0.7.
- **Эффект**: бар больше не «тяжёлая плашка» — лёгкий floating glass island.

### Content flows under bar

В 5 tab-target экранах убран `paddingBottom: 120` из contentContainer, заменён на iOS-native:

```tsx
<ScrollView
  contentInset={{ bottom: tabBarHeight }}
  scrollIndicatorInsets={{ bottom: tabBarHeight }}
  automaticallyAdjustContentInsets={false}
/>
```

Скролл-контент теперь раскладывается на полную высоту экрана. `contentOffset.y = -inset.bottom` изначально, поэтому первый видимый item — это первый item списка, а не верх. **Последние items проходят визуально под стеклом** — что и есть iOS Mail / Settings / Music паттерн.

### Касса button — Swift native v3 (full rewrite)

Полный rewrite `AutexaKassaButtonView.swift`:

- Удалён tinted halo и chunky shadow.
- `cornerRadius 16 → 18pt` — кнопка визуально сливается с pill бара.
- `UIVibrancyEffect(.label) → .fill` — symbol punches through стекло с настоящим vibrancy.
- Hairline border 95% → 70% opacity — единый highlight как у бара.
- Drop shadow neutral, opacity 0.18 → 0.10, radius 8 → 6.
- SF Symbol `doc.text.fill` → **`bag.fill`** (checkout/shopping семантика).
- Weight `regular ↔ semibold` → `semibold ↔ bold` — кнопка визуально весомее на тёмном/светлом контенте.
- Impact 0.7 → 0.6 — мягче.

**Кнопка теперь — часть liquid-glass-системы, не «кружок с фигурой».**

---

## Iteration #2 (после физического iPhone)

Владелец отверг JS-обёртку «glass dome» из iter #1: «кружок и фигура внутри не в стиле Apple». Эта итерация заменила Касса-кнопку на полностью native Swift Expo Module.

### Что добавлено

`mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift` — отдельный native UIView:

- **`UIVisualEffectView` (`systemChromeMaterial`)** как поверхность кнопки — та же семья материалов, что у бара. На iOS 26+ автоматически апгрейдится до `UIGlassEffect` через `NSClassFromString`.
- **`UIVibrancyEffect` (`.label` style)** поверх материала — SF Symbol «punches through» glass с настоящей translucency, как Control Center.
- **SF Symbol** (`UIImage(systemName: "doc.text.fill")`) — нативный глиф, weight switches `regular ↔ semibold` по `focused`. Никакой JS-стороны иконки.
- **Continuous-corner squircle** (`cornerCurve = .continuous`, `cornerRadius = 16`) — настоящий iOS-squircle, не круг и не прямоугольник.
- **Drop shadow** на wrapper-слое (primary-800, opacity 0.18, radius 8, offset 0/4) — глубина без тяжести.
- **Tinted halo** (primary-500 @ 10% opacity, 6pt outset) — подсвечивает «primary action» без яркой плашки.
- **Touch interaction**:
  - `touchesBegan` → `UIImpactFeedbackGenerator(style: .medium)` impact 0.7 + scale → 0.94 spring.
  - `touchesEnded` → scale → 1.0 spring + emit `onPress` event.
  - На iOS 17+ — `UIViewPropertyAnimator + UISpringTimingParameters(dampingRatio: 0.78)`.
- **`focused` API** — JS prop `focused={kassaFocused}` отрывает `setFocused(_:)` → spring `1.0 ↔ 1.05` + symbol weight switch.

### Регистрация

- `expo-module.config.json` дополнен `AutexaKassaButtonModule`.
- `AutexaLiquidGlassModule.swift` объявляет class `AutexaKassaButtonModule: Module` с `Name("AutexaKassaButton")` и Events("onPress").
- JS lookup: `requireNativeViewManager('AutexaKassaButton')` через обёртку `AutexaKassaButton.tsx`.

### JS-сторона

`mobile/src/navigation/TabBar.ios.tsx`:

- Удалён старый `KassaGlassDome` (JS-only).
- В iconsRow для слота Касса теперь рендерится **пустой placeholder**.
- Native `<AutexaKassaButton />` рендерится как **отдельный sibling** над iconsRow на абсолютной позиции, центрированный над средним слотом, с собственными pointer events. iOS hit-testing: тап внутри его frame идёт прямо в native onPress, тап вокруг проходит сквозь в bar's gesture recognizer'ы (droplet pan/tap для других вкладок).
- KASSA_SIZE = 52pt.

Centрally button **больше не имеет подписи** — это spec.

### Известное предупреждение Swift fix

`AutexaKassaButtonView` сначала использовал `private var focused: Bool` — это коллидило с UIView's встроенным `focused` свойством (focus engine, tvOS). Переименовано в `kassaFocused`. Build SUCCEEDED после фикса.

### Используемые iOS APIs (новые в этой итерации)

| API                                                        | Где                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `UIVisualEffectView` + `UIBlurEffect.systemChromeMaterial` | Касса surface (chrome — самый «hardware» материал, идеален для CTA) |
| `UIVibrancyEffect(blurEffect:style:)`                      | SF Symbol через стекло                                              |
| `UIImage.SymbolConfiguration(pointSize:weight:scale:)`     | weight switching                                                    |
| `cornerCurve = .continuous`                                | true iOS squircle                                                   |
| `UIViewPropertyAnimator + UISpringTimingParameters`        | press-down + focus spring                                           |
| `UIImpactFeedbackGenerator(style: .medium)`                | touch-down haptic                                                   |
| `EventDispatcher` (Expo)                                   | onPress payload to JS                                               |

---

## Что было

Нижний таб-бар уже был Swift-native до этой итерации (см. предыдущие документы `NATIVE_TAB_BAR_SWIFT.md`, `TAB_BAR_NATIVE_IMPLEMENTATION.md`). Стек:

- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift` (~365 строк) — `UIVisualEffectView` (`systemThinMaterial`, апгрейд до `UIGlassEffect` на iOS 26+ через `NSClassFromString`), droplet с `CAGradientLayer`, `UIPanGestureRecognizer` + `UITapGestureRecognizer`, `UISpringTimingParameters` на критическом демпфировании, `UISelectionFeedbackGenerator` + `UIImpactFeedbackGenerator`. Apple Music-style: pressed-down scale 0.96 при `.began`, velocity-driven liquid stretch (max 1.22×) и vertical squish (min 0.88×), spring snap на `.ended`.
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassModule.swift` — два модуля: `AutexaLiquidGlassModule` (общая glass-поверхность) и `AutexaLiquidGlassTabBarModule` (этот же бар).
- `mobile/src/navigation/TabBar.ios.tsx` — JS-обёртка: floating island, hairline rim, иконки + лейблы поверх native droplet.

Native droplet, finger-follow, haptics, iOS 26 апгрейд, Reduce Motion (через iOS-стандартный механизм spring) — **всё это уже есть**. Эта итерация не переписывала native — фокус был на JS-стороне центральной кнопки «Касса».

## Что было не так на скриншотах

1. Центральная кнопка «Касса» — **подпись «Касса» под кнопкой**, прямо нарушение правила.
2. Сама кнопка — **32×32 плоский blue squircle** (`colors.primary[600]`). Дешёвая RN-стилистика, не сочетается с liquid-glass поверхностью бара. Выглядит как чужеродный паинт-джоб поверх стекла.

## Что исправлено

### `mobile/src/navigation/TabBar.ios.tsx` — `KassaGlassDome`

Полностью переписан:

- **Подпись «Касса» удалена.** Не вернётся — по спеку центральная CTA подписи не носит. (TabBarShared.ts оставляет `label: 'Касса'` для совместимости с Android-вариантом, где подпись остаётся, и для accessibility — но iOS просто не рендерит `<Text>` для `isKassa`.)
- **Размер 32×32 → 50×50 squircle.** Это уже iOS-каноничный CTA-размер (как Search bar centred ".buttons" в Apple Music).
- **Поверхность — нативный glass через `<AutexaLiquidGlassView variant="chromeMaterial" topRim />`** — тот же local Expo Module, что используется самим баром. На iOS 26+ автоматически апгрейдится до `UIGlassEffect`. На iOS 13-25 — `UIBlurEffect.systemChromeMaterial` (premium fallback). На Android — translucent View. Кнопка теперь является ЧАСТЬЮ glass-системы, а не paint-пятном поверх неё.
- **Внутри — SF Symbol** через `<Icon name="receipt" />` (на iOS — `expo-symbols` SymbolView, на Android — Material Community Icons), вес `regular` / `semibold` в зависимости от `focused`.
- **Subtle primary-tinted halo** (64×64, opacity 0.10) под squircle'ом — добавляет визуальный вес и подсказывает, что это primary action, без яркой плашки.
- Spring scale-up 1.06 при focus (`SPRING_TIGHT` из `platform/motion`).
- **Hairline white rim** + **soft drop shadow** (radius 8, opacity 0.18, `colors.primary[800]` tint) — то же оформление, что у floating island, чтобы кнопка читалась как «выколота» из той же стеклянной плоскости.

## Используемые iOS APIs

| API                                                                                        | Где                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `UIVisualEffectView` + `UIBlurEffect.systemThinMaterial`                                   | `AutexaLiquidGlassTabBarView.swift` (бар background)                       |
| `UIBlurEffect.systemChromeMaterial` (через `AutexaLiquidGlassView` chromeMaterial variant) | Касса dome surface                                                         |
| `UIGlassEffect` (iOS 26+, runtime lookup)                                                  | оба места выше — автоматический апгрейд                                    |
| `UIPanGestureRecognizer`, `UITapGestureRecognizer`                                         | bar gestures                                                               |
| `UIViewPropertyAnimator` + `UISpringTimingParameters`                                      | droplet spring (iOS 17+); fallback на классический `UIView.animate` spring |
| `UISelectionFeedbackGenerator`                                                             | tick-tick во время drag droplet'а через слоты                              |
| `UIImpactFeedbackGenerator` (medium intensity 0.55)                                        | release of pan                                                             |
| `CAGradientLayer`                                                                          | droplet gradient (3-stop white-to-translucent)                             |
| `kCAGradientLayerCornerCurveContinuous`                                                    | continuous corners на droplet'е                                            |
| SF Symbols (через `expo-symbols`)                                                          | все иконки в TabItem + KassaGlassDome                                      |

## Архитектурные особенности

- **JS-side не рендерит droplet.** Droplet полностью живёт в Swift — JS только читает `state.index` и пересылает через `activeIndex` prop. Переход «поднял палец на новой вкладке» сначала срабатывает на native side (haptic + drag stretch), потом emitPress(index) → JS → react-navigation.
- **Pan gesture не передаёт touch-приоритет JS-уровню.** Иконки JS-овые (`pointerEvents="none"`) — таппинг по иконке проходит сквозь и попадает в Swift's UITapGestureRecognizer. Это даёт нам нативный feel пана + JS-овую иконографию.
- **iOS 26 UIGlassEffect** — не hardcoded на новый SDK. `NSClassFromString("UIGlassEffect")` + cast в `UIVisualEffect` — модуль компилируется на любом Xcode, на старых SDK падает на seed (`systemThinMaterial`). Это обязательно для проекта, где CI собирает на Xcode 15 / iOS 17 SDK.

## Acceptance criteria

| Требование                                   | Статус                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| tab bar выглядит радикально лучше            | ✅ central CTA теперь glass squircle, не плоский паинт                                      |
| Swift-native реализация                      | ✅ `AutexaLiquidGlassTabBarView.swift` (бар), `AutexaLiquidGlassView.swift` (Касса surface) |
| «Касса» — большая, центральная, без подписи  | ✅ 50×50, центр, `<Text>` удалён                                                            |
| liquid/glass/droplet эффект при переключении | ✅ Swift droplet spring + velocity stretch                                                  |
| иконки визуально лучше                       | ✅ SF Symbols через expo-symbols (нативные глифы с weight variants)                         |
| плавные нативные анимации                    | ✅ `UIViewPropertyAnimator` + `UISpringTimingParameters`                                    |
| haptics                                      | ✅ Selection (drag tick) + Impact medium 0.55 (release)                                     |
| Safe Area + Home Indicator                   | ✅ `useSafeAreaInsets().bottom + 10pt BOTTOM_LIFT`, `bottomInset` prop передаётся в Swift   |
| Android не сломан                            | ✅ изменения только в `TabBar.ios.tsx` + `iosSurface.ts` (новый файл)                       |

## Что владелец проверяет на iPhone

1. На iPhone 15+ (iOS 17): открыть приложение → внизу должен быть floating island с 5 слотами, центральная кнопка — стеклянный squircle 50×50, БЕЗ подписи «Касса».
2. Тапнуть на любую вкладку → синяя капля (droplet) springs к ней с нежным haptic'ом.
3. Зажать палец на droplet'е и протащить через бар → droplet растягивается горизонтально (water-stretch), squishes vertically; на каждой вкладке короткий «tick». На отпускании — spring к ближайшему, medium impact haptic.
4. На iPhone 17 Pro / iOS 26: должен сработать апгрейд до `UIGlassEffect` — преломление контента под баром при скролле.
5. Settings → Accessibility → Motion → Reduce Motion: spring должен стать timing animation вместо spring (iOS делает это сам через `UIViewPropertyAnimator`).

## Файлы

- `mobile/src/navigation/TabBar.ios.tsx` — refactor `KassaGlassDome`, новые стили kassaWrap/kassaHalo/kassaDome
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift` — без изменений
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassView.swift` — без изменений
- `mobile/src/platform/iosSurface.ts` — новый файл с visual primitives
