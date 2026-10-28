export const JOURNAL_SCROLL_DISTANCE = 88;

/** A continuous reversible value; no layout feedback, direction threshold or list reset. */
export function journalHeaderProgress(offset: number) {
  'worklet';
  return Math.min(1, Math.max(0, offset) / JOURNAL_SCROLL_DISTANCE);
}

export function journalHeaderGeometry(fontScale: number, contextHeight: number, touchHeight = 44) {
  const compactHeight = Math.max(touchHeight, Math.ceil(22 * fontScale) + 16);
  const titleTop = 14;
  const contextTop = titleTop + Math.ceil(40 * fontScale) + 8;
  const expandedHeight = Math.max(compactHeight, contextTop + contextHeight + 18);
  return { compactHeight, expandedHeight, contextTop, titleTop };
}
