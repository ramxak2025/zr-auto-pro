import { journalHeaderGeometry, journalHeaderProgress } from '../headerScroll';
it('uses the measured title zone in both directions, without a threshold or fixed small-title reserve', () => {
  for (const height of [64, 90, 138]) {
    for (const fraction of [0, 0.25, 0.5, 1, 2, 0.75, 0])
      expect(journalHeaderProgress(height * fraction, height)).toBeCloseTo(Math.min(1, fraction));
    expect(journalHeaderProgress(-20, height)).toBe(0);
  }
});
it('reserves only the measured full-scale heading and no compact heading', () => {
  for (const scale of [1, 1.353, 2, 3]) {
    for (const row of [28, 28 * scale, 58 * scale + 4]) {
      const geometry = journalHeaderGeometry(scale, row);
      expect(geometry.compactHeight).toBe(0);
      expect(geometry.expandedHeight).toBeGreaterThanOrEqual(geometry.titleTop + Math.ceil(28 * scale) + 10);
      expect(geometry.expandedHeight).toBe(geometry.titleTop + Math.max(row, Math.ceil(28 * scale)) + 10);
    }
  }
});
