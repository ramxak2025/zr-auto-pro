/**
 * ReportRunScreen — универсальный экран одного отчёта конструктора.
 *
 * Параметр маршрута: `{ reportId }` из REPORT_CATALOG. Экран ничего не знает о
 * конкретном отчёте: описание (название, фильтр, группировки, методика) берёт
 * из каталога, а данные — единой структурой `ReportResult` из
 * GET /reports/builder/:reportId. Новый отчёт на сервере = новая строка в
 * каталоге, здесь правок не требуется.
 *
 * Как рендерится ReportResult. Весь экран — ОДИН вертикальный FlashList:
 *   ListHeader   → управление (пресеты периода, пейджер месяцев, произвольный
 *                  диапазон, сущностный фильтр с чипами, группировка, кнопка
 *                  «Сформировать»);
 *   items        → 'kpis' → 'table-header' (stickyHeaderIndices) → 'row'×N →
 *                  'totals' → секции ('section-title' / '-header' / '-row' /
 *                  '-totals' / '-empty') → 'method' → 'footer'.
 * Строки таблиц — элементы списка, поэтому 500 строк виртуализируются, а
 * горизонтальная прокрутка идёт через общий SharedValue таблицы (ReportTable).
 * Итог закрепляется оверлеем снизу, пока таблица не долистана (viewability).
 *
 * Запуск: авто — при смене пресета / месяца / фильтра / группировки; для
 * произвольного диапазона даты меняют черновик, а запрос уходит по кнопке
 * «Сформировать» (она же — принудительный refetch). Предыдущий результат
 * остаётся на экране, пока грузится новый (placeholderData), в подзаголовке —
 * «Обновляется…». Ошибки 400/403 показываются текстом сервера.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import IosScreenHeader from '../../components/IosScreenHeader';
import EmptyState from '../../components/EmptyState';
import QueryErrorState from '../../components/QueryErrorState';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import ProgressLoader from '../../components/ProgressLoader';
import { Button } from '../../components/Button';
import { Skeleton } from '../../components/Skeleton';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useIosSurface } from '../../platform/iosSurface';
import { reportBuilderApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useTenantTimezone } from '../../contexts/TenantTimezoneContext';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { borderRadius, colors, spacing } from '../../theme';
import { extractApiErrorMessage } from '../../utils/apiError';
import {
  describeReportFilters,
  formatReportDate,
  formatReportDateTime,
  mapReportHref,
  nextSortState,
  sortRows,
  type SortState,
} from '../../utils/reportFormat';
import { shareReportPdf } from '../../utils/reportPdf';
import { getReportDefinition, isReportId, type ReportDefinition } from '../../../../shared/reports/catalog';
import type {
  ReportColumnType,
  ReportFilterOptions,
  ReportId,
  ReportQuery,
  ReportResult,
  ReportRow,
  ReportSection,
} from '../../../../shared/types';
import { ReportKpiGrid } from './ReportKpiGrid';
import ReportFilterSheet from './ReportFilterSheet';
import { ReportDataRow, ReportHeaderRow, ReportTotalsRow, createTableModel, type TableModel } from './ReportTable';
import {
  PERIODS,
  formatPeriodLabel,
  getDateRange,
  monthIndex,
  monthRange,
  monthTitle,
  parseDateStr,
  periodError,
  shiftMonth,
  startOfMonth,
  toDateStr,
  type DateRange,
  type PeriodKey,
} from './reportPeriod';

export interface ReportRunParams {
  reportId: ReportId;
}

type ReportRunRoute = RouteProp<{ ReportRun: ReportRunParams | undefined }, 'ReportRun'>;

/** Глубина пейджера месяцев — два года отчётов назад. */
const MONTH_PAGER_DEPTH = 24;

type RunItem =
  | { key: string; type: 'kpis' }
  | { key: string; type: 'table-header' }
  | { key: string; type: 'row'; row: ReportRow; last: boolean }
  | { key: string; type: 'totals' }
  | { key: string; type: 'empty' }
  | { key: string; type: 'truncated' }
  | { key: string; type: 'section-title'; section: ReportSection }
  | { key: string; type: 'section-header'; section: ReportSection }
  | { key: string; type: 'section-row'; section: ReportSection; row: ReportRow; last: boolean }
  | { key: string; type: 'section-totals'; section: ReportSection }
  | { key: string; type: 'section-empty'; section: ReportSection }
  | { key: string; type: 'method' }
  | { key: string; type: 'footer' };

interface TableModels {
  main: TableModel;
  sections: Record<string, TableModel>;
}

function buildQuery(range: DateRange, ids: string[], groupBy: string | null): ReportQuery {
  return { dateFrom: range.from, dateTo: range.to, ids, groupBy };
}

function sameQuery(a: ReportQuery, b: ReportQuery): boolean {
  return (
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    (a.groupBy ?? null) === (b.groupBy ?? null) &&
    (a.ids ?? []).join(',') === (b.ids ?? []).join(',')
  );
}

function errorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

export default function ReportRunScreen() {
  const route = useRoute<ReportRunRoute>();
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const tabBarHeight = useTabBarHeight();
  const timeZone = useTenantTimezone();
  const { user } = useAuth();
  const { width: windowWidth } = useWindowDimensions();

  const reportId = route.params?.reportId;
  const def: ReportDefinition | null = useMemo(
    () => (isReportId(reportId) ? getReportDefinition(reportId) : null),
    [reportId],
  );

  // ── Состояние управления ────────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [customRange, setCustomRange] = useState<DateRange>(() => getDateRange('month'));
  const [showPicker, setShowPicker] = useState<null | 'from' | 'to'>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<string | null>(def?.groupByOptions?.[0]?.value ?? null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  // Сортировка доп. секций — своя на каждую, по ключу секции: тап по
  // заголовку секции не должен пересортировывать основную таблицу.
  const [sectionSort, setSectionSort] = useState<Record<string, SortState | null>>({});
  const [exporting, setExporting] = useState(false);
  const [pinnedTotals, setPinnedTotals] = useState(false);
  const listRef = useRef<FlashListRef<RunItem>>(null);

  const draftRange = useMemo<DateRange>(() => {
    if (period === 'custom') return customRange;
    if (period === 'month') return monthRange(monthCursor);
    return getDateRange(period);
  }, [period, customRange, monthCursor]);

  const draftError = periodError(draftRange);
  const selectedKey = selectedIds.join(',');

  const [runQuery, setRunQuery] = useState<ReportQuery>(() => buildQuery(draftRange, selectedIds, groupBy));

  // Авто-запуск: пресет / месяц / фильтр / группировка. Для произвольного
  // диапазона даты в ключ не входят — их применяет кнопка «Сформировать».
  const autoKey = `${period}|${period === 'custom' ? '' : `${draftRange.from}|${draftRange.to}`}|${selectedKey}|${groupBy ?? ''}`;
  useEffect(() => {
    setRunQuery((prev) => {
      const next = buildQuery(draftRange, selectedIds, groupBy);
      return sameQuery(prev, next) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  const runError = periodError({ from: runQuery.dateFrom, to: runQuery.dateTo });

  // ── Данные ──────────────────────────────────────────────────────────────
  const reportQuery = useQuery<ReportResult>({
    queryKey: [
      'report-run',
      def?.id ?? 'unknown',
      runQuery.dateFrom,
      runQuery.dateTo,
      (runQuery.ids ?? []).join(','),
      runQuery.groupBy ?? '',
    ],
    queryFn: async () => (await reportBuilderApi.run(def!.id, runQuery)).data,
    enabled: !!def && !runError,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const result = reportQuery.data;

  const filterKind = def?.entityFilter?.kind;
  const filterQuery = useQuery<ReportFilterOptions>({
    queryKey: ['report-filter-options', filterKind ?? 'none'],
    queryFn: async () => (await reportBuilderApi.filterOptions(filterKind!)).data,
    enabled: !!filterKind,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  const selectedLabels = useMemo(() => {
    const byId = new Map((filterQuery.data?.options ?? []).map((o) => [o.id, o.label]));
    return selectedIds.map((id) => byId.get(id) ?? null);
  }, [selectedIds, filterQuery.data]);

  // ── Модели таблиц и элементы списка ────────────────────────────────────
  const contentWidth = windowWidth - spacing[4] * 2;

  const models = useMemo<TableModels | null>(() => {
    if (!result) return null;
    const sections: Record<string, TableModel> = {};
    for (const s of result.sections ?? []) sections[s.key] = createTableModel(s.key, s.columns, contentWidth);
    return { main: createTableModel('main', result.columns, contentWidth), sections };
  }, [result, contentWidth]);

  const sortedRows = useMemo(() => (result ? sortRows(result.rows, result.columns, sort) : []), [result, sort]);

  const sortedSections = useMemo(() => {
    const out: Record<string, ReportRow[]> = {};
    for (const s of result?.sections ?? []) out[s.key] = sortRows(s.rows, s.columns, sectionSort[s.key] ?? null);
    return out;
  }, [result, sectionSort]);

  const items = useMemo<RunItem[]>(() => {
    if (!result) return [];
    const out: RunItem[] = [];
    if (result.kpis.length > 0) out.push({ key: 'kpis', type: 'kpis' });
    if (sortedRows.length === 0) {
      out.push({ key: 'empty', type: 'empty' });
    } else {
      out.push({ key: 'table-header', type: 'table-header' });
      sortedRows.forEach((row, i) => {
        out.push({
          key: `row-${String(row._id ?? i)}-${i}`,
          type: 'row',
          row,
          last: i === sortedRows.length - 1 && !result.totals,
        });
      });
      if (result.totals) out.push({ key: 'totals', type: 'totals' });
      if (result.meta?.truncated) out.push({ key: 'truncated', type: 'truncated' });
    }
    for (const section of result.sections ?? []) {
      out.push({ key: `st-${section.key}`, type: 'section-title', section });
      if (section.rows.length === 0) {
        out.push({ key: `se-${section.key}`, type: 'section-empty', section });
        continue;
      }
      out.push({ key: `sh-${section.key}`, type: 'section-header', section });
      const sectionRows = sortedSections[section.key] ?? section.rows;
      sectionRows.forEach((row, i) => {
        out.push({
          key: `sr-${section.key}-${String(row._id ?? i)}-${i}`,
          type: 'section-row',
          section,
          row,
          last: i === sectionRows.length - 1 && !section.totals,
        });
      });
      if (section.totals) out.push({ key: `stl-${section.key}`, type: 'section-totals', section });
    }
    if (def?.method || (result.notes?.length ?? 0) > 0) out.push({ key: 'method', type: 'method' });
    out.push({ key: 'footer', type: 'footer' });
    return out;
  }, [result, sortedRows, sortedSections, def]);

  const stickyIndex = useMemo(() => items.findIndex((i) => i.type === 'table-header'), [items]);
  const stickyHeaderIndices = useMemo(() => (stickyIndex >= 0 ? [stickyIndex] : undefined), [stickyIndex]);

  // ── Закреплённый итог (оверлей снизу, пока таблица не долистана) ─────────
  // Считаем по реальным координатам элементов (FlashList v2 `getLayout`), а не
  // по viewability: та включает overscan-окно и считала «видимыми» строки на
  // 200 pt ниже экрана. Оверлей нужен, когда заголовок таблицы уже выше нижней
  // кромки видимой области (над плавающим таб-баром), а строка итога — ещё нет.
  const totalsIndex = useMemo(() => items.findIndex((i) => i.type === 'totals'), [items]);
  const pinnedRef = useRef(false);
  const updatePinned = useCallback(() => {
    const list = listRef.current;
    let show = false;
    if (list && totalsIndex >= 0 && stickyIndex >= 0) {
      const header = list.getLayout(stickyIndex);
      const totals = list.getLayout(totalsIndex);
      const viewport = list.getWindowSize().height;
      if (header && totals && viewport > 0) {
        const visibleBottom = list.getAbsoluteLastScrollOffset() + viewport - tabBarHeight;
        show = header.y < visibleBottom && totals.y + totals.height > visibleBottom;
      }
    }
    if (show !== pinnedRef.current) {
      pinnedRef.current = show;
      setPinnedTotals(show);
    }
  }, [totalsIndex, stickyIndex, tabBarHeight]);

  useEffect(() => {
    // Новый результат: пересчитать после раскладки (getLayout знает позиции
    // только после первого рендера элементов).
    const t = setTimeout(updatePinned, 120);
    return () => clearTimeout(t);
  }, [updatePinned, result]);

  // ── Действия ────────────────────────────────────────────────────────────
  const handlePeriod = useCallback((key: PeriodKey) => {
    haptic('select');
    setPeriod(key);
  }, []);

  const handleSort = useCallback((key: string, type: ReportColumnType) => {
    haptic('select');
    setSort((prev) => nextSortState(prev, key, type));
  }, []);

  const handleSectionSort = useCallback((sectionKey: string, key: string, type: ReportColumnType) => {
    haptic('select');
    setSectionSort((prev) => ({ ...prev, [sectionKey]: nextSortState(prev[sectionKey] ?? null, key, type) }));
  }, []);

  // Колбэк на секцию — стабильный на время жизни результата: ReportHeaderRow
  // под memo, инлайн-стрелка в renderItem ломала бы мемоизацию заголовков.
  const sectionSortHandlers = useMemo(() => {
    const out: Record<string, (key: string, type: ReportColumnType) => void> = {};
    for (const s of result?.sections ?? []) out[s.key] = (key, type) => handleSectionSort(s.key, key, type);
    return out;
  }, [result, handleSectionSort]);

  const handleRowPress = useCallback(
    (row: ReportRow) => {
      const target = mapReportHref(row._href);
      if (target) navigation.navigate(target.name, target.params);
    },
    [navigation],
  );

  const handleRun = useCallback(() => {
    if (draftError) return;
    haptic('impact');
    const next = buildQuery(draftRange, selectedIds, groupBy);
    if (sameQuery(next, runQuery)) {
      void reportQuery.refetch();
    } else {
      setRunQuery(next);
    }
  }, [draftError, draftRange, selectedIds, groupBy, runQuery, reportQuery]);

  const periodLabel = formatPeriodLabel(period, draftRange);

  const handleExport = useCallback(async () => {
    if (!result || !def || exporting) return;
    haptic('tap');
    setExporting(true);
    try {
      await shareReportPdf(result, {
        companyName: result.meta?.companyName || user?.tenant?.name || null,
        periodLabel: formatPeriodLabel(period, { from: result.period.from, to: result.period.to }),
        entityLabel: def.entityFilter?.label ?? null,
        method: def.method,
        timeZone,
      });
    } finally {
      setExporting(false);
    }
  }, [result, def, exporting, user, period, timeZone]);

  const isAtCurrentMonth = monthIndex(monthCursor) === monthIndex(startOfMonth(new Date()));
  const isAtOldestMonth =
    monthIndex(monthCursor) <= monthIndex(shiftMonth(startOfMonth(new Date()), -MONTH_PAGER_DEPTH));

  // ── Рендер элементов ───────────────────────────────────────────────────
  const renderItem: ListRenderItem<RunItem> = useCallback(
    ({ item }) => {
      if (!result || !models) return null;
      switch (item.type) {
        case 'kpis':
          return (
            <View style={[styles.gutter, styles.kpiBlock]}>
              <ReportKpiGrid kpis={result.kpis} timeZone={timeZone} />
            </View>
          );
        case 'table-header':
          return (
            <View style={styles.gutter}>
              <ReportHeaderRow model={models.main} palette={palette} sort={sort} onSort={handleSort} />
            </View>
          );
        case 'row': {
          const linked = !!mapReportHref(item.row._href);
          return (
            <View style={styles.gutter}>
              <ReportDataRow
                model={models.main}
                row={item.row}
                palette={palette}
                last={item.last}
                timeZone={timeZone}
                onPress={linked ? handleRowPress : undefined}
              />
            </View>
          );
        }
        case 'totals':
          return (
            <View style={styles.gutter}>
              <ReportTotalsRow model={models.main} totals={result.totals!} palette={palette} timeZone={timeZone} />
            </View>
          );
        case 'empty':
          return (
            <EmptyState
              icon="chart-bar"
              title="Нет данных за период"
              description="За выбранный период нет проведённых чеков и операций. Попробуйте другой период или снимите фильтр."
            />
          );
        case 'truncated':
          return (
            <View style={[styles.gutter, styles.noteBlock]}>
              <Ionicons name="information-circle-outline" size={14} color={colors.amber[600]} />
              <Text variant="footnote" color={palette.text.secondary} style={styles.noteText}>
                Показаны первые {result.meta?.rowLimit ?? sortedRows.length} строк — сузьте период или фильтр, чтобы
                увидеть остальные.
              </Text>
            </View>
          );
        case 'section-title':
          return (
            <View style={[styles.gutter, styles.sectionTitle]}>
              <Text style={surface.sectionLabel}>{item.section.title}</Text>
              {item.section.description ? (
                <Text variant="footnote" color={palette.text.secondary} style={styles.sectionDescription}>
                  {item.section.description}
                </Text>
              ) : null}
            </View>
          );
        case 'section-header':
          return (
            <View style={styles.gutter}>
              <ReportHeaderRow
                model={models.sections[item.section.key]}
                palette={palette}
                sort={sectionSort[item.section.key] ?? null}
                onSort={sectionSortHandlers[item.section.key]}
              />
            </View>
          );
        case 'section-row': {
          const linked = !!mapReportHref(item.row._href);
          return (
            <View style={styles.gutter}>
              <ReportDataRow
                model={models.sections[item.section.key]}
                row={item.row}
                palette={palette}
                last={item.last}
                timeZone={timeZone}
                onPress={linked ? handleRowPress : undefined}
              />
            </View>
          );
        }
        case 'section-totals':
          return (
            <View style={styles.gutter}>
              <ReportTotalsRow
                model={models.sections[item.section.key]}
                totals={item.section.totals!}
                palette={palette}
                timeZone={timeZone}
              />
            </View>
          );
        case 'section-empty':
          return (
            <View
              style={[
                styles.gutter,
                styles.sectionEmpty,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ]}
            >
              <Text variant="footnote" color={palette.text.tertiary}>
                {item.section.emptyText || 'Нет данных за период'}
              </Text>
            </View>
          );
        case 'method':
          return (
            <View style={[styles.gutter, styles.methodBlock]}>
              <View style={[surface.card, styles.methodCard]}>
                <Text variant="title3" color={palette.text.primary}>
                  Методика
                </Text>
                {def?.method ? (
                  <Text variant="footnote" color={palette.text.secondary}>
                    {def.method}
                  </Text>
                ) : null}
                {(result.notes ?? []).filter(Boolean).map((note, i) => (
                  <View key={`${i}-${note}`} style={styles.noteRow}>
                    <Text variant="footnote" color={palette.text.tertiary}>
                      •
                    </Text>
                    <Text variant="footnote" color={palette.text.secondary} style={styles.noteText}>
                      {note}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          );
        case 'footer': {
          const point = result.meta?.pointName
            ? ` · филиал ${result.meta.pointName}`
            : result.meta?.scope === 'all'
              ? ' · все филиалы'
              : '';
          return (
            <View style={[styles.gutter, styles.footerBlock]}>
              <Text variant="caption" color={palette.text.tertiary} style={styles.footerText}>
                Сформирован {formatReportDateTime(result.generatedAt, timeZone)}
                {point}
              </Text>
            </View>
          );
        }
        default:
          return null;
      }
    },
    [
      result,
      models,
      palette,
      sort,
      sectionSort,
      sectionSortHandlers,
      handleSort,
      handleRowPress,
      timeZone,
      surface,
      def,
      sortedRows.length,
    ],
  );

  const extraData = useMemo(
    () => ({ sort, sectionSort, mode: palette.mode, models }),
    [sort, sectionSort, palette.mode, models],
  );

  // ── Управление (ListHeader) ─────────────────────────────────────────────
  const filterLabel = def?.entityFilter?.label ?? '';
  // Сущностный фильтр есть смысл показывать, только когда есть из чего
  // выбирать: own-scope пользователю сервер отдаёт одного его самого
  // (options.length === 1), с одним филиалом — один филиал. Пока справочник
  // не загружен — не рисуем (иначе кнопка мигнёт и исчезнет); не загрузился —
  // показываем, чтобы из шторки можно было «Повторить»; выбранные чипы видны
  // всегда, чтобы фильтр можно было снять.
  const filterOptionsCount = filterQuery.data?.options.length;
  const showEntityFilter =
    !!def?.entityFilter &&
    (selectedIds.length > 0 || (filterOptionsCount !== undefined ? filterOptionsCount > 1 : filterQuery.isError));
  const filterSummary =
    selectedIds.length === 0
      ? 'Все'
      : selectedLabels.every((l) => !!l)
        ? `${selectedIds.length}`
        : `${selectedIds.length}`;

  const controls = def ? (
    <View style={[styles.gutter, styles.controls]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.periodRow}
        keyboardShouldPersistTaps="handled"
      >
        {PERIODS.map((p) => {
          const active = period === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodChip, { backgroundColor: active ? palette.accent.primary : palette.bg.muted }]}
              onPress={() => handlePeriod(p.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.periodText, { color: active ? colors.white : palette.text.secondary }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {period === 'month' && (
        <View style={[styles.monthPagerRow, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            onPress={() => {
              haptic('select');
              setMonthCursor((c) => shiftMonth(c, -1));
            }}
            disabled={isAtOldestMonth}
            hitSlop={8}
            style={styles.monthPagerBtn}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Предыдущий месяц"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={palette.text.secondary}
              style={isAtOldestMonth && styles.disabled}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptic('select');
              setMonthCursor(startOfMonth(new Date()));
            }}
            disabled={isAtCurrentMonth}
            activeOpacity={0.7}
            style={styles.monthPagerLabelBtn}
            accessibilityRole="button"
            accessibilityLabel={
              isAtCurrentMonth
                ? `${monthTitle(monthCursor)} — текущий месяц`
                : `${monthTitle(monthCursor)}. Нажмите, чтобы вернуться к текущему месяцу`
            }
          >
            <Text style={[styles.monthPagerLabel, { color: palette.text.primary }]}>{monthTitle(monthCursor)}</Text>
            {!isAtCurrentMonth && (
              <Text style={[styles.monthPagerHint, { color: palette.text.tertiary }]}>к текущему</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptic('select');
              setMonthCursor((c) => shiftMonth(c, 1));
            }}
            disabled={isAtCurrentMonth}
            hitSlop={8}
            style={styles.monthPagerBtn}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Следующий месяц"
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.text.secondary}
              style={isAtCurrentMonth && styles.disabled}
            />
          </TouchableOpacity>
        </View>
      )}

      {period === 'custom' && (
        <View style={styles.customRangeRow}>
          <TouchableOpacity
            style={[styles.customDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => setShowPicker('from')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Начало периода: ${formatReportDate(customRange.from)}`}
          >
            <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
            <Text style={[styles.customDateText, { color: palette.text.primary }]}>
              {formatReportDate(customRange.from)}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.customDash, { color: palette.text.tertiary }]}>—</Text>
          <TouchableOpacity
            style={[styles.customDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => setShowPicker('to')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Конец периода: ${formatReportDate(customRange.to)}`}
          >
            <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
            <Text style={[styles.customDateText, { color: palette.text.primary }]}>
              {formatReportDate(customRange.to)}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {showEntityFilter && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={[
              styles.filterBtn,
              {
                backgroundColor: selectedIds.length > 0 ? palette.accent.primarySoft : palette.bg.card,
                borderColor: selectedIds.length > 0 ? palette.accent.primary : palette.border.subtle,
              },
            ]}
            onPress={() => {
              haptic('tap');
              setFilterOpen(true);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${filterLabel}: ${filterSummary}`}
          >
            <Ionicons
              name="funnel-outline"
              size={14}
              color={selectedIds.length > 0 ? palette.accent.primaryText : palette.text.secondary}
            />
            <Text
              style={[
                styles.filterBtnText,
                { color: selectedIds.length > 0 ? palette.accent.primaryText : palette.text.primary },
              ]}
            >
              {filterLabel} · {filterSummary}
            </Text>
            <Ionicons
              name="chevron-down"
              size={14}
              color={selectedIds.length > 0 ? palette.accent.primaryText : palette.text.tertiary}
            />
          </TouchableOpacity>
          {selectedIds.map((id, i) => (
            <TouchableOpacity
              key={id}
              style={[styles.selectedChip, { backgroundColor: palette.bg.muted }]}
              onPress={() => {
                haptic('tap');
                setSelectedIds((prev) => prev.filter((x) => x !== id));
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Убрать: ${selectedLabels[i] ?? id}`}
            >
              <Text style={[styles.selectedChipText, { color: palette.text.primary }]} numberOfLines={1}>
                {selectedLabels[i] ?? '…'}
              </Text>
              <Ionicons name="close-circle" size={15} color={palette.text.tertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {def.groupByOptions && def.groupByOptions.length > 1 && (
        <View style={[styles.segmentRow, { backgroundColor: palette.bg.muted }]}>
          {def.groupByOptions.map((opt) => {
            const active = (groupBy ?? def.groupByOptions![0].value) === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.segment, active && [styles.segmentActive, { backgroundColor: palette.bg.card }]]}
                onPress={() => {
                  haptic('select');
                  setGroupBy(opt.value);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? palette.text.primary : palette.text.secondary },
                    active && styles.segmentTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Button
        title="Сформировать"
        onPress={handleRun}
        loading={reportQuery.isFetching && !result}
        disabled={!!draftError}
        hapticIntent={null}
      />
      {draftError ? (
        <Text variant="footnote" color={colors.amber[600]} style={styles.errorHint}>
          {draftError}
        </Text>
      ) : null}
    </View>
  ) : null;

  // ── Пустые состояния списка ─────────────────────────────────────────────
  const listEmpty = !def ? null : reportQuery.isError && !result ? (
    <QueryErrorState
      title={errorStatus(reportQuery.error) === 403 ? 'Нет доступа к отчёту' : 'Не удалось сформировать отчёт'}
      description={extractApiErrorMessage(reportQuery.error, 'Проверьте соединение и попробуйте ещё раз')}
      onRetry={() => reportQuery.refetch()}
    />
  ) : runError ? null : (
    <View style={[styles.gutter, styles.skeleton]}>
      <View style={styles.skeletonGrid}>
        <Skeleton height={92} radius={borderRadius.xl} width="48%" />
        <Skeleton height={92} radius={borderRadius.xl} width="48%" />
        <Skeleton height={92} radius={borderRadius.xl} width="48%" />
        <Skeleton height={92} radius={borderRadius.xl} width="48%" />
      </View>
      <Skeleton height={46} radius={borderRadius.xl} />
      <Skeleton height={44} radius={6} />
      <Skeleton height={44} radius={6} />
      <Skeleton height={44} radius={6} />
      <Skeleton height={44} radius={6} />
    </View>
  );

  const subtitle = reportQuery.isFetching && result ? 'Обновляется…' : periodLabel;

  if (!def) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Отчёт" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="chart-bar"
          title="Отчёт не найден"
          description="Такого отчёта нет в каталоге. Обновите приложение."
        />
      </View>
    );
  }

  return (
    // GestureHandlerRootView — корень RNGH для Pan-жеста таблицы: у приложения
    // нет глобального корня RNGH (BottomSheet поднимает свой внутри Modal), без
    // него GestureDetector не распознаёт жесты (в dev — Render Error).
    <GestureHandlerRootView style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={def.title}
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: palette.bg.muted }, (!result || exporting) && styles.disabled]}
            onPress={handleExport}
            disabled={!result || exporting}
            accessibilityRole="button"
            accessibilityLabel="Экспорт в PDF"
          >
            <Ionicons name="share-outline" size={19} color={palette.text.primary} />
          </TouchableOpacity>
        }
      />

      <FlashList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        extraData={extraData}
        stickyHeaderIndices={stickyHeaderIndices}
        ListHeaderComponent={controls}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{
          paddingTop: spacing[1],
          paddingBottom: Platform.OS === 'android' ? tabBarHeight + spacing[6] : spacing[6],
        }}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        onScroll={updatePinned}
        scrollEventThrottle={32}
        onLoad={updatePinned}
        onRefresh={() => reportQuery.refetch()}
        refreshing={reportQuery.isFetching && !!result && !reportQuery.isPlaceholderData}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      {pinnedTotals && result?.totals && models && (
        <Animated.View
          entering={FadeInDown.duration(160)}
          exiting={FadeOutDown.duration(120)}
          pointerEvents="box-none"
          style={[
            styles.pinnedTotals,
            { bottom: tabBarHeight + spacing[2] },
            // Android рисует тень из `elevation` только у view с фоном: без него
            // оверлей «Итого» висел бы без тени. Фон тот же, что у строки итога,
            // и целиком под ней — на iOS ветка не активна.
            Platform.OS === 'android' ? { backgroundColor: palette.bg.muted } : null,
            surface.shadowElevated,
          ]}
        >
          <ReportTotalsRow
            model={models.main}
            totals={result.totals}
            palette={palette}
            corners="all"
            timeZone={timeZone}
          />
        </Animated.View>
      )}

      {def.entityFilter && (
        <ReportFilterSheet
          visible={filterOpen}
          onClose={() => setFilterOpen(false)}
          label={def.entityFilter.label}
          options={filterQuery.data?.options}
          loading={filterQuery.isLoading}
          error={filterQuery.isError}
          onRetry={() => filterQuery.refetch()}
          selectedIds={selectedIds}
          onApply={(ids) => {
            setSelectedIds(ids);
            setFilterOpen(false);
          }}
        />
      )}

      <DateTimePickerModal
        visible={showPicker === 'from'}
        value={parseDateStr(customRange.from)}
        mode="date"
        onConfirm={(d) => {
          setCustomRange((r) => ({ ...r, from: toDateStr(d) }));
          setShowPicker(null);
        }}
        onCancel={() => setShowPicker(null)}
      />
      <DateTimePickerModal
        visible={showPicker === 'to'}
        value={parseDateStr(customRange.to)}
        mode="date"
        onConfirm={(d) => {
          setCustomRange((r) => ({ ...r, to: toDateStr(d) }));
          setShowPicker(null);
        }}
        onCancel={() => setShowPicker(null)}
      />

      <ProgressLoader visible={exporting} title="Готовим PDF…" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gutter: { paddingHorizontal: spacing[4] },
  disabled: { opacity: 0.35 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Управление
  controls: { gap: spacing[2.5], paddingBottom: spacing[4] },
  periodRow: { gap: spacing[2], paddingRight: spacing[4] },
  periodChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], borderRadius: borderRadius.xl },
  periodText: { fontSize: 12, fontWeight: '600' },
  monthPagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1],
  },
  monthPagerBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthPagerLabelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36 },
  monthPagerLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, textAlign: 'center' },
  monthPagerHint: { fontSize: 10, marginTop: 1 },
  customRangeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  customDateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  customDateText: { fontSize: 14, fontWeight: '500' },
  customDash: { fontSize: 14 },
  filterRow: { gap: spacing[2], paddingRight: spacing[4], alignItems: 'center' },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  filterBtnText: { fontSize: 13, fontWeight: '600' },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingLeft: spacing[2.5],
    paddingRight: spacing[1.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    maxWidth: 200,
  },
  selectedChipText: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  segmentRow: { flexDirection: 'row', padding: 3, borderRadius: borderRadius.full },
  segment: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: borderRadius.full },
  segmentActive: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: { fontSize: 13, letterSpacing: -0.1 },
  segmentTextActive: { fontWeight: '700' },
  errorHint: { textAlign: 'center' },

  // Контент
  kpiBlock: { paddingBottom: spacing[4] },
  noteBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[1.5], paddingTop: spacing[2] },
  noteText: { flex: 1 },
  noteRow: { flexDirection: 'row', gap: spacing[1.5] },
  sectionTitle: { paddingTop: spacing[6], paddingBottom: spacing[1] },
  sectionDescription: { marginTop: -spacing[1], marginBottom: spacing[1] },
  sectionEmpty: {
    marginHorizontal: spacing[4],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  methodBlock: { paddingTop: spacing[6] },
  methodCard: { gap: spacing[2] },
  footerBlock: { paddingTop: spacing[4] },
  footerText: { textAlign: 'center' },
  skeleton: { gap: spacing[2] },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  pinnedTotals: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
});
