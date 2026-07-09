/**
 * MarketingCharts — lightweight SVG chart primitives for the marketing report.
 *
 * All charts are STATIC `Path`/`Rect`/`Circle` strings recomputed with `useMemo`
 * only when their data or measured width changes — never per animation frame — so
 * they reconcile by string identity and stay at 60 fps even inside a long scroll.
 * No animated SVG props, no heavy charting dependency: just `react-native-svg`
 * (already a project dep via expo).
 *
 * Components:
 *   • <TrendLineChart>  — smoothed area+line for one metric across N buckets,
 *                         with x-axis tick labels and an optional tap-scrub dot.
 *   • <MiniBars>        — proportional vertical bars (cohort / repeat histogram).
 *   • <DonutRatio>      — two-segment ring (redeemed vs outstanding, etc.).
 *
 * Colours are passed in by the caller so the chart stays theme-agnostic.
 */
import React, { useMemo, useState } from 'react';
import { View, LayoutChangeEvent, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Circle, Rect, Line } from 'react-native-svg';
import { Text } from '../../platform/Typography';

// ─────────────────────────────────────────────────────────────────────────────
//  Path helpers — smoothed (Catmull-Rom-ish midpoint) line + closed area.
// ─────────────────────────────────────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}

function pointsFor(values: number[], w: number, h: number, pad: number): Pt[] {
  const n = values.length;
  if (n === 0) return [];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const innerH = h - pad * 2;
  if (n === 1) {
    const y = h - pad - ((values[0] - min) / range) * innerH;
    return [
      { x: 0, y },
      { x: w, y },
    ];
  }
  return values.map((v, i) => ({
    x: (i / (n - 1)) * w,
    y: h - pad - ((v - min) / range) * innerH,
  }));
}

function smoothLine(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
//  <TrendLineChart>
// ─────────────────────────────────────────────────────────────────────────────

export interface TrendLineChartProps {
  values: number[];
  /** X-axis labels, one per value; a few are shown to avoid crowding. */
  labels: string[];
  color: string;
  /** Track / hairline colour (theme-aware). */
  gridColor: string;
  labelColor: string;
  height?: number;
  /** Selected index → highlighted dot + emphasized. Controlled by the caller. */
  selectedIndex?: number | null;
  onSelectIndex?: (i: number | null) => void;
  /** Format a value for the floating tooltip label. */
  formatValue?: (v: number) => string;
  tooltipColor?: string;
  tooltipTextColor?: string;
}

/** Smoothed area + line trend, self-measuring width, tap-to-scrub. */
export function TrendLineChart({
  values,
  labels,
  color,
  gridColor,
  labelColor,
  height = 150,
  selectedIndex = null,
  onSelectIndex,
  formatValue,
  tooltipColor,
  tooltipTextColor,
}: TrendLineChartProps) {
  const [w, setW] = useState(0);
  const pad = 8;

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next && next !== w) setW(next);
  };

  const pts = useMemo(() => (w > 0 ? pointsFor(values, w, height, pad) : []), [values, w, height]);
  const line = useMemo(() => smoothLine(pts), [pts]);
  const area = useMemo(() => (line ? `${line} L ${w} ${height} L 0 ${height} Z` : ''), [line, w, height]);

  // A handful of evenly-spaced x labels (first, middle, last) — never crowd.
  const tickIdxs = useMemo(() => {
    const n = labels.length;
    if (n <= 1) return n === 1 ? [0] : [];
    if (n <= 4) return labels.map((_, i) => i);
    return [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1];
  }, [labels]);

  const gradId = useMemo(() => `trendGrad-${Math.round(Math.random() * 1e6)}`, []);
  const hasSel = selectedIndex != null && pts[selectedIndex] != null;
  const sel = hasSel ? pts[selectedIndex as number] : null;

  const handleTouch = (locX: number) => {
    if (!onSelectIndex || pts.length === 0 || w <= 0) return;
    const n = values.length;
    if (n <= 1) {
      onSelectIndex(0);
      return;
    }
    const idx = Math.min(n - 1, Math.max(0, Math.round((locX / w) * (n - 1))));
    onSelectIndex(idx);
  };

  return (
    <View>
      <View
        style={{ height, width: '100%' }}
        onLayout={onLayout}
        // Grant on a TAP (start) so a single tap selects a point; once granted,
        // `onResponderMove` scrubs. We do NOT claim the move-should-set here, so
        // a vertical drag that starts on the chart still bubbles to the parent
        // ScrollView — and `onResponderTerminationRequest` lets the ScrollView
        // reclaim the gesture if it turns into a scroll, so scroll never hijacks.
        onStartShouldSetResponder={() => !!onSelectIndex}
        onResponderTerminationRequest={() => true}
        onResponderGrant={(e) => handleTouch(e.nativeEvent.locationX)}
        onResponderMove={(e) => handleTouch(e.nativeEvent.locationX)}
        onResponderRelease={() => onSelectIndex?.(null)}
        onResponderTerminate={() => onSelectIndex?.(null)}
      >
        {w > 0 && line ? (
          <Svg width={w} height={height}>
            <Defs>
              <SvgGrad id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.22} />
                <Stop offset="1" stopColor={color} stopOpacity={0.0} />
              </SvgGrad>
            </Defs>
            {/* baseline hairline */}
            <Line x1={0} y1={height - pad} x2={w} y2={height - pad} stroke={gridColor} strokeWidth={1} />
            <Path d={area} fill={`url(#${gradId})`} />
            <Path d={line} stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {sel ? (
              <>
                <Line
                  x1={sel.x}
                  y1={0}
                  x2={sel.x}
                  y2={height}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.4}
                />
                <Circle cx={sel.x} cy={sel.y} r={5.5} fill={color} />
                <Circle cx={sel.x} cy={sel.y} r={2.5} fill="#ffffff" />
              </>
            ) : null}
          </Svg>
        ) : null}

        {/* Floating tooltip for the selected point. */}
        {sel && formatValue ? (
          <View
            style={[
              styles.tooltip,
              {
                backgroundColor: tooltipColor ?? color,
                left: Math.max(0, Math.min(w - 88, sel.x - 44)),
                top: Math.max(0, sel.y - 34),
              },
            ]}
            pointerEvents="none"
          >
            <Text style={[styles.tooltipText, { color: tooltipTextColor ?? '#ffffff' }]} numberOfLines={1}>
              {formatValue(values[selectedIndex as number] ?? 0)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* x-axis labels */}
      <View style={styles.axisRow}>
        {tickIdxs.map((i) => (
          <Text key={i} style={[styles.axisLabel, { color: labelColor }]} numberOfLines={1}>
            {labels[i]}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  <MiniBars> — proportional vertical bars with a value + label under each.
// ─────────────────────────────────────────────────────────────────────────────

export interface MiniBarsProps {
  bars: { label: string; value: number; color?: string }[];
  color: string;
  trackColor: string;
  labelColor: string;
  valueColor: string;
  height?: number;
  /** Render the value on top of each bar. */
  showValues?: boolean;
}

export function MiniBars({
  bars,
  color,
  trackColor,
  labelColor,
  valueColor,
  height = 96,
  showValues = true,
}: MiniBarsProps) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <View>
      <View style={[styles.barsRow, { height }]}>
        {bars.map((b, i) => {
          const h = b.value > 0 ? Math.max(3, (b.value / max) * (height - 4)) : 3;
          return (
            <View key={`${b.label}-${i}`} style={styles.barCol}>
              {showValues ? (
                <Text style={[styles.barTopValue, { color: valueColor }]} numberOfLines={1}>
                  {b.value > 0 ? b.value : ''}
                </Text>
              ) : null}
              <View style={[styles.barTrackFull, { backgroundColor: trackColor }]}>
                <View
                  style={{
                    height: h,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: b.value > 0 ? (b.color ?? color) : trackColor,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.barsLabelRow}>
        {bars.map((b, i) => (
          <Text key={`${b.label}-l-${i}`} style={[styles.barBottomLabel, { color: labelColor }]} numberOfLines={1}>
            {b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  <DonutRatio> — a two-value ring (e.g. redeemed vs outstanding).
// ─────────────────────────────────────────────────────────────────────────────

export interface DonutRatioProps {
  /** 0..1 fraction to fill with `color`; the rest is `trackColor`. */
  fraction: number;
  color: string;
  trackColor: string;
  size?: number;
  strokeWidth?: number;
  /** Centered label (value) + sub. */
  centerLabel?: string;
  centerSub?: string;
  labelColor: string;
  subColor: string;
}

export function DonutRatio({
  fraction,
  color,
  trackColor,
  size = 108,
  strokeWidth = 12,
  centerLabel,
  centerSub,
  labelColor,
  subColor,
}: DonutRatioProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const dash = `${(c * f).toFixed(1)} ${(c * (1 - f)).toFixed(1)}`;
  const cx = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={cx}
          cy={cx}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={dash}
          strokeLinecap="round"
          // start at 12 o'clock
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </Svg>
      {centerLabel != null ? (
        <View style={styles.donutCenter} pointerEvents="none">
          <Text
            style={[styles.donutValue, { color: labelColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {centerLabel}
          </Text>
          {centerSub ? (
            <Text style={[styles.donutSub, { color: subColor }]} numberOfLines={1}>
              {centerSub}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisLabel: { fontSize: 10, fontWeight: '500', flexShrink: 1 },

  tooltip: {
    position: 'absolute',
    minWidth: 56,
    maxWidth: 88,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  tooltipText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barTopValue: { fontSize: 10, fontWeight: '700', marginBottom: 3, fontVariant: ['tabular-nums'] },
  barTrackFull: { width: '100%', flex: 1, justifyContent: 'flex-end', borderRadius: 4, overflow: 'hidden' },
  barsLabelRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  barBottomLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600' },

  donutCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  donutValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  donutSub: { fontSize: 10, fontWeight: '600', marginTop: 1, textAlign: 'center' },
});
