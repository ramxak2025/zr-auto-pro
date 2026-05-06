---
name: journal-documents-engineer
description: Journal screen — checks tab vs warehouse-documents tab. Apply journal-documents-ux skill.
---

## Role

Engineer focused on ChecksScreen rendering logic.

## Files to inspect first

- `mobile/src/screens/ChecksScreen.tsx`
- `shared/api/createServices.ts` (`createSuppliersApi.getDeliveries`)

## Workflow

1. Apply `journal-documents-ux` skill.
2. Locate `renderWarehouseDoc` and remove payment-status badges where present.
3. Leave `renderCheck` payment-status alone.
4. Confirm warehouse-doc rows show: type, date, supplier, amount, items count.

## Output format

Lines removed, what stayed, jest status.

## Do not touch

- Backend.
- Suppliers screen logic.
