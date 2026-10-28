import { JOURNAL_SCROLL_DISTANCE, journalHeaderGeometry, journalHeaderProgress } from '../headerScroll';

it('follows the actual scroll continuously in both directions and clamps overscroll', () => {
  expect(JOURNAL_SCROLL_DISTANCE).toBeGreaterThanOrEqual(80);
  expect(JOURNAL_SCROLL_DISTANCE).toBeLessThanOrEqual(96);
  for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1, 0.75, 0.25, 0]) {
    expect(journalHeaderProgress(JOURNAL_SCROLL_DISTANCE * fraction)).toBeCloseTo(fraction);
  }
  expect(journalHeaderProgress(-30)).toBe(0);
  expect(journalHeaderProgress(1000)).toBe(1);
});
it('reserves only the measured title/status row, including wrapping at large text sizes', () => {
  expect(journalHeaderGeometry(1, 40).compactHeight).toBe(44);
  expect(journalHeaderGeometry(1, 40).expandedHeight).toBeLessThan(80);
  for (const scale of [1, 1.4, 2, 3]) {
    for (const titleRowHeight of [40 * scale, 58 * scale + 4]) {
      const geometry = journalHeaderGeometry(scale, titleRowHeight);
      const gap = geometry.expandedHeight - geometry.titleTop - titleRowHeight;
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThanOrEqual(12);
      expect(geometry.expandedHeight).toBeGreaterThan(geometry.compactHeight);
      expect(geometry.compactHeight).toBeGreaterThanOrEqual(22 * scale + 16);
    }
  }
});
it('keeps the enlarged title visible until a live Dynamic Type remeasurement arrives', () => {
  const oldRowHeight = 40;
  for (const scale of [1.12, 1.35, 2, 3]) {
    const transient = journalHeaderGeometry(scale, oldRowHeight);
    expect(transient.expandedHeight).toBeGreaterThanOrEqual(transient.titleTop + Math.ceil(40 * scale) + 10);
    const wrapped = journalHeaderGeometry(scale, Math.ceil(58 * scale) + 4);
    expect(wrapped.expandedHeight).toBeGreaterThan(transient.expandedHeight);
  }
});
