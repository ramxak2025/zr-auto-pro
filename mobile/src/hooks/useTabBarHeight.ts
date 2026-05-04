/**
 * useTabBarHeight — total height occupied by our floating bottom tab bar.
 *
 * Use it as `paddingBottom` on every scrollable container under <Main>
 * (Dashboard, Products, Checks, Schedule, etc.) so the last item is not
 * hidden behind the bar.
 *
 * On iOS the bar is a floating pill: 60pt + 8 (top) + max(insets.bottom, 12) + 8 buffer.
 * On Android the bar is a Material 3 surface that sits flush at the bottom
 * and the system already offsets content via standard navigation insets.
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_PILL_HEIGHT = 60;
export const TAB_BAR_PILL_TOP_PADDING = 8;
export const TAB_BAR_PILL_BUFFER = 8;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') {
    // Android: Material 3 nav bar = 68pt + system inset
    return 68 + Math.max(insets.bottom, 0);
  }
  return (
    TAB_BAR_PILL_HEIGHT +
    TAB_BAR_PILL_TOP_PADDING +
    Math.max(insets.bottom, 12) +
    TAB_BAR_PILL_BUFFER
  );
}
