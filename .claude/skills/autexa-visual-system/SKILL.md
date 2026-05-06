---
name: autexa-visual-system
description: Unify the Autexa app under one Apple-like visual system — same headers, spacing, typography, cards, lists, forms, loading/empty/error states across all screens. Use when a screen "looks like a different app".
---

# autexa-visual-system

## When to use

- A screen visibly clashes with the warehouse direction (clean, minimalist, white cards on gray background).
- Adding a new screen — apply the system from day one.

## Files / docs to read first

- `mobile/src/components/IosScreenHeader.tsx` — shared header component
- `mobile/src/platform/iosSurface.ts` — surface primitives (`iosCard`, `iosCardCompact`, `iosPill`, `iosSectionLabel`)
- `mobile/src/platform/Typography.tsx` — `Text` variants
- `mobile/src/theme/index.ts` — `colors`, `spacing`, `borderRadius`
- `docs/ios-redesign/IOS26_LIQUID_GLASS_VISUAL_SYSTEM.md`

## Workflow

1. Top: replace bespoke headers with `<IosScreenHeader title="..." onBack={...} trailing={...} />`. Outer wrapper is plain `<View style={{ flex: 1, backgroundColor: colors.gray[50] }}>` — NOT `<SafeAreaView edges={['top']}>` (the header handles top inset itself).
2. Cards: `iosCard` for full-width sections; `iosCardCompact` for inline list rows; `iosPill` for status chips.
3. Section titles: `iosSectionLabel` (uppercase 11pt, tracking 1, gray-500).
4. Lists: `<FlashList>` for >50 rows; `<FlatList>` otherwise; row component memoised; same row paddings everywhere.
5. Empty states: centered icon + 17pt title + 13pt description. Loading: skeleton, not a spinner. Error: short title + Retry button.
6. Spacing: outer padding `spacing[4]`, gap between cards `spacing[4]`, inside cards `spacing[3]–[3.5]`.
7. Tab-target screens use `contentInset={{ bottom: tabBarHeight }}` on their main `<ScrollView>` / `<FlashList>` — never `paddingBottom`.

## Acceptance criteria

- Switching between screens feels like the same app.
- Headers identical; cards identical; spacing rhythm identical.

## Checks

typecheck/lint/jest. Manual: visual A/B compare each touched screen to ProductsScreen.

## Risks

- Mass-refactoring action buttons in headers — preserve them via `trailing` slot.
- Removing per-screen accent without checking that the new system carries the affordance.

## Forbidden

- Hard-coded radii or colours when a token exists.
- Two-tone screen backgrounds (header white, content gray) — that's the "boxed app" failure.

## Final report format

List of screens migrated, primitives applied, screens still on legacy headers, follow-up plan.
