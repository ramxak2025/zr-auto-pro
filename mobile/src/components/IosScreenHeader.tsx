import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle, StyleProp, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import ScreenSectionHeader, {
  type ScreenHeaderComposition,
  type ScreenSectionScrollController,
} from './ScreenSectionHeader';
import { HeaderAction, HeaderIsland } from './ScreenHeaderControls';

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
 *   • leading/trailing slots are 36pt squircles
 *   • respects useSafeAreaInsets().top — the header always sits below the
 *     Dynamic Island / notch
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
  /** Explicit opt-in: attach this controller to the main vertical scroller. */
  scroll?: ScreenSectionScrollController;
  /** Only for synchronized canvases with no single main vertical scroller. */
  sectionVariant?: 'static';
  /** Static composition only; a scrolling header inherits it from its controller. */
  composition?: ScreenHeaderComposition;
  context?: React.ReactNode;
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
  scroll,
  sectionVariant,
  composition = 'section',
  context,
}: IosScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const palette = useColors();
  const isAndroid = Platform.OS === 'android';
  const effectiveShowDivider = isAndroid ? true : showDivider;
  const effectiveCenterTitle = isAndroid ? false : centerTitle;

  if (scroll || sectionVariant === 'static') {
    const resolvedComposition = sectionVariant === 'static' ? composition : (scroll?.composition ?? 'section');
    const back = leading ?? (onBack ? <HeaderAction label="Назад" icon="chevron-back" onPress={onBack} /> : null);
    if (resolvedComposition === 'navigation') {
      const identityProps = { title, subtitle, context, leading: back, actions: trailing };
      return sectionVariant === 'static' ? (
        <ScreenSectionHeader {...identityProps} variant="static" composition="navigation" />
      ) : (
        <ScreenSectionHeader {...identityProps} scroll={scroll!} />
      );
    }
    const controls =
      leading || onBack || trailing ? (
        <HeaderIsland
          style={
            scroll && sectionVariant !== 'static' && onBack && !leading && !trailing ? styles.backOnlyIsland : undefined
          }
        >
          {back}
          {trailing ? <View style={styles.sectionTrailing}>{trailing}</View> : null}
        </HeaderIsland>
      ) : null;
    return sectionVariant === 'static' ? (
      <ScreenSectionHeader
        variant="static"
        composition={composition}
        title={title}
        subtitle={subtitle}
        context={context}
      >
        {controls}
      </ScreenSectionHeader>
    ) : (
      <ScreenSectionHeader scroll={scroll!} title={title} subtitle={subtitle} context={context}>
        {controls}
      </ScreenSectionHeader>
    );
  }

  const leadingNode = leading ? (
    leading
  ) : onBack ? (
    <Pressable
      onPress={onBack}
      hitSlop={10}
      style={[styles.iconBtn, { backgroundColor: palette.bg.muted }]}
      accessibilityRole="button"
      accessibilityLabel="Назад"
    >
      <Ionicons name="chevron-back" size={20} color={palette.text.primary} />
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
          backgroundColor: bg ?? 'transparent',
          paddingTop: insets.top + spacing[2],
          borderBottomWidth: effectiveShowDivider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: effectiveShowDivider ? palette.border.subtle : 'transparent',
        },
        style,
      ]}
    >
      <View style={[styles.row, effectiveCenterTitle && styles.rowCenter]}>
        {leadingNode}
        <View style={[styles.center, effectiveCenterTitle && styles.centerCentered]}>
          <Text variant="bodyEmph" numberOfLines={1} style={[styles.title, { color: palette.text.primary }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" numberOfLines={1} style={[styles.subtitle, { color: palette.text.secondary }]}>
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
  backOnlyIsland: { alignSelf: 'flex-start' },
  sectionTrailing: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
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
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPlaceholder: {
    width: 36,
    height: 36,
  },
});
