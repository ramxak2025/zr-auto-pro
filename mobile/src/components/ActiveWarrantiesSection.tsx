/**
 * ActiveWarrantiesSection — premium informational block rendered under
 * the LastVisitBadge on the cash screen when a client (and optionally a
 * car) is selected.
 *
 * Visual contract:
 *   ┌─────────────────────────────────────────────┐
 *   │ 🛡 На гарантии        2 активных гарантии  │
 *   ├─────────────────────────────────────────────┤
 *   │ 🔧 Замена ремня ГРМ        ┌─ ещё 2 мес ─┐  │
 *   │ 📦 Колодки тормозные       └─ ещё 12 дней ┘ │
 *   └─────────────────────────────────────────────┘
 *
 *   • Shield emoji + label header.
 *   • Per-item row: icon (build / cube), name, days-left chip.
 *   • Chip colour reflects urgency:
 *       > 30 days → bright green   (healthy)
 *       7-30 days → amber          (heads-up)
 *       < 7 days → red             (act now)
 *
 * Behaviour:
 *   - Hides itself entirely when there are zero active warranties (no
 *     placeholder strip — the screen is dense enough without it).
 *   - Data via React Query, key `['active-warranties', clientId, carId]`,
 *     `staleTime: 30s`, gated by `enabled: !!clientId`. We DON'T fetch
 *     when only a carId is present — the API requires clientId for
 *     this convenience endpoint, and that's also the trigger described
 *     in the spec.
 *   - Dark-mode aware via `useColors()`.
 *
 * Why a dedicated component:
 *   The cash screen file is already ~2.9k lines; isolating this block
 *   keeps query state, urgency styling, and pluralisation in one
 *   testable surface and lets us reuse the formatter logic.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { warrantyApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, spacing, borderRadius } from '../theme';
import { formatDaysLeft } from '../utils/warrantyFormat';
import type { ActiveWarranty } from '../../../shared/types';

interface ActiveWarrantiesSectionProps {
  clientId?: string;
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
 * Map daysLeft → (background, border, text) tokens for the urgency
 * chip. Returns hex strings rather than theme tokens because the
 * chip's colour MUST not change with the theme — green is green on
 * both backgrounds, red is red. We just shift the surface intensity.
 */
function urgencyTones(daysLeft: number, isDark: boolean) {
  // Bright green for healthy warranties (>30 days).
  if (daysLeft > 30) {
    return isDark
      ? { bg: 'rgba(34, 197, 94, 0.16)', border: 'rgba(34, 197, 94, 0.3)', text: '#86efac' }
      : { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857' };
  }
  // Amber for the 7-30 day band — "heads up, ending soon".
  if (daysLeft >= 7) {
    return isDark
      ? { bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.32)', text: '#fcd34d' }
      : { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
  }
  // Red for the danger zone (under a week left).
  return isDark
    ? { bg: 'rgba(239, 68, 68, 0.18)', border: 'rgba(239, 68, 68, 0.34)', text: '#fca5a5' }
    : { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
}

export default function ActiveWarrantiesSection({ clientId, carId }: ActiveWarrantiesSectionProps) {
  const palette = useColors();
  const isDark = palette.mode === 'dark';

  const { data } = useQuery<ActiveWarranty[]>({
    queryKey: ['active-warranties', clientId, carId],
    queryFn: async () => {
      const res = await warrantyApi.active({ clientId, carId });
      return res.data || [];
    },
    enabled: !!clientId,
    staleTime: 30_000,
  });

  if (!clientId) return null;
  const items = data || [];
  if (items.length === 0) return null;

  return (
    <View
      style={[
        styles.box,
        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: palette.text.primary }]}>
          <Text style={styles.headerEmoji}>🛡 </Text>
          На гарантии
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.headerCount, { color: palette.text.tertiary }]}>
          {pluraliseActive(items.length)}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: palette.border.subtle }]} />
      <View style={styles.list}>
        {items.map((w, idx) => {
          const tone = urgencyTones(w.daysLeft, isDark);
          const iconName = w.kind === 'product' ? 'cube-outline' : 'build-outline';
          return (
            <View
              key={`${w.kind}-${w.name}-${w.expiresAt}-${idx}`}
              style={styles.row}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: palette.bg.canvas, borderColor: palette.border.subtle },
                ]}
              >
                <Ionicons name={iconName} size={14} color={palette.text.secondary} />
              </View>
              <Text
                style={[styles.itemName, { color: palette.text.primary }]}
                numberOfLines={1}
              >
                {w.name}
              </Text>
              <View
                style={[
                  styles.chip,
                  { backgroundColor: tone.bg, borderColor: tone.border },
                ]}
              >
                <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
                  {formatDaysLeft(w.daysLeft)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Used by tests / downstream — kept exported so future consumers don't
// have to redeclare the pluralisation rules.
export { pluraliseActive, urgencyTones };

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
  headerEmoji: {
    fontSize: 14,
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
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.1,
  },
});

