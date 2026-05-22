/**
 * Card — single source of truth for "white surface with shadow + radius".
 *
 *  • Apply `shadow('sm' | 'md' | 'lg')` so iOS/Android render correctly.
 *  • If `onPress` is provided, the card becomes a PressableScale (iOS scale
 *    + haptic, Android ripple). Use it for tappable rows / metric tiles /
 *    list items.
 *  • Padding default 16 — override via `padding` prop or pass full
 *    custom `style`.
 *
 * Migrating: replacing a hand-rolled `<View style={card}>` with
 * `<Card>` typically saves 10-15 lines per call site and gives free
 * platform-correct shadow + tap feedback.
 */
import React from 'react';
import { StyleProp, View, ViewStyle, StyleSheet } from 'react-native';
import { haptic, HapticIntent } from '../platform/haptics';
import { PressableScale } from '../platform/PressableScale';
import { shadow, ShadowLevel } from '../platform/shadow';
import { colors } from '../theme';

export interface CardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Default 16. Pass 0 if the child renders its own padding. */
  padding?: number;
  /** Default 18. */
  radius?: number;
  /** Default 'sm'. */
  shadowLevel?: ShadowLevel;
  /** Tinted background. Default white. */
  background?: string;
  /** If set, card becomes pressable (PressableScale). */
  onPress?: () => void;
  /** Haptic on press. Default 'tap' (iOS); set to null to disable. */
  hapticIntent?: HapticIntent | null;
  /** Disable press feedback while still rendering pressable. */
  disabled?: boolean;
  testID?: string;
}

export function Card({
  children,
  style,
  padding = 16,
  radius = 18,
  shadowLevel = 'sm',
  background = colors.white,
  onPress,
  hapticIntent,
  disabled,
  testID,
}: CardProps) {
  const composed: StyleProp<ViewStyle> = [
    {
      backgroundColor: background,
      borderRadius: radius,
      padding,
    },
    shadow(shadowLevel),
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        onPress={() => {
          if (hapticIntent !== null) haptic(hapticIntent ?? 'tap');
          onPress();
        }}
        disabled={disabled}
        style={composed}
        testID={testID}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View style={composed} testID={testID}>
      {children}
    </View>
  );
}

/** Visual divider used inside cards for separated rows. */
export function CardDivider({ insetLeft = 0 }: { insetLeft?: number }) {
  return <View style={[cardStyles.divider, insetLeft ? { marginLeft: insetLeft } : null]} />;
}

const cardStyles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[200],
  },
});
