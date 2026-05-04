/**
 * TabBar — iOS variant. Premium Liquid Glass.
 *
 *  • Floating pill (14pt insets, 30pt corner radius)
 *  • BlurView (systemUltraThinMaterialLight) for max-glass on iOS 17+
 *  • Inner gradient highlight (rim light) on top edge
 *  • Outer soft shadow tinted toward primary[700]
 *  • Inner subtle stroke at the active item to give a Liquid Glass "depth" feel
 *  • Spring scale on the focused icon, smooth color transition
 *  • Haptic feedback (select / impact for Касса)
 *  • Safe-area bottom padding for home-indicator devices
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { Icon } from '../platform/Icon';
import { SPRING_TIGHT, TIMING_FAST } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS } from './TabBarShared';

const BAR_HEIGHT = 60;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      {/* External soft glow under the bar */}
      <View style={styles.outerGlow} pointerEvents="none" />

      <View style={styles.bar}>
        {/* Liquid Glass blur layer */}
        <BlurView
          tint="systemUltraThinMaterialLight"
          intensity={92}
          style={StyleSheet.absoluteFill}
        />

        {/* Subtle vertical gradient overlay for depth */}
        <LinearGradient
          colors={[
            'rgba(255,255,255,0.55)',
            'rgba(255,255,255,0.18)',
            'rgba(255,255,255,0.32)',
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Top rim light (1px hairline) */}
        <View style={styles.rimLight} pointerEvents="none" />
        {/* Bottom rim — slightly darker to add definition */}
        <View style={styles.rimBottom} pointerEvents="none" />

        <View style={styles.row}>
          {TAB_DEFINITIONS.map((tab) => {
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

            if (tab.isKassa) {
              return (
                <Pressable
                  key={tab.routeName}
                  style={styles.item}
                  onPress={() => {
                    haptic('impact');
                    navigation.navigate(tab.routeName as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Касса"
                >
                  <KassaButton />
                </Pressable>
              );
            }

            return (
              <TabItem
                key={tab.routeName}
                focused={focused}
                label={tab.label}
                icon={tab.icon}
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
  label: string;
  icon: (typeof TAB_DEFINITIONS)[number]['icon'];
  onPress: () => void;
}

function TabItem({ focused, label, icon, onPress }: TabItemProps) {
  const scale = useSharedValue(focused ? 1.08 : 1);
  const dotOpacity = useSharedValue(focused ? 1 : 0);

  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, SPRING_TIGHT);
    dotOpacity.value = withTiming(focused ? 1 : 0, TIMING_FAST);
  }, [focused, scale, dotOpacity]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  const tint = focused ? colors.primary[600] : colors.gray[500];

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
            marginTop: 2,
            color: tint,
            fontWeight: focused ? '600' : '500',
            fontSize: 10.5,
          }}
        >
          {label}
        </Text>
      )}
      {/* Active indicator dot under the label */}
      <Animated.View style={[styles.activeDot, dotStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  outerGlow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 4,
    height: BAR_HEIGHT + 4,
    borderRadius: 32,
    backgroundColor: colors.primary[700],
    opacity: 0.06,
    transform: [{ scale: 1.02 }],
  },
  bar: {
    height: BAR_HEIGHT,
    marginHorizontal: 14,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.7)',
    // iOS shadow — premium soft glow
    shadowColor: colors.primary[700],
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  rimLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  rimBottom: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  row: {
    flex: 1,
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
  activeDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary[600],
  },
});
