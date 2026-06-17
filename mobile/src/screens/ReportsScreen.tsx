/**
 * ReportsScreen — финансовый отчёт-центр.
 *
 * Это НЕ дашборд (дашборд показывает оперативную картину дня), а ОТЧЁТНОЕ
 * центральное место для владельца: чистая прибыль, P&L, маржинальность,
 * расходы по категориям, личные рекорды, тренды YoY, KPI-цели в стиле
 * Apple Activity Rings, AI-инсайты, прогноз и алерты.
 *
 * Все нефинансовые виджеты (склад / клиенты / маркетинг / сотрудники)
 * сознательно вынесены. Если владельцу нужна склад/клиентская аналитика —
 * она живёт в DashboardScreen и в Warehouse-аналитике, не здесь.
 *
 * Контракт с бэком: используем уже существующие endpoint'ы —
 * `reports/financial`, `reports/dashboard-v2`, `reports/defect-writeoff`.
 * Никаких новых полей не вводим.
 *
 * Экспорт: PDF — через expo-print; «Поделиться картинкой» — через
 * react-native-view-shot + expo-sharing. expo-file-system не подключён,
 * поэтому «Excel» собирается в виде CSV-like табличного PDF («Скачать
 * таблицу») — это честнее, чем подсовывать .pdf под маской .csv.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal as RNModal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop, Circle, G } from 'react-native-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportsApi, expensesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import FreshnessBadge from '../components/FreshnessBadge';
import DateTimePickerModal from '../components/DateTimePickerModal';
import ProgressLoader from '../components/ProgressLoader';
import ModalBlurBackdrop from '../components/ModalBlurBackdrop';
import {
  StoriesShareCard,
  STORIES_EXPORT_WIDTH,
  STORIES_EXPORT_HEIGHT,
  type StoriesShareCardData,
} from '../components/StoriesShareCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { toLocalISODate } from '../utils/dates';
import type { FinancialReport, DashboardV2 } from '../../../shared/types';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ─────────────────────────────────────────────────────────────────────────────
//  Money / date helpers — единый источник правды по форматированию.
// ─────────────────────────────────────────────────────────────────────────────

function formatMoney(v: number): string {
  const abs = Math.abs(Math.round(v));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${formatted} ₽`;
}

/** Компактная форма для крупных цифр: 1.2M / 234k. */
function formatMoneyCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}M ₽`;
  if (abs >= 100_000) return `${Math.round(v / 1000)}k ₽`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(1).replace('.0', '')}k ₽`;
  return `${Math.round(v)} ₽`;
}

function toDateStr(d: Date): string {
  // LOCAL date, not toISOString() (UTC): в RU-зонах (UTC+3…+12) UTC-срез
  // после местной полуночи давал ВЧЕРАШНИЙ день — все финансовые периоды
  // («Сегодня», начало месяца/квартала/года) съезжали на сутки.
  // parseDateStr ниже тоже локальный → round-trip симметричен.
  return toLocalISODate(d);
}

function parseDateStr(s: string): Date {
  // YYYY-MM-DD → Date в локальной зоне (без сдвига UTC, как у Date(string)).
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function pctOf(part: number, total: number): string {
  if (total <= 0) return '0';
  return ((part / total) * 100).toFixed(1);
}

function deltaPct(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Period switcher — 7 пресетов + произвольный диапазон.
// ─────────────────────────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'custom', label: 'Произвольный' },
];

interface DateRange {
  from: string;
  to: string;
}

function getDateRange(period: PeriodKey, custom?: DateRange): DateRange {
  const now = new Date();
  const today = toDateStr(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const ys = toDateStr(y);
    return { from: ys, to: ys };
  }
  if (period === 'week') {
    // ISO неделя — понедельник = начало.
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toDateStr(monday), to: today };
  }
  if (period === 'month') {
    return { from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (period === 'quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { from: toDateStr(new Date(now.getFullYear(), qStartMonth, 1)), to: today };
  }
  if (period === 'year') {
    return { from: toDateStr(new Date(now.getFullYear(), 0, 1)), to: today };
  }
  return custom ?? { from: today, to: today };
}

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const RU_MONTHS_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/** Человекочитаемый ярлык периода для шеринга / PDF («Май 2026», «1 — 30 мая»). */
function formatPeriodLabel(period: PeriodKey, range: DateRange): string {
  const from = parseDateStr(range.from);
  const to = parseDateStr(range.to);
  if (period === 'today') return `Сегодня · ${from.getDate()} ${RU_MONTHS[from.getMonth()]}`;
  if (period === 'yesterday') return `Вчера · ${from.getDate()} ${RU_MONTHS[from.getMonth()]}`;
  if (period === 'month') return `${RU_MONTHS_NOM[to.getMonth()]} ${to.getFullYear()}`;
  if (period === 'year') return `${to.getFullYear()} год`;
  if (period === 'quarter') {
    const q = Math.floor(to.getMonth() / 3) + 1;
    return `${q} квартал ${to.getFullYear()}`;
  }
  // week / custom → диапазон дат
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (sameMonth) return `${from.getDate()} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
  return `${from.getDate()} ${RU_MONTHS[from.getMonth()]} — ${to.getDate()} ${RU_MONTHS[to.getMonth()]} ${to.getFullYear()}`;
}

/**
 * Сдвинуть диапазон на ту же длину назад — для блока "Сравнить с".
 * Длина считается в днях, чтобы для произвольного диапазона работало
 * предсказуемо.
 */
function getPreviousRange(range: DateRange): DateRange {
  const from = parseDateStr(range.from);
  const to = parseDateStr(range.to);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const prevTo = new Date(from);
  prevTo.setDate(from.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - (days - 1));
  return { from: toDateStr(prevFrom), to: toDateStr(prevTo) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sparkline helpers — те же кривые Безье что в DashboardScreen, но
//  выделены сюда чтобы Reports не зависел от Dashboard.
// ─────────────────────────────────────────────────────────────────────────────

function buildSparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - 3 - ((v - min) / range) * (h - 6),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function buildSparkArea(values: number[], w: number, h: number): string {
  const line = buildSparkPath(values, w, h);
  if (!line) return '';
  return `${line} L ${w} ${h} L 0 ${h} Z`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  KPI цели — хранятся в AsyncStorage. Не лезем в backend ради одного
//  виджета: цели — личная настройка владельца, не часть API-контракта.
// ─────────────────────────────────────────────────────────────────────────────

const KPI_TARGETS_KEY = 'reports.kpiTargets.v1';

interface KpiTargets {
  revenueMonth: number;
  marginPct: number;
  netProfitMonth: number;
}

const DEFAULT_TARGETS: KpiTargets = {
  revenueMonth: 2_000_000,
  marginPct: 25,
  netProfitMonth: 500_000,
};

function useKpiTargets() {
  const [targets, setTargets] = useState<KpiTargets>(DEFAULT_TARGETS);

  // Загрузка происходит асинхронно. До первой записи показываем
  // дефолты — это лучше, чем держать кольца пустыми.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KPI_TARGETS_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Partial<KpiTargets>;
          setTargets({
            revenueMonth: Number(parsed.revenueMonth) || DEFAULT_TARGETS.revenueMonth,
            marginPct: Number(parsed.marginPct) || DEFAULT_TARGETS.marginPct,
            netProfitMonth: Number(parsed.netProfitMonth) || DEFAULT_TARGETS.netProfitMonth,
          });
        } catch {
          /* swallow parse error — упадём на дефолты */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: KpiTargets) => {
    setTargets(next);
    try {
      await AsyncStorage.setItem(KPI_TARGETS_KEY, JSON.stringify(next));
    } catch {
      /* AsyncStorage в принципе не должен падать здесь, но если — UI уже
         обновлён через setTargets, потеряется только персистентность. */
    }
  }, []);

  return { targets, save };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Активити-кольца (Apple style) — три концентрических дуги.
// ─────────────────────────────────────────────────────────────────────────────

function ActivityRing({
  size,
  strokeWidth,
  values,
}: {
  size: number;
  strokeWidth: number;
  values: { color: string; track: string; pct: number }[];
}) {
  const gap = 4;
  const half = size / 2;
  return (
    <Svg width={size} height={size}>
      {values.map((v, i) => {
        const r = half - strokeWidth / 2 - i * (strokeWidth + gap);
        if (r <= 0) return null;
        const C = 2 * Math.PI * r;
        const progress = Math.max(0, Math.min(1, v.pct / 100));
        const dash = C * Math.min(0.999, progress);
        return (
          <G key={i} rotation="-90" origin={`${half}, ${half}`}>
            <Circle cx={half} cy={half} r={r} stroke={v.track} strokeWidth={strokeWidth} fill="none" />
            <Circle
              cx={half}
              cy={half}
              r={r}
              stroke={v.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${dash}, ${C}`}
              strokeLinecap="round"
            />
          </G>
        );
      })}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const navigation = useNavigation<any>();
  const { hasPermission, user } = useAuth();
  const palette = useColors();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const canView = hasPermission('financial_reports');

  // Non-collapsible wrapper around the report content. Previously used as a
  // capture source; the share image is now the purpose-made Stories card, so
  // this just keeps the content tree stable for layout.
  const captureViewRef = useRef<View>(null);
  // Off-screen Stories card — captured to a 1080×1920 PNG for sharing.
  const storiesCardRef = useRef<View>(null);
  // Safety-timeout handle for export overlays — guarantees the loader can
  // never get stuck if a native share call hangs or never resolves.
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customRange, setCustomRange] = useState<DateRange>(() => getDateRange('month'));
  const [showCustomPicker, setShowCustomPicker] = useState<null | 'from' | 'to'>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [pnlOpen, setPnlOpen] = useState(false);
  // Export-in-progress overlay. The HTML build + PDF rasterisation can take
  // 1-3s on real devices; we surface a premium ProgressLoader instead of
  // letting the user think the app froze.
  const [exporting, setExporting] = useState<null | 'pdf' | 'table' | 'image'>(null);
  // PERF: the 1080×1920 Stories card is mounted ON DEMAND only — see
  // exportImage(). Keeping it mounted off-screen at all times held a giant
  // offscreen surface (LinearGradient + SVG) for the whole life of the
  // Reports screen, costing memory + a layout pass every render. We now flip
  // this true just before capture and back to false right after.
  const [showStoriesCard, setShowStoriesCard] = useState(false);

  const range = useMemo<DateRange>(
    () => (period === 'custom' ? customRange : getDateRange(period)),
    [period, customRange],
  );
  const prevRange = useMemo<DateRange>(() => getPreviousRange(range), [range]);

  const { targets, save: saveTargets } = useKpiTargets();

  // ── ОСНОВНЫЕ ЗАПРОСЫ ──────────────────────────────────────────────────────
  // FinancialReport за текущий период
  const financialQuery = useQuery<FinancialReport>({
    queryKey: ['financial-report', range.from, range.to],
    queryFn: async () => (await reportsApi.getFinancial({ dateFrom: range.from, dateTo: range.to })).data,
    enabled: canView,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  // FinancialReport за предыдущий период — нужен только если включено сравнение
  const prevFinancialQuery = useQuery<FinancialReport>({
    queryKey: ['financial-report', prevRange.from, prevRange.to],
    queryFn: async () => (await reportsApi.getFinancial({ dateFrom: prevRange.from, dateTo: prevRange.to })).data,
    enabled: canView && compareEnabled,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  // Dashboard V2 для marginSpark, personalRecord, monthForecast.
  // Используем period='month' как канонический — это месячные показатели.
  const dashboardQuery = useQuery<DashboardV2>({
    queryKey: ['dashboard-v2', 'month'],
    queryFn: async () => (await reportsApi.dashboardV2({ period: 'month' })).data,
    enabled: canView,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  // YoY: текущие 12 мес и предыдущие 12 — два FinancialReport.
  const now = new Date();
  const yoyCurrFrom = toDateStr(new Date(now.getFullYear() - 1, now.getMonth() + 1, 1));
  const yoyCurrTo = toDateStr(now);
  const yoyPrevFrom = toDateStr(new Date(now.getFullYear() - 2, now.getMonth() + 1, 1));
  const yoyPrevTo = toDateStr(new Date(now.getFullYear() - 1, now.getMonth(), 0));
  const yoyCurr = useQuery<FinancialReport>({
    queryKey: ['financial-report', yoyCurrFrom, yoyCurrTo],
    queryFn: async () => (await reportsApi.getFinancial({ dateFrom: yoyCurrFrom, dateTo: yoyCurrTo })).data,
    enabled: canView,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });
  const yoyPrev = useQuery<FinancialReport>({
    queryKey: ['financial-report', yoyPrevFrom, yoyPrevTo],
    queryFn: async () => (await reportsApi.getFinancial({ dateFrom: yoyPrevFrom, dateTo: yoyPrevTo })).data,
    enabled: canView,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

  // Расходы по категориям — реальные expense rows за период.
  // Категории жёстко в коде нет, нужно сгруппировать по categoryName.
  const expensesQuery = useQuery({
    queryKey: ['expenses', 'by-period', range.from, range.to],
    queryFn: async () => (await expensesApi.getAll({ dateFrom: range.from, dateTo: range.to })).data,
    enabled: canView,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const report = financialQuery.data;
  const prevReport = prevFinancialQuery.data;
  const dashboard = dashboardQuery.data;

  // Категории расходов агрегируем в memo: имя категории → сумма.
  const expensesByCategory = useMemo(() => {
    const rows = Array.isArray(expensesQuery.data) ? expensesQuery.data : [];
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.categoryName ?? 'Без категории';
      map.set(key, (map.get(key) ?? 0) + (Number(r.amount) || 0));
    }
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expensesQuery.data]);

  const handlePeriodChange = useCallback((p: PeriodKey) => {
    haptic('select');
    setPeriod(p);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['financial-report'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['expenses'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  // ── EXPORT HANDLERS ──────────────────────────────────────────────────────
  //
  // Bulletproofing contract (#13.3): the ProgressLoader is gated on
  // `exporting !== null`, so the ONE invariant we must never break is that
  // `exporting` always returns to null — even if a native Share call throws,
  // the user cancels the share sheet, or a promise never resolves.
  //
  //   • beginExport()  — arms a 45s safety timeout that force-resets.
  //   • finishExport() — clears the timeout AND the overlay, idempotently.
  //
  // Every handler wraps its share in its own try/finally so a cancel/throw
  // still flows into finishExport().

  const finishExport = useCallback(() => {
    if (exportTimeoutRef.current) {
      clearTimeout(exportTimeoutRef.current);
      exportTimeoutRef.current = null;
    }
    setExporting(null);
  }, []);

  const beginExport = useCallback((kind: 'pdf' | 'table' | 'image') => {
    // Re-arm: clear any stale timeout first.
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    setExporting(kind);
    exportTimeoutRef.current = setTimeout(() => {
      exportTimeoutRef.current = null;
      setExporting(null);
      Alert.alert('Долго не отвечает', 'Не удалось завершить за отведённое время. Попробуйте ещё раз.');
    }, 45_000);
  }, []);

  // Clear the safety timer if the screen unmounts mid-export.
  useEffect(() => {
    return () => {
      if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    };
  }, []);

  const exportPdf = useCallback(async () => {
    if (!report) return;
    haptic('tap');
    beginExport('pdf');
    try {
      const html = buildReportHtml({
        title: 'Финансовый отчёт',
        companyName: user?.tenant?.name ?? 'Autexa',
        periodLabel: formatPeriodLabel(period, range),
        range,
        report,
        prevReport: compareEnabled ? prevReport : undefined,
        expenses: expensesByCategory,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Отчёт ${range.from} — ${range.to}`,
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert('PDF создан', uri);
        }
      } finally {
        // Share-sheet cancel rejects on some iOS versions — make sure we
        // still drop the overlay regardless of how the share resolves.
        finishExport();
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать PDF');
      finishExport();
    }
  }, [report, prevReport, compareEnabled, expensesByCategory, range, period, user, beginExport, finishExport]);

  const exportTablePdf = useCallback(async () => {
    if (!report) return;
    haptic('tap');
    beginExport('table');
    // Табличный лэйаут — для тех, кто хочет открыть в Numbers/Excel
    // (PDF с таблицей нормально импортируется через copy-paste).
    try {
      const html = buildTableHtml({
        companyName: user?.tenant?.name ?? 'Autexa',
        periodLabel: formatPeriodLabel(period, range),
        range,
        report,
        prevReport: compareEnabled ? prevReport : undefined,
        expenses: expensesByCategory,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Таблица ${range.from} — ${range.to}`,
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert('Готово', uri);
        }
      } finally {
        finishExport();
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать таблицу');
      finishExport();
    }
  }, [report, prevReport, compareEnabled, expensesByCategory, range, period, user, beginExport, finishExport]);

  // Primary share image = the purpose-made vertical Stories card. We capture
  // the off-screen <StoriesShareCard> at 1080×1920 and share it as a PNG.
  const exportImage = useCallback(async () => {
    if (!report) return;
    haptic('tap');
    beginExport('image');
    // Mount the heavy 1080×1920 card now (on demand), let it lay out, then
    // capture. captureRef on a freshly-mounted view can return a blank PNG,
    // so we wait two animation frames for the gradient + SVG to paint.
    setShowStoriesCard(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!storiesCardRef.current) {
        throw new Error('stories card not mounted');
      }
      const uri = await captureRef(storiesCardRef as any, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: STORIES_EXPORT_WIDTH,
        height: STORIES_EXPORT_HEIGHT,
      });
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Финансовый отчёт',
            UTI: 'public.png',
          });
        } else {
          Alert.alert('Картинка готова', uri);
        }
      } finally {
        finishExport();
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось подготовить картинку');
      finishExport();
    } finally {
      // Always unmount the giant surface so Reports doesn't hold it.
      setShowStoriesCard(false);
    }
  }, [report, beginExport, finishExport]);

  // ── FORECAST SPARKLINE (hook — must run before any early return) ──────────
  // Спарклайн "факт vs прогноз" — лёгкий синтетический ряд: marginSpark
  // умножаем на средний дневной revenueMonth, чтобы получить визуальный
  // тренд. Если spark пустой — спарклайн рисовать не будем.
  const _marginSparkForChart = Array.isArray(dashboard?.marginSpark) ? dashboard?.marginSpark : [];
  const _monthlyRevenueForChart = dashboard?.revenueMonth ?? 0;
  const forecastSpark = useMemo(() => {
    if (!_marginSparkForChart.length || !_monthlyRevenueForChart) return [];
    const dayCount = _marginSparkForChart.length;
    const dailyAvg = _monthlyRevenueForChart / dayCount;
    let cum = 0;
    return _marginSparkForChart.map((m) => {
      cum += dailyAvg * (1 + m / 200);
      return cum;
    });
  }, [_marginSparkForChart, _monthlyRevenueForChart]);

  // ── ACCESS GUARD ──────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader
          title="Финансовые отчёты"
          subtitle="Полный контроль над деньгами"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed" size={40} color={palette.text.tertiary} />
          <Text style={[styles.adTitle, { color: palette.text.primary }]}>Доступ ограничен</Text>
          <Text style={[styles.adDesc, { color: palette.text.secondary }]}>
            У вас нет прав для просмотра финансовых отчётов
          </Text>
        </View>
      </View>
    );
  }

  // ── DERIVED METRICS ───────────────────────────────────────────────────────

  const revenue = report?.revenue ?? 0;
  const productCost = report?.productCost ?? 0;
  const salaries = report?.salaries ?? 0;
  const grossProfit = report?.grossProfit ?? 0;
  const netProfit = report?.netProfit ?? 0;
  const otherExpenses = (report as unknown as { otherExpenses?: number })?.otherExpenses ?? 0;

  const marginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const prevMarginPct = prevReport && prevReport.revenue > 0 ? (prevReport.netProfit / prevReport.revenue) * 100 : 0;
  const marginDelta = compareEnabled ? marginPct - prevMarginPct : (dashboard?.marginPctChange ?? 0);
  const marginSpark = Array.isArray(dashboard?.marginSpark) ? dashboard?.marginSpark : [];

  const netProfitDelta = compareEnabled && prevReport ? deltaPct(netProfit, prevReport.netProfit) : 0;

  // YoY-сравнение
  const yoyCurrRevenue = yoyCurr.data?.revenue ?? 0;
  const yoyPrevRevenue = yoyPrev.data?.revenue ?? 0;
  const yoyCurrProfit = yoyCurr.data?.netProfit ?? 0;
  const yoyPrevProfit = yoyPrev.data?.netProfit ?? 0;
  const yoyRevenueDelta = deltaPct(yoyCurrRevenue, yoyPrevRevenue);
  const yoyProfitDelta = deltaPct(yoyCurrProfit, yoyPrevProfit);

  // KPI цели — прогресс к месячным целям.
  const monthlyRevenue = dashboard?.revenueMonth ?? 0;
  const monthlyProfit = dashboard?.netProfitMonth ?? 0;
  const monthlyMargin = monthlyRevenue > 0 ? (monthlyProfit / monthlyRevenue) * 100 : 0;
  const revenueProgress = (monthlyRevenue / targets.revenueMonth) * 100;
  const marginProgress = (monthlyMargin / targets.marginPct) * 100;
  const profitProgress = (monthlyProfit / targets.netProfitMonth) * 100;

  // AI-инсайты — выводятся из реальных дельт, без вызовов в LLM.
  const insights = buildInsights({
    report,
    prevReport: compareEnabled ? prevReport : undefined,
    dashboard,
    yoyRevenueDelta,
    yoyProfitDelta,
  });

  // Алерты по финансовой части
  const alerts = buildAlerts({
    revenue,
    expenses: productCost + salaries + otherExpenses,
    marginPct,
    prevMarginPct: compareEnabled ? prevMarginPct : null,
  });

  // Прогноз на конец месяца. Берём фактический monthForecast из
  // dashboard-v2 (бэк сам экстраполирует) — это правда от бэка.
  const monthForecast = dashboard?.monthForecast ?? 0;

  // Данные для Stories-карточки шеринга (#13.7). Формируется из текущего
  // периода — чистая прибыль, выручка, маржа, число чеков.
  const storiesData: StoriesShareCardData = {
    companyName: user?.tenant?.name ?? 'Autexa',
    periodLabel: formatPeriodLabel(period, range),
    revenue: formatMoney(revenue),
    netProfit: formatMoney(netProfit),
    netProfitPositive: netProfit >= 0,
    marginPct: marginPct.toFixed(1),
    checkCount: String(report?.checkCount ?? 0),
  };

  // ── RENDER ────────────────────────────────────────────────────────────────

  const W = SCREEN_WIDTH - spacing[4] * 2 - spacing[5] * 2;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Финансовые отчёты"
        subtitle="Полный контроль над деньгами"
        onBack={() => navigation.goBack()}
        trailing={<FreshnessBadge query={dashboardQuery} />}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
        showsVerticalScrollIndicator={false}
        // Reports stacks ActivityRings, FunnelRows, PnLRows, sparklines
        // and YoY/Forecast SVGs — keeping offscreen sections composited
        // burnt UI-thread time on every scroll frame. Cull them.
        removeClippedSubviews
        scrollEventThrottle={16}
      >
        <View ref={captureViewRef} collapsable={false} style={{ gap: spacing[3] }}>
          {/* PERIOD SWITCHER */}
          <View style={styles.periodWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
              {PERIODS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.periodChip,
                    { backgroundColor: palette.bg.muted },
                    period === p.key && styles.periodChipActive,
                  ]}
                  onPress={() => handlePeriodChange(p.key)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.periodText,
                      { color: palette.text.secondary },
                      period === p.key && styles.periodTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Compare toggle */}
            <View style={styles.compareRow}>
              <Text style={[styles.compareLabel, { color: palette.text.secondary }]}>Сравнить с прошлым</Text>
              <TouchableOpacity
                onPress={() => {
                  haptic('select');
                  setCompareEnabled((v) => !v);
                }}
                style={[
                  styles.toggleTrack,
                  { backgroundColor: compareEnabled ? colors.primary[600] : palette.bg.muted },
                ]}
                activeOpacity={0.8}
              >
                <View style={[styles.toggleThumb, compareEnabled && styles.toggleThumbOn]} />
              </TouchableOpacity>
            </View>

            {/* Custom range picker */}
            {period === 'custom' && (
              <View style={styles.customRangeRow}>
                <TouchableOpacity
                  style={[
                    styles.customDateBtn,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                  onPress={() => setShowCustomPicker('from')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
                  <Text style={[styles.customDateText, { color: palette.text.primary }]}>{customRange.from}</Text>
                </TouchableOpacity>
                <Text style={[styles.customDash, { color: palette.text.tertiary }]}>—</Text>
                <TouchableOpacity
                  style={[
                    styles.customDateBtn,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                  onPress={() => setShowCustomPicker('to')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
                  <Text style={[styles.customDateText, { color: palette.text.primary }]}>{customRange.to}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* COLD-START */}
          {report === undefined ? (
            <LoadingSpinner />
          ) : (
            <>
              {/* 1. HERO — Чистая прибыль */}
              <AnimatedCard index={0}>
                <LinearGradient
                  colors={netProfit >= 0 ? ['#059669', '#047857'] : ['#dc2626', '#b91c1c']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroCard}
                >
                  <View style={styles.heroTop}>
                    <Ionicons
                      name={netProfit >= 0 ? 'trending-up' : 'trending-down'}
                      size={16}
                      color="rgba(255,255,255,0.7)"
                    />
                    <Text style={styles.heroLabel}>ЧИСТАЯ ПРИБЫЛЬ</Text>
                  </View>
                  <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {formatMoney(netProfit)}
                  </Text>
                  <Text style={styles.heroSub}>Оборот: {formatMoney(revenue)}</Text>
                  {compareEnabled && prevReport && (
                    <View style={styles.heroDeltaWrap}>
                      <DeltaChip value={netProfitDelta} dark />
                      <Text style={styles.heroDeltaSub}>vs предыдущий период</Text>
                    </View>
                  )}
                </LinearGradient>
              </AnimatedCard>

              {/* 2. ФИНАНСОВАЯ ВОРОНКА */}
              <AnimatedCard
                index={1}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.cardTitle, { color: palette.text.tertiary }]}>ФИНАНСОВАЯ ВОРОНКА</Text>
                <FunnelRow
                  label="Выручка"
                  amount={revenue}
                  icon="trending-up-outline"
                  tone="positive"
                  palette={palette}
                />
                <FunnelArrow palette={palette} />
                <FunnelRow
                  label="− Себестоимость товаров"
                  amount={-productCost}
                  pct={pctOf(productCost, revenue)}
                  icon="cube-outline"
                  tone="negative"
                  palette={palette}
                />
                <FunnelRow
                  label="= Валовая прибыль"
                  amount={grossProfit}
                  pct={pctOf(grossProfit, revenue)}
                  icon="checkmark-circle-outline"
                  tone="result"
                  palette={palette}
                />
                <FunnelArrow palette={palette} />
                <FunnelRow
                  label="− Зарплаты"
                  amount={-salaries}
                  pct={pctOf(salaries, revenue)}
                  icon="people-outline"
                  tone="negative"
                  palette={palette}
                />
                <FunnelRow
                  label="= После ФОТ"
                  amount={grossProfit - salaries}
                  pct={pctOf(grossProfit - salaries, revenue)}
                  icon="checkmark-circle-outline"
                  tone="result"
                  palette={palette}
                />
                {otherExpenses > 0 && (
                  <>
                    <FunnelArrow palette={palette} />
                    <FunnelRow
                      label="− Прочие расходы"
                      amount={-otherExpenses}
                      pct={pctOf(otherExpenses, revenue)}
                      icon="wallet-outline"
                      tone="negative"
                      palette={palette}
                    />
                  </>
                )}
                <FunnelArrow palette={palette} />
                <FunnelRow
                  label="= Чистая прибыль"
                  amount={netProfit}
                  pct={pctOf(netProfit, revenue)}
                  icon="cash-outline"
                  tone="final"
                  palette={palette}
                />
              </AnimatedCard>

              {/* 3. P&L (collapsed by default) */}
              <AnimatedCard
                index={2}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <TouchableOpacity
                  style={styles.collapseHeader}
                  onPress={() => {
                    haptic('tap');
                    setPnlOpen((v) => !v);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.collapseTitle, { color: palette.text.primary }]}>Прибыли и убытки (P&L)</Text>
                  <Ionicons name={pnlOpen ? 'chevron-up' : 'chevron-down'} size={18} color={palette.text.tertiary} />
                </TouchableOpacity>
                {pnlOpen && (
                  <View style={{ marginTop: spacing[3] }}>
                    <PnLRow label="Доходы" amount={revenue} palette={palette} tone="positive" />
                    <PnLRow
                      label="Расходы"
                      amount={-(productCost + salaries + otherExpenses)}
                      palette={palette}
                      tone="negative"
                    />
                    <View style={[styles.pnlDivider, { backgroundColor: palette.border.subtle }]} />
                    <PnLRow label="Чистая прибыль" amount={netProfit} palette={palette} tone="bold" />
                    <TouchableOpacity style={styles.pnlPdfBtn} onPress={exportPdf} activeOpacity={0.85}>
                      <Ionicons name="document-text-outline" size={16} color={colors.white} />
                      <Text style={styles.pnlPdfText}>Скачать PDF</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </AnimatedCard>

              {/* 4. МАРЖИНАЛЬНОСТЬ */}
              <AnimatedCard
                index={3}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.cardIcon, { backgroundColor: colors.green[50] }]}>
                    <Ionicons name="stats-chart-outline" size={16} color={colors.green[600]} />
                  </View>
                  <Text style={[styles.cardTitleInline, { color: palette.text.tertiary }]}>МАРЖИНАЛЬНОСТЬ</Text>
                </View>
                <View style={styles.marginRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.marginValue, { color: palette.text.primary }]}>{marginPct.toFixed(1)}%</Text>
                    <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>Чистая прибыль / Оборот</Text>
                  </View>
                  <DeltaChip value={marginDelta} suffix="%" />
                </View>
                {marginSpark.length > 1 && (
                  <View style={{ marginTop: spacing[3] }}>
                    <Svg width={W} height={60}>
                      <Defs>
                        <SvgGrad id="marginGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor={colors.green[400]} stopOpacity={0.45} />
                          <Stop offset="100%" stopColor={colors.green[400]} stopOpacity={0} />
                        </SvgGrad>
                      </Defs>
                      <Path d={buildSparkArea(marginSpark, W, 60)} fill="url(#marginGrad)" />
                      <Path
                        d={buildSparkPath(marginSpark, W, 60)}
                        stroke={colors.green[600]}
                        strokeWidth={2}
                        fill="none"
                        strokeLinecap="round"
                      />
                    </Svg>
                  </View>
                )}
                {compareEnabled && prevReport && (
                  <View style={styles.compareLine}>
                    <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
                      Прошлый период: {prevMarginPct.toFixed(1)}%
                    </Text>
                  </View>
                )}
              </AnimatedCard>

              {/* 5. РАСХОДЫ ПО КАТЕГОРИЯМ */}
              {expensesByCategory.length > 0 && (
                <AnimatedCard
                  index={4}
                  style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.cardTitle, { color: palette.text.tertiary }]}>РАСХОДЫ ПО КАТЕГОРИЯМ</Text>
                  {expensesByCategory.slice(0, 5).map((row, idx) => {
                    const total = expensesByCategory.reduce((s, r) => s + r.amount, 0);
                    const pct = total > 0 ? (row.amount / total) * 100 : 0;
                    return (
                      <View key={row.name} style={styles.expRow}>
                        <View style={styles.expRowHead}>
                          <Text style={[styles.expRowName, { color: palette.text.primary }]} numberOfLines={1}>
                            {row.name}
                          </Text>
                          <Text style={[styles.expRowAmount, { color: palette.text.primary }]}>
                            {formatMoney(row.amount)}
                          </Text>
                        </View>
                        <View style={[styles.expBarTrack, { backgroundColor: palette.bg.muted }]}>
                          <View
                            style={[
                              styles.expBarFill,
                              {
                                width: `${Math.min(100, Math.max(2, pct))}%`,
                                backgroundColor: EXPENSE_COLORS[idx % EXPENSE_COLORS.length],
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.expRowPct, { color: palette.text.tertiary }]}>
                          {pct.toFixed(1)}% от расходов
                        </Text>
                      </View>
                    );
                  })}
                </AnimatedCard>
              )}

              {/* 6. ЛИЧНЫЙ РЕКОРД */}
              {dashboard?.personalRecord && (
                <PersonalRecordCard
                  bestDay={dashboard.personalRecord.bestDay}
                  bestMonth={dashboard.personalRecord.bestMonth}
                  monthlyProfit={monthlyProfit}
                />
              )}

              {/* 7. ТРЕНДЫ YoY */}
              <AnimatedCard
                index={6}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.cardTitle, { color: palette.text.tertiary }]}>ТРЕНДЫ — ГОД К ГОДУ</Text>
                <View style={styles.yoyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.yoyLabel, { color: palette.text.secondary }]}>Выручка 12 мес</Text>
                    <Text style={[styles.yoyValue, { color: palette.text.primary }]} numberOfLines={1}>
                      {formatMoneyCompact(yoyCurrRevenue)}
                    </Text>
                    <DeltaChip value={yoyRevenueDelta} suffix="%" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.yoyLabel, { color: palette.text.secondary }]}>Прибыль 12 мес</Text>
                    <Text style={[styles.yoyValue, { color: palette.text.primary }]} numberOfLines={1}>
                      {formatMoneyCompact(yoyCurrProfit)}
                    </Text>
                    <DeltaChip value={yoyProfitDelta} suffix="%" />
                  </View>
                </View>
                {marginSpark.length > 1 && (
                  <View style={{ marginTop: spacing[3] }}>
                    <Svg width={W} height={50}>
                      <Defs>
                        <SvgGrad id="yoyGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor={colors.primary[400]} stopOpacity={0.35} />
                          <Stop offset="100%" stopColor={colors.primary[400]} stopOpacity={0} />
                        </SvgGrad>
                      </Defs>
                      <Path d={buildSparkArea(marginSpark, W, 50)} fill="url(#yoyGrad)" />
                      <Path
                        d={buildSparkPath(marginSpark, W, 50)}
                        stroke={colors.primary[600]}
                        strokeWidth={1.8}
                        fill="none"
                        strokeLinecap="round"
                      />
                    </Svg>
                  </View>
                )}
              </AnimatedCard>

              {/* 8. KPI ЦЕЛИ (Apple Activity Rings) */}
              <AnimatedCard
                index={7}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <View style={styles.kpiHeader}>
                  <Text style={[styles.cardTitle, { color: palette.text.tertiary, padding: 0 }]}>KPI ЦЕЛИ</Text>
                  <TouchableOpacity
                    onPress={() => {
                      haptic('tap');
                      setShowTargetsModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.kpiEdit, { color: colors.primary[600] }]}>Изменить цели</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.kpiBody}>
                  <View style={styles.kpiRingsWrap}>
                    <ActivityRing
                      size={140}
                      strokeWidth={14}
                      values={[
                        { color: colors.green[600], track: colors.green[100], pct: revenueProgress },
                        { color: colors.primary[600], track: colors.primary[100], pct: marginProgress },
                        { color: colors.amber[600], track: colors.amber[100], pct: profitProgress },
                      ]}
                    />
                  </View>
                  <View style={styles.kpiLegend}>
                    <KpiLegendRow
                      color={colors.green[600]}
                      label="Выручка месяца"
                      current={formatMoneyCompact(monthlyRevenue)}
                      target={formatMoneyCompact(targets.revenueMonth)}
                      progress={revenueProgress}
                      palette={palette}
                    />
                    <KpiLegendRow
                      color={colors.primary[600]}
                      label="Маржа"
                      current={`${monthlyMargin.toFixed(1)}%`}
                      target={`${targets.marginPct}%`}
                      progress={marginProgress}
                      palette={palette}
                    />
                    <KpiLegendRow
                      color={colors.amber[600]}
                      label="Чистая прибыль"
                      current={formatMoneyCompact(monthlyProfit)}
                      target={formatMoneyCompact(targets.netProfitMonth)}
                      progress={profitProgress}
                      palette={palette}
                    />
                  </View>
                </View>
              </AnimatedCard>

              {/* 9. AI-ИНСАЙТЫ */}
              {insights.length > 0 && (
                <View style={{ gap: spacing[2] }}>
                  <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>ИНСАЙТЫ</Text>
                  {insights.map((ins, idx) => (
                    <AnimatedCard
                      key={idx}
                      index={8 + idx}
                      style={[
                        styles.insightCard,
                        {
                          backgroundColor: insightBg(ins.tone, palette.bg.card),
                          borderColor: insightBorder(ins.tone, palette.border.subtle),
                        },
                      ]}
                    >
                      <View style={[styles.insightIcon, { backgroundColor: insightIconBg(ins.tone) }]}>
                        <Ionicons name={ins.icon} size={16} color={insightIconColor(ins.tone)} />
                      </View>
                      <Text style={[styles.insightText, { color: palette.text.primary }]}>{ins.text}</Text>
                    </AnimatedCard>
                  ))}
                </View>
              )}

              {/* 10. ПРОГНОЗ */}
              {monthForecast > 0 && (
                <AnimatedCard
                  index={11}
                  style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <View style={styles.cardHeaderRow}>
                    <View style={[styles.cardIcon, { backgroundColor: colors.primary[50] }]}>
                      <Ionicons name="trending-up-outline" size={16} color={colors.primary[600]} />
                    </View>
                    <Text style={[styles.cardTitleInline, { color: palette.text.tertiary }]}>ПРОГНОЗ</Text>
                  </View>
                  <Text
                    style={[styles.forecastValue, { color: palette.text.primary }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    ~{formatMoney(monthForecast)}
                  </Text>
                  <Text style={[styles.cardCaption, { color: palette.text.tertiary }]}>
                    По текущей динамике до конца месяца
                  </Text>
                  {forecastSpark.length > 1 && (
                    <View style={{ marginTop: spacing[3] }}>
                      <Svg width={W} height={50}>
                        <Defs>
                          <SvgGrad id="fcstGrad" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0%" stopColor={colors.primary[400]} stopOpacity={0.4} />
                            <Stop offset="100%" stopColor={colors.primary[400]} stopOpacity={0} />
                          </SvgGrad>
                        </Defs>
                        <Path d={buildSparkArea(forecastSpark, W, 50)} fill="url(#fcstGrad)" />
                        <Path
                          d={buildSparkPath(forecastSpark, W, 50)}
                          stroke={colors.primary[600]}
                          strokeWidth={2}
                          fill="none"
                          strokeLinecap="round"
                        />
                      </Svg>
                    </View>
                  )}
                </AnimatedCard>
              )}

              {/* 11. АЛЕРТЫ */}
              {alerts.length > 0 && (
                <View style={{ gap: spacing[2] }}>
                  <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>ФИНАНСОВЫЕ АЛЕРТЫ</Text>
                  {alerts.map((a, idx) => (
                    <AnimatedCard
                      key={idx}
                      index={12 + idx}
                      style={[
                        styles.alertCard,
                        {
                          backgroundColor: palette.bg.card,
                          borderColor: a.tone === 'crit' ? colors.red[200] : colors.amber[200],
                          borderLeftColor: a.tone === 'crit' ? colors.red[500] : colors.amber[600],
                        },
                      ]}
                    >
                      <Ionicons
                        name="warning"
                        size={18}
                        color={a.tone === 'crit' ? colors.red[600] : colors.amber[600]}
                      />
                      <Text style={[styles.alertText, { color: palette.text.primary }]}>{a.message}</Text>
                    </AnimatedCard>
                  ))}
                </View>
              )}

              {/* 12. ЭКСПОРТ */}
              <AnimatedCard
                index={15}
                style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.cardTitle, { color: palette.text.tertiary }]}>ЭКСПОРТ</Text>
                <View style={styles.exportRow}>
                  <TouchableOpacity style={styles.exportBtn} onPress={exportImage} activeOpacity={0.85}>
                    <Ionicons name="sparkles-outline" size={20} color={colors.amber[600]} />
                    <Text style={[styles.exportBtnText, { color: palette.text.primary }]}>Для Stories</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.exportBtn} onPress={exportPdf} activeOpacity={0.85}>
                    <Ionicons name="document-text-outline" size={20} color={colors.primary[600]} />
                    <Text style={[styles.exportBtnText, { color: palette.text.primary }]}>PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.exportBtn} onPress={exportTablePdf} activeOpacity={0.85}>
                    <Ionicons name="grid-outline" size={20} color={colors.green[600]} />
                    <Text style={[styles.exportBtnText, { color: palette.text.primary }]}>Таблица</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.cardCaption, { color: palette.text.tertiary, marginTop: spacing[2] }]}>
                  «Для Stories» — вертикальная картинка с ключевыми цифрами. PDF и Таблица — для печати и Numbers/Excel.
                </Text>
              </AnimatedCard>
            </>
          )}
        </View>
      </ScrollView>

      {/* TARGETS MODAL */}
      <TargetsModal
        visible={showTargetsModal}
        onClose={() => setShowTargetsModal(false)}
        targets={targets}
        onSave={async (next) => {
          await saveTargets(next);
          setShowTargetsModal(false);
        }}
      />

      {/* CUSTOM DATE PICKERS */}
      <DateTimePickerModal
        visible={showCustomPicker === 'from'}
        value={parseDateStr(customRange.from)}
        mode="date"
        onConfirm={(d) => {
          setCustomRange((r) => ({ ...r, from: toDateStr(d) }));
          setShowCustomPicker(null);
        }}
        onCancel={() => setShowCustomPicker(null)}
      />
      <DateTimePickerModal
        visible={showCustomPicker === 'to'}
        value={parseDateStr(customRange.to)}
        mode="date"
        onConfirm={(d) => {
          setCustomRange((r) => ({ ...r, to: toDateStr(d) }));
          setShowCustomPicker(null);
        }}
        onCancel={() => setShowCustomPicker(null)}
      />

      {/* Premium export progress — surfaces during the 1-3s gap between tap
          and Share-sheet. Title is fixed per kind so the user knows what's
          being prepared. */}
      <ProgressLoader
        visible={exporting !== null}
        title={
          exporting === 'pdf'
            ? 'Готовим PDF...'
            : exporting === 'table'
              ? 'Готовим таблицу...'
              : exporting === 'image'
                ? 'Готовим картинку...'
                : undefined
        }
      />

      {/* OFF-SCREEN STORIES CARD — mounted ON DEMAND (only during an image
          export) and parked far off the visible canvas so it never appears
          on screen. view-shot still captures it at full 1080×1920.
          pointerEvents none so it's inert. Unmounted the rest of the time so
          Reports doesn't hold a giant offscreen surface in memory. */}
      {showStoriesCard && (
        <View style={styles.offscreenCapture} pointerEvents="none">
          <StoriesShareCard ref={storiesCardRef} data={storiesData} />
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

type FunnelTone = 'positive' | 'negative' | 'result' | 'final';

function FunnelRow({
  label,
  amount,
  pct,
  icon,
  tone,
  palette,
}: {
  label: string;
  amount: number;
  pct?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: FunnelTone;
  palette: ReturnType<typeof useColors>;
}) {
  const accentBg = (() => {
    if (tone === 'positive') return colors.green[50];
    if (tone === 'negative') return colors.red[50];
    if (tone === 'final') return colors.primary[50];
    return palette.bg.muted;
  })();
  const accentFg = (() => {
    if (tone === 'positive') return colors.green[600];
    if (tone === 'negative') return colors.red[500];
    if (tone === 'final') return colors.primary[600];
    return palette.text.secondary;
  })();
  const amountColor = (() => {
    if (tone === 'final') return colors.primary[700];
    if (tone === 'result') return colors.green[700];
    return palette.text.primary;
  })();
  return (
    <View style={[styles.funnelRow, tone === 'final' && styles.funnelRowFinal]}>
      <View style={styles.funnelLeft}>
        <View style={[styles.funnelIcon, { backgroundColor: accentBg }]}>
          <Ionicons name={icon} size={14} color={accentFg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.funnelLabel, { color: palette.text.primary }]}>{label}</Text>
          {pct && <Text style={[styles.funnelPct, { color: palette.text.tertiary }]}>{pct}% от выручки</Text>}
        </View>
      </View>
      <Text style={[styles.funnelAmount, { color: amountColor }, tone === 'final' && styles.funnelAmountFinal]}>
        {formatMoney(amount)}
      </Text>
    </View>
  );
}

function FunnelArrow({ palette }: { palette: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.funnelArrowWrap}>
      <Ionicons name="arrow-down" size={12} color={palette.text.tertiary} />
    </View>
  );
}

function DeltaChip({ value, suffix = '%', dark = false }: { value: number; suffix?: string; dark?: boolean }) {
  const tone: 'up' | 'down' | 'flat' = value > 0.5 ? 'up' : value < -0.5 ? 'down' : 'flat';
  const bg = tone === 'up' ? colors.green[50] : tone === 'down' ? colors.red[50] : 'rgba(0,0,0,0.06)';
  const fg = tone === 'up' ? colors.green[700] : tone === 'down' ? colors.red[700] : colors.gray[600];
  const darkBg =
    tone === 'up' ? 'rgba(255,255,255,0.25)' : tone === 'down' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.18)';
  const darkFg = colors.white;
  return (
    <View style={[styles.deltaChip, { backgroundColor: dark ? darkBg : bg }]}>
      <Ionicons
        name={tone === 'up' ? 'arrow-up' : tone === 'down' ? 'arrow-down' : 'remove'}
        size={10}
        color={dark ? darkFg : fg}
      />
      <Text style={[styles.deltaChipText, { color: dark ? darkFg : fg }]}>
        {Math.abs(value).toFixed(value < 10 ? 1 : 0)}
        {suffix}
      </Text>
    </View>
  );
}

function PnLRow({
  label,
  amount,
  palette,
  tone,
}: {
  label: string;
  amount: number;
  palette: ReturnType<typeof useColors>;
  tone: 'positive' | 'negative' | 'bold';
}) {
  const color = tone === 'positive' ? colors.green[700] : tone === 'negative' ? colors.red[600] : palette.text.primary;
  return (
    <View style={styles.pnlRow}>
      <Text
        style={[styles.pnlLabel, { color: palette.text.primary }, tone === 'bold' && { fontWeight: fontWeight.bold }]}
      >
        {label}
      </Text>
      <Text style={[styles.pnlAmount, { color }, tone === 'bold' && { fontWeight: fontWeight.bold }]}>
        {formatMoney(amount)}
      </Text>
    </View>
  );
}

function PersonalRecordCard({
  bestDay,
  bestMonth,
  monthlyProfit,
}: {
  bestDay?: { date: string; value: number };
  bestMonth?: { ym: string; value: number };
  monthlyProfit: number;
}) {
  const palette = useColors();
  if (!bestDay && !bestMonth) return null;
  // "До рекорда осталось" — считаем относительно лучшего месяца.
  const remaining = bestMonth ? Math.max(0, bestMonth.value - monthlyProfit) : 0;
  const approaching = bestMonth && monthlyProfit > 0 && remaining > 0 && remaining < bestMonth.value * 0.3;
  return (
    <AnimatedCard
      index={5}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.cardHeaderRow}>
        <View style={[styles.cardIcon, { backgroundColor: colors.amber[50] }]}>
          <Ionicons name="trophy-outline" size={16} color={colors.amber[600]} />
        </View>
        <Text style={[styles.cardTitleInline, { color: palette.text.tertiary }]}>ЛИЧНЫЙ РЕКОРД</Text>
      </View>
      {bestDay && (
        <View style={styles.recordRow}>
          <Text style={[styles.recordLabel, { color: palette.text.secondary }]}>Лучший день</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.recordValue, { color: palette.text.primary }]}>{formatMoney(bestDay.value)}</Text>
            <Text style={[styles.recordCaption, { color: palette.text.tertiary }]}>{bestDay.date}</Text>
          </View>
        </View>
      )}
      {bestMonth && (
        <View style={styles.recordRow}>
          <Text style={[styles.recordLabel, { color: palette.text.secondary }]}>Лучший месяц</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.recordValue, { color: palette.text.primary }]}>{formatMoney(bestMonth.value)}</Text>
            <Text style={[styles.recordCaption, { color: palette.text.tertiary }]}>{bestMonth.ym}</Text>
          </View>
        </View>
      )}
      {approaching && bestMonth && (
        <View style={[styles.recordHint, { backgroundColor: colors.amber[50] }]}>
          <Ionicons name="flame-outline" size={14} color={colors.amber[600]} />
          <Text style={[styles.recordHintText, { color: colors.amber[700] }]}>
            До рекорда осталось {formatMoney(remaining)}
          </Text>
        </View>
      )}
    </AnimatedCard>
  );
}

function KpiLegendRow({
  color,
  label,
  current,
  target,
  progress,
  palette,
}: {
  color: string;
  label: string;
  current: string;
  target: string;
  progress: number;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.kpiLegendRow}>
      <View style={[styles.kpiDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.kpiLegendLabel, { color: palette.text.secondary }]}>{label}</Text>
        <Text style={[styles.kpiLegendValue, { color: palette.text.primary }]} numberOfLines={1}>
          {current} / {target}
        </Text>
        <Text style={[styles.kpiLegendPct, { color: progress >= 100 ? colors.green[600] : palette.text.tertiary }]}>
          {progress >= 100 ? '✓ Цель достигнута' : `${Math.min(999, Math.round(progress))}%`}
        </Text>
      </View>
    </View>
  );
}

function TargetsModal({
  visible,
  onClose,
  targets,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  targets: KpiTargets;
  onSave: (next: KpiTargets) => Promise<void>;
}) {
  const palette = useColors();
  const [rev, setRev] = useState(String(targets.revenueMonth));
  const [marg, setMarg] = useState(String(targets.marginPct));
  const [prof, setProf] = useState(String(targets.netProfitMonth));

  useEffect(() => {
    if (visible) {
      setRev(String(targets.revenueMonth));
      setMarg(String(targets.marginPct));
      setProf(String(targets.netProfitMonth));
    }
  }, [visible, targets]);

  const handleSave = () => {
    const next: KpiTargets = {
      revenueMonth: Math.max(0, Number(rev.replace(/\D/g, '')) || DEFAULT_TARGETS.revenueMonth),
      marginPct: Math.max(0, Number(marg.replace(/[^\d.]/g, '')) || DEFAULT_TARGETS.marginPct),
      netProfitMonth: Math.max(0, Number(prof.replace(/\D/g, '')) || DEFAULT_TARGETS.netProfitMonth),
    };
    onSave(next);
  };

  return (
    <RNModal visible={visible} animationType="none" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalOverlay}>
        {/* Smooth blur fade-in replaces the old dark dim (#13.5 / #7). */}
        <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
          <ModalBlurBackdrop onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown.duration(280)}
          exiting={SlideOutDown.duration(200)}
          style={[styles.modalSheet, { backgroundColor: palette.bg.elevated }]}
        >
          <View style={[styles.modalHandle, { backgroundColor: palette.border.subtle }]} />
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Изменить цели</Text>
            <TouchableOpacity onPress={onClose} style={[styles.modalClose, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="close" size={20} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.modalLabel, { color: palette.text.secondary }]}>Выручка месяца (₽)</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              keyboardType="numeric"
              value={rev}
              onChangeText={setRev}
              placeholder="2000000"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.modalLabel, { color: palette.text.secondary }]}>Маржа (%)</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              keyboardType="numeric"
              value={marg}
              onChangeText={setMarg}
              placeholder="25"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.modalLabel, { color: palette.text.secondary }]}>Чистая прибыль месяца (₽)</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              keyboardType="numeric"
              value={prof}
              onChangeText={setProf}
              placeholder="500000"
              placeholderTextColor={palette.text.tertiary}
            />
            <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSave} activeOpacity={0.85}>
              <Text style={styles.modalSaveText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Insights / alerts — детерминированная логика, не AI-вызов.
// ─────────────────────────────────────────────────────────────────────────────

type InsightTone = 'green' | 'amber' | 'red';
interface Insight {
  text: string;
  tone: InsightTone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

function buildInsights({
  report,
  prevReport,
  dashboard,
  yoyRevenueDelta,
  yoyProfitDelta,
}: {
  report?: FinancialReport;
  prevReport?: FinancialReport;
  dashboard?: DashboardV2;
  yoyRevenueDelta: number;
  yoyProfitDelta: number;
}): Insight[] {
  const out: Insight[] = [];
  if (!report) return out;

  // Маржа падает + зарплаты растут → классическое тревожное сочетание.
  if (prevReport) {
    const currMargin = report.revenue > 0 ? (report.netProfit / report.revenue) * 100 : 0;
    const prevMargin = prevReport.revenue > 0 ? (prevReport.netProfit / prevReport.revenue) * 100 : 0;
    const marginDrop = prevMargin - currMargin;
    const salaryRise =
      prevReport.salaries > 0 ? ((report.salaries - prevReport.salaries) / prevReport.salaries) * 100 : 0;
    if (marginDrop >= 3 && salaryRise >= 5) {
      out.push({
        text: `Маржа упала на ${marginDrop.toFixed(1)}% — выросли зарплаты +${salaryRise.toFixed(0)}%`,
        tone: 'amber',
        icon: 'alert-circle-outline',
      });
    }

    const revenueDelta = deltaPct(report.revenue, prevReport.revenue);
    const profitDelta = deltaPct(report.netProfit, prevReport.netProfit);
    if (revenueDelta > 10 && profitDelta < revenueDelta / 3) {
      out.push({
        text: `Выручка ${revenueDelta > 0 ? '+' : ''}${revenueDelta.toFixed(0)}%, но прибыль только ${profitDelta > 0 ? '+' : ''}${profitDelta.toFixed(0)}% — растут расходы`,
        tone: 'amber',
        icon: 'pulse-outline',
      });
    }
  }

  // YoY
  if (Math.abs(yoyRevenueDelta) > 5 || Math.abs(yoyProfitDelta) > 5) {
    out.push({
      text:
        yoyRevenueDelta > 0 && yoyProfitDelta < yoyRevenueDelta / 2
          ? `Год к году: +${yoyRevenueDelta.toFixed(0)}% выручки, прибыль только ${yoyProfitDelta > 0 ? '+' : ''}${yoyProfitDelta.toFixed(0)}%`
          : yoyRevenueDelta < 0
            ? `Год к году выручка ${yoyRevenueDelta.toFixed(0)}% — проверьте, что ушло`
            : `Год к году выручка ${yoyRevenueDelta > 0 ? '+' : ''}${yoyRevenueDelta.toFixed(0)}%, прибыль ${yoyProfitDelta > 0 ? '+' : ''}${yoyProfitDelta.toFixed(0)}%`,
      tone: yoyRevenueDelta < 0 || yoyProfitDelta < 0 ? 'red' : 'green',
      icon: 'calendar-outline',
    });
  }

  // dashboard marginPctChange — устойчивая динамика маржи
  if (dashboard && Math.abs(dashboard.marginPctChange) > 3) {
    out.push({
      text:
        dashboard.marginPctChange > 0
          ? `Маржа выросла на ${dashboard.marginPctChange.toFixed(1)}% за месяц — отлично`
          : `Маржа снизилась на ${Math.abs(dashboard.marginPctChange).toFixed(1)}% за месяц`,
      tone: dashboard.marginPctChange > 0 ? 'green' : 'amber',
      icon: 'stats-chart-outline',
    });
  }

  // Возьмём максимум 3 — отчёт не должен превращаться в стену.
  return out.slice(0, 3);
}

interface FinanceAlert {
  message: string;
  tone: 'warn' | 'crit';
}

function buildAlerts({
  revenue,
  expenses,
  marginPct,
  prevMarginPct,
}: {
  revenue: number;
  expenses: number;
  marginPct: number;
  prevMarginPct: number | null;
}): FinanceAlert[] {
  const out: FinanceAlert[] = [];
  if (marginPct < 20 && revenue > 0) {
    out.push({
      message:
        prevMarginPct !== null && prevMarginPct >= 20
          ? 'Маржа ниже 20% впервые в этом периоде'
          : 'Маржа ниже 20% — стоит пересмотреть наценку',
      tone: 'crit',
    });
  }
  if (expenses > revenue && revenue > 0) {
    out.push({ message: 'Расходы превышают выручку в выбранном периоде', tone: 'crit' });
  }
  if (marginPct < 10 && revenue > 0) {
    out.push({ message: 'Маржа ниже 10% — операционный риск', tone: 'crit' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Insight palette helpers
// ─────────────────────────────────────────────────────────────────────────────

function insightBg(tone: InsightTone, fallback: string): string {
  if (tone === 'green') return colors.green[50];
  if (tone === 'amber') return colors.amber[50];
  if (tone === 'red') return colors.red[50];
  return fallback;
}
function insightBorder(tone: InsightTone, fallback: string): string {
  if (tone === 'green') return colors.green[200];
  if (tone === 'amber') return colors.amber[200];
  if (tone === 'red') return colors.red[200];
  return fallback;
}
function insightIconBg(tone: InsightTone): string {
  if (tone === 'green') return colors.green[100];
  if (tone === 'amber') return colors.amber[100];
  return colors.red[100];
}
function insightIconColor(tone: InsightTone): string {
  if (tone === 'green') return colors.green[700];
  if (tone === 'amber') return colors.amber[700];
  return colors.red[700];
}

const EXPENSE_COLORS = [
  colors.primary[500],
  colors.green[500],
  colors.amber[600],
  colors.violet[500],
  colors.cyan[600],
  colors.rose[500],
  colors.orange[500],
];

// ─────────────────────────────────────────────────────────────────────────────
//  HTML builders for export
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

// Shared print-safe CSS + branded header. Kept deliberately conservative —
// system fonts, solid colours, simple borders — so expo-print rasterises it
// identically on every iOS version (no flex gaps, no web fonts, no gradients
// that print engines drop).
const PDF_INK = '#0F172A'; // slate-900
const PDF_MUTED = '#64748B'; // slate-500
const PDF_LINE = '#E2E8F0'; // slate-200
const PDF_ZEBRA = '#F8FAFC'; // slate-50
const PDF_BRAND = '#2563EB'; // primary-600
const PDF_POS = '#15803D'; // green-700
const PDF_NEG = '#B91C1C'; // red-700

function pdfBaseCss(): string {
  return `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 32px 28px; color: ${PDF_INK}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .brandbar { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid ${PDF_BRAND}; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { font-size: 13px; font-weight: 800; letter-spacing: 3px; color: ${PDF_BRAND}; }
  .company { font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.4px; }
  .period { color: ${PDF_MUTED}; font-size: 12px; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title .t { font-size: 12px; font-weight: 700; letter-spacing: 1px; color: ${PDF_MUTED}; text-transform: uppercase; }
  .cards { display: flex; gap: 12px; margin: 4px 0 26px; }
  .mcard { flex: 1; border: 1px solid ${PDF_LINE}; border-radius: 12px; padding: 14px 16px; }
  .mcard.hero { border-color: ${PDF_BRAND}; background: #EFF6FF; }
  .mcard .ml { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: ${PDF_MUTED}; text-transform: uppercase; }
  .mcard .mv { font-size: 22px; font-weight: 800; margin-top: 6px; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
  .mcard .mv.pos { color: ${PDF_POS}; }
  .mcard .mv.neg { color: ${PDF_NEG}; }
  .section-title { font-size: 11px; letter-spacing: 1px; color: ${PDF_MUTED}; margin: 26px 0 10px; text-transform: uppercase; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 9px 12px; }
  thead th { background: ${PDF_INK}; color: #fff; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 700; }
  thead th:first-child { border-top-left-radius: 8px; }
  thead th:last-child { border-top-right-radius: 8px; }
  tbody tr:nth-child(even) { background: ${PDF_ZEBRA}; }
  tbody td { border-bottom: 1px solid ${PDF_LINE}; }
  tbody tr.total td { border-top: 2px solid ${PDF_INK}; border-bottom: none; font-weight: 800; font-size: 14px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.pos { color: ${PDF_POS}; } td.neg { color: ${PDF_NEG}; }
  .pctcell { color: ${PDF_MUTED}; font-size: 11px; }
  .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid ${PDF_LINE}; color: ${PDF_MUTED}; font-size: 10px; text-align: center; letter-spacing: 0.5px; }
  `;
}

function pdfBrandBar(companyName: string, periodLabel: string, docKind: string): string {
  return `<div class="brandbar">
    <div>
      <div class="brand">AUTEXA</div>
      <h1 class="company">${escapeHtml(companyName)}</h1>
      <div class="period">${escapeHtml(periodLabel)}</div>
    </div>
    <div class="doc-title"><div class="t">${escapeHtml(docKind)}</div></div>
  </div>`;
}

function buildReportHtml({
  companyName,
  periodLabel,
  range,
  report,
  prevReport,
  expenses,
}: {
  title: string;
  companyName: string;
  periodLabel: string;
  range: DateRange;
  report: FinancialReport;
  prevReport?: FinancialReport;
  expenses: { name: string; amount: number }[];
}): string {
  const margin = report.revenue > 0 ? ((report.netProfit / report.revenue) * 100).toFixed(1) : '0';
  const totalExp = expenses.reduce((s, r) => s + r.amount, 0);
  const profitClass = report.netProfit >= 0 ? 'pos' : 'neg';
  const funnel: [string, number, string][] = [
    ['Выручка', report.revenue, ''],
    ['− Себестоимость товаров', -report.productCost, pctOf(report.productCost, report.revenue)],
    ['= Валовая прибыль', report.grossProfit, pctOf(report.grossProfit, report.revenue)],
    ['− Зарплаты', -report.salaries, pctOf(report.salaries, report.revenue)],
  ];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfBaseCss()}</style></head><body>
  ${pdfBrandBar(companyName, periodLabel, 'Финансовый отчёт')}

  <div class="cards">
    <div class="mcard hero">
      <div class="ml">Чистая прибыль</div>
      <div class="mv ${profitClass}">${escapeHtml(formatMoney(report.netProfit))}</div>
    </div>
    <div class="mcard">
      <div class="ml">Оборот</div>
      <div class="mv">${escapeHtml(formatMoney(report.revenue))}</div>
    </div>
    <div class="mcard">
      <div class="ml">Маржа</div>
      <div class="mv">${margin}%</div>
    </div>
  </div>

  <div class="section-title">Финансовая воронка</div>
  <table>
    <thead><tr><th>Показатель</th><th class="num">% от выручки</th><th class="num">Сумма</th></tr></thead>
    <tbody>
    ${funnel
      .map(
        ([n, v, pct]) =>
          `<tr><td>${escapeHtml(n)}</td><td class="num pctcell">${pct ? pct + '%' : ''}</td><td class="num">${escapeHtml(formatMoney(v))}</td></tr>`,
      )
      .join('')}
    <tr class="total"><td>= Чистая прибыль</td><td class="num pctcell">${pctOf(report.netProfit, report.revenue)}%</td><td class="num ${profitClass}">${escapeHtml(formatMoney(report.netProfit))}</td></tr>
    </tbody>
  </table>

  ${
    prevReport
      ? `<div class="section-title">Сравнение с прошлым периодом</div>
  <table>
    <thead><tr><th>Показатель</th><th class="num">Текущий</th><th class="num">Прошлый</th></tr></thead>
    <tbody>
      <tr><td>Выручка</td><td class="num">${escapeHtml(formatMoney(report.revenue))}</td><td class="num">${escapeHtml(formatMoney(prevReport.revenue))}</td></tr>
      <tr><td>Чистая прибыль</td><td class="num">${escapeHtml(formatMoney(report.netProfit))}</td><td class="num">${escapeHtml(formatMoney(prevReport.netProfit))}</td></tr>
    </tbody>
  </table>`
      : ''
  }

  ${
    expenses.length > 0
      ? `<div class="section-title">Расходы по категориям</div>
  <table>
    <thead><tr><th>Категория</th><th class="num">Доля</th><th class="num">Сумма</th></tr></thead>
    <tbody>
    ${expenses
      .slice(0, 10)
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.name)}</td><td class="num pctcell">${totalExp > 0 ? ((e.amount / totalExp) * 100).toFixed(1) : '0'}%</td><td class="num">${escapeHtml(formatMoney(e.amount))}</td></tr>`,
      )
      .join('')}
    </tbody>
  </table>`
      : ''
  }

  <div class="foot">Сформировано в Autexa · ${range.from} — ${range.to}</div>
  </body></html>`;
}

function buildTableHtml({
  companyName,
  periodLabel,
  range,
  report,
  prevReport,
  expenses,
}: {
  companyName: string;
  periodLabel: string;
  range: DateRange;
  report: FinancialReport;
  prevReport?: FinancialReport;
  expenses: { name: string; amount: number }[];
}): string {
  const rows: [string, string, string | null][] = [
    ['Выручка', formatMoney(report.revenue), prevReport ? formatMoney(prevReport.revenue) : null],
    ['Себестоимость', formatMoney(report.productCost), prevReport ? formatMoney(prevReport.productCost) : null],
    ['Валовая прибыль', formatMoney(report.grossProfit), prevReport ? formatMoney(prevReport.grossProfit) : null],
    ['Зарплаты', formatMoney(report.salaries), prevReport ? formatMoney(prevReport.salaries) : null],
    ['Чистая прибыль', formatMoney(report.netProfit), prevReport ? formatMoney(prevReport.netProfit) : null],
    ['Чеков', String(report.checkCount), prevReport ? String(prevReport.checkCount) : null],
  ];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfBaseCss()}</style></head><body>
  ${pdfBrandBar(companyName, periodLabel, 'Сводная таблица')}
  <table>
    <thead><tr><th>Показатель</th><th class="num">Текущий</th><th class="num">Прошлый</th></tr></thead>
    <tbody>
    ${rows
      .map(
        ([n, c, p]) =>
          `<tr><td>${escapeHtml(n)}</td><td class="num">${escapeHtml(c)}</td><td class="num">${p !== null ? escapeHtml(p) : '—'}</td></tr>`,
      )
      .join('')}
    </tbody>
  </table>
  ${
    expenses.length > 0
      ? `<div class="section-title">Расходы по категориям</div>
  <table>
    <thead><tr><th>Категория</th><th class="num">Сумма</th></tr></thead>
    <tbody>
    ${expenses.map((e) => `<tr><td>${escapeHtml(e.name)}</td><td class="num">${escapeHtml(formatMoney(e.amount))}</td></tr>`).join('')}
    </tbody>
  </table>`
      : ''
  }
  <div class="foot">Сформировано в Autexa · ${range.from} — ${range.to} · откройте в Numbers/Excel для дальнейшей работы</div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { padding: spacing[4], paddingBottom: spacing[12] },
  accessDenied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[8] },
  adTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing[4] },
  adDesc: { fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing[2] },

  // Period switcher
  periodWrap: { gap: spacing[2] },
  periodRow: { gap: spacing[2], paddingRight: spacing[4] },
  periodChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], borderRadius: borderRadius.xl },
  periodChipActive: { backgroundColor: colors.primary[600] },
  periodText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  periodTextActive: { color: colors.white },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[1],
  },
  compareLabel: { fontSize: fontSize.sm },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
    ...Platform.select({ android: { elevation: 1 } }),
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
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
  customDateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  customDash: { fontSize: fontSize.sm },

  // Hero
  heroCard: { borderRadius: borderRadius['2xl'], padding: spacing[5], overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginBottom: spacing[1] },
  heroLabel: { fontSize: 11, fontWeight: fontWeight.bold, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  heroValue: { fontSize: 34, lineHeight: 42, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: -0.5 },
  heroSub: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroDeltaWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  heroDeltaSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  // Generic card
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
    overflow: 'hidden',
  },
  cardTitle: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 1, paddingBottom: spacing[3] },
  cardTitleInline: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 1 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  cardIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  cardCaption: { fontSize: 11 },
  sectionLabel: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 1, paddingHorizontal: spacing[1] },

  // Funnel
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  funnelRowFinal: { marginTop: spacing[1] },
  funnelLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], flex: 1 },
  funnelIcon: { width: 28, height: 28, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  funnelLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  funnelPct: { fontSize: 11, marginTop: 1 },
  funnelAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  funnelAmountFinal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  funnelArrowWrap: { alignItems: 'center', paddingVertical: 2 },

  // Delta
  deltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  deltaChipText: { fontSize: 11, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },

  // Collapse
  collapseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapseTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },

  // P&L
  pnlRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2] },
  pnlLabel: { fontSize: fontSize.sm },
  pnlAmount: { fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
  pnlDivider: { height: 1, marginVertical: spacing[1] },
  pnlPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    marginTop: spacing[3],
  },
  pnlPdfText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  // Margin
  marginRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  marginValue: { fontSize: 36, lineHeight: 44, fontWeight: fontWeight.bold, letterSpacing: -0.5 },
  compareLine: { marginTop: spacing[2] },

  // Expenses
  expRow: { marginBottom: spacing[3] },
  expRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  expRowName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, paddingRight: spacing[2] },
  expRowAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  expBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  expBarFill: { height: '100%', borderRadius: 3 },
  expRowPct: { fontSize: 11, marginTop: 4 },

  // Record
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  recordLabel: { fontSize: fontSize.sm },
  recordValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  recordCaption: { fontSize: 11, marginTop: 2 },
  recordHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    marginTop: spacing[2],
  },
  recordHintText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // YoY
  yoyRow: { flexDirection: 'row', gap: spacing[3] },
  yoyLabel: { fontSize: 11, fontWeight: fontWeight.medium, marginBottom: 2 },
  yoyValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[1],
    letterSpacing: -0.5,
  },

  // KPI rings
  kpiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[3] },
  kpiEdit: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  kpiBody: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  kpiRingsWrap: { alignItems: 'center', justifyContent: 'center' },
  kpiLegend: { flex: 1, gap: spacing[2] },
  kpiLegendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  kpiDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  kpiLegendLabel: { fontSize: 11, fontWeight: fontWeight.medium },
  kpiLegendValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  kpiLegendPct: { fontSize: 11, marginTop: 1 },

  // Insight
  insightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[3.5],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
  },
  insightIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  insightText: { flex: 1, fontSize: fontSize.sm, lineHeight: 18 },

  // Forecast
  forecastValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: fontWeight.bold,
    marginVertical: spacing[1],
    letterSpacing: -0.5,
  },

  // Alert
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3.5],
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: borderRadius.lg,
  },
  alertText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // Export
  exportRow: { flexDirection: 'row', gap: spacing[3] },
  exportBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: borderRadius.xl,
  },
  exportBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  // Off-screen capture host — parked far outside the viewport so the
  // Stories card is laid out (capturable) but never visible. opacity must be
  // > 0 (0.01) because the iOS render server skips the subtree under alpha:0,
  // which makes captureRef return a blank PNG — canonical view-shot offscreen idiom.
  offscreenCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0.01 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: spacing[8] },
  modalHandle: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginVertical: spacing[3] },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  modalClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: spacing[5], gap: spacing[3] },
  modalLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  modalSaveBtn: {
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[4],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    marginTop: spacing[3],
  },
  modalSaveText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
