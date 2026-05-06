---
name: warehouse-product-picker
description: Make the product picker inside the cash screen look and behave like the standalone Warehouse screen — same row design, same speed (cache-first / prefetch). Use when adding/changing the product picker in CheckCreateScreen.
---

# warehouse-product-picker

## When to use

- Picker dialog/sheet in cash feels different from the warehouse screen.
- Slow open of product list inside cash.
- Search isn't snappy.

## Files / docs to read first

- `mobile/src/components/ProductPickerModal.tsx`
- `mobile/src/screens/ProductsScreen.tsx` — reference for row design
- `mobile/src/screens/CheckCreateScreen.tsx` — picker usage site
- `mobile/src/api/services.ts` — `productsApi`, `warehouseCategoriesApi`
- `mobile/src/utils/persistentCache.ts` — `PERSISTED_KEYS`
- `mobile/src/contexts/AuthContext.tsx` — `prefetchAfterLogin`

## Workflow

1. Audit ProductPickerModal styles vs ProductsScreen rows. Reuse the same row component if reasonable.
2. Use the SAME query keys as ProductsScreen so the picker reads from a hot cache (`['all-products-check']` / `['products', ...]`). Mark with `placeholderData: prev => prev`.
3. Ensure `'all-products-check'` is in `PERSISTED_KEYS` so a cold-start cash flow opens the picker with cache.
4. For category folders use `['warehouse-categories']` (already persisted).
5. List rendered with `<FlashList>`, row component `React.memo`, `keyExtractor` stable.
6. Search debounce 200 ms locally; backend search is already supported via `productsApi.getAll({ search })`.

## Acceptance criteria

- Picker looks like a sheet over warehouse rows.
- Cold-start opens with cached products instantly.
- Search returns within one frame for cached items.

## Checks

typecheck/lint/jest. Manual: open cash → tap "+" → picker open under 200 ms.

## Risks

- Different query key in picker vs warehouse ⇒ duplicate cache.
- Stale cache + heavy filter logic in render.

## Forbidden

- Editing backend / warehouse module.
- Adding new query keys without aligning to existing ProductsScreen keys.

## Final report format

Picker entry point, query keys reused, list virtualisation, prefetch wiring.
