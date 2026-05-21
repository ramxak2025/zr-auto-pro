import React from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Warehouse } from '../../../shared/types';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, borderRadius, spacing } from '../theme';

/**
 * WarehouseSwitcher — bottom-sheet that lists the 3 warehouses
 * (main / defect / used) and lets the user pick one.
 *
 * The sheet styling is fully theme-aware (uses `useColors()`), so dark
 * mode renders correctly without hard-coding `colors.white`/grays for
 * surfaces or text. The visual language mirrors the iOS action-sheet
 * pattern: handle bar at the top, rounded sheet on the elevated palette,
 * hairline-separated rows with a leading kind icon and a trailing
 * checkmark for the selection.
 */
interface WarehouseSwitcherProps {
  visible: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  selectedId: string | null;
  onSelect: (warehouse: Warehouse) => void;
}

const KIND_META: Record<Warehouse['kind'], { icon: keyof typeof Ionicons.glyphMap; tint: 'primary' | 'red' | 'amber' }> = {
  main: { icon: 'cube-outline', tint: 'primary' },
  defect: { icon: 'warning-outline', tint: 'red' },
  used: { icon: 'sync-outline', tint: 'amber' },
};

const FALLBACK_LABEL: Record<Warehouse['kind'], string> = {
  main: 'Основной склад',
  defect: 'Склад брака',
  used: 'Склад Б/У',
};

const TINT_COLORS = {
  primary: { fg: '#4f46e5', bg: 'rgba(79, 70, 229, 0.14)' },
  red: { fg: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)' },
  amber: { fg: '#f59e0b', bg: 'rgba(245, 158, 11, 0.16)' },
};

export default function WarehouseSwitcher({
  visible,
  onClose,
  warehouses,
  selectedId,
  onSelect,
}: WarehouseSwitcherProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();

  // Sort by sortOrder (server already does it; defensive fallback for
  // older clients reading from persistent cache before the migration).
  const sorted = React.useMemo(
    () => [...warehouses].sort((a, b) => a.sortOrder - b.sortOrder),
    [warehouses],
  );

  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation?.()}
          style={[
            styles.sheet,
            {
              backgroundColor: palette.bg.elevated,
              paddingBottom: Math.max(insets.bottom, spacing[4]),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.border.strong }]} />
          <Text style={[styles.title, { color: palette.text.primary }]}>{'Выбор склада'}</Text>
          {sorted.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: palette.text.secondary }]}>
                {'Склады недоступны'}
              </Text>
            </View>
          ) : (
            sorted.map((wh, idx) => {
              const meta = KIND_META[wh.kind];
              const tint = TINT_COLORS[meta.tint];
              const isSelected = wh.id === selectedId;
              const label = wh.name || FALLBACK_LABEL[wh.kind];
              return (
                <TouchableOpacity
                  key={wh.id}
                  activeOpacity={0.6}
                  onPress={() => {
                    onSelect(wh);
                    onClose();
                  }}
                  style={[
                    styles.row,
                    idx < sorted.length - 1 && {
                      borderBottomColor: palette.border.subtle,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={[styles.iconBox, { backgroundColor: tint.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={tint.fg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={[styles.rowSubtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {wh.kind === 'main'
                        ? 'Основной товарный запас'
                        : wh.kind === 'defect'
                          ? 'Брак, возвраты, недостача'
                          : 'Б/У детали и комплектующие'}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color={palette.accent.primary} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    borderTopRightRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: spacing[2],
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    gap: spacing[3],
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  rowSubtitle: { fontSize: fontSize.xs, marginTop: 2 },
  emptyWrap: { paddingVertical: spacing[6], alignItems: 'center' },
  emptyText: { fontSize: fontSize.sm },
});
