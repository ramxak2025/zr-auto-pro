/**
 * ShareCard — trading-card style portrait (1080×1920) of an employee.
 *
 * The card is rendered off-screen-ish (inside a modal preview) and
 * captured to a PNG with `react-native-view-shot.captureRef`. The PNG
 * is then either saved via `expo-media-library` or shared via
 * `expo-sharing`.
 *
 * Visual hierarchy top → bottom:
 *   1. Background gradient (rank-coloured) + subtle noise dots
 *   2. Avatar circle (220pt) + name (48pt bold) + class (24pt)
 *   3. Rank pill — "GOLD · LVL 24"
 *   4. Apple Activity Rings (3 concentric) — Eff / Disc / Activity
 *   5. Top-3 trophies row
 *   6. Streak chip "🔥 12 дней"
 *   7. Watermark "Autexa" at the bottom
 *
 * The actual on-disk PNG is bigger than the on-screen preview — we let
 * the captureRef `width`/`height` props handle the export resolution so
 * the on-screen view stays at a comfortable 1:1 device size.
 */
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../platform/Typography';
import { colors } from '../../theme';
import { ActivityRings } from './ActivityRings';
import type { RankInfo } from './rank';
import { rankLabelUpper } from './rank';

export interface ShareCardData {
  fullName: string;
  className: string;
  initials: string;
  photoUrl?: string | null;
  rank: RankInfo;
  rings: {
    efficiency: number;
    discipline: number;
    activity: number;
    rating: number;
  };
  trophies: {
    name: string;
    icon?: string | null;
    color?: string | null;
  }[];
  streakDays?: number;
}

const CARD_W = 360; // logical on-screen width (preview)
const CARD_H = 640; // logical on-screen height — close to 9:16 portrait

export const SHARE_CARD_EXPORT_WIDTH = 1080;
export const SHARE_CARD_EXPORT_HEIGHT = 1920;

interface ShareCardProps {
  data: ShareCardData;
  /** When true the card uses the device-scaled preview size. When false
   *  it's used as the captured-off-screen source (still same logical
   *  size — view-shot will upsize via its width/height options). */
}

export const ShareCard = React.forwardRef<View, ShareCardProps>(({ data }, ref) => {
  const { rank, rings, trophies, streakDays, fullName, className, initials, photoUrl } = data;
  return (
    <View ref={ref} collapsable={false} style={styles.cardOuter}>
      <LinearGradient
        colors={rank.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* subtle radial-ish overlay */}
        <View style={styles.overlay} pointerEvents="none" />

        {/* Watermark stripe top — minimal */}
        <View style={styles.topRow}>
          <View style={styles.dot} />
          <Text style={styles.brand}>Autexa</Text>
        </View>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatarImg, styles.avatarLetters, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={[styles.avatarRing, { borderColor: rank.accent }]} />
        </View>

        {/* Name + class */}
        <Text style={styles.name} numberOfLines={1}>
          {fullName}
        </Text>
        <Text style={styles.className} numberOfLines={1}>
          {className}
        </Text>

        {/* Rank pill */}
        <View style={[styles.rankPill, { backgroundColor: rank.accent }]}>
          <Text style={styles.rankPillText}>{rankLabelUpper(rank)}</Text>
        </View>

        {/* Activity rings */}
        <View style={styles.ringsWrap}>
          <ActivityRings
            size={220}
            strokeWidth={20}
            gap={4}
            centerLabel={`${Math.round((rings.efficiency + rings.discipline + rings.activity + rings.rating) / 4)}`}
            values={[
              { label: 'Эффективность', value: rings.efficiency, color: '#F87171' },
              { label: 'Дисциплина', value: rings.discipline, color: '#34D399' },
              { label: 'Активность', value: rings.activity, color: '#60A5FA' },
              { label: 'Рейтинг', value: rings.rating, color: '#FBBF24' },
            ]}
          />
          <View style={styles.legendCol}>
            <LegendDot color="#F87171" label="Эффективность" value={rings.efficiency} />
            <LegendDot color="#34D399" label="Дисциплина" value={rings.discipline} />
            <LegendDot color="#60A5FA" label="Активность" value={rings.activity} />
            <LegendDot color="#FBBF24" label="Рейтинг" value={rings.rating} />
          </View>
        </View>

        {/* Trophies row */}
        {trophies.length > 0 && (
          <View style={styles.trophiesRow}>
            {trophies.slice(0, 3).map((t, idx) => (
              <View key={idx} style={[styles.trophy, { borderColor: t.color || rank.accent }]}>
                <Text style={styles.trophyIcon}>{t.icon || '🏆'}</Text>
                <Text style={styles.trophyName} numberOfLines={1}>
                  {t.name}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Streak chip */}
        {streakDays && streakDays > 0 ? (
          <View style={styles.streakChip}>
            <Text style={styles.streakIcon}>🔥</Text>
            <Text style={styles.streakText}>{streakDays} дней</Text>
          </View>
        ) : null}

        {/* Bottom brand */}
        <View style={styles.bottomBrand}>
          <Text style={styles.bottomBrandText}>autexa · карточка сотрудника</Text>
        </View>
      </LinearGradient>
    </View>
  );
});
ShareCard.displayName = 'ShareCard';

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{Math.round(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardOuter: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 24,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  card: {
    flex: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'stretch',
    marginBottom: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.9)' },
  brand: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '700', letterSpacing: 1 },

  avatarWrap: { width: 132, height: 132, marginTop: 4, justifyContent: 'center', alignItems: 'center' },
  avatarImg: { width: 124, height: 124, borderRadius: 62 },
  avatarLetters: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#fff', fontSize: 42, fontWeight: '800', letterSpacing: -1 },
  avatarRing: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 4,
  },

  name: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  className: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },

  rankPill: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
  },
  rankPillText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },

  ringsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    alignSelf: 'stretch',
    gap: 10,
  },
  legendCol: { gap: 8, flex: 1 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, flex: 1 },
  legendValue: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  trophiesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    alignSelf: 'stretch',
  },
  trophy: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderRadius: 12,
  },
  trophyIcon: { fontSize: 22 },
  trophyName: { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center' },

  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
  },
  streakIcon: { fontSize: 14 },
  streakText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  bottomBrand: { position: 'absolute', bottom: 10, alignSelf: 'center' },
  bottomBrandText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '600',
  },
});

// Keep `colors` import in scope for tree-shaking even if we don't reference it
// — silence unused-import lint without changing semantics.
void colors;
