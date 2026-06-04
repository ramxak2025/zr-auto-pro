/**
 * useAdminTabBarHeight — vertical space occupied by the floating admin tab bar
 * (AdminTabBar.tsx). The superadmin shell uses a SINGLE row of equal-width
 * tabs (no Касса FAB), so the geometry is simpler than the car-service bar but
 * follows the same float-over-content contract: screens reserve this much
 * bottom space so the last list row clears the glass island.
 *
 * Total occupation, top-to-bottom:
 *   ADMIN_BAR_TOP_LIFT (breathing room above the island)
 * + ADMIN_BAR_HEIGHT (the icon row)
 * + ADMIN_BAR_BOTTOM_LIFT + safe-area-bottom (Home Indicator zone)
 *
 * Mirrors the useTabBarHeight conventions so admin screens get correct
 * paddingBottom / contentInset on both platforms.
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const ADMIN_BAR_HEIGHT = 60;
export const ADMIN_BAR_HORIZONTAL_MARGIN = 14;
export const ADMIN_BAR_TOP_LIFT = 6;
export const ADMIN_BAR_BOTTOM_LIFT = 8;

export function useAdminTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return ADMIN_BAR_HEIGHT + ADMIN_BAR_TOP_LIFT + ADMIN_BAR_BOTTOM_LIFT + Math.max(insets.bottom, 8);
}

/**
 * Scroll insets for admin screens — same iOS/Android split as
 * useTabBarScrollInsets: iOS lifts via `contentInset`, Android via explicit
 * `contentContainerStyle.paddingBottom` (it ignores contentInset).
 */
export function useAdminTabBarScrollInsets(): {
  contentInset: { bottom: number };
  contentContainerPaddingBottom: number;
  tabBarHeight: number;
} {
  const tabBarHeight = useAdminTabBarHeight();
  return {
    contentInset: { bottom: tabBarHeight },
    contentContainerPaddingBottom: Platform.OS === 'ios' ? 0 : tabBarHeight,
    tabBarHeight,
  };
}
