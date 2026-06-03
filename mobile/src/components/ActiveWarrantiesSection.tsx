/**
 * ActiveWarrantiesSection — premium informational block rendered inside
 * the selected-car area of the cash screen. It surfaces what is still
 * under warranty FOR THE PICKED CAR, e.g.:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ 🛡 На гарантии        2 активные гарантии   │
 *   ├─────────────────────────────────────────────┤
 *   │ 🔧 Диагностика            ┌ ещё 24 дня ┐    │
 *   │ 📦 Редуктор Нордик        └ 3 мес 5 дней ┘   │
 *   └─────────────────────────────────────────────┘
 *
 *   • Shield header + count of active warranties.
 *   • Per-item row: tool/cube icon, item name, remaining-time chip.
 *   • Chip colour reflects urgency by days-left:
 *       ≥ 14 days → green   (healthy)
 *       1-13 days → amber   (ending soon)
 *       ≤ 0 days → red      (defensive — backend filters expired out)
 *
 * Data contract (Wave 1 backend):
 *   `warrantyApi.activeForCar(carId)` → `WarrantyActive[]`
 *     = { id, itemType: 'product'|'service', itemName, warrantyDays, expiresAt }
 *   Returns active (not used, not expired) claims, soonest-to-expire
 *   first; empty array if none. The remaining-time label is computed
 *   client-side from `expiresAt` via the shared `warrantyFormat` util so
 *   it stays accurate even if the badge is shown hours after the fetch.
 *
 * Behaviour:
 *   - Query key `['warranty-active-car', carId]`, gated by
 *     `enabled: !!carId`, `staleTime: 60s` — cheap, never blocks the
 *     Касса open.
 *   - Renders NOTHING (no empty band, no loading flicker) when there is
 *     no car, no data yet, or zero active warranties — the form is dense
 *     enough without a placeholder.
 *   - Dark-mode aware via `useColors()`.
 *
 * Why a dedicated component:
 *   The cash screen file is already ~2.9k lines; isolating the query +
 *   urgency styling here keeps it readable and reusable.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { warrantyApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, spacing, borderRadius } from '../theme';
import { formatDaysLeft } from '../utils/warrantyFormat';
import type { WarrantyActive } from '../../../shared/types';

interface ActiveWarrantiesSectionProps {
  carId?: string;
}

/** Decline "активная гарантия" by quantity. */
function pluraliseActive(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} активная гарантия`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} активные гарантии`;
  return `${n} активных гарантий`;
}

/**
 * Whole days remaining until `expiresAt` (rounded up so "expires later
 * today" still reads as 1 day, not 0). Past dates → 0.
 */
function daysUntil(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Map daysLeft → (background, border, text) tokens for the urgency chip.
 * Returns hex strings rather than theme tokens because the chip colour
 * MUST stay green/amber/red regardless of light/dark — we only shift the
 * surface intensity per mode. Threshold: < 14 days → amber.
 */
function urgencyTones(daysLeft: number, isDark: boolean) {
  // Green for healthy warranties (≥ 14 days left).
  if (daysLeft >= 14) {
    return isDark
      ? { bg: 'rgba(34, 197, 94, 0.16)', border: 'rgba(34, 197, 94, 0.3)', text: '#86efac' }
      : { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857' };
  }
  // Amber for the "ending soon" band (1-13 days).
  if (daysLeft >= 1) {
    return isDark
      ? { bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.32)', text: '#fcd34d' }
      : { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
  }
  // Red for the danger zone (defensive — backend should filter expired).
  return isDark
    ? { bg: 'rgba(239, 68, 68, 0.18)', border: 'rgba(239, 68, 68, 0.34)', text: '#fca5a5' }
    : { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
}

export default function ActiveWarrantiesSection({ carId }: ActiveWarrantiesSectionProps) {
  const palette = useColors();
  const isDark = palette.mode === 'dark';

  const { data } = useQuery<WarrantyActive[]>({
    queryKey: ['warranty-active-car', carId],
    queryFn: async () => {
      const res = await warrantyApi.activeForCar(carId!);
      return res.data || [];
    },
    enabled: !!carId,
    staleTime: 60_000,
  });

  if (!carId) return null;
  const items = data || [];
  if (items.length === 0) return null;

  return (
    <View
      style={[styles.box, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.shieldWrap, { backgroundColor: palette.bg.canvas, borderColor: palette.border.subtle }]}>
          <Ionicons name="shield-checkmark" size={13} color={colors_shield(isDark)} />
        </View>
        <Text style={[styles.headerTitle, { color: palette.text.primary }]}>На гарантии</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.headerCount, { color: palette.text.tertiary }]}>
          {pluraliseActive(items.length)}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: palette.border.subtle }]} />
      <View style={styles.list}>
        {items.map((w) => {
          const daysLeft = daysUntil(w.expiresAt);
          const tone = urgencyTones(daysLeft, isDark);
          const iconName = w.itemType === 'product' ? 'cube-outline' : 'build-outline';
          return (
            <View key={w.id} style={styles.row}>
              <View
                style={[styles.iconWrap, { backgroundColor: palette.bg.canvas, borderColor: palette.border.subtle }]}
              >
                <Ionicons name={iconName} size={14} color={palette.text.secondary} />
              </View>
              <Text style={[styles.itemName, { color: palette.text.primary }]} numberOfLines={1}>
                {w.itemName}
              </Text>
              <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Ionicons name="time-outline" size={11} color={tone.text} style={styles.chipIcon} />
                <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
                  {formatDaysLeft(daysLeft)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Shield tint — green-leaning, slightly brighter in dark mode. */
function colors_shield(isDark: boolean): string {
  return isDark ? '#6ee7b7' : '#059669';
}

// Exported so future consumers (client detail, dashboard alerts) can reuse
// the pluralisation / urgency / days-left helpers without redeclaring them.
export { pluraliseActive, urgencyTones, daysUntil };

const styles = StyleSheet.create({
  box: {
    marginTop: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  shieldWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.1,
  },
  headerCount: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  list: {
    gap: spacing[1.5],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIcon: {
    marginTop: -0.5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.1,
  },
});
