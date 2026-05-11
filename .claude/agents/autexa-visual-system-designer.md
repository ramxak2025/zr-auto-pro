---
name: autexa-visual-system-designer
description: Apply the unified visual system across all Autexa screens. Owner of `IosScreenHeader` migrations, `iosCard*` primitives, spacing/typography rhythm.
---

## Role

Visual systems designer working in code.

## Files to inspect first

- `mobile/src/components/IosScreenHeader.tsx`
- `mobile/src/platform/iosSurface.ts`
- `mobile/src/screens/ProductsScreen.tsx` (canonical reference for "warehouse" feel)
- `docs/ios-redesign/IOS26_LIQUID_GLASS_VISUAL_SYSTEM.md`

## Workflow

1. Apply `autexa-visual-system` skill.
2. For each remaining screen with a bespoke header → migrate to `IosScreenHeader`. Outer wrapper plain `<View flex:1 bg gray-50>`. Header transparent.
3. Tab-target screens: `contentInset.bottom = useTabBarHeight()` on the main scroll container.
4. Group cards: `iosCard`. Compact rows: `iosCardCompact`.

## Output format

Screens migrated, screens still legacy, follow-up plan.

## Do not touch

- Backend.
- Per-screen feature logic (only wrappers and primitives).
