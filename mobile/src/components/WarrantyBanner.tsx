/**
 * WarrantyBanner — amber informational chip rendered under the selected
 * client/car card on the cash screen. Surfaces active (non-expired,
 * non-used) warranty claims for the selected client / car so the master
 * sees them before scheduling a check.
 *
 * Why amber and not red:
 *   The warranty is INFORMATIONAL — the customer has standing coverage,
 *   not a problem. Red would imply "alarm / debt"; amber implies "note
 *   this". Matches the rest of the cash screen's pill aesthetic
 *   (`LastVisitBadge` lives a hairline below, with a similar visual
 *   weight).
 *
 * Behaviour:
 *   - Tap collapses/expands the list. Collapsed shows the count + the
 *     first 1-2 items; expanded shows the rest.
 *   - Theme-aware via `useColors()`. We don't use the brand `accent`
 *     palette because that's indigo — amber lives outside the theme
 *     scale, so we hand-pick warm tokens that still respect the dark/
 *     light surface contract.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { warrantyApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, spacing } from '../theme';
import type { WarrantyClaim } from '../../../shared/types';

// Android needs an explicit opt-in for LayoutAnimation to work. iOS
// auto-enables it. Calling enable repeatedly is a no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface WarrantyBannerProps {
  clientId?: string;
  carId?: string;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function pickName(c: WarrantyClaim): string {
  if (c.itemName && c.itemName.trim().length > 0) return c.itemName;
  return c.kind === 'product' ? 'Товар' : 'Услуга';
}

export default function WarrantyBanner({ clientId, carId }: WarrantyBannerProps) {
  const palette = useColors();
  const [expanded, setExpanded] = useState(false);

  const enabled = !!clientId || !!carId;
  const { data } = useQuery<WarrantyClaim[]>({
    queryKey: ['warranty-claims-active', clientId, carId],
    queryFn: async () => {
      const res = await warrantyApi.activeForClient({ clientId, carId });
      return res.data || [];
    },
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;
  const claims = data || [];
  if (claims.length === 0) return null;

  const toggle = () => {
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext({
        duration: 200,
        update: { type: 'easeInEaseOut' },
        create: { type: 'easeInEaseOut', property: 'opacity' },
        delete: { type: 'easeInEaseOut', property: 'opacity' },
      });
    }
    setExpanded((v) => !v);
  };

  // Amber tokens — warm so the banner reads as informational, not
  // alarming. Picked manually because the semantic palette only exposes
  // a brand indigo accent.
  const amber = {
    bg: palette.bg.canvas === '#0a0d14' ? 'rgba(245, 158, 11, 0.14)' : '#fffbeb',
    border: palette.bg.canvas === '#0a0d14' ? 'rgba(245, 158, 11, 0.28)' : '#fde68a',
    icon: palette.bg.canvas === '#0a0d14' ? '#fbbf24' : '#b45309',
    title: palette.bg.canvas === '#0a0d14' ? '#fcd34d' : '#92400e',
    body: palette.bg.canvas === '#0a0d14' ? '#fde68a' : '#78350f',
  };

  const visible = expanded ? claims : claims.slice(0, 2);
  const hiddenCount = claims.length - visible.length;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={toggle}>
      <View style={[styles.box, { backgroundColor: amber.bg, borderColor: amber.border }]}>
        <View style={styles.headerRow}>
          <Ionicons name="shield-checkmark" size={14} color={amber.icon} />
          <Text style={[styles.title, { color: amber.title }]}>
            Действующая гарантия: {claims.length}
          </Text>
          <View style={{ flex: 1 }} />
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={amber.icon}
          />
        </View>
        {visible.map((c) => (
          <Text key={c.id} style={[styles.item, { color: amber.body }]} numberOfLines={1}>
            {pickName(c)} — до {formatExpiry(c.expiresAt)}
          </Text>
        ))}
        {!expanded && hiddenCount > 0 ? (
          <Text style={[styles.tail, { color: amber.icon }]}>и ещё {hiddenCount}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
  },
  item: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  tail: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
  },
});
