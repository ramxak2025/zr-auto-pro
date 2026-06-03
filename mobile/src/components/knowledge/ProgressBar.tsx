/**
 * ProgressBar — a thin, theme-aware course-progress track.
 *
 * Used by the course list, course detail and the home «Учебный центр» entry.
 * `percent` is 0–100; the fill colour flips green once complete.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';

interface ProgressBarProps {
  /** 0–100. */
  percent: number;
  /** Override the in-progress fill colour (default = accent). */
  color?: string;
  height?: number;
}

function ProgressBarInner({ percent, color, height = 6 }: ProgressBarProps) {
  const palette = useColors();
  const ratio = Math.max(0, Math.min(1, percent / 100));
  const done = ratio >= 1;
  const fill = done ? colors.green[500] : color ?? palette.accent.primary;
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: palette.bg.muted }]}>
      <View style={[styles.fill, { width: `${ratio * 100}%`, borderRadius: height / 2, backgroundColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', borderRadius: borderRadius.full },
  fill: { height: '100%' },
});

export const ProgressBar = React.memo(ProgressBarInner);
export default ProgressBar;
