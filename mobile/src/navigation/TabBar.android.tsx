/**
 * TabBar — Android variant. Floating frosted-glass "island" bar that
 * mirrors the iOS Liquid Glass tab bar.
 *
 * Surface:
 *   • Pill-shaped island, 60pt tall, 14pt horizontal margin, soft drop
 *     shadow underneath, sits 10pt above the bottom safe area inset.
 *   • Background = `expo-blur` BlurView (tint=`light`, intensity tuned
 *     for daylight UIs). On Android BlurView is a real native blur
 *     using the system RenderEffect on API 31+ and a falls back to a
 *     translucent surface on older devices — there's no JS fallback,
 *     no GL hit.
 *   • Faint primary-tinted overlay on top of the blur to keep the bar
 *     "alive" on white-content screens where there's nothing behind it
 *     to actually blur.
 *
 * Interaction:
 *   • Pan gesture across the bar — finger tracks the selection capsule
 *     left/right; release switches to that tab. Same physical feel as
 *     the iOS droplet pan.
 *   • Tap on any tab — instant switch with selection-style haptic.
 *   • Selection capsule = rounded-rectangle (`borderRadius: 14`),
 *     translucent primary[100]. NOT a perfect-pill — owner explicitly
 *     wanted the "squared with rounded corners" Apple look.
 *   • Indicator spring tracks the focused tab on every change, driven
 *     by a single Reanimated shared value on the UI thread.
 *
 * Centre Касса button:
 *   • Keeps the gradient KassaButton (looks the same as iOS on both
 *     sides). The button pops 28pt above the rim so it reads as the
 *     primary action.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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

// Selection capsule — rounded-rectangle (not full pill) so it reads as
// the squared-with-rounded-corners shape Apple uses for tab selection.
const CAPSULE_RADIUS = 14;
const CAPSULE_INSET_V = 6;
const CAPSULE_PADDING_H = 6;

// Map TAB_DEFINITIONS routeName → semantic Icon name we expose in
// platform/Icon.tsx (renders the SVG variant via lucide-react-native).
const ROUTE_TO_ICON: Record<string, IconName> = {
  Dashboard: 'home',
  Products: 'warehouse',
  Checks: 'journal',
  MoreTab: 'menu',
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeFocusedIndex = focusedIndex < 0 ? 0 : focusedIndex;

  // Width of the entire icon row — measured once on layout. We use it
  // to translate the selection capsule along the bar during the pan
  // gesture and the spring transition.
  const [rowWidth, setRowWidth] = React.useState(0);
  const slotWidth = rowWidth / TAB_DEFINITIONS.length;

  // Selection capsule position (in pixels from the row's left edge).
  // Sits at `slotWidth * focusedIndex` when not being dragged.
  const capsuleX = useSharedValue(0);

  // Whether the capsule is currently being driven by the user's finger
  // (so we don't fight the touch with the spring snap-back).
  const dragging = useSharedValue(false);

  React.useEffect(() => {
    if (rowWidth === 0) return;
    capsuleX.value = withSpring(slotWidth * safeFocusedIndex, SPRING_TIGHT);
  }, [safeFocusedIndex, rowWidth, slotWidth, capsuleX]);

  const navigateToIndex = React.useCallback(
    (index: number) => {
      const tab = TAB_DEFINITIONS[index];
      if (!tab) return;
      const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
      const focused = state.index === routeIndex;
      const event = navigation.emit({
        type: 'tabPress',
        target: state.routes[routeIndex]?.key ?? tab.routeName,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        haptic('tap');
        navigation.navigate(tab.routeName as never);
      }
    },
    [state, navigation],
  );

  // Pan gesture: while finger is down, drive `capsuleX` directly from
  // the touch's x position; on release, snap to the nearest tab and
  // navigate. Activates after a 6pt drag so vertical scroll on the
  // screen above isn't accidentally intercepted.
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(0)
        .minDistance(4)
        .onStart(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          if (rowWidth === 0 || slotWidth === 0) return;
          // Clamp so the capsule never escapes the bar.
          const clamped = Math.max(0, Math.min(rowWidth - slotWidth, e.x - slotWidth / 2));
          capsuleX.value = clamped;
        })
        .onEnd((e) => {
          dragging.value = false;
          if (rowWidth === 0 || slotWidth === 0) return;
          const idx = Math.round(e.x / slotWidth);
          const clamped = Math.max(0, Math.min(TAB_DEFINITIONS.length - 1, idx));
          // Don't navigate to the Касса slot via pan — it's the central
          // CTA, not a destination the user typically wants to land on
          // by accident while exploring.
          const def = TAB_DEFINITIONS[clamped];
          if (def && !def.isKassa) {
            runOnJS(navigateToIndex)(clamped);
          }
          // Snap whatever's there back to the focused tab.
          capsuleX.value = withSpring(slotWidth * safeFocusedIndex, SPRING_TIGHT);
        }),
    [capsuleX, dragging, rowWidth, slotWidth, safeFocusedIndex, navigateToIndex],
  );

  const capsuleStyle = useAnimatedStyle(() => ({
    width: slotWidth - CAPSULE_PADDING_H * 2,
    transform: [{ translateX: capsuleX.value + CAPSULE_PADDING_H }],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: TOP_LIFT, paddingBottom: safeBottom + BOTTOM_LIFT }]}
    >
      <View style={[styles.island, { height: BAR_HEIGHT }]}>
        {/* Frosted glass surface fills the entire pill. `tint="light"`
            gives the bright iOS-like material; intensity 80 reads as
            "thin material" on Android — enough to see scrolling
            content behind it without making the labels illegible. */}
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        {/* Faint warm overlay so the bar still reads as a discrete
            surface on screens that are mostly white (where there's
            very little background colour to actually blur). */}
        <View style={styles.surfaceTint} pointerEvents="none" />
        {/* Top hairline rim — premium edge highlight. */}
        <View style={styles.topRim} pointerEvents="none" />

        {/* Selection capsule sits BEHIND the icons. */}
        <Animated.View style={[styles.capsule, capsuleStyle]} pointerEvents="none" />

        <GestureDetector gesture={panGesture}>
          <View
            style={styles.row}
            onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          >
            {TAB_DEFINITIONS.map((tab) => {
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
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={tab.label}
                    >
                      <KassaButton />
                    </Pressable>
                  </View>
                );
              }

              const onPress = () => {
                const routeIdx = state.routes.findIndex((r) => r.name === tab.routeName);
                const event = navigation.emit({
                  type: 'tabPress',
                  target: state.routes[routeIdx]?.key ?? tab.routeName,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  haptic('tap');
                  navigation.navigate(tab.routeName as never);
                }
              };

              return <TabItem key={tab.routeName} tab={tab} focused={focused} onPress={onPress} />;
            })}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

interface TabItemProps {
  tab: TabDefinition;
  focused: boolean;
  onPress: () => void;
}

function TabItem({ tab, focused, onPress }: TabItemProps) {
  // Subtle scale + label colour transition on focus — anchored to the
  // same spring as the capsule travel so everything moves in time.
  const focusValue = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    focusValue.value = withSpring(focused ? 1 : 0, SPRING_TIGHT);
  }, [focused, focusValue]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusValue.value * 0.08 }],
  }));

  const tint = focused ? colors.primary[700] : colors.gray[500];
  const iconName = ROUTE_TO_ICON[tab.routeName] ?? 'home';

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: focused }}
    >
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
        numberOfLines={1}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Absolute so the BottomTabView lays the scene at full screen height;
  // content scrolls UNDER the floating glass, matching iOS.
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
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    backgroundColor: 'transparent',
  },
  surfaceTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
    paddingTop: 4,
  },
  capsule: {
    position: 'absolute',
    top: CAPSULE_INSET_V,
    height: BAR_HEIGHT - CAPSULE_INSET_V * 2,
    borderRadius: CAPSULE_RADIUS,
    backgroundColor: colors.primary[100],
    // very subtle inner glow — adds depth without competing with the
    // icon glyph.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(37, 99, 235, 0.12)',
  },
  label: {
    marginTop: 1,
    fontSize: 10,
    letterSpacing: -0.1,
  },
  kassaSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
  },
});
