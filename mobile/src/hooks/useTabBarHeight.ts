/**
 * useTabBarHeight — vertical space used by the floating glass tab bar.
 *
 * iOS (iter#7+ geometry): the island now covers the home-indicator zone
 * with its glass material instead of leaving a "dead gray plane" below
 * itself. The total visible occupation, top-to-bottom, is:
 *   TOP_LIFT (6 pt — small breathing space above the bar)
 * + BAR_HEIGHT (60 pt — visible icon row)
 * + safe-area-bottom (24–34 pt depending on the iPhone)
 *
 * Scroll containers should set `contentInset.bottom` equal to this so
 * the LAST list item naturally sits just above the icon row when at
 * the bottom of the scroll.
 *
 * Android: Material 3 navigation bar — 80pt opaque surface, flush —
 * reserve full bar height + the system gesture-bar inset (with a small
 * floor so OEMs that report `bottom = 0` for swipe-nav still get
 * breathing room).
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_PILL_HEIGHT = 60;
export const TAB_BAR_PILL_TOP_LIFT = 6;
export const TAB_BAR_PILL_BOTTOM_LIFT = 8;

// Android Material 3 NavigationBar reference height (see TabBar.android.tsx).
export const TAB_BAR_M3_HEIGHT = 80;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') {
    // Match TabBar.android.tsx: BAR_HEIGHT (80) + max(insets.bottom, 8)
    // so the last list row clears the bar on gesture-nav devices too.
    return TAB_BAR_M3_HEIGHT + Math.max(insets.bottom, 8);
  }
  return TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_TOP_LIFT + TAB_BAR_PILL_BOTTOM_LIFT + Math.max(insets.bottom, 8);
}
