/**
 * TabBar — Android variant. Floating frosted-glass island with native
 * scrub gesture, iOS-style outline icons, and a squircle Касса CTA.
 *
 * Touch model (after build9 hot-fix):
 *   • Per-tab `Pressable` handles the TAP. Pressables are the most
 *     reliable RN touch primitive — they always fire, never get
 *     starved by other gestures. One per tab, including the Касса
 *     slot, so a static tap reliably navigates / triggers haptics.
 *   • A SEPARATE Pan gesture sits OVER the entire bar via a
 *     pass-through layer (zIndex above the row, but only ACTIVATES
 *     after the user moves 10pt). Below that threshold, touches fall
 *     through to the Pressable underneath. So a tap → Pressable, a
 *     drag → Pan. They coexist cleanly without `Gesture.Race`, which
 *     in build9 was eating taps.
 *
 * Pan does the iOS-style scrub:
 *   • Capsule tracks the finger on the UI thread.
 *   • Selection-haptic on every slot crossing.
 *   • Release → spring snap to nearest slot + navigate (skipping
 *     Касса — it has its own discrete CTA).
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { House, Package, Receipt, LayoutGrid, type LucideIcon } from 'lucide-react-native';
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
import { haptic } from '../platform/haptics';
import { SPRING_TIGHT } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS } from './TabBarShared';

const BAR_HEIGHT = 60;
const HORIZONTAL_MARGIN = 14;
const TOP_LIFT = 6;
const BOTTOM_LIFT = 8;
const CORNER_RADIUS = BAR_HEIGHT / 2;

const CAPSULE_RADIUS = 14;
const CAPSULE_INSET_V = 6;
const CAPSULE_PADDING_H = 6;

// Minimum drag distance before pan activates. Below this, the touch
// is treated as a tap and the per-tab Pressable handles it.
const PAN_MIN_DISTANCE = 10;

const TAB_ICONS: Record<string, LucideIcon> = {
  Dashboard: House,
  Products: Package,
  Checks: Receipt,
  MoreTab: LayoutGrid,
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);
  const palette = useColors();

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeFocusedIndex = focusedIndex < 0 ? 0 : focusedIndex;

  const [rowWidth, setRowWidth] = React.useState(0);
  const slotWidth = rowWidth / TAB_DEFINITIONS.length;

  const capsuleX = useSharedValue(0);
  const lastSlot = useSharedValue(safeFocusedIndex);
  const dragging = useSharedValue(false);

  React.useEffect(() => {
    if (rowWidth === 0) return;
    if (dragging.value) return;
    capsuleX.value = withSpring(slotWidth * safeFocusedIndex, SPRING_TIGHT);
    lastSlot.value = safeFocusedIndex;
  }, [safeFocusedIndex, rowWidth, slotWidth, capsuleX, lastSlot, dragging]);

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

  const fireCrossingHaptic = React.useCallback(() => {
    haptic('select');
  }, []);

  // Pan only — taps are handled by the Pressables underneath this
  // layer. minDistance=10 means a tap (≤10pt of movement) never
  // triggers pan, so the Pressable receives the touch as expected.
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .minDistance(PAN_MIN_DISTANCE)
        .onStart(() => {
          'worklet';
          dragging.value = true;
        })
        .onUpdate((e) => {
          'worklet';
          if (rowWidth === 0 || slotWidth === 0) return;
          const clamped = Math.max(0, Math.min(rowWidth - slotWidth, e.x - slotWidth / 2));
          capsuleX.value = clamped;
          const idx = Math.round(e.x / slotWidth);
          if (idx !== lastSlot.value && idx >= 0 && idx < TAB_DEFINITIONS.length) {
            lastSlot.value = idx;
            runOnJS(fireCrossingHaptic)();
          }
        })
        .onEnd((e) => {
          'worklet';
          dragging.value = false;
          if (rowWidth === 0 || slotWidth === 0) return;
          const idx = Math.round(e.x / slotWidth);
          const clamped = Math.max(0, Math.min(TAB_DEFINITIONS.length - 1, idx));
          const def = TAB_DEFINITIONS[clamped];
          if (def && !def.isKassa) {
            runOnJS(navigateToIndex)(clamped);
          } else {
            capsuleX.value = withSpring(slotWidth * safeFocusedIndex, SPRING_TIGHT);
          }
        })
        .onFinalize(() => {
          'worklet';
          dragging.value = false;
        }),
    [
      capsuleX,
      lastSlot,
      dragging,
      rowWidth,
      slotWidth,
      safeFocusedIndex,
      navigateToIndex,
      fireCrossingHaptic,
    ],
  );

  const capsuleStyle = useAnimatedStyle(() => ({
    width: slotWidth - CAPSULE_PADDING_H * 2,
    transform: [{ translateX: capsuleX.value + CAPSULE_PADDING_H }],
  }));

  // Theme-aware surface tones. The bar uses BlurView underneath and a
  // light overlay on top; both are tuned per mode so the bar reads as
  // a discrete material in both light and dark contexts.
  const blurTint = palette.bg.canvas === '#0a0d14' ? 'dark' : 'light';
  const surfaceTint = palette.bg.canvas === '#0a0d14'
    ? 'rgba(20, 26, 37, 0.65)' // dark mode — sit slightly above canvas
    : 'rgba(255, 255, 255, 0.45)';
  const rim = palette.bg.canvas === '#0a0d14'
    ? 'rgba(255, 255, 255, 0.06)'
    : 'rgba(255, 255, 255, 0.95)';
  const islandBorder = palette.bg.canvas === '#0a0d14'
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(15, 23, 42, 0.08)';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: TOP_LIFT, paddingBottom: safeBottom + BOTTOM_LIFT }]}
    >
      <View style={[styles.island, { height: BAR_HEIGHT, borderColor: islandBorder }]}>
        <BlurView intensity={80} tint={blurTint} style={StyleSheet.absoluteFill} />
        <View style={[styles.surfaceTint, { backgroundColor: surfaceTint }]} pointerEvents="none" />
        <View style={[styles.topRim, { backgroundColor: rim }]} pointerEvents="none" />

        {/* Selection capsule behind icons. */}
        <Animated.View
          style={[
            styles.capsule,
            capsuleStyle,
            {
              backgroundColor: palette.accent.primarySoft,
              borderColor: palette.bg.canvas === '#0a0d14' ? 'rgba(96, 165, 250, 0.25)' : 'rgba(37, 99, 235, 0.15)',
            },
          ]}
          pointerEvents="none"
        />

        {/* Pan wraps the row; Pressables INSIDE the row receive taps
            natively because Pan's minDistance(10) keeps it from
            activating on static touches. Tap → Pressable. Drag → Pan. */}
        <GestureDetector gesture={panGesture}>
          <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
            {TAB_DEFINITIONS.map((tab) => {
              const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
              const focused = state.index === routeIndex;

              if (tab.isKassa) {
                return (
                  <Pressable
                    key={tab.routeName}
                    style={styles.kassaSlot}
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
                  routeName={tab.routeName}
                  label={tab.label}
                  focused={focused}
                  onPress={onPress}
                  palette={palette}
                />
              );
            })}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

interface TabItemProps {
  routeName: string;
  label: string;
  focused: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}

function TabItem({ routeName, label, focused, onPress, palette }: TabItemProps) {
  const focusValue = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    focusValue.value = withSpring(focused ? 1 : 0, SPRING_TIGHT);
  }, [focused, focusValue]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusValue.value * 0.06 }],
  }));

  const Cmp = TAB_ICONS[routeName];
  const tint = focused ? palette.accent.primaryText : palette.text.secondary;

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
    >
      <Animated.View style={iconStyle}>
        {Cmp ? (
          <Cmp
            size={22}
            color={tint}
            strokeWidth={focused ? 2.2 : 1.7}
            fill="none"
          />
        ) : null}
      </Animated.View>
      <Text
        variant="caption"
        style={[
          styles.label,
          { color: tint, fontWeight: focused ? '600' : '500' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    backgroundColor: 'transparent',
  },
  surfaceTint: {
    ...StyleSheet.absoluteFillObject,
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
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
    borderWidth: StyleSheet.hairlineWidth,
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
