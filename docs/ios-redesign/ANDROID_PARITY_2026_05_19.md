# Android parity pass — 2026-05-19

Sibling document to the iOS redesign that landed across commits between
`d064bc8` (splash) and `ac5283d` (services perf). The iPhone-tested
flows are now mirrored on Android using **Material 3 (Material You)
idioms** instead of literal copies of iOS chrome.

The goal was a polished Android product, not a port of an iOS look:
where the M3 spec calls for different geometry, ripple, or surface
treatment, we follow M3 — and only where the brand owns the moment
(e.g. the central «Касса» CTA) do we keep the iOS visual.

## Material 3 decisions vs iOS

| Element | iOS | Android (M3) | Why |
|---|---|---|---|
| Bottom navigation | Floating-island glass pill (UIVisualEffectView + native droplet indicator, Swift) | 80pt opaque NavigationBar with 32×64 active-indicator pill in `primary[100]`, ripple state-layer | M3 spec `NavigationBar`; iOS Liquid Glass has no Android equivalent and a fake-blur slab feels worse than a clean M3 surface |
| Tab icons | Filled SF Symbols, slight scale on focus | Filled MCI on active / outlined MCI on inactive — the M3 filled/outlined transition | MCI ships both variants; the filled/outlined swap is the canonical M3 active-state cue |
| Central «Касса» | Native plasma button popping up out of the slim 60pt island | Same plasma button, but kept **inside** the 80pt bar (no FAB cut-out) | Brand identity; M3-compatible inside the bar surface, no cut-out arithmetic |
| Top app bar (`IosScreenHeader`) | Transparent, optional centre title | Opaque surface, always-visible hairline divider, left-aligned title | M3 Small Top App Bar always has a divider and left-aligns the title |
| Press feedback | Spring scale + tap haptic | Native `android_ripple` in `primary[600]@12%` (M3 state-layer tone), no scale | Material doesn't do scale; ripple is the only native press cue on Android |
| Alert dialog corner | 20pt squircle | 28pt extra-large container corner | M3 dialog uses the `corner.extra-large` token (28pt) |
| Alert dialog buttons | 48pt tall, 14pt squircle | 40pt tall, pill (radius = height/2 = 20pt) | M3 buttons are pill-shaped |
| Status bar | Translucent over content, dark icons | `windowTranslucentStatus=true` + `windowLightStatusBar=true` (dark icons over transparent) | M3 edge-to-edge layout convention |
| Navigation bar (system) | n/a | `navigationBarColor = gray[50]`, `windowLightNavigationBar = true` (dark icons) | Tonal navigation bar that matches the screen surface |
| Predictive back | Native swipe-back through nav-stack | `android:enableOnBackInvokedCallback="true"` (Android 13+) | Material You convention; falls back gracefully on pre-API-33 |
| Blur (fullscreen photo viewer) | `expo-blur intensity=90 tint=dark` | `intensity=24` capped + translucent dark scrim layer | High-intensity expo-blur is expensive and flaky on Android; the scrim gives equivalent perceived contrast |
| FlashList on heavy screens (Checks, Products) | Default (iOS clips off-screen automatically) | Explicit `removeClippedSubviews` | Off-screen rows otherwise sit in the draw tree during flings |

## Files touched

### Navigation / chrome

- `mobile/src/navigation/TabBar.android.tsx` — full rewrite as the M3 NavigationBar (80pt surface, filled/outlined glyph pair via MaterialCommunityIcons, ripple state-layer, scale+alpha indicator pill).
- `mobile/src/navigation/KassaButton.tsx` — platform-conditional `marginTop` so the central button doesn't poke out of the 80pt bar on Android.
- `mobile/src/hooks/useTabBarHeight.ts` — Android returns `80 + max(insets.bottom, 8)` to match the new bar height.
- `mobile/src/components/IosScreenHeader.tsx` — on Android, force the hairline divider on and left-align the title (M3 Small Top App Bar).

### Edge-to-edge + splash + back

- `mobile/app.json`:
  - `androidStatusBar`: `{ translucent: true, barStyle: dark-content, backgroundColor: "#00000000" }` — transparent over content.
  - `androidNavigationBar`: `{ barStyle: dark-content, backgroundColor: "#f9fafb" }` — tonal nav bar matching the screen surface.
  - `android.softwareKeyboardLayoutMode = "pan"` — bar stays in place when the keyboard appears.
  - `android.splash` mirror of the global splash so the Android 12+ SplashScreen API picks it up at prebuild.
  - New plugin `./plugins/withAndroidPredictiveBack.js` enables Predictive Back (Android 13+).
- `mobile/plugins/withAndroidPredictiveBack.js` — new config plugin that flips `android:enableOnBackInvokedCallback` to `true` on the `<application>` tag during prebuild.

### Dialogs + modals

- `mobile/src/components/Modal.tsx` — Android branch uses 28pt container corner (M3 `corner.extra-large` token).
- `mobile/src/components/ConfirmDialog.tsx` — Android branch uses pill-shaped buttons (radius = 999) instead of the iOS 14pt squircle.
- `mobile/src/screens/EquipmentScreen.tsx` (CenteredDialog) — Android branch: 28pt card corner + 40pt pill buttons; iOS keeps 20pt + 48pt.

### Performance

- `mobile/src/screens/ChecksScreen.tsx` — both FlashList instances (journal + warehouse-docs) now set `removeClippedSubviews`.
- `mobile/src/screens/ProductsScreen.tsx` — main FlashList (heavy product rows with CachedImage thumbnails) sets `removeClippedSubviews`; fullscreen photo viewer caps `BlurView intensity` at 24 on Android and adds a translucent dark scrim layer for the same perceived contrast.

### Already cross-platform (verified, no change needed)

- `mobile/src/platform/PressableScale.tsx` — Android branch was already using `android_ripple` and disabling the scale animation. No edit.
- `mobile/src/components/GlassSurface.tsx` — Android branch was already rendering a translucent surface instead of `BlurView`. No edit.
- `mobile/src/components/CachedImage.tsx` — already uses `cachePolicy: 'memory-disk'` from `expo-image` on every platform.
- `mobile/src/platform/haptics.ts` — already routes Android intents to the softer `ImpactFeedbackStyle.Soft / Medium` pair.
- `mobile/src/platform/motion.ts` — iOS spring presets coexist with M3 emphasised easing presets; consumers pick.
- `mobile/src/platform/Icon.tsx` — shared `Icon` abstraction already returns Material Community Icons on Android.
- All `RNModal` instances already wire `onRequestClose` — Android system back / Predictive Back closes them automatically.

## iOS regressions — none

Every change is either inside an `.android.tsx` file (Metro picks by extension), or branched via `Platform.OS === 'android'`, or platform-agnostic (e.g. `removeClippedSubviews` works fine on iOS too).

Verified locally:

- `npm run typecheck` — green.
- `npm run lint` — green, no new warnings.
- `npx jest` — 38/38 tests pass (plate-mask + others).
- `npx expo prebuild --platform android --clean` — succeeded; warnings reported are non-fatal (`userInterfaceStyle` needs `expo-system-ui`; `androidStatusBar.backgroundColor` "conflict" warning is a known Expo false-positive when status bar is transparent).
- `cd mobile/android && ./gradlew :app:assembleDebug --no-daemon` — see "Build verification" below.

## Build verification

Run on the developer's Mac (the only environment with the Android SDK):

```bash
cd mobile
npx expo prebuild --platform android --clean
cd android
./gradlew :app:assembleDebug --no-daemon
```

The first `assembleDebug` after a clean prebuild downloads several Gradle plugins + the Android Gradle Plugin and typically takes 5-10 minutes on a M-series Mac. Subsequent incremental builds are ~30s.

The resulting APK is at `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (~80 MB).

## Owner acceptance checklist on Android device

Smoke-test on a physical Android device or emulator (API 30+):

### Edge-to-edge + system chrome
- [ ] Status bar icons are dark on light surfaces (no light/light invisible icon issue).
- [ ] Status bar background is transparent — screen surface (gray-50) reaches the very top edge.
- [ ] System navigation bar (gesture or 3-button) matches `gray[50]` and doesn't visually clip the M3 NavigationBar.
- [ ] On Android 13+ swipe-back from the left edge shows the Predictive Back peek animation.

### M3 NavigationBar
- [ ] Bar is 80pt tall, opaque white surface, single hairline divider on top.
- [ ] Active destination shows a primary-tinted pill (`primary[100]`) behind the icon — fades + scales in on focus change.
- [ ] Inactive destinations show outlined glyphs; active shows filled.
- [ ] Tap on a destination shows a circular ripple in primary tone.
- [ ] Central «Касса» button still pulses with the gradient plasma, sits inside the bar surface (no cut-out).
- [ ] Tap on «Касса» fires a soft impact haptic, navigates to the cash screen.

### Top app bar (every screen)
- [ ] Each screen with `IosScreenHeader` shows a hairline divider below the title.
- [ ] Title is left-aligned (not centered) on Android.
- [ ] Status-bar-zone safe area is respected on devices with a notch/punch-hole.

### Dialogs
- [ ] Equipment "report issue" dialog: 28pt corner, pill buttons.
- [ ] Confirm dialogs (e.g. delete product): pill buttons.
- [ ] System back closes the dialog without exiting the screen.

### Splash
- [ ] App launches: brief OS-level splash (`splash-blank.png` gray-50) → JS `SplashOverlay` with branded logo + tagline + dot pulse → first usable screen.
- [ ] No black flash between OS splash and JS splash.

### Performance
- [ ] Journal (Checks tab) fast scroll through 100+ rows is smooth (no jank).
- [ ] Products tab fast scroll through a category with many photo thumbnails is smooth.
- [ ] Tab swap between Dashboard / Products / Checks / Ещё keeps previous screen instantly visible (TanStack Query SWR + persistent cache work).
- [ ] Cold-start: cached screens show data immediately, not a loading spinner.

## Known gaps + follow-ups

1. **No physical Android device test by the developer agent.** This pass was verified by static analysis + typecheck + lint + jest + a successful Android prebuild. The Gradle `assembleDebug` was started on the developer's Mac, but the resulting APK has not been installed on a real device or emulator to confirm the runtime behaviour matches the M3 spec. Owner should run on his Android device or an Android Studio emulator (API 30+).

2. **`expo-system-ui` not installed.** Expo's prebuild warns: `android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature.` We have `"userInterfaceStyle": "light"` in `app.json` — on Android this currently has no effect (the OS theme is light by default). Installing `expo-system-ui` would lock in light-mode explicitly and avoid surprises if a user enables system-wide dark mode. Low priority — the visual design is light-only by product decision today.

3. **`androidStatusBar.backgroundColor` "conflict" warning.** Expo's prebuild warns: `android: androidStatusBar.backgroundColor: Color conflicts with the splash.backgroundColor`. This is a known Expo CLI false-positive when status bar is configured transparent (`#00000000`) over a splash colour: the warning checks for exact colour-equality and reports any difference, including transparent-vs-opaque. The generated `styles.xml` is correct (`<item name="android:statusBarColor">@android:color/transparent</item>`). Leave as is.

4. **`android.newArchEnabled` is deprecated.** Expo warns it's moved to top-level `newArchEnabled` (which we already have set to `true`). The duplication inside `expo-build-properties → android` is technically redundant but harmless. Can be removed in a future cleanup.

5. **Material 3 NavigationBar "elevation"**. M3 calls for an optional tonal elevation token on the nav bar; we chose the flat hairline-divider variant because it matches our overall flat brand. If the owner wants the bar to "lift" off the surface, add `elevation: 3` to `styles.wrapper` in `TabBar.android.tsx`.

6. **Splash backgroundColor for Android 12+ adaptive launcher**. The `app.json android.splash.backgroundColor` is `#f9fafb` (gray-50, same as the global splash). On a physical Android 12+ device this becomes the SplashScreen API window background. The Adaptive Icon foreground (`./assets/adaptive-icon.png`) is centered on it. If the owner wants the splash bg to match the adaptive-icon background colour (`#2563eb` — primary blue), we'd need to choose: keep the bg consistent with the JS SplashOverlay (gray-50, matching) OR with the launcher icon (blue, more dramatic). Currently we chose **matching**.

## Commits in this pass

1. `refactor(android-tabbar): Material 3 NavigationBar` — the new 80pt bar + filled/outlined icons + indicator pill.
2. `feat(android): edge-to-edge + Material 3 dialog geometry + perf tuning` — app.json status/nav bar + splash mirror + softwareKeyboard pan; dialogs with M3 corners and pill buttons; FlashList `removeClippedSubviews` on heavy screens; capped BlurView intensity on Android with translucent scrim.
3. `feat(android): Material 3 top app bar — divider + left-aligned title` — IosScreenHeader divider + left-align on Android.
4. `fix(android-tabbar): KassaButton fits inside 80pt M3 bar` — central CTA stays inside the bar surface.
5. (next) `feat(android): Predictive Back + parity doc`.
