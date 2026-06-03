/**
 * LoyaltyBadge — last satisfaction rating of a client (#15.2 ⭐).
 *
 * The client-detail endpoint returns `lastRating` (1–5) and `lastRatingAt`
 * from review_responses. This badge turns that into an at-a-glance loyalty
 * signal: a five-star strip, a coloured pill (green = happy, amber = mixed,
 * red = unhappy) and the date of the rating.
 *
 * Renders nothing when the client has never been rated.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';

function ratingTone(rating: number): { fg: string; bg: string; label: string } {
  if (rating >= 4.5) return { fg: colors.green[700], bg: colors.green[50], label: 'Доволен' };
  if (rating >= 3.5) return { fg: colors.green[600], bg: colors.green[50], label: 'Скорее доволен' };
  if (rating >= 2.5) return { fg: colors.amber[700], bg: colors.amber[50], label: 'Нейтрально' };
  return { fg: colors.red[600], bg: colors.red[50], label: 'Недоволен' };
}

function formatDate(d?: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function LoyaltyBadge({
  rating,
  ratedAt,
  cardStyle,
}: {
  rating?: number | null;
  ratedAt?: string | null;
  cardStyle?: object;
}) {
  const palette = useColors();
  if (rating == null) return null;

  const rounded = Math.round(rating);
  const tone = ratingTone(rating);

  return (
    <View
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }, cardStyle]}
    >
      <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
        <Ionicons name="heart" size={18} color={tone.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons
              key={i}
              name={i <= rounded ? 'star' : 'star-outline'}
              size={15}
              color={i <= rounded ? colors.yellow[500] : palette.text.tertiary}
            />
          ))}
          <Text variant="body" color={palette.text.primary} style={styles.ratingValue}>
            {rating.toFixed(1)}
          </Text>
        </View>
        <Text variant="caption" color={palette.text.tertiary} style={{ marginTop: 2 }}>
          Последняя оценка{ratedAt ? ` · ${formatDate(ratedAt)}` : ''}
        </Text>
      </View>
      <View style={[styles.tonePill, { backgroundColor: tone.bg }]}>
        <Text variant="caption" color={tone.fg} style={styles.toneText}>
          {tone.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingValue: { fontWeight: '700', marginLeft: spacing[2] },
  tonePill: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  toneText: { fontWeight: '700' },
});
