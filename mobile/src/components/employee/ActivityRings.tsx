/**
 * ActivityRings — Apple Activity-style three concentric arc rings.
 *
 * Each ring is a colour-coded arc that fills 0–100% based on its
 * normalised value. Used inside the "trading card" share preview.
 * Drawn with SVG so it captures crisply to PNG via react-native-view-shot.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Text } from '../../platform/Typography';
import { colors } from '../../theme';

export interface ActivityRingValue {
  value: number; // 0–100
  label: string;
  /** Bright accent for the arc. */
  color: string;
  /** Background "track" colour for the ring (defaults to a darker tint of `color`). */
  trackColor?: string;
}

export interface ActivityRingsProps {
  values: ActivityRingValue[];
  size?: number;
  /** Stroke width of each ring. Default depends on size. */
  strokeWidth?: number;
  /** Gap between rings in pt. Default 4. */
  gap?: number;
  /** Show numeric % in centre. */
  centerLabel?: string;
}

/**
 * SVG progress ring — draws an arc from the top going clockwise.
 * `progress` is 0..1.
 */
function Ring({
  r,
  stroke,
  trackStroke,
  strokeWidth,
  progress,
}: {
  r: number;
  stroke: string;
  trackStroke: string;
  strokeWidth: number;
  progress: number;
}) {
  const C = 2 * Math.PI * r;
  // For 100% we want the full circle. We keep a 1% gap so the cap doesn't
  // perfectly overlap the start point — feels more Apple-like.
  const dash = C * Math.min(0.999, progress);
  return (
    <G rotation="-90" origin={`${r + strokeWidth / 2}, ${r + strokeWidth / 2}`}>
      <Circle
        cx={r + strokeWidth / 2}
        cy={r + strokeWidth / 2}
        r={r}
        stroke={trackStroke}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={r + strokeWidth / 2}
        cy={r + strokeWidth / 2}
        r={r}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${dash}, ${C}`}
        strokeLinecap="round"
      />
    </G>
  );
}

export function ActivityRings({
  values,
  size = 240,
  strokeWidth,
  gap = 4,
  centerLabel,
}: ActivityRingsProps) {
  const sw = strokeWidth ?? Math.max(14, Math.round(size * 0.08));
  const half = size / 2;
  // Pre-compute each ring radius based on its index (outer-to-inner).
  const radii = values.map((_, i) => half - sw / 2 - i * (sw + gap));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {values.map((v, i) => {
          const r = radii[i];
          if (r <= 0) return null;
          // Each <Ring> renders in a translated container that aligns the (r + sw/2)
          // origin with the chart centre.
          const tx = half - (r + sw / 2);
          const ty = half - (r + sw / 2);
          return (
            <G key={i} x={tx} y={ty}>
              <Ring
                r={r}
                stroke={v.color}
                trackStroke={v.trackColor ?? tintForTrack(v.color)}
                strokeWidth={sw}
                progress={Math.max(0, Math.min(1, v.value / 100))}
              />
            </G>
          );
        })}
      </Svg>
      {centerLabel ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.centerText}>{centerLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

function tintForTrack(color: string): string {
  // Pull an rgb-decomposed track at 25% alpha (or fall back to grey).
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.replace(/^#/, ''));
  if (!m) return 'rgba(255,255,255,0.25)';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, 0.25)`;
}

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  centerText: {
    color: colors.white,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
});
