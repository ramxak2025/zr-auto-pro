/**
 * TabBar — iOS variant. Premium native Liquid Glass tab bar rendered as
 * a Telegram-style FLOATING ISLAND over the screen content. The visible
 * surface, the spring-animated droplet that follows the finger, the pan
 * and tap gestures, the haptics, and the iOS 26 UIGlassEffect upgrade
 * all live in Swift. JS only paints icons + labels on top.
 *
 * Geometry:
 *   • Floating island with 14pt horizontal margins and 10pt above the
 *     bottom safe-area inset. Fully rounded (full pill — borderRadius
 *     equals half the bar height).
 *   • Soft drop shadow underneath for depth.
 *   • Glass surface fills the entire island; rounded with continuous
 *     corner curve via the native overflow-clipped UIVisualEffectView.
 *
 * Native side (Swift, in mobile/modules/autexa-liquid-glass/ios/):
 *   • AutexaLiquidGlassTabBarView.swift   — UIVisualEffectView, droplet
 *     (UIView + CAGradientLayer + hairline border), UIPanGestureRecognizer,
 *     UITapGestureRecognizer, UISpringTimingParameters / UIView spring,
 *     UISelectionFeedback / UIImpactFeedback haptics, runtime UIGlassEffect
 *     upgrade for iOS 26+.
 *   • AutexaLiquidGlassModule.swift       — registers the view as a
 *     dedicated Expo Module ("AutexaLiquidGlassTabBar") so the JS lookup
 *     name is unambiguous.
 *
 * onTabPress(index) bubbles up natively → forwarded to react-navigation.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassTabBar } from 'autexa-liquid-glass';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon } from '../platform/Icon';
import { SPRING_TIGHT } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { TAB_DEFINITIONS } from './TabBarShared';

const BAR_HEIGHT = 60;
const HORIZONTAL_MARGIN = 14;
const BOTTOM_LIFT = 10;
const CORNER_RADIUS = BAR_HEIGHT / 2;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeIndex = focusedIndex < 0 ? 0 : focusedIndex;

  const navigateToTab = React.useCallback(
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
        navigation.navigate(tab.routeName as never);
      }
    },
    [state, navigation],
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { paddingBottom: safeBottom + BOTTOM_LIFT }]}>
      {/* Soft outer glow for depth — sits BEHIND the island. */}
      <View style={styles.outerGlow} pointerEvents="none" />

      <View style={styles.island}>
        {/* Native glass + droplet — fills the rounded island. */}
        <AutexaLiquidGlassTabBar
          tabCount={TAB_DEFINITIONS.length}
          activeIndex={safeIndex}
          bottomInset={0}
          onTabPress={navigateToTab}
          style={styles.bar}
        />

        {/* White hairline rim along the top edge — subtle premium touch. */}
        <View style={styles.topRim} pointerEvents="none" />

        {/* Icons + labels on a separate absolute layer; pointerEvents="none"
            so taps and pans pass straight through to the native gestures. */}
        <View style={styles.iconsRow} pointerEvents="none">
          {TAB_DEFINITIONS.map((tab) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;

            if (tab.isKassa) {
              return (
                <View key={tab.routeName} style={styles.item}>
                  <KassaGlassDome focused={focused} />
                </View>
              );
            }

            return <TabItem key={tab.routeName} focused={focused} label={tab.label} icon={tab.icon} />;
          })}
        </View>
      </View>
    </View>
  );
}

interface TabItemProps {
  focused: boolean;
  label: string;
  icon: (typeof TAB_DEFINITIONS)[number]['icon'];
}

function TabItem({ focused, label, icon }: TabItemProps) {
  const scale = useSharedValue(focused ? 1.06 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const tint = focused ? colors.primary[700] : colors.gray[500];

  return (
    <View style={styles.item}>
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={22} color={tint} weight={focused ? 'semibold' : 'regular'} />
      </Animated.View>
      {label.length > 0 && (
        <Text
          variant="caption"
          style={{
            marginTop: 1,
            color: tint,
            fontWeight: focused ? '600' : '500',
            fontSize: 10,
          }}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

/**
 * KassaGlassDome — primary action button at the centre of the bar.
 * Compact squircle, no protruding dome (that's a Material pattern, not iOS).
 */
function KassaGlassDome({ focused }: { focused: boolean }) {
  const scale = useSharedValue(focused ? 1.05 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.05 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[s.dome, animatedStyle]}>
        <Ionicons name="add" size={22} color={colors.white} />
      </Animated.View>
      <Text
        variant="caption"
        style={{
          marginTop: 2,
          color: colors.primary[700],
          fontWeight: focused ? '700' : '600',
          fontSize: 10,
        }}
      >
        Касса
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  // Subtle blue-tinted glow under the island — sells "premium glass".
  outerGlow: {
    position: 'absolute',
    left: HORIZONTAL_MARGIN + 6,
    right: HORIZONTAL_MARGIN + 6,
    top: 14,
    height: BAR_HEIGHT,
    borderRadius: CORNER_RADIUS,
    backgroundColor: colors.primary[700],
    opacity: 0.06,
  },
  // The floating island — full-pill rounded, soft shadow, hairline border.
  island: {
    height: BAR_HEIGHT,
    marginHorizontal: HORIZONTAL_MARGIN,
    borderRadius: CORNER_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: colors.primary[800],
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  bar: {
    ...StyleSheet.absoluteFillObject,
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  iconsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});

const s = StyleSheet.create({
  // Compact accent button — squircle, small shadow.
  dome: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
