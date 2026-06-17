/**
 * Pure terminal-state resolver for CheckDetailScreen.
 *
 * Extracted into its own module (no React / React Native imports) so it can be
 * unit-tested without mounting the screen — same pattern as
 * `scheduleViewState.ts`.
 *
 * WHY THIS EXISTS — the «пустой экран» bug:
 * The screen used to guard with a bare inline chain:
 *
 *     if (isLoading) return <LoadingSpinner/>;
 *     if (!check)    return <Text style={{ padding: 20 }}>Чек не найден</Text>;
 *
 * On the transparent navigation stack that unstyled <Text> looked like a BLANK
 * screen. It was reachable after «Принять оплату» / «Продолжить» when the
 * canonical `['check', id]` fetch errored or had no journal-cache placeholder:
 * once a fetch settles to error, React Query flips `isLoading` to false, so the
 * code fell through to the content-less <Text> with no way back and no retry.
 *
 * The resolver makes the four states explicit so the render can show a proper
 * full-screen loader / error-with-retry / not-found instead of a blank View.
 */
export type CheckDetailViewState = 'loading' | 'error' | 'notfound' | 'content';

export interface CheckDetailStateInput {
  /** True when there is a check to render — real data OR a stale/placeholder. */
  hasCheck: boolean;
  /** React Query `isLoading` (first fetch in flight, no data yet). */
  isLoading: boolean;
  /** React Query `isError` (last fetch settled to an error). */
  isError: boolean;
}

export function resolveCheckDetailState(input: CheckDetailStateInput): CheckDetailViewState {
  // Stale-while-revalidate: as long as we have a check (real data or a
  // journal-cache placeholder), keep showing it even while a background refetch
  // is in flight or transiently errors — never blank the screen.
  if (input.hasCheck) return 'content';
  if (input.isLoading) return 'loading';
  if (input.isError) return 'error';
  return 'notfound';
}
