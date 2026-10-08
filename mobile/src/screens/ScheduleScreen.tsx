import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import {
  Animated as RNAnimated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  AccessibilityInfo,
  Alert,
  Dimensions,
  InteractionManager,
  Switch,
  type GestureResponderEvent,
} from 'react-native';
import Reanimated, {
  FadeIn,
  FadeInDown,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
  scrollTo,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
// SafeAreaView no longer used — IosScreenHeader handles top inset
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { openEmployee } from '../navigation/entityLinks';
import { scheduleApi, scheduleSettingsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { formatDayKey, formatTimeShort } from '../../../shared/utils/formatters';
import { useColors } from '../contexts/ThemeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import IosScreenHeader from '../components/IosScreenHeader';
import PointIndicator from '../components/PointIndicator';
import AnimatedCard from '../components/AnimatedCard';
import QueryErrorState from '../components/QueryErrorState';
import EmptyState from '../components/EmptyState';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { usePointUsers, USERS_POINT_QUERY_KEY } from '../hooks/useUsers';
import type { TodayEmployeeStatus, ScheduleEntry, ScheduleSettings, User, WorkMode } from '../../../shared/types';
import {
  calculateAttendanceStats,
  attendanceScore,
  emptyBreakdown,
  recordedAttendanceBucket,
} from '../../../shared/utils/attendance';
import { decideScheduleView } from './scheduleViewState';
import ShiftAttendanceHistory from './ShiftAttendanceHistory';
import { attendanceCalendarDate } from './shiftAttendanceHelpers';
import { invalidateAttendanceQueries } from '../../../shared/utils/attendanceQueries';
import { useAttendanceRefresh } from '../hooks/useAttendanceRefresh';
import { manualSchedulePayload, SCHEDULE_WEEKDAYS, type QuickAttendanceChoice } from './scheduleEditing';
import WorkModeEditor from './WorkModeEditor';
import ScheduleDayHoursForm from './ScheduleDayHoursForm';
import { getCellDot, getTodayStatusInfo, gridAttendanceCounts } from './scheduleAttendance';

type TabType = 'grid' | 'today' | 'shifts' | 'rating' | 'settings';

/**
 * Schedule month state lifted to the parent screen so the month picker
 * can live in the unified IosScreenHeader (trailing slot) instead of
 * floating as a separate row inside GridTab.
 *
 * GridTab and TodayTab consume the context; missing-context fallback
 * returns the local state pattern from before, so older code paths keep
 * working in isolation.
 */
const ScheduleMonthCtx = React.createContext<{
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
} | null>(null);

function useScheduleMonth() {
  const ctx = React.useContext(ScheduleMonthCtx);
  if (!ctx) {
    throw new Error('useScheduleMonth must be inside ScheduleMonthCtx.Provider');
  }
  return ctx;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const DAY_ABBR = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = [
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

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= count; i++) days.push(new Date(year, month, i));
  return days;
}

/**
 * toArray — единственный источник истины для приведения любого
 * query-результата к массиву.
 *
 * КОРЕНЬ КРАША (REACT-NATIVE-6 «undefined is not a function»):
 * `usersData || []` и `entries ?? []` защищают ТОЛЬКО от null/undefined,
 * но НЕ от truthy-не-массива. В окна, когда backend временно отдаёт 502
 * (рестарт контейнера на деплое / нагрузка), а также через persistent
 * cache (`hydrateCache` пишет в QueryClient любой сохранённый `data`,
 * не проверяя форму) в кэш ключей `['users']` / `['schedule', …]` мог
 * попасть объект (например `{ statusCode, message }` или иной не-массив).
 * Тогда `obj.filter` === `undefined` → вызов внутри useMemo
 * (`activeUsers` ~стр.751, `entryMap` ~стр.812) бросал «undefined is not
 * a function», ронял весь экран в per-screen ErrorBoundary, и в
 * расписание было «вообще не зайти».
 *
 * Лечение фундаментальное: жёстко приводим к массиву через
 * `Array.isArray(x) ? x : []` И в queryFn (чтобы в кэш никогда не лёг
 * не-массив), И на месте использования (чтобы даже отравленный
 * hydrated-кэш деградировал в пустой список, а не в краш). Метод массива
 * больше нигде не вызывается на возможно-не-массиве.
 */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * useReduceMotion — reads iOS / Android system "Reduce Motion" preference.
 * Defensive: never throws even if the platform API behaves oddly.
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    let sub: { remove?: () => void } | null = null;
    try {
      AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
        if (alive) setReduce(!!v);
      });
      sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduce(!!v));
    } catch {
      // ignore — animations will run by default
    }
    return () => {
      alive = false;
      try {
        sub?.remove?.();
      } catch {
        /* noop */
      }
    };
  }, []);
  return reduce;
}

function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

function directionGroupId(user: User): string | null {
  return user.directionId ?? null;
}

const AVATAR_COLORS = [
  [colors.primary[500], colors.primary[700]],
  [colors.green[500], colors.green[700]],
  [colors.orange[500], colors.orange[600]],
  [colors.purple[700], colors.indigo[600]],
  [colors.teal[600], colors.green[700]],
  [colors.rose[500], colors.rose[600]],
  [colors.amber[600], colors.orange[600]],
  [colors.blue[500], colors.blue[700]],
];

function getAvatarColors(name?: string): string[] {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Status descriptor used by the grid (Apple-Fitness-style) cells.
 *
 * Apple Health / Apple Fitness inspired:
 *   • cell gets a SOFT tinted background (shade-50 in light, ~15 % alpha in
 *     dark) — no full saturated rectangles, no emojis.
 *   • a single Ionicon sits centered in the cell, drawn in the semantic
 *     status colour. The icon IS the status indicator.
 *   • a tiny 9 pt "HH:MM" label appears UNDER the icon only when the
 *     shift has a meaningful start time (i.e. the user explicitly set
 *     a non-default start). Default "09:00" on every worked day is
 *     suppressed to kill noise.
 *
 * Fields:
 *   key       — one of 'worked' | 'dayoff' | 'sick' | 'short' | 'long' |
 *               'absent' | null. The same keys are used by the settings
 *               sub-tab so the owner can toggle which statuses count as
 *               an attendance "shift".
 *   icon      — Ionicons glyph to render centred in the cell.
 *   dotColor  — primary status colour (semantic, kept identical in dark
 *               mode — owner wants reds to stay red).
 *   bgColor   — light-mode cell tint (shade 50).
 *   bgDark    — dark-mode cell tint (rgba primary 15 % alpha equivalent).
 *   label     — optional small "HH:MM" label rendered under the icon. Only
 *               present for the on-time worked case AND only if the shift
 *               start is not the implicit default "09:00".
 *   hasEntry  — true when a real entry exists for that day.
 */
/**
 * TodayPill — composite "Сегодня" badge + day number used in the grid
 * header for today's column. The small uppercase label sits ABOVE the
 * day number inside a single softly-tinted pill so the eye snaps to
 * the current column at a glance (Apple Calendar / Apple Fitness style).
 *
 * No animation: the previous pulsing halo was visual noise compared to
 * the rest of the SF-Health-inspired grid. A static pill reads better
 * and respects Reduce Motion implicitly.
 */
function TodayPill({ day }: { day: number; reduceMotion?: boolean }) {
  return (
    <View style={styles.gridTodayCircle}>
      <Text
        style={styles.gridTodayLabel}
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        СЕГОДНЯ
      </Text>
      <Text style={styles.gridTodayNum} allowFontScaling={false}>
        {day}
      </Text>
    </View>
  );
}

// Skeleton placeholder shown while the schedule grid loads for the first time.
// Renders 6 ghost rows so the user sees the structure of the grid instead of
// a generic spinner — much closer to native iOS apps (Calendar, Reminders).
function GridSkeleton() {
  const palette = useColors();
  const dark = palette.mode === 'dark';
  // Two placeholder shades so the shimmer keeps its layered look in both
  // modes — darker block for the prominent rows, fainter for secondary.
  const shadeA = dark ? palette.border.strong : colors.gray[200];
  const shadeB = dark ? palette.border.subtle : colors.gray[100];
  return (
    <View style={{ flex: 1, paddingTop: 4 }}>
      {[...Array(6)].map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[2],
            gap: spacing[3],
            alignItems: 'center',
            opacity: 1 - i * 0.12,
          }}
        >
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: shadeA }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ width: '50%', height: 11, borderRadius: 4, backgroundColor: shadeA }} />
            <View style={{ width: '30%', height: 9, borderRadius: 4, backgroundColor: shadeB }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[...Array(5)].map((__, j) => (
              <View key={j} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: shadeB }} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// GridDayHeaderRow — sticky day-number / day-of-week header above the grid.
// Memoised because the cells (~30 per month) were being rebuilt on every
// parent render (every QuickPopup open/close, every pending change). With
// stable primitive props (`days`, `today`, `CELL_W`, `ROW_H`) the row
// re-renders only when the month or row geometry actually changes.
// ──────────────────────────────────────────────────────────────────────
interface GridDayHeaderRowProps {
  days: Date[];
  today: string;
  CELL_W: number;
  ROW_H: number;
  reduceMotion: boolean;
  borderColor: string;
  weekendBg: string;
  weekendText: string;
  dayText: string;
  dowText: string;
  todayColumnBg: string;
}
const GridDayHeaderRow = memo(function GridDayHeaderRow({
  days,
  today,
  CELL_W,
  ROW_H,
  reduceMotion,
  borderColor,
  weekendBg,
  weekendText,
  dayText,
  dowText,
  todayColumnBg,
}: GridDayHeaderRowProps) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {days.map((d) => {
        const ds = formatDate(d);
        const dow = (d.getDay() + 6) % 7;
        const isWeekend = dow >= 5;
        const isToday = ds === today;
        return (
          <View
            key={ds}
            style={[
              styles.gridHeaderCell,
              {
                width: CELL_W,
                height: ROW_H + 6, // header is slightly taller to fit the "Сегодня" pill
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: borderColor,
              },
              isWeekend && { backgroundColor: weekendBg },
              isToday && { backgroundColor: todayColumnBg },
            ]}
          >
            <Text
              style={[
                styles.gridHeaderDow,
                { color: dowText },
                isWeekend && { color: weekendText },
                isToday && { color: colors.primary[600] },
              ]}
              allowFontScaling={false}
            >
              {DAY_ABBR[dow]}
            </Text>
            {isToday ? (
              <TodayPill day={d.getDate()} reduceMotion={reduceMotion} />
            ) : (
              <Text
                style={[styles.gridHeaderDay, { color: dayText }, isWeekend && { color: weekendText }]}
                allowFontScaling={false}
              >
                {d.getDate()}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
});

// Memoized grid row to avoid re-rendering all cells on unrelated state changes.
interface GridDayRowProps {
  userId: string;
  userName?: string;
  days: Date[];
  entryMap: Map<string, ScheduleEntry>;
  rowIdx: number;
  today: string;
  canEdit: boolean;
  CELL_W: number;
  ROW_H: number;
  onCellPress: (userId: string, date: string, entry: ScheduleEntry | undefined, userName?: string) => void;
  // palette tokens — passed down so the row can render correctly in both
  // light and dark mode without each cell calling useColors().
  isDark: boolean;
  dividerColor: string;
  rowStripBg: string;
  todayColumnBg: string;
  weekendColumnBg: string;
  emptyDotColor: string;
}

const GridDayRow = memo(function GridDayRow({
  userId,
  userName,
  days,
  entryMap,
  rowIdx,
  today,
  canEdit,
  CELL_W,
  ROW_H,
  onCellPress,
  isDark,
  dividerColor,
  rowStripBg,
  todayColumnBg,
  weekendColumnBg,
  emptyDotColor,
}: GridDayRowProps) {
  const firstName = userName?.split(' ')[0];

  // ONE row-level Pressable instead of 28–31 TouchableOpacity instances
  // per row: a full month with ~12 masters was mounting 300-500 touchable
  // natives synchronously during the push transition, blocking the JS
  // thread — the screen appeared frozen/blank. The cells are a fixed
  // CELL_W grid, so the tapped day is derived from the touch X offset.
  // Cells render `pointerEvents="none"` so the hit test always targets
  // the row itself and `locationX` is row-relative on both platforms.
  const handleRowPress = (evt: GestureResponderEvent) => {
    const idx = Math.floor(evt.nativeEvent.locationX / CELL_W);
    if (idx < 0 || idx >= days.length) return;
    const ds = formatDate(days[idx]);
    const entry = entryMap.get(`${userId}-${ds}`);
    if (canEdit) haptic('tap');
    onCellPress(userId, ds, entry, firstName);
  };

  return (
    <Pressable
      onPress={handleRowPress}
      style={[{ flexDirection: 'row', height: ROW_H }, rowIdx % 2 === 1 && { backgroundColor: rowStripBg }]}
      // 44pt min hit target — each cell column is CELL_W=44 wide and the
      // row is ROW_H ≥ 44pt tall, so every tappable day region meets the
      // iOS HIG tap-target requirement.
    >
      {days.map((d) => {
        const ds = formatDate(d);
        const entry = entryMap.get(`${userId}-${ds}`);
        const cell = getCellDot(entry, today);
        const dow = (d.getDay() + 6) % 7;
        const isWeekend = dow >= 5;
        const isToday = ds === today;

        // SF Fitness / Apple Health style — when an entry exists the cell
        // gets a SOFT semantic tint (shade-50 in light, ~15 % alpha in
        // dark) and an Ionicon at its centre. No top hairline accent —
        // it added visual noise without improving scannability.
        const cellBg = cell.hasEntry
          ? isDark
            ? cell.bgDark
            : cell.bgColor
          : isToday
            ? todayColumnBg
            : isWeekend
              ? weekendColumnBg
              : 'transparent';

        return (
          <View
            key={ds}
            pointerEvents="none"
            style={[
              styles.gridCell,
              {
                width: CELL_W,
                height: ROW_H,
                backgroundColor: cellBg,
                borderRightColor: dividerColor,
                borderBottomColor: dividerColor,
              },
              isToday && styles.gridCellToday,
            ]}
          >
            {cell.hasEntry && cell.icon ? (
              cell.label ? (
                <View style={styles.gridCellInner}>
                  <Ionicons name={cell.icon} size={18} color={cell.dotColor} />
                  <Text
                    style={[styles.gridCellLabel, { color: cell.dotColor }]}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {cell.label}
                  </Text>
                </View>
              ) : (
                <Ionicons name={cell.icon} size={20} color={cell.dotColor} />
              )
            ) : cell.label ? (
              <Text style={[styles.gridCellLabel, { color: isDark ? colors.gray[300] : cell.dotColor }]}>
                {cell.label}
              </Text>
            ) : (
              canEdit && <View style={[styles.gridCellEmpty, { backgroundColor: emptyDotColor }]} />
            )}
          </View>
        );
      })}
    </Pressable>
  );
});

// ============== GRID TAB ==============
function GridTab() {
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const reduceMotion = useReduceMotion();
  const navigation = useNavigation<any>();
  const { user, hasPermission } = useAuth();
  const palette = useColors();
  // «Сегодня» в графике — по календарю АВТОСЕРВИСА: тем же поясом сервер решает,
  // какие дни уже отработаны (salary.workedShiftsByUser).
  const tenantTz = useTenantTimezone();
  const dark = palette.mode === 'dark';
  // Мутации расписания — ключ schedule_manage (сервер: POST/PATCH/DELETE
  // /schedule → тот же ключ; «права как в Битрикс24», 2026-07: admin живёт по
  // матрице из /auth/me, superadmin/director байпасятся внутри hasPermission).
  const canEdit = hasPermission('schedule_manage');
  // Lifted month state — same Date instance across the screen, driven
  // from the IosScreenHeader month picker.
  const { currentMonth, setCurrentMonth } = useScheduleMonth();
  const [quickPopup, setQuickPopup] = useState<{
    userId: string;
    date: string;
    entry?: ScheduleEntry;
    userName?: string;
  } | null>(null);
  const [editHours, setEditHours] = useState(false);
  const [reorderUser, setReorderUser] = useState<{ userId: string; name: string; index: number } | null>(null);
  // Ephemeral, non-blocking error notice for a failed quick-action. The owner
  // explicitly does NOT want a blocking Alert per tap — a failed optimistic
  // status rolls back silently and surfaces this auto-dismissing banner +
  // an error haptic instead. Cleared on a timer so it never lingers.
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showQuickError = useCallback((msg: string) => {
    setQuickError(msg);
    if (quickErrorTimer.current) clearTimeout(quickErrorTimer.current);
    quickErrorTimer.current = setTimeout(() => setQuickError(null), 2600);
  }, []);
  useEffect(() => {
    return () => {
      if (quickErrorTimer.current) clearTimeout(quickErrorTimer.current);
    };
  }, []);
  // Per-cell re-entrancy guard for instant quick-actions. Mirrors the
  // `dayOffInFlight` pattern in SettingsTab: a double-tap on the SAME
  // `${userId}-${date}` cell must not fire two create/update round-trips
  // (the 2nd would duplicate the row or race the first to an inconsistent
  // state). A ref (not state) so the guard is synchronous within a frame.
  const cellInFlight = useRef<Set<string>>(new Set());

  // Synced vertical scroll refs.
  //
  // The grid has two ScrollViews that must scroll vertically together:
  //   • left  — sticky names column
  //   • right — day cells
  //
  // Earlier iterations used onScroll (JS) → scrollTo() (JS) sync with a
  // setTimeout debounce. On a 120Hz iPhone that fired up to 120 events
  // per second, each round-tripping through the bridge — the source of
  // the lag the owner reported. We now sync ON THE UI THREAD with
  // Reanimated's useAnimatedScrollHandler + scrollTo:
  //   • the LEFT scroll is the master; its onScroll is a worklet that
  //     writes its offset into a sharedValue and immediately calls
  //     scrollTo(rightAnimatedRef, ...) — both happen on the UI thread,
  //     no bridge.
  //   • when the user scrolls the RIGHT side, the same logic mirrors
  //     back so the names column follows.
  //   • a guard sharedValue prevents the two handlers from echoing each
  //     other into an infinite loop.
  const leftAnimatedRef = useAnimatedRef<Reanimated.ScrollView>();
  const rightAnimatedRef = useAnimatedRef<Reanimated.ScrollView>();
  const scrollY = useSharedValue(0);
  const scrollSource = useSharedValue<'idle' | 'left' | 'right'>('idle');

  // Defensive: currentMonth defaults to today, but in case state ever
  // gets out of shape we fall back to "now" so year/month never become
  // NaN and the header text always renders.
  const safeMonth = currentMonth instanceof Date && !isNaN(currentMonth.getTime()) ? currentMonth : new Date();
  const year = safeMonth.getFullYear();
  const month = safeMonth.getMonth();
  const dateFrom = formatDate(new Date(year, month, 1));
  const dateTo = formatDate(new Date(year, month + 1, 0));
  const today = formatDayKey(new Date(), tenantTz);

  const {
    data: entries,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom, dateTo });
      // Жёсткое приведение к массиву — см. toArray(). Даже если сервер
      // в окне 502 вернул не-массив, в кэш ляжет [].
      return toArray<ScheduleEntry>(res.data);
    },
    // keep previous month visible while next month loads — no flash to empty
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  // ['users', 'point'] — КОМАНДА ТЕКУЩЕГО ФИЛИАЛА (167): строки сетки — это
  // сотрудники этого автосервиса (назначенные на него + не назначенные никуда),
  // а дни строк сервер отдаёт только этого филиала. Через общий хук форма
  // гарантированно `User[]` у всех читателей, поэтому грид не схлопывается в
  // «Нет мастеров» из-за чужой формы кэша.
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    isSuccess: usersSuccess,
    refetch: refetchUsers,
  } = usePointUsers();

  // Deferred grid mount — the month grid is ~300-450 cells; mounting it
  // synchronously during the push transition blocked the JS thread and
  // the screen looked frozen. First render paints the cheap GridSkeleton;
  // the real grid mounts after the navigation animation settles.
  //
  // КОРЕНЬ БАГА «открывается со второго раза»: раньше `gridReady` зависел
  // ИСКЛЮЧИТЕЛЬНО от InteractionManager.runAfterInteractions. Его коллбэк
  // выполняется только когда ВСЕ interaction-handles завершены; если хэндл
  // push-анимации (или тача, открывшего экран) не снялся — очередь не
  // дренится, `gridReady` навсегда остаётся false, и при первом открытии
  // виден только GridSkeleton (грид «не открылся»). Второй тап генерил новые
  // события, очередь дренилась, грид появлялся — отсюда «со второго раза».
  //
  // Лечение: гонка между runAfterInteractions и коротким fallback-таймером.
  // Кто сработает первым — поднимает `gridReady`; повторные вызовы setState
  // идемпотентны. Грид гарантированно появляется с первого открытия даже
  // если interaction-очередь застряла. Оба источника снимаются на unmount.
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setGridReady(true));
    // Длиннее типичной push-анимации (~300мс), но достаточно, чтобы экран
    // никогда не «завис» на скелетоне, если очередь interactions не дренится.
    const fallback = setTimeout(() => setGridReady(true), 350);
    return () => {
      task.cancel();
      clearTimeout(fallback);
    };
  }, []);

  // Prefetch adjacent months so swiping the month pager feels instant — by
  // the time the user actually goes to Dec/Feb, the data is already cached.
  // Gated behind gridReady: the warm-up requests must not compete with the
  // first paint of the current month.
  React.useEffect(() => {
    if (!gridReady) return;
    const prevMonth = new Date(year, month - 1, 1);
    const nextMonth = new Date(year, month + 1, 1);
    [prevMonth, nextMonth].forEach((m) => {
      const from = formatDate(new Date(m.getFullYear(), m.getMonth(), 1));
      const to = formatDate(new Date(m.getFullYear(), m.getMonth() + 1, 0));
      queryClient.prefetchQuery({
        queryKey: ['schedule', from, to],
        queryFn: async () => {
          const res = await scheduleApi.getAll({ dateFrom: from, dateTo: to });
          return toArray<ScheduleEntry>(res.data);
        },
        staleTime: 30_000,
      });
    });
  }, [gridReady, year, month, queryClient]);

  // Master list shown as rows in the schedule grid. Robust against any
  // shape of usersData (undefined, null, empty, missing isActive flags):
  //   1. Take everything that has an id and isn't explicitly inactive.
  //   2. If we got nothing AND we know the current user → fall back to it
  //      so the grid never looks "broken" for a fresh tenant.
  //   3. Sort by sortOrder, then by fullName.
  // Schedule grid shows MASTERS only — owners (superadmin / director)
  // and back-office admins don't need shifts on a service-bay roster.
  // The auth-user fallback also gets filtered here so a director who
  // signs in alone doesn't see themselves on the grid.
  const activeUsers = useMemo(() => {
    const isSchedulable = (u: any) => {
      if (!u || !u.id) return false;
      if (u.isActive === false) return false;
      // Employees flagged hidden_from_schedule disappear from the grid
      // (and the attendance rating) — owners are excluded below by role.
      if (u.hiddenFromSchedule) return false;
      // «Скрыть везде» is a superset of «скрыть из графика» — it must also
      // remove the employee from the schedule grid and the rating.
      if (u.hiddenEverywhere) return false;
      const role = (u.role || '').toString().toLowerCase();
      return role !== 'superadmin' && role !== 'director' && role !== 'owner';
    };
    // toArray, не `usersData || []`: отравленный (или hydrated из persistent
    // cache) не-массив здесь деградирует в [], а не в `obj.filter`-краш.
    const raw = toArray<User>(usersData).filter(isSchedulable);
    if (raw.length > 0) {
      return raw.sort((a: any, b: any) => {
        const aUnassigned = a.directionId == null;
        const bUnassigned = b.directionId == null;
        if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
        const group = (a.directionName?.trim() || '\uffff').localeCompare(b.directionName?.trim() || '\uffff', 'ru');
        if (group !== 0) return group;
        const groupId = (a.directionId ?? '').localeCompare(b.directionId ?? '');
        if (groupId !== 0) return groupId;
        const ao = a.sortOrder ?? 0;
        const bo = b.sortOrder ?? 0;
        if (ao !== bo) return ao - bo;
        return (a.fullName || '').localeCompare(b.fullName || '');
      });
    }
    if (user && isSchedulable(user)) {
      return [user as unknown as User];
    }
    return [];
  }, [usersData, user]);

  const scheduleDisplayRows = useMemo(() => {
    const displayRows: Array<
      { kind: 'direction'; key: string; label: string } | { kind: 'employee'; key: string; user: User; index: number }
    > = [];
    let previousGroupId: string | null = null;
    let hasPreviousGroup = false;
    activeUsers.forEach((employee, index) => {
      const groupId = employee.directionId ?? null;
      if (!hasPreviousGroup || groupId !== previousGroupId) {
        displayRows.push({
          kind: 'direction',
          key: `direction:${JSON.stringify([groupId === null, groupId])}`,
          label: groupId === null ? 'Без направления' : employee.directionName || 'Без названия',
        });
        previousGroupId = groupId;
        hasPreviousGroup = true;
      }
      displayRows.push({ kind: 'employee', key: `employee:${employee.id}`, user: employee, index });
    });
    return displayRows;
  }, [activeUsers]);

  const updateOrderMut = useMutation({
    mutationFn: (orderedIds: string[]) => usersApi.updateOrder(orderedIds),
    onMutate: async (orderedIds: string[]) => {
      // Оптимистично правим слот команды филиала — им и рисуется сетка;
      // onSettled ниже инвалидирует префикс ['users'], то есть оба слота.
      await queryClient.cancelQueries({ queryKey: USERS_POINT_QUERY_KEY });
      const prev = queryClient.getQueryData<any>(USERS_POINT_QUERY_KEY);
      queryClient.setQueryData<any>(USERS_POINT_QUERY_KEY, (old: unknown) => {
        // toArray: never .map a poisoned non-array users cache value.
        if (!Array.isArray(old)) return old;
        return old.map((u: any) => {
          const idx = orderedIds.indexOf(u.id);
          return idx >= 0 ? { ...u, sortOrder: idx } : u;
        });
      });
      return prev;
    },
    onError: (_e, _v, ctx) => {
      // Откат + ВИДИМЫЙ фидбек (волна C): молчаливый откат перестановки
      // выглядел как «приложение не слушается» — без связи порядок тихо
      // прыгал обратно.
      if (ctx) queryClient.setQueryData(USERS_POINT_QUERY_KEY, ctx);
      haptic('error');
      showQuickError('Не удалось сохранить порядок. Попробуйте ещё раз.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const moveMaster = (userId: string, dir: 'up' | 'down') => {
    const moved = activeUsers.find((employee) => employee.id === userId);
    if (!moved) return;
    const groupUsers = activeUsers.filter((employee) => directionGroupId(employee) === directionGroupId(moved));
    const groupIndex = groupUsers.findIndex((employee) => employee.id === userId);
    const newGroupIndex = dir === 'up' ? Math.max(0, groupIndex - 1) : Math.min(groupUsers.length - 1, groupIndex + 1);
    if (groupIndex < 0 || groupIndex === newGroupIndex) return;
    const reorderedGroup = groupUsers.map((employee) => employee.id);
    [reorderedGroup[groupIndex], reorderedGroup[newGroupIndex]] = [
      reorderedGroup[newGroupIndex],
      reorderedGroup[groupIndex],
    ];
    const groupPositions = activeUsers.flatMap((employee, index) =>
      directionGroupId(employee) === directionGroupId(moved) ? [index] : [],
    );
    const next = activeUsers.map((employee) => employee.id);
    groupPositions.forEach((position, index) => {
      next[position] = reorderedGroup[index];
    });
    updateOrderMut.mutate(next);
  };

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const entryMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    // toArray, не `entries ?? []`: то же самое — не-массив в кэше не должен
    // звать `.forEach` на не-массиве.
    toArray<ScheduleEntry>(entries).forEach((e) => {
      // Skip orphaned / malformed rows: an entry with no userId or no
      // usable date can't be keyed and would otherwise poison lookups.
      if (!e || !e.userId) return;
      const d = String(e.date ?? '').split('T')[0] || '';
      if (!d) return;
      map.set(`${e.userId}-${d}`, e);
    });
    // Optimistic quick-actions write straight into the ['schedule', …] query
    // cache (see quickAction → applyOptimistic), so `entries` already reflects
    // every staged change — no separate pending overlay to merge here.
    return map;
  }, [entries]);

  const userStats = useMemo(() => {
    const stats = new Map<string, { worked: number; off: number }>();
    activeUsers.forEach((u) => {
      const rowEntries = days.map((d) => entryMap.get(`${u.id}-${formatDate(d)}`));
      stats.set(u.id, gridAttendanceCounts(rowEntries, today));
    });
    return stats;
  }, [activeUsers, days, entryMap, today]);

  const scheduleQueryKey = ['schedule', dateFrom, dateTo];

  // applyOptimistic — write a quick-action result straight into the
  // ['schedule', dateFrom, dateTo] query cache so the tapped cell repaints
  // with ZERO delay (no «Применить» step, no waiting for the server). Returns
  // the previous cache snapshot so the caller can roll back on a failed
  // round-trip. Single source of truth for the optimistic patch — replaces the
  // old never-called optimisticUpdate/patchCache/create/update mutation pair
  // that the audit flagged as racy dead code.
  const applyOptimistic = useCallback(
    (userId: string, date: string, payload: any, existingEntry?: ScheduleEntry): unknown => {
      const previous = queryClient.getQueryData(scheduleQueryKey);
      queryClient.setQueryData(scheduleQueryKey, (old: unknown) => {
        const arr = toArray<ScheduleEntry>(old);
        if (existingEntry) {
          return arr.map((e) => (e.id === existingEntry.id ? ({ ...e, ...payload } as ScheduleEntry) : e));
        }
        const temp = {
          // Локальный id строки, которой на сервере ещё нет. Заменяется ответом
          // create'а (см. quickAction) — не «когда-нибудь на refetch».
          id: placeholderId(userId, date),
          tenantId: '',
          userId,
          date,
          isManualOverride: true,
          ...payload,
        } as ScheduleEntry;
        return [...arr, temp];
      });
      return previous;
    },
    [queryClient, scheduleQueryKey],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: scheduleQueryKey });
      const previous = queryClient.getQueryData(scheduleQueryKey);
      queryClient.setQueryData(scheduleQueryKey, (old: unknown) =>
        toArray<ScheduleEntry>(old).filter((e) => e.id !== id),
      );
      return previous;
    },
    onError: (_e: any, _d: any, ctx: any) => {
      // Откат + видимый фидбек (волна C): ячейка исчезала оптимистично и
      // молча возвращалась — мастер думал, что смена удалена, а связи не было.
      if (ctx) queryClient.setQueryData(scheduleQueryKey, ctx);
      haptic('error');
      showQuickError('Не удалось удалить смену. Попробуйте ещё раз.');
    },
    onSettled: () => {
      void invalidateAttendanceQueries(queryClient);
      setQuickPopup(null);
    },
  });

  const quickAction = (type: string) => {
    if (!quickPopup) return;
    const { userId, date, entry } = quickPopup;

    if (type === 'delete' && entry) {
      // Guard against a double-tap firing two DELETEs (the 2nd 404s and is
      // swallowed, but it's a wasted round-trip and a race).
      if (deleteMutation.isPending) return;
      // Плейсхолдер на сервере не существует — DELETE по нему упал бы на
      // приведении к uuid. Строка ещё не доехала: убираем её локально.
      if (isPlaceholderId(entry.id)) {
        queryClient.setQueryData(scheduleQueryKey, (old: unknown) =>
          toArray<ScheduleEntry>(old).filter((e) => e.id !== entry.id),
        );
        setQuickPopup(null);
        return;
      }
      deleteMutation.mutate(entry.id);
      return;
    }

    // Per-cell re-entrancy guard — a fast double-tap on the same cell must
    // not fire two create/update round-trips off the same stale entry.
    const cellKey = `${userId}-${date}`;
    if (cellInFlight.current.has(cellKey)) return;

    const base = manualSchedulePayload(
      type as QuickAttendanceChoice,
      userId,
      date,
      formatDayKey(new Date(), tenantTz),
      entry,
    );

    // INSTANT apply — no «Применить» step. Repaint the cell immediately by
    // writing the new entry into the schedule cache, then fire the network
    // call in the background. The owner taps a status → it shows at once.
    //   1. close the popup right away (the cell already reflects the choice);
    //   2. optimistically patch the cache (existingEntry → update, else add);
    //   3. POST/PATCH in the background using the real entry id;
    //   4. on error → roll back the exact snapshot + error haptic + a light
    //      auto-dismissing banner (never a blocking Alert per tap);
    //   5. on success → background-refetch to swap the temp row for the real
    //      one (and refresh «Сегодня»). The guard clears in `finally`.
    // Selection haptic the instant the value is applied — tactile
    // confirmation that the status is SET now, not after a round-trip.
    haptic('select');
    setQuickPopup(null);
    cellInFlight.current.add(cellKey);
    const previous = applyOptimistic(userId, date, base, entry);
    // id, под которым строка сейчас лежит в кэше: либо настоящий с сервера,
    // либо наш плейсхолдер. Нужен ниже, чтобы заменить его ответом сервера.
    const optimisticId = entry?.id ?? placeholderId(userId, date);
    void (async () => {
      try {
        // ВАЖНО: PATCH только по НАСТОЯЩЕМУ id.
        //
        // Раньше условие было просто `if (entry?.id)`, а плейсхолдер — такой же
        // id, как любой другой. Если человек успевал тапнуть второй раз до
        // того, как долетал невыжидаемый invalidate, в PATCH уходило
        // «temp-<userId>-<date>»: сервер спотыкался на приведении к uuid,
        // отвечал 500, и catch ниже откатывал ячейку с «Не удалось
        // сохранить» — хотя день на сервере был сохранён. Владелец видел, как
        // отметка прихода отскакивает назад, и решал, что график сломан.
        if (entry?.id && !isPlaceholderId(entry.id)) {
          await scheduleApi.update(entry.id, base);
        } else {
          // Сверяемся по ОТВЕТУ, а не по последующему refetch: плейсхолдер
          // перестаёт существовать в тот момент, когда сервер ответил, а не
          // когда-нибудь потом. Это и закрывает гонку в корне.
          const created = await scheduleApi.create(base);
          const saved = created?.data;
          if (saved?.id) {
            queryClient.setQueryData(scheduleQueryKey, (old: unknown) =>
              toArray<ScheduleEntry>(old).map((e) =>
                e.id === optimisticId ? ({ ...e, ...saved } as ScheduleEntry) : e,
              ),
            );
          }
        }
        void invalidateAttendanceQueries(queryClient);
      } catch {
        // Roll back to the pre-tap snapshot so the cell reverts to its old
        // state — no half-applied, no blocking dialog.
        queryClient.setQueryData(scheduleQueryKey, previous);
        haptic('error');
        showQuickError('Не удалось сохранить. Попробуйте ещё раз.');
      } finally {
        cellInFlight.current.delete(cellKey);
      }
    })();
  };

  const CELL_W = 44;
  const NAME_W = 140;
  const ROW_H = 52;

  // UI-thread scroll handlers — keep names column and grid cells locked
  // to the same vertical offset on every frame, on the UI thread, with
  // ZERO JS-bridge round-trip per scroll event. The owner's "names and
  // cells live as separate screens" complaint was the JS sync drift;
  // this resolves it.
  const handleLeftScrollWorklet = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        'worklet';
        // Ignore echoes — only the touched side drives the sync.
        if (scrollSource.value === 'right') return;
        scrollSource.value = 'left';
        scrollY.value = e.contentOffset.y;
        scrollTo(rightAnimatedRef, 0, e.contentOffset.y, false);
      },
      onEndDrag: () => {
        'worklet';
        scrollSource.value = 'idle';
      },
      onMomentumEnd: () => {
        'worklet';
        scrollSource.value = 'idle';
      },
    },
    [],
  );

  const handleRightScrollWorklet = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        'worklet';
        if (scrollSource.value === 'left') return;
        scrollSource.value = 'right';
        scrollY.value = e.contentOffset.y;
        scrollTo(leftAnimatedRef, 0, e.contentOffset.y, false);
      },
      onEndDrag: () => {
        'worklet';
        scrollSource.value = 'idle';
      },
      onMomentumEnd: () => {
        'worklet';
        scrollSource.value = 'idle';
      },
    },
    [],
  );

  const handleCellPress = useCallback(
    (userId: string, date: string, entry: ScheduleEntry | undefined, userName?: string) => {
      if (canEdit) {
        setEditHours(false);
        setQuickPopup({ userId, date, entry, userName });
      }
    },
    [canEdit],
  );

  // Какое состояние рисуем — единая чистая функция (см. scheduleViewState.ts).
  //
  // КОРЕНЬ БАГА «Нет мастеров, хотя мастера есть»: пустой массив `[]` из
  // протухшего persistentCache (status ещё не 'success') раньше проваливался
  // в empty-state, т.к. условие смотрело на `usersData === undefined`. Теперь
  // empty показываем ТОЛЬКО при подтверждённом успехе запроса ['users'].
  // `hasCachedUsers` — есть ли вообще пользователи в кэше (placeholder/stale):
  // при них держим грид/skeleton, а не мигаем error.
  const hasCachedUsers = toArray<User>(usersData).length > 0;
  const view = decideScheduleView({
    gridReady,
    isLoadingUsers: usersLoading,
    isErrorUsers: usersError,
    isSuccessUsers: usersSuccess,
    activeUsersCount: activeUsers.length,
    hasCachedUsers,
    scheduleError: isError,
  });

  return (
    <View style={{ flex: 1 }}>
      {/* Month picker is now lifted to ScheduleScreen's header
          (ScheduleMonthCtx). A hairline refresh indicator at the top of
          the tab still tells the user we're re-validating cached data. */}
      {isFetching && !isLoading && (
        <View style={styles.bgRefreshIndicator}>
          <ActivityIndicator size="small" color={colors.primary[500]} />
        </View>
      )}

      {/* Error banner — appears only if the network request fails AND we
          have no cached data to fall back on. With cached data we silently
          keep showing it, since intermittent connectivity shouldn't break
          the UX. */}
      {isError && !entries && (
        <TouchableOpacity
          onPress={() => refetch()}
          style={[
            styles.errorBanner,
            palette.mode === 'dark' && {
              backgroundColor: softTint(colors.red[600], 'dark'),
              borderColor: palette.border.subtle,
            },
          ]}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cloud-offline-outline"
            size={16}
            color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
          />
          <Text style={[styles.errorBannerText, palette.mode === 'dark' && { color: colors.red[300] }]}>
            Не удалось загрузить расписание. Нажмите чтобы повторить.
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick-action error notice — a status tap applies instantly and
          optimistically; if the background save fails we roll the cell back
          and surface this light, auto-dismissing banner (NOT a blocking
          Alert per tap). Tap to dismiss early. */}
      {quickError && (
        <Reanimated.View entering={FadeInDown.duration(180)}>
          <TouchableOpacity
            onPress={() => setQuickError(null)}
            activeOpacity={0.8}
            style={[
              styles.errorBanner,
              palette.mode === 'dark'
                ? { backgroundColor: softTint(colors.red[600], 'dark'), borderColor: palette.border.subtle }
                : { borderColor: colors.red[200] },
            ]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
            />
            <Text style={[styles.errorBannerText, palette.mode === 'dark' && { color: colors.red[300] }]}>
              {quickError}
            </Text>
          </TouchableOpacity>
        </Reanimated.View>
      )}

      {/* Legend — icon-based, mirrors the SF-Health-inspired cell
          glyphs. Emojis are intentionally absent: the grid reads as a
          native iOS app, not a chat-bot transcript.
          Horizontal-scroll so the row never wraps awkwardly on small
          devices; each item gets a soft tinted background so the icon
          + label read as a single legible chip. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.legendScroll}
        contentContainerStyle={styles.legendRow}
      >
        {[
          // Each legend chip carries a light pair (color/bg) and a dark pair
          // (darkColor/darkBg) so the chip reads the same way in both modes:
          // saturated fills stay saturated, pale shade-50 fills become a
          // translucent tint of the same hue on the dark canvas.
          {
            icon: 'checkmark' as const,
            color: colors.green[100],
            bg: colors.green[600],
            darkColor: colors.green[100],
            darkBg: colors.green[600],
            label: 'Отработано',
          },
          {
            icon: 'checkmark' as const,
            color: colors.green[700],
            bg: colors.green[50],
            darkColor: colors.green[300],
            darkBg: 'rgba(34,197,94,0.18)',
            label: 'Смена',
          },
          {
            icon: 'moon-outline' as const,
            color: colors.gray[500],
            bg: colors.gray[100],
            darkColor: colors.gray[300],
            darkBg: 'rgba(148,163,184,0.15)',
            label: 'Вых',
          },
          {
            icon: 'medkit-outline' as const,
            color: colors.orange[600],
            bg: colors.orange[50],
            darkColor: colors.orange[400],
            darkBg: 'rgba(234,88,12,0.18)',
            label: 'Б/Л',
          },
          {
            icon: 'time-outline' as const,
            color: colors.amber[600],
            bg: colors.amber[50],
            darkColor: '#fbbf24',
            darkBg: 'rgba(217,119,6,0.18)',
            label: '<1ч',
          },
          {
            icon: 'warning-outline' as const,
            color: colors.red[500],
            bg: colors.red[50],
            darkColor: colors.red[400],
            darkBg: 'rgba(239,68,68,0.16)',
            label: '>1ч',
          },
          {
            icon: 'close' as const,
            color: colors.red[600],
            bg: colors.red[50],
            darkColor: colors.red[400],
            darkBg: 'rgba(220,38,38,0.18)',
            label: 'Прогул',
          },
        ].map((item) => (
          <View key={item.label} style={[styles.legendItem, { backgroundColor: dark ? item.darkBg : item.bg }]}>
            <Ionicons name={item.icon} size={12} color={dark ? item.darkColor : item.color} />
            {/* allowFontScaling off: legend sits in a fixed height:34 band and
                would clip/overflow under large Dynamic Type. */}
            <Text allowFontScaling={false} style={[styles.legendText, { color: palette.text.secondary }]}>
              {item.label}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Schedule states — решение вынесено в чистую decideScheduleView()
          (scheduleViewState.ts), покрытую юнит-тестами. Экран ОБЯЗАН
          спокойно рендериться, когда API лежит:
          • 'skeleton' — push-анимация ещё идёт, ИЛИ первая загрузка, ИЛИ
            stale-рефетч пустого кэша (пустой `[]` из persistentCache до
            подтверждения сервером). НИКОГДА не «Нет мастеров» здесь —
            это и есть фикс бага «нет мастеров, хотя мастера есть».
          • 'error'    — ['users'] или ['schedule'] упали И нет кэша.
          • 'empty'    — запрос ['users'] ПОДТВЕРЖДЁННО успешен и мастеров
            нет (единственное легальное место для «Нет мастеров»).
          • 'grid'     — есть мастера. activeUsers фолбэчится на auth-user,
            так что свежий тенант рисует одну строку. */}
      {view === 'skeleton' ? (
        <GridSkeleton />
      ) : view === 'error' ? (
        <QueryErrorState
          title="Не удалось загрузить расписание"
          description="Сервер временно недоступен. Потяните, чтобы обновить, или нажмите «Повторить»."
          onRetry={() => {
            if (usersError) refetchUsers();
            if (isError) refetch();
          }}
        />
      ) : view === 'empty' ? (
        <EmptyState
          icon="people"
          title="Нет мастеров"
          description="Чтобы планировать смены, добавьте сотрудников в разделе «Пользователи»"
        />
      ) : (
        /* Schedule grid — the names column and the day grid sync ON THE
           UI THREAD via reanimated useAnimatedScrollHandler + scrollTo,
           no JS bridge round-trip per scroll frame. */
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Sticky left column -- employee names with avatar initials */}
          <View
            style={[styles.stickyColumn, { backgroundColor: palette.bg.card, borderRightColor: palette.border.subtle }]}
          >
            {/* Header cell — matches the day-header height (ROW_H + 6) so
                the day numbers stay vertically aligned with the names. */}
            <View
              style={[
                styles.gridNameCell,
                {
                  width: NAME_W,
                  height: ROW_H + 6,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                },
              ]}
            >
              <Text style={[styles.gridHeaderLabel, { color: palette.text.tertiary }]}>Сотрудник</Text>
            </View>
            {/* Name cells — Reanimated.ScrollView so the scroll handler
                runs on the UI thread and can drive the right-grid offset
                directly via scrollTo without a JS bridge round-trip. */}
            <Reanimated.ScrollView
              ref={leftAnimatedRef}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              onScroll={handleLeftScrollWorklet}
              scrollEventThrottle={1}
              bounces={false}
              decelerationRate="normal"
              removeClippedSubviews
              overScrollMode="never"
              contentContainerStyle={{ paddingBottom: tabBarHeight }}
            >
              {scheduleDisplayRows.map((row) => {
                if (row.kind === 'direction')
                  return (
                    <View
                      key={row.key}
                      style={{
                        width: NAME_W,
                        height: 30,
                        justifyContent: 'center',
                        paddingHorizontal: spacing[3],
                        backgroundColor: palette.bg.muted,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: palette.border.subtle,
                      }}
                    >
                      <Text
                        style={{
                          color: palette.text.tertiary,
                          fontSize: 10,
                          fontWeight: '700',
                          letterSpacing: 0.6,
                          textTransform: 'uppercase',
                        }}
                      >
                        {row.label}
                      </Text>
                    </View>
                  );
                const u = row.user;
                const rowIdx = row.index;
                const groupMembers = activeUsers.filter(
                  (employee) => directionGroupId(employee) === directionGroupId(u),
                );
                const groupIndex = groupMembers.findIndex((employee) => employee.id === u.id);
                const stats = userStats.get(u.id);
                const avatarColors = getAvatarColors(u.fullName);
                return (
                  <TouchableOpacity
                    key={row.key}
                    onPress={() => openEmployee(navigation, u.id)}
                    onLongPress={() => {
                      if (canEdit) setReorderUser({ userId: u.id, name: u.fullName, index: groupIndex });
                    }}
                    delayLongPress={350}
                    activeOpacity={0.7}
                    style={[
                      styles.gridNameCell,
                      { width: NAME_W, height: ROW_H, borderBottomColor: palette.border.subtle },
                      rowIdx % 2 === 1 && { backgroundColor: palette.bg.muted },
                    ]}
                  >
                    <View style={styles.gridNameInner}>
                      <EmployeeAvatar
                        userId={u.id}
                        avatar={u.avatar}
                        style={styles.gridAvatar}
                        imageStyle={styles.gridAvatar}
                      >
                        <LinearGradient
                          colors={avatarColors as [string, string]}
                          style={styles.gridAvatar}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                        >
                          <Text style={styles.gridAvatarText}>{getInitials(u.fullName)}</Text>
                        </LinearGradient>
                      </EmployeeAvatar>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[styles.gridName, { color: palette.text.primary }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {u.fullName}
                        </Text>
                        {stats && (
                          <View style={styles.gridStatsRow}>
                            <View style={styles.gridStatPill}>
                              <View style={[styles.gridStatDot, { backgroundColor: colors.green[500] }]} />
                              <Text style={[styles.gridStatText, { color: palette.text.tertiary }]}>
                                {stats.worked}
                              </Text>
                            </View>
                            <View style={styles.gridStatPill}>
                              <View style={[styles.gridStatDot, { backgroundColor: palette.text.tertiary }]} />
                              <Text style={[styles.gridStatText, { color: palette.text.tertiary }]}>{stats.off}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Reanimated.ScrollView>
          </View>

          {/* Scrollable right section -- day columns */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <View style={{ flex: 1 }}>
              {/* Day headers — memoised so the 28-31 day cells don't rebuild
                  on every QuickPopup open/close, pending-change toggle, or
                  background SWR refetch. */}
              <GridDayHeaderRow
                days={days}
                today={today}
                CELL_W={CELL_W}
                ROW_H={ROW_H}
                reduceMotion={reduceMotion}
                borderColor={palette.border.subtle}
                weekendBg={palette.mode === 'dark' ? 'rgba(239, 68, 68, 0.08)' : colors.red[50] + '60'}
                weekendText={palette.mode === 'dark' ? colors.red[400] : colors.red[400]}
                dayText={palette.text.primary}
                dowText={palette.text.tertiary}
                todayColumnBg={palette.mode === 'dark' ? 'rgba(59, 130, 246, 0.15)' : colors.primary[50]}
              />

              {/* Day cells — Reanimated.ScrollView so the UI-thread
                  worklet handler can mirror its offset to the names
                  column without any JS bridge work. */}
              <Reanimated.ScrollView
                ref={rightAnimatedRef}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                onScroll={handleRightScrollWorklet}
                scrollEventThrottle={1}
                bounces={false}
                decelerationRate="normal"
                removeClippedSubviews
                overScrollMode="never"
                contentContainerStyle={{ paddingBottom: tabBarHeight }}
              >
                {scheduleDisplayRows.map((row) =>
                  row.kind === 'direction' ? (
                    <View
                      key={row.key}
                      style={{
                        width: days.length * CELL_W,
                        height: 30,
                        backgroundColor: palette.bg.muted,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: palette.border.subtle,
                      }}
                      accessibilityElementsHidden
                    />
                  ) : (
                    <GridDayRow
                      key={row.key}
                      userId={row.user.id}
                      userName={row.user.fullName}
                      days={days}
                      entryMap={entryMap}
                      rowIdx={row.index}
                      today={today}
                      canEdit={canEdit}
                      CELL_W={CELL_W}
                      ROW_H={ROW_H}
                      onCellPress={handleCellPress}
                      isDark={palette.mode === 'dark'}
                      dividerColor={palette.border.subtle}
                      rowStripBg={palette.mode === 'dark' ? 'rgba(255,255,255,0.025)' : colors.gray[50] + '60'}
                      todayColumnBg={palette.mode === 'dark' ? 'rgba(59, 130, 246, 0.12)' : colors.primary[50]}
                      weekendColumnBg={palette.mode === 'dark' ? 'rgba(239, 68, 68, 0.05)' : colors.red[50] + '30'}
                      emptyDotColor={palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : colors.gray[200]}
                    />
                  ),
                )}
              </Reanimated.ScrollView>
            </View>
          </ScrollView>
        </View>
      )}

      <Modal
        visible={!!reorderUser}
        onClose={() => setReorderUser(null)}
        title={reorderUser ? `Позиция: ${reorderUser.name?.split(' ')[0] || ''}` : ''}
      >
        {reorderUser && (
          <ScrollView style={{ maxHeight: 400 }}>
            {activeUsers
              .filter((employee) => {
                const target = activeUsers.find((u) => u.id === reorderUser.userId);
                return !!target && directionGroupId(employee) === directionGroupId(target);
              })
              .map((_, idx) => {
                const isCurrent = idx === reorderUser.index;
                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => {
                      if (!isCurrent) {
                        // `idx` is the FINAL 0-based position the master should
                        // occupy. We remove the master first, then splice it
                        // back in at `idx`: because the moved id is already
                        // gone from `filtered`, inserting at `idx` lands it at
                        // visual position `idx + 1` exactly — for upward AND
                        // downward moves alike (no off-by-one). Do not add a
                        // removal-shift correction here; that would re-introduce
                        // the classic off-by-one on downward moves.
                        const moved = activeUsers.find((employee) => employee.id === reorderUser.userId);
                        if (!moved) return;
                        const groupUsers = activeUsers.filter(
                          (employee) => directionGroupId(employee) === directionGroupId(moved),
                        );
                        const reorderedGroup = groupUsers.map((employee) => employee.id);
                        reorderedGroup.splice(reorderUser.index, 1);
                        reorderedGroup.splice(idx, 0, reorderUser.userId);
                        const groupPositions = activeUsers.flatMap((employee, position) =>
                          directionGroupId(employee) === directionGroupId(moved) ? [position] : [],
                        );
                        const ids = activeUsers.map((employee) => employee.id);
                        groupPositions.forEach((position, groupPos) => {
                          ids[position] = reorderedGroup[groupPos];
                        });
                        updateOrderMut.mutate(ids);
                      }
                      setReorderUser(null);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      backgroundColor: isCurrent
                        ? dark
                          ? palette.accent.primarySoft
                          : colors.primary[50]
                        : 'transparent',
                      borderBottomWidth: 0.5,
                      borderBottomColor: palette.border.subtle,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: isCurrent ? colors.primary[600] : palette.text.tertiary,
                        width: 24,
                      }}
                    >
                      {idx + 1}
                    </Text>
                    <Text
                      style={{
                        fontSize: 14,
                        color: isCurrent
                          ? dark
                            ? palette.accent.primaryText
                            : colors.primary[700]
                          : palette.text.secondary,
                        flex: 1,
                        fontWeight: isCurrent ? '600' : '500',
                      }}
                    >
                      {isCurrent ? '— текущая позиция —' : `Переместить на ${idx + 1}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>
        )}
      </Modal>

      <Modal
        visible={!!quickPopup}
        onClose={() => setQuickPopup(null)}
        title={
          quickPopup?.userName
            ? `${quickPopup.userName} — ${quickPopup.date?.split('-').reverse().join('.')}`
            : 'Быстрое действие'
        }
      >
        {quickPopup && editHours ? (
          <ScheduleDayHoursForm
            {...quickPopup}
            onSaved={() => setQuickPopup(null)}
            onCancel={() => setEditHours(false)}
          />
        ) : (
          quickPopup && (
            <View style={styles.quickActions}>
              {[
                // Icons + hues mirror the grid cell language (getCellDot) and
                // the «Сегодня» list (getStatusInfo) one-to-one, so a status
                // looks identical wherever it appears: popup, cell, today row.
                {
                  type: 'shift',
                  label: 'Смена',
                  icon: 'checkmark' as const,
                  iconColor: colors.green[600],
                  bg: colors.green[50],
                  gradient: [colors.green[50], colors.green[100]],
                },
                {
                  type: 'dayoff',
                  label: 'Выходной',
                  icon: 'moon-outline' as const,
                  iconColor: colors.gray[500],
                  bg: colors.gray[100],
                  gradient: [colors.gray[50], colors.gray[100]],
                },
                {
                  type: 'sick',
                  label: 'Больничный',
                  icon: 'medkit-outline' as const,
                  iconColor: colors.rose[600],
                  bg: colors.rose[50],
                  gradient: [colors.rose[50], '#ffe4e6'],
                },
                {
                  type: 'late_minor',
                  label: 'Опоздал <1ч',
                  icon: 'time-outline' as const,
                  iconColor: colors.amber[600],
                  bg: colors.amber[50],
                  gradient: [colors.amber[50], '#fef9c3'],
                },
                {
                  type: 'late_major',
                  label: 'Опоздал >1ч',
                  icon: 'warning-outline' as const,
                  iconColor: colors.orange[600],
                  bg: colors.orange[50],
                  gradient: [colors.orange[50], '#fed7aa'],
                },
                {
                  type: 'absent',
                  label: 'Прогул',
                  icon: 'close' as const,
                  iconColor: colors.red[600],
                  bg: colors.red[50],
                  gradient: [colors.red[50], '#fecaca'],
                },
              ].map((item) => (
                <TouchableOpacity key={item.type} style={styles.quickBtn} onPress={() => quickAction(item.type)}>
                  <LinearGradient
                    colors={(dark ? [item.iconColor + '26', item.iconColor + '14'] : item.gradient) as [string, string]}
                    style={styles.quickIcon}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Ionicons name={item.icon} size={22} color={item.iconColor} />
                  </LinearGradient>
                  <Text style={[styles.quickLabel, { color: palette.text.secondary }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Изменить время дня"
                style={styles.quickBtn}
                onPress={() => setEditHours(true)}
              >
                <View style={[styles.quickIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="time-outline" size={22} color={palette.text.secondary} />
                </View>
                <Text style={[styles.quickLabel, { color: palette.text.secondary }]}>Время дня</Text>
              </TouchableOpacity>
              {quickPopup.entry && (
                <TouchableOpacity style={styles.quickBtn} onPress={() => quickAction('delete')}>
                  <LinearGradient
                    colors={
                      (dark ? ['rgba(220,38,38,0.26)', 'rgba(220,38,38,0.14)'] : [colors.red[50], colors.red[100]]) as [
                        string,
                        string,
                      ]
                    }
                    style={styles.quickIcon}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Ionicons name="trash-outline" size={22} color={colors.red[600]} />
                  </LinearGradient>
                  <Text style={[styles.quickLabel, { color: colors.red[600] }]}>Удалить</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        )}
      </Modal>
    </View>
  );
}

// ============== TODAY TAB ==============
function TodayTab() {
  const queryClient = useQueryClient();
  const navigation = useNavigation<any>();
  const palette = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const tabBarHeight = useTabBarHeight();
  const tenantTz = useTenantTimezone();

  const {
    data: todayData,
    isError,
    refetch,
  } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return toArray<TodayEmployeeStatus>(res.data);
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    setRefreshing(false);
  };

  // Defensive: `todayData` may be undefined (no body), a non-array (502
  // window / poisoned cache) or contain holes; toArray hardens the shape,
  // then we drop anything without a userId so downstream `.note`/`.fullName`
  // access can never hit `undefined`.
  const statuses = toArray<TodayEmployeeStatus>(todayData).filter((s): s is TodayEmployeeStatus => !!s && !!s.userId);
  const working = statuses.filter((s) => s.isWorking);
  const notWorking = statuses.filter((s) => !s.isWorking);

  // Status descriptor for the "Сегодня" list — mirrors the GridTab cell
  // icon language EXACTLY (getCellDot): clean Ionicons in semantic colours,
  // NO emojis. `icon` is rendered inside a soft tinted circle; `tint` is the
  // semantic colour; `softBg` the matching shade-50 / dark-alpha pill fill so
  // a row reads at a glance the same way the calendar cell does.
  const todayDate = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tenantTz,
  });

  // Single source for one row — reused by the "На смене" and "Отсутствуют"
  // sections. Apple grouped-list feel: SF-style icon in a soft tinted
  // circle (same icon language as the grid cells), name + status line,
  // optional shift / arrival meta. No emoji, no saturated card body.
  const renderRow = (s: TodayEmployeeStatus, idx: number) => {
    const info = getTodayStatusInfo(s);
    return (
      <AnimatedCard key={s.userId} index={Math.min(idx + 2, 7)} onPress={() => openEmployee(navigation, s.userId)}>
        <View style={[styles.todayCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View
            style={[
              styles.todayStatusIcon,
              { backgroundColor: palette.mode === 'dark' ? info.tint + '28' : info.softBg },
            ]}
          >
            <Ionicons name={info.icon} size={20} color={info.tint} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.todayName, { color: palette.text.primary }]} numberOfLines={1}>
              {s.fullName}
            </Text>
            <Text style={[styles.todayStatusLabel, { color: info.tint }]} numberOfLines={1}>
              {info.label}
            </Text>
            {(s.shiftStart && s.shiftEnd) || s.actualArrival ? (
              <View style={styles.todayInfoRow}>
                {s.shiftStart && s.shiftEnd ? (
                  <View style={styles.todayMetaChip}>
                    <Ionicons name="time-outline" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.todayShift, { color: palette.text.secondary }]}>
                      {s.shiftStart}–{s.shiftEnd}
                    </Text>
                  </View>
                ) : null}
                {s.actualArrival ? (
                  <View style={styles.todayMetaChip}>
                    <Ionicons name="log-in-outline" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.todayShift, { color: palette.text.secondary }]}>
                      {formatTimeShort(s.actualArrival, tenantTz)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {s.isWorking && (
              <Text style={[styles.todayNote, { color: palette.text.secondary }]}>Фактическая смена открыта</Text>
            )}
            {s.note ? (
              <Text style={[styles.todayNote, { color: palette.text.tertiary }]} numberOfLines={1}>
                {s.note}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
        </View>
      </AnimatedCard>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.tabContent, { paddingBottom: tabBarHeight + spacing[4] }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Date header — clean Apple-style, no saturated gradient. Large
          capitalised date over a muted "сегодня" eyebrow, with a neutral
          headcount chip on the trailing edge. */}
      <AnimatedCard index={0}>
        <View style={[styles.todayDateCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.todayDateLabel, { color: palette.text.tertiary }]}>СЕГОДНЯ</Text>
            <Text style={[styles.todayDateText, { color: palette.text.primary }]}>{todayDate}</Text>
          </View>
          <View style={[styles.todayTotalBadge, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="people-outline" size={15} color={palette.text.secondary} />
            <Text style={[styles.todayTotalText, { color: palette.text.primary }]}>{statuses.length}</Text>
          </View>
        </View>
      </AnimatedCard>

      {/* Summary — two calm cards, icon in a soft tinted circle. */}
      <AnimatedCard index={1}>
        <View style={styles.todayStatsRow}>
          <View
            style={[styles.todayStatCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View
              style={[
                styles.todayStatIconWrap,
                { backgroundColor: palette.mode === 'dark' ? 'rgba(34,197,94,0.18)' : colors.green[50] },
              ]}
            >
              <Ionicons name="checkmark-circle" size={20} color={colors.green[600]} />
            </View>
            <View>
              <Text style={[styles.todayStatNum, { color: palette.text.primary }]}>{working.length}</Text>
              <Text style={[styles.todayStatLabel, { color: palette.text.tertiary }]}>На смене</Text>
            </View>
          </View>
          <View
            style={[styles.todayStatCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={[styles.todayStatIconWrap, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="moon-outline" size={20} color={palette.text.secondary} />
            </View>
            <View>
              <Text style={[styles.todayStatNum, { color: palette.text.primary }]}>{notWorking.length}</Text>
              <Text style={[styles.todayStatLabel, { color: palette.text.tertiary }]}>Отсутствуют</Text>
            </View>
          </View>
        </View>
      </AnimatedCard>

      {statuses.length === 0 && isError ? (
        <QueryErrorState
          title="Не удалось загрузить"
          description="Сервер временно недоступен. Потяните, чтобы обновить."
          onRetry={() => refetch()}
        />
      ) : statuses.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="calendar-outline" size={36} color={palette.text.tertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Расписание не настроено</Text>
          <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>
            Добавьте смены в разделе «График»
          </Text>
        </View>
      ) : (
        <>
          {working.length > 0 && (
            <>
              <Text style={[styles.todaySectionTitle, { color: palette.text.tertiary }]}>НА СМЕНЕ</Text>
              {working.map((s, idx) => renderRow(s, idx))}
            </>
          )}
          {notWorking.length > 0 && (
            <>
              <Text style={[styles.todaySectionTitle, { color: palette.text.tertiary }]}>БЕЗ ОТКРЫТОЙ СМЕНЫ</Text>
              {notWorking.map((s, idx) => renderRow(s, working.length + idx))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ============== SHIFTS TAB ==============
function ShiftsTab() {
  const { hasPermission } = useAuth();
  const { currentMonth, setCurrentMonth } = useScheduleMonth();
  const safeMonth = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
  return hasPermission('schedule_manage') ? (
    <ShiftAttendanceHistory currentMonth={safeMonth} onMonthChange={setCurrentMonth} />
  ) : (
    <PersonalShiftsStatsTab />
  );
}

function PersonalShiftsStatsTab() {
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const dark = palette.mode === 'dark';

  // Honest month stepper: /schedule/my-stats now accepts dateFrom/dateTo,
  // so the tab consumes the same lifted month state as the grid (header
  // trailing stepper, see showMonthStepper in ScheduleScreen). We always
  // pass the explicit range — even for the current month — so the result
  // is deterministic and the queryKey maps 1:1 to what is on screen.
  const { currentMonth } = useScheduleMonth();
  // Same defensive fallback as GridTab — an out-of-shape Date must never
  // produce NaN in the queryKey or an "Invalid Date" range.
  const safeMonth = currentMonth instanceof Date && !isNaN(currentMonth.getTime()) ? currentMonth : new Date();
  const year = safeMonth.getFullYear();
  const month = safeMonth.getMonth();
  // LOCAL date formatting (formatDate) — toISOString would shift the
  // month boundary for UTC+ timezones.
  const dateFrom = formatDate(new Date(year, month, 1));
  const dateTo = formatDate(new Date(year, month + 1, 0));

  const { data: stats, isLoading } = useQuery({
    queryKey: ['schedule-my-stats', year, month],
    queryFn: async () => {
      const res = await scheduleApi.getMyStats({ dateFrom, dateTo });
      return res.data;
    },
    // keep previous month visible while next month loads — no flash to empty
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const s: any = stats || {};

  // Dark mode: drop the light pastel gradients (they read as bright tiles
  // on the dark canvas) for a neutral elevated→card gradient, and lift the
  // value colour one notch so it pops on the dark surface. Light mode keeps
  // the exact pastel look.
  const darkStatGradient: [string, string] = [palette.bg.elevated, palette.bg.card];
  const statItems = [
    {
      label: 'Рабочих дней',
      value: s.totalWorked || 0,
      icon: 'calendar' as const,
      color: dark ? colors.primary[300] : colors.primary[700],
      gradient: dark ? darkStatGradient : [colors.primary[50], colors.primary[100]],
    },
    {
      label: 'Вовремя',
      value: s.totalOnTime || 0,
      icon: 'checkmark' as const,
      color: dark ? colors.green[300] : colors.green[700],
      gradient: dark ? darkStatGradient : [colors.green[50], colors.green[100]],
    },
    {
      label: 'Опозданий',
      value: s.totalLate || 0,
      icon: 'alarm-outline' as const,
      color: dark ? colors.orange[400] : colors.orange[600],
      gradient: dark ? darkStatGradient : [colors.orange[50], '#fed7aa'],
    },
    {
      label: 'Выходных',
      value: s.totalDaysOff || 0,
      icon: 'moon-outline' as const,
      color: dark ? colors.gray[300] : colors.gray[600],
      gradient: dark ? darkStatGradient : [colors.gray[50], colors.gray[100]],
    },
  ];

  const totalLate = (s.totalLateMinor || 0) + (s.totalLateMajor || 0);

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { paddingBottom: tabBarHeight + spacing[4] }]}>
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* 2x2 stat cards */}
          <View style={styles.statsGrid}>
            {statItems.map((item, idx) => (
              <AnimatedCard key={idx} index={idx}>
                <LinearGradient
                  colors={item.gradient as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.statCard}
                >
                  <View style={styles.statCardHeader}>
                    <View
                      style={[
                        styles.statIcon,
                        { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : colors.white + '90' },
                      ]}
                    >
                      <Ionicons name={item.icon} size={18} color={item.color} />
                    </View>
                  </View>
                  <Text style={[styles.statValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={[styles.statLabel, { color: item.color + 'B0' }]}>{item.label}</Text>
                </LinearGradient>
              </AnimatedCard>
            ))}
          </View>

          {/* Late details card with progress bars */}
          {(s.totalLateMinor > 0 || s.totalLateMajor > 0) && (
            <AnimatedCard index={4}>
              <View style={[styles.detailCard, buildShadow(palette), { backgroundColor: palette.bg.card }]}>
                <View style={styles.detailCardHeader}>
                  <View
                    style={[
                      styles.detailHeaderIcon,
                      { backgroundColor: dark ? palette.accent.primarySoft : colors.primary[50] },
                    ]}
                  >
                    <Ionicons name="analytics-outline" size={16} color={colors.primary[600]} />
                  </View>
                  <Text style={[styles.detailTitle, { color: palette.text.primary }]}>Детали опозданий</Text>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelRow}>
                      <View style={[styles.detailDotIndicator, { backgroundColor: colors.yellow[500] }]} />
                      <Text style={[styles.detailLabel, { color: palette.text.secondary }]}>Опоздания {'<'}1ч</Text>
                    </View>
                    <Text style={[styles.detailValue, { color: colors.yellow[600] }]}>{s.totalLateMinor || 0}</Text>
                  </View>
                  <View style={[styles.progressBarBg, { backgroundColor: palette.bg.muted }]}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${totalLate > 0 ? ((s.totalLateMinor || 0) / totalLate) * 100 : 0}%`,
                          backgroundColor: colors.yellow[400],
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelRow}>
                      <View style={[styles.detailDotIndicator, { backgroundColor: colors.orange[500] }]} />
                      <Text style={[styles.detailLabel, { color: palette.text.secondary }]}>Опоздания {'>'}1ч</Text>
                    </View>
                    <Text style={[styles.detailValue, { color: colors.orange[600] }]}>{s.totalLateMajor || 0}</Text>
                  </View>
                  <View style={[styles.progressBarBg, { backgroundColor: palette.bg.muted }]}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${totalLate > 0 ? ((s.totalLateMajor || 0) / totalLate) * 100 : 0}%`,
                          backgroundColor: colors.orange[500],
                        },
                      ]}
                    />
                  </View>
                </View>

                {s.avgLateMinutes > 0 && (
                  <View style={[styles.avgLateRow, { borderTopColor: palette.border.subtle }]}>
                    <View style={[styles.avgLateIconWrap, { backgroundColor: palette.bg.muted }]}>
                      <Ionicons name="hourglass-outline" size={14} color={palette.text.tertiary} />
                    </View>
                    <Text style={[styles.detailLabel, { color: palette.text.secondary }]}>Ср. опоздание</Text>
                    <Text style={[styles.avgLateValue, { color: palette.text.primary }]}>
                      {Math.round(s.avgLateMinutes)} мин
                    </Text>
                  </View>
                )}
              </View>
            </AnimatedCard>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ============== RATING TAB ==============
function RatingTab() {
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const dark = palette.mode === 'dark';
  // Theme-aware badge palette for the small attendance count chips — light
  // values are byte-identical to the previous shade-50/700 pairs, dark gives
  // a translucent tinted fill with a light-300 text.
  const cb = getBadgeColors(palette.mode);
  const tenantTz = useTenantTimezone();
  const [selectedMonth, setSelectedMonth] = useState(() => formatDayKey(new Date(), tenantTz).slice(0, 7));

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries, dataUpdatedAt } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', monthStart, monthEnd],
    // toArray — a 204 / empty body / non-array (502 window) must not reach
    // calculateAttendanceStats() (which would call array methods on it).
    queryFn: async () =>
      toArray<ScheduleEntry>((await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd })).data),
    placeholderData: (prev) => prev,
  });

  // ['users', 'point'] — команда текущего филиала (167), единая форма `User[]`.
  const { data: usersData } = usePointUsers();

  // Same eligibility rule as the grid's activeUsers: owners (superadmin /
  // director / owner) не отображаются в графике — и в рейтинге тоже.
  // toArray guards against a poisoned non-array users cache value.
  const users = useMemo(
    () =>
      toArray<User>(usersData).filter((u) => {
        if (!u || !u.id || !u.isActive) return false;
        if (u.hiddenFromSchedule || u.hiddenEverywhere) return false;
        const role = (u.role || '').toString().toLowerCase();
        return role !== 'superadmin' && role !== 'director' && role !== 'owner';
      }),
    [usersData],
  );

  // SHARED attendance utility — same logic everywhere (web + mobile).
  // toArray guards against a malformed cache value reaching the iterator.
  const stats = useMemo(
    () => calculateAttendanceStats(toArray<ScheduleEntry>(monthEntries), new Date(), tenantTz),
    [monthEntries, tenantTz, dataUpdatedAt],
  );

  const ranked = useMemo(
    () =>
      users
        .map((u) => {
          const s = stats[u.id] || emptyBreakdown();
          const score = attendanceScore(s);
          return { ...u, stats: s, score };
        })
        .sort((a, b) => b.score - a.score || b.stats.full - a.stats.full),
    [users, stats],
  );

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const shiftMonth = (dir: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing[4], gap: spacing[3], paddingBottom: tabBarHeight + spacing[4] }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[3],
          backgroundColor: palette.bg.card,
          borderRadius: borderRadius.xl,
          paddingVertical: spacing[2.5],
          borderWidth: 1,
          borderColor: palette.border.subtle,
        }}
      >
        <TouchableOpacity onPress={() => shiftMonth(-1)} style={{ padding: spacing[1] }}>
          <Ionicons name="chevron-back" size={20} color={palette.text.secondary} />
        </TouchableOpacity>
        <Text
          style={{
            fontSize: fontSize.sm,
            fontWeight: fontWeight.bold,
            color: palette.text.primary,
            textTransform: 'capitalize' as const,
            minWidth: 140,
            textAlign: 'center',
          }}
        >
          {monthLabel}
        </Text>
        <TouchableOpacity onPress={() => shiftMonth(1)} style={{ padding: spacing[1] }}>
          <Ionicons name="chevron-forward" size={20} color={palette.text.secondary} />
        </TouchableOpacity>
      </View>

      {ranked.map((u, idx) => {
        const s = u.stats;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
        const scoreColor = u.score >= 90 ? colors.green[600] : u.score >= 70 ? colors.yellow[600] : colors.red[500];
        const scoreBg =
          u.score >= 90
            ? dark
              ? 'rgba(34,197,94,0.18)'
              : colors.green[50]
            : u.score >= 70
              ? dark
                ? 'rgba(234,179,8,0.18)'
                : colors.yellow[50]
              : dark
                ? 'rgba(239,68,68,0.16)'
                : colors.red[50];
        const isExpanded = expandedUserId === u.id;
        const fmtDate = (d: string) => {
          const p = String(d ?? '').split('-');
          if (p.length < 3) return String(d ?? '');
          return `${parseInt(p[2], 10)}.${p[1]}`;
        };

        return (
          <View
            key={u.id}
            style={{
              backgroundColor: palette.bg.card,
              borderRadius: borderRadius['2xl'],
              borderWidth: 1,
              borderColor: idx < 3 ? colors.amber[200] : palette.border.subtle,
              overflow: 'hidden',
            }}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setExpandedUserId(isExpanded ? null : u.id)}
              style={{ padding: spacing[3] }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor:
                      idx < 3
                        ? palette.mode === 'dark'
                          ? softTint(colors.amber[600], 'dark')
                          : colors.amber[100]
                        : palette.bg.muted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: fontWeight.bold,
                      color: idx < 3 ? colors.amber[600] : palette.text.secondary,
                    }}
                  >
                    {medal || idx + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: palette.text.primary }}
                    numberOfLines={1}
                  >
                    {u.fullName}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing[1.5], marginTop: 4, flexWrap: 'wrap' }}>
                    <Text
                      style={{
                        fontSize: 9,
                        backgroundColor: cb.green.bg,
                        color: cb.green.text,
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        borderRadius: 8,
                        fontWeight: '600',
                      }}
                    >
                      ✓ {s.full}
                    </Text>
                    {s.lateMinor > 0 && (
                      <Text
                        style={{
                          fontSize: 9,
                          backgroundColor: cb.yellow.bg,
                          color: cb.yellow.text,
                          paddingHorizontal: 5,
                          paddingVertical: 2,
                          borderRadius: 8,
                          fontWeight: '600',
                        }}
                      >
                        ⏰ {s.lateMinor}
                      </Text>
                    )}
                    {s.lateMajor > 0 && (
                      <Text
                        style={{
                          fontSize: 9,
                          backgroundColor: cb.orange.bg,
                          color: cb.orange.text,
                          paddingHorizontal: 5,
                          paddingVertical: 2,
                          borderRadius: 8,
                          fontWeight: '600',
                        }}
                      >
                        ⚠ {s.lateMajor}
                      </Text>
                    )}
                    {s.absent > 0 && (
                      <Text
                        style={{
                          fontSize: 9,
                          backgroundColor: cb.red.bg,
                          color: cb.red.text,
                          paddingHorizontal: 5,
                          paddingVertical: 2,
                          borderRadius: 8,
                          fontWeight: '600',
                        }}
                      >
                        ❌ {s.absent}
                      </Text>
                    )}
                    {s.sick > 0 && (
                      <Text
                        style={{
                          fontSize: 9,
                          backgroundColor: dark ? 'rgba(244,63,94,0.16)' : colors.rose[50],
                          color: dark ? '#fda4af' : colors.rose[600],
                          paddingHorizontal: 5,
                          paddingVertical: 2,
                          borderRadius: 8,
                          fontWeight: '600',
                        }}
                      >
                        🏥 {s.sick}
                      </Text>
                    )}
                  </View>
                </View>
                <View
                  style={{
                    backgroundColor: scoreBg,
                    borderRadius: borderRadius.lg,
                    paddingHorizontal: spacing[2.5],
                    paddingVertical: spacing[1.5],
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: scoreColor }}>
                    {u.score}%
                  </Text>
                  <Text style={{ fontSize: 8, color: palette.text.tertiary }}>посещ.</Text>
                </View>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.text.tertiary} />
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: palette.border.subtle,
                  backgroundColor: palette.bg.muted,
                  padding: spacing[3],
                  gap: spacing[1.5],
                }}
              >
                {s.fullDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: cb.green.text }}>✓ Полная смена ({s.full}): </Text>
                    {s.fullDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.lateMinorDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: cb.yellow.text }}>⏰ Опозд. &lt;1ч ({s.lateMinor}): </Text>
                    {s.lateMinorDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.lateMajorDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: cb.orange.text }}>⚠ Опозд. &gt;1ч ({s.lateMajor}): </Text>
                    {s.lateMajorDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.absentDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: cb.red.text }}>❌ Прогул ({s.absent}): </Text>
                    {s.absentDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.sickDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: dark ? '#fda4af' : colors.rose[600] }}>
                      🏥 Больничный ({s.sick}):{' '}
                    </Text>
                    {s.sickDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.dayOffDates.length > 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.secondary }}>
                    <Text style={{ fontWeight: '700', color: palette.text.secondary }}>🌙 Выходной ({s.dayOff}): </Text>
                    {s.dayOffDates.map(fmtDate).join(', ')}
                  </Text>
                )}
                {s.total === 0 && s.sick === 0 && s.dayOff === 0 && (
                  <Text style={{ fontSize: 11, color: palette.text.tertiary, textAlign: 'center' }}>Нет данных</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ============== SETTINGS TAB ==============
// Status keys used by the "Смены" sub-tab. Same set as the grid's
// CellStatusKey — kept in sync so the toggle list matches what the
// owner sees on the actual calendar cells.
const SHIFT_STATUS_OPTIONS: {
  key: 'worked' | 'dayoff' | 'sick' | 'short' | 'long' | 'absent';
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  {
    key: 'worked',
    label: 'Смена',
    description: 'Полная отработанная смена',
    icon: 'checkmark',
    color: colors.green[700],
  },
  {
    key: 'short',
    label: 'Опоздание <1ч',
    description: 'Опоздал меньше чем на 1 час',
    icon: 'time-outline',
    color: colors.amber[600],
  },
  {
    key: 'long',
    label: 'Опоздание >1ч',
    description: 'Опоздал более чем на 1 час',
    icon: 'alert-circle',
    color: colors.red[500],
  },
  {
    key: 'sick',
    label: 'Больничный',
    description: 'Сотрудник на больничном',
    icon: 'medkit-outline',
    color: colors.orange[600],
  },
  {
    key: 'dayoff',
    label: 'Выходной',
    description: 'Плановый выходной день',
    icon: 'moon-outline',
    color: colors.gray[500],
  },
  {
    key: 'absent',
    label: 'Прогул',
    description: 'Не вышел на смену без причины',
    icon: 'close',
    color: colors.red[600],
  },
];

function SettingsTab() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const palette = useColors();
  const dark = palette.mode === 'dark';
  const [modeEditor, setModeEditor] = useState<{ mode?: WorkMode } | null>(null);
  const [settingsTab, setSettingsTab] = useState<'daysoff' | 'modes' | 'shifts'>('daysoff');
  const tabBarHeight = useTabBarHeight();

  // Настройки расписания/режимов — schedule_manage (сервер: POST /schedule/
  // settings, work-modes, apply-work-mode → тот же ключ).
  const canEditSettings = hasPermission('schedule_manage');

  // ['users', 'point'] — команда текущего филиала (167), единая форма `User[]`.
  const { data: usersData } = usePointUsers();

  const {
    data: workModes,
    isPending: modesPending,
    isError: modesError,
    refetch: refetchModes,
  } = useQuery<WorkMode[]>({
    queryKey: ['work-modes'],
    queryFn: async () => {
      const res = await scheduleApi.getWorkModes();
      return toArray<WorkMode>(res.data);
    },
    placeholderData: (prev) => prev,
  });

  // Defensive: drop null/orphaned rows (a malformed users payload after a
  // deletion could contain holes) so the settings sub-tabs never call a
  // method on `undefined`. toArray also guards a poisoned non-array cache.
  const activeUsers = useMemo(() => toArray<User>(usersData).filter((u) => u && u.id && u.isActive), [usersData]);

  const dayOffInFlight = useRef<Set<string>>(new Set());
  const toggleDayOff = async (userId: string, dayOfWeek: number) => {
    const key = `${userId}:${dayOfWeek}`;
    // Per-cell guard: a double-tap (or a fast on→off) would otherwise fire two
    // read-modify-write PATCHes off the SAME stale `daysOff`, racing to an
    // inconsistent final state. Block a second toggle of the same cell until
    // the first settles.
    if (dayOffInFlight.current.has(key)) return;
    const user = activeUsers.find((u) => u.id === userId);
    if (!user) return;
    const current: number[] = Array.isArray((user as any).daysOff) ? (user as any).daysOff : [];
    const newDaysOff = current.includes(dayOfWeek) ? current.filter((d) => d !== dayOfWeek) : [...current, dayOfWeek];
    dayOffInFlight.current.add(key);
    try {
      await usersApi.update(userId, { daysOff: newDaysOff } as any);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить');
    } finally {
      dayOffInFlight.current.delete(key);
    }
  };

  const [applyModeId, setApplyModeId] = useState('');
  const [applyUserId, setApplyUserId] = useState('');
  const [applyFrom, setApplyFrom] = useState<Date | null>(null);
  const [applyTo, setApplyTo] = useState<Date | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showApplyFromPicker, setShowApplyFromPicker] = useState(false);
  const [showApplyToPicker, setShowApplyToPicker] = useState(false);

  const formatPickerDate = (d: Date) =>
    `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const applyMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.applyWorkMode(data),
    onSuccess: () => {
      void invalidateAttendanceQueries(queryClient);
      setShowApplyModal(false);
      Alert.alert('Готово', 'Режим применён');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка'),
  });

  // ── Schedule settings — which statuses count as a real shift ──
  // Read the current configuration. Falls back to the project default
  // (['worked', 'short']) — the same default the backend applies if no
  // record has been written yet.
  const { data: scheduleSettings } = useQuery<ScheduleSettings>({
    queryKey: ['schedule-settings'],
    queryFn: async () => {
      const res = await scheduleSettingsApi.get();
      return res.data;
    },
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

  // Local mirror of which keys are toggled on. Initialise from the
  // fetched settings; reset every time the API view changes.
  const [shiftKeys, setShiftKeys] = useState<Set<string>>(new Set(['worked', 'short']));
  useEffect(() => {
    // toArray: shiftStatuses could be a non-array on a malformed settings
    // payload — new Set(non-iterable) would throw and crash the tab.
    const next = toArray<string>(scheduleSettings?.shiftStatuses);
    if (next.length > 0) {
      setShiftKeys(new Set(next));
    }
  }, [scheduleSettings]);

  const toggleShiftKey = useCallback((key: string) => {
    haptic('select');
    setShiftKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const shiftSettingsMutation = useMutation({
    mutationFn: (data: Partial<ScheduleSettings>) => scheduleSettingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-settings'] });
      // Recalculations elsewhere (rating, cash-flow charts) may key off
      // this — invalidating the schedule itself is overkill but keeps
      // any derived views fresh on the next visit.
      Alert.alert('Сохранено', 'Настройки смен обновлены');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить настройки'),
  });

  const saveShiftSettings = () => {
    haptic('tap');
    shiftSettingsMutation.mutate({ shiftStatuses: Array.from(shiftKeys) });
  };

  const currentList = toArray<string>(scheduleSettings?.shiftStatuses);
  const dirty =
    currentList.length !== shiftKeys.size ||
    currentList.some((k) => !shiftKeys.has(k)) ||
    Array.from(shiftKeys).some((k) => !currentList.includes(k));

  return (
    <ScrollView contentContainerStyle={[styles.tabContent, { paddingBottom: tabBarHeight + spacing[4] }]}>
      {/* Segmented sub-tabs */}
      <View style={[styles.subTabs, { backgroundColor: palette.bg.muted }]}>
        <TouchableOpacity
          style={[styles.subTabItem, settingsTab === 'daysoff' && styles.subTabActive]}
          onPress={() => setSettingsTab('daysoff')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="calendar-outline"
            size={15}
            color={settingsTab === 'daysoff' ? colors.white : palette.text.secondary}
          />
          <Text
            style={[
              styles.subTabText,
              { color: palette.text.secondary },
              settingsTab === 'daysoff' && styles.subTabTextActive,
            ]}
          >
            Выходные
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTabItem, settingsTab === 'modes' && styles.subTabActive]}
          onPress={() => setSettingsTab('modes')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="time-outline"
            size={15}
            color={settingsTab === 'modes' ? colors.white : palette.text.secondary}
          />
          <Text
            style={[
              styles.subTabText,
              { color: palette.text.secondary },
              settingsTab === 'modes' && styles.subTabTextActive,
            ]}
          >
            Режимы
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTabItem, settingsTab === 'shifts' && styles.subTabActive]}
          onPress={() => setSettingsTab('shifts')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={15}
            color={settingsTab === 'shifts' ? colors.white : palette.text.secondary}
          />
          <Text
            style={[
              styles.subTabText,
              { color: palette.text.secondary },
              settingsTab === 'shifts' && styles.subTabTextActive,
            ]}
          >
            Смены
          </Text>
        </TouchableOpacity>
      </View>

      {settingsTab === 'shifts' ? (
        <View style={{ gap: spacing[3] }}>
          {/* Section header */}
          <View style={{ paddingHorizontal: spacing[1] }}>
            <Text style={[styles.shiftSectionTitle, { color: palette.text.primary }]}>
              Какие статусы считать сменой
            </Text>
            <Text style={[styles.shiftSectionHint, { color: palette.text.tertiary }]}>
              Эти статусы считаются отработанной сменой при расчёте зарплаты («ЗП за день» = заработок ÷ смены).
              Например, если «Опоздание{' <1ч'}» включено — такой день идёт в счётчик смен. Будущие дни месяца не
              учитываются, пока не наступят.
            </Text>
          </View>

          {/* Toggle list */}
          <View
            style={[styles.shiftListCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            {SHIFT_STATUS_OPTIONS.map((opt, idx) => {
              const on = shiftKeys.has(opt.key);
              return (
                <View
                  key={opt.key}
                  style={[
                    styles.shiftRow,
                    idx < SHIFT_STATUS_OPTIONS.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: palette.border.subtle,
                    },
                  ]}
                >
                  <View style={[styles.shiftRowIcon, { backgroundColor: opt.color + '20' }]}>
                    <Ionicons name={opt.icon} size={18} color={opt.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.shiftRowLabel, { color: palette.text.primary }]}>{opt.label}</Text>
                    <Text style={[styles.shiftRowDescription, { color: palette.text.tertiary }]}>
                      {opt.description}
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => {
                      if (canEditSettings) toggleShiftKey(opt.key);
                    }}
                    disabled={!canEditSettings}
                    trackColor={{ false: palette.bg.muted, true: colors.green[500] }}
                    thumbColor={colors.white}
                    ios_backgroundColor={palette.bg.muted}
                  />
                </View>
              );
            })}
          </View>

          {canEditSettings && (
            <TouchableOpacity
              onPress={saveShiftSettings}
              disabled={!dirty || shiftSettingsMutation.isPending}
              style={[
                styles.shiftSaveBtn,
                {
                  backgroundColor: !dirty || shiftSettingsMutation.isPending ? palette.bg.muted : colors.primary[600],
                },
              ]}
              activeOpacity={0.85}
            >
              {shiftSettingsMutation.isPending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={16} color={!dirty ? palette.text.tertiary : colors.white} />
                  <Text style={[styles.shiftSaveBtnText, { color: !dirty ? palette.text.tertiary : colors.white }]}>
                    Сохранить
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : settingsTab === 'daysoff' ? (
        <View style={{ gap: spacing[3] }}>
          {activeUsers.map((u, idx) => {
            const daysOff: number[] = Array.isArray((u as any).daysOff) ? (u as any).daysOff : [];
            const avatarColors = getAvatarColors(u.fullName);
            return (
              <AnimatedCard key={u.id} index={idx}>
                <View style={[styles.daysOffCard, buildShadow(palette), { backgroundColor: palette.bg.card }]}>
                  <View style={styles.daysOffHeader}>
                    <EmployeeAvatar
                      userId={u.id}
                      avatar={u.avatar}
                      style={styles.daysOffAvatar}
                      imageStyle={styles.daysOffAvatar}
                    >
                      <LinearGradient
                        colors={avatarColors as [string, string]}
                        style={styles.daysOffAvatar}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <Text style={styles.daysOffAvatarText}>{getInitials(u.fullName)}</Text>
                      </LinearGradient>
                    </EmployeeAvatar>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.daysOffName, { color: palette.text.primary }]}>{u.fullName}</Text>
                      <Text style={[styles.daysOffCount, { color: palette.text.tertiary }]}>
                        {daysOff.length > 0 ? `${daysOff.length} выходн.` : 'Нет выходных'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.daysOffRow}>
                    {DAY_ABBR.map((label, index) => {
                      const dow = SCHEDULE_WEEKDAYS[index];
                      const isOff = daysOff.includes(dow);
                      const isWeekend = dow === 0 || dow === 6;
                      return (
                        <TouchableOpacity
                          key={dow}
                          style={[
                            styles.dayBtn,
                            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                            !isOff &&
                              isWeekend && {
                                backgroundColor: dark ? 'rgba(239,68,68,0.10)' : colors.red[50] + '50',
                                borderColor: dark ? 'rgba(239,68,68,0.30)' : colors.red[200],
                              },
                            isOff && styles.dayBtnActive,
                          ]}
                          disabled={!canEditSettings}
                          accessibilityLabel={`${u.fullName}, ${label}, выходной`}
                          accessibilityState={{ selected: isOff, disabled: !canEditSettings }}
                          onPress={() => toggleDayOff(u.id, dow)}
                          activeOpacity={0.6}
                        >
                          <Text
                            style={[
                              styles.dayBtnText,
                              { color: palette.text.secondary },
                              isOff && styles.dayBtnTextActive,
                              !isOff && isWeekend && { color: colors.red[400] },
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </AnimatedCard>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: spacing[3] }}>
          {canEditSettings && (
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.applyBtnMain, { minHeight: 44 }]}
              onPress={() => setModeEditor({})}
            >
              <Text style={{ color: colors.white, fontWeight: '600' }}>Создать режим</Text>
            </TouchableOpacity>
          )}
          {modesPending && <ActivityIndicator color={palette.accent.primary} />}
          {modesError && <QueryErrorState title="Не удалось загрузить режимы" onRetry={() => void refetchModes()} />}
          {toArray<WorkMode>(workModes).map((mode, idx) => (
            <AnimatedCard key={mode.id} index={idx}>
              <View style={[styles.modeCard, buildShadow(palette), { backgroundColor: palette.bg.card }]}>
                <LinearGradient
                  colors={
                    (dark
                      ? [palette.accent.primarySoft, palette.accent.primarySoft]
                      : [colors.primary[50], colors.primary[100]]) as [string, string]
                  }
                  style={styles.modeIconWrap}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons name="time-outline" size={20} color={colors.primary[600]} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modeName, { color: palette.text.primary }]}>{mode.name}</Text>
                  <View style={styles.modeTimeRow}>
                    <Ionicons name="enter-outline" size={12} color={colors.green[600]} />
                    <Text style={[styles.modeTimeText, { color: palette.text.secondary }]}>{mode.shiftStart}</Text>
                    <Ionicons name="remove-outline" size={10} color={palette.text.tertiary} />
                    <Ionicons name="exit-outline" size={12} color={colors.orange[500]} />
                    <Text style={[styles.modeTimeText, { color: palette.text.secondary }]}>{mode.shiftEnd}</Text>
                  </View>
                  {SCHEDULE_WEEKDAYS.some(
                    (day) => mode.dayTimes?.[day] && (!mode.weekDays.length || mode.weekDays.includes(day)),
                  ) && (
                    <Text style={[styles.modeTimeText, { color: palette.text.secondary, marginTop: spacing[1] }]}>
                      {SCHEDULE_WEEKDAYS.filter(
                        (day) => mode.dayTimes?.[day] && (!mode.weekDays.length || mode.weekDays.includes(day)),
                      )
                        .map(
                          (day) =>
                            `${DAY_ABBR[(day + 6) % 7]} ${mode.dayTimes?.[day]?.shiftStart}–${mode.dayTimes?.[day]?.shiftEnd}`,
                        )
                        .join(', ')}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] }}>
                    {canEditSettings && (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Изменить режим ${mode.name}`}
                        style={{
                          minHeight: 44,
                          paddingHorizontal: spacing[2],
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onPress={() => setModeEditor({ mode })}
                      >
                        <Text style={{ fontSize: fontSize.xs, color: palette.text.secondary }}>Изменить</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      disabled={!canEditSettings}
                      accessibilityLabel={`Применить режим ${mode.name}`}
                      style={[
                        styles.modeApplyBtn,
                        { backgroundColor: dark ? palette.accent.primarySoft : colors.primary[50] },
                      ]}
                      onPress={() => {
                        setApplyModeId(mode.id);
                        setApplyUserId('');
                        setApplyFrom(null);
                        setApplyTo(null);
                        setShowApplyModal(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.modeApplyText}>Применить</Text>
                      <Ionicons name="arrow-forward" size={14} color={colors.primary[600]} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </AnimatedCard>
          ))}
          {!modesPending && !modesError && toArray<WorkMode>(workModes).length === 0 && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="time-outline" size={36} color={palette.text.tertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Нет режимов работы</Text>
              <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>
                Создайте режим и примените его к графику
              </Text>
            </View>
          )}
        </View>
      )}

      {modeEditor && <WorkModeEditor mode={modeEditor.mode} onClose={() => setModeEditor(null)} />}
      <Modal visible={showApplyModal} onClose={() => setShowApplyModal(false)} title="Применить режим">
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сотрудник</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              <TouchableOpacity
                style={[
                  styles.userChip,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  !applyUserId && {
                    backgroundColor: dark ? palette.accent.primarySoft : colors.primary[50],
                    borderColor: colors.primary[400],
                  },
                ]}
                onPress={() => setApplyUserId('')}
              >
                <Ionicons
                  name="people-outline"
                  size={12}
                  color={!applyUserId ? colors.primary[700] : palette.text.secondary}
                />
                <Text
                  style={[
                    styles.userChipText,
                    { color: palette.text.secondary },
                    !applyUserId && {
                      color: dark ? palette.accent.primaryText : colors.primary[700],
                      fontWeight: fontWeight.semibold,
                    },
                  ]}
                >
                  Все
                </Text>
              </TouchableOpacity>
              {activeUsers.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={[
                    styles.userChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    applyUserId === u.id && {
                      backgroundColor: dark ? palette.accent.primarySoft : colors.primary[50],
                      borderColor: colors.primary[400],
                    },
                  ]}
                  onPress={() => setApplyUserId(u.id)}
                >
                  <Text
                    style={[
                      styles.userChipText,
                      { color: palette.text.secondary },
                      applyUserId === u.id && {
                        color: dark ? palette.accent.primaryText : colors.primary[700],
                        fontWeight: fontWeight.semibold,
                      },
                    ]}
                  >
                    {u.fullName?.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>С даты</Text>
            <TouchableOpacity
              style={[styles.formInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => setShowApplyFromPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
              <Text
                style={{
                  fontSize: fontSize.sm,
                  color: applyFrom ? palette.text.primary : palette.text.tertiary,
                  flex: 1,
                }}
              >
                {applyFrom ? formatPickerDate(applyFrom) : 'Выберите'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>По дату</Text>
            <TouchableOpacity
              style={[styles.formInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => setShowApplyToPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.tertiary} />
              <Text
                style={{
                  fontSize: fontSize.sm,
                  color: applyTo ? palette.text.primary : palette.text.tertiary,
                  flex: 1,
                }}
              >
                {applyTo ? formatPickerDate(applyTo) : 'Выберите'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <DateTimePickerModal
          visible={showApplyFromPicker}
          value={applyFrom || new Date()}
          mode="date"
          onConfirm={(d) => {
            setShowApplyFromPicker(false);
            setApplyFrom(d);
          }}
          onCancel={() => setShowApplyFromPicker(false)}
        />
        <DateTimePickerModal
          visible={showApplyToPicker}
          value={applyTo || new Date()}
          mode="date"
          onConfirm={(d) => {
            setShowApplyToPicker(false);
            setApplyTo(d);
          }}
          onCancel={() => setShowApplyToPicker(false)}
        />
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            onPress={() => setShowApplyModal(false)}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyBtnMain}
            onPress={() => {
              if (!applyFrom || !applyTo) {
                Alert.alert('Ошибка', 'Укажите даты');
                return;
              }
              applyMutation.mutate({
                workModeId: applyModeId,
                userId: applyUserId || undefined,
                dateFrom: toISODate(applyFrom),
                dateTo: toISODate(applyTo),
              });
            }}
            activeOpacity={0.7}
          >
            {applyMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.applyBtnText}>Применить</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ============== MAIN SCREEN ==============
/**
 * Префикс локальных строк расписания, которых на сервере ещё нет.
 *
 * Такой id НЕЛЬЗЯ отправлять ни в PATCH, ни в DELETE: серверный маршрут
 * приводит :id к uuid и падает. Держим генерацию и проверку рядом, одной
 * парой, чтобы они не разъехались.
 */
const SCHEDULE_PLACEHOLDER_PREFIX = 'temp-';
const placeholderId = (userId: string, date: string): string => `${SCHEDULE_PLACEHOLDER_PREFIX}${userId}-${date}`;
const isPlaceholderId = (id: string | undefined | null): boolean =>
  typeof id === 'string' && id.startsWith(SCHEDULE_PLACEHOLDER_PREFIX);

export default function ScheduleScreen() {
  useAttendanceRefresh();
  const navigation = useNavigation<any>();
  const { hasPermission } = useAuth();
  const palette = useColors();
  const tenantTz = useTenantTimezone();
  // Таб «Настройки» — только держателю schedule_manage (те же мутации, что
  // гейтит сервер; admin живёт по матрице из /auth/me).
  const isAdmin = hasPermission('schedule_manage');
  const [tab, setTab] = useState<TabType>('grid');
  // Single source of truth for the schedule month — provided to GridTab
  // and ShiftsTab via context, manipulated from the header trailing slot.
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    attendanceCalendarDate(formatDayKey(new Date(), tenantTz)),
  );
  const monthCtxValue = useMemo(() => ({ currentMonth, setCurrentMonth }), [currentMonth]);
  // Defensive: never let an out-of-shape Date make getMonth() return NaN —
  // MONTH_NAMES[NaN] is undefined and `.slice` on it would crash the
  // whole screen header before any tab even mounts.
  const safeMonth = currentMonth instanceof Date && !isNaN(currentMonth.getTime()) ? currentMonth : new Date();
  const monthYear = safeMonth.getFullYear();
  const monthIndex = safeMonth.getMonth();

  const tabConfig: {
    key: TabType;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    activeIcon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: 'grid', label: 'График', icon: 'grid-outline', activeIcon: 'grid' },
    { key: 'today', label: 'Сегодня', icon: 'today-outline', activeIcon: 'today' },
    { key: 'shifts', label: 'Смены', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
    // `activeIcon` остаётся outline-вариантом по просьбе владельца — filled
    // Trophy на градиенте читался слишком жирно. Тонкая обводка совпадает с
    // другими табами по визуальному весу.
    { key: 'rating', label: 'Рейтинг', icon: 'trophy-outline', activeIcon: 'trophy-outline' },
    ...(isAdmin
      ? [
          {
            key: 'settings' as TabType,
            label: 'Настройки',
            icon: 'settings-outline' as keyof typeof Ionicons.glyphMap,
            activeIcon: 'settings' as keyof typeof Ionicons.glyphMap,
          },
        ]
      : []),
  ];

  // Compact month stepper inside the header trailing slot. Tap on the
  // month label resets to today; arrows step ± one month with a haptic.
  // Visible on the grid AND «Смены» tabs — both consume the same lifted
  // month state, and /schedule/my-stats now honours dateFrom/dateTo, so
  // the stepper is honest on both. Today is single-day, Rating has its
  // own in-tab month switcher, Settings has no time scope.
  const showMonthStepper = tab === 'grid' || tab === 'shifts';
  const trailingMonthStepper = showMonthStepper ? (
    <View style={[styles.headerMonthStepper, { backgroundColor: palette.bg.muted }]}>
      <TouchableOpacity
        onPress={() => {
          haptic('select');
          setCurrentMonth(new Date(monthYear, monthIndex - 1, 1));
        }}
        hitSlop={6}
        style={styles.headerMonthBtn}
      >
        <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          haptic('tap');
          setCurrentMonth(attendanceCalendarDate(formatDayKey(new Date(), tenantTz)));
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.headerMonthText, { color: palette.text.primary }]}>
          {(MONTH_NAMES[monthIndex] ?? '').slice(0, 3)}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          haptic('select');
          setCurrentMonth(new Date(monthYear, monthIndex + 1, 1));
        }}
        hitSlop={6}
        style={styles.headerMonthBtn}
      >
        <Ionicons name="chevron-forward" size={16} color={palette.text.secondary} />
      </TouchableOpacity>
    </View>
  ) : undefined;

  return (
    <ScheduleMonthCtx.Provider value={monthCtxValue}>
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        {/* Unified iOS header — same component used across screens. */}
        <IosScreenHeader title="Расписание" onBack={() => navigation.goBack()} trailing={trailingMonthStepper} />

        {/* Автосервис расписания (161/163): у смен есть филиал, и график/
            «Смены» показывают автосервис ЭТОЙ СЕССИИ. Значит человек обязан
            видеть, чьи смены он читает, — иначе решит, что мастер не вышел,
            хотя тот работает в другом автосервисе. Индикатор только
            показывает: филиал выбран при входе. Отдельной строкой, а не в
            trailing: там уже стоит переключатель месяца. */}
        <PointIndicator variant="chip" style={styles.pointChipRow} />

        {/* Tab bar */}
        <View
          style={[styles.tabBar, { backgroundColor: palette.bg.elevated, borderBottomColor: palette.border.subtle }]}
        >
          <View style={[styles.tabBarInner, { backgroundColor: palette.bg.muted }]}>
            {tabConfig.map((t) => {
              const isActive = tab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabItem, isActive && styles.tabItemActive]}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.7}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={[colors.primary[500], colors.primary[700]] as [string, string]}
                      style={styles.tabItemGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Ionicons name={t.activeIcon} size={16} color={colors.white} />
                      <Text style={styles.tabItemTextActive} numberOfLines={1} adjustsFontSizeToFit>
                        {t.label}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.tabItemInner}>
                      <Ionicons name={t.icon} size={16} color={palette.text.tertiary} />
                      <Text
                        style={[styles.tabItemText, { color: palette.text.secondary }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {t.label}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {tab === 'grid' && (
          <Reanimated.View entering={FadeIn.duration(200)} key="grid" style={{ flex: 1 }}>
            <GridTab />
          </Reanimated.View>
        )}
        {tab === 'today' && (
          <Reanimated.View entering={FadeIn.duration(200)} key="today" style={{ flex: 1 }}>
            <TodayTab />
          </Reanimated.View>
        )}
        {tab === 'shifts' && (
          <Reanimated.View entering={FadeIn.duration(200)} key="shifts" style={{ flex: 1 }}>
            <ShiftsTab />
          </Reanimated.View>
        )}
        {tab === 'rating' && (
          <Reanimated.View entering={FadeIn.duration(200)} key="rating" style={{ flex: 1 }}>
            <RatingTab />
          </Reanimated.View>
        )}
        {tab === 'settings' && (
          <Reanimated.View entering={FadeIn.duration(200)} key="settings" style={{ flex: 1 }}>
            <SettingsTab />
          </Reanimated.View>
        )}
      </View>
    </ScheduleMonthCtx.Provider>
  );
}

const styles = StyleSheet.create({
  // ── Safe / Layout ──
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.3,
  },

  // ── Tab Bar ──
  pointChipRow: { marginHorizontal: spacing[4], marginBottom: spacing[2], alignSelf: 'flex-start' },
  tabBar: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  tabBarInner: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 2,
  },
  tabItem: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    minWidth: 0,
  },
  tabItemActive: {
    shadowColor: colors.primary[700],
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tabItemGradient: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing[1.5],
    paddingHorizontal: 2,
    borderRadius: borderRadius.lg,
  },
  tabItemInner: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing[1.5],
    paddingHorizontal: 2,
  },
  tabItemText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    textAlign: 'center',
  },
  tabItemTextActive: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.white,
    textAlign: 'center',
  },

  // ── Tab content ──
  // Bottom padding is added per-tab via useTabBarHeight() inline override.
  tabContent: {
    padding: spacing[4],
    gap: spacing[3],
  },

  // ── Empty state ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
  },
  emptySubtitle: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },

  // ── Month Navigation (legacy in-tab — kept for typecheck of unused
  //    style references; the actual stepper now lives in the header) ──
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact iOS-header-style month stepper for IosScreenHeader.trailing.
  headerMonthStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.gray[100],
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  headerMonthBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMonthText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray[800],
    minWidth: 36,
    textAlign: 'center',
  },
  monthCenter: {
    alignItems: 'center',
    flex: 1,
  },
  monthTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.5,
  },
  bgRefreshIndicator: {
    position: 'absolute',
    right: -4,
    top: 6,
    transform: [{ scale: 0.7 }],
    opacity: 0.7,
  },
  errorBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
    backgroundColor: colors.red[50],
    borderWidth: 1,
    borderColor: colors.red[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.red[700],
    fontWeight: '500' as const,
  },
  monthYear: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },

  // ── Legend ──
  // Horizontal-scroll strip of chip-style legend items. Each chip carries
  // its own soft tint so the icon + label read as one legible unit. The
  // row never wraps — overflow is handled by horizontal scroll, matching
  // the warehouse-screen chip strip pattern.
  // A horizontal ScrollView with no explicit height greedily fills the
  // remaining vertical space of its flex:1 parent (RN/Fabric measures the
  // horizontal scroll axis as definite but lets the cross axis grow). With
  // contentContainerStyle.alignItems:'center' the chips then float in the
  // middle, leaving a large void BOTH above and below the legend — the
  // owner-reported gap. Pinning the wrapper height (flexGrow:0 + height)
  // makes the band hug the chips so it sits snug under the tabs and right
  // above the grid.
  legendScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 34,
  },
  legendRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    gap: spacing[2],
    alignItems: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 5,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 11,
    color: colors.gray[600],
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },

  // ── Sticky Column ──
  stickyColumn: {
    width: 140,
    backgroundColor: colors.white,
    zIndex: 2,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 3, height: 0 },
    elevation: 5,
    borderRightWidth: 1,
    borderRightColor: colors.gray[200],
  },

  // ── Grid ──
  gridHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[1],
  },
  gridHeaderDow: {
    fontSize: 9,
    color: colors.gray[400],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
  },
  gridHeaderDay: {
    fontSize: 13,
    color: colors.gray[700],
    fontWeight: fontWeight.medium,
    marginTop: 1,
  },
  // "Сегодня" pill in the header — a soft primary-tinted rounded rect
  // holds the uppercase "СЕГОДНЯ" label stacked over the day number.
  // Apple Calendar / Apple Fitness style — single visual unit so the
  // current column reads at a glance.
  gridTodayCircle: {
    minWidth: 38,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTodayLabel: {
    // Pinned to the pill's content width (minWidth 38 − 2×paddingHorizontal 4
    // = 30pt) so `adjustsFontSizeToFit` has a bounded box to shrink the word
    // against. Without this the centered Text sizes to its content and wraps
    // "СЕГОДНЯ" letter-by-letter on the narrow 44pt day column.
    width: 30,
    fontSize: 7,
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: 0.2,
    lineHeight: 8,
    marginBottom: 1,
    textAlign: 'center',
  },
  gridTodayNum: {
    fontSize: 12,
    fontWeight: fontWeight.bold,
    color: colors.white,
    lineHeight: 13,
  },
  gridHeaderLabel: {
    fontSize: 10,
    color: colors.gray[400],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gridNameCell: {
    paddingHorizontal: spacing[1.5],
    justifyContent: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.gray[100],
  },
  gridNameInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  gridAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridAvatarText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  gridName: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.gray[800],
  },
  gridStatsRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: 1,
  },
  gridStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  gridStatDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  gridStatText: {
    fontSize: 8,
    color: colors.gray[400],
    fontWeight: fontWeight.medium,
  },
  gridCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.gray[100],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[100],
    overflow: 'hidden',
  },
  // Today column overlay — subtle borderLeft/Right uses the soft
  // primary[200] hairline to lift the column slightly without the
  // bold "boxed" feel of the previous primary[300] outline.
  gridCellToday: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.primary[300] + 'AA',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.primary[300] + 'AA',
  },
  // Container for cells that include a tiny start-time label under
  // the icon — Ionicon stacked over a 9 pt "HH:MM" text.
  gridCellInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  // Tiny "HH:MM" label rendered under the icon when the shift has a
  // non-default start time. 9 pt so it never dominates the cell.
  gridCellLabel: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 10,
  },
  // Empty-day affordance — a faint 6 pt dot signals "tap to assign"
  // for editors without ever drawing attention.
  gridCellEmpty: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.7,
  },

  // ── Quick Actions ──
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    justifyContent: 'center',
  },
  quickBtn: {
    alignItems: 'center',
    width: 80,
    gap: spacing[1.5],
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    textAlign: 'center',
  },

  // ── Today Tab ──
  // Section eyebrow above each grouped list (Apple Settings style).
  todaySectionTitle: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
    marginTop: spacing[2],
    marginBottom: -spacing[1],
    marginLeft: spacing[1],
  },
  todayDateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  todayDateLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
  },
  todayDateText: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textTransform: 'capitalize',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  todayTotalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
  },
  todayTotalText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  todayStatsRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  todayStatCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3.5],
  },
  todayStatIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayStatNum: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  todayStatLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginTop: -1,
  },
  // Calm Today-tab row — neutral surface, status conveyed by an SF-style
  // icon in a soft tinted circle (same icon language as the grid cells).
  todayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3.5],
  },
  todayStatusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayName: {
    fontSize: 16,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    letterSpacing: -0.2,
  },
  todayStatusLabel: {
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    marginTop: 1,
    letterSpacing: -0.1,
  },
  todayInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: spacing[1.5],
    flexWrap: 'wrap',
  },
  // Small inline meta chip: clock / arrival icon + time.
  todayMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  todayShift: {
    fontSize: 12,
    fontWeight: fontWeight.medium,
    color: colors.gray[600],
  },
  todayNote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gray[500],
    marginTop: 3,
  },

  // ── Shifts Stats ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  statCard: {
    width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2,
    borderRadius: borderRadius['2xl'],
    padding: spacing[4],
    gap: spacing[1],
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing[1],
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },

  // ── Detail Card (late details) ──
  detailCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[4],
    gap: spacing[3],
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  detailHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  detailSection: {
    gap: spacing[1.5],
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  detailDotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  detailLabel: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.gray[100],
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
  },
  avgLateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  avgLateIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avgLateValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[800],
    marginLeft: 'auto',
  },

  // ── Settings ──
  subTabs: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 3,
    marginBottom: spacing[3],
  },
  subTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  subTabActive: {
    backgroundColor: colors.primary[600],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  subTabTextActive: {
    color: colors.white,
    fontWeight: fontWeight.bold,
  },

  // ── Days Off ──
  daysOffCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
  },
  daysOffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  daysOffAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysOffAvatarText: {
    fontSize: 12,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  daysOffName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  daysOffCount: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },
  daysOffRow: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  dayBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
  },
  dayBtnWeekend: {
    borderColor: colors.red[200],
    backgroundColor: colors.red[50] + '50',
  },
  dayBtnActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
    shadowColor: colors.primary[600],
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  dayBtnText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.gray[500],
  },
  dayBtnTextActive: {
    color: colors.white,
  },

  // ── Work Modes ──
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[3],
  },
  modeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  modeTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  modeTimeText: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
  modeApplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[50],
  },
  modeApplyText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary[600],
  },

  // ── Form / Modal ──
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formRowFields: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.gray[50],
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
  },
  applyBtnMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  applyBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
  },
  userChipActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[400],
  },
  userChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[600],
  },
  userChipTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },

  // ── Shift-status toggle list (Settings → Смены) ──
  shiftSectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  shiftSectionHint: {
    fontSize: 12,
    color: colors.gray[500],
    lineHeight: 17,
  },
  shiftListCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    overflow: 'hidden',
  },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 56,
  },
  shiftRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftRowLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  shiftRowDescription: {
    fontSize: 11,
    color: colors.gray[500],
    marginTop: 2,
  },
  shiftSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
  },
  shiftSaveBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: -0.1,
  },
});
