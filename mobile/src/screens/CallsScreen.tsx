import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView as NativeScrollView,
} from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import IosScreenHeader from '../components/IosScreenHeader';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, borderRadius, softTint } from '../theme';
import { callsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { captureDataSession } from '../contexts/dataSession';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { formatDayKey } from '../../../shared/utils/formatters';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
// CallRow + встроенный плеер записей извлечены в переиспользуемый компонент
// (Round 13 #8 — деталка рассрочки показывает звонки той же строкой). Визуал и
// perf-паттерны (React.memo + playerRef) сохранены один-в-один.
import { CallRow } from '../components/calls/CallRow';
import { TabBarScrollView as ScrollView } from '../components/TabBarScrollable';
import type { DashboardMoreStackParamList } from '../navigation/AppNavigator';
import {
  CALLS_TABS,
  callsEntry,
  callsFilterCount,
  callsJournalSnapshot,
  filterCalls,
  telephonyDisconnected,
  type CallsFilter,
  type CallsJournalSnapshot,
} from './callsJournalState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallsScreenProps {
  navigation: { goBack: () => void };
}

interface CallsScope {
  key: readonly (string | number | boolean | null)[];
  isCurrent: () => boolean;
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function CallsScreen() {
  const navigation = useNavigation<NavigationProp<DashboardMoreStackParamList, 'Calls'>>();
  const route = useRoute<RouteProp<DashboardMoreStackParamList, 'Calls'>>();
  const { user, activeAccountId, sessionGeneration, hasPermission } = useAuth();
  const tenantTz = useTenantTimezone();
  const lease = captureDataSession();
  const canView = !!user && hasPermission('calls_view');
  const canListen = canView && hasPermission('calls_listen');
  const key = [
    activeAccountId,
    user?.tenantId ?? null,
    user?.id ?? null,
    user?.currentPointId ?? null,
    user?.role ?? null,
    sessionGeneration,
    lease.generation,
    tenantTz,
    canView,
    canListen,
    JSON.stringify(user?.permissions ?? {}),
  ];
  const scope: CallsScope = {
    key,
    isCurrent: () =>
      lease.isCurrent() &&
      lease.owner?.userId === user?.id &&
      lease.owner?.tenantId === (user?.tenantId ?? null) &&
      lease.owner?.pointId === (user?.currentPointId ?? null),
  };
  const entry = callsEntry(route.params);
  // Only a fresh entry or data-owner change resets browsing and the expanded recording.
  return (
    <CallsJournal
      key={JSON.stringify([key, entry?.entryRequestId ?? null])}
      navigation={navigation}
      scope={scope}
      canView={canView}
      canListen={canListen}
      tenantTz={tenantTz}
      initialFilter={entry?.filter ?? 'all'}
    />
  );
}

export function CallsJournal({
  navigation,
  scope,
  canView,
  canListen,
  tenantTz,
  initialFilter,
}: {
  navigation: CallsScreenProps['navigation'];
  scope: CallsScope;
  canView: boolean;
  canListen: boolean;
  tenantTz: string;
  initialFilter: CallsFilter;
}) {
  const palette = useColors();
  // ROLE-ONLY (консолидация 2026-07): список звонков доступен по calls_view (гейт
  // меню), а ПРОСЛУШИВАНИЕ записей — отдельное право calls_listen. «Права как в
  // Битрикс24» (2026-07): admin живёт по матрице из /auth/me; superadmin/director
  // байпасятся внутри hasPermission. Без права — кнопка play не показывается
  // (бэкенд закрывает signed-URL 403 → не будет мёртвой кнопки).
  // День ленты звонков — календарный день АВТОСЕРВИСА: сервер режет звонки по
  // его суткам (calls.service), и «Сегодня» на экране обязано означать тот же
  // день, что «сегодня» в запросе.
  const tabBarHeight = useTabBarHeight();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<CallsFilter>(initialFilter);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Single global "currently expanded player" — exactly one recording can
  // play at a time, tapping a different row swaps which one is open.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const access = useRef({ mounted: true, canView, scope });
  const tabsRef = useRef<NativeScrollView>(null);
  Object.assign(access.current, { canView, scope });
  const current = useCallback(() => access.current.mounted && access.current.canView && scope.isCurrent(), [scope]);

  // Configure audio session once when the screen mounts. Without this
  // call iOS silences playback if the ringer switch is set to silent —
  // which is the case for most autosalon owners during work hours.
  useEffect(() => {
    access.current.mounted = true;
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
    }).catch(() => {});
    return () => {
      access.current.mounted = false;
      // Stop any audio when leaving the screen
      setPlayingId(null);
    };
  }, []);

  const dateStr = useMemo(() => formatDayKey(selectedDate, tenantTz), [selectedDate, tenantTz]);

  const dateLabel = useMemo(() => {
    const now = new Date();
    const todayStr = formatDayKey(now, tenantTz);
    // «Вчера» = минус сутки: в российских поясах перевода часов нет, поэтому
    // −24 часа всегда попадают в предыдущий календарный день.
    const yesterdayStr = formatDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), tenantTz);
    if (dateStr === todayStr) return 'Сегодня';
    if (dateStr === yesterdayStr) return 'Вчера';
    try {
      return selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: tenantTz });
    } catch {
      return selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
  }, [dateStr, selectedDate, tenantTz]);

  // Pause the 60-second poll when this screen is not focused. CallsScreen
  // sits inside MoreStack — when the user is on another tab/screen the
  // poll would still spend a JS-thread tick + network roundtrip on data
  // they're not looking at.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => {
        setPollEnabled(false);
        setPlayingId(null);
      };
    }, []),
  );

  const { data, isPending, isError, isPlaceholderData, fetchStatus, isFetching, refetch } =
    useQuery<CallsJournalSnapshot>({
      queryKey: ['calls', ...scope.key, dateStr],
      queryFn: async () => {
        if (!current()) throw new Error('Сессия изменилась');
        let res;
        try {
          res = await callsApi.getCalls({ date: dateStr });
        } catch (error) {
          if (!current()) throw new Error('Сессия изменилась');
          if (telephonyDisconnected(error)) return { kind: 'disconnected' };
          throw new Error('Не удалось обновить звонки');
        }
        if (!current()) throw new Error('Сессия изменилась');
        return callsJournalSnapshot(res.data);
      },
      enabled: pollEnabled && canView && scope.isCurrent(),
      staleTime: 30_000,
      refetchOnMount: 'always',
      placeholderData: undefined,
      refetchInterval: (query) =>
        pollEnabled && current() && query.state.data?.kind !== 'disconnected' ? 60_000 : false,
    });

  // Pull-to-refresh — local `refreshing` state (same pattern as ChecksScreen)
  // instead of raw `isFetching`, so the 60-second background poll never
  // yanks the spinner open mid-scroll.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    if (!current() || !pollEnabled) return;
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      if (access.current.mounted) setRefreshing(false);
    }
  }, [refetch, pollEnabled, current]);

  const available =
    current() && !isPending && !isError && !isPlaceholderData && fetchStatus !== 'paused' && data?.kind === 'connected';
  const calls = available && data?.kind === 'connected' ? data.calls : [];
  const summary = available && data?.kind === 'connected' ? data.summary : null;
  const filteredCalls = useMemo(() => filterCalls(calls, activeTab), [calls, activeTab]);

  const goToPrevDay = () => {
    haptic('select');
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setPlayingId(null);
    setSelectedDate(d);
  };
  const goToNextDay = () => {
    haptic('select');
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    if (d <= new Date()) {
      setPlayingId(null);
      setSelectedDate(d);
    }
  };
  const openDatePicker = () => {
    haptic('tap');
    setDatePickerOpen(true);
  };
  const isToday = dateStr === formatDayKey(new Date(), tenantTz);

  // Memoised so the .map() in JSX doesn't allocate a fresh array of 4
  // objects on every render (every keystroke, every tab switch, every
  // 60-second background refetch when focused).
  const summaryItems = useMemo(
    () => [
      {
        label: 'Принято',
        value: summary ? summary.incoming - summary.missed : undefined,
        color: colors.green[600],
        bg: colors.green[50],
      },
      { label: 'Исх.', value: summary?.outgoing ?? 0, color: colors.blue[600], bg: colors.blue[50] },
      { label: 'Пропущ.', value: summary?.missed ?? 0, color: colors.red[500], bg: colors.red[50] },
      { label: 'Без перезвона', value: summary?.notCalledBack, color: colors.orange[500], bg: colors.orange[50] },
    ],
    [summary?.incoming, summary?.outgoing, summary?.missed, summary?.notCalledBack],
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.bg.canvas }]}>
      {/* Unified iOS header — date stepper + calendar in trailing slot. */}
      <IosScreenHeader
        title="Звонки"
        subtitle={dateLabel}
        onBack={() => navigation.goBack()}
        trailing={
          <View style={styles.dateNav}>
            <TouchableOpacity
              onPress={goToPrevDay}
              style={[styles.dateBtn, { backgroundColor: palette.bg.muted }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Предыдущий день"
            >
              <Ionicons name="chevron-back" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openDatePicker}
              style={[styles.dateBtn, { backgroundColor: palette.bg.muted }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Выбрать дату"
            >
              <Ionicons name="calendar-outline" size={16} color={palette.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goToNextDay}
              disabled={isToday}
              style={[styles.dateBtn, { backgroundColor: palette.bg.muted }, isToday && { opacity: 0.25 }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Следующий день"
            >
              <Ionicons name="chevron-forward" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
          </View>
        }
      />

      <Text style={[styles.digest, { color: palette.text.secondary }]}>По всей компании</Text>
      {summary && (
        <Text style={[styles.digest, { color: palette.text.secondary }]} numberOfLines={1}>
          {dateLabel}: {summary.total ?? 0} звонков
          {summary.missed > 0 ? ` · ${summary.missed} пропущенных` : ''}
          {calls.filter((c) => !!c.client).length > 0 ? ` · ${calls.filter((c) => !!c.client).length} → клиенты` : ''}
        </Text>
      )}

      {/* Summary strip */}
      {summary && (
        <View style={styles.summaryRow}>
          {summaryItems.map((s) => (
            <View
              key={s.label}
              style={[
                styles.summaryCard,
                { backgroundColor: palette.mode === 'dark' ? softTint(s.color, 'dark') : s.bg },
              ]}
            >
              <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
              <Text style={[styles.summaryLabel, { color: palette.text.secondary }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Warning */}
      {summary && summary.notCalledBack > 0 && (
        <View
          style={[
            styles.warning,
            palette.mode === 'dark' && {
              backgroundColor: softTint(colors.orange[600], 'dark'),
              borderColor: palette.border.subtle,
            },
          ]}
        >
          <Ionicons
            name="alert-circle"
            size={16}
            color={palette.mode === 'dark' ? colors.orange[400] : colors.orange[500]}
          />
          <Text style={[styles.warningText, palette.mode === 'dark' && { color: colors.orange[400] }]}>
            {summary.notCalledBack} без перезвона
          </Text>
        </View>
      )}

      {/* Filter tabs */}
      <NativeScrollView
        ref={tabsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroller}
        contentContainerStyle={styles.tabs}
      >
        {CALLS_TABS.map((tab) => {
          const count = summary ? callsFilterCount(summary, tab.key) : undefined;
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onLayout={(event) => {
                if (active)
                  tabsRef.current?.scrollTo({
                    x: Math.max(0, event.nativeEvent.layout.x - spacing[4]),
                    animated: false,
                  });
              }}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label}${count !== undefined ? `: ${count}` : ''}`}
              accessibilityState={{ selected: active, disabled: !canView }}
              disabled={!canView}
              style={[
                styles.tab,
                { backgroundColor: palette.bg.muted },
                active &&
                  (palette.mode === 'dark'
                    ? {
                        backgroundColor: palette.accent.primarySoft,
                        borderWidth: 1,
                        borderColor: palette.border.strong,
                      }
                    : styles.tabActive),
              ]}
              onPress={() => {
                if (!current()) return;
                setPlayingId(null);
                setActiveTab(tab.key);
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: palette.text.tertiary },
                  active && (palette.mode === 'dark' ? { color: palette.accent.primaryText } : styles.tabTextActive),
                ]}
              >
                {tab.label} {count !== undefined ? count : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </NativeScrollView>

      {/* Call list */}
      <ScrollView
        style={[styles.list, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing[4] }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {!canView || !scope.isCurrent() ? (
          <View style={styles.empty} accessibilityRole="alert">
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Журнал звонков недоступен</Text>
          </View>
        ) : fetchStatus === 'paused' ? (
          <View style={styles.empty} accessibilityRole="alert">
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Нет связи</Text>
            <Text style={[styles.stateHint, { color: palette.text.secondary }]}>Обновим после подключения</Text>
          </View>
        ) : isPending ? (
          <ActivityIndicator size="small" color={colors.primary[500]} style={{ marginTop: spacing[10] }} />
        ) : isError || isPlaceholderData || !data ? (
          <View style={styles.empty} accessibilityRole="alert">
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Звонки не обновились</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку звонков"
              disabled={isFetching || !pollEnabled}
              style={styles.retry}
              onPress={() => {
                if (current() && pollEnabled) void refetch();
              }}
            >
              <Text style={{ color: palette.accent.primaryText }}>Повторить</Text>
            </TouchableOpacity>
          </View>
        ) : data.kind === 'disconnected' ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Телефония не подключена</Text>
            <Text style={[styles.stateHint, { color: palette.text.secondary }]}>
              Подключение — в настройках интеграций
            </Text>
          </View>
        ) : filteredCalls.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="call-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
              {activeTab === 'pending'
                ? 'Без перезвона звонков нет'
                : activeTab === 'missed'
                  ? 'Пропущенных нет'
                  : activeTab === 'incoming'
                    ? 'Принятых звонков нет'
                    : activeTab === 'outgoing'
                      ? 'Исходящих звонков нет'
                      : 'Нет звонков за этот день'}
            </Text>
          </View>
        ) : (
          filteredCalls.map((call, idx) => (
            <CallRow
              key={`${call.id}-${idx}`}
              call={call}
              navigation={navigation}
              playingId={playingId}
              setPlayingId={setPlayingId}
              canListen={canListen}
              palette={palette}
              timeZone={tenantTz}
            />
          ))
        )}
      </ScrollView>

      <DateTimePickerModal
        visible={datePickerOpen}
        value={selectedDate}
        mode="date"
        onConfirm={(d) => {
          haptic('select');
          setDatePickerOpen(false);
          // Forbid future dates — server returns nothing for them anyway.
          if (d <= new Date()) {
            setPlayingId(null);
            setSelectedDate(d);
          }
        }}
        onCancel={() => setDatePickerOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  subtitle: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 1 },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    minWidth: 70,
    textAlign: 'center',
  },

  digest: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  summaryRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  summaryCard: { flex: 1, borderRadius: borderRadius.xl, paddingVertical: spacing[2.5], alignItems: 'center' },
  summaryValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  summaryLabel: { fontSize: 10, color: colors.gray[500], marginTop: 2 },

  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.orange[50],
    borderWidth: 1,
    borderColor: colors.amber[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
  },
  warningText: { fontSize: fontSize.xs, color: colors.orange[600], fontWeight: fontWeight.medium },

  tabsScroller: { flexGrow: 0, marginBottom: spacing[3] },
  tabs: { paddingHorizontal: spacing[4], gap: spacing[2] },
  tab: {
    minHeight: 44,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
  },
  tabActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  tabText: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.gray[400] },
  tabTextActive: { color: colors.primary[600] },

  list: {
    flex: 1,
    backgroundColor: colors.white,
    marginHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },

  empty: { alignItems: 'center', paddingVertical: spacing[12] },
  emptyText: { fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] },
  stateHint: { fontSize: fontSize.sm, marginTop: spacing[2], textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 80, justifyContent: 'center', alignItems: 'center', marginTop: spacing[2] },
});
