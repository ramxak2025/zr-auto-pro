/**
 * ReportKpiGrid — крупные цифры над таблицей отчёта (`ReportResult.kpis`).
 *
 * Плитки по две в ряд; значение форматируется по `type` (деньги / проценты /
 * счётчик) тем же reportFormat, что и таблица с PDF. `tone` красит число,
 * `deltaPercent` — пилюля со стрелкой «к прошлому периоду». Подсказка `hint`
 * открывается тапом по плитке (Alert): в две строки на плитке она не влезает,
 * а владельцу нужна редко — когда цифра удивила.
 */
import React, { memo, useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { PressableScale } from '../../platform/PressableScale';
import { useColors } from '../../contexts/ThemeContext';
import { borderRadius, colors, getBadgeColors, spacing } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import type { ReportKpi, ReportTone } from '../../../../shared/types';
import { formatCell, formatReportPercent } from '../../utils/reportFormat';

export function toneColor(tone: ReportTone | undefined, palette: SemanticPalette): string {
  switch (tone) {
    case 'positive':
      return palette.mode === 'dark' ? colors.green[400] : colors.green[600];
    case 'negative':
      return palette.mode === 'dark' ? colors.red[400] : colors.red[500];
    case 'warning':
      return palette.mode === 'dark' ? colors.amber[200] : colors.amber[600];
    default:
      return palette.text.primary;
  }
}

interface DeltaPillProps {
  value: number;
  palette: SemanticPalette;
}

function DeltaPill({ value, palette }: DeltaPillProps) {
  const badges = getBadgeColors(palette.mode);
  const badge = value > 0 ? badges.green : value < 0 ? badges.red : badges.gray;
  const icon = value > 0 ? 'arrow-up' : value < 0 ? 'arrow-down' : null;
  return (
    <View style={[styles.delta, { backgroundColor: badge.bg }]}>
      {icon ? <Ionicons name={icon} size={10} color={badge.text} /> : null}
      <Text style={[styles.deltaText, { color: badge.text }]} numberOfLines={1}>
        {formatReportPercent(Math.abs(value))}
      </Text>
    </View>
  );
}

interface KpiTileProps {
  kpi: ReportKpi;
  palette: SemanticPalette;
  timeZone?: string | null;
}

const KpiTile = memo(function KpiTile({ kpi, palette, timeZone }: KpiTileProps) {
  const value = useMemo(() => formatCell(kpi.value, kpi.type, { timeZone }), [kpi.value, kpi.type, timeZone]);
  const hasDelta = typeof kpi.deltaPercent === 'number' && Number.isFinite(kpi.deltaPercent);
  const body = (
    <>
      <Text variant="caption" color={palette.text.secondary} numberOfLines={2} style={styles.title}>
        {kpi.title}
      </Text>
      <Text
        style={[styles.value, { color: toneColor(kpi.tone, palette) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
      >
        {value}
      </Text>
      <View style={styles.footer}>
        {hasDelta ? (
          <DeltaPill value={kpi.deltaPercent as number} palette={palette} />
        ) : (
          <View style={styles.deltaGhost} />
        )}
        {kpi.hint ? <Ionicons name="information-circle-outline" size={14} color={palette.text.tertiary} /> : null}
      </View>
    </>
  );
  const tileStyle = [styles.tile, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }];
  if (!kpi.hint) return <View style={tileStyle}>{body}</View>;
  return (
    <PressableScale
      style={tileStyle}
      hapticIntent="tap"
      onPress={() => Alert.alert(kpi.title, kpi.hint)}
      accessibilityRole="button"
      accessibilityLabel={`${kpi.title}: ${value}. Подсказка`}
    >
      {body}
    </PressableScale>
  );
});

interface ReportKpiGridProps {
  kpis: ReportKpi[];
  timeZone?: string | null;
}

export const ReportKpiGrid = memo(function ReportKpiGrid({ kpis, timeZone }: ReportKpiGridProps) {
  const palette = useColors();
  if (kpis.length === 0) return null;
  return (
    <View style={styles.grid}>
      {kpis.map((k) => (
        <KpiTile key={k.key} kpi={k} palette={palette} timeZone={timeZone} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2.5],
    paddingBottom: spacing[2.5],
    gap: spacing[1],
    minHeight: 92,
  },
  title: {
    minHeight: 28,
  },
  value: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 18,
  },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
  },
  deltaGhost: { height: 18 },
  deltaText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
