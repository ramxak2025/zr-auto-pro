/**
 * StoriesShareCard — a purpose-made vertical 9:16 "Stories" card that
 * summarises a financial period in a form the owner would be proud to post.
 *
 * It is NOT the full report screenshot — it's a curated, branded highlight
 * reel: brand header, period, and the four key metrics (выручка, чистая
 * прибыль, маржа, чеки) on a tasteful gradient.
 *
 * Usage pattern (see ReportsScreen):
 *   1. Render <StoriesShareCard ref={ref} ... /> inside a hidden absolute
 *      container that is still laid out (off-screen, not display:none).
 *   2. `captureRef(ref, { format: 'png', width: 1080, height: 1920, ... })`.
 *   3. `Sharing.shareAsync(uri, { mimeType: 'image/png' })`.
 *
 * The logical on-screen size stays compact (CARD_W×CARD_H ≈ 9:16); view-shot
 * upsizes to STORIES_EXPORT_WIDTH×STORIES_EXPORT_HEIGHT at capture time, so
 * the exported PNG is crisp 1080×1920.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G } from 'react-native-svg';
import { Text } from '../platform/Typography';

// Logical preview size — kept near 9:16 so the layout the user "sees"
// (off-screen) matches the exported proportions exactly.
const CARD_W = 360;
const CARD_H = 640;

// High-res export target — 1080×1920 is the canonical Stories canvas.
export const STORIES_EXPORT_WIDTH = 1080;
export const STORIES_EXPORT_HEIGHT = 1920;

export interface StoriesShareCardData {
  /** Автосервис — печатается в шапке как бренд. */
  companyName: string;
  /** Человекочитаемый период, напр. «Май 2026» или «1 мая — 30 мая». */
  periodLabel: string;
  revenue: string;
  netProfit: string;
  /** Положительная ли чистая прибыль — управляет акцентным цветом. */
  netProfitPositive: boolean;
  marginPct: string;
  checkCount: string;
}

/**
 * MiniRing — компактное декоративное кольцо под маржой (Apple Activity
 * vibe), заполняется пропорционально проценту маржи (clamped 0..100).
 */
function MiniRing({ pct }: { pct: number }) {
  const size = 64;
  const stroke = 7;
  const r = size / 2 - stroke / 2;
  const C = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(1, pct / 100));
  return (
    <Svg width={size} height={size}>
      <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#ffffff"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${C * Math.min(0.999, progress)}, ${C}`}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}

export const StoriesShareCard = React.forwardRef<View, { data: StoriesShareCardData }>(({ data }, ref) => {
  const { companyName, periodLabel, revenue, netProfit, netProfitPositive, marginPct, checkCount } = data;

  // Зелёный градиент когда в плюсе, спокойный графит-синий когда чистая
  // прибыль ушла в минус — картинку всё равно не стыдно показать.
  const gradient: [string, string, string] = netProfitPositive
    ? ['#064e3b', '#047857', '#10b981']
    : ['#0f172a', '#1e293b', '#334155'];

  const marginNum = parseFloat(marginPct) || 0;

  return (
    <View ref={ref} collapsable={false} style={styles.cardOuter}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        {/* Декоративные световые пятна для глубины */}
        <View style={styles.glowA} pointerEvents="none" />
        <View style={styles.glowB} pointerEvents="none" />

        {/* BRAND HEADER */}
        <View style={styles.header}>
          <View style={styles.brandDot} />
          <Text style={styles.brand}>AUTEXA</Text>
        </View>
        <Text style={styles.company} numberOfLines={1}>
          {companyName}
        </Text>
        <Text style={styles.period} numberOfLines={1}>
          {periodLabel}
        </Text>

        {/* HERO — чистая прибыль */}
        <View style={styles.heroBlock}>
          <Text style={styles.heroLabel}>ЧИСТАЯ ПРИБЫЛЬ</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {netProfit}
          </Text>
        </View>

        {/* METRICS GRID */}
        <View style={styles.grid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>ВЫРУЧКА</Text>
            <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {revenue}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>ЧЕКОВ</Text>
            <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {checkCount}
            </Text>
          </View>
        </View>

        {/* MARGIN with ring */}
        <View style={styles.marginRow}>
          <View style={styles.marginRingWrap}>
            <MiniRing pct={marginNum} />
            <View style={styles.marginRingCenter} pointerEvents="none">
              <Text style={styles.marginRingPct} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
                {marginPct}%
              </Text>
            </View>
          </View>
          <View style={styles.marginText}>
            <Text style={styles.marginLabel}>МАРЖИНАЛЬНОСТЬ</Text>
            <Text style={styles.marginCaption}>Чистая прибыль к обороту</Text>
          </View>
        </View>

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Финансовый отчёт · Autexa</Text>
        </View>
      </LinearGradient>
    </View>
  );
});
StoriesShareCard.displayName = 'StoriesShareCard';

const styles = StyleSheet.create({
  cardOuter: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 28,
    overflow: 'hidden',
  },
  card: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 28,
  },
  glowA: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  glowB: {
    position: 'absolute',
    bottom: -70,
    left: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  // Brand header
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#ffffff' },
  brand: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: 3 },
  company: { color: 'rgba(255,255,255,0.95)', fontSize: 22, fontWeight: '700', marginTop: 18, letterSpacing: -0.4 },
  period: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '500', marginTop: 4 },

  // Hero
  heroBlock: { marginTop: 44 },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  heroValue: {
    color: '#ffffff',
    fontSize: 52,
    lineHeight: 62,
    fontWeight: '800',
    letterSpacing: -1.5,
    marginTop: 6,
  },

  // Metrics grid
  grid: { flexDirection: 'row', gap: 12, marginTop: 32 },
  metricCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  metricLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  metricValue: {
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },

  // Margin
  marginRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 28 },
  marginRingWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  marginRingCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  marginRingPct: { color: '#ffffff', fontSize: 15, fontWeight: '800', letterSpacing: -0.5 },
  marginText: { flex: 1 },
  marginLabel: { color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  marginCaption: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 3 },

  // Footer
  footer: { marginTop: 'auto', alignItems: 'center' },
  footerText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8 },
});
