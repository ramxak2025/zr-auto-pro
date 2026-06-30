/**
 * AdminTabBar — the «особое нижнее меню» for the superadmin platform-operator
 * shell. A premium floating island, visually consistent with the car-service
 * Liquid Glass bar, but WITHOUT the central Касса FAB math — every slot is an
 * equal-width tab.
 *
 * Design:
 *   • Floating, absolutely-positioned island (lifted out of the navigator's
 *     flex flow) so the admin screens scroll UNDER the glass.
 *   • Glass surface via <AutexaLiquidGlassView> — native UIVisualEffectView on
 *     iOS (upgrades to UIGlassEffect on iOS 26), translucent View fallback on
 *     Android. Same surface primitive the rest of the app uses.
 *   • A Reanimated active "pill" slides under the focused tab with an Apple
 *     spring (Android: M3 timing). Reduce-motion → no slide, instant snap.
 *   • Selection haptic on tab switch (softer on Android per platform/haptics).
 *   • Respects insets.bottom + Home Indicator via the shared useAdminTabBarHeight.
 *
 * Deliberately mirrors the geometry constants in useAdminTabBarHeight so the
 * screens' paddingBottom matches the bar's true visible occupation.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassView } from 'autexa-liquid-glass';
import React from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { SPRING_TIGHT, TIMING_STANDARD, preferSpring } from '../platform/motion';
import { useColors } from '../contexts/ThemeContext';
import {
  ADMIN_BAR_HEIGHT,
  ADMIN_BAR_HORIZONTAL_MARGIN,
  ADMIN_BAR_TOP_LIFT,
  ADMIN_BAR_BOTTOM_LIFT,
} from '../hooks/useAdminTabBarHeight';

/** Tab metadata for the admin shell — route name → label + icons. */
export interface AdminTabDef {
  routeName: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

export const ADMIN_TAB_DEFINITIONS: AdminTabDef[] = [
  { routeName: 'AdminOverview', label: 'Обзор', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { routeName: 'AdminTenants', label: 'Тенанты', icon: 'business-outline', iconActive: 'business' },
  { routeName: 'AdminPlans', label: 'Тарифы', icon: 'pricetags-outline', iconActive: 'pricetags' },
  { routeName: 'AdminBroadcast', label: 'Рассылка', icon: 'megaphone-outline', iconActive: 'megaphone' },
  {
    routeName: 'AdminMore',
    label: 'Ещё',
    icon: 'ellipsis-horizontal-circle-outline',
    iconActive: 'ellipsis-horizontal-circle',
  },
];

const CORNER_RADIUS = ADMIN_BAR_HEIGHT / 2;

export default function AdminTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);
  const palette = useColors();

  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (!cancelled) setReduceMotion(!!v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the focused admin tab index from the navigator state. Falls back
  // to 0 when nothing matches (cold start).
  const focusedIndex = React.useMemo(() => {
    const idx = ADMIN_TAB_DEFINITIONS.findIndex(
      (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
    );
    return idx < 0 ? 0 : idx;
  }, [state]);

  // Measure the inner row width so the sliding pill can position itself.
  // `slotWidth` is rowWidth / tabCount.
  const [rowWidth, setRowWidth] = React.useState(0);
  const tabCount = ADMIN_TAB_DEFINITIONS.length;
  const slotWidth = rowWidth > 0 ? rowWidth / tabCount : 0;

  const pillX = useSharedValue(0);
  React.useEffect(() => {
    if (slotWidth <= 0) return;
    const target = focusedIndex * slotWidth;
    if (reduceMotion) {
      pillX.value = target;
    } else if (preferSpring) {
      pillX.value = withSpring(target, SPRING_TIGHT);
    } else {
      pillX.value = withTiming(target, TIMING_STANDARD);
    }
  }, [focusedIndex, slotWidth, reduceMotion, pillX]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  // The hardcoded white hairline border + top rim read as premium glass on a
  // light surface, but on Android (where we paint an opaque palette surface
  // instead of the native UIVisualEffectView) a bright white edge clashes in
  // dark mode. iOS keeps the live-glass white rim; Android derives the edge
  // from the active theme so it reads correctly in both light and dark.
  const isDark = palette.mode === 'dark';
  const islandBorderColor =
    Platform.OS === 'ios' ? 'rgba(255,255,255,0.6)' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const topRimColor =
    Platform.OS === 'ios' ? 'rgba(255,255,255,0.85)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.9)';

  const navigateToTab = React.useCallback(
    (index: number) => {
      const tab = ADMIN_TAB_DEFINITIONS[index];
      if (!tab) return;
      const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
      const focused = state.index === routeIndex;
      const event = navigation.emit({
        type: 'tabPress',
        target: state.routes[routeIndex]?.key ?? tab.routeName,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        haptic('select');
        navigation.navigate(tab.routeName as never);
      }
    },
    [state, navigation],
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: ADMIN_BAR_TOP_LIFT, paddingBottom: safeBottom + ADMIN_BAR_BOTTOM_LIFT }]}
    >
      <View style={[styles.island, { height: ADMIN_BAR_HEIGHT, borderColor: islandBorderColor }]}>
        {/* iOS: the native UIVisualEffectView (UIGlassEffect on iOS 26) is the
            surface — it auto-tints via the trait collection, so live content
            blurs through the floating island.

            Android / non-native: AutexaLiquidGlassView's JS fallback paints a
            HARDCODED rgba(255,255,255,0.92) — opaque white regardless of theme,
            which washes out a dark backing and reads as a white bar in dark
            mode. So on Android we DON'T mount the glass view; instead we paint a
            theme-aware opaque palette surface (same approach TabBar.android.tsx
            takes — it builds its own tonal surface rather than the white-only
            glass primitive). */}
        {Platform.OS === 'ios' ? (
          <AutexaLiquidGlassView variant="thinMaterial" topRim style={styles.glass} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.bg.elevated }]} pointerEvents="none" />
        )}

        {/* Top hairline rim — subtle premium touch on iOS, theme-aware on Android. */}
        <View style={[styles.topRim, { backgroundColor: topRimColor }]} pointerEvents="none" />

        <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)} pointerEvents="box-none">
          {/* Sliding active pill — sits BEHIND the icons. */}
          {slotWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                pillStyle,
                {
                  width: slotWidth - 12,
                  marginHorizontal: 6,
                  backgroundColor: palette.accent.primarySoft,
                },
              ]}
            />
          )}

          {ADMIN_TAB_DEFINITIONS.map((tab, index) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;
            return (
              <AdminTabItem
                key={tab.routeName}
                tab={tab}
                focused={focused}
                palette={palette}
                reduceMotion={reduceMotion}
                onPress={() => navigateToTab(index)}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

interface AdminTabItemProps {
  tab: AdminTabDef;
  focused: boolean;
  palette: ReturnType<typeof useColors>;
  reduceMotion: boolean;
  onPress: () => void;
}

function AdminTabItem({ tab, focused, palette, reduceMotion, onPress }: AdminTabItemProps) {
  // Active tab pops a touch more (1.08) so the focused icon reads as clearly
  // emphasised — the focused glyph (e.g. the filled `pricetags` price-tag) sits
  // on the soft pill in `primaryText`, never a flat low-contrast blob.
  const scale = useSharedValue(focused ? 1.08 : 1);
  React.useEffect(() => {
    if (reduceMotion) {
      scale.value = focused ? 1.08 : 1;
    } else {
      scale.value = withSpring(focused ? 1.08 : 1, SPRING_TIGHT);
    }
  }, [focused, reduceMotion, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const tint = focused ? palette.accent.primaryText : palette.text.secondary;

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={tab.label}
      hitSlop={6}
    >
      <Animated.View style={iconStyle}>
        <Ionicons name={focused ? tab.iconActive : tab.icon} size={22} color={tint} />
      </Animated.View>
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ marginTop: 2, color: tint, fontWeight: focused ? '700' : '500', fontSize: 10 }}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Absolute, anchored to the bottom edge so the navigator gives the scene the
  // FULL height and the glass floats over live content (see TabBar.ios.tsx for
  // the detailed rationale this mirrors).
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  island: {
    marginHorizontal: ADMIN_BAR_HORIZONTAL_MARGIN,
    borderRadius: CORNER_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // borderColor set inline (theme-aware on Android, white glass rim on iOS).
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    ...(Platform.OS === 'android' ? { elevation: 8 } : null),
  },
  glass: {
    ...StyleSheet.absoluteFillObject,
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    // backgroundColor set inline (theme-aware on Android, white glass rim on iOS).
  },
  row: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  pill: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    borderRadius: 999,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
