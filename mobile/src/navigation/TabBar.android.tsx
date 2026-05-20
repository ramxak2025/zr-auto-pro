/**
 * TabBar — Android variant. Floating "island" bar matching the iOS look.
 *
 * Design goals (per owner ask):
 *   • Same visual language as iOS Liquid Glass island — pill-shaped,
 *     floating above content with breathing room from screen edges,
 *     soft drop shadow, smooth indicator that springs between active
 *     destinations.
 *   • Centre «Касса» CTA rendered as the gradient KassaButton — the
 *     same component iOS uses, sized as a floating FAB that pops
 *     slightly above the bar so it reads as the primary action.
 *   • SVG icons via the project's Lucide shim (`@expo/vector-icons`
 *     calls are routed through `src/components/icons/*` by the metro
 *     resolver) — guaranteed visible on every Android skin / OEM,
 *     no native font registration required.
 *   • Spring indicator on focus change — Reanimated v4 worklet driving
 *     a translucent primary-tinted pill underneath the focused icon.
 *
 * Why not Material 3 NavigationBar:
 *   The previous M3 variant looked alien next to the iOS island — owner
 *   explicitly wanted parity. The geometry we converged on (60pt tall,
 *   14pt horizontal margin, pill corner radius, soft shadow) reads as
 *   premium on both platforms.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon, type IconName } from '../platform/Icon';
import { haptic } from '../platform/haptics';
import { SPRING_TIGHT } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS, TabDefinition } from './TabBarShared';

// ── Floating island geometry — mirrors TabBar.ios.tsx ─────────────────────
const BAR_HEIGHT = 60;
const HORIZONTAL_MARGIN = 14;
const TOP_LIFT = 6;
const BOTTOM_LIFT = 8;
const CORNER_RADIUS = BAR_HEIGHT / 2;

// Active-indicator pill — sits behind the focused icon. Tracking
// width matches a tab slot minus side padding so it reads as a
// "selection capsule" the way iOS's droplet does.
const PILL_VERTICAL_INSET = 6;
const PILL_HORIZONTAL_PADDING = 10;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeFocusedIndex = focusedIndex < 0 ? 0 : focusedIndex;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: TOP_LIFT, paddingBottom: safeBottom + BOTTOM_LIFT }]}
    >
      <View style={[styles.island, { height: BAR_HEIGHT }]}>
        {/* Row of all tabs (Касса rendered separately on top so its FAB
            can pop above the island). */}
        <View style={styles.row}>
          {TAB_DEFINITIONS.map((tab, idx) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;

            if (tab.isKassa) {
              return (
                <View key={tab.routeName} style={styles.kassaSlot}>
                  <Pressable
                    onPress={() => {
                      haptic('impact');
                      navigation.navigate(tab.routeName as never);
                    }}
                    style={styles.kassaPressable}
                    android_ripple={{ color: 'transparent', borderless: true }}
                    accessibilityRole="button"
                    accessibilityLabel={tab.label}
                  >
                    <KassaButton />
                  </Pressable>
                </View>
              );
            }

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: state.routes[routeIndex]?.key ?? tab.routeName,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                haptic('tap');
                navigation.navigate(tab.routeName as never);
              }
            };

            return (
              <TabItem
                key={tab.routeName}
                index={idx}
                tab={tab}
                focused={focused}
                onPress={onPress}
                focusedIndex={safeFocusedIndex}
              />
            );
          })}
        </View>

        {/* Top hairline rim — same subtle premium touch as the iOS
            island. Helps the bar read as a discrete surface against
            white screen contents. */}
        <View style={styles.topRim} pointerEvents="none" />
      </View>
    </View>
  );
}

interface TabItemProps {
  index: number;
  tab: TabDefinition;
  focused: boolean;
  onPress: () => void;
  focusedIndex: number;
}

function TabItem({ tab, focused, onPress }: TabItemProps) {
  // Selection capsule behind the icon — translucent primary-tinted pill
  // that scales + fades on focus change. Tracks the focused tab the
  // same way iOS's droplet tracks. Driven by a single Reanimated
  // shared value so the animation runs entirely on the UI thread.
  const focusValue = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    focusValue.value = withSpring(focused ? 1 : 0, SPRING_TIGHT);
  }, [focused, focusValue]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: focusValue.value,
    transform: [{ scale: 0.85 + focusValue.value * 0.15 }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusValue.value * 0.06 }],
  }));

  // Color transition — interpolate between gray-500 and primary-700
  // without crossing the Reanimated colour boundary (we use a simple
  // useState/useEffect read, since the discrete colour change happens
  // alongside the spring and is barely perceptible mid-flight).
  const tint = focused ? colors.primary[700] : colors.gray[500];

  // Map the route name to our semantic Icon names (defined in
  // src/platform/Icon.tsx). Icons render via the lucide-react-native
  // SVG path under the hood — no font registration involved.
  const iconName: IconName =
    tab.routeName === 'Dashboard'
      ? 'home'
      : tab.routeName === 'Products'
        ? 'warehouse'
        : tab.routeName === 'Checks'
          ? 'journal'
          : tab.routeName === 'MoreTab'
            ? 'menu'
            : 'home';

  return (
    <View style={styles.item}>
      <Pressable
        onPress={onPress}
        style={styles.itemPressable}
        android_ripple={{ color: 'rgba(37, 99, 235, 0.10)', borderless: true }}
        accessibilityRole="button"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: focused }}
      >
        {/* Selection pill behind the icon. */}
        <Animated.View style={[styles.pill, pillStyle]} pointerEvents="none" />
        <Animated.View style={iconStyle}>
          <Icon name={iconName} size={22} color={tint} weight={focused ? 'semibold' : 'regular'} />
        </Animated.View>
        <Text
          variant="caption"
          style={[
            styles.label,
            {
              color: tint,
              fontWeight: focused ? '600' : '500',
            },
          ]}
        >
          {tab.label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute positioning so the BottomTabView lays the scene container
  // out at full screen height — content scrolls UNDER the floating
  // island, matching the iOS variant.
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  island: {
    marginHorizontal: HORIZONTAL_MARGIN,
    borderRadius: CORNER_RADIUS,
    backgroundColor: colors.white,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    // Soft drop shadow — Android elevation + iOS-style shadow*. Both
    // applied because both the JS shadow renderer (paper) and the
    // platform elevation (fabric) each see one. Elevation 8 is
    // visually similar to iOS shadowOpacity 0.06 / shadowRadius 10.
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.95)',
    pointerEvents: 'none',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT,
  },
  itemPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  pill: {
    position: 'absolute',
    top: PILL_VERTICAL_INSET,
    left: PILL_HORIZONTAL_PADDING,
    right: PILL_HORIZONTAL_PADDING,
    bottom: PILL_VERTICAL_INSET,
    borderRadius: (BAR_HEIGHT - PILL_VERTICAL_INSET * 2) / 2,
    backgroundColor: colors.primary[100],
  },
  label: {
    marginTop: 1,
    fontSize: 10,
    letterSpacing: -0.1,
  },
  // Kassa slot — wraps the gradient KassaButton in a pressable so the
  // tap target stays inside the island's geometry.
  kassaSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
  },
  kassaPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
