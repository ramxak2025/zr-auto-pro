import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import IosScreenHeader from '../components/IosScreenHeader';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, borderRadius, softTint } from '../theme';
import { callsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { formatDayKey } from '../../../shared/utils/formatters';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
// CallRow + встроенный плеер записей извлечены в переиспользуемый компонент
// (Round 13 #8 — деталка рассрочки показывает звонки той же строкой). Визуал и
// perf-паттерны (React.memo + playerRef) сохранены один-в-один.
import { CallRow, type Call } from '../components/calls/CallRow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallsSummary {
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
  total: number;
}

type FilterTab = 'all' | 'incoming' | 'outgoing' | 'missed';

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'incoming', label: 'Вх.' },
  { key: 'outgoing', label: 'Исх.' },
  { key: 'missed', label: 'Пропущ.' },
];

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function CallsScreen({ navigation }: { navigation: any }) {
  const palette = useColors();
  const { hasPermission } = useAuth();
  // ROLE-ONLY (консолидация 2026-07): список звонков доступен по calls_view (гейт
  // меню), а ПРОСЛУШИВАНИЕ записей — отдельное право calls_listen. «Права как в
  // Битрикс24» (2026-07): admin живёт по матрице из /auth/me; superadmin/director
  // байпасятся внутри hasPermission. Без права — кнопка play не показывается
  // (бэкенд закрывает signed-URL 403 → не будет мёртвой кнопки).
  const canListen = hasPermission('calls_listen');
  // День ленты звонков — календарный день АВТОСЕРВИСА: сервер режет звонки по
  // его суткам (calls.service), и «Сегодня» на экране обязано означать тот же
  // день, что «сегодня» в запросе.
  const tenantTz = useTenantTimezone();
  const tabBarHeight = useTabBarHeight();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Single global "currently expanded player" — exactly one recording can
  // play at a time, tapping a different row swaps which one is open.
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Configure audio session once when the screen mounts. Without this
  // call iOS silences playback if the ringer switch is set to silent —
  // which is the case for most autosalon owners during work hours.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
    }).catch(() => {});
    return () => {
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
      return () => setPollEnabled(false);
    }, []),
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['calls', dateStr],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: dateStr });
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: pollEnabled ? 60_000 : false,
  });

  // Pull-to-refresh — local `refreshing` state (same pattern as ChecksScreen)
  // instead of raw `isFetching`, so the 60-second background poll never
  // yanks the spinner open mid-scroll.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const calls: Call[] = data?.calls ?? [];
  const summary: CallsSummary | undefined = data?.summary;

  const filteredCalls = useMemo(() => {
    switch (activeTab) {
      case 'incoming':
        return calls.filter((c) => c.direction === 'incoming' && c.status === 'answered');
      case 'outgoing':
        return calls.filter((c) => c.direction === 'outgoing');
      case 'missed':
        return calls.filter((c) => c.direction === 'incoming' && (c.status === 'missed' || c.duration === 0));
      default:
        return calls;
    }
  }, [calls, activeTab]);

  const goToPrevDay = () => {
    haptic('select');
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };
  const goToNextDay = () => {
    haptic('select');
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    if (d <= new Date()) setSelectedDate(d);
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
      { label: 'Вх.', value: summary?.incoming ?? 0, color: colors.green[600], bg: colors.green[50] },
      { label: 'Исх.', value: summary?.outgoing ?? 0, color: colors.blue[600], bg: colors.blue[50] },
      { label: 'Пропущ.', value: summary?.missed ?? 0, color: colors.red[500], bg: colors.red[50] },
      { label: 'Без отв.', value: summary?.notCalledBack ?? 0, color: colors.orange[500], bg: colors.orange[50] },
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

      {/* One-line digest — "Сегодня: 12 звонков · 3 пропущенных · 5 → клиенты" */}
      {summary && (
        <Text style={[styles.digest, { color: palette.text.secondary }]} numberOfLines={1}>
          {dateLabel}: {summary.total ?? 0} звонков
          {summary.missed > 0 ? ` · ${summary.missed} пропущенных` : ''}
          {calls.filter((c) => !!c.client).length > 0 ? ` · ${calls.filter((c) => !!c.client).length} → клиенты` : ''}
        </Text>
      )}

      {/* Summary strip */}
      <View style={styles.summaryRow}>
        {summaryItems.map((s) => (
          <View
            key={s.label}
            style={[
              styles.summaryCard,
              { backgroundColor: palette.mode === 'dark' ? softTint(s.color, 'dark') : s.bg },
            ]}
          >
            <Text style={[styles.summaryValue, { color: s.color }]}>{isLoading ? '-' : s.value}</Text>
            <Text style={[styles.summaryLabel, { color: palette.text.secondary }]}>{s.label}</Text>
          </View>
        ))}
      </View>

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
      <View style={styles.tabs}>
        {TABS.map((tab) => {
          const count =
            tab.key === 'all'
              ? summary?.total
              : tab.key === 'incoming'
                ? summary?.incoming
                : tab.key === 'outgoing'
                  ? summary?.outgoing
                  : summary?.missed;
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
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
              onPress={() => setActiveTab(tab.key)}
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
      </View>

      {/* Call list */}
      <ScrollView
        style={[styles.list, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing[4] }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary[500]} style={{ marginTop: spacing[10] }} />
        ) : filteredCalls.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="call-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
              {activeTab === 'missed' ? 'Пропущенных нет' : 'Нет звонков'}
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
          if (d <= new Date()) setSelectedDate(d);
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

  tabs: { flexDirection: 'row', marginHorizontal: spacing[4], marginBottom: spacing[3], gap: spacing[2] },
  tab: {
    flex: 1,
    paddingVertical: spacing[2],
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
  },
  tabActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  tabText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[400] },
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
});
