/**
 * TabBar — iOS variant. Premium native Liquid Glass bar with an animated
 * droplet highlight implemented in Swift (autexa-liquid-glass).
 *
 *  • Native AutexaLiquidGlassTabBar handles ALL of:
 *      – the glass background (UIVisualEffectView, iOS 26 UIGlassEffect)
 *      – the spring-animated droplet that follows finger / snaps to slot
 *      – pan gesture, tap gesture, haptics
 *  • Icons + labels + Касса dome are RN siblings rendered ABOVE the
 *    native bar (separate absolutely-positioned overlay) — never as
 *    native children, because UIView subview re-layout interferes with
 *    RN's flex layout and the icons end up squished.
 *  • onTabPress(index) bubbles up natively → forward to react-navigation.
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

const BAR_HEIGHT = 58;
const KASSA_SIZE = 46;
const FLOAT_LIFT = 8;
const BAR_HORIZONTAL_MARGIN = 14;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

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
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 10) + FLOAT_LIFT }]}
    >
      <View style={styles.outerGlow} pointerEvents="none" />

      {/* Bar container — sits relative to wrapper, so the overlay row above
          can use `position: absolute` to stack icons exactly over it. */}
      <View style={styles.barWrap}>
        <AutexaLiquidGlassTabBar
          tabCount={TAB_DEFINITIONS.length}
          activeIndex={safeIndex}
          bottomInset={insets.bottom}
          onTabPress={navigateToTab}
          style={styles.bar}
        />

        {/* Icons + labels overlaid above the native bar (NOT children of
            it). pointerEvents="none" so taps and pans pass straight to the
            native gesture recognizers — they emit onTabPress and animate
            the droplet. JS here is pure presentation. */}
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
 * KassaGlassDome — compact, native-feeling centre button.
 */
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
      <Ionicons name="receipt-outline" size={20} color={colors.white} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  outerGlow: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 6,
    height: BAR_HEIGHT - 4,
    borderRadius: 30,
    backgroundColor: colors.primary[700],
    opacity: 0.05,
  },
  // Wrapper that holds the native bar AND the icons row at the same z.
  barWrap: {
    height: BAR_HEIGHT,
    marginHorizontal: BAR_HORIZONTAL_MARGIN,
  },
  bar: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 0.66,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: colors.primary[800],
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  // Icon overlay — flex row that fills the bar exactly, so each child
  // (item) takes 1/Nth of the width without manual left/width math.
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
