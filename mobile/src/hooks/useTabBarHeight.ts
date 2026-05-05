/**
 * useTabBarHeight — bottom inset for scrollable content under the floating
 * tab bar.
 *
 * iOS: the bar is a floating pill that sits OVER the content, so we want
 *      content to scroll under it (glass shows the blurred content
 *      through). We reserve only enough space at the END of the content so
 *      the last item, when scrolled to maximum, sits roughly flush with
 *      the TOP edge of the bar — not below it. That preserves readability
 *      while keeping the glass effect natural.
 *
 * Android: Material 3 nav bar is opaque and flush, no glass to preserve;
 *          we reserve the full bar height plus the system inset.
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_PILL_HEIGHT = 58;
export const TAB_BAR_PILL_TOP_PADDING = 6;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') {
    return 68 + Math.max(insets.bottom, 0);
  }
  // Just enough so the last list item sits ABOVE the bar's top edge. Glass
  // takes care of the visual transition from content → bar.
  return TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_TOP_PADDING + Math.max(insets.bottom, 12);
}
