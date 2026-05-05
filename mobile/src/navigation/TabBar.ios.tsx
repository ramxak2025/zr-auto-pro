/**
 * TabBar — iOS variant. Floating Liquid Glass pill.
 *
 *  • UIVisualEffectView (via expo-blur) for native iOS material — no fake CSS blur
 *  • systemUltraThinMaterialLight tint — closest match to system iOS bar
 *  • Outer soft glow tinted to brand
 *  • Top hairline rim for "highlight" depth, bottom hairline for shadow line
 *  • Active vs inactive: tint colour + label weight only — NO indicator dot,
 *    NO underline, NO Android-style pill
 *  • Centre Касса button: compact 48pt circular GlassDome — gradient tint
 *    with translucent overlay, looks premium without dominating the bar
 *  • Haptic feedback (select for tabs, impact for Касса)
 *  • Safe-area bottom padding for home-indicator devices
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassView } from 'autexa-liquid-glass';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
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
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { TAB_DEFINITIONS } from './TabBarShared';

const BAR_HEIGHT = 58;
const KASSA_SIZE = 46;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
    >
      {/* External soft glow under the bar */}
      <View style={styles.outerGlow} pointerEvents="none" />

      <View style={styles.bar}>
        {/* TRUE native iOS material — UIVisualEffectView with UIBlurEffect.systemThinMaterial.
            Forward-compat: upgrades to UIGlassEffect at runtime on iOS 26+. */}
        <AutexaLiquidGlassView
          variant="thinMaterial"
          intensity={1}
          topRim={false /* we render our own rim above the gradient */}
          style={StyleSheet.absoluteFill}
        />
        {/* Subtle vertical gradient overlay — gives "glass dome" feel */}
        <LinearGradient
          colors={[
            'rgba(255,255,255,0.45)',
            'rgba(255,255,255,0.12)',
            'rgba(255,255,255,0.22)',
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Top rim hairline */}
        <View style={styles.rimTop} pointerEvents="none" />

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
                  accessibilityLabel="Создать чек"
                >
                  <KassaGlassDome focused={focused} />
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
  // Subtle scale on focus — no dot, no pill, just the colour and weight change.
  const scale = useSharedValue(focused ? 1.06 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

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
 *
 *  • 46pt circle, sits flush with the bar (no big -28 jump-out)
 *  • LinearGradient + thin glass-style overlay imitates a translucent dome
 *  • Slight scale spring on focus
 *  • Designed to sit IN the bar, not ON TOP of it — matches iOS Mail compose
 *    or Wallet add buttons in spirit.
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
      {/* Top glass highlight */}
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
    marginHorizontal: 14,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  rimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.78)',
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
