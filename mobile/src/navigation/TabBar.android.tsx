/**
 * TabBar — Android variant. Material 3 NavigationBar.
 *
 * Spec mirrors the official M3 guidance (https://m3.material.io/components/navigation-bar):
 *   • 80pt tall (Material 3 reference) on top of the system gesture inset.
 *   • Opaque white "surface" background with a 1pt top hairline using
 *     gray[100] — the canonical M3 surface-on-surface separator on light
 *     theme.
 *   • Active destination = filled-icon glyph on a 32×64 pill of
 *     primary[100] (the M3 "secondaryContainer" idiom on the primary
 *     family). Indicator alpha + tiny scale on focus change.
 *   • Inactive destination = OUTLINED-icon glyph + label. We use Material
 *     Community Icons because @expo/vector-icons ships only the Filled
 *     style of stock MaterialIcons; MCI carries both the filled and the
 *     `-outline`-suffixed pair we need for the M3 filled/outline
 *     transition.
 *   • Labels are visible on every destination (matches the iOS variant of
 *     this app — product cohesion beats Material's "label-on-active-only"
 *     default for our use case).
 *   • Tap feedback = `android_ripple` on the Pressable, bounded by the
 *     item rect; press also fires a soft 'tap' haptic.
 *   • Central «Касса» destination is the same `KassaButton` visual used
 *     on iOS (plasma + gradient) — kept identical so users moving between
 *     devices recognise the central CTA. The button sits inside the bar
 *     row (no FAB-above-bar cut-out) — that's the cleanest M3-compatible
 *     way to render a strongly-branded center action without breaking
 *     the navigation-bar geometry.
 *   • Safe-area bottom padding accounts for both the legacy 3-button
 *     navigation chin (no extra inset needed beyond the system inset) AND
 *     the gesture-bar (where insets.bottom can be 0 on some OEMs — we
 *     enforce a small minimum so the bar never overlaps the gesture
 *     swipe-up zone).
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { TIMING_FAST } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS, TabDefinition } from './TabBarShared';

const BAR_HEIGHT = 80;
const PILL_HEIGHT = 32;
const PILL_WIDTH = 64;

// Material 3 active-indicator tone: primary container on light theme.
// Using primary[100] gives a saturated "secondary container" feel that's
// clearly distinguishable from the surface.
const ACTIVE_PILL_BG = colors.primary[100];
const ACTIVE_TINT = colors.primary[700];
const INACTIVE_TINT = colors.gray[600];

type M3IconPair = {
  filled: keyof typeof MaterialCommunityIcons.glyphMap;
  outlined: keyof typeof MaterialCommunityIcons.glyphMap;
};

// M3-icon mapping using MaterialCommunityIcons (both filled and -outline
// variants ship in this family). Kept inline because the M3 navigation-bar
// filled/outline pattern is unique to this surface and shouldn't bleed
// into the shared `Icon` abstraction (which uses Filled SF Symbols on
// iOS by design).
const M3_TAB_ICONS: Record<string, M3IconPair> = {
  Dashboard: { filled: 'home-variant', outlined: 'home-variant-outline' },
  Products: { filled: 'package-variant-closed', outlined: 'package-variant-closed' },
  NewCheck: { filled: 'receipt', outlined: 'receipt' }, // unused — kassa renders KassaButton
  Checks: { filled: 'text-box', outlined: 'text-box-outline' },
  MoreTab: { filled: 'view-grid', outlined: 'view-grid-outline' },
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.row}>
          {TAB_DEFINITIONS.map((tab) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;

            if (tab.isKassa) {
              return (
                <Pressable
                  key={tab.routeName}
                  style={styles.kassaSlot}
                  android_ripple={{ color: 'transparent', borderless: true }}
                  onPress={() => {
                    haptic('impact');
                    navigation.navigate(tab.routeName as never);
                  }}
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
                focused={focused}
                tab={tab}
                onPress={onPress}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

interface TabItemProps {
  focused: boolean;
  tab: TabDefinition;
  onPress: () => void;
}

function TabItem({ focused, tab, onPress }: TabItemProps) {
  // M3 active-indicator pill: scale-in + alpha. Spec says the indicator
  // appears with a "container morph"; alpha + a subtle scale read as
  // that morph without animating layout (which would risk flicker on
  // older Android devices).
  const alpha = useSharedValue(focused ? 1 : 0);
  const scale = useSharedValue(focused ? 1 : 0.85);
  React.useEffect(() => {
    alpha.value = withTiming(focused ? 1 : 0, TIMING_FAST);
    scale.value = withTiming(focused ? 1 : 0.85, TIMING_FAST);
  }, [focused, alpha, scale]);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: alpha.value,
    transform: [{ scale: scale.value }],
  }));

  const glyphPair = M3_TAB_ICONS[tab.routeName] ?? M3_TAB_ICONS.Dashboard;
  const iconName = focused ? glyphPair.filled : glyphPair.outlined;
  const tint = focused ? ACTIVE_TINT : INACTIVE_TINT;

  return (
    <View style={styles.itemWrap}>
      <Pressable
        style={styles.item}
        android_ripple={{
          color: 'rgba(37, 99, 235, 0.12)', // primary[600] at 12 % — M3 state-layer
          foreground: true,
          borderless: false,
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: focused }}
      >
        {/* Active-indicator pill */}
        <Animated.View style={[styles.pill, pillStyle]} />
        <MaterialCommunityIcons name={iconName} size={24} color={tint} />
        <Text
          variant="caption"
          style={{
            marginTop: 4,
            fontSize: 12,
            color: tint,
            fontWeight: focused ? '600' : '500',
          }}
        >
          {tab.label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[100],
    // M3 NavigationBar = no elevation by default on light theme — the
    // hairline divider does the visual lifting. (Material 3 added the
    // optional "elevation token" but the spec example uses tone-only.)
    elevation: 0,
  },
  bar: {
    height: BAR_HEIGHT,
    backgroundColor: colors.white,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  itemWrap: {
    flex: 1,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
    paddingTop: 12,
    paddingBottom: 16,
  },
  pill: {
    position: 'absolute',
    top: 12,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: ACTIVE_PILL_BG,
  },
  // Kassa slot — keeps the KassaButton centered without ripple bleeding
  // beyond the central CTA's visual bounds.
  kassaSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT,
  },
});
