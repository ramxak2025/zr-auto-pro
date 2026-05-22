/**
 * Button — one button to replace per-screen ad-hoc TouchableOpacity buttons.
 *
 *  Variants:
 *    primary  — solid brand-blue, white text, brand shadow
 *    secondary — light blue tint, brand text
 *    ghost    — transparent with bordered outline
 *    danger   — solid red
 *
 *  Sizes: sm (40h) / md (48h, default) / lg (56h)
 *
 *  Built-in: loading state, leading icon, haptic on press, scale-press on iOS,
 *  ripple on Android, disabled style, full-width by default.
 */
import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { haptic, HapticIntent } from '../platform/haptics';
import { Icon, IconName } from '../platform/Icon';
import { PressableScale } from '../platform/PressableScale';
import { shadow } from '../platform/shadow';
import { Text } from '../platform/Typography';
import { colors } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, drawn on the left of the title. */
  icon?: IconName;
  /** Disabled — visually grayed and unresponsive. */
  disabled?: boolean;
  /** Spinner instead of title; tap is blocked. */
  loading?: boolean;
  /** Full-width by default; pass false to shrink-wrap. */
  fullWidth?: boolean;
  hapticIntent?: HapticIntent | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56 };
const SIZE_RADIUS: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16 };
const SIZE_PADX: Record<ButtonSize, number> = { sm: 14, md: 18, lg: 22 };
const SIZE_TEXT: Record<ButtonSize, 'callout' | 'body' | 'title3'> = {
  sm: 'body',
  md: 'callout',
  lg: 'title3',
};
const SIZE_ICON: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  fullWidth = true,
  hapticIntent,
  style,
  testID,
}: ButtonProps) {
  const palette = getPalette(variant, disabled);
  const isInteractive = !disabled && !loading;

  const handlePress = () => {
    if (!isInteractive) return;
    if (hapticIntent !== null) {
      haptic(hapticIntent ?? (variant === 'danger' ? 'warning' : 'tap'));
    }
    onPress();
  };

  return (
    <PressableScale
      onPress={handlePress}
      disabled={!isInteractive}
      hapticIntent={null /* we handle haptics ourselves above */}
      style={[
        styles.base,
        {
          height: SIZE_HEIGHT[size],
          borderRadius: SIZE_RADIUS[size],
          paddingHorizontal: SIZE_PADX[size],
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth * 2 : 0,
          width: fullWidth ? '100%' : undefined,
          opacity: disabled ? 0.5 : 1,
        },
        variant === 'primary' || variant === 'danger'
          ? shadow('sm', variant === 'danger' ? colors.red[600] : colors.primary[700])
          : null,
        style,
      ]}
      testID={testID}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={palette.fg} size="small" />
        ) : (
          <>
            {icon ? <Icon name={icon} size={SIZE_ICON[size]} color={palette.fg} /> : null}
            <Text variant={SIZE_TEXT[size]} color={palette.fg} style={styles.label}>
              {title}
            </Text>
          </>
        )}
      </View>
    </PressableScale>
  );
}

function getPalette(variant: ButtonVariant, disabled: boolean | undefined) {
  switch (variant) {
    case 'primary':
      return { bg: colors.primary[600], fg: colors.white, border: 'transparent' };
    case 'secondary':
      return { bg: colors.primary[50], fg: colors.primary[700], border: 'transparent' };
    case 'ghost':
      return { bg: 'transparent', fg: colors.gray[700], border: colors.gray[200] };
    case 'danger':
      return { bg: colors.red[600], fg: colors.white, border: 'transparent' };
    default:
      return { bg: colors.primary[600], fg: colors.white, border: 'transparent' };
  }
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontWeight: '600',
  },
});
