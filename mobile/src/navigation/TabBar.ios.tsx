/**
 * TabBar — iOS variant. Floating Liquid Glass pill with sliding capsule.
 *
 *  • UIVisualEffectView via the autexa-liquid-glass native module
 *    (UIBlurEffect.systemMaterial — more saturated than ultraThin so the
 *    glass surface reads as glass even over a flat-coloured screen)
 *  • Animated capsule indicator slides between tabs on selection — gives
 *    the "liquid blob" feel users expect from iOS 26 native bars
 *  • Centre Касса button: 46pt circular GlassDome
 *  • Haptic feedback, safe-area bottom padding
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassView } from 'autexa-liquid-glass';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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
const BAR_INNER_PADDING = 4;
const CAPSULE_WIDTH_RATIO = 0.78; // capsule slightly narrower than the slot

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W } = useWindowDimensions();

  // Each tab slot's width (the bar uses paddingHorizontal: BAR_INNER_PADDING)
  const slotW = (SCREEN_W - BAR_HORIZONTAL_MARGIN * 2 - BAR_INNER_PADDING * 2) / TAB_DEFINITIONS.length;
  const capsuleW = slotW * CAPSULE_WIDTH_RATIO;
  const capsuleOffset = (slotW - capsuleW) / 2;

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeIndex = focusedIndex < 0 ? 0 : focusedIndex;

  // Animated X position of the capsule indicator. Spring-driven for the
  // liquid feel — it "slides" between tabs. Suppressed when the centre
  // Касса tab is the focused one (its KassaGlassDome is the indicator).
  const capsuleX = useSharedValue(BAR_INNER_PADDING + safeIndex * slotW + capsuleOffset);
  const capsuleVisible = useSharedValue(TAB_DEFINITIONS[safeIndex]?.isKassa ? 0 : 1);

  React.useEffect(() => {
    capsuleX.value = withSpring(BAR_INNER_PADDING + safeIndex * slotW + capsuleOffset, {
      damping: 18,
      stiffness: 220,
      mass: 0.9,
    });
    capsuleVisible.value = withTiming(TAB_DEFINITIONS[safeIndex]?.isKassa ? 0 : 1, { duration: 160 });
  }, [safeIndex, slotW, capsuleOffset, capsuleX, capsuleVisible]);

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: capsuleX.value }],
    opacity: capsuleVisible.value,
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 10) + FLOAT_LIFT }]}
    >
      <View style={styles.outerGlow} pointerEvents="none" />

      <View style={styles.bar}>
        {/* Native iOS material — systemMaterial is heavier than ultraThin
            so the bar reads as a clear "glass" surface over any background. */}
        <AutexaLiquidGlassView variant="material" intensity={1} topRim={false} style={StyleSheet.absoluteFill} />

        {/* Animated capsule that slides between active tabs */}
        <Animated.View pointerEvents="none" style={[styles.capsule, { width: capsuleW, left: 0 }, capsuleStyle]}>
          <LinearGradient
            colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.55)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Subtle top-down highlight gradient over everything */}
        <LinearGradient
          colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.30)']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.rimTop} pointerEvents="none" />
        <View style={styles.innerRing} pointerEvents="none" />

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
              <TabItem key={tab.routeName} focused={focused} label={tab.label} icon={tab.icon} onPress={onPress} />
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
  capsule: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  rimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  // Pronounced inset ring — sells the "convex glass" feel.
  innerRing: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
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
