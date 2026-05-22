/**
 * YearHeatmap — GitHub-contributions-style 53×7 grid of activity squares
 * for an employee's last year. Cells are coloured by check count (or by
 * revenue if `metric="revenue"`).
 *
 * Tapping a cell shows a floating tooltip with the date and value above
 * the grid. We intentionally keep the tooltip in-component (no portal)
 * so it stays anchored to the chart card.
 *
 * The grid is rendered horizontally; the parent should wrap it in a
 * horizontal ScrollView to allow swiping through ~53 weeks.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text } from '../../platform/Typography';
import { colors, spacing } from '../../theme';

export interface HeatmapDay {
  day: string; // YYYY-MM-DD
  checks: number;
  revenue: number;
}

export interface YearHeatmapProps {
  data: HeatmapDay[];
  metric?: 'checks' | 'revenue';
  /** Cell width/height in pt. Default 11. */
  cellSize?: number;
  /** Gap between cells in pt. Default 3. */
  cellGap?: number;
  /** Brand accent for the darkest cells. */
  accent?: string;
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildWeeks(data: HeatmapDay[]): { cells: (HeatmapDay | null)[][]; monthLabels: { weekIdx: number; label: string }[] } {
  // Normalise input into a Map<YYYY-MM-DD, HeatmapDay>.
  const byDay = new Map<string, HeatmapDay>();
  data.forEach((d) => byDay.set(d.day, d));

  // Build a fixed 52-week window ending today, starting Monday-of-the-week 52 weeks ago.
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Start: 52 weeks ago, snapped to Monday.
  const start = new Date(end);
  start.setDate(end.getDate() - 52 * 7);
  const dow = (start.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  start.setDate(start.getDate() - dow);

  const weeks: (HeatmapDay | null)[][] = [];
  const monthLabels: { weekIdx: number; label: string }[] = [];
  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const cur = new Date(start);
  let lastMonth = -1;
  while (cur <= end) {
    const week: (HeatmapDay | null)[] = [];
    for (let i = 0; i < 7; i++) {
      if (cur > end) {
        week.push(null);
      } else {
        const key = ymd(cur);
        week.push(byDay.get(key) ?? { day: key, checks: 0, revenue: 0 });
      }
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
    // The "month label" goes on the week where the month changes (on the first day-of-month cell).
    const firstDay = week.find((c) => c !== null);
    if (firstDay) {
      const m = new Date(firstDay.day).getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ weekIdx: weeks.length - 1, label: monthNames[m] });
        lastMonth = m;
      }
    }
  }

  return { cells: weeks, monthLabels };
}

function colourFor(v: number, max: number, accent: string): string {
  if (max <= 0 || v <= 0) return 'rgba(15, 23, 42, 0.06)';
  const ratio = Math.min(1, v / max);
  // Use opacity steps for accent so dark mode passes naturally (we feed an rgba accent).
  if (ratio < 0.2) return tint(accent, 0.18);
  if (ratio < 0.4) return tint(accent, 0.35);
  if (ratio < 0.6) return tint(accent, 0.55);
  if (ratio < 0.85) return tint(accent, 0.78);
  return accent;
}

function tint(hex: string, alpha: number): string {
  // Hex (#RRGGBB) → rgba.
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace(/^#/, ''));
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatMoney(v: number): string {
  return `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function YearHeatmap({
  data,
  metric = 'checks',
  cellSize = 11,
  cellGap = 3,
  accent = colors.primary[500],
}: YearHeatmapProps) {
  const { cells, monthLabels } = React.useMemo(() => buildWeeks(data), [data]);
  const [selected, setSelected] = React.useState<HeatmapDay | null>(null);

  const max = React.useMemo(() => {
    let m = 0;
    cells.forEach((w) =>
      w.forEach((c) => {
        if (!c) return;
        const v = metric === 'checks' ? c.checks : c.revenue;
        if (v > m) m = v;
      }),
    );
    return m;
  }, [cells, metric]);

  const totalChecks = data.reduce((a, b) => a + b.checks, 0);
  const totalRevenue = data.reduce((a, b) => a + b.revenue, 0);

  const rowHeight = cellSize + cellGap;
  const colWidth = cellSize + cellGap;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollPad}>
        <View>
          {/* Month axis above the grid */}
          <View style={{ height: 18, position: 'relative' }}>
            {monthLabels.map((m, idx) => (
              <Text
                key={`${m.label}-${idx}`}
                variant="caption"
                style={[styles.monthLabel, { left: m.weekIdx * colWidth, color: colors.gray[500] }]}
              >
                {m.label}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((week, wi) => (
              <View key={`w-${wi}`} style={{ marginRight: cellGap }}>
                {week.map((cell, di) => {
                  const v = cell ? (metric === 'checks' ? cell.checks : cell.revenue) : 0;
                  const bg = colourFor(v, max, accent);
                  const isSelected = !!selected && !!cell && selected.day === cell.day;
                  return (
                    <Pressable
                      key={`d-${wi}-${di}`}
                      onPress={() => {
                        if (cell) setSelected(cell);
                      }}
                      hitSlop={4}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: bg,
                        borderRadius: 2,
                        marginBottom: di < 6 ? cellGap : 0,
                        opacity: cell ? 1 : 0,
                        borderWidth: isSelected ? 1 : 0,
                        borderColor: colors.primary[700],
                      }}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Footer: tap detail + legend */}
      <View style={styles.footer}>
        {selected ? (
          <Text variant="footnote" style={styles.tooltip}>
            {new Date(selected.day).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
            {' · '}
            <Text variant="footnote" style={styles.tooltipNum}>
              {selected.checks} чеков
            </Text>
            {' · '}
            <Text variant="footnote" style={styles.tooltipNum}>
              {formatMoney(selected.revenue)}
            </Text>
          </Text>
        ) : (
          <Text variant="footnote" style={[styles.tooltip, { color: colors.gray[400] }]}>
            Нажмите на день — увидите детали
          </Text>
        )}
        <View style={styles.legend}>
          <Text variant="caption" style={styles.legendLabel}>
            меньше
          </Text>
          {[0.18, 0.35, 0.55, 0.78, 1].map((a, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: tint(accent, a) }]} />
          ))}
          <Text variant="caption" style={styles.legendLabel}>
            больше
          </Text>
        </View>
      </View>

      <Text variant="footnote" style={[styles.summary, { marginTop: spacing[1.5] }]}>
        За год: <Text variant="footnote" style={styles.summaryNum}>{totalChecks} чеков</Text>
        {' · '}
        <Text variant="footnote" style={styles.summaryNum}>{formatMoney(totalRevenue)}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollPad: { paddingBottom: spacing[1] },
  grid: { flexDirection: 'row', alignItems: 'flex-start' },
  monthLabel: {
    position: 'absolute',
    top: 0,
    fontSize: 10,
  },
  footer: {
    marginTop: spacing[3],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  tooltip: { color: colors.gray[700], fontSize: 12, flexShrink: 1 },
  tooltipNum: { color: colors.gray[900], fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendCell: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { fontSize: 10, color: colors.gray[400] },
  summary: { color: colors.gray[600], fontSize: 12 },
  summaryNum: { color: colors.gray[900], fontWeight: '600' },
});
