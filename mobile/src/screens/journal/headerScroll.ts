export const JOURNAL_SCROLL_DISTANCE = 88;

/** A continuous reversible value; no layout feedback, direction threshold or list reset. */
export function journalHeaderProgress(offset: number) {
  'worklet';
  return Math.min(1, Math.max(0, offset) / JOURNAL_SCROLL_DISTANCE);
}

export function journalHeaderGeometry(fontScale: number, titleRowHeight: number, touchHeight = 44) {
  const compactHeight = Math.max(touchHeight, Math.ceil(22 * fontScale) + 16);
  const titleTop = 14;
  // A live font-size update can arrive one frame before the new row measurement.
  const expandedHeight = Math.max(compactHeight, titleTop + Math.max(titleRowHeight, Math.ceil(40 * fontScale)) + 10);
  return { compactHeight, expandedHeight, titleTop };
}
