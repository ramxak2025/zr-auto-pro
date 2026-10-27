export interface JournalScrollState {
  y: number;
  anchor: number;
  direction: number;
  compact: boolean;
}
export const initialJournalScrollState = (): JournalScrollState => ({ y: 0, anchor: 0, direction: 0, compact: false });
/** Ignore bounce and small reversals; only a deliberate change of reading direction changes header state. */
export function nextJournalScrollState(
  current: JournalScrollState,
  offset: number,
  searchFocused: boolean,
): JournalScrollState {
  const y = Math.max(0, offset);
  const direction = Math.sign(y - current.y);
  const anchor = direction !== current.direction ? current.y : current.anchor;
  const compact =
    searchFocused || y < 24 ? false : Math.abs(y - anchor) >= 36 ? direction > 0 && y > 80 : current.compact;
  return { y, direction, anchor, compact };
}
