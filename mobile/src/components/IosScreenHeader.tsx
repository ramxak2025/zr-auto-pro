import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle, StyleProp, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';

/**
 * IosScreenHeader — shared top-bar treatment for every screen.
 *
 * Despite the file name, this header is platform-adaptive:
 *   • iOS — Settings / Mail-style header: 17pt semibold, transparent
 *     background, no divider by default. Title can be centered with
 *     `centerTitle`.
 *   • Android — Material 3 Top App Bar (small variant): always shows
 *     the hairline divider for surface separation, opaque white surface
 *     so the bar reads as a defined region per M3 spec.
 *
 * Layout:
 *   [optional leading icon button]   Title       [optional trailing slot]
 *                                    Subtitle
 *
 * Sizing aligns with iOS Settings / Mail patterns:
 *   • title 17pt semibold, letter-spacing -0.4 (San Francisco rule for
 *     headline-grade text)
 *   • subtitle 12pt regular, gray-500
 *   • back targets are 44pt on iOS and 48dp on Android
 *   • respects useSafeAreaInsets().top — the header always sits below the
 *     Dynamic Island / notch
 *
 * The header DOES NOT push the screen content down with padding — caller
 * decides how to space the rest of the screen below.
 */
export interface IosScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Tap handler for an automatic, platform-sized back button (chevron.left). */
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
  bg,
  centerTitle = false,
  style,
}: IosScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const palette = useColors();
  const isAndroid = Platform.OS === 'android';
  const effectiveShowDivider = isAndroid ? true : showDivider;
  const effectiveCenterTitle = isAndroid ? false : centerTitle;

  const leadingNode =
    leading != null ? (
      leading
    ) : onBack ? (
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={[styles.iconBtn, isAndroid && styles.androidIconBtn, { backgroundColor: palette.bg.muted }]}
        accessibilityRole="button"
        accessibilityLabel="Назад"
      >
        <Ionicons name="chevron-back" size={20} color={palette.text.primary} />
      </Pressable>
    ) : null;

  // Only centered titles need a balancing slot. Ordinary section titles start
  // at the content edge when there is no back action.
  const balance = effectiveCenterTitle && (leadingNode != null || trailing != null);
  const emptySlot = balance ? <View style={styles.iconBtnPlaceholder} /> : null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: bg ?? 'transparent',
          paddingTop: insets.top + spacing[2],
          borderBottomWidth: effectiveShowDivider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: effectiveShowDivider ? palette.border.subtle : 'transparent',
        },
        style,
      ]}
    >
      <View style={[styles.row, effectiveCenterTitle && styles.rowCenter]}>
        <View style={styles.primary}>
          {(leadingNode != null || balance) && <View style={styles.side}>{leadingNode ?? emptySlot}</View>}
          <View style={[styles.center, effectiveCenterTitle && styles.centerCentered]}>
            <Text
              variant="bodyEmph"
              accessibilityRole="header"
              numberOfLines={2}
              style={[styles.title, isAndroid && styles.androidTitle, { color: palette.text.primary }]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" numberOfLines={1} style={[styles.subtitle, { color: palette.text.secondary }]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {(trailing != null || balance) && <View style={[styles.side, styles.trailing]}>{trailing ?? emptySlot}</View>}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: spacing[1],
    minHeight: Platform.OS === 'android' ? 48 : 44,
  },
  // Keep navigation and its title together; move a wide action group before
  // it can reduce the identity to a few letters on a narrow screen.
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexBasis: '70%',
    minWidth: '70%',
    flexGrow: 1,
    flexShrink: 1,
  },
  side: { flexShrink: 0, justifyContent: 'center' },
  trailing: { marginLeft: 'auto', maxWidth: '100%' },
  rowCenter: {
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing[2],
  },
  centerCentered: {
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  androidTitle: { fontSize: 16, lineHeight: 22 },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidIconBtn: { width: 48, height: 48, borderRadius: 24 },
  iconBtnPlaceholder: {
    width: 44,
    height: 44,
  },
});
