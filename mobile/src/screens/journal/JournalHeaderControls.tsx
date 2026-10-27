import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SemanticPalette } from '../../theme/palette';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../../theme';
import { buildShadow } from '../../platform/iosSurface';

type JournalScope = 'checks' | 'warehouse';

/** Local journal controls keep the incumbent light tints; dark uses the semantic readable accent. */
export function JournalHeaderActions({
  palette,
  canSeeTrash,
  onBoard,
  onTrash,
}: {
  palette: SemanticPalette;
  canSeeTrash: boolean;
  onBoard: () => void;
  onTrash: () => void;
}) {
  const foreground = palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[600];
  return (
    <View style={s.actions}>
      <TouchableOpacity
        style={s.action}
        onPress={onBoard}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Открыть доску заказ-нарядов"
      >
        <Ionicons name="albums-outline" size={21} color={foreground} />
        <Text style={[s.actionLabel, { color: foreground }]}>Доска</Text>
      </TouchableOpacity>
      {canSeeTrash && (
        <TouchableOpacity
          style={s.action}
          onPress={onTrash}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Открыть корзину удалённых заказ-нарядов"
        >
          <Ionicons name="trash-outline" size={21} color={foreground} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export function JournalHeaderSegments({
  palette,
  active,
  onChange,
}: {
  palette: SemanticPalette;
  active: JournalScope;
  onChange: (scope: JournalScope) => void;
}) {
  const selectedForeground = palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[700];
  return (
    <View style={s.segmentedWrap}>
      <View
        style={[
          s.segmentedControl,
          { backgroundColor: palette.bg.muted },
          Platform.OS === 'android' && {
            borderWidth: 1,
            borderColor: palette.border.strong,
            backgroundColor: palette.bg.canvas,
          },
        ]}
      >
        {(
          [
            { key: 'checks', label: 'Чеки', accessibilityLabel: 'Чеки', icon: 'receipt-outline' },
            { key: 'warehouse', label: 'Документы', accessibilityLabel: 'Складские документы', icon: 'cube-outline' },
          ] as const
        ).map((scope) => {
          const selected = active === scope.key;
          const foreground = selected ? selectedForeground : palette.text.secondary;
          return (
            <TouchableOpacity
              key={scope.key}
              style={[
                s.segment,
                selected && [
                  Platform.OS === 'ios' && buildShadow(palette),
                  { backgroundColor: Platform.OS === 'ios' ? palette.bg.card : palette.accent.primarySoft },
                ],
              ]}
              onPress={() => onChange(scope.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={scope.accessibilityLabel}
              accessibilityState={{ selected }}
            >
              <Ionicons name={scope.icon} size={15} color={foreground} />
              <Text style={[s.segmentLabel, selected && s.segmentLabelActive, { color: foreground }]}>
                {scope.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1],
    minWidth: touch,
    minHeight: touch,
  },
  actionLabel: { fontSize: 13, lineHeight: 18, fontWeight: fontWeight.semibold, flexShrink: 1 },
  segmentedWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  segmentedControl: { flexDirection: 'row', borderRadius: borderRadius.xl, padding: 2 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    minHeight: touch,
    borderRadius: borderRadius.lg,
  },
  segmentLabel: { fontSize: fontSize.sm, flexShrink: 1, textAlign: 'center', fontWeight: fontWeight.medium },
  segmentLabelActive: { fontWeight: fontWeight.semibold },
});
