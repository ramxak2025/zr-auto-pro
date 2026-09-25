/**
 * ReportTable — строки универсальной таблицы отчёта с закреплённой первой
 * колонкой и горизонтальной прокруткой остальных.
 *
 * АРХИТЕКТУРА. Таблица НЕ является вложенным списком: экран отчёта — один
 * вертикальный FlashList, а заголовок, строки и итог таблицы — его элементы
 * (виртуализация на 500 строк бесплатно). Горизонтальная прокрутка — не
 * ScrollView внутри каждой строки (это сотни нативных скроллов), а один
 * SharedValue `scrollX` на таблицу: каждая строка сдвигает свою «прокручиваемую»
 * часть на `-scrollX` через useAnimatedStyle, а Pan-жест на любой строке
 * двигает этот общий SharedValue на UI-потоке с инерцией (withDecay) и
 * резиновыми краями — как у нативного UIScrollView. Первая колонка не
 * сдвигается вовсе, поэтому она «липкая» без какой-либо синхронизации.
 *
 * Жест: activeOffsetX ±8 / failOffsetY ±10 — горизонтальное движение забирает
 * таблица, вертикальное отдаёт FlashList (тот же принцип, что у swipeable
 * строк). Тап по строке (переход по `_href`) и по заголовку (сортировка)
 * проходят через обычный Pressable — Pan без сдвига не активируется.
 *
 * Высоты строк фиксированы (TABLE_*_HEIGHT) — FlashList не перемеряет ячейки,
 * скролл ровный. Заголовок закрепляется сверху через stickyHeaderIndices
 * FlashList v2, итог — оверлеем снизу (см. ReportRunScreen).
 */
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from '../../platform/Typography';
import { SPRING_TIGHT } from '../../platform/motion';
import { haptic } from '../../platform/haptics';
import { borderRadius, colors, spacing } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import type { ReportColumn, ReportColumnType, ReportRow } from '../../../../shared/types';
import {
  cellAlign,
  formatCell,
  isNumericType,
  signedTone,
  visibleColumns,
  type SortState,
} from '../../utils/reportFormat';

export const TABLE_HEADER_HEIGHT = 46;
export const TABLE_ROW_HEIGHT = 44;
export const TABLE_TOTALS_HEIGHT = 48;

/** Базовая ширина колонки по типу (pt); `column.width` — множитель. */
const BASE_WIDTH: Record<ReportColumnType, number> = {
  text: 136,
  money: 112,
  number: 92,
  int: 78,
  percent: 84,
  date: 100,
  datetime: 128,
};

const HAIRLINE = StyleSheet.hairlineWidth;

export interface TableLayout {
  /** Видимые колонки (служебные `_`-ключи отброшены). */
  columns: ReportColumn[];
  /** Ширина закреплённой первой колонки. */
  stickyWidth: number;
  /** Ширины прокручиваемых колонок (columns[1..]). */
  widths: number[];
  /** Суммарная ширина прокручиваемой части. */
  scrollWidth: number;
  /** Видимая ширина прокручиваемой части. */
  viewport: number;
  /** Максимальный сдвиг (0 — таблица помещается целиком). */
  maxScroll: number;
}

export function buildTableLayout(allColumns: ReportColumn[], contentWidth: number): TableLayout {
  const columns = visibleColumns(allColumns);
  if (columns.length <= 1) {
    return { columns, stickyWidth: contentWidth, widths: [], scrollWidth: 0, viewport: 0, maxScroll: 0 };
  }
  const stickyWidth = Math.min(184, Math.max(124, Math.round(contentWidth * 0.4)));
  const viewport = Math.max(0, contentWidth - stickyWidth);
  let widths = columns.slice(1).map((c) => Math.round(BASE_WIDTH[c.type] * (c.width ?? 1)));
  let scrollWidth = widths.reduce((s, w) => s + w, 0);
  if (scrollWidth < viewport && scrollWidth > 0) {
    // Узкая таблица растягивается на всю карточку — без пустого поля справа.
    const k = viewport / scrollWidth;
    widths = widths.map((w) => Math.floor(w * k));
    scrollWidth = widths.reduce((s, w) => s + w, 0);
    widths[widths.length - 1] += viewport - scrollWidth;
    scrollWidth = viewport;
  }
  return { columns, stickyWidth, widths, scrollWidth, viewport, maxScroll: Math.max(0, scrollWidth - viewport) };
}

export interface TableModel {
  key: string;
  layout: TableLayout;
  /** Общий горизонтальный сдвиг всех строк таблицы. */
  scrollX: SharedValue<number>;
}

/** Модель таблицы создаётся в useMemo экрана — `makeMutable` не хук, поэтому их может быть сколько угодно (секции). */
export function createTableModel(key: string, columns: ReportColumn[], contentWidth: number): TableModel {
  return { key, layout: buildTableLayout(columns, contentWidth), scrollX: makeMutable(0) };
}

// ── Жест горизонтальной прокрутки ───────────────────────────────────────────

function useRowPan(model: TableModel) {
  const startX = useSharedValue(0);
  const { scrollX } = model;
  const max = model.layout.maxScroll;
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(max > 0)
        .activeOffsetX([-8, 8])
        .failOffsetY([-10, 10])
        .onBegin(() => {
          cancelAnimation(scrollX);
        })
        .onStart(() => {
          startX.value = scrollX.value;
        })
        .onUpdate((e) => {
          const raw = startX.value - e.translationX;
          if (raw < 0) scrollX.value = raw * 0.35;
          else if (raw > max) scrollX.value = max + (raw - max) * 0.35;
          else scrollX.value = raw;
        })
        .onEnd((e) => {
          if (scrollX.value < 0) {
            scrollX.value = withSpring(0, SPRING_TIGHT);
            return;
          }
          if (scrollX.value > max) {
            scrollX.value = withSpring(max, SPRING_TIGHT);
            return;
          }
          scrollX.value = withDecay({
            velocity: -e.velocityX,
            clamp: [0, max],
            rubberBandEffect: true,
            rubberBandFactor: 0.6,
          });
        }),
    [scrollX, max, startX],
  );
}

// ── Оболочка строки: sticky-ячейка + прокручиваемая часть ──────────────────

type Corners = 'top' | 'bottom' | 'all' | 'none';

interface RowShellProps {
  model: TableModel;
  height: number;
  palette: SemanticPalette;
  background: string;
  corners?: Corners;
  /** Верхняя граница строки (итог). */
  topBorder?: boolean;
  /** Нижний волосок (разделитель строк). */
  bottomBorder?: boolean;
  sticky: React.ReactNode;
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

function cornerStyle(corners: Corners) {
  const r = borderRadius.xl;
  switch (corners) {
    case 'top':
      return { borderTopLeftRadius: r, borderTopRightRadius: r };
    case 'bottom':
      return { borderBottomLeftRadius: r, borderBottomRightRadius: r };
    case 'all':
      return { borderRadius: r };
    default:
      return null;
  }
}

function RowShell({
  model,
  height,
  palette,
  background,
  corners = 'none',
  topBorder,
  bottomBorder,
  sticky,
  children,
  onPress,
  accessibilityLabel,
}: RowShellProps) {
  const pan = useRowPan(model);
  const { layout } = model;
  const scrollStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -model.scrollX.value }] }));
  const edgeShadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(model.scrollX.value, [0, 16], [0, 1], Extrapolation.CLAMP),
  }));

  const content = (
    <View
      style={[
        styles.row,
        cornerStyle(corners),
        {
          height,
          backgroundColor: background,
          borderColor: palette.border.subtle,
          borderTopWidth: topBorder ? 1 : corners === 'top' || corners === 'all' ? HAIRLINE : 0,
          borderTopColor: topBorder ? palette.border.strong : palette.border.subtle,
          borderBottomWidth: bottomBorder || corners === 'bottom' || corners === 'all' ? HAIRLINE : 0,
        },
      ]}
    >
      <View style={[styles.sticky, { width: layout.stickyWidth }]}>{sticky}</View>
      {layout.widths.length > 0 && (
        <View style={styles.viewport}>
          <Animated.View style={[styles.scrollRow, { width: layout.scrollWidth }, scrollStyle]}>
            {children}
          </Animated.View>
        </View>
      )}
      {layout.maxScroll > 0 && (
        <Animated.View pointerEvents="none" style={[styles.edgeShadow, { left: layout.stickyWidth }, edgeShadowStyle]}>
          <LinearGradient
            colors={[palette.mode === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.10)', 'rgba(0,0,0,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );

  return (
    <GestureDetector gesture={pan}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </GestureDetector>
  );
}

// ── Ячейки ──────────────────────────────────────────────────────────────────

function alignToFlex(align: 'left' | 'right' | 'center'): 'flex-start' | 'flex-end' | 'center' {
  return align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
}

interface CellProps {
  width?: number;
  align: 'left' | 'right' | 'center';
  text: string;
  color: string;
  numeric: boolean;
  bold?: boolean;
  flex?: boolean;
}

const Cell = memo(function Cell({ width, align, text, color, numeric, bold, flex }: CellProps) {
  return (
    <View style={[styles.cell, flex ? styles.cellFlex : { width }, { alignItems: alignToFlex(align) }]}>
      <Text
        numberOfLines={1}
        style={[styles.cellText, numeric && styles.tabular, bold && styles.cellTextBold, { color }]}
      >
        {text}
      </Text>
    </View>
  );
});

function signedColor(column: ReportColumn, value: ReportRow[string] | undefined, palette: SemanticPalette): string {
  if (!column.signed) return palette.text.primary;
  const tone = signedTone(value);
  if (tone === 'positive') return palette.mode === 'dark' ? colors.green[400] : colors.green[600];
  if (tone === 'negative') return palette.mode === 'dark' ? colors.red[400] : colors.red[500];
  return palette.text.primary;
}

function rowToneBackground(tone: ReportRow[string] | undefined, palette: SemanticPalette): string {
  const dark = palette.mode === 'dark';
  switch (tone) {
    case 'positive':
      return dark ? 'rgba(34,197,94,0.12)' : colors.green[50];
    case 'negative':
      return dark ? 'rgba(239,68,68,0.12)' : colors.red[50];
    case 'warning':
      return dark ? 'rgba(245,158,11,0.14)' : colors.amber[50];
    default:
      return palette.bg.card;
  }
}

// ── Заголовок ───────────────────────────────────────────────────────────────

interface HeaderCellProps {
  column: ReportColumn;
  width?: number;
  flex?: boolean;
  active: SortState | null;
  palette: SemanticPalette;
  onPress: (key: string, type: ReportColumnType) => void;
}

const HeaderCell = memo(function HeaderCell({ column, width, flex, active, palette, onPress }: HeaderCellProps) {
  const isActive = active?.key === column.key;
  const align = cellAlign(column);
  const color = isActive ? palette.accent.primary : palette.text.secondary;
  return (
    <Pressable
      onPress={() => onPress(column.key, column.type)}
      style={[styles.cell, styles.headerCell, flex ? styles.cellFlex : { width }, { alignItems: alignToFlex(align) }]}
      accessibilityRole="button"
      accessibilityLabel={`Сортировать по: ${column.title}`}
      accessibilityHint={column.hint}
      hitSlop={{ top: 4, bottom: 4 }}
    >
      <View style={[styles.headerInner, align === 'right' && styles.headerInnerRight]}>
        {isActive && align === 'right' ? (
          <Ionicons name={active?.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={11} color={color} />
        ) : null}
        <Text numberOfLines={2} style={[styles.headerText, { color, textAlign: align }]}>
          {column.title}
        </Text>
        {isActive && align !== 'right' ? (
          <Ionicons name={active?.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={11} color={color} />
        ) : null}
      </View>
    </Pressable>
  );
});

interface ReportHeaderRowProps {
  model: TableModel;
  palette: SemanticPalette;
  sort: SortState | null;
  onSort: (key: string, type: ReportColumnType) => void;
  corners?: Corners;
}

export const ReportHeaderRow = memo(function ReportHeaderRow({
  model,
  palette,
  sort,
  onSort,
  corners = 'top',
}: ReportHeaderRowProps) {
  const { columns, widths } = model.layout;
  if (columns.length === 0) return null;
  const [first, ...rest] = columns;
  return (
    <RowShell
      model={model}
      height={TABLE_HEADER_HEIGHT}
      palette={palette}
      background={palette.bg.muted}
      corners={corners}
      bottomBorder
      sticky={<HeaderCell column={first} flex active={sort} palette={palette} onPress={onSort} />}
    >
      {rest.map((c, i) => (
        <HeaderCell key={c.key} column={c} width={widths[i]} active={sort} palette={palette} onPress={onSort} />
      ))}
    </RowShell>
  );
});

// ── Строка данных ───────────────────────────────────────────────────────────

interface ReportDataRowProps {
  model: TableModel;
  row: ReportRow;
  palette: SemanticPalette;
  /** Последняя строка таблицы без итога — скругляем низ. */
  last?: boolean;
  timeZone?: string | null;
  onPress?: (row: ReportRow) => void;
}

export const ReportDataRow = memo(function ReportDataRow({
  model,
  row,
  palette,
  last,
  timeZone,
  onPress,
}: ReportDataRowProps) {
  const { columns, widths } = model.layout;
  const texts = useMemo(
    () => columns.map((c) => formatCell(row[c.key], c.type, { timeZone })),
    [columns, row, timeZone],
  );
  if (columns.length === 0) return null;
  const [first, ...rest] = columns;
  const tappable = !!onPress;
  const firstColor = tappable ? palette.accent.primaryText : signedColor(first, row[first.key], palette);
  return (
    <RowShell
      model={model}
      height={TABLE_ROW_HEIGHT}
      palette={palette}
      background={rowToneBackground(row._tone, palette)}
      corners={last ? 'bottom' : 'none'}
      bottomBorder={!last}
      onPress={
        tappable
          ? () => {
              haptic('tap');
              onPress(row);
            }
          : undefined
      }
      accessibilityLabel={tappable ? `Открыть: ${texts[0]}` : undefined}
      sticky={
        <Cell
          flex
          align={cellAlign(first)}
          text={texts[0]}
          color={firstColor}
          numeric={isNumericType(first.type)}
          bold={tappable}
        />
      }
    >
      {rest.map((c, i) => (
        <Cell
          key={c.key}
          width={widths[i]}
          align={cellAlign(c)}
          text={texts[i + 1]}
          color={signedColor(c, row[c.key], palette)}
          numeric={isNumericType(c.type)}
        />
      ))}
    </RowShell>
  );
});

// ── Итог ────────────────────────────────────────────────────────────────────

interface ReportTotalsRowProps {
  model: TableModel;
  totals: ReportRow;
  palette: SemanticPalette;
  corners?: Corners;
  timeZone?: string | null;
}

export const ReportTotalsRow = memo(function ReportTotalsRow({
  model,
  totals,
  palette,
  corners = 'bottom',
  timeZone,
}: ReportTotalsRowProps) {
  const { columns, widths } = model.layout;
  const texts = useMemo(
    () =>
      columns.map((c, i) => {
        const raw = totals[c.key];
        if (i === 0 && (raw === null || raw === undefined || raw === '')) return 'Итого';
        return formatCell(raw, c.type, { timeZone });
      }),
    [columns, totals, timeZone],
  );
  if (columns.length === 0) return null;
  const [first, ...rest] = columns;
  return (
    <RowShell
      model={model}
      height={TABLE_TOTALS_HEIGHT}
      palette={palette}
      background={palette.bg.muted}
      corners={corners}
      topBorder
      sticky={
        <Cell
          flex
          align={cellAlign(first)}
          text={texts[0]}
          color={signedColor(first, totals[first.key], palette)}
          numeric={isNumericType(first.type)}
          bold
        />
      }
    >
      {rest.map((c, i) => (
        <Cell
          key={c.key}
          width={widths[i]}
          align={cellAlign(c)}
          text={texts[i + 1]}
          color={signedColor(c, totals[c.key], palette)}
          numeric={isNumericType(c.type)}
          bold
        />
      ))}
    </RowShell>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderLeftWidth: HAIRLINE,
    borderRightWidth: HAIRLINE,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.7 },
  sticky: {
    height: '100%',
    justifyContent: 'center',
  },
  viewport: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
  },
  scrollRow: {
    flexDirection: 'row',
    height: '100%',
  },
  edgeShadow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 10,
  },
  cell: {
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: spacing[2.5],
  },
  cellFlex: { flex: 1 },
  cellText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
  },
  cellTextBold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
  headerCell: {
    paddingHorizontal: spacing[2.5],
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: '100%',
  },
  headerInnerRight: { justifyContent: 'flex-end' },
  headerText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
});
