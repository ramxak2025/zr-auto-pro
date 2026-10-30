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
  useWindowDimensions,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
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
import OwnerHomeSummary, { OwnerHomeSummaryPlaceholder } from './OwnerHomeSummary';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';
import { ownerTimelineModel } from './ownerHomeTimelineModel';
import { prefKey, usePreference } from '../../../hooks/usePreference';
import { formatDayKey } from '../../../../../shared/utils/formatters';
import { invalidateAttendanceQueries } from '../../../../../shared/utils/attendanceQueries';
import type { OwnerHomeTimeline, OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';
import OwnerHomeOperational, { OwnerHomeRetry } from './OwnerHomeOperational';
import OwnerHomeLiveWidgets from './OwnerHomeLiveWidgets';
import OwnerHomeCash from './OwnerHomeCash';
import OwnerHomeWidgetActions from './OwnerHomeWidgetActions';
import { useOwnerHomeCloudEntrance } from './useOwnerHomeCloudEntrance';
import { ownerWidgetLayout, ownerWidgetText } from './ownerHomeWidgetDesign';
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
  const nativeReducedMotion = useReducedMotion();
  const reducedMotion = useReduceMotionPreference(nativeReducedMotion);
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
  const { width, fontScale } = useWindowDimensions();
  const stackedClients = width < 360 || fontScale > 1.2;
  const clientTone = ownerHomeSurfaces(p.mode === 'dark').clients;
  const { user, refreshUser, hasPermission } = useAuth();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [cloudActivation, setCloudActivation] = useState(0);
  const cloudActivationRef = useRef(0);
  const wasBackground = useRef(AppState.currentState === 'background');
  const [asOf, setAsOf] = useState<string | undefined>();
  const [period, setPeriod] = useState<OwnerHomeTimelinePeriod>('day');
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [detail, setDetail] = useState<OwnerHomeDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const showEarnings = usePreference(prefKey('owner-home-pilot-earnings', user?.id), true);
  const allowed = ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role);
  const enabled = allowed && isFocused && active;
  const cloudStyle = useOwnerHomeCloudEntrance({ enabled, reducedMotion, activation: cloudActivation });
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
      if (state === 'background') wasBackground.current = true;
      if (state === 'active' && wasBackground.current) {
        wasBackground.current = false;
        setCloudActivation(++cloudActivationRef.current);
      }
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
  const financialContext = useRef(data);
  financialContext.current = data;
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
  const openFinancialDetail = (next: OwnerHomeDetail) => {
    const current = currentNavigation();
    if (
      data &&
      financialContext.current === data &&
      current?.period === data.range.period &&
      current.selectedDate === data.canonicalDate
    )
      setDetail(next);
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
  const widgetActions = (
    <OwnerHomeWidgetActions
      enabled={enabled}
      isCurrent={() => !!currentNavigation()}
      onSettings={() => setSettingsVisible(true)}
      reducedMotion={reducedMotion}
    />
  );
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
          <OwnerHomeSummary
            cloudStyle={cloudStyle}
            widgetActions={widgetActions}
            key={`${period}:${asOf ?? 'today'}`}
            data={data}
            scope={scope}
            active={enabled}
            reducedMotion={reducedMotion}
            onRangeDetails={() => openFinancialDetail({ kind: 'timeline', timeline: data })}
            onMonthDetails={() => openFinancialDetail({ kind: 'profit', period: 'month', profit: data.footer })}
            onInfo={() => openFinancialDetail({ kind: 'timeline-info', timeline: data })}
          />
        ) : (
          <OwnerHomeSummaryPlaceholder
            cloudStyle={cloudStyle}
            widgetActions={widgetActions}
            errorMessage={
              timeline.isError || invalidTimeline
                ? invalidTimeline
                  ? 'Данные сводки не совпали с периодом'
                  : 'Сводка не загрузилась'
                : undefined
            }
            retrying={timeline.isFetching}
            onRetry={timeline.refetch}
          />
        )}

        <OwnerHomeCash scope={scope} enabled={enabled} />
        <View
          key={`clients-type-${fontScale}`}
          testID="owner-home-clients"
          style={[styles.clients, { backgroundColor: clientTone.background }]}
        >
          <View style={styles.clientHeading}>
            <Ionicons name="people-outline" size={19} color={clientTone.ink} />
            <Text accessibilityRole="header" style={[styles.clientTitle, { color: p.text.primary }]}>
              Клиенты
              {visitReady ? (
                <Text style={[styles.clientTotal, { color: p.text.secondary }]}> · {visits.data.servedClients}</Text>
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
                <View style={[styles.cohorts, stackedClients && styles.cohortsStacked]}>
                  {(['new', 'returning'] as const).map((cohort, index) => (
                    <TouchableOpacity
                      key={cohort}
                      accessibilityRole="button"
                      accessibilityLabel={`${cohort === 'new' ? 'Впервые' : 'Повторно'}: ${cohort === 'new' ? visits.data.newClients : visits.data.returningClients}. Открыть клиентов за выбранный период`}
                      style={styles.cohort}
                      activeOpacity={0.65}
                      onPress={() => setDetail({ kind: 'clients', cohort, range, timezone: data.timezone })}
                    >
                      {index === 1 && (
                        <View
                          style={[
                            styles.cohortDivider,
                            stackedClients && styles.cohortDividerStacked,
                            { backgroundColor: clientTone.divider },
                          ]}
                        />
                      )}
                      <View style={styles.cohortLabelRow}>
                        <View
                          style={[
                            styles.cohortDot,
                            { backgroundColor: cohort === 'new' ? clientTone.strong : clientTone.soft },
                          ]}
                        />
                        <Text style={[styles.cohortLabel, { color: p.text.secondary }]}>
                          {cohort === 'new' ? 'Впервые' : 'Повторно'}
                        </Text>
                      </View>
                      <View style={styles.cohortValueRow}>
                        <Text style={[styles.cohortValue, { color: p.text.primary }]}>
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
                  <Text style={[styles.rapidTitle, { color: p.text.primary }]}>Вернулись в течение 30 дней</Text>
                  <Text style={[styles.rapidCount, { color: p.text.primary }]}>
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
        <OwnerHomeLiveWidgets scope={scope} enabled={enabled} showEarnings={showEarnings.value} />
        <OwnerHomeOperational scope={scope} enabled={enabled} todayDate={calendarMeta?.todayDate} />
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
            <Text style={[styles.settingLabel, { color: p.text.primary }]}>Заработок сотрудников</Text>
            <Switch
              accessibilityLabel="Показывать заработок сотрудников"
              value={showEarnings.value}
              onValueChange={showEarnings.setValue}
            />
          </View>
        )}
        <Text style={[styles.caption, { color: p.text.secondary }]}>
          Период меняет прибыль, оборот и клиентов. Касса, смены, звонки и заработок показаны за сегодня.
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
  clients: { marginTop: ownerWidgetLayout.gap, borderRadius: ownerWidgetLayout.radius, overflow: 'hidden' },
  clientHeading: {
    minHeight: ownerWidgetLayout.headerMinHeight,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 0,
  },
  clientTitle: { ...ownerWidgetText.title, flex: 1 },
  clientTotal: ownerWidgetText.label,
  clientGroup: { overflow: 'hidden' },
  cohorts: { flexDirection: 'row' },
  cohortsStacked: { flexDirection: 'column' },
  cohort: {
    flex: 1,
    minHeight: 80,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 10,
    justifyContent: 'center',
    gap: 3,
  },
  cohortDivider: { position: 'absolute', left: 0, top: 13, bottom: 13, width: StyleSheet.hairlineWidth },
  cohortDividerStacked: {
    left: 16,
    right: 16,
    top: 0,
    bottom: undefined,
    width: undefined,
    height: StyleSheet.hairlineWidth,
  },
  cohortLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cohortDot: { width: 6, height: 6, borderRadius: 3 },
  cohortLabel: { ...ownerWidgetText.label, flexShrink: 1 },
  cohortValueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  cohortValue: ownerWidgetText.metric,
  cohortTrack: {
    height: 4,
    marginHorizontal: ownerWidgetLayout.inset,
    marginTop: 2,
    marginBottom: 14,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 3,
  },
  rapid: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rapidTitle: { ...ownerWidgetText.body, flex: 1 },
  rapidCount: ownerWidgetText.smallValue,
  clientLoading: { height: 94, padding: 16, gap: 12 },
  clientPlaceholder: { height: 22, borderRadius: 5 },
  clientUnavailable: { minHeight: 70, padding: 16, fontSize: 13, lineHeight: 19 },
  historyNote: { ...ownerWidgetText.label, marginTop: 10, paddingHorizontal: 2 },
  caption: ownerWidgetText.label,
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  settingLabel: { flex: 1, fontSize: 15, lineHeight: 22 },
});
