/**
 * TabBar — iOS variant. Native Liquid Glass tab bar following the iOS
 * Music / Photos / Apple Maps pattern: bar is FLUSH with the screen's
 * bottom edge (no floating chin), glass extends THROUGH the home-
 * indicator safe area, icons sit at the top of the bar with the safe
 * area as breathing room below.
 *
 * Geometry (top → bottom inside the bar):
 *   • [icons row]   — height ICON_ROW_H, where the user taps
 *   • [safe-area pad] — height insets.bottom, glass-covered too so the
 *                       home indicator never reads on a different colour
 *
 * The bar has rounded TOP corners and square bottom corners (the
 * bottom is the screen's hard edge), exactly like UIKit's UITabBar.
 *
 *  • Native AutexaLiquidGlassTabBar (Swift) handles glass + droplet +
 *    pan gesture + spring snap + UISelectionFeedback / UIImpactFeedback.
 *  • This file is pure presentation: icons + labels + Касса dome
 *    overlaid on top (pointerEvents="none" so the native layer owns
 *    every touch).
 *  • onTabPress(index) bubbles up natively → forwarded to react-navigation.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassTabBar } from 'autexa-liquid-glass';
import { LinearGradient } from 'expo-linear-gradient';
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

const ICON_ROW_H = 56;
const KASSA_SIZE = 42;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Total bar height: visible icon area + safe-area inset (so the glass
  // covers the home indicator instead of leaving a grey strip below it).
  const safeBottom = Math.max(insets.bottom, 0);
  const totalH = ICON_ROW_H + safeBottom;

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
    <View pointerEvents="box-none" style={[styles.wrapper, { height: totalH }]}>
      {/* Native glass + droplet — fills the entire bar (icons area AND
          safe area), edges touch the screen sides for a native flush feel. */}
      <AutexaLiquidGlassTabBar
        tabCount={TAB_DEFINITIONS.length}
        activeIndex={safeIndex}
        bottomInset={safeBottom}
        onTabPress={navigateToTab}
        style={styles.bar}
      />

      {/* Hairline rim that sits on the very top of the bar — separates it
          visually from the screen content above. UIKit does this too. */}
      <View style={styles.topRim} pointerEvents="none" />

      {/* Icons row — pinned to the TOP of the bar so the safe area below
          is just glass-covered breathing room, mirroring native UITabBar. */}
      <View style={[styles.iconsRow, { height: ICON_ROW_H }]} pointerEvents="none">
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

function KassaGlassDome({ focused }: { focused: boolean }) {
  const scale = useSharedValue(focused ? 1.04 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.04 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[s.dome, animatedStyle]}>
      <LinearGradient
        colors={[colors.primary[400], colors.primary[600]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Ionicons name="receipt-outline" size={18} color={colors.white} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The wrapper is the entire bar's hit area. Background transparent —
  // the bar's GLASS provides the visual surface.
  wrapper: {
    backgroundColor: 'transparent',
  },
  // Glass fills 100% of wrapper. No margins, no rounded corners on
  // the bottom — the bar IS the screen's bottom edge now.
  bar: {
    ...StyleSheet.absoluteFillObject,
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  // Icons row pinned to the top portion of the bar.
  iconsRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  dome: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: KASSA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});
