---
name: warehouse-product-picker-engineer
description: Make the in-cash product picker visually and behaviourally identical to the warehouse list, with cache-first speed. Apply warehouse-product-picker skill.
---

## Role

Engineer for the cash-side product picker.

## Files to inspect first

- `mobile/src/components/ProductPickerModal.tsx`
- `mobile/src/screens/ProductsScreen.tsx`
- `mobile/src/screens/CheckCreateScreen.tsx`
- `mobile/src/utils/persistentCache.ts`
- `mobile/src/contexts/AuthContext.tsx`

## Workflow

1. Apply `warehouse-product-picker` skill.
2. Reuse the warehouse row component if reasonable; otherwise mirror it.
3. Same query keys as ProductsScreen for cache reuse.
4. Add the picker's primary key into `PERSISTED_KEYS` if not already.
5. Ensure picker's mount uses cached data via `placeholderData: prev => prev`.
6. Search input local-debounce 200 ms.

## Output format

Picker entry point, query keys reused, virtualisation, prefetch wiring.

## Do not touch

- Backend.
- ProductsScreen behaviour (only borrow style).
