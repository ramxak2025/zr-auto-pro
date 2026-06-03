/**
 * SectionHeader — the calm, uppercase group label used to separate
 * logical blocks on a detail screen (per the Autexa visual system).
 *
 * Layout:
 *   ЛЕЙБЛ СЕКЦИИ (count)              [optional trailing slot]
 *
 * The label uses the `label` typography variant (11pt semibold, tracked,
 * uppercase) tinted with the tertiary text colour, so every section on
 * every screen reads with the same quiet rhythm. An optional `count`
 * renders as a softer suffix, and a `trailing` slot hosts a single
 * affordance (e.g. «+ Добавить») aligned to the right edge.
 *
 * Pure presentational — no data, no side effects. Safe on iOS + Android.
 */
import React from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { Text } from '../platform/Typography';
import { spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';

export interface SectionHeaderProps {
  title: string;
  /** Optional count rendered as a quiet suffix: «Автомобили · 3». */
  count?: number | null;
  /** Optional right-aligned affordance (button, spinner, …). */
  trailing?: React.ReactNode;
  /** Extra top margin override (defaults to a single rhythm step). */
  style?: StyleProp<ViewStyle>;
}

export default function SectionHeader({ title, count, trailing, style }: SectionHeaderProps) {
  const palette = useColors();
  return (
    <View style={[styles.row, style]}>
      <View style={styles.labelWrap}>
        <Text variant="label" color={palette.text.tertiary}>
          {title}
        </Text>
        {count != null ? (
          <Text variant="label" color={palette.text.tertiary} style={styles.count}>
            {`· ${count}`}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    // Sits inside a gap-spaced scroll container — this top margin STACKS
    // with the container gap to give a section a calmer lead-in than the
    // rhythm between sibling cards, without a runaway dead gap.
    marginTop: spacing[2],
    marginBottom: 0,
    paddingHorizontal: spacing[1],
  },
  labelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flexShrink: 1 },
  count: { opacity: 0.8 },
  trailing: { marginLeft: spacing[2] },
});
