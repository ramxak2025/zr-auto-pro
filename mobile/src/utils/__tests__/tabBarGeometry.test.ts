import { floatingTabBarHeight, reservedScrollBottom } from '../tabBarGeometry';
test.each([0, 8, 24, 34, 48])('bar reservation follows safe area %i on both platforms', (safe) => {
  const height = floatingTabBarHeight(safe);
  expect(height).toBe(60 + 6 + 8 + Math.max(safe, 8));
  expect(reservedScrollBottom(16, 0, height)).toBeGreaterThan(height);
});
it('keeps larger existing footer reservation and replaces rather than doubles iOS content inset', () => {
  expect(reservedScrollBottom(200, 108, 108)).toBe(200);
  expect(reservedScrollBottom(16, 108, 108)).toBe(124);
});
