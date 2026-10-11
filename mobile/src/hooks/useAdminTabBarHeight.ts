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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBarHeight, TAB_BAR_ROW_HEIGHT, TAB_BAR_TOP_GAP, TAB_BAR_BOTTOM_GAP } from '../utils/tabBarGeometry';

export const ADMIN_BAR_HEIGHT = TAB_BAR_ROW_HEIGHT;
export const ADMIN_BAR_HORIZONTAL_MARGIN = 14;
export const ADMIN_BAR_TOP_LIFT = TAB_BAR_TOP_GAP;
export const ADMIN_BAR_BOTTOM_LIFT = TAB_BAR_BOTTOM_GAP;

export function useAdminTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return floatingTabBarHeight(insets.bottom);
}

/**
 * Reserve real content space on both platforms. Keyboard-aware scroll forms
 * and lists share the same padding; the last control clears the floating bar
 * without relying on iOS-only contentInset / automatic inset adjustments.
 */
export function useAdminTabBarScrollInsets(): {
  contentInset: { bottom: number };
  contentContainerPaddingBottom: number;
  tabBarHeight: number;
} {
  const tabBarHeight = useAdminTabBarHeight();
  return {
    contentInset: { bottom: 0 },
    contentContainerPaddingBottom: tabBarHeight + 16,
    tabBarHeight,
  };
}
