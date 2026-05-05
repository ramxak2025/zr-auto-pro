# Tab Bar — Native iOS Implementation (final)

> Updated 2026-05-04 (3rd revision). The tab bar **uses native iOS materials
> through a local Expo Module**, with iOS 26 `UIGlassEffect` as the primary
> path and `UIVisualEffectView` + `UIBlurEffect.systemThinMaterial` as the
> fallback for iOS 13–25.

## Architecture

```
React Native TabBar.ios.tsx
        ↓ uses
<AutexaLiquidGlassView />          ← TS wrapper (autexa-liquid-glass module)
        ↓ requireNativeViewManager
AutexaLiquidGlassView.swift        ← Swift native view (UIVisualEffectView)
        ├─ iOS 26+: UIGlassEffect  ← real Liquid Glass via runtime lookup
        └─ iOS 13-25: UIBlurEffect.systemThinMaterial  (premium fallback)
```

## Material strategy

| Device / OS                    | Effect actually rendered                  |
|--------------------------------|-------------------------------------------|
| iPhone 17 Pro on iOS 26.x      | **UIGlassEffect** — Apple's true Liquid Glass with subtle live refraction. Primary path. |
| iPhone 14/15/16 on iOS 17/18   | UIVisualEffectView + UIBlurEffect.systemThinMaterial — Apple's premium frosted glass material (same as Control Center, Apple Music mini-player) |
| iPhone X-13 on iOS 13-16       | UIVisualEffectView + UIBlurEffect.systemThinMaterial |
| iPhone 8/SE on iOS < 13        | UIBlurEffect.light (legacy)                |

UIVisualEffectView is **NOT** Liquid Glass — it is the proven native iOS
glass material that has shipped since iOS 13 and powers most of Apple's own
chrome. UIGlassEffect (iOS 26) is the new step up: live refraction. Our
module uses the better of the two automatically per device.

## Why UIGlassEffect is reached via runtime lookup, not direct import

`UIGlassEffect` is a brand-new symbol in the iOS 26 SDK. Most developers'
machines (and most CI runners) have older Xcode SDKs that don't know the
symbol. If we wrote `if #available(iOS 26.0, *) { effectView.effect =
UIGlassEffect() }` directly, the build would fail on any Xcode without the
iOS 26 SDK.

Solution: look the class up by name through the Objective-C runtime —

```swift
guard let cls = NSClassFromString("UIGlassEffect") as? NSObject.Type else {
  return // SDK or device doesn't have it — keep UIBlurEffect fallback
}
let instance = cls.init()
if let glass = instance as? UIVisualEffect {
  effectView.effect = glass
}
```

This compiles on every Xcode SDK and "lights up" automatically when the user
device runs iOS 26+.

## Local Expo Module — `prebuild --clean` survival

The native code lives in **`mobile/modules/autexa-liquid-glass/`**, not in
the generated `ios/` folder. When the owner runs `expo prebuild --clean`:

1. `prebuild --clean` deletes and regenerates `ios/`.
2. Expo's autolinking scanner walks `node_modules`, finds
   `node_modules/autexa-liquid-glass/expo-module.config.json` (a symlink
   to our module), and registers `AutexaLiquidGlassModule` in the
   generated `ExpoModulesProvider.swift`.
3. `pod install` (run automatically by prebuild) pulls in the Swift sources
   via `ios/AutexaLiquidGlass.podspec` from the module folder.
4. Result: native sources are linked in **fresh from `node_modules`** every
   prebuild — they cannot be lost.

This is the **canonical Expo pattern** for shipping native iOS code in a
managed Expo project. No additional config plugin file is needed; the
module's `expo-module.config.json` is the autolinking marker.

## Files added / changed

```
mobile/modules/autexa-liquid-glass/                ← NEW LOCAL MODULE
├── README.md
├── package.json
├── expo-module.config.json
├── ios/
│   ├── AutexaLiquidGlass.podspec
│   ├── AutexaLiquidGlassModule.swift
│   └── AutexaLiquidGlassView.swift
└── src/
    ├── index.ts
    ├── AutexaLiquidGlassView.tsx
    └── AutexaLiquidGlassView.types.ts

mobile/package.json                                ← +"autexa-liquid-glass": "file:./modules/autexa-liquid-glass"
mobile/src/navigation/TabBar.ios.tsx               ← BlurView → AutexaLiquidGlassView
```

## Visual layers (top-down)

1. **System material** — UIGlassEffect (iOS 26) **or** UIBlurEffect.systemThinMaterial (≤25). Done in native via UIVisualEffectView.
2. **Vertical highlight gradient** — CAGradientLayer rgba(255,255,255,0.42→0.10→0.20), top to bottom. Sits ABOVE the effect, BELOW children. Done in native (CAGradientLayer).
3. **Top hairline (1pt @ 0.78 alpha white)** — UIView constrained to top edge. Done in native.
4. **RN-rendered children** — tab icons, labels, KassaGlassDome. Inserted by React Native on top.

The gradient + hairline are pure cosmetic touches that sell the "glass
dome" feel without overpowering the native material.

## Tab bar visual contract

- ❌ No dot indicator under the active label
- ❌ No Android-style pill/underline
- ❌ No big jumping centre button (no `marginTop: -28`)
- ✅ Active tab: tint colour (primary[600]) + bold weight (600)
- ✅ Centre Касса = `KassaGlassDome` 46pt circle, flush with bar, gradient + glass highlight
- ✅ Native material via this module
- ✅ `useTabBarHeight()` returns 58 + 6 + max(insets.bottom, 12) + 8 — no content is hidden under the bar
- ✅ Haptic feedback on tap (select for tabs, impact for Касса)

## How to verify on physical iPhone

1. `cd mobile`
2. `npm install` — creates symlink `node_modules/autexa-liquid-glass` → `modules/autexa-liquid-glass`
3. `npx expo install expo-symbols` (unrelated, but needed for icons)
4. `npx expo prebuild --platform ios --clean` — autolinking will register the module; pod install will run automatically
5. `open ios/Autexa.xcworkspace`
6. In Xcode: Team = Ramazan Shamsudinov, Build Configuration = Release, target = your iPhone
7. ▶ Run

What you should see:
- **iPhone 17 Pro (iOS 26.x):** subtle live refraction through the bar — text/icons under the bar bend slightly as the bar scrolls. That's UIGlassEffect.
- **Older iPhones (iOS 13–25):** thin frosted glass that lets the wallpaper colour bleed through, with a soft top highlight. That's UIBlurEffect.systemThinMaterial.

To explicitly verify which material is active on your device, watch the
Xcode console — the module logs nothing by default; if you need to confirm,
add `print("UIGlassEffect available")` inside the `if let glass` branch in
`AutexaLiquidGlassView.swift`.

## What is NOT in this module

- No fallback for **Android** beyond a translucent solid colour. TabBar.android.tsx renders Material 3 chrome instead.
- No animated material variant changes beyond `applyVariant()`.
- No support for changing tint dynamically based on system dark/light mode (the project is `userInterfaceStyle: "light"` in `app.json`).

If/when Apple opens an animatable parameter for UIGlassEffect, we can extend
the Module's `View` definition with a new `Prop("...")`.
