# Native Liquid Glass Tab Bar (Swift)

## Архитектура

Локальный Expo Module `mobile/modules/autexa-liquid-glass`:

```
modules/autexa-liquid-glass/
├── expo-module.config.json       — два apple-модуля
├── package.json
├── ios/
│   ├── AutexaLiquidGlass.podspec
│   ├── AutexaLiquidGlassModule.swift
│   │   ├─ Module 1: AutexaLiquidGlass — общая glass-поверхность
│   │   └─ Module 2: AutexaLiquidGlassTabBar — премиальный таб-бар
│   ├── AutexaLiquidGlassView.swift     — UIVisualEffectView обёртка
│   └── AutexaLiquidGlassTabBarView.swift — таб-бар с каплей
└── src/
    ├── AutexaLiquidGlassView.tsx
    ├── AutexaLiquidGlassTabBar.tsx     — JS-обёртка
    ├── AutexaLiquidGlassView.types.ts
    └── index.ts
```

## Native bar — `AutexaLiquidGlassTabBarView`

`mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift`

### Слои (z-order снизу вверх)

1. **Glass background** — `UIVisualEffectView`
   - iOS 13–25: `UIBlurEffect(style: .systemThinMaterial)`
   - iOS 26+: автоматический upgrade в `UIGlassEffect` через `NSClassFromString` runtime lookup
   - Заполняет всю площадь bar'а включая safe area
2. **Top rim** — 1pt `UIView` с `rgba(1,1,1,0.85)` (UIKit-стиль hairline над таб-баром)
3. **Droplet** — `UIView` со squircle corners (`cornerCurve = .continuous`, `cornerRadius = 18`)
4. **CAGradientLayer** на капле — 3-точечный градиент белый/светлый/белый, имитирует glass capsule
5. **Hairline border** — 0.5pt `rgba(1,1,1,0.9)` вокруг капли, продаёт ощущение стекла

### Жесты и анимации

| Жест                   | Поведение                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| Touch down (pan begin) | scale 0.96 (press-down) + selection haptic                         |
| Pan move               | капля следует за пальцем, stretch X (до 1.22) + squish Y (до 0.88) |
| Pan crosses slot       | `UISelectionFeedbackGenerator.selectionChanged()` (тик)            |
| Pan release            | spring к ближайшему слоту + medium impact haptic                   |
| Tap                    | мгновенный snap к слоту + selection haptic                         |

### Spring (как Apple Music)

```swift
if #available(iOS 17.0, *) {
  let timing = UISpringTimingParameters(dampingRatio: 0.78, initialVelocity: .zero)
  let animator = UIViewPropertyAnimator(duration: 0.45, timingParameters: timing)
  animator.addAnimations { ... }
  animator.startAnimation()
} else {
  // iOS 13–16: classic UIView.animate spring
}
```

### Эмиссия событий в JS

```swift
let onTabPress = EventDispatcher()  // wired by Module's Events("onTabPress")

fileprivate func emitPress(_ index: Int) {
  onTabPress(["index": index])
}
```

## JS обёртка — `TabBar.ios.tsx`

`mobile/src/navigation/TabBar.ios.tsx`

- Bar **flush с низом экрана** (как UITabBar в iOS Music / Maps), стекло
  захватывает safe area home-индикатора → нет «серого подбородка»
- Иконки и подписи рендерятся **отдельным абсолютным слоем** поверх native
  bar (`pointerEvents="none"`) — RN flex и UIView re-layout не дерутся
- Все тапы и pan идут к нативу через UIKit gesture recognizers
- Касса (центр) — компактная squircle 32×32 с SF Symbol-style плюсом и
  лейблом «Касса» снизу. Без heavy gradient, без тяжёлой dome.

## iOS-version fallback

| iOS   | Background                                                          |
| ----- | ------------------------------------------------------------------- |
| 26+   | `UIGlassEffect` (true Liquid Glass)                                 |
| 17+   | `UIBlurEffect(.systemThinMaterial)` + UIViewPropertyAnimator spring |
| 13-16 | `UIBlurEffect(.systemThinMaterial)` + classic UIView.animate spring |
| 12-   | `UIBlurEffect(.light)` (solid fallback)                             |

Капля выглядит одинаково красиво на всех версиях за счёт CAGradientLayer
и hairline border — UIGlassEffect только усиливает эффект на iOS 26+.

## Acceptance criteria

- [x] Bar flush с низом, нет серого подбородка
- [x] Native UIVisualEffectView/UIGlassEffect, не RN-фейк
- [x] Капля плавно следует за пальцем со stretch+squish
- [x] Spring snap к слоту с критическим демпфированием
- [x] Selection haptic при пересечении границы слота
- [x] Impact haptic на release
- [x] Без точек, без Android-индикаторов
- [x] Касса компактная, не тяжёлая
- [x] Safe area работает
- [x] Android не сломан (TabBar.android.tsx использует свой layout)
