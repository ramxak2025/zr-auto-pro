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
it('fits measured context without artificial whitespace and grows with Dynamic Type', () => {
  expect(journalHeaderGeometry(1, 18).compactHeight).toBe(44);
  for (const scale of [1, 1.4, 2, 3]) {
    const contextHeight = 36 * scale;
    const geometry = journalHeaderGeometry(scale, contextHeight);
    const contextGap = geometry.expandedHeight - geometry.contextTop - contextHeight;
    expect(contextGap).toBeGreaterThanOrEqual(16);
    expect(contextGap).toBeLessThanOrEqual(20);
    expect(geometry.expandedHeight).toBeGreaterThan(geometry.compactHeight);
    expect(geometry.compactHeight).toBeGreaterThanOrEqual(22 * scale + 16);
  }
});
