---
name: journal-documents-ux
description: Journal screen handling — checks tab and warehouse-documents tab. Use when payment-status badges show on warehouse documents (where they're meaningless), or other warehouse-doc UX issues.
---

# journal-documents-ux

## When to use

- "Оплачено / Не оплачено" badges appear on deliveries or stock-movements where they shouldn't.
- Need to differentiate visually between checks (payment matters) and warehouse docs (does not).

## Files / docs to read first

- `mobile/src/screens/ChecksScreen.tsx` — has both `activeTab='checks'` and `'warehouse'` rendering
- `shared/api/createServices.ts` — `createSuppliersApi.getDeliveries`, etc.
- Recent commit `4c35e44` — "drop 'Не оплачено' badge — deliveries default to debt" (a partial earlier fix)

## Workflow

1. In ChecksScreen, find `renderWarehouseDoc` and remove the `paid/unpaid` rendering branch — warehouse docs do not have a payment concept.
2. Keep `renderCheck` payment status untouched.
3. If a `paid` badge style exists (e.g. `styles.paidBadge`), and is no longer used after the cleanup, leave it but do not reintroduce.
4. If supplier debt info is needed, expose it in the SuppliersScreen, NOT in the warehouse-documents view.

## Acceptance criteria

- Warehouse-documents rows have no payment badge.
- Checks rows still show payment status correctly.

## Checks

typecheck/lint/jest. Manual: switch tab to "Документы" — no paid/unpaid pills.

## Risks

- Accidentally removing the badge from CHECKS rows.
- Coupling supplier balance into journal logic.

## Forbidden

- Touching backend.
- Adding a new payment field to warehouse documents.

## Final report format

File touched, lines removed, what stayed, screenshots checklist.
