import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  Platform,
  LayoutAnimation,
  UIManager,
  ActivityIndicator,
} from 'react-native';
import IosScreenHeader from '../components/IosScreenHeader';
import DateTimePickerModal from '../components/DateTimePickerModal';
import ModalBlurBackdrop from '../components/ModalBlurBackdrop';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { checksApi, reportsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import AnimatedCard from '../components/AnimatedCard';
import { Skeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';

// ── Android LayoutAnimation enable ──────────────────────────────────────
// Required for collapsible day cards to animate height changes on Android.
// iOS has it on by default. Guarded so HMR doesn't double-register.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Constants ──────────────────────────────────────────────────────────
type Period = 'day' | 'week' | 'month' | 'year' | 'custom';
type Mode = 'all' | 'employee';

// Только 4 "регулярных" чипа в шапке. 'custom' — отдельная кнопка
// "Произвольный диапазон" под шапкой, чтобы не загромождать переключатель.
const HEADER_PERIODS: Exclude<Period, 'custom'>[] = ['day', 'week', 'month', 'year'];

const PERIOD_LABELS: Record<Period, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
  custom: 'Диапазон',
};

const MONTH_LABELS = [
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

// ── Date helpers ───────────────────────────────────────────────────────
function fmt(d: Date) {
  // YYYY-MM-DD in LOCAL time — avoids toISOString() shifting the day by a
  // timezone when the user is east of UTC and the local midnight was an
  // hour ago. The cashflow API expects calendar dates, not UTC instants.
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISO(s: string): Date {
  // Treat the YYYY-MM-DD string as local-date (no TZ shift).
  const [y, m, d] = s.split('-').map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

// Бизнес-таймзона продукта — Europe/Moscow (UTC+3, без переходов на летнее
// время с 2014). /reports/cashflow группирует дни по календарным суткам МСК,
// поэтому drill-down дня обязан запрашивать ровно тот же полуинтервал
// [D 00:00 МСК, D+1 00:00 МСК), сконвертированный в UTC-инстанты (cashflow C3).
const MSK_UTC_OFFSET = '+03:00';
function mskDayStartUtc(day: string): Date {
  return new Date(`${day}T00:00:00${MSK_UTC_OFFSET}`);
}
function mskDayEndUtc(day: string): Date {
  // Эксклюзивная верхняя граница суток МСК (полночь следующего дня).
  return new Date(mskDayStartUtc(day).getTime() + 24 * 60 * 60 * 1000);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  // RU calendar week starts Monday.
  const r = new Date(d);
  const dow = r.getDay();
  const diff = (dow + 6) % 7; // 0 = Mon ... 6 = Sun
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31);
}

function rangeForPeriod(period: Exclude<Period, 'custom'>, anchor: Date): { from: Date; to: Date } {
  if (period === 'day') return { from: anchor, to: anchor };
  if (period === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (period === 'month') return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  return { from: startOfYear(anchor), to: endOfYear(anchor) };
}

function shiftPeriod(period: Exclude<Period, 'custom'>, anchor: Date, dir: -1 | 1): Date {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, dir * 7);
  if (period === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return new Date(anchor.getFullYear() + dir, 0, 1);
}

function periodRangeLabel(period: Period, anchor: Date, customFrom?: Date, customTo?: Date): string {
  if (period === 'custom') {
    if (!customFrom || !customTo) return 'Диапазон';
    const sameYear = customFrom.getFullYear() === customTo.getFullYear();
    const fromStr = customFrom.toLocaleDateString(
      'ru-RU',
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
    );
    const toStr = customTo.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    // Тот же день → одиночная дата.
    if (fmt(customFrom) === fmt(customTo)) return toStr;
    return `${fromStr} – ${toStr}`;
  }
  if (period === 'day') {
    // Краткая "якорная" подпись — "Сегодня" / "Вчера" / "Завтра" — иначе
    // длинная дата. Соответствует общим текстовым подсказкам в приложении.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(anchor);
    day.setHours(0, 0, 0, 0);
    const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (diffDays === 0) return 'Сегодня';
    if (diffDays === -1) return 'Вчера';
    if (diffDays === 1) return 'Завтра';
    return anchor.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (period === 'week') {
    const { from, to } = rangeForPeriod('week', anchor);
    const sameMonth = from.getMonth() === to.getMonth();
    if (sameMonth) {
      return `${from.getDate()}–${to.getDate()} ${MONTH_LABELS[from.getMonth()].toLowerCase()}`;
    }
    const fromStr = from.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const toStr = to.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    return `${fromStr} – ${toStr}`;
  }
  if (period === 'month') {
    return `${MONTH_LABELS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  return `${anchor.getFullYear()}`;
}

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── CheckBadge ─────────────────────────────────────────────────────────
// Crisp "selected" affordance — SF-Symbol `checkmark.circle.fill` look.
//
// ⚠️ Root cause of the "bold/empty circle" artifact (#10.3 / #11.1):
// `@expo/vector-icons` is metro-aliased to an SVG shim (IoniconsShim) that
// maps Ionicons names → lucide-react-native. `checkmark-circle` is mapped
// with `{ lucide: 'CheckCircle', fill: true }`. In lucide v1, `CheckCircle`
// is an alias to `CircleCheckBig`, whose paths are an OPEN arc + a check
// stroke (`M21.801 10A10…` + `m9 11 3 3L22 4`). With `fill={color}` the
// open arc fills into a solid blob and the check stroke disappears — so the
// user sees a bold filled circle with no visible check.
//
// Fix (no shared-file edits): render the bare `checkmark` glyph, which maps
// to lucide `Check` (a stroke-only ✓ path with NO fill and NO circle), on
// top of our own colored ring. Result is a crisp, always-visible check.
function CheckBadge({ size = 18, color = colors.primary[600] }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name="checkmark" size={Math.round(size * 0.66)} color={colors.white} />
    </View>
  );
}

// ── EmployeePickerRow ──────────────────────────────────────────────────
interface EmployeePickerRowProps {
  id: string;
  fullName: string;
  active: boolean;
  onPick: (id: string, fullName: string) => void;
  palette: ReturnType<typeof useColors>;
}
const EmployeePickerRow = React.memo(function EmployeePickerRow({
  id,
  fullName,
  active,
  onPick,
  palette,
}: EmployeePickerRowProps) {
  return (
    <TouchableOpacity
      style={[
        styles.employeeOption,
        active && styles.employeeOptionActive,
        active && palette.mode === 'dark' && { backgroundColor: palette.accent.primarySoft },
      ]}
      onPress={() => onPick(id, fullName)}
    >
      <View style={[styles.employeeAvatar, palette.mode === 'dark' && { backgroundColor: palette.accent.primarySoft }]}>
        <Text style={[styles.employeeAvatarText, palette.mode === 'dark' && { color: palette.accent.primaryText }]}>
          {fullName?.charAt(0) || '?'}
        </Text>
      </View>
      <Text
        style={[
          styles.employeeOptionText,
          { color: palette.text.secondary },
          active && { color: colors.primary[600], fontWeight: fontWeight.bold },
        ]}
      >
        {fullName}
      </Text>
      {active && <CheckBadge size={18} />}
    </TouchableOpacity>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────
export default function CashFlowScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const palette = useColors();
  // «Движение денег» — теперь НЕ только owner-class. Волна 3 (миграция 121):
  // сервер гейтит `/reports/cashflow` через @RequirePermission('cashflow_view')
  // и сам скоупит выдачу (own-vs-all), поэтому экран доступен и обычной роли с
  // выданным `cashflow_view`.
  //   • canViewAllCashFlow — видит движение денег ВСЕГО автосервиса и может
  //     фильтровать по сотруднику: owner-class (director/admin/superadmin) ЛИБО
  //     явный `cashflow_view_all`. Поведение владельца не меняется.
  //   • canViewCashFlow    — доступ к экрану вообще: всё выше ЛИБО own-only
  //     `cashflow_view` (сервер вернёт только его операции).
  // «Права как в Битрикс24» (2026-07): admin живёт по матрице из /auth/me
  // (сид reports.cashflow='all' — поведение 1:1); superadmin/director
  // байпасятся внутри самого hasPermission.
  const canViewAllCashFlow = hasPermission('cashflow_view_all');
  const canViewCashFlow = canViewAllCashFlow || hasPermission('cashflow_view');
  // Own-only держатель `cashflow_view` фильтр по сотруднику НЕ видит: сервер
  // всё равно игнорирует переданный masterId и отдаёт только его операции,
  // поэтому пикер был бы ложным обещанием. Показываем его только тем, кто
  // видит «все».
  const canFilterByEmployee = canViewAllCashFlow;
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = useState(false);

  // Period + anchor date — эти два состояния вместе дают dateFrom/dateTo.
  // anchor — выбранная точка внутри периода (день для 'day', любая дата
  // внутри недели/месяца/года для остальных). Для 'custom' используются
  // customFrom / customTo напрямую.
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState<Date>(today);

  // Custom range. Инициализируется текущим месяцем, активируется только
  // когда period === 'custom' (после нажатия "Произвольный диапазон").
  const [customFrom, setCustomFrom] = useState<Date>(() => startOfMonth(today));
  const [customTo, setCustomTo] = useState<Date>(() => endOfMonth(today));
  const [datePickerMode, setDatePickerMode] = useState<'customFrom' | 'customTo' | null>(null);

  // Filter mode + employee selection.
  const [mode, setMode] = useState<Mode>('all');
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);

  // Which day card is open right now (only one at a time — keeps the
  // scroll content predictable + checks fetched lazily).
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Derived range. Для 'custom' используем кастомные даты напрямую,
  // иначе считаем по anchor через rangeForPeriod.
  const { from: rangeFrom, to: rangeTo } = useMemo(() => {
    if (period === 'custom') return { from: customFrom, to: customTo };
    return rangeForPeriod(period, anchor);
  }, [period, anchor, customFrom, customTo]);
  const dateFrom = useMemo(() => fmt(rangeFrom), [rangeFrom]);
  const dateTo = useMemo(() => fmt(rangeTo), [rangeTo]);

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: employees } = useQuery<any[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
    enabled: canFilterByEmployee,
    placeholderData: (prev) => prev,
  });

  const effectiveEmployeeId = mode === 'employee' ? employeeId : '';

  // Охват 'own' (нет cashflow_view_all): раскрытие дня обязано слать
  // masterId=self — сервер (checks.getAll) отфильтрует строгим ch.master_id,
  // ровно тем же предикатом, каким /reports/cashflow посчитал суммы дня
  // (решение владельца 2026-07-28: деньги мастера = только чеки, где он
  // ГЛАВНЫЙ мастер). Без этого список дня шёл бы по журнальной видимости
  // («свои ИЛИ исполнитель строки» — она шире) и не сходился бы с суммой.
  const drillDownMasterId = canViewAllCashFlow ? effectiveEmployeeId : (user?.id ?? '');

  // Near-live cash flow: poll every 30s but only while the screen is focused
  // (no background battery drain / JS tick when the user is elsewhere). (The
  // client-side If-None-Match/304 layer was removed — see api/axios.ts — so
  // each poll is a normal full GET.) Pattern mirrors CallsScreen's focus-gated
  // poll.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );

  const {
    data: cashflow,
    isLoading,
    isError: isCashflowError,
    refetch: refetchCashflow,
  } = useQuery<any>({
    queryKey: ['cashflow', dateFrom, dateTo, effectiveEmployeeId],
    queryFn: async () => {
      const params: any = { dateFrom, dateTo };
      if (effectiveEmployeeId) params.masterId = effectiveEmployeeId;
      const res = await reportsApi.getCashFlow(params);
      return res.data;
    },
    // Never fire `/reports/cashflow` for a role the server forbids (master →
    // 403). The screen also early-returns a clean «нет доступа» state below,
    // so this is belt-and-suspenders against the 403 → error-card symptom.
    enabled: canViewCashFlow,
    placeholderData: (prev: unknown) => prev,
    refetchOnReconnect: true,
    refetchInterval: canViewCashFlow && pollEnabled ? 30_000 : false,
  });

  // Lazy per-day check list — fires only when a card is expanded.
  const { data: expandedChecks, isLoading: isLoadingChecks } = useQuery<any>({
    queryKey: ['cashflow-day-checks', expandedDay, drillDownMasterId],
    queryFn: async () => {
      if (!expandedDay) return { data: [] };
      // Окно дня — ровно одни московские сутки [D 00:00 МСК, D+1 00:00 МСК).
      // Бэк (checks.getAll) кастует обе границы как
      // `$::date::timestamp AT TIME ZONE 'Europe/Moscow'`, поэтому дату
      // передаём ГОЛОЙ строкой 'YYYY-MM-DD' — ровно как соседний
      // expenses-запрос ниже. Полный ISO-инстант в dateFrom ломал границу:
      // text→date каст отбрасывает tz, и московская полночь '…T21:00:00Z'
      // схлопывалась в предыдущий день → окно расползалось на ДВОЕ суток
      // (список выглядел корректно лишь из-за клиентского среза ниже).
      // isDeferred:false (C4): сумма дня считается только по ПРОВЕДЁННЫМ
      // чекам (reports: is_deferred = false) — открытые драфты в списке
      // выглядели как деньги, которых в итоге дня нет.
      const params: any = {
        dateFrom: expandedDay,
        dateTo: expandedDay,
        isDeferred: false,
        limit: 200,
      };
      if (drillDownMasterId) params.masterId = drillDownMasterId;
      const res = await checksApi.getAll(params);
      return res.data;
    },
    enabled: canViewCashFlow && !!expandedDay,
    // No placeholderData: when the user switches days the rows must reset to
    // undefined so the loading gate shows a spinner instead of briefly
    // flashing the PREVIOUS day's checks + total. These keys aren't
    // persisted, so nothing is lost on day change.
  });

  // Сплит included/warranty + оборонительный срез суток МСК (cashflow C4).
  // После фикса NEW-2 бэк уже возвращает ровно одни московские сутки, поэтому
  // date-фильтр ниже — belt-and-suspenders (страхует от старого закешированного
  // широкого окна). Смысловая часть — сплит:
  // `included` — проведённые НЕ-гарантийные чеки (ровно то, из чего сложен
  // day.total); `warranty` — гарантийные, в day.total не входят — рендерятся
  // отдельной секцией «не входит в итог», чтобы ручная сумма списка сходилась
  // с карточкой дня.
  const expandedDayRows = useMemo(() => {
    const rows: any[] = Array.isArray(expandedChecks?.data) ? expandedChecks.data : [];
    if (!expandedDay) return { included: [] as any[], warranty: [] as any[] };
    const start = mskDayStartUtc(expandedDay).getTime();
    const end = mskDayEndUtc(expandedDay).getTime();
    const inDay = rows.filter((c) => {
      const t = new Date(c?.date).getTime();
      return Number.isFinite(t) && t >= start && t < end;
    });
    return {
      included: inDay.filter((c) => c?.paymentMethod !== 'warranty'),
      warranty: inDay.filter((c) => c?.paymentMethod === 'warranty'),
    };
  }, [expandedChecks, expandedDay]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    await queryClient.invalidateQueries({ queryKey: ['cashflow-day-checks'] });
    setRefreshing(false);
  };

  const handlePickPeriod = useCallback((p: Exclude<Period, 'custom'>) => {
    haptic('select');
    setPeriod(p);
    // При возврате к "регулярному" периоду сбрасываем якорь на сегодня —
    // иначе пользователь видит "May 2020" после долгого custom-диапазона.
    setExpandedDay(null);
  }, []);

  const handleOpenCustomRange = useCallback(() => {
    haptic('tap');
    setPeriod('custom');
    setExpandedDay(null);
    setDatePickerMode('customFrom');
  }, []);

  const handleShift = useCallback(
    (dir: -1 | 1) => {
      // Стрелки активны только для регулярных периодов. Для 'custom'
      // пользователь редактирует диапазон через календарь.
      if (period === 'custom') return;
      haptic('tap');
      setAnchor((prev) => shiftPeriod(period, prev, dir));
      setExpandedDay(null);
    },
    [period],
  );

  const handleConfirmDate = useCallback(
    (d: Date) => {
      if (datePickerMode === 'customFrom') {
        // Если выбрали from > to — выровнять to.
        setCustomFrom(d);
        setCustomTo((prev) => (prev < d ? d : prev));
      } else if (datePickerMode === 'customTo') {
        setCustomTo(d);
        setCustomFrom((prev) => (prev > d ? d : prev));
      }
      setDatePickerMode(null);
      setExpandedDay(null);
    },
    [datePickerMode],
  );

  const handlePickMode = useCallback((m: Mode) => {
    haptic('select');
    if (m === 'employee') {
      // "По сотруднику" всегда открывает пикер — даже если уже выбран
      // кто-то, владелец может захотеть поменять выбор без сброса
      // через "Все сотрудники".
      setShowEmployeePicker(true);
      return;
    }
    setMode('all');
    setEmployeeId('');
    setEmployeeName('');
    setExpandedDay(null);
  }, []);

  const handleClearEmployee = useCallback(() => {
    haptic('select');
    setMode('all');
    setEmployeeId('');
    setEmployeeName('');
    setExpandedDay(null);
  }, []);

  const pickEmployee = useCallback((id: string, fullName: string) => {
    haptic('select');
    setEmployeeId(id);
    setEmployeeName(fullName);
    setMode('employee');
    setShowEmployeePicker(false);
    setExpandedDay(null);
  }, []);

  const toggleDay = useCallback((dayDate: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    haptic('tap');
    setExpandedDay((prev) => (prev === dayDate ? null : dayDate));
  }, []);

  const openCheck = useCallback(
    (id: string) => {
      navigation.navigate('CheckDetail', { id });
    },
    [navigation],
  );

  // ── Derived ──────────────────────────────────────────────────────────
  const totals = useMemo(() => cashflow?.totals || { cash: 0, card: 0, warranty: 0, total: 0 }, [cashflow?.totals]);
  const days = useMemo<any[]>(() => (Array.isArray(cashflow?.days) ? cashflow.days : []), [cashflow?.days]);

  // Sort newest-first so the user reads "what happened today" without
  // scrolling to the bottom of a month.
  const daysSorted = useMemo(() => [...days].sort((a, b) => (a.date < b.date ? 1 : -1)), [days]);

  // Cold-start skeleton — same shape as before (3 placeholder day cards).
  const renderColdStart = () => (
    <View style={{ gap: spacing[3] }}>
      <View
        style={[
          styles.totalsCard,
          { gap: spacing[3], backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
        ]}
      >
        <Skeleton width={140} height={11} radius={4} />
        <Skeleton width={180} height={32} radius={6} />
        <View style={{ gap: spacing[2.5], marginTop: spacing[2] }}>
          <Skeleton width="100%" height={14} radius={4} />
          <Skeleton width="100%" height={14} radius={4} />
          <Skeleton width="100%" height={14} radius={4} />
        </View>
      </View>
      <View style={{ height: spacing[2] }} />
      <Skeleton width={100} height={11} radius={4} style={{ marginLeft: spacing[3] }} />
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.dayCard,
            { gap: spacing[2], backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          ]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton width={110} height={14} radius={4} />
            <Skeleton width={80} height={14} radius={4} />
          </View>
          <Skeleton width="60%" height={12} radius={4} />
        </View>
      ))}
    </View>
  );

  // ── Trailing slot: 4-segment period switcher ─────────────────────────
  // Только 4 регулярных чипа: День / Неделя / Месяц / Год. Произвольный
  // диапазон вынесен отдельной кнопкой ниже, чтобы не загромождать
  // переключатель пятым редко используемым состоянием.
  const periodSwitcher = (
    <View style={[styles.periodSeg, { backgroundColor: palette.bg.muted }]}>
      {HEADER_PERIODS.map((p) => {
        const active = period === p;
        return (
          <TouchableOpacity
            key={p}
            style={[styles.periodSegBtn, active && [styles.periodSegBtnActive, { backgroundColor: palette.bg.card }]]}
            onPress={() => handlePickPeriod(p)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Период: ${PERIOD_LABELS[p]}`}
          >
            <Text
              style={[
                styles.periodSegText,
                { color: palette.text.secondary },
                active && [styles.periodSegTextActive, { color: palette.text.primary }],
              ]}
            >
              {PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // Role-gated access. A master reaching this screen (e.g. via a deep link or
  // a future menu entry) must see a clean «нет доступа» — NEVER a broken
  // error card driven by a 403. No period switcher / queries for this branch.
  if (!canViewCashFlow) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Движение денег" onBack={() => navigation.goBack()} />
        <View style={styles.noAccessWrap}>
          <EmptyState
            title="Нет доступа"
            description="Движение денег доступно владельцу, администратору и сотрудникам, которым выдали это право."
            icon="lock"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Движение денег" onBack={() => navigation.goBack()} trailing={periodSwitcher} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'ios' ? spacing[4] : tabBarHeight + spacing[4] },
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* ── Period sub-header: arrows + central label ───────────────
            Один и тот же контрол для day / week / month / year — пользователю
            не нужно держать в голове два разных способа листать. Для
            'custom' стрелки скрываются (там диапазон редактируется через
            календарь, листать стрелками неоднозначно). */}
        <View style={styles.rangeRow}>
          {period === 'custom' ? (
            <View style={styles.rangeArrowSpacer} />
          ) : (
            <TouchableOpacity
              style={[styles.rangeArrow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => handleShift(-1)}
              activeOpacity={0.7}
              accessibilityLabel="Предыдущий период"
            >
              <Ionicons name="chevron-back" size={18} color={palette.text.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.rangeChip, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={period === 'custom' ? () => setDatePickerMode('customFrom') : undefined}
            activeOpacity={period === 'custom' ? 0.7 : 1}
            accessibilityRole={period === 'custom' ? 'button' : undefined}
          >
            <Text style={[styles.rangeChipText, { color: palette.text.primary }]} numberOfLines={1}>
              {periodRangeLabel(period, anchor, customFrom, customTo)}
            </Text>
          </TouchableOpacity>
          {period === 'custom' ? (
            <View style={styles.rangeArrowSpacer} />
          ) : (
            <TouchableOpacity
              style={[styles.rangeArrow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => handleShift(1)}
              activeOpacity={0.7}
              accessibilityLabel="Следующий период"
            >
              <Ionicons name="chevron-forward" size={18} color={palette.text.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Произвольный диапазон ────────────────────────────────────
            Один низкоприоритетный текстовый action под строкой периода:
            спрятан в чип, чтобы не загромождать переключатель в шапке.
            Для уже активного 'custom' предлагает редактировать диапазон. */}
        <TouchableOpacity
          style={[
            styles.customRangeBtn,
            {
              backgroundColor: period === 'custom' ? palette.bg.card : 'transparent',
              borderColor: palette.border.subtle,
            },
          ]}
          onPress={handleOpenCustomRange}
          activeOpacity={0.7}
        >
          <Ionicons
            name="calendar-outline"
            size={14}
            color={period === 'custom' ? colors.primary[600] : palette.text.tertiary}
          />
          <Text
            style={[
              styles.customRangeBtnText,
              { color: period === 'custom' ? colors.primary[600] : palette.text.tertiary },
            ]}
          >
            {period === 'custom' ? 'Изменить диапазон' : 'Произвольный диапазон'}
          </Text>
        </TouchableOpacity>

        {/* ── Mode tabs: all employees / by employee ─────────────────── */}
        {canFilterByEmployee && (
          <View style={[styles.modeSeg, { backgroundColor: palette.bg.muted }]}>
            <TouchableOpacity
              style={[
                styles.modeSegBtn,
                mode === 'all' && [styles.modeSegBtnActive, { backgroundColor: palette.bg.card }],
              ]}
              onPress={() => handlePickMode('all')}
              activeOpacity={0.7}
            >
              <Ionicons
                name="people-outline"
                size={14}
                color={mode === 'all' ? palette.text.primary : palette.text.secondary}
              />
              <Text
                style={[
                  styles.modeSegText,
                  { color: palette.text.secondary },
                  mode === 'all' && [styles.modeSegTextActive, { color: palette.text.primary }],
                ]}
                numberOfLines={1}
              >
                Все сотрудники
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeSegBtn,
                mode === 'employee' && [styles.modeSegBtnActive, { backgroundColor: palette.bg.card }],
              ]}
              onPress={() => handlePickMode('employee')}
              activeOpacity={0.7}
            >
              <Ionicons
                name="person-outline"
                size={14}
                color={mode === 'employee' ? palette.text.primary : palette.text.secondary}
              />
              <Text
                style={[
                  styles.modeSegText,
                  { color: palette.text.secondary },
                  mode === 'employee' && [styles.modeSegTextActive, { color: palette.text.primary }],
                ]}
                numberOfLines={1}
              >
                {mode === 'employee' && employeeName ? employeeName : 'По сотруднику'}
              </Text>
              {/* Кнопка-сброс × появляется только когда сотрудник реально
                  выбран — иначе чип «По сотруднику» работает как кнопка
                  «открыть пикер». hitSlop увеличен, чтобы можно было
                  попасть пальцем рядом с надписью. */}
              {mode === 'employee' && employeeId ? (
                <TouchableOpacity
                  onPress={handleClearEmployee}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Сбросить выбор сотрудника"
                  style={[styles.clearXBadge, { backgroundColor: palette.bg.muted }]}
                >
                  {/* `close` → lucide `X` (stroke-only) avoids the filled-circle
                      glyph artifact; our own ring gives the badge shape. */}
                  <Ionicons name="close" size={11} color={palette.text.secondary} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Body ───────────────────────────────────────────────────── */}
        {isCashflowError && cashflow === undefined ? (
          // Запрос упал и кэша нет — честный error-state вместо вечного
          // скелетона. Пока есть прошлые данные, SWR показывает их.
          <QueryErrorState description="Проверьте соединение и попробуйте ещё раз" onRetry={() => refetchCashflow()} />
        ) : cashflow === undefined ? (
          renderColdStart()
        ) : !cashflow && !isLoading ? (
          <EmptyState title="Нет операций" description="За выбранный период чеков не было" icon="wallet" />
        ) : (
          <>
            {/* Hero totals card */}
            <AnimatedCard
              index={0}
              style={[styles.totalsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[iosSectionLabel, { marginBottom: 4, color: palette.text.tertiary }]}>
                Итого за {PERIOD_LABELS[period].toLowerCase()}
              </Text>
              <Text style={[styles.totalsHero, { color: palette.text.primary }]}>{formatMoney(totals.total)}</Text>
              <View style={styles.totalsBreakdown}>
                <ChannelRow
                  iconName="cash-outline"
                  iconBg={colors.green[50]}
                  iconColor={colors.green[600]}
                  label="Наличные"
                  amount={totals.cash}
                  total={totals.total}
                  palette={palette}
                />
                <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                <ChannelRow
                  iconName="card-outline"
                  iconBg={colors.blue[50]}
                  iconColor={colors.blue[600]}
                  label="Карта"
                  amount={totals.card}
                  total={totals.total}
                  palette={palette}
                />
                <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                <ChannelRow
                  iconName="shield-checkmark-outline"
                  iconBg={colors.yellow[50]}
                  iconColor={colors.yellow[700]}
                  label="Гарантия"
                  amount={totals.warranty}
                  total={totals.total}
                  palette={palette}
                  note={totals.warranty > 0 ? 'справочно · в оборот не входит' : undefined}
                />
                {/* «По гарантии» — УБЫТОК за период (запчасти + выплата мастеру).
                    Отдельная красная строка: в оборот (Итого) не входит и НЕ
                    задваивается с «Гарантией» выше (та — отпускная стоимость,
                    справочно). Поле опциональное — старый бэк его не шлёт. */}
                {typeof totals.warrantyLoss === 'number' && totals.warrantyLoss > 0 && (
                  <>
                    <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                    <View style={styles.channelRow}>
                      <View
                        style={[
                          styles.channelIcon,
                          {
                            backgroundColor:
                              palette.mode === 'dark' ? softTint(colors.rose[600], 'dark') : colors.rose[50],
                          },
                        ]}
                      >
                        <Ionicons name="trending-down-outline" size={16} color={colors.rose[600]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>Убыток по гарантии</Text>
                        <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>
                          Запчасти + выплата мастеру — в оборот не входит
                        </Text>
                      </View>
                      <Text style={[styles.channelAmount, { color: colors.rose[600] }]}>
                        −{formatMoney(totals.warrantyLoss)}
                      </Text>
                    </View>
                  </>
                )}
                {/* 4-я корзина: непогашенный долг по чекам в рассрочку. Вместе
                    с нал/картой/гарантией сходится к обороту копейка в копейку
                    (поле опциональное — старый бэк его не шлёт, строку прячем). */}
                {typeof totals.installmentDebt === 'number' && totals.installmentDebt > 0 && (
                  <>
                    <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                    <ChannelRow
                      iconName="time-outline"
                      iconBg={colors.purple[50]}
                      iconColor={colors.purple[600]}
                      label="Рассрочка (долг)"
                      amount={totals.installmentDebt}
                      total={totals.total}
                      palette={palette}
                    />
                  </>
                )}
                {/* Информационная строка: погашения рассрочки за период по дате
                    платежа. Это деньги за ПРОШЛЫЕ продажи — в оборот (Итого) не
                    входят, поэтому без «% от итого» и с плюсом. */}
                {typeof totals.installmentPaid === 'number' && totals.installmentPaid > 0 && (
                  <>
                    <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                    <View style={styles.channelRow}>
                      <View
                        style={[
                          styles.channelIcon,
                          {
                            backgroundColor:
                              palette.mode === 'dark' ? softTint(colors.teal[600], 'dark') : colors.teal[50],
                          },
                        ]}
                      >
                        <Ionicons name="checkmark-done-outline" size={16} color={colors.teal[600]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>Погашения рассрочки</Text>
                        <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>
                          Деньги за прошлые продажи — в оборот не входят
                        </Text>
                        {/* Разбивка по способу оплаты (119) — только когда бэк
                            прислал поля и часть ненулевая. */}
                        {(() => {
                          const parts: string[] = [];
                          if (typeof totals.installmentPaidCash === 'number' && totals.installmentPaidCash > 0) {
                            parts.push(`наличными ${formatMoney(totals.installmentPaidCash)}`);
                          }
                          if (typeof totals.installmentPaidCard === 'number' && totals.installmentPaidCard > 0) {
                            parts.push(`картой ${formatMoney(totals.installmentPaidCard)}`);
                          }
                          return parts.length > 0 ? (
                            <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>
                              в т.ч. {parts.join(' · ')}
                            </Text>
                          ) : null;
                        })()}
                      </View>
                      <Text style={[styles.channelAmount, { color: colors.teal[600] }]}>
                        +{formatMoney(totals.installmentPaid)}
                      </Text>
                    </View>
                  </>
                )}
                {/* «Касса за период» — реально полученные деньги: нал + карта +
                    погашения рассрочки. «Итого» выше — начисленный оборот (в нём
                    сидит долг рассрочки), received — то, что физически легло в
                    кассу. Поле опциональное — старый бэк его не шлёт. */}
                {typeof totals.received === 'number' && (
                  <>
                    <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                    <View style={styles.channelRow}>
                      <View
                        style={[
                          styles.channelIcon,
                          {
                            backgroundColor:
                              palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50],
                          },
                        ]}
                      >
                        <Ionicons name="wallet-outline" size={16} color={colors.green[600]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>
                          Касса за {PERIOD_LABELS[period].toLowerCase()}
                        </Text>
                        <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>
                          Наличные + карта + погашения рассрочки
                        </Text>
                      </View>
                      <Text style={[styles.channelAmount, { color: colors.green[600] }]}>
                        {formatMoney(totals.received)}
                      </Text>
                    </View>
                  </>
                )}
                {/* Возвраты по ДАТЕ ВОЗВРАТА — информационно: деньги уже вычтены
                    из дня ПРОДАЖИ (реверс ног в returns.service), поэтому в
                    «Итого» не входят и второй раз из кассы не вычитаются. */}
                {typeof totals.refunds === 'number' && totals.refunds > 0 && (
                  <>
                    <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                    <View style={styles.channelRow}>
                      <View
                        style={[
                          styles.channelIcon,
                          {
                            backgroundColor:
                              palette.mode === 'dark' ? softTint(colors.rose[600], 'dark') : colors.rose[50],
                          },
                        ]}
                      >
                        <Ionicons name="arrow-undo-outline" size={16} color={colors.rose[600]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>Возвраты</Text>
                        <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>
                          Уже вычтены из дня продажи — в итог не входят
                        </Text>
                      </View>
                      <Text style={[styles.channelAmount, { color: colors.rose[600] }]}>
                        −{formatMoney(totals.refunds)}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </AnimatedCard>

            {/* Days list */}
            <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.tertiary }]}>
              {period === 'day' ? 'За день' : 'По дням'}
            </Text>
            {daysSorted.length === 0 ? (
              <EmptyState title="Нет операций" description="Нет операций за выбранный период" icon="receipt" />
            ) : (
              daysSorted.map((day: any, idx: number) => {
                // День приходит строкой 'YYYY-MM-DD' (бэк отдаёт to_char по
                // МСК); slice(0,10) — страховка от закешированного старого
                // формата (pg-Date сериализовался полным ISO — именно этот
                // сырой ключ и порождал мусорное окно drill-down, C3).
                const dayKey = String(day.date).slice(0, 10);
                const isOpen = expandedDay === dayKey;
                const dateObj = parseISO(dayKey);
                return (
                  <AnimatedCard
                    key={dayKey}
                    style={[styles.dayCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                    index={idx + 1}
                  >
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => toggleDay(dayKey)}
                      style={styles.dayHeader}
                      accessibilityRole="button"
                      accessibilityLabel={`Раскрыть чеки за ${dateObj.toLocaleDateString('ru-RU')}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.dayDate, { color: palette.text.primary }]}>
                          {dateObj.toLocaleDateString('ru-RU', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'long',
                          })}
                        </Text>
                      </View>
                      <Text style={[styles.dayTotal, { color: palette.text.primary }]}>{formatMoney(day.total)}</Text>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={palette.text.tertiary}
                        style={{ marginLeft: spacing[2] }}
                      />
                    </TouchableOpacity>
                    <View style={[styles.dayDetails, { borderTopColor: palette.border.subtle }]}>
                      {day.cash > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.green[500] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Нал: {formatMoney(day.cash)}
                          </Text>
                        </View>
                      )}
                      {day.card > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.blue[500] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Карта: {formatMoney(day.card)}
                          </Text>
                        </View>
                      )}
                      {day.warranty > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.yellow[500] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Гарант: {formatMoney(day.warranty)}
                          </Text>
                        </View>
                      )}
                      {/* Убыток по гарантии за день — красным. В day.total (оборот)
                          не входит; поле опциональное. */}
                      {typeof day.warrantyLoss === 'number' && day.warrantyLoss > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.rose[500] }]} />
                          <Text style={[styles.dayDetailText, { color: colors.rose[600] }]}>
                            Убыток гарантии: −{formatMoney(day.warrantyLoss)}
                          </Text>
                        </View>
                      )}
                      {typeof day.installmentDebt === 'number' && day.installmentDebt > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.purple[600] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Рассрочка: {formatMoney(day.installmentDebt)}
                          </Text>
                        </View>
                      )}
                      {/* Погашение по дате платежа — без него день, где было
                          только погашение (бэк добавляет его нулевой строкой),
                          выглядел бы пустой карточкой с «0 ₽». */}
                      {typeof day.installmentPaid === 'number' && day.installmentPaid > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.teal[600] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Погашение: +{formatMoney(day.installmentPaid)}
                          </Text>
                        </View>
                      )}
                      {/* Касса за день — реально полученные деньги (нал + карта +
                          погашения); отличается от итога дня, когда есть долг
                          рассрочки. Поле опциональное — старый бэк его не шлёт. */}
                      {typeof day.received === 'number' && day.received > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.primary[500] }]} />
                          <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                            Касса за день: {formatMoney(day.received)}
                          </Text>
                        </View>
                      )}
                      {/* Возвраты по дате возврата — информационно: из итога дня
                          продажи уже вычтены, второй раз не минусуются. */}
                      {typeof day.refunds === 'number' && day.refunds > 0 && (
                        <View style={styles.dayDetailItem}>
                          <View style={[styles.dayDot, { backgroundColor: colors.rose[500] }]} />
                          <Text style={[styles.dayDetailText, { color: colors.rose[600] }]}>
                            Возвраты: −{formatMoney(day.refunds)} · уже вычтены из дня продажи
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Expanded — income (checks) for this day. Lazy-loads on
                        expand. Расходы/оплаты поставщикам сюда не входят —
                        «Движение денег» показывает только приход (волна G). */}
                    {isOpen && (
                      <View style={[styles.checksSection, { borderTopColor: palette.border.subtle }]}>
                        {/* ── Доходы: чеки (госномер + сумма) ──────────── */}
                        <View style={styles.detailSubLabelRow}>
                          <View style={[styles.detailDot, { backgroundColor: colors.green[500] }]} />
                          <Text style={[styles.detailSubLabel, { color: palette.text.tertiary }]}>Чеки</Text>
                        </View>
                        {isLoadingChecks && !expandedChecks ? (
                          <View style={{ paddingVertical: spacing[3], alignItems: 'center' }}>
                            <ActivityIndicator color={colors.primary[500]} />
                          </View>
                        ) : expandedDayRows.included.length === 0 && expandedDayRows.warranty.length === 0 ? (
                          <Text style={[styles.checksEmpty, { color: palette.text.tertiary }]}>
                            Нет чеков за этот день
                          </Text>
                        ) : (
                          <>
                            {expandedDayRows.included.map((c: any) => (
                              <CheckRow key={c.id} check={c} palette={palette} onPress={() => openCheck(c.id)} />
                            ))}
                            {/* Гарантийные чеки дня — справочно: их totalRevenue
                                НЕ входит в итог дня (day.total), поэтому они
                                вынесены из основного списка, чтобы ручная
                                сумма строк сходилась с карточкой (C4). */}
                            {expandedDayRows.warranty.length > 0 && (
                              <>
                                <View style={[styles.detailSubLabelRow, { marginTop: spacing[2] }]}>
                                  <View style={[styles.detailDot, { backgroundColor: colors.yellow[500] }]} />
                                  <Text style={[styles.detailSubLabel, { color: palette.text.tertiary }]}>
                                    Гарантия — не входит в итог
                                  </Text>
                                </View>
                                {expandedDayRows.warranty.map((c: any) => (
                                  <CheckRow key={c.id} check={c} palette={palette} onPress={() => openCheck(c.id)} />
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </AnimatedCard>
                );
              })
            )}

            {/* Footer note about deferred checks */}
            <Text style={[styles.footerNote, { color: palette.text.tertiary }]}>
              {'\u{1F4A1} '}Отложенные чеки попадают в выручку в день их проведения, не в день создания
            </Text>
          </>
        )}
      </ScrollView>

      {/* Employee picker modal */}
      <Modal
        visible={showEmployeePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEmployeePicker(false)}
      >
        <View style={styles.modalRoot}>
          <ModalBlurBackdrop onPress={() => setShowEmployeePicker(false)} />
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: palette.bg.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: palette.border.subtle }]}>
              <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Выберите сотрудника</Text>
              <TouchableOpacity onPress={() => setShowEmployeePicker(false)}>
                <Ionicons name="close" size={22} color={palette.text.secondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.employeeOption,
                !employeeId && styles.employeeOptionActive,
                !employeeId && palette.mode === 'dark' && { backgroundColor: palette.accent.primarySoft },
              ]}
              onPress={() => {
                setEmployeeId('');
                setEmployeeName('');
                setMode('all');
                setShowEmployeePicker(false);
                setExpandedDay(null);
              }}
            >
              <Ionicons
                name="people-outline"
                size={18}
                color={!employeeId ? colors.primary[600] : palette.text.secondary}
              />
              <Text
                style={[
                  styles.employeeOptionText,
                  { color: palette.text.secondary },
                  !employeeId && { color: colors.primary[600], fontWeight: fontWeight.bold },
                ]}
              >
                Все сотрудники
              </Text>
            </TouchableOpacity>
            {/* Сотрудников в тенанте редко больше 10-15, поэтому FlashList
                здесь приносит больше хлопот (estimatedItemSize в маленьком
                Modal'е иногда схлопывает контейнер до 0), чем пользы.
                Обычный ScrollView гарантирует, что строки видны и пресс
                по любой из них срабатывает. */}
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {(Array.isArray(employees) ? employees : []).map((item: any) => (
                <EmployeePickerRow
                  key={item.id}
                  id={item.id}
                  fullName={item.fullName}
                  active={employeeId === item.id}
                  onPick={pickEmployee}
                  palette={palette}
                />
              ))}
            </ScrollView>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Календарь — два независимых пика: from, потом to. После from
          автоматически открываем to, чтобы не приходилось дважды
          нажимать "Произвольный диапазон". */}
      <DateTimePickerModal
        visible={datePickerMode !== null}
        value={datePickerMode === 'customTo' ? customTo : customFrom}
        mode="date"
        onConfirm={(d) => {
          const wasFrom = datePickerMode === 'customFrom';
          handleConfirmDate(d);
          // После выбора начала сразу открываем выбор конца — естественная
          // pattern для range-picker'а на одной модалке.
          if (wasFrom) {
            requestAnimationFrame(() => setDatePickerMode('customTo'));
          }
        }}
        onCancel={() => setDatePickerMode(null)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChannelRow — single line inside the Итого card. Icon | label + share% | amount.
// ─────────────────────────────────────────────────────────────────────────────
function ChannelRow({
  iconName,
  iconBg,
  iconColor,
  label,
  amount,
  total,
  palette,
  note,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  amount: number;
  total: number;
  palette: ReturnType<typeof useColors>;
  // Когда задан — подпись под строкой показывает `note` вместо «% от итого».
  // Нужен для «Гарантии»: она справочная и в оборот (Итого) не входит, поэтому
  // доля «% от итого» для неё была бы вводящей в заблуждение.
  note?: string;
}) {
  const pct = total > 0 ? ((amount / total) * 100).toFixed(0) : '0';
  return (
    <View style={styles.channelRow}>
      <View
        style={[
          styles.channelIcon,
          { backgroundColor: palette.mode === 'dark' ? softTint(iconColor, 'dark') : iconBg },
        ]}
      >
        <Ionicons name={iconName} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>{label}</Text>
        {note ? (
          <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>{note}</Text>
        ) : (
          total > 0 &&
          amount > 0 && <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>{pct}% от итого</Text>
        )}
      </View>
      <Text style={[styles.channelAmount, { color: palette.text.primary }]}>{formatMoney(amount)}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CheckRow — minimal one-line row inside an expanded day card.
// Number + employee + amount + chevron. Taps push CheckDetail on the root stack.
// ─────────────────────────────────────────────────────────────────────────────
function CheckRow({
  check,
  palette,
  onPress,
}: {
  check: any;
  palette: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const masterName: string = check?.master?.fullName || '—';
  const carPlate: string | undefined = check?.car?.plateNumber;
  // Щит — ТОЛЬКО гарантия. Раньше он был fallback'ом и доставался также
  // cash_card и рассрочке, что путало владельца при сверке кассы.
  const method: string | undefined = check?.paymentMethod;
  const channelIcon: keyof typeof Ionicons.glyphMap =
    method === 'cash'
      ? 'cash-outline'
      : method === 'card'
        ? 'card-outline'
        : method === 'installment'
          ? 'time-outline' // рассрочка: «оплата растянута во времени»
          : method === 'warranty'
            ? 'shield-checkmark-outline'
            : 'receipt-outline';
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.checkRow}>
      <View style={[styles.checkIcon, { backgroundColor: palette.bg.muted }]}>
        {method === 'cash_card' ? (
          // Смешанная оплата: банкнота + карта в одном бейдже.
          <View style={styles.checkIconPair}>
            <Ionicons name="cash-outline" size={11} color={palette.text.secondary} />
            <Ionicons name="card-outline" size={11} color={palette.text.secondary} />
          </View>
        ) : (
          <Ionicons name={channelIcon} size={14} color={palette.text.secondary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.checkPrimary, { color: palette.text.primary }]} numberOfLines={1}>
          № {check.number} · {masterName}
        </Text>
        {!!carPlate && (
          <Text style={[styles.checkSecondary, { color: palette.text.tertiary }]} numberOfLines={1}>
            {carPlate}
          </Text>
        )}
      </View>
      <Text style={[styles.checkAmount, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue || 0)}</Text>
      <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  noAccessWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing[6] },
  scrollContent: { padding: spacing[4], gap: spacing[3] },

  // Period switcher (header trailing)
  periodSeg: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.full,
    padding: 2,
  },
  periodSegBtn: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 38,
  },
  periodSegBtnActive: {
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  periodSegText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gray[500],
    letterSpacing: -0.1,
  },
  periodSegTextActive: { color: colors.gray[900], fontWeight: '700' },

  // Range chip + arrows — единый контрол для всех периодов, включая
  // 'day'. Прежний горизонтальный карусель день-чипов удалён: владелец
  // считал её "over-engineered", стрелка ← Сегодня → читается быстрее
  // и масштабируется одинаково на день / неделю / месяц / год.
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rangeArrow: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Placeholder ровно той же ширины, что и rangeArrow — нужен в
  // 'custom'-режиме, чтобы центральная подпись осталась по центру
  // строки, а не уехала к краю.
  rangeArrowSpacer: { width: 40, height: 40 },
  rangeChip: {
    flex: 1,
    height: 40,
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.white,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
  },
  rangeChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    textTransform: 'capitalize',
  },

  // Произвольный диапазон — тонкая пилюля под строкой периода
  customRangeBtn: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customRangeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // Mode tabs (all / by employee)
  modeSeg: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.full,
    padding: 3,
  },
  modeSegBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
  },
  modeSegBtnActive: {
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  modeSegText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray[500],
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  modeSegTextActive: { color: colors.gray[900], fontWeight: '700' },
  // Round ✕ badge — crisp `X` glyph on a muted ring (no filled-circle glyph).
  clearXBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Totals card — hero
  totalsCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  totalsHero: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -0.6,
    marginBottom: spacing[3],
  },
  totalsBreakdown: { gap: 0 },
  totalsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[200],
    marginVertical: spacing[2.5],
  },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  channelIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  channelShare: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  channelAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Section
  sectionLabel: {
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },

  // Day cards
  dayCard: {
    ...iosCard,
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[4],
  },
  dayHeader: { flexDirection: 'row', alignItems: 'center' },
  dayDate: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    textTransform: 'capitalize',
  },
  dayTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  dayDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  dayDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayDetailText: { fontSize: fontSize.xs, color: colors.gray[500] },

  // Expanded checks section inside a day card
  checksSection: {
    marginTop: spacing[3],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
    gap: spacing[1],
  },
  checksEmpty: {
    fontSize: fontSize.xs,
    paddingVertical: spacing[2],
    textAlign: 'center',
  },
  // Sub-label row inside an expanded day ("Чеки" / "Расходы")
  detailSubLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing[1],
  },
  detailDot: { width: 6, height: 6, borderRadius: 3 },
  detailSubLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
  },
  checkIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // cash_card: два мини-глифа (банкнота+карта) в одном 28px-бейдже.
  checkIconPair: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  checkPrimary: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  checkSecondary: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  checkAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Footer note about deferred checks
  footerNote: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    textAlign: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
    lineHeight: 18,
  },

  // Modal — backdrop is ModalBlurBackdrop (frosted blur), this is just the
  // centering container above it.
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    width: '100%',
    maxHeight: 440,
    borderRadius: 20,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  modalTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  employeeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  employeeOptionActive: { backgroundColor: colors.primary[50] },
  employeeOptionText: { flex: 1, fontSize: fontSize.sm, color: colors.gray[700] },
  employeeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeAvatarText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[700] },
});
