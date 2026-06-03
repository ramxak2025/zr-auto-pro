import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { checksApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, spacing } from '../theme';

/**
 * LastVisitBadge — compact single line under the selected-car card on the
 * cash screen showing WHEN this client/car was last here, and NOTHING
 * else (no revenue, no master, no line-item details). The owner's ask:
 * "show the last check neatly = when it was, no details".
 *
 *   🕘  Последний визит: 12 мая 2026 · 21 день назад
 *
 * Data: reuses the cheap, already-existing `checksApi.getLastVisit`
 * endpoint (most recent non-deferred check date). Query is gated by
 * `enabled` and `staleTime: 60s` so it never slows the Касса open. While
 * loading, on first-visit, or on error it renders NOTHING — no flicker,
 * no empty band.
 */
interface LastVisitBadgeProps {
  clientId?: string;
  carId?: string;
}

const MONTHS_RU = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** "12 мая 2026" — absolute date, no time, no details. */
function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

/** Decline "день" for the relative "N дней назад" suffix. */
function declensionDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

/**
 * "сегодня" / "вчера" / "N дней назад" — relative suffix derived from the
 * calendar-day delta (not raw ms) so a check from yesterday evening reads
 * "вчера" even if <24h have elapsed.
 */
function formatRelative(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${declensionDays(days)} назад`;
}

export default function LastVisitBadge({ clientId, carId }: LastVisitBadgeProps) {
  const palette = useColors();
  const enabled = !!clientId || !!carId;

  const { data } = useQuery({
    queryKey: ['last-visit', { clientId, carId }],
    queryFn: async () => {
      const res = await checksApi.getLastVisit({ clientId, carId });
      return res.data;
    },
    enabled,
    staleTime: 60_000,
  });

  // No car/client, still loading, first-ever visit, or error → render
  // nothing. A "first visit" placeholder would just add noise to a dense
  // form; the absence of the line IS the signal.
  if (!enabled || !data?.date) return null;

  const absolute = formatAbsolute(data.date);
  if (!absolute) return null;
  const relative = formatRelative(data.date);

  return (
    <View style={[styles.row, { borderTopColor: palette.border.subtle }]}>
      <Ionicons name="time-outline" size={14} color={palette.text.tertiary} />
      <Text style={[styles.label, { color: palette.text.tertiary }]} numberOfLines={1}>
        Последний визит:{' '}
        <Text style={[styles.value, { color: palette.text.secondary }]}>{absolute}</Text>
        {relative ? <Text style={styles.relative}> · {relative}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing[2.5],
    paddingTop: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    letterSpacing: -0.1,
  },
  value: {
    fontWeight: fontWeight.semibold,
  },
  relative: {
    fontWeight: fontWeight.normal,
  },
});
