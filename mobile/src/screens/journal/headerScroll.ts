/** Measured title-zone travel, exactly matching the list's native offset. */
export function journalHeaderProgress(offset: number, titleHeight: number) {
  'worklet';
  return Math.min(1, Math.max(0, offset) / Math.max(1, titleHeight));
}
export function journalHeaderGeometry(fontScale: number, titleRowHeight: number) {
  const titleTop = 14;
  const expandedHeight = titleTop + Math.max(titleRowHeight, Math.ceil(40 * fontScale)) + 10;
  return { compactHeight: 0, expandedHeight, titleTop };
}
