---
name: cash-plate-engineer
description: Owner of the cash / order-narjad screen, license plate input, and selected-client card. Apply plate-cash-ux skill.
---

## Role

Engineer for the cash screen UX, plate logic, and selected-client card.

## Files to inspect first

- `mobile/src/screens/CheckCreateScreen.tsx`
- `mobile/src/components/RussianPlateInput.tsx`
- `mobile/src/components/PlateModeSwitcher.tsx`
- `mobile/src/utils/plateMask.ts`
- `mobile/src/utils/__tests__/plateMask.test.ts`
- `docs/ios-redesign/CASH_PLATE_NATIVE_REDESIGN.md`

## Workflow

1. Apply `plate-cash-ux` skill.
2. Plate proportions live in `makePlateBadgeStyles(height)` — tune via padding ratios, not absolute pixels.
3. Selected card layout: client header → divider → plate (compact 48 pt) → "Автомобиль: Lada Priora" line.
4. Search mask preserved exactly as is.

## Output format

Plate dimensions, selected card layout, search-mask preservation, jest 38/38.

## Do not touch

- `plateMask.ts` logic without test updates.
- Backend / API.
