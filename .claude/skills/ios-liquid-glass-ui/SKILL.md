---
name: ios-liquid-glass-ui
description: Edge-to-edge iOS layout, Liquid Glass floating tab bar, Safe Area / Dynamic Island / Home Indicator, SF Symbols, iOS typography, motion. Use when user asks for "premium iOS", "Liquid Glass", "floating tab bar", "fullscreen / edge-to-edge", "looks like content is in a box", or any header/bar/safe-area issue.
---

# ios-liquid-glass-ui

## When to use

- Visible "boxed app" complaint — content feels framed.
- Floating tab bar isn't behaving like a glass overlay.
- Safe area / Dynamic Island clipping issues.
- Need for SF Symbols or iOS-native motion.

## Files / docs to read first

- `mobile/CLAUDE.md`
- `docs/ios-redesign/SWIFT_LIQUID_GLASS_TAB_BAR.md`
- `docs/ios-redesign/IOS26_LIQUID_GLASS_VISUAL_SYSTEM.md`
- `mobile/src/navigation/AppNavigator.tsx` — Tab.Navigator config
- `mobile/src/navigation/TabBar.ios.tsx` — JS-side floating island
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassTabBarView.swift`
- `mobile/src/hooks/useTabBarHeight.ts`
- `mobile/src/components/IosScreenHeader.tsx`
- `mobile/src/platform/Icon.tsx`

## Workflow

1. Confirm root cause: is it the screen wrapper bg, the tab navigator scene bg, or the safe-area edges? Check by reading the AppNavigator's `sceneStyle` and each screen's outer `<View>` / `<SafeAreaView>`.
2. Make screen container backgrounds continuous (no two-tone). Header should be transparent.
3. ScrollViews on tab screens must use `contentInset.bottom = useTabBarHeight()` — NOT `paddingBottom`. iOS-only pattern.
4. Tab bar JS wrapper: no own `backgroundColor`. Native Swift glass surface owns the look.
5. Tab icons: filled SF Symbol variants in tab bar slots; outlined elsewhere if needed.
6. Касса button: glass + brand gradient overlay + SF Symbol white.

## Acceptance criteria

- No two-tone discontinuity between header zone and content.
- Last list items pass under glass tab bar visibly.
- Tab bar feels like glass overlay, not a base panel.
- Status bar zone has the same fill as the rest.

## Checks

`npm run typecheck && npm run lint && npx jest` plus `npx expo prebuild --platform ios --clean && cd ios && pod install && cd .. && xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa -sdk iphonesimulator build`.

## Risks

- Removing `<SafeAreaView edges>` can let content slip under Dynamic Island.
- Changing `Tab.Navigator.sceneStyle` affects ALL screens at once.
- iOS 26 `UIGlassEffect` runtime upgrade requires `NSClassFromString("UIGlassEffect")` lookup, never a direct cast against an old SDK.

## Forbidden

- Hard-coded heights replacing `useSafeAreaInsets()`.
- Solid fill on JS-side tab bar wrapper (kills the glass).
- Changing backend / API.

## Final report format

1. Root cause identified. 2) Screens touched (full list of paths). 3) Native files touched. 4) Acceptance check on iPhone (what to look for).
