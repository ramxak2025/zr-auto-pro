/**
 * TabBar — Android variant. Floating frosted-glass island with native
 * scrub gesture, iOS-style outline icons, and a squircle Касса CTA.
 *
 * Surface (matte glass):
 *   • `expo-blur` BlurView at `tint="light"`, intensity 80 — true
 *     native blur on Android 12+, translucent surface on older.
 *   • Faint warm surface tint on top so the bar still reads as a
 *     discrete surface on screens that have no contrast behind it.
 *   • Pill geometry (60pt × full-corner radius), 14pt side margins,
 *     soft drop shadow.
 *
 * Icons (clean, NOT garishly filled):
 *   • Outline Lucide glyphs at fixed stroke-width. We DO NOT switch
 *     fill on focus — that was the "completely flooded" look the
 *     owner called ugly. Focus is communicated entirely by the
 *     selection capsule plus a tint colour swap + small scale; the
 *     icon stays a crisp outline at all times.
 *   • Active stroke = 2.2 (slightly bolder), inactive = 1.7.
 *
 * Selection capsule:
 *   • Rounded RECTANGLE (radius 14), translucent primary[100].
 *   • Springs into place via a single Reanimated shared value.
 *
 * Pan gesture (native scrub):
 *   • `Gesture.Pan().minDistance(0).runOnJS(false)` — runs entirely
 *     on the UI thread. Finger drives the capsule directly through
 *     `capsuleX` shared value, with NO bridge round-trip.
 *   • Tap is composed via `Gesture.Race(tap, pan)` so a static touch
 *     still fires the tab press immediately, no minimum drag distance.
 *   • Selection haptic fires as the capsule centre crosses a new
 *     slot — same rhythmic feedback iOS gives for keyboard-cursor
 *     scrub.
 *   • Release: snap capsule with spring, navigate to the slot under
 *     the finger (skipping the Касса slot — that's a discrete CTA).
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { House, Package, Receipt, LayoutGrid, type LucideIcon } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';
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
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS } from './TabBarShared';

// ── Floating island geometry (mirrors TabBar.ios.tsx) ────────────────────
const BAR_HEIGHT = 60;
const HORIZONTAL_MARGIN = 14;
const TOP_LIFT = 6;
const BOTTOM_LIFT = 8;
const CORNER_RADIUS = BAR_HEIGHT / 2;

const CAPSULE_RADIUS = 14;
const CAPSULE_INSET_V = 6;
const CAPSULE_PADDING_H = 6;

// Direct Lucide → tab routing. We pick line-art icons with consistent
// visual weight so the bar reads as a single family.
const TAB_ICONS: Record<string, LucideIcon> = {
  Dashboard: House,
  Products: Package,
  Checks: Receipt,
  MoreTab: LayoutGrid,
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeFocusedIndex = focusedIndex < 0 ? 0 : focusedIndex;

  // Measured row width — needed to translate the capsule into the
  // right slot. Set on the GestureDetector's child via onLayout.
  const [rowWidth, setRowWidth] = React.useState(0);
  const slotWidth = rowWidth / TAB_DEFINITIONS.length;

  // The currently visible capsule X (px from row's left).
  const capsuleX = useSharedValue(0);
  // Which slot the capsule centre currently sits over — used to fire
  // a selection haptic on every boundary crossing during pan.
  const lastSlot = useSharedValue(safeFocusedIndex);
  // Whether the user is currently dragging — when true, suppress the
  // spring-back animation that the `safeFocusedIndex` effect would
  // otherwise trigger on every render.
  const dragging = useSharedValue(false);

  // Snap to the focused tab whenever it changes (after navigation or
  // initial layout). If the user is currently dragging, leave the
  // capsule under their finger — onEnd will spring it home.
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

  // Pan — drives the capsule directly on the UI thread. minDistance(0)
  // means the gesture activates immediately on touch (no dead zone),
  // so a slow drag from the very first touch tracks the finger.
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
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
          // If we landed over the Касса slot, snap back without
          // navigating — Касса has its own dedicated tap target.
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

  // Tap — fires immediately on a static touch (no minimum drag).
  // Composed with pan via Race: whichever wins first handles it,
  // and a brief touch with no movement wins as a tap.
  const tapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(220)
        .onEnd((e) => {
          'worklet';
          if (rowWidth === 0 || slotWidth === 0) return;
          const idx = Math.floor(e.x / slotWidth);
          const clamped = Math.max(0, Math.min(TAB_DEFINITIONS.length - 1, idx));
          const def = TAB_DEFINITIONS[clamped];
          if (!def) return;
          if (def.isKassa) {
            runOnJS(haptic)('impact');
          }
          runOnJS(navigateToIndex)(clamped);
        }),
    [rowWidth, slotWidth, navigateToIndex],
  );

  const combinedGesture = React.useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
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
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.surfaceTint} pointerEvents="none" />
        <View style={styles.topRim} pointerEvents="none" />

        {/* Selection capsule behind icons. */}
        <Animated.View style={[styles.capsule, capsuleStyle]} pointerEvents="none" />

        <GestureDetector gesture={combinedGesture}>
          <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
            {TAB_DEFINITIONS.map((tab) => {
              const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
              const focused = state.index === routeIndex;

              if (tab.isKassa) {
                return (
                  <View key={tab.routeName} style={styles.kassaSlot}>
                    <KassaButton />
                  </View>
                );
              }

              return <TabItem key={tab.routeName} routeName={tab.routeName} label={tab.label} focused={focused} />;
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
}

function TabItem({ routeName, label, focused }: TabItemProps) {
  const focusValue = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    focusValue.value = withSpring(focused ? 1 : 0, SPRING_TIGHT);
  }, [focused, focusValue]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusValue.value * 0.06 }],
  }));

  const Cmp = TAB_ICONS[routeName];
  const tint = focused ? colors.primary[700] : colors.gray[500];

  return (
    <View style={styles.item} pointerEvents="none">
      <Animated.View style={iconStyle}>
        {Cmp ? (
          <Cmp
            size={22}
            color={tint}
            // OUTLINE-only icons — the previous "filled when active"
            // look read as garish on Android. Focus is conveyed by
            // the capsule + colour swap + small scale.
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
    </View>
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
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(37, 99, 235, 0.15)',
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
