# autexa-liquid-glass

Local Expo Module providing a **native iOS Liquid Glass surface** for Autexa.

## What it does

Wraps a native `UIVisualEffectView` and exposes it to React Native as
`<AutexaLiquidGlassView />`. On iOS 26+, the effect is auto-upgraded to
Apple's brand-new `UIGlassEffect` (real Liquid Glass with refraction) via
runtime class lookup — the module compiles on any Xcode SDK.

## Material selection

| iOS version | Effect used |
|-------------|-------------|
| iOS 26+     | **UIGlassEffect** — real Liquid Glass (primary path) |
| iOS 13–25   | UIVisualEffectView + UIBlurEffect.systemThinMaterial (premium native fallback) |
| iOS < 13    | UIBlurEffect.light (legacy fallback) |

Both materials are layered with a CAGradientLayer (top-down white →
translucent) and a 1pt white hairline at the top edge for the "glass dome"
highlight.

## Why a local Expo Module (not a config plugin)

A local Expo Module is the **canonical Expo way** to ship native code that
**survives `expo prebuild --clean`**:

1. The module lives in `mobile/modules/autexa-liquid-glass/`.
2. `mobile/package.json` references it as `"autexa-liquid-glass": "file:./modules/autexa-liquid-glass"`.
3. `npm install` creates a symlink in `node_modules/autexa-liquid-glass`.
4. `expo prebuild` runs autolinking — finds the module via
   `expo-module.config.json` and registers it in
   `ios/Pods/Target Support Files/...`.
5. `pod install` (run automatically by prebuild) pulls in the Swift sources
   via `ios/AutexaLiquidGlass.podspec`.
6. Result: the native files are NEVER copied into `mobile/ios/` directly —
   they live in `node_modules` and are linked in fresh on every prebuild.

This means:
- `expo prebuild --clean` is fully safe.
- No manual `ios/` modifications.
- No additional config plugin file is needed.
- The owner's workflow stays simple: `npm install && npx expo prebuild --clean && open ios/Autexa.xcworkspace`.

## Public API

```tsx
import { AutexaLiquidGlassView } from 'autexa-liquid-glass';

<AutexaLiquidGlassView
  variant="thinMaterial"      // ultraThinMaterial | thinMaterial | material | thickMaterial | chromeMaterial
  intensity={1}                // 0..1, alpha multiplier
  topRim={true}                // 1px white hairline at the top edge
  style={StyleSheet.absoluteFill}
>
  {/* Children render ON TOP of the glass material */}
</AutexaLiquidGlassView>
```

## Files

```
mobile/modules/autexa-liquid-glass/
├── README.md                              # this file
├── package.json                           # name, version, file:-style export
├── expo-module.config.json                # autolinking marker for Expo
├── ios/
│   ├── AutexaLiquidGlass.podspec          # CocoaPods spec
│   ├── AutexaLiquidGlassModule.swift      # ExpoModulesCore Module declaration
│   └── AutexaLiquidGlassView.swift        # UIVisualEffectView + UIGlassEffect upgrade
└── src/
    ├── index.ts
    ├── AutexaLiquidGlassView.tsx          # JS wrapper with native + fallback
    └── AutexaLiquidGlassView.types.ts
```

## Fallback behaviour

If for any reason the native module is missing (e.g. dev playground, JS-only
test runner, unrelated build failure), the JS wrapper silently falls back to
`expo-blur` (which is also `UIVisualEffectView` under the hood — but without
the iOS 26 `UIGlassEffect` upgrade).

On Android, falls back to a translucent solid surface — this module is
iOS-only by design.

## Testing on a physical iPhone

1. `cd mobile && npm install`
2. `npx expo prebuild --platform ios --clean`
3. `open ios/Autexa.xcworkspace`
4. In Xcode: Team = your Apple Developer team, Build Configuration = Release
5. ▶ Run on a physical iPhone (UIVisualEffectView and UIGlassEffect render
   only minimally on the simulator — go physical for the real visual)

You should see:
- iOS 17/18: a thin frosted glass tab bar with subtle highlights.
- iOS 26+ (iPhone 17 Pro on shipped iOS 26.x): subtle live refraction
  through the bar — true Liquid Glass.
