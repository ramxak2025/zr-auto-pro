---
name: schedule-ios-redesign
description: Schedule / shifts grid screen — sticky names column, day cells, status pills, owners hidden, smooth scroll, month controls. Use for any change to ScheduleScreen layout, sync, or month UX.
---

# schedule-ios-redesign

## When to use

- Names column and day cells out of sync.
- Lag during vertical scroll.
- Owners visible in master list (must be hidden).
- Month picker / day-range UX changes.

## Files / docs to read first

- `mobile/src/screens/ScheduleScreen.tsx`
- `docs/ios-redesign/SWIFT_SCHEDULE_REDESIGN.md`
- `mobile/modules/autexa-liquid-glass/ios/AutexaScheduleGridView.swift` (currently inactive native option)
- `shared/utils/attendance.ts` — status calculation, do not duplicate

## Workflow

1. Verify `activeUsers` filter still excludes `superadmin` / `director` / `owner`.
2. Sync sticky-left column with right grid via `useAnimatedScrollHandler` worklets + `scrollTo(otherRef, ...)`. No `setTimeout`. No `scrollEventThrottle: 1` on JS.
3. ROW_H must be a single constant used by BOTH columns.
4. Month-stepper UI lives in `IosScreenHeader` `trailing` slot — compact `‹ Май ›` group, not a separate row inside the grid tab.
5. Status indicators: keep current colour map (work=green, off=gray, sick=rose, late_minor=yellow, late_major=orange, absent=red).
6. Skeleton on first load, not a spinner.

## Acceptance criteria

- Names and cells move pixel-locked.
- Month switch lives in header.
- Owners absent.
- 60 fps scroll on iPhone 15+/120 Hz.

## Checks

`npm run typecheck && npm run lint && npx jest`. iPhone smoke: scroll fast.

## Risks

- Native Swift grid (iter#2) currently disabled — re-enabling re-introduces UX risk.
- Changing ROW_H in only one column ⇒ rows desynchronise immediately.

## Forbidden

- Touching backend `schedule` module.
- Showing owner roles in master list.
- Replacing Reanimated worklet sync with JS handlers.

## Final report format

Sync mechanism in use, ROW_H value, owners filter intact, header month UX placement, checks status.
