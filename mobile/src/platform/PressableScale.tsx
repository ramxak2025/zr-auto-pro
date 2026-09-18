/**
 * PressableScale — press feedback that feels native on each platform.
 *
 *  iOS:  small scale-down on press-in (spring), haptic tap on release.
 *        Scale is the iOS signature — Apple avoids ripples.
 *  Android: native ripple (android_ripple), no scale. Haptic only when
 *           `hapticIntent` is explicitly set (Android users don't expect
 *           vibration on every tap).
 *
 * The component is a drop-in replacement for <Pressable /> — same props,
 * plus `hapticIntent` and `scaleTo`.
 */
import React from 'react';
import { GestureResponderEvent, Platform, Pressable, PressableProps, StyleProp, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptic, HapticIntent } from './haptics';
import { SPRING_PRESS } from './motion';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Target scale on press-in. iOS default 0.96. Android ignores. */
  scaleTo?: number;
  /**
   * Haptic fired on tap release (both platforms). Null disables.
   * Default: iOS 'tap', Android null (ripple is enough feedback).
   */
  hapticIntent?: HapticIntent | null;
  /** Android ripple color (transparent-overlay). */
  rippleColor?: string;
  /** Borderless ripple — for icon buttons without a visible background. */
  rippleBorderless?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  hapticIntent,
  rippleColor = 'rgba(0,0,0,0.08)',
  rippleBorderless = false,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const resolvedHaptic: HapticIntent | null =
    hapticIntent !== undefined ? hapticIntent : Platform.OS === 'ios' ? 'tap' : null;

  // iOS — scale spring
  if (Platform.OS === 'ios') {
    return (
      <AnimatedPressable
        {...rest}
        onPressIn={(e: GestureResponderEvent) => {
          scale.value = withSpring(scaleTo, SPRING_PRESS);
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          scale.value = withSpring(1, SPRING_PRESS);
          onPressOut?.(e);
        }}
        onPress={(e: GestureResponderEvent) => {
          if (resolvedHaptic) haptic(resolvedHaptic);
          onPress?.(e);
        }}
        style={[style, animatedStyle]}
      >
        {/* Callable children (`{({pressed}) => …}`) в Animated.Pressable не
            поддержаны типами, и раньше эта ветка рисовала ПУСТОЙ <View> —
            то есть содержимое кнопки молча исчезало. Теперь такой случай
            громко сообщает о себе в разработке, а в проде рендерится как есть:
            потерять контент хуже, чем не анимировать нажатие. */}
        {typeof children === 'function'
          ? (() => {
              if (__DEV__) {
                console.warn(
                  'PressableScale: функция вместо детей не поддерживается — передайте элементы. ' +
                    'Для реакции на нажатие используйте роль/стиль компонента.',
                );
              }
              return (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false });
            })()
          : (children as React.ReactNode)}
      </AnimatedPressable>
    );
  }

  // Android — native ripple, no scale
  return (
    <Pressable
      {...rest}
      android_ripple={{ color: rippleColor, borderless: rippleBorderless }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={(e: GestureResponderEvent) => {
        if (resolvedHaptic) haptic(resolvedHaptic);
        onPress?.(e);
      }}
      style={style}
    >
      {children as React.ReactNode}
    </Pressable>
  );
}
