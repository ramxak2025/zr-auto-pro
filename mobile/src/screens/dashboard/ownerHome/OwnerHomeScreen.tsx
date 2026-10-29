import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  useWindowDimensions,
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
import PointIndicator from '../../../components/PointIndicator';
import { useReduceMotionPreference } from '../../../hooks/useReduceMotionPreference';
import { OwnerHomeAmount, OwnerHomeComparisonBars, OwnerHomeScopeControl } from './OwnerHomeMotion';
import { prefKey, usePreference } from '../../../hooks/usePreference';
import { formatDayKey } from '../../../../../shared/utils/formatters';
import { invalidateAttendanceQueries } from '../../../../../shared/utils/attendanceQueries';
import type { OwnerHomeProfit } from '../../../../../shared/types/ownerHome';
import OwnerHomeOperational, { OwnerHomeRetry } from './OwnerHomeOperational';
import OwnerHomeDetails, { type OwnerHomeDetail } from './OwnerHomeDetails';
import {
  loadOwnerHome,
  moveOwnerDay,
  moveOwnerMonth,
  ownerClock,
  ownerDateLabel,
  ownerDeltaLabel,
  ownerMoney,
  ownerPercentLabel,
  ownerHomeEnabled,
  ownerPickerDate,
  ownerRangeLabel,
  ownerVisitsRange,
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
  const { user, refreshUser, hasPermission } = useAuth();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [asOf, setAsOf] = useState<string | undefined>();
  const [preferredDay, setPreferredDay] = useState<number | undefined>();
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [detail, setDetail] = useState<OwnerHomeDetail | null>(null);
  const [clientPeriod, setClientPeriod] = useState<'day' | 'month'>('day');
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
  const profit = useQuery({
    queryKey: ['owner-home', ...scope.key, 'profit', asOf ?? 'today'],
    // First request deliberately has no client-computed date: the server owns today and timezone.
    queryFn: () => loadOwnerHome(scope, () => reportsApi.ownerHomeProfit(asOf ? { asOf } : undefined)),
    enabled,
    staleTime: 30_000,
    refetchOnMount: 'always',
    placeholderData: undefined,
    refetchInterval: enabled && !asOf ? 60_000 : false,
  });
  const data = profit.data;
  // Retain only server-authoritative calendar metadata during an in-scope date request.
  // The old financial/visit values are never used as placeholder data for that date.
  const calendarContext = useRef<Pick<OwnerHomeProfit, 'todayDate' | 'timezone'> | null>(null);
  if (data) calendarContext.current = { todayDate: data.todayDate, timezone: data.timezone };
  const selectedDate = data?.canonicalDate ?? asOf;
  const calendarMeta = calendarContext.current;
  const range = data ? ownerVisitsRange(data, clientPeriod) : null;
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

  const chooseDate = (date: string, preferred?: number) => {
    if (!calendarMeta || date > calendarMeta.todayDate) {
      Alert.alert('Дата сводки', 'Выберите сегодняшнюю или прошедшую дату по времени автосервиса.');
      return;
    }
    setAsOf(date === calendarMeta.todayDate ? undefined : date);
    setPreferredDay(preferred ?? Number(date.slice(8, 10)));
    setDetail(null);
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
    if (!selectedDate || !calendarMeta) return;
    const choices = [
      { text: 'Выбрать дату', onPress: () => setCalendarVisible(true) },
      {
        text: 'На месяц раньше',
        onPress: () =>
          chooseDate(moveOwnerMonth(selectedDate, -1, preferredDay), preferredDay ?? Number(selectedDate.slice(8))),
      },
      ...(asOf
        ? [
            {
              text: 'Сегодня',
              onPress: () => {
                setAsOf(undefined);
                setPreferredDay(undefined);
                setDetail(null);
              },
            },
          ]
        : []),
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: ownerDateLabel(selectedDate, true),
          options: [...choices.map((choice) => choice.text), 'Отмена'],
          cancelButtonIndex: choices.length,
          userInterfaceStyle: p.mode,
        },
        (index) => choices[index]?.onPress(),
      );
    } else {
      Alert.alert('Дата сводки', ownerDateLabel(selectedDate, true), choices, { cancelable: true });
    }
  };
  const historical = !!data && data.canonicalDate !== data.todayDate;
  const financialReady = !!data && !profit.isPending && !profit.isError;
  const visitReady = financialReady && visits.data && !visits.isPending && !visits.isError;
  const heroColor = p.mode === 'dark' ? '#1e4195' : '#214fcb';
  const selectedLabel = selectedDate
    ? `${selectedDate === calendarMeta?.todayDate ? 'Сегодня · ' : calendarMeta && selectedDate === moveOwnerDay(calendarMeta.todayDate, -1) ? 'Вчера · ' : ''}${ownerDateLabel(selectedDate, selectedDate.slice(0, 4) !== calendarMeta?.todayDate.slice(0, 4))}`
    : 'Дата сервиса';
  const percentage = data ? ownerPercentLabel(data.comparison.mtdDelta, data.comparison.mtd.netProfit) : null;
  const changeColor = data && data.comparison.mtdDelta.amount < 0 ? '#ffd7d7' : '#c8f4df';
  const { width, fontScale } = useWindowDimensions();
  const monthMoneyLength = data ? ownerMoney(data.current.mtd.netProfit).length : 0;
  const stackMonthValue = fontScale > 1.2 || monthMoneyLength > 15 || (width < 370 && monthMoneyLength > 12);
  return (
    <View style={[styles.screen, { backgroundColor: p.bg.canvas }]}>
      <TabBarScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={p.accent.primary} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.headerTitleRow}>
              <Text accessibilityRole="header" style={[styles.heading, { color: p.text.primary }]}>
                Главная
              </Text>
              <Text style={[styles.internal, { color: p.text.secondary, backgroundColor: p.bg.muted }]}>Тест</Text>
            </View>
            <PointIndicator style={styles.pointCaption} />
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Настроить главную"
            onPress={() => setSettingsVisible(true)}
            style={[styles.iconButton, styles.settingsButton, { backgroundColor: p.bg.card }]}
          >
            <Ionicons name="options-outline" size={22} color={p.text.primary} />
          </TouchableOpacity>
        </View>

        <View testID="owner-home-financial-surface" style={[styles.hero, { backgroundColor: heroColor }]}>
          <View style={styles.dateNavigation}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Предыдущий день"
              disabled={!selectedDate || !calendarMeta}
              style={styles.iconButton}
              onPress={() => selectedDate && chooseDate(moveOwnerDay(selectedDate, -1))}
            >
              <Ionicons name="chevron-back" size={20} color="#fff" style={{ opacity: selectedDate ? 1 : 0.3 }} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Дата сводки. Календарь, предыдущий месяц или сегодня"
              disabled={!selectedDate || !calendarMeta}
              style={styles.dateButton}
              onPress={openDateMenu}
            >
              <Text style={styles.dateText}>{selectedLabel}</Text>
              <Ionicons name="chevron-down" size={14} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Следующий день"
              accessibilityState={{
                disabled: !selectedDate || !calendarMeta || selectedDate >= calendarMeta.todayDate,
              }}
              disabled={!selectedDate || !calendarMeta || selectedDate >= calendarMeta.todayDate}
              style={styles.iconButton}
              onPress={() => selectedDate && chooseDate(moveOwnerDay(selectedDate, 1))}
            >
              <Ionicons
                name="chevron-forward"
                size={20}
                color="#fff"
                style={{ opacity: selectedDate && calendarMeta && selectedDate < calendarMeta.todayDate ? 1 : 0.25 }}
              />
            </TouchableOpacity>
          </View>
          {profit.isPending ? (
            <View
              testID="owner-home-money-loading"
              style={styles.moneyLoading}
              accessibilityRole="progressbar"
              accessibilityLabel={`Загружается сводка${selectedDate ? ` за ${ownerDateLabel(selectedDate)}` : ''}`}
            >
              <Text style={styles.heroCaption}>{selectedDate ? ownerDateLabel(selectedDate) : 'Сводка сервиса'}</Text>
              <View style={[styles.moneyPlaceholder, { width: '65%', height: 30 }]} />
              <View style={[styles.moneyPlaceholder, { height: 57, marginTop: 6 }]} />
            </View>
          ) : profit.isError ? (
            <View style={styles.moneyError}>
              <OwnerHomeRetry text="Сводка не загрузилась" busy={profit.isFetching} onRetry={profit.refetch} inverse />
            </View>
          ) : data ? (
            <>
              <MoneyRow
                key={`day:${data.canonicalDate}`}
                value={data.current.day.netProfit}
                revenue={data.current.day.revenue}
                date={data.canonicalDate}
                reducedMotion={reducedMotion}
                onPress={() => setDetail({ kind: 'profit', period: 'day', profit: data })}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`С начала месяца. ${ownerRangeLabel(data.current.period.from, data.current.period.through)}. Чистая прибыль ${ownerMoney(data.current.mtd.netProfit)}. Прошлый период ${ownerMoney(data.comparison.mtd.netProfit)}. Изменение ${ownerDeltaLabel(data.comparison.mtdDelta, data.comparison.mtd.netProfit)}. Открыть расчёт`}
                onPress={() => setDetail({ kind: 'profit', period: 'month', profit: data })}
                activeOpacity={0.86}
                style={styles.month}
              >
                <View style={styles.monthLabels}>
                  <Text style={styles.heroCaption}>С начала месяца</Text>
                  <Text style={styles.heroCaption}>
                    {ownerRangeLabel(data.current.period.from, data.current.period.through, data.todayDate.slice(0, 4))}
                  </Text>
                </View>
                <View
                  testID="owner-home-month-values"
                  style={[styles.monthValues, stackMonthValue && styles.monthValuesStacked]}
                >
                  <View
                    testID="owner-home-month-amount-slot"
                    style={stackMonthValue ? styles.monthAmountStacked : styles.monthAmountSlot}
                  >
                    <OwnerHomeAmount
                      key={`month:${data.canonicalDate}:${data.current.mtd.netProfit}`}
                      value={data.current.mtd.netProfit}
                      compact
                      reducedMotion={reducedMotion}
                    />
                  </View>
                  {percentage !== null && (
                    <View style={styles.percent}>
                      <Ionicons
                        name={
                          data.comparison.mtdDelta.amount < 0
                            ? 'trending-down-outline'
                            : data.comparison.mtdDelta.amount > 0
                              ? 'trending-up-outline'
                              : 'remove-outline'
                        }
                        size={13}
                        color={changeColor}
                      />
                      <Text style={[styles.percentText, { color: changeColor }]}>{percentage}</Text>
                    </View>
                  )}
                </View>
                <OwnerHomeComparisonBars
                  key={`bars:${data.canonicalDate}`}
                  current={data.current.mtd.netProfit}
                  previous={data.comparison.mtd.netProfit}
                  reducedMotion={reducedMotion}
                />
                <View style={styles.baseline}>
                  <Text style={[styles.heroCaption, { flexShrink: 1 }]}>
                    {ownerRangeLabel(
                      data.comparison.period.from,
                      data.comparison.period.through,
                      data.todayDate.slice(0, 4),
                    )}
                  </Text>
                  <Text style={[styles.heroCaption, styles.numeric]}>{ownerMoney(data.comparison.mtd.netProfit)}</Text>
                </View>
                <View style={styles.movement}>
                  <Text style={[styles.heroCaption, styles.numeric, { color: changeColor, fontWeight: '600' }]}>
                    {data.comparison.mtdDelta.amount > 0 ? '+' : ''}
                    {ownerMoney(data.comparison.mtdDelta.amount)}
                  </Text>
                  <Text style={styles.heroCaption}>
                    {data.current.period.partialDay
                      ? `Оба до ${ownerClock(data.current.period.untilExclusive, data.timezone)}`
                      : 'По конец дня'}
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${data?.basisLabel ?? 'Пересчёт по текущему плану расходов'}. Как считается чистая прибыль`}
            disabled={!financialReady}
            style={styles.basis}
            onPress={() => {
              if (financialReady && data) setDetail({ kind: 'basis', profit: data });
            }}
          >
            <Text style={styles.heroCaption}>Пересчёт · текущий план</Text>
            <Ionicons name="information-circle-outline" size={18} color="#dce7ff" />
          </TouchableOpacity>
        </View>

        <View style={styles.clients}>
          <View style={styles.clientHeading}>
            <Text accessibilityRole="header" style={[styles.clientTitle, { color: p.text.primary }]}>
              Клиенты
              {visitReady ? (
                <Text style={[styles.clientTotal, { color: p.text.secondary }]}> · {visits.data.servedClients}</Text>
              ) : null}
            </Text>
            <OwnerHomeScopeControl value={clientPeriod} onChange={setClientPeriod} reducedMotion={reducedMotion} />
          </View>
          {clientPeriod === 'month' && range && financialReady && (
            <Text style={[styles.clientPeriod, { color: p.text.secondary }]}>
              {ownerRangeLabel(range.from, range.to, data.todayDate.slice(0, 4))}
            </Text>
          )}
          <View style={[styles.clientGroup, { backgroundColor: p.bg.card }]}>
            {!financialReady || visits.isPending ? (
              profit.isError ? (
                <Text style={[styles.clientUnavailable, { color: p.text.secondary }]}>Данные за период недоступны</Text>
              ) : (
                <View
                  style={styles.clientLoading}
                  accessibilityRole="progressbar"
                  accessibilityLabel="Загружаются клиенты за выбранную дату"
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
                      accessibilityLabel={`${cohort === 'new' ? 'Впервые' : 'Повторно'}: ${cohort === 'new' ? visits.data.newClients : visits.data.returningClients}. Открыть клиентов`}
                      style={styles.cohort}
                      onPress={() => setDetail({ kind: 'clients', cohort, range, timezone: data.timezone })}
                    >
                      {index === 1 && <View style={[styles.cohortDivider, { backgroundColor: p.border.subtle }]} />}
                      <Text style={[styles.cohortLabel, { color: p.text.secondary }]}>
                        {cohort === 'new' ? 'Впервые' : 'Повторно'}
                      </Text>
                      <View style={styles.cohortValueRow}>
                        <Text style={[styles.cohortValue, { color: p.text.primary }]}>
                          {cohort === 'new' ? visits.data.newClients : visits.data.returningClients}
                        </Text>
                        <Ionicons name="chevron-forward" size={13} color={p.text.secondary} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${visits.data.rapidReturnVehicleCount} автомобилей вернулись в течение 30 дней. Открыть историю работ`}
                  style={[styles.rapid, { borderTopColor: p.border.subtle }]}
                  onPress={() => setDetail({ kind: 'returns', range, timezone: data.timezone })}
                >
                  <Ionicons name="repeat-outline" size={18} color={p.text.secondary} />
                  <Text style={[styles.rapidTitle, { color: p.text.primary }]}>Повтор до 30 дней</Text>
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
            Ниже — работа сервиса сейчас и заработок за сегодня, {ownerDateLabel(data.todayDate)}.
          </Text>
        )}
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
          Финансовая сводка, клиенты и задачи относятся к текущему филиалу. Дата меняет только верхнюю сводку.
        </Text>
      </Modal>
      {detail && <OwnerHomeDetails detail={detail} scope={scope} onClose={() => setDetail(null)} />}
    </View>
  );
}

function MoneyRow({
  value,
  revenue,
  date,
  reducedMotion,
  onPress,
}: {
  value: number;
  revenue: number;
  date: string;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale > 1.2 || width < 370 || ownerMoney(value).length > 15;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Чистая прибыль за ${ownerDateLabel(date, true)} ${ownerMoney(value)}. Выручка ${ownerMoney(revenue)}. Открыть расчёт`}
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.daily, stacked && styles.dailyStacked]}
    >
      <View style={styles.dailyMain}>
        <Text style={styles.dailyLabel}>Чистая прибыль за день</Text>
        <OwnerHomeAmount key={`${date}:${value}`} value={value} reducedMotion={reducedMotion} />
      </View>
      <View style={[styles.revenue, stacked && { alignItems: 'flex-start' }]}>
        <Text style={styles.heroCaption}>Выручка</Text>
        <Text style={styles.revenueValue}>{ownerMoney(revenue)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const touchSize = Platform.OS === 'android' ? 48 : 44;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusBarScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 21 },
  bottomSafe: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    gap: 12,
    paddingHorizontal: 2,
    marginBottom: 12,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.4 },
  internal: { fontSize: 12, lineHeight: 18, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  pointCaption: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginTop: 1,
    minHeight: 16,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  iconButton: { width: touchSize, height: touchSize, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  settingsButton: { borderRadius: 15 },
  hero: { borderRadius: 22, overflow: 'hidden' },
  dateNavigation: { flexDirection: 'row', minHeight: touchSize, alignItems: 'center', paddingHorizontal: 5 },
  dateButton: {
    flex: 1,
    minHeight: touchSize,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dateText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  daily: {
    minHeight: 65,
    paddingTop: 2,
    paddingBottom: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dailyStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 7 },
  dailyMain: { flex: 1, minWidth: 0 },
  dailyLabel: { color: '#dce7ff', fontSize: 12, lineHeight: 16, marginBottom: 3 },
  revenue: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  revenueValue: { color: '#fff', fontSize: 14, lineHeight: 21, fontWeight: '500', fontVariant: ['tabular-nums'] },
  heroCaption: { color: '#dce7ff', fontSize: 12, lineHeight: 16 },
  numeric: { fontVariant: ['tabular-nums'] },
  month: {
    backgroundColor: 'rgba(255,255,255,.075)',
    minHeight: 122,
    paddingTop: 9,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  monthLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 9,
    flexWrap: 'wrap',
  },
  monthValues: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 9,
    marginTop: 2,
    flexWrap: 'nowrap',
  },
  monthValuesStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  monthAmountSlot: { flex: 1, minWidth: 0 },
  monthAmountStacked: { alignSelf: 'stretch', minWidth: 0 },
  percent: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  percentText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  baseline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, flexWrap: 'wrap' },
  movement: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 9,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  basis: {
    minHeight: touchSize,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  moneyLoading: { minHeight: 191, padding: 16, gap: 12 },
  moneyPlaceholder: { height: 22, borderRadius: 5, backgroundColor: 'rgba(255,255,255,.16)' },
  moneyError: { minHeight: 100, justifyContent: 'center' },
  clients: { marginTop: 14 },
  clientHeading: {
    minHeight: touchSize,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  clientTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15 },
  clientTotal: { fontSize: 13, fontWeight: '400' },
  clientPeriod: { fontSize: 12, lineHeight: 18, marginBottom: 6, paddingHorizontal: 2 },
  clientGroup: { borderRadius: 16, overflow: 'hidden' },
  cohorts: { flexDirection: 'row' },
  cohort: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
  },
  cohortDivider: { position: 'absolute', left: 0, top: 13, bottom: 13, width: StyleSheet.hairlineWidth },
  cohortLabel: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  cohortValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cohortValue: { fontSize: 20, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rapid: {
    minHeight: Platform.OS === 'android' ? 48 : 46,
    marginHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
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
