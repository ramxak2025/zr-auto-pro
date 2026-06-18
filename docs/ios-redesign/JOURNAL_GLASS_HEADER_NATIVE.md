# Journal — Native Liquid-Glass header for the warehouse-docs kind chips (2026-06-19)

## Problem / motivation

The Journal screen (`mobile/src/screens/ChecksScreen.tsx`) has, on the
**Склад. документы** tab, a horizontal row of kind-filter chips
(`KIND_CHIPS`: Все / Покупки / Возврат клиента / Возврат поставщику / Брак /
Списания / Платежи / Б/У). These chips drive `warehouseKind` state →
`journalApi.warehouseDocs({ type })`.

The chips were rendered on the plain screen canvas. The owner brief: bring the
Journal header up to the quality of the native Liquid-Glass tab bar
(`AutexaLiquidGlassTabBarView.swift`) — a real iOS 26 glass material, not a flat
band — **without** changing the layout, the chip logic, or the just-shipped
kind/label correctness fix, and with a **guaranteed RN fallback** so Android /
old iOS / a missing native module keep working byte-for-byte.

## Native approach chosen

**Glass MATERIAL behind the existing RN chips** — NOT a full native chip bar.

Rationale (lowest-risk, robust option per the brief):

- The RN chips are the **source of truth** for the filter logic: per-kind accent
  colours (`journalKindVisual`), labels (`journalKindLabels`, mirrors backend
  `KIND_META`), accessibility roles/state, and dark-mode palette. Re-implementing
  all of that colour/label logic in Swift would risk diverging from the journal
  filter fix that was just shipped. So the chips stay in React Native and keep
  driving `setWarehouseKind` exactly as before.
- A native glass material strip _behind_ the chips is still a real Liquid-Glass
  upgrade — true `UIVisualEffectView` (`systemThinMaterial`, auto-upgraded to iOS
  26 `UIGlassEffect` via `NSClassFromString` runtime lookup) refracting under the
  chip row — with **zero behavioural risk**. The data flow is never forked into
  Swift.

### Native pieces

- `mobile/modules/autexa-liquid-glass/ios/AutexaGlassHeaderView.swift` — new
  `ExpoView`. Sibling of `AutexaLiquidGlassView` (tab-bar glass) reusing the exact
  same PRIMARY→FALLBACK material strategy, but tuned for a **top-of-screen header**:
  - top-edge decorative highlight (`CAGradientLayer` in `effectView.contentView`
    so it sits above the material, below the RN children),
  - optional **bottom** hairline (`bottomRim`, default off) — the separator over
    the scrolling list (the tab-bar view has a _top_ rim instead, which is wrong
    for a header),
  - `effectView` + decoration are `isUserInteractionEnabled = false` so chip taps
    pass straight through to the RN `TouchableOpacity` children.
- `AutexaGlassHeaderModule` (added to `AutexaLiquidGlassModule.swift`) — its own
  `Module` with `Name("AutexaGlassHeader")` and `View(AutexaGlassHeaderView.self)`
  exposing `variant` + `bottomRim` props. One-Module-per-view, matching the tab
  bar / Касса button pattern (avoids multi-view ambiguity).
- Registered in `expo-module.config.json` → `apple.modules` as
  `"AutexaGlassHeaderModule"`.

### JS pieces

- `mobile/modules/autexa-liquid-glass/src/AutexaGlassHeader.tsx` — JS wrapper,
  re-exported from the module `index.ts`. Renders the native view **only** on
  `Platform.OS === 'ios'` when `requireNativeViewManager('AutexaGlassHeader')`
  resolves; otherwise a **plain transparent passthrough `View`**.
- `ChecksScreen.tsx` — the kind-chips `ScrollView` is wrapped in
  `<AutexaGlassHeader variant="thinMaterial">`. The chips, their `onPress` →
  `setWarehouseKind`, the query, and all styling are **unchanged**. New style
  `kindChipsGlass` (`flexGrow/flexShrink: 0`, `alignSelf: 'stretch'`, small top
  padding) makes the glass hug the chip-row height and span full width.

## Fallback strategy (guaranteed)

| Environment                                                    | What renders                                             |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| iOS 26+, module present                                        | `UIGlassEffect` (true Liquid Glass) behind chips         |
| iOS 13–25, module present                                      | `UIVisualEffectView` + `systemThinMaterial` behind chips |
| iOS, module missing (unrelated build failure / dev playground) | transparent passthrough `View` + chips                   |
| **Android / web**                                              | transparent passthrough `View` + chips                   |

In **every** path the chips render identically and stay fully interactive — the
Journal filter is byte-for-byte the same with or without glass. The fallback is
deliberately a plain transparent `View` (not `expo-blur`): the chip strip sits
inline over the screen canvas, not over scrolling content, so a blur would just
be a flat grey band — and an always-mounted extra `UIVisualEffectView` adds
jetsam pressure (see project memory on expo-blur restraint). A plain View is the
correct "no glass available" state and guarantees no Android regression.

## What was verified

- `cd mobile && npm run typecheck` — PASS (strict tsc).
- `npm run lint` (+ explicit `eslint` on the new module file) — PASS.
- `npx jest` — **276/276 PASS** (14 suites), incl. `plateMask`.
- `npx expo prebuild --platform ios --clean` — PASS; auto-ran `pod install`.
- Autolinking — `AutexaGlassHeaderModule.self` present in the generated
  `ios/Pods/Target Support Files/Pods-Autexa/ExpoModulesProvider.swift`.
- `xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa -configuration
Debug -sdk iphonesimulator build CODE_SIGNING_ALLOWED=NO` — **BUILD SUCCEEDED**;
  `AutexaGlassHeaderView.swift` compiled for x86_64 and arm64; zero compiler
  errors. (Xcode 26.4.1, CocoaPods 1.16.2.)

### NOT verified

- No on-device / simulator runtime check — per the owner's testing flow we
  verify **compile-only** and never boot a simulator. Visual appearance and the
  iOS 26 `UIGlassEffect` light-up are confirmed by code + a clean build, not by
  a screenshot. The owner validates the look on a physical iPhone (below).

## Acceptance criteria (physical iPhone, owner)

1. Open **Журнал** → tab **Склад. документы**.
2. The kind-chip row (Все / Покупки / … / Б/У) sits on a subtle **frosted glass
   strip** (more visible on iOS 26 — true Liquid Glass), not a flat band. Content
   below scrolls; the chips read crisply over the material.
3. Every chip still toggles the filter: tapping **Покупки** shows only purchases,
   **Б/У** only used-purchase, **Все** clears — i.e. the just-shipped
   kind/label fix is intact, and the active chip still uses its per-kind accent
   colour.
4. Switching **Чеки ↔ Склад. документы** keeps the last selected chip
   (state unchanged).
5. Dark mode: chips + glass tone adapt correctly; no white band.
6. Android (if checked): the chip row looks exactly as before — plain, no glass,
   no regression.

## Files

- `mobile/modules/autexa-liquid-glass/ios/AutexaGlassHeaderView.swift` (new)
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassModule.swift` (+module)
- `mobile/modules/autexa-liquid-glass/expo-module.config.json` (+registration)
- `mobile/modules/autexa-liquid-glass/src/AutexaGlassHeader.tsx` (new)
- `mobile/modules/autexa-liquid-glass/src/index.ts` (+export)
- `mobile/src/screens/ChecksScreen.tsx` (wrap chip row + `kindChipsGlass` style)
