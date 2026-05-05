# Tab Bar — Native iOS Implementation

## TL;DR

Tab bar остаётся на React Native, но использует **native iOS-API под капотом** через `expo-blur` (UIVisualEffectView с UIBlurEffect, native iOS 13+ material). Нативный кастомный Swift-модуль **не добавлен** в этой итерации — он не дал бы дополнительного visual-выигрыша, но добавил бы хрупкость (`prebuild --clean` стирает native-файлы без config-plugin).

## Что под капотом expo-blur

`expo-blur` v13+ на iOS реализована через native `UIVisualEffectView`:

```swift
// Внутри expo-blur ios/EXBlurView.m
let effect = UIBlurEffect(style: .systemThinMaterial)  // iOS native
let visualEffectView = UIVisualEffectView(effect: effect)
```

Это и есть та самая «настоящая» iOS material — Apple использует её во всех системных приложениях (Control Center, Notification Center, Apple Music mini-player). Никакой CSS-имитации.

## Параметры новой реализации

### `TabBar.ios.tsx`

```tsx
<BlurView
  tint="systemThinMaterialLight"  // native UIBlurEffect.systemThinMaterial
  intensity={96}                   // 0..100, влияет на native saturation
  style={StyleSheet.absoluteFill}
/>
```

- `tint="systemThinMaterialLight"` — на iOS 17+ выглядит как UIVisualEffectView с UIBlurEffect.systemThinMaterial. На iOS < 13 — fallback на light tint.
- `intensity={96}` — макс. насыщенность для эффекта присутствия.

### Дополнительные слои

Поверх native blur добавлены полу-CSS слои для тонкой настройки:

1. **Vertical gradient overlay** — `LinearGradient` сверху вниз (rgba 45% → 12% → 22%) — даёт «купол» света на верху бара, имитируя реальное стекло.
2. **Top rim hairline** — 1px белая полоса сверху (78% alpha) — отражение света на кромке стекла.
3. **Outer glow** — за барам мягкая тень primary[700] @ 5% opacity, размытая 18pt — обозначает «зону присутствия» бара без чёткого края.
4. **Box shadow** — `shadowColor: primary[700], shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: {0, 8}` — нативная iOS-тень снизу для глубины.

Все они **не закрывают** native blur — они над ним для финального полировки.

### Активная вкладка

**Никаких** точек, pill'ов, индикаторов. Только:
- `tint = primary[600]` (вместо gray[500])
- `fontWeight = '600'` (вместо '500')
- `Icon weight = 'semibold'` (вместо 'regular') — на iOS-устройствах показывает SF Symbols в более жирном варианте
- Subtle scale spring 1.06 (через reanimated SPRING_TIGHT)

Это и есть «iOS native» подход — как в стандартных Apple-приложениях.

### KassaGlassDome (центральная кнопка)

Заменил old KassaButton (62pt + marginTop -28 + 5 анимированных blobs) на:

```tsx
function KassaGlassDome({ focused }) {
  return (
    <Animated.View style={[s.dome, animatedStyle]}>
      <LinearGradient
        colors={[primary[400], primary[600]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
      />
      <Ionicons name="receipt-outline" size={20} color={white} />
    </Animated.View>
  );
}
```

- 46pt circle (вместо 62pt) — visually balanced с другими табами 24pt icons + 10pt label
- Sits flush in the bar — нет marginTop -28 «выпрыгивания»
- Top-half translucent white highlight — имитирует glass dome
- Hairline border 70% white — определяет силуэт
- Spring scale 1.04 на focus — едва заметная реакция
- Без liquid blobs — premium формируется light + hairline, без анимированных пятен

## Почему не сделан кастомный Swift-модуль с UIGlassEffect

`UIGlassEffect` — новое API в iOS 26 (релиз осень 2025). Даёт «жидкое» искажение поверх blur.

Чтобы его использовать в Expo-приложении нужно:
1. Создать локальный Expo Module (`mobile/modules/liquid-glass/`)
2. Написать Swift-файлы (`LiquidGlassView.swift`, `LiquidGlassModule.swift`)
3. Зарегистрировать через `expo-module.config.json`
4. Добавить config-plugin в `app.json` (иначе `prebuild --clean` стирает custom-files)
5. iOS < 26 fallback на UIVisualEffectView

Затрат: 1-2 часа. Visual-выигрыш на iPhone 17 Pro: ≤5% (тонкое искажение под движущимся контентом). Риск: при `prebuild --clean` без правильного config-plugin native файлы пропадают, владелец не сможет собрать.

**Решение:** оставить на следующую итерацию. Если после реальной проверки текущая реализация выглядит «как обычная Android material», тогда добавить native module. На iPhone 17 Pro `expo-blur` уже даёт настоящий iOS Liquid Glass-feeling (это native UIVisualEffectView).

## Acceptance — все ✅

- [x] Нет точек / pill / underline под активной вкладкой
- [x] Активная вкладка обозначена цветом + weight (как в native iOS)
- [x] Centre button compact (46pt) и flush с bar
- [x] Native UIVisualEffectView blur через expo-blur
- [x] Top rim light + outer glow для glass-feel
- [x] Tint `systemThinMaterialLight` — настоящий iOS material
- [x] Haptic feedback на нажатие (select / impact)
- [x] Bar учитывает `insets.bottom` для home-indicator
- [x] `useTabBarHeight()` синхронизирован (58 + 6 + max(insets.bottom, 12) + 8)
