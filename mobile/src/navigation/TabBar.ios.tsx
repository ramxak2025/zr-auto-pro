/**
 * TabBar — iOS variant.
 *
 *  • Floating pill (14pt insets from screen edges, 30pt corner radius)
 *  • BlurView (systemMaterial) so the tab bar feels native on iOS 16+
 *  • Haptic tap on selection
 *  • Icon scale spring on focus change
 *  • Safe-area bottom padding for devices with home indicator
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { Icon } from '../platform/Icon';
import { SPRING_TIGHT } from '../platform/motion';
import { shadow } from '../platform/shadow';
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
      <View style={[styles.bar, shadow('lg', colors.primary[700])]}>
        <BlurView
          tint="systemThinMaterialLight"
          intensity={85}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.rimLight} />

        <View style={styles.row}>
          {TAB_DEFINITIONS.map((tab, index) => {
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
  const scale = useSharedValue(focused ? 1.08 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const tint = focused ? colors.primary[600] : colors.gray[500];

  return (
    <Pressable onPress={onPress} style={styles.item}>
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={24} color={tint} weight={focused ? 'semibold' : 'regular'} />
      </Animated.View>
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
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: 8,
    // transparent — gives the pill room to float over app content
    backgroundColor: 'transparent',
  },
  bar: {
    height: BAR_HEIGHT,
    marginHorizontal: 14,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  rimLight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.75)',
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
  },
});
