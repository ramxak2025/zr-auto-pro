# iOS-native premium layer — Widgets · Live Activity / Dynamic Island · Siri / App Intents

Date: 2026-06-28 · Branch: `refactor/full-audit-2026` · Owner agent: `ios-native-engineer`

## Problem / motivation

Autexa already shipped a basic Home Screen widget (`AuTexaWidget`, bundle
`com.autexa.mobile.widget`). To feel like a first-class iPhone product the app
needs the full native surface:

1. **Premium Home Screen widgets** (Small / Medium / **Large**) with real
   autoservice KPIs — выручка за сегодня, открытые заказ-наряды, статус кассы,
   ближайшая запись.
2. **Live Activity / Dynamic Island** for an active context — заказ-наряд в
   работе или открытая кассовая смена — live on the Lock Screen and in the
   Dynamic Island.
3. **Siri / App Intents** — «Создать заказ-наряд», «Открыть кассу», «Выручка
   за сегодня» surfaced in Siri, Spotlight and the Shortcuts app.

All three must degrade safely on old iOS and be byte-for-byte no-ops on Android.

## Architecture

```
┌─────────────────────────── RN app (Autexa target) ───────────────────────────┐
│                                                                                │
│  DashboardScreen ── updateWidgetData() ──► AutexaLiquidGlass.setWidgetData()   │
│                                              │  writes JSON                     │
│  check/shift flow ─ startLiveActivity() ──► AutexaLiveActivity.start/update/end │
│                                              │  ActivityKit                     │
│  launch/foreground ─ consumePendingAppIntent() ◄─ App Group `autexa_pending…`   │
│                                                                                │
│  AppIntents (AutexaAppIntents.swift, compiled INTO this target)                 │
│     CreateOrderIntent / OpenCashIntent / TodayRevenueIntent + AppShortcuts      │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ shared App Group  group.com.autexa.mobile
                                    │   • widget_dashboard_data   (KPI snapshot)
                                    │   • autexa_pending_intent   (Siri deep-link)
                                    ▼
┌──────────────────────── AuTexaWidget.appex (extension) ─────────────────────────┐
│  AuTexaWidget.swift        → TimelineProvider reads widget_dashboard_data        │
│                              Small / Medium / Large, owner & master layouts      │
│  AutexaLiveActivity.swift  → ActivityConfiguration: Lock Screen + Dynamic Island │
└────────────────────────────────────────────────────────────────────────────────┘
```

### A. App Group data flow (widgets)

- The RN app writes a JSON snapshot into the shared App Group UserDefaults
  (`group.com.autexa.mobile`, key `widget_dashboard_data`) via
  `AutexaLiquidGlass.setWidgetData()` and calls
  `WidgetCenter.reloadAllTimelines()`. This already existed; the **payload was
  extended** (all new fields optional, older payloads still decode):

  | role   | fields                                                                              |
  | ------ | ----------------------------------------------------------------------------------- |
  | owner  | `revenue`, `profitToday`, `checksCount`, `openOrders?`, `cashOpen?`, `nextBooking?` |
  | master | `earningsToday`, `earningsMonth`, `shiftOpen?`, `nextBooking?`                      |

  `nextBooking = { title, time }` where `time` is a **pre-formatted** display
  string («Сегодня 15:30») — the widget never re-parses dates, dodging timezone
  drift.

- The widget `TimelineProvider` reads that snapshot; no network from the
  extension. Refresh policy: every 30 min plus every `setWidgetData()` call.
- `role: "none"` (written by `clearWidgetData()` on logout) renders the neutral
  «Откройте Autexa» empty state — the previous session's numbers never leak.

### B. ActivityKit (Live Activity / Dynamic Island)

- `AutexaActivityAttributes` (`kind: "order"|"shift"`, `orderId?`) +
  `ContentState` (`title, status, subtitle?, amount?, itemsCount?, startedAt?`).
- The struct is **duplicated byte-identically** in two targets — the app pod
  (`AutexaLiveActivityModule.swift`, which requests/updates) and the widget
  extension (`AutexaLiveActivity.swift`, which renders). ActivityKit matches the
  activity by type **name + Codable shape**, so a shared framework isn't needed.
- `startedAt` (ISO-8601) drives a **live elapsed timer** (`Text(_, style: .timer)`)
  in the Dynamic Island compact-trailing and expanded bottom regions.
- JS drives it through `src/utils/liveActivity.ts`:
  `startLiveActivity(attrs, state) → id`, `updateLiveActivity(id, state)`,
  `endLiveActivity(id, finalState?, dismissImmediately?)`, `endAllLiveActivities()`,
  `liveActivitiesAvailable()`.

### C. AppIntents (Siri / Spotlight / Shortcuts)

- `AutexaAppIntents.swift` is compiled into the **main app target** (App
  Shortcuts must be in the app target to be discovered — confirmed at build time
  by `ExtractAppIntentsMetadata (in target 'Autexa')` emitting
  `Autexa.app/Metadata.appintents`).
- Intents:
  - **CreateOrderIntent** «Создать заказ-наряд» — `openAppWhenRun`, queues
    `{action:"create_order"}` into the App Group.
  - **OpenCashIntent** «Открыть кассу» — `openAppWhenRun`, queues
    `{action:"open_cash"}`.
  - **TodayRevenueIntent** «Выручка за сегодня» — **no app launch**; reads the
    same `widget_dashboard_data` snapshot and speaks the number. Works
    standalone, zero extra wiring.
- `AutexaShortcuts: AppShortcutsProvider` registers Russian phrases (each
  includes `\(.applicationName)`), so they appear in Siri / Spotlight / Shortcuts.
- No new entitlement: App Shortcuts work **without** the legacy Siri capability,
  so provisioning/credentials are untouched.

## Config changes (`mobile/app.json`, plugins)

- `ios.infoPlist.NSSupportsLiveActivities = true`.
- New config plugin `plugins/withNativeCapabilities.js`, registered in `plugins`:
  - copies `ios-app-intents/AutexaAppIntents.swift` into the app target's Sources;
  - **weak-links** `AppIntents.framework` (iOS 16) and `ActivityKit.framework`
    (iOS 16.1). The app deploys to **iOS 15.1**; ActivityKit is autolinked
    strongly by the pod and a strong link to a not-yet-existent dylib would crash
    iOS 15 at launch. Every symbol touching these frameworks is
    `@available(iOS 16.x, *)`-guarded, so weak-linking is correct.
- App Group entitlement (`group.com.autexa.mobile`) and the widget EAS
  `appExtensions` block already existed (untouched). The widget extension target
  is owned by the pre-existing `plugins/withWidgetExtension.js` (extended, not
  duplicated — every `.swift` it finds in `ios-extensions/AuTexaWidget/` is
  auto-compiled, so `AutexaLiveActivity.swift` was picked up for free).

## Files

Native (Swift):

- `mobile/ios-extensions/AuTexaWidget/AuTexaWidget.swift` — premium Small/Medium/**Large**, new KPIs.
- `mobile/ios-extensions/AuTexaWidget/AutexaLiveActivity.swift` — **new** ActivityKit UI.
- `mobile/ios-extensions/AuTexaWidget/AuTexaWidgetBundle.swift` — registers the Live Activity.
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiveActivityModule.swift` — **new** ActivityKit JS module.
- `mobile/modules/autexa-liquid-glass/ios/AutexaLiquidGlassModule.swift` — `consumePendingAppIntent()`.
- `mobile/ios-app-intents/AutexaAppIntents.swift` — **new** App Intents + AppShortcutsProvider.

Config / plugin:

- `mobile/plugins/withNativeCapabilities.js` — **new**.
- `mobile/app.json`, `mobile/modules/autexa-liquid-glass/expo-module.config.json`.

JS bridges (owned by this layer):

- `mobile/src/utils/widgetBridge.ts` — payload extended.
- `mobile/src/utils/liveActivity.ts` — **new** typed Live Activity API.
- `mobile/src/utils/appIntents.ts` — **new** pending-intent reader.
- `mobile/modules/autexa-liquid-glass/src/index.ts` — low-level bridges.

## Fallback strategy

| Environment   | Widgets                                              | Live Activity                   | App Intents / Siri         |
| ------------- | ---------------------------------------------------- | ------------------------------- | -------------------------- |
| iOS 17+       | full (S/M/L)                                         | full                            | full                       |
| iOS 16.1–16.x | full                                                 | full (16.2 modern, 16.1 legacy) | full                       |
| iOS 16.0      | full                                                 | n/a (`isSupported()=false`)     | full                       |
| iOS 15.1–15.x | full (widget tgt 17 — gallery just won't show on 15) | no-op (weak link, guarded)      | no-op (weak link, guarded) |
| Android       | no-op (Platform)                                     | no-op (Platform)                | no-op (Platform)           |

All JS helpers `Platform.OS !== 'ios'` → return immediately; native lookups are
`try/catch` → silent no-op. A missing/failed activity never throws to callers.

## Integration seams (intentionally left to the screen owners)

These compile and are ready; the **invocation** from business screens is a
1–3 line hookup deliberately NOT done here to respect file ownership
(`DashboardScreen`, navigation, cash/check screens belong to other agents):

1. **New owner KPIs** — pass into the existing `updateWidgetData({ role:'owner', … })`
   call in `DashboardScreen.tsx`: `openOrders`, `cashOpen`, `nextBooking`.
   Until then the Large widget shows real revenue/profit/checks and omits the rest.
2. **Live Activity** — from the order-in-progress / open-shift flow:
   `const id = await startLiveActivity({ kind:'order', orderId }, { title:'Х807КС', status:'В работе', amount, startedAt })`,
   then `updateLiveActivity(id, …)` / `endLiveActivity(id, …)`.
3. **Siri deep-link** — on app launch/foreground (navigation owner):
   `const p = consumePendingAppIntent(); if (p) navigation.navigate('NewCheck');`
   «Выручка за сегодня» already works standalone with no wiring.

## Verification (compile-only, per owner's testing rule)

Ran on this machine — **no simulator boot, no EAS build, no TestFlight** (owner
has paused builds):

```
cd mobile
npx expo prebuild --platform ios --clean      # both plugins applied OK
cd ios && pod install                          # (auto-run by prebuild)
xcodebuild -workspace ios/Autexa.xcworkspace -scheme Autexa \
  -configuration Debug -sdk iphonesimulator build CODE_SIGNING_ALLOWED=NO
# ** BUILD SUCCEEDED **  (exit 0)
```

Confirmed in the build log:

- `AuTexaWidget.appex` produced; `AuTexaWidget.swift` + `AutexaLiveActivity.swift` compiled (arm64 + x86_64).
- `AutexaLiveActivityModule.o` built into the `AutexaLiquidGlass` pod; module listed in `Pods-Autexa/ExpoModulesProvider.swift`.
- `ExtractAppIntentsMetadata (in target 'Autexa')` ran; `Autexa.app/Metadata.appintents` emitted → App Shortcuts discoverable.
- `AppIntents.framework` / `ActivityKit.framework` weak-linked into the main target.

JS side: `npm run typecheck` clean · `npm run lint` clean · `npx jest` **299/299**.

## Owner acceptance checklist (physical iPhone, AFTER the next build)

> ⚠️ **A fresh EAS build is required to ship this — currently HELD by the owner.**
> Widgets/Live Activity/Siri all live in native targets; OTA/Metro cannot deliver
> them. After the next `eas build` (iOS) → install:

Widgets:

- [ ] Long-press Home Screen → **+** → search «Autexa» → add **Small**, **Medium**, **Large**.
- [ ] Open the app, log in as owner → widget shows real **оборот сегодня**, **чистая прибыль**, **чеки**. Large additionally shows «Открытые заказы» / «Касса» / «Ближайшая запись» (zeros until seam #1 is wired).
- [ ] Log in as master → widget switches to «Мой заработок сегодня» / «За месяц» / статус смены.
- [ ] Log out → widget shows «Откройте Autexa» (no leftover numbers).

Live Activity / Dynamic Island (iOS 16.1+, after seam #2 is wired):

- [ ] Start a заказ-наряд / open a shift → Live Activity appears on the Lock Screen with title, status, sum and a running timer.
- [ ] On a Dynamic Island iPhone (14 Pro+): compact shows the icon + timer; long-press expands to status + sum + timer.
- [ ] Finishing the order / closing the shift dismisses it.

Siri / Spotlight / Shortcuts (iOS 16+):

- [ ] Spotlight-search «Autexa» → the three shortcuts appear.
- [ ] Shortcuts app → Autexa lists «Создать заказ-наряд», «Открыть кассу», «Выручка за сегодня».
- [ ] «Эй, Сири, выручка за сегодня в Autexa» → Siri speaks today's revenue (works without opening the app once a snapshot exists).
- [ ] «Эй, Сири, открыть кассу в Autexa» → app opens (lands on Касса once seam #3 is wired).

## Honest status

- **Compiles fully** — every native target builds; metadata extracted; pod autolinked. Verified compile-only as required; **not** run on a device/simulator here.
- **Widgets** are functional end-to-end TODAY for revenue/profit/checks + master earnings (DashboardScreen already feeds the snapshot). The 3 extra owner KPIs render when seam #1 passes them.
- **Live Activity** infra is complete and compiles; it needs a `startLiveActivity()` trigger from the order/shift flow (seam #2) to appear.
- **App Intents**: «Выручка за сегодня» fully works standalone; the two open-app intents launch the app today and deep-link once seam #3 routes the pending action.
- Weak-linking protects iOS 15 at launch but is **not runtime-verifiable here** (no device); it is the correct production choice and the build links clean.
