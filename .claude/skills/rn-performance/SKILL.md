---
name: rn-performance
description: Improve React Native performance — caching, prefetch, stale-while-revalidate, memoization, FlashList vs FlatList, dropping unnecessary rerenders, UI-thread scroll handlers via reanimated worklets. Use when a screen feels slow, scroll lags, content loads with a flash of empty, or a list renders too much per row.
---

# rn-performance

## When to use

- Janky scroll on physical iPhone.
- "Flash of empty" before data loads despite TanStack cache.
- Re-renders on every scroll event due to JS bridge round-trip.
- List with hundreds of items rendering too much.

## Files / docs to read first

- `mobile/App.tsx` — QueryClient defaults and persistent cache hydration.
- `mobile/src/utils/persistentCache.ts` — the whitelist of persisted keys.
- `mobile/src/contexts/AuthContext.tsx` — `prefetchAfterLogin`.
- `mobile/CLAUDE.md` (TanStack Query section).

## Workflow

1. Inspect the slow screen's `useQuery` keys. Add the first key segment to `PERSISTED_KEYS` if cold-start should show cached data.
2. Confirm `placeholderData: prev => prev` is not overridden locally.
3. For lists: prefer `<FlashList>` over `<FlatList>` when row count > 50. Memoize row component with `React.memo`.
4. For tab-target screens: extend prefetch in `AuthContext.prefetchAfterLogin` so heavy reference data is warm by the time user navigates.
5. For scroll-driven UI sync (e.g. sticky columns): use `useAnimatedScrollHandler` worklets and `scrollTo(otherRef, ...)` from reanimated — never `setTimeout`-based JS handlers.
6. Wrap stable arrow functions in `useCallback`; wrap derived data in `useMemo`. Avoid inline object/array literals in hot paths.

## Acceptance criteria

- Cold-start screen shows data instantly (from persisted cache) instead of a loading spinner.
- 60 fps scroll on 30+-row lists on iPhone.
- No JS-bridge calls per scroll frame.

## Checks

- `npm run typecheck && npm run lint && npx jest`.
- Manual: scroll the screen on a real iPhone and watch for jitters.

## Risks

- Too-broad `PERSISTED_KEYS` ⇒ stale-data flash for user-volatile screens.
- `'worklet'` directive forgotten on the handler ⇒ events still on JS thread.
- Memoization without stable deps ⇒ memo busted every render.

## Forbidden

- Disabling `placeholderData: prev => prev`.
- Adding non-determined keys to `PERSISTED_KEYS`.
- Touching backend / shared API to fix performance.

## Final report format

Source of jank, fix applied, before/after metric (e.g. scroll-events/sec), checks status.
