/**
 * FilterChips — a horizontal, single-select chip strip with an «Все» reset.
 *
 * Used by the troubleshooting search to filter by system / car-make / tag.
 * `value === null` means «Все» (no filter). Selecting the active chip again
 * clears it.
 */
import React from 'react';
import { ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';

interface FilterChipsProps {
  options: string[];
  value: string | null;
  onChange: (next: string | null) => void;
  /** Label for the «all»/reset chip. */
  allLabel?: string;
}

export default function FilterChips({ options, value, onChange, allLabel = 'Все' }: FilterChipsProps) {
  const palette = useColors();

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={() => {
        haptic('select');
        onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? palette.accent.primary : palette.bg.card,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Text variant="footnote" style={{ color: active ? colors.white : palette.text.secondary, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {chip(allLabel, value === null, () => onChange(null), '__all__')}
      {options.map((opt) =>
        chip(opt, value === opt, () => onChange(value === opt ? null : opt), opt),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing[2], paddingVertical: 2, paddingRight: spacing[4] },
  chip: {
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
});
