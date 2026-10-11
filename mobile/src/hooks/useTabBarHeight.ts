/** Real occupied height of Autexa's floating bottom navigation on iOS and Android. */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBarHeight, TAB_BAR_ROW_HEIGHT, TAB_BAR_TOP_GAP, TAB_BAR_BOTTOM_GAP } from '../utils/tabBarGeometry';

export const TAB_BAR_PILL_HEIGHT = TAB_BAR_ROW_HEIGHT;
export const TAB_BAR_PILL_TOP_LIFT = TAB_BAR_TOP_GAP;
export const TAB_BAR_PILL_BOTTOM_LIFT = TAB_BAR_BOTTOM_GAP;
export function useTabBarHeight(): number {
  return floatingTabBarHeight(useSafeAreaInsets().bottom);
}

/**
 * On iOS we lean on RN's `contentInset` prop on ScrollView / FlashList,
 * which lifts the scrollIndicator AND content together so the bar
 * truly floats over content.
 *
 * On Android `contentInset` is silently ignored — only
 * `contentContainerStyle.paddingBottom` actually reserves space at the
 * bottom of the scroll. Without it, the last list row sits flush
 * against the Material 3 NavigationBar.
 *
 * Use this hook in screens that need the bar to "float" over content
 * cross-platform:
 *
 *   const { contentInset, contentContainerPaddingBottom } = useTabBarScrollInsets();
 *   <ScrollView
 *     contentInset={contentInset}
 *     contentContainerStyle={{ paddingBottom: contentContainerPaddingBottom }}
 *     ...
 *   />
 */
export function useTabBarScrollInsets(): {
  /** iOS-only: RN-style contentInset; Android ignores this prop. */
  contentInset: { bottom: number };
  /** Android-only: explicit padding-bottom on contentContainerStyle. iOS uses contentInset instead. */
  contentContainerPaddingBottom: number;
  /** Total visual occupation of the bar — use for "header height" math. */
  tabBarHeight: number;
} {
  const tabBarHeight = useTabBarHeight();
  return {
    contentInset: { bottom: tabBarHeight },
    contentContainerPaddingBottom: Platform.OS === 'ios' ? 0 : tabBarHeight,
    tabBarHeight,
  };
}
