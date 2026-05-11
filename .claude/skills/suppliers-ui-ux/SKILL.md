---
name: suppliers-ui-ux
description: Suppliers list UI redesign + swipe-to-delete with confirm and permission gating. Use when changing SuppliersScreen list rows, headers, or delete UX.
---

# suppliers-ui-ux

## When to use

- Suppliers list looks bland.
- Owner asks for delete via swipe.
- Permission gating around supplier delete.

## Files / docs to read first

- `mobile/src/screens/SuppliersScreen.tsx`
- `mobile/src/screens/SupplierDetailScreen.tsx`
- `shared/api/createServices.ts` — `createSuppliersApi`
- `mobile/src/api/services.ts` (re-export)
- `mobile/src/contexts/AuthContext.tsx` — `hasPermission(...)`, `isRole(...)`
- Existing `suppliers_view`, `suppliers_manage` permissions

## Workflow

1. Verify suppliers API surface: which fields are available (name, phone, debt, balance, lastDelivery). Render only what already exists.
2. Match the warehouse aesthetic: white card, hairline border, large name + secondary line for phone, right-aligned debt or last-delivery date.
3. Implement swipe action via `react-native-gesture-handler` `Swipeable` (already in project deps) with a destructive red action revealed on left-swipe.
4. Permission: render the destructive action only when `hasPermission('suppliers_manage')` is true OR role is `superadmin/director`. If neither, swipe is disabled.
5. Tap on the action ⇒ `<ConfirmDialog>` "Удалить поставщика? Это действие нельзя отменить." → `suppliersApi.delete(id)`.
6. Optimistic update via TanStack `useMutation.onMutate` snapshotting `['suppliers', ...]` cache + rollback on error.
7. Backend must NOT change; if delete endpoint missing, document in `SUPPLIERS_SWIPE_DELETE.md` and skip the swipe.

## Acceptance criteria

- New list visibly matches warehouse style.
- Owner can swipe-delete; non-permitted users see no destructive action.
- Backend untouched.

## Checks

typecheck/lint/jest. Manual: swipe row in simulator and tap delete.

## Risks

- Optimistic update without rollback corrupts UI on failure.
- Wrong permission check leaks delete to roles that shouldn't have it.

## Forbidden

- Adding/changing backend endpoints.
- Hard delete on the API layer if it doesn't already exist.

## Final report format

List rows redesigned, swipe action wired, permission check used, mutation strategy, optimistic+rollback yes/no.
