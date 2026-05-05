/**
 * useTabBarHeight — vertical room reserved at the bottom of scrollable
 * screen content so it doesn't pass behind the floating tab bar's island.
 *
 * iOS: the bar is a Telegram-style floating pill (60pt + paddingTop 6 +
 *      bottomLift 10 + safe-area bottom). Content scrolls UNDER the
 *      island via tabBarStyle: { position: 'absolute' }, but we still
 *      reserve enough so the LAST item ends just above the island's top
 *      edge instead of being permanently hidden.
 *
 * Android: Material 3 nav bar is opaque and flush, no glass to preserve;
 *          we reserve the full bar height plus the system inset.
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_PILL_HEIGHT = 60;
export const TAB_BAR_PILL_TOP_PADDING = 6;
export const TAB_BAR_PILL_BOTTOM_LIFT = 10;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') {
    return 68 + Math.max(insets.bottom, 0);
  }
  return TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_TOP_PADDING + TAB_BAR_PILL_BOTTOM_LIFT + Math.max(insets.bottom, 8);
}
