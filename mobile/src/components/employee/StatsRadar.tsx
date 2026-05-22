/**
 * StatsRadar — 5-axis radial (pentagon) stats chart used on the
 * EmployeeDetail "character card" view.
 *
 * Inputs are 0–100 scaled, one per axis:
 *   ▸ Эффективность · Дисциплина · Активность · Рейтинг · Качество
 *
 * Each axis grows from 0 to its value on mount (reanimated spring),
 * mirroring an Apple Activity-ring-style reveal. The chart is drawn
 * with `react-native-svg` so we get crisp edges on every density.
 *
 * The layout is intentionally compact (~280pt tall) so it lives in
 * the same card as a textual breakdown of the five labels.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import Svg, { G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { Text } from '../../platform/Typography';
import { colors } from '../../theme';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

export interface RadarValue {
  /** 0–100 */
  value: number;
  /** Short label rendered under the polygon (e.g. "Эффективность"). */
  label: string;
}

export interface StatsRadarProps {
  values: [RadarValue, RadarValue, RadarValue, RadarValue, RadarValue];
  /** SVG size in pt. Default 260. */
  size?: number;
  /** Stroke / fill colour of the active polygon. */
  accent?: string;
  /** Background / grid colour. */
  grid?: string;
  /** Text colour for axis labels. */
  textColor?: string;
}

const TAU = Math.PI * 2;

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

export function StatsRadar({
  values,
  size = 260,
  accent = colors.primary[500],
  grid = 'rgba(15, 23, 42, 0.10)',
  textColor = colors.gray[600],
}: StatsRadarProps) {
  const N = values.length;
  const cx = size / 2;
  const cy = size / 2 + 6; // small downward bias so labels at the top have room
  // Reserve ~28pt around the chart for label glyphs so they don't get clipped.
  const maxR = size / 2 - 36;

  // -90° (top) start, clockwise.
  const angles = React.useMemo(() => Array.from({ length: N }, (_, i) => -Math.PI / 2 + (TAU * i) / N), [N]);

  // Concentric grid rings — at 25%, 50%, 75%, 100% of max radius.
  const gridLevels = [0.25, 0.5, 0.75, 1];

  // Reveal animation: every axis starts at 0 and springs toward its target.
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(120, withSpring(1, { mass: 0.9, stiffness: 130, damping: 20 }));
  }, [progress]);

  // Polygon connecting the data points. We rebuild the polygon `points` string
  // every animation frame using useAnimatedProps so reanimated keeps it on the UI thread.
  const animatedProps = useAnimatedProps(() => {
    const p = progress.value;
    const pts: string[] = [];
    for (let i = 0; i < N; i++) {
      const a = angles[i];
      const r = (Math.max(0, Math.min(100, values[i].value)) / 100) * maxR * p;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      pts.push(`${x},${y}`);
    }
    return { points: pts.join(' ') };
  });

  // Static (full-radius) reference polygon — for the gridded outline.
  const referencePoints = React.useMemo(() => {
    return angles
      .map((a) => {
        const [x, y] = polarToCartesian(cx, cy, maxR, a);
        return `${x},${y}`;
      })
      .join(' ');
  }, [angles, cx, cy, maxR]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Concentric grid rings */}
        {gridLevels.map((lvl, idx) => {
          const pts = angles
            .map((a) => {
              const [x, y] = polarToCartesian(cx, cy, maxR * lvl, a);
              return `${x},${y}`;
            })
            .join(' ');
          return (
            <Polygon
              key={`ring-${idx}`}
              points={pts}
              fill="none"
              stroke={grid}
              strokeWidth={1}
              opacity={0.8}
            />
          );
        })}
        {/* Spokes */}
        {angles.map((a, i) => {
          const [x, y] = polarToCartesian(cx, cy, maxR, a);
          return <Line key={`spoke-${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke={grid} strokeWidth={1} />;
        })}
        {/* Outer reference polygon — slightly stronger */}
        <Polygon points={referencePoints} fill="none" stroke={grid} strokeWidth={1.5} />
        {/* Animated data polygon — fill + stroke */}
        <AnimatedPolygon
          animatedProps={animatedProps}
          fill={accent}
          fillOpacity={0.22}
          stroke={accent}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {/* Axis labels around the perimeter — placed at label radius (max + 18). */}
        <G>
          {angles.map((a, i) => {
            const labelR = maxR + 20;
            const [lx, ly] = polarToCartesian(cx, cy, labelR, a);
            // Decide text anchor based on horizontal position so labels don't bleed.
            const dx = Math.cos(a);
            let anchor: 'start' | 'middle' | 'end' = 'middle';
            if (dx > 0.3) anchor = 'start';
            else if (dx < -0.3) anchor = 'end';
            return (
              <SvgText
                key={`label-${i}`}
                x={lx}
                y={ly + 3}
                fontSize={11}
                fontWeight="600"
                fill={textColor}
                textAnchor={anchor}
              >
                {values[i].label}
              </SvgText>
            );
          })}
        </G>
      </Svg>

      {/* Numeric chips at the center — one summary number, the average. */}
      <View pointerEvents="none" style={styles.center}>
        <Text variant="caption" style={styles.centerCaption}>
          СРЕДНЕЕ
        </Text>
        <Text variant="display" style={styles.centerScore}>
          {Math.round(values.reduce((a, b) => a + b.value, 0) / N)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerCaption: { color: colors.gray[400], letterSpacing: 0.8 },
  centerScore: {
    fontVariant: ['tabular-nums'],
    fontSize: 28,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.8,
  },
});
