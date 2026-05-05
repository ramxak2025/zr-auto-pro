/**
 * TabBar — iOS variant. Premium native Liquid Glass bar with an animated
 * droplet highlight implemented in Swift (autexa-liquid-glass).
 *
 *  • Background, droplet, gestures, springs and haptics all live in the
 *    native AutexaLiquidGlassTabBarView (UIVisualEffectView with iOS 26
 *    UIGlassEffect upgrade, UIPanGestureRecognizer, UISelectionFeedback)
 *  • This file only paints icons + labels + the centre Касса dome on top
 *    of the native bar via RN children (positioned absolute slot-by-slot
 *    so the native droplet underneath stays perfectly aligned)
 *  • Pan + tap snap to nearest slot natively → onTabPress(index) bubbles
 *    up here and we forward it to react-navigation
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassTabBar } from 'autexa-liquid-glass';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
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
  const { width: SCREEN_W } = useWindowDimensions();

  const slotW = (SCREEN_W - BAR_HORIZONTAL_MARGIN * 2) / TAB_DEFINITIONS.length;

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

      <AutexaLiquidGlassTabBar
        tabCount={TAB_DEFINITIONS.length}
        activeIndex={safeIndex}
        bottomInset={insets.bottom}
        onTabPress={navigateToTab}
        style={styles.bar}
      >
        {/* Icons + labels rendered on top of the native droplet. We lay them
            out in absolute slots so the native droplet (underneath) lines
            up tab-for-tab regardless of locale or font width. */}
        {TAB_DEFINITIONS.map((tab, i) => {
          const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
          const focused = state.index === routeIndex;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: state.routes[routeIndex]?.key ?? tab.routeName,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              haptic('select');
              navigation.navigate(tab.routeName as never);
            }
          };

          return (
            <View
              key={tab.routeName}
              pointerEvents="box-none"
              style={[
                styles.slot,
                {
                  left: i * slotW,
                  width: slotW,
                },
              ]}
            >
              {tab.isKassa ? (
                <Pressable
                  style={styles.item}
                  onPress={() => {
                    haptic('impact');
                    navigation.navigate(tab.routeName as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Создать чек"
                >
                  <KassaGlassDome focused={focused} />
                </Pressable>
              ) : (
                <TabItem focused={focused} label={tab.label} icon={tab.icon} onPress={onPress} />
              )}
            </View>
          );
        })}
      </AutexaLiquidGlassTabBar>
    </View>
  );
}

interface TabItemProps {
  focused: boolean;
  label: string;
  icon: (typeof TAB_DEFINITIONS)[number]['icon'];
  onPress: () => void;
}

function TabItem({ focused, label, icon, onPress }: TabItemProps) {
  // Subtle scale on focus — the droplet underneath does the heavy lifting,
  // so the icon itself just nudges to confirm.
  const scale = useSharedValue(focused ? 1.06 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const tint = focused ? colors.primary[700] : colors.gray[500];

  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
    >
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
    </Pressable>
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
  bar: {
    height: BAR_HEIGHT,
    marginHorizontal: BAR_HORIZONTAL_MARGIN,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 0.66,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: colors.primary[800],
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  slot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    flex: 1,
    alignSelf: 'stretch',
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
