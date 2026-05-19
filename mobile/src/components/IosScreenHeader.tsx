import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { colors, spacing } from '../theme';

/**
 * IosScreenHeader — shared top-bar treatment for every screen.
 *
 * Goal: make the app feel like one cohesive iOS product instead of a
 * collection of bespoke screen tops. Applies the same vertical rhythm,
 * typography, and safe-area handling everywhere.
 *
 * Layout:
 *   [optional leading icon button]   Title       [optional trailing slot]
 *                                    Subtitle
 *
 * Sizing aligns with iOS Settings / Mail patterns:
 *   • title 17pt semibold, letter-spacing -0.4 (San Francisco rule for
 *     headline-grade text)
 *   • subtitle 12pt regular, gray-500
 *   • leading/trailing slots are 36pt squircles
 *   • respects useSafeAreaInsets().top — the header always sits below the
 *     Dynamic Island / notch
 *   • a hairline bottom-border by default; opt out with `noDivider`
 *
 * The header DOES NOT push the screen content down with padding — caller
 * decides how to space the rest of the screen below.
 */
export interface IosScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Tap handler for an automatic back button (chevron.left).
   *  When provided, a leading 36pt squircle button is rendered. */
  onBack?: () => void;
  /** Custom leading slot. Overrides the built-in back button. */
  leading?: React.ReactNode;
  /** Custom trailing slot — typically an action button (search, filter, …). */
  trailing?: React.ReactNode;
  /** Show a hairline bottom divider. Default false — modern iOS pattern
   *  is a borderless header that visually merges with the screen bg. */
  showDivider?: boolean;
  /** Background colour. Default — transparent so the screen bg flows
   *  continuously through the header zone (no "boxed" appearance). */
  bg?: string;
  /** When true the title is centred (iOS Mail-style). Otherwise left-aligned (Settings-style). */
  centerTitle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function IosScreenHeader({
  title,
  subtitle,
  onBack,
  leading,
  trailing,
  showDivider = false,
  bg = 'transparent',
  centerTitle = false,
  style,
}: IosScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  const leadingNode = leading ? (
    leading
  ) : onBack ? (
    <Pressable
      onPress={onBack}
      hitSlop={10}
      style={styles.iconBtn}
      accessibilityRole="button"
      accessibilityLabel="Назад"
    >
      <Ionicons name="chevron-back" size={20} color={colors.gray[800]} />
    </Pressable>
  ) : (
    <View style={styles.iconBtnPlaceholder} />
  );

  const trailingNode = trailing ?? <View style={styles.iconBtnPlaceholder} />;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: bg,
          paddingTop: insets.top + spacing[2],
          borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: showDivider ? colors.gray[100] : 'transparent',
        },
        style,
      ]}
    >
      <View style={[styles.row, centerTitle && styles.rowCenter]}>
        {leadingNode}
        <View style={[styles.center, centerTitle && styles.centerCentered]}>
          <Text variant="bodyEmph" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailingNode}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: spacing[2.5],
    paddingHorizontal: spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowCenter: {
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    paddingHorizontal: spacing[2],
  },
  centerCentered: {
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.gray[900],
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    color: colors.gray[500],
    marginTop: 1,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPlaceholder: {
    width: 36,
    height: 36,
  },
});
