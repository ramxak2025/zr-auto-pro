import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  AppState,
  Platform,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../contexts/AuthContext';
import { captureDataSession } from '../../../contexts/dataSession';
import { useTenantTimezone } from '../../../contexts/TenantTimezoneContext';
import { useColors } from '../../../contexts/ThemeContext';
import { reportsApi } from '../../../api/services';
import { TabBarScrollView } from '../../../components/TabBarScrollable';
import DateTimePickerModal from '../../../components/DateTimePickerModal';
import Modal from '../../../components/Modal';
import { useReduceMotionPreference } from '../../../hooks/useReduceMotionPreference';
import { OwnerHomeToolbar, OwnerHomePeriodControl } from './OwnerHomeToolbar';
import OwnerHomeDateNavigation from './OwnerHomeDateNavigation';
import { ownerPeriodNavigation } from './ownerHomePeriodNavigation';
import OwnerHomeTimelineChart from './OwnerHomeTimelineChart';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';
import { ownerTimelineModel } from './ownerHomeTimelineModel';
import { prefKey, usePreference } from '../../../hooks/usePreference';
import { formatDayKey } from '../../../../../shared/utils/formatters';
import { invalidateAttendanceQueries } from '../../../../../shared/utils/attendanceQueries';
import type { OwnerHomeTimeline, OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';
import OwnerHomeOperational, { OwnerHomeRetry } from './OwnerHomeOperational';
import OwnerHomeLiveWidgets from './OwnerHomeLiveWidgets';
import OwnerHomeDetails, { type OwnerHomeDetail } from './OwnerHomeDetails';
import OwnerHomeWidgetSync from './OwnerHomeWidgetSync';
import {
  loadOwnerHome,
  ownerDateLabel,
  ownerHomeEnabled,
  ownerPickerDate,
  ownerRangeLabel,
  type OwnerHomeScope,
} from './ownerHomeState';

/** Remount date, dialogs and local preferences when the data owner changes. */
export default function OwnerHomeScreen() {
  const { user, activeAccountId, sessionGeneration } = useAuth();
  const timezone = useTenantTimezone();
  const reducedMotion = useReduceMotionPreference();
  const lease = captureDataSession();
  const key = [
    activeAccountId,
    user?.tenantId ?? null,
    user?.id ?? null,
    user?.currentPointId ?? null,
    sessionGeneration,
    lease.generation,
    timezone,
    JSON.stringify(user?.permissions ?? {}),
  ];
  const scope: OwnerHomeScope = { key, isCurrent: lease.isCurrent };
  if (!ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role)) return null;
  return <OwnerHomeContent key={JSON.stringify(key)} scope={scope} reducedMotion={reducedMotion} />;
}

export function OwnerHomeContent({ scope, reducedMotion = true }: { scope: OwnerHomeScope; reducedMotion?: boolean }) {
  const p = useColors();
  const clientTone = ownerHomeSurfaces(p.mode === 'dark').clients;
  const { user, refreshUser, hasPermission } = useAuth();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [asOf, setAsOf] = useState<string | undefined>();
  const [period, setPeriod] = useState<OwnerHomeTimelinePeriod>('day');
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [detail, setDetail] = useState<OwnerHomeDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const showEarnings = usePreference(prefKey('owner-home-pilot-earnings', user?.id), true);
  const allowed = ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role);
  const enabled = allowed && isFocused && active;
  const scopeKey = JSON.stringify(scope.key);
  const refresh = useCallback(() => {
    if (allowed && scope.isCurrent() && AppState.currentState === 'active') {
      // Retain the legacy attendance invalidation when returning from NFC or resuming.
      // Use the existing focus/foreground/pull events, without a second polling timer.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['owner-home', ...scope.key] }),
        invalidateAttendanceQueries(queryClient),
      ]);
    }
    return Promise.resolve();
  }, [allowed, scopeKey, queryClient]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'active') void refresh();
    });
    return () => listener.remove();
  }, [refresh]);
  const timeline = useQuery({
    queryKey: ['owner-home', ...scope.key, 'timeline', period, asOf ?? 'today'],
    queryFn: () => loadOwnerHome(scope, () => reportsApi.ownerHomeTimeline({ period, ...(asOf ? { asOf } : {}) })),
    enabled,
    staleTime: 30_000,
    refetchOnMount: 'always',
    placeholderData: undefined,
    refetchInterval: enabled && !asOf ? 60_000 : false,
  });
  const response = timeline.data;
  const model = useMemo(() => (response ? ownerTimelineModel(response, period, asOf) : null), [response, period, asOf]);
  const financialReady = !!response && !!model && !timeline.isPending && !timeline.isError;
  const data = financialReady ? response : undefined;
  const invalidTimeline = !!response && !model;
  const calendarContext = useRef<Pick<OwnerHomeTimeline, 'todayDate' | 'timezone'> | null>(null);
  if (data) calendarContext.current = { todayDate: data.todayDate, timezone: data.timezone };
  const calendarMeta = calendarContext.current;
  const selectedDate = asOf ?? calendarMeta?.todayDate;
  const navigationContext = useRef({ scopeKey, enabled, period, selectedDate, calendarMeta });
  navigationContext.current = { scopeKey, enabled, period, selectedDate, calendarMeta };
  const range = data?.visitsRange;
  const visits = useQuery({
    queryKey: ['owner-home', ...scope.key, 'visits', range?.from ?? null, range?.to ?? null],
    queryFn: () => {
      if (!range) throw new Error('Период ещё не определён');
      return loadOwnerHome(scope, () => reportsApi.ownerHomeVisits(range));
    },
    enabled: enabled && !!range,
    staleTime: 30_000,
    refetchOnMount: 'always',
    placeholderData: undefined,
    refetchInterval: enabled && !asOf ? 60_000 : false,
  });

  const currentNavigation = () => {
    const current = navigationContext.current;
    return current.scopeKey === scopeKey && current.enabled && scope.isCurrent() && AppState.currentState === 'active'
      ? current
      : null;
  };
  const chooseDate = (date: string) => {
    const current = currentNavigation();
    if (!current?.calendarMeta) return;
    if (!ownerPeriodNavigation('day', date, current.calendarMeta.todayDate)) {
      Alert.alert('Дата сводки', 'Выберите сегодняшнюю или прошедшую дату по времени автосервиса.');
      return;
    }
    // Consecutive taps can arrive before React renders the next requested date.
    navigationContext.current.selectedDate = date;
    setAsOf(date === current.calendarMeta.todayDate ? undefined : date);
    setDetail(null);
  };
  const pageDate = (direction: -1 | 1) => {
    const current = currentNavigation();
    if (!current?.calendarMeta || current.period !== period) return;
    const navigation = ownerPeriodNavigation(period, current.selectedDate, current.calendarMeta.todayDate);
    const next = direction < 0 ? navigation?.previousDate : navigation?.nextDate;
    if (next) chooseDate(next);
  };
  const returnToToday = () => {
    const current = currentNavigation();
    if (current?.calendarMeta) chooseDate(current.calendarMeta.todayDate);
  };
  const openCalendar = () => {
    const current = currentNavigation();
    if (current?.calendarMeta && current.selectedDate) setCalendarVisible(true);
  };
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshUser(), refresh()]);
    } finally {
      if (scope.isCurrent()) setRefreshing(false);
    }
  };
  const openDateMenu = () => {
    const current = currentNavigation();
    if (!current?.selectedDate || !current.calendarMeta) return;
    const choices = [
      { text: 'Выбрать дату', onPress: openCalendar },
      ...(current.selectedDate !== current.calendarMeta.todayDate ? [{ text: 'Сегодня', onPress: returnToToday }] : []),
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: ownerDateLabel(current.selectedDate, true),
          options: [...choices.map((choice) => choice.text), 'Отмена'],
          cancelButtonIndex: choices.length,
          userInterfaceStyle: p.mode,
        },
        (index) => choices[index]?.onPress(),
      );
    } else {
      Alert.alert('Дата сводки', ownerDateLabel(current.selectedDate, true), choices, { cancelable: true });
    }
  };
  const historical = !!data && data.canonicalDate !== data.todayDate;
  const visitReady = financialReady && visits.data && !visits.isPending && !visits.isError;
  const currentRange =
    range && data
      ? range.from === range.to && range.to === data.todayDate
        ? 'За сегодня'
        : ownerRangeLabel(range.from, range.to, data.todayDate.slice(0, 4))
      : '';
  return (
    <View style={[styles.screen, { backgroundColor: p.bg.canvas }]}>
      {enabled && <OwnerHomeWidgetSync scope={scope} enabled={enabled} />}
      <TabBarScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 5 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={p.accent.primary} />}
      >
        <OwnerHomeToolbar
          calendarEnabled={enabled && scope.isCurrent() && !!selectedDate && !!calendarMeta}
          onCalendar={openDateMenu}
          onSettings={() => setSettingsVisible(true)}
          reducedMotion={reducedMotion}
        />
        <OwnerHomePeriodControl
          value={period}
          onChange={(value) => {
            if (!currentNavigation()) return;
            navigationContext.current.period = value;
            setPeriod(value);
            setDetail(null);
          }}
          dayIsToday={!asOf || asOf === calendarMeta?.todayDate}
          reducedMotion={reducedMotion}
        />
        <OwnerHomeDateNavigation
          period={period}
          selectedDate={selectedDate}
          todayDate={calendarMeta?.todayDate}
          enabled={enabled && scope.isCurrent()}
          onPrevious={() => pageDate(-1)}
          onNext={() => pageDate(1)}
          onToday={returnToToday}
          onCalendar={openCalendar}
        />
        {data && model ? (
          <OwnerHomeTimelineChart
            key={`${period}:${asOf ?? 'today'}`}
            data={data}
            model={model}
            scope={scope}
            active={enabled}
            reducedMotion={reducedMotion}
            onRangeDetails={() => setDetail({ kind: 'timeline', timeline: data })}
            onMonthDetails={() => setDetail({ kind: 'profit', period: 'month', profit: data.footer })}
            onInfo={() => setDetail({ kind: 'timeline-info', timeline: data })}
          />
        ) : (
          <View style={[styles.financePlaceholder, { backgroundColor: p.mode === 'dark' ? '#203f86' : '#1d50c7' }]}>
            <Text style={styles.inverseCaption}>
              {selectedDate
                ? ownerDateLabel(selectedDate, selectedDate.slice(0, 4) !== calendarMeta?.todayDate.slice(0, 4))
                : 'Период сервиса'}
            </Text>
            {timeline.isError || invalidTimeline ? (
              <OwnerHomeRetry
                text={invalidTimeline ? 'Данные графика не совпали с периодом' : 'Сводка не загрузилась'}
                busy={timeline.isFetching}
                onRetry={timeline.refetch}
                inverse
              />
            ) : (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Загружается выбранный период"
                style={styles.financeLoading}
              >
                <View style={[styles.financeSkeleton, { height: 42, width: '80%' }]} />
                <View style={[styles.financeSkeleton, { height: 145 }]} />
                <View style={[styles.financeSkeleton, { height: 35, width: '65%' }]} />
              </View>
            )}
            <Text style={styles.inverseCaption}>Пересчёт · текущий план</Text>
          </View>
        )}

        <View style={[styles.clients, { backgroundColor: clientTone.background }]}>
          <View style={styles.clientHeading}>
            <Ionicons name="people-outline" size={19} color={clientTone.ink} />
            <Text accessibilityRole="header" style={[styles.clientTitle, { color: clientTone.ink }]}>
              Клиенты
              {visitReady ? (
                <Text style={[styles.clientTotal, { color: clientTone.ink }]}> · {visits.data.servedClients}</Text>
              ) : null}
            </Text>
            <Text style={[styles.caption, { color: p.text.secondary, flexShrink: 1, textAlign: 'right' }]}>
              {currentRange}
            </Text>
          </View>
          <View style={styles.clientGroup}>
            {!financialReady || visits.isPending ? (
              timeline.isError || invalidTimeline ? (
                <Text style={[styles.clientUnavailable, { color: p.text.secondary }]}>Данные за период недоступны</Text>
              ) : (
                <View
                  style={styles.clientLoading}
                  accessibilityRole="progressbar"
                  accessibilityLabel="Загружаются клиенты выбранного периода"
                >
                  <View style={[styles.clientPlaceholder, { backgroundColor: p.bg.muted }]} />
                  <View style={[styles.clientPlaceholder, { backgroundColor: p.bg.muted }]} />
                </View>
              )
            ) : visits.isError ? (
              <OwnerHomeRetry text="Визиты не загрузились" busy={visits.isFetching} onRetry={visits.refetch} />
            ) : visitReady && range ? (
              <>
                <View style={styles.cohorts}>
                  {(['new', 'returning'] as const).map((cohort, index) => (
                    <TouchableOpacity
                      key={cohort}
                      accessibilityRole="button"
                      accessibilityLabel={`${cohort === 'new' ? 'Впервые' : 'Повторно'}: ${cohort === 'new' ? visits.data.newClients : visits.data.returningClients}. Открыть клиентов за выбранный период`}
                      style={styles.cohort}
                      activeOpacity={0.65}
                      onPress={() => setDetail({ kind: 'clients', cohort, range, timezone: data.timezone })}
                    >
                      {index === 1 && <View style={[styles.cohortDivider, { backgroundColor: clientTone.divider }]} />}
                      <Text style={[styles.cohortLabel, { color: clientTone.ink }]}>
                        {cohort === 'new' ? 'Впервые' : 'Повторно'}
                      </Text>
                      <View style={styles.cohortValueRow}>
                        <Text style={[styles.cohortValue, { color: clientTone.ink }]}>
                          {cohort === 'new' ? visits.data.newClients : visits.data.returningClients}
                        </Text>
                        <Ionicons name="chevron-forward" size={13} color={p.text.secondary} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                {visits.data.newClients + visits.data.returningClients > 0 && (
                  <View
                    style={styles.cohortTrack}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <View style={{ flex: Math.max(0, visits.data.newClients), backgroundColor: clientTone.strong }} />
                    <View
                      style={{ flex: Math.max(0, visits.data.returningClients), backgroundColor: clientTone.soft }}
                    />
                  </View>
                )}
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.65}
                  accessibilityLabel={`${visits.data.rapidReturnVehicleCount} автомобилей вернулись в течение 30 дней. История за выбранный период`}
                  style={[styles.rapid, { backgroundColor: clientTone.inset }]}
                  onPress={() => setDetail({ kind: 'returns', range, timezone: data.timezone })}
                >
                  <Ionicons name="repeat-outline" size={18} color={clientTone.ink} />
                  <Text style={[styles.rapidTitle, { color: clientTone.ink }]}>Повтор до 30 дней</Text>
                  <Text style={[styles.rapidCount, { color: clientTone.ink }]}>
                    {visits.data.rapidReturnVehicleCount} авто
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={p.text.secondary} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
        {historical && (
          <Text style={[styles.historyNote, { color: p.text.secondary }]}>
            Ниже — смены, звонки, задачи и заработок за сегодня, {ownerDateLabel(data.todayDate)}.
          </Text>
        )}
        <OwnerHomeLiveWidgets scope={scope} enabled={enabled} />
        <OwnerHomeOperational
          scope={scope}
          enabled={enabled}
          showEarnings={showEarnings.value}
          todayDate={calendarMeta?.todayDate}
        />
      </TabBarScrollView>
      <View
        testID="owner-home-status-bar-scrim"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.statusBarScrim, { height: insets.top, backgroundColor: p.bg.canvas }]}
      />
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.bottomSafe, { height: insets.bottom, backgroundColor: p.bg.canvas }]}
      />
      {calendarVisible && selectedDate && calendarMeta && (
        <DateTimePickerModal
          visible
          value={ownerPickerDate(selectedDate, calendarMeta.timezone)}
          mode="date"
          timeZone={calendarMeta.timezone}
          onCancel={() => setCalendarVisible(false)}
          onConfirm={(date) => {
            if (!currentNavigation()) return;
            setCalendarVisible(false);
            chooseDate(formatDayKey(date, calendarMeta.timezone));
          }}
        />
      )}
      <Modal visible={settingsVisible} onClose={() => setSettingsVisible(false)} title="Главная">
        {hasPermission('salary_view_all') && (
          <View style={styles.setting}>
            <Text style={[styles.settingLabel, { color: p.text.primary }]}>Мастера сегодня</Text>
            <Switch
              accessibilityLabel="Показывать мастеров сегодня"
              value={showEarnings.value}
              onValueChange={showEarnings.setValue}
            />
          </View>
        )}
        <Text style={[styles.caption, { color: p.text.secondary }]}>
          Период меняет финансы и клиентов. Задачи и заработок относятся к сегодняшнему дню.
        </Text>
      </Modal>
      {detail && (
        <OwnerHomeDetails detail={detail} scope={scope} onClose={() => setDetail(null)} reducedMotion={reducedMotion} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusBarScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 21 },
  bottomSafe: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  content: { paddingHorizontal: 17, paddingBottom: 24 },
  financePlaceholder: { minHeight: 330, borderRadius: 21, padding: 14, justifyContent: 'space-between' },
  inverseCaption: { color: '#d8e6ff', fontSize: 12, lineHeight: 17 },
  financeLoading: { gap: 12, paddingVertical: 14 },
  financeSkeleton: { borderRadius: 7, backgroundColor: 'rgba(255,255,255,.15)' },
  clients: { marginTop: 14, borderRadius: 18, overflow: 'hidden' },
  clientHeading: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 0,
  },
  clientTitle: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  clientTotal: { fontSize: 12, fontWeight: '400' },
  clientGroup: { overflow: 'hidden' },
  cohorts: { flexDirection: 'row' },
  cohort: {
    flex: 1,
    minHeight: 80,
    paddingHorizontal: 15,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 3,
  },
  cohortDivider: { position: 'absolute', left: 0, top: 13, bottom: 13, width: StyleSheet.hairlineWidth },
  cohortLabel: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  cohortValueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  cohortValue: { fontSize: 28, lineHeight: 34, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cohortTrack: {
    height: 4,
    marginHorizontal: 15,
    marginTop: 2,
    marginBottom: 14,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 3,
  },
  rapid: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rapidTitle: { fontSize: 13, lineHeight: 18, flex: 1 },
  rapidCount: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clientLoading: { height: 94, padding: 16, gap: 12 },
  clientPlaceholder: { height: 22, borderRadius: 5 },
  clientUnavailable: { minHeight: 70, padding: 16, fontSize: 13, lineHeight: 19 },
  historyNote: { fontSize: 12, lineHeight: 18, marginTop: 10, paddingHorizontal: 2 },
  caption: { fontSize: 12, lineHeight: 18 },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  settingLabel: { flex: 1, fontSize: 15, lineHeight: 22 },
});
