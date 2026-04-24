/**
 * TabBar — Android variant.
 *
 *  • Material 3 navigation bar vibe: solid surface, tonal elevation,
 *    tinted pill under active icon
 *  • Ripple on press (via android_ripple)
 *  • Animated indicator pill slides between tabs using Reanimated timing
 *  • Safe-area bottom padding for gesture-nav devices
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { Icon } from '../platform/Icon';
import { TIMING_FAST } from '../platform/motion';
import { shadow } from '../platform/shadow';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { KassaButton } from './KassaButton';
import { TAB_DEFINITIONS } from './TabBarShared';

const BAR_HEIGHT = 68;

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
      <View style={[styles.bar, shadow('md')]}>
        <View style={styles.row}>
          {TAB_DEFINITIONS.map((tab) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;

            if (tab.isKassa) {
              return (
                <Pressable
                  key={tab.routeName}
                  style={styles.item}
                  android_ripple={{ color: 'transparent', borderless: true }}
                  onPress={() => {
                    haptic('impact');
                    navigation.navigate(tab.routeName as never);
                  }}
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
                navigation.navigate(tab.routeName as never);
              }
            };

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

function TabItem({
  focused,
  label,
  icon,
  onPress,
}: {
  focused: boolean;
  label: string;
  icon: (typeof TAB_DEFINITIONS)[number]['icon'];
  onPress: () => void;
}) {
  // M3 navigation-bar active-indicator pill — fades in/out on focus change
  const alpha = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    alpha.value = withTiming(focused ? 1 : 0, TIMING_FAST);
  }, [focused, alpha]);
  const pillStyle = useAnimatedStyle(() => ({ opacity: alpha.value }));

  const tint = focused ? colors.primary[600] : colors.gray[500];

  return (
    <View style={styles.itemWrap}>
      <Pressable
        style={styles.item}
        android_ripple={{ color: 'rgba(0,0,0,0.05)', foreground: true, borderless: false }}
        onPress={onPress}
      >
        {/* Active pill */}
        <Animated.View style={[styles.pill, pillStyle]} />
        <Icon name={icon} size={22} color={tint} />
        <Text
          variant="caption"
          style={{
            marginTop: 2,
            color: tint,
            fontWeight: focused ? '600' : '500',
          }}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  bar: {
    height: BAR_HEIGHT,
    backgroundColor: '#FFFFFF',
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
  },
  pill: {
    position: 'absolute',
    top: 8,
    width: 56,
    height: 30,
    borderRadius: 16,
    backgroundColor: colors.primary[50],
  },
});
