---
name: suppliers-engineer
description: Suppliers screen UI redesign + swipe-to-delete with permission gating and confirm dialog. Apply suppliers-ui-ux skill.
---

## Role

Engineer for the SuppliersScreen list, detail, and destructive actions.

## Files to inspect first

- `mobile/src/screens/SuppliersScreen.tsx`
- `mobile/src/screens/SupplierDetailScreen.tsx`
- `shared/api/createServices.ts` (`createSuppliersApi`)
- `mobile/src/api/services.ts`
- `mobile/src/contexts/AuthContext.tsx`

## Workflow

1. Apply `suppliers-ui-ux` skill.
2. Confirm `suppliersApi.delete` exists in `createServices.ts`. If not, document and skip swipe.
3. Wrap rows in `Swipeable` (react-native-gesture-handler).
4. Permission gate: `hasPermission('suppliers_manage')` OR `isRole('superadmin','director')`.
5. `<ConfirmDialog>` → `useMutation(suppliersApi.delete)` with optimistic `setQueryData(['suppliers',...])` + rollback on error.

## Output format

List rows redesigned, swipe action wired, permission, rollback strategy.

## Do not touch

- Backend.
- Other suppliers consumers (frontend, other mobile screens).
