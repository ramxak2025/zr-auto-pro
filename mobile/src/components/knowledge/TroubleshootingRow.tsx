/**
 * TroubleshootingRow — a search-result row in the «Справочник неисправностей».
 *
 * Shows: a severity-tinted glyph tile, the symptom headline, the system +
 * car-make meta line and the severity chip. Tap → detail.
 *
 * Memoised — these render in a debounced search list.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import { severityStyle } from './severity';
import type { Troubleshooting } from '../../../../shared/types';

interface TroubleshootingRowProps {
  entry: Troubleshooting;
  onPress: (entry: Troubleshooting) => void;
}

function TroubleshootingRowInner({ entry, onPress }: TroubleshootingRowProps) {
  const palette = useColors();
  const sev = severityStyle(entry.severity);
  const tileColor = sev?.color ?? palette.accent.primary;
  const tileBg = sev?.bg ?? palette.accent.primarySoft;

  const metaParts = [entry.system, entry.carMake].filter(Boolean) as string[];

  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress(entry);
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: tileBg }]}>
        <Ionicons name="construct-outline" size={19} color={tileColor} />
      </View>

      <View style={styles.body}>
        <Text variant="bodyEmph" numberOfLines={2} style={{ color: palette.text.primary }}>
          {entry.title}
        </Text>
        <View style={styles.metaRow}>
          {sev ? (
            <View style={[styles.sevChip, { backgroundColor: sev.bg }]}>
              <Text variant="caption" style={{ color: sev.color, fontWeight: '700' }}>
                {sev.label}
              </Text>
            </View>
          ) : null}
          {metaParts.length > 0 ? (
            <Text variant="footnote" numberOfLines={1} style={{ flex: 1, color: palette.text.secondary }}>
              {metaParts.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    minHeight: 64,
  },
  tile: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], minWidth: 0 },
  sevChip: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
});

export const TroubleshootingRow = React.memo(TroubleshootingRowInner);
export default TroubleshootingRow;
