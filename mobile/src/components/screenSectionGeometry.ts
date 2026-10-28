/** The title follows the native content offset; no compact title strip remains. */
export function screenSectionProgress(offset: number, titleHeight: number) {
  'worklet';
  return Math.min(1, Math.max(0, offset) / Math.max(1, titleHeight));
}

export function screenSectionGeometry(fontScale: number, titleRowHeight: number) {
  const titleTop = 14;
  const expandedHeight = titleTop + Math.max(titleRowHeight, Math.ceil(40 * fontScale)) + 10;
  return { compactHeight: 0, expandedHeight, titleTop };
}
