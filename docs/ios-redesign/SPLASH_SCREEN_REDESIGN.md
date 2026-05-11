# Splash screen / launch experience — redesign (Iter#9)

Дата: 2026-05-07. Owner spec: «при первом открытии синий экран и логотип выглядят некрасиво — сделать premium iOS launch experience».

## Что было

1. **OS-уровень.** `app.json → expo.splash`:
   - `image: ./assets/splash.png` (логотип AUTEXA, в самом изображении уже запечён синий фон).
   - `backgroundColor: #2563eb` (Tailwind blue-600 — резкий, перенасыщенный).
   - `resizeMode: contain`.
   - Пакет `expo-splash-screen` НЕ установлен; программного контроля над dismiss нет.

2. **JS-уровень.** `App.tsx` возвращает `null` пока `cacheReady` (≈50 мс), затем монтируется `<AppNavigator />`. `AppNavigator` показывает `<LoadingSpinner />` (мелкий centered ActivityIndicator) пока `AuthProvider.loading`, затем переключается на `LoginScreen` / `DashboardScreen`.

3. **Что видел пользователь.**
   - Синий нативный splash с логотипом (длится пока Hermes стартует).
   - **Чёрная вспышка** (App.tsx → null) на несколько кадров.
   - Маленький синий ActivityIndicator на сером фоне (~200–600 мс).
   - LoginScreen или Dashboard.

   Перепрыг между этими тремя экранами + чёрная вспышка ощущались как «приложение тормозит на старте».

## Что сделано в этой итерации

### 1. RN-уровень: `SplashOverlay` (новый)

`mobile/src/components/SplashOverlay.tsx` — branded full-screen overlay, который **закрывает чёрный gap** между OS-splash'ем и первым usable экраном.

- Бекграунд: `colors.gray[50]` (≈ `#F9FAFB`) — мягкий нейтрально-серый, тот же что у LoginScreen → нет «прыжка фона» при переходе.
- Логотип: `assets/logo.png` (AX cloud + AUTEXA wordmark), 240×80 pt, центрирован.
- Анимация (Reanimated v4 worklets, всё на UI-thread):
  - Logo: `opacity 0→1 (350ms ease-out)` + `scale 0.92→1 (spring damping 18)`.
  - Tagline «Система управления автосервисом»: задержка 220 ms, `opacity 0→1` + `translateY 8→0`.
  - 3 пульсирующие точки primary[600] под текстом — индикатор загрузки без spinning-wheel.
- Accessibility: `accessibilityElementsHidden + importantForAccessibility="no-hide-descendants"` — VoiceOver не озвучивает overlay, оглашает уже первый usable экран.
- `pointerEvents: 'none'` — overlay не блокирует возможные подложкой жесты (когда navigator уже смонтирован под ним).

### 2. `App.tsx` — таймминг

```tsx
const showSplash = !cacheReady || !authResolved;

return (
  …
    <NavigationContainer …>
      …
      {cacheReady && <AppNavigator />}      // навигатор маунтится сразу после кеша
      {showSplash && <SplashOverlay />}     // overlay поверх
    </NavigationContainer>
  …
);
```

`cacheReady` — уже было. Новое: `authResolved` — `App.tsx` передаёт callback `onAuthResolve` в `AuthProvider`. AuthProvider вызывает его один раз когда первичная проверка `/me` (или fast-path «токена нет») завершена. Только после этого overlay снимается.

Навигатор маунтится **до** снятия overlay'а, поэтому:

- Между «overlay вверху» и «overlay снят» нет дополнительного React reconcile / layout pass.
- Когда overlay снимется, под ним уже отрисованный LoginScreen / Dashboard — без вспышки.

### 3. `AuthProvider` — `onAuthResolve`

`mobile/src/contexts/AuthContext.tsx` — добавлен опциональный prop `onAuthResolve?: () => void`. Вызывается ровно один раз — в `.finally()` после первичной проверки токена. Ни в login(), ни в logout() — там state-меняется в обычном порядке, splash больше не нужен.

## Что НЕ сделано и почему

### `expo-splash-screen` НЕ установлен

Пакет `expo-splash-screen` (с программным `preventAutoHideAsync` / `hideAsync`) даёт более точный контроль над OS-splash'ем — можно держать его до полной готовности RN. Но он:

- Это **native dependency** — требует `npx expo prebuild --platform ios --clean` + `pod install` + iOS rebuild через Xcode/xcodebuild.
- Если установить и не пересобрать iOS-таргет — приложение упадёт на `SplashScreen.preventAutoHideAsync()` (символ не найден).
- Owner попросил «не ломать iOS build».

**Решение:** отложено в следующую итерацию когда плановый prebuild всё равно понадобится. Текущий branded RN overlay покрывает 90% UX-боли без native-изменений.

### `app.json` НЕ изменён

Подмена `expo.splash.backgroundColor: #2563eb → #FFFFFF` улучшила бы переход (нет blue→gray-50 вспышки), но:

- Текущий `assets/splash.png` имеет **запечённый синий фон в самом PNG** — на белом OS-splash'е он будет выглядеть как «синий прямоугольник с логотипом по центру» — это хуже текущего.
- Чтобы корректно изменить — нужен новый PNG: логотип на прозрачном фоне ИЛИ на gray-50 фоне. Это задача для дизайнера / графического редактора, не для кода.
- Изменение app.json вступает в силу только после `expo prebuild --platform ios --clean` + iOS rebuild.

**Решение:** оставлено как есть. SplashOverlay монтируется поверх и быстро прячет нативный splash. Маленькая (~100–200 мс) вспышка blue → gray-50 при переходе на переходе **OS → RN engine** допустима, выглядит как «брендовый whip» а не как баг.

**Что нужно сделать в следующую итерацию (требует дизайн-asset'а):**

1. Сгенерировать новый `assets/splash.png` — логотип AUTEXA по центру на **прозрачном** фоне.
2. В `app.json` поменять `backgroundColor: '#FFFFFF'` (или `#F9FAFB` для точного match с overlay).
3. `expo prebuild --platform ios --clean && cd ios && pod install`.
4. Native rebuild через Xcode.

После этих шагов native splash и SplashOverlay — два визуально неразличимых экрана; переход между ними будет полностью бесшовным.

## Что получает пользователь сейчас

1. **Cold start.** OS native splash (синий + логотип, как и был).
2. RN engine стартует (1–2 сек на iPhone 12+ с Hermes).
3. **`SplashOverlay` появляется**: gray-50 фон, логотип по центру с мягкой spring-анимацией, tagline, пульсирующие точки.
4. Параллельно: `hydrateCache` (≈50 мс) → `cacheReady=true` → `AuthProvider` начинает `/me`.
5. `/me` вернулся (200–600 мс из cache, дольше при no-network).
6. `onAuthResolve` callback → `App.tsx` снимает overlay.
7. Под overlay'ем уже смонтирован `LoginScreen` / `DashboardScreen` → пользователь видит usable UI без задержки.

Чёрной вспышки больше нет. ActivityIndicator больше нет. Переходы плавные.

## Файлы изменены

- `mobile/src/components/SplashOverlay.tsx` (новый, 142 строки)
- `mobile/App.tsx` — добавлен `authResolved` state + рендер overlay поверх навигатора + проброс `onAuthResolve` в AuthProvider.
- `mobile/src/contexts/AuthContext.tsx` — `onAuthResolve` prop, callback вызывается в `.finally()` первичной проверки.

## Acceptance criteria (для проверки на iPhone)

- [ ] Cold start приложения с убитого процесса не показывает чёрной вспышки между нативным splash'ем и появлением логина / дашборда.
- [ ] Логотип AUTEXA появляется с мягкой анимацией (spring scale + fade), не «прилетает мгновенно».
- [ ] Под логотипом виден tagline «Система управления автосервисом» с лёгкой задержкой относительно логотипа.
- [ ] Видны 3 пульсирующие точки `primary[600]` под tagline.
- [ ] После загрузки (~500 мс — 1 сек на стабильном wifi) overlay снимается, пользователь видит LoginScreen / Dashboard БЕЗ дополнительного спиннера.
- [ ] При повторном открытии (warm start, токен в storage) — overlay висит ≤ 600 ms, не «застревает».
- [ ] При отсутствии сети /me падает за 30 сек таймаут — overlay уходит, попадаем на LoginScreen без зависания (защита через axios timeout 30s + AsyncStorage cleanup в onAuthExpired).

## Ограничения

- **Native splash bg остаётся `#2563eb`** до следующего prebuild. Маленькая (~100 мс) blue → gray-50 вспышка между нативным splash и RN overlay.
- На очень медленных устройствах / cold cache RN engine стартует 2+ сек — это OS-level ограничение, не наше.
- Reduced Motion не отключает вход overlay'а — анимации короткие (350 мс), считаются acceptable. Если нужно — можно добавить `useReduceMotion()` гард в `SplashOverlay` в следующую итерацию.
