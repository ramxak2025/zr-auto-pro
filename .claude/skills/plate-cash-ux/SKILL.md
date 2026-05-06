---
name: plate-cash-ux
description: Cash / order-narjad screen — license plate input/badge, selected client+car card, RU vs INT plate modes, search→selected transition, X clear. Use for plate visual issues, "Приора hangs separately", or ГОСТ proportions.
---

# plate-cash-ux

## When to use

- Plate visual cramped or stretched.
- Region / RUS / flag overlapping the rim.
- "Приора" or car name floating disconnected from plate.
- X clear regression / search not returning.

## Files / docs to read first

- `mobile/src/components/RussianPlateInput.tsx`
- `mobile/src/components/PlateModeSwitcher.tsx`
- `mobile/src/utils/plateMask.ts` and `__tests__/plateMask.test.ts`
- `mobile/src/screens/CheckCreateScreen.tsx` (PlateBadge + selectedCard)
- `docs/ios-redesign/CASH_PLATE_NATIVE_REDESIGN.md`
- `docs/ios-redesign/LICENSE_PLATE_INPUT_SPEC.md`

## Workflow

1. NEVER touch `processPlateMainInput` / `processPlateRegionInput` — duplication is structurally impossible because main is hard-capped at 6 chars and region is digits-only ≤3.
2. `makePlateBadgeStyles(height)` factory in `CheckCreateScreen.tsx` controls all proportions. Tune via padding ratios (`regionPadV/H`, `flagBox.marginVertical`, `cantInset`), never via absolute pixel writes.
3. Selected card layout: client header (avatar+name+phone+X) → hairline divider → plate (compact 48pt) centered → label "Автомобиль: Lada Priora" under plate.
4. X handler must call `animateClientToggle()` then clear `clientId/carId/plateSearch`. The animation is `LayoutAnimation.spring`, iOS-only, gated by `AccessibilityInfo.isReduceMotionEnabled()`.
5. Foreign mode (`PlateMode='foreign'`): blue INT strip + free-text input. RU mask must NOT apply.

## Acceptance criteria

- All 38 plateMask jest tests green.
- No regression in plate search.
- Selected card visibly compact: plate ≤ 48pt, region/RUS/flag fully visible.
- Reduce Motion respected.

## Checks

`npx jest src/utils/__tests__/plateMask` plus full app typecheck/lint.

## Risks

- Touching `plateMask.ts` constants can break tests.
- Resizing `PLATE_BADGE_H_*` without updating consumers.

## Forbidden

- Changing the plate-mask logic without test updates.
- Making the plate stretch full-width.
- Removing the `LayoutAnimation` spring on toggle.

## Final report format

Plate dimensions used, layout structure, search-mask preserved (yes/no), tests status.
