import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { callsApi, salaryApi, scheduleApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useColors } from '../../../contexts/ThemeContext';
import { useTenantTimezone } from '../../../contexts/TenantTimezoneContext';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import { Skeleton } from '../../../components/Skeleton';
import type { TabParamList } from '../../../navigation/AppNavigator';
import type { TodayEarnings } from '../../../../../shared/types';
import { EARNINGS_EXPLANATION } from '../../../../../shared/utils/dashboardAttention';
import { loadOwnerHome, ownerClock, ownerDateLabel, ownerMoney, type OwnerHomeScope } from './ownerHomeState';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';
import { ownerWidgetLayout, ownerWidgetText } from './ownerHomeWidgetDesign';
import { ownerCallPhoneLabel, ownerCallsSnapshot, type OwnerCallsSnapshot } from './ownerHomeCalls';
import { newCallsEntry, telephonyDisconnected, type CallsFilter } from '../../callsJournalState';
import {
  ownerShiftRoster,
  ownerTeamRows,
  ownerTeamToday,
  ownerTodayEarnings,
  type OwnerTeamRow,
} from './ownerHomeTeam';

export { ownerShiftRoster } from './ownerHomeTeam';
export {
  callsSummary as ownerCallsSummary,
  telephonyDisconnected as ownerTelephonyDisconnected,
} from '../../callsJournalState';

let scheduleFocusSequence = 0;

function shiftDetail(row: OwnerTeamRow, timezone: string): string {
  const employee = row.schedule;
  if (row.shift === 'unknown' || !employee) return 'Нет данных о смене';
  if (row.shift === 'active') {
    return employee.actualArrival && Number.isFinite(Date.parse(employee.actualArrival))
      ? `На смене · ${ownerClock(employee.actualArrival, timezone)}`
      : 'На смене';
  }
  if (row.shift === 'inactive') return 'Не на смене';
  const validTime = (value?: string | null) => (value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null);
  const start = validTime(employee.shiftStart);
  const end = validTime(employee.shiftEnd);
  return start && end ? `По плану · ${start}–${end}` : start ? `По плану · с ${start}` : 'По плану';
}

export default function OwnerHomeLiveWidgets({
  scope,
  enabled,
  todayDate,
  showEarnings = true,
}: {
  scope: OwnerHomeScope;
  enabled: boolean;
  /** Current tenant date from the server; a cache hint, never the historical chart's selected date. */
  todayDate?: string;
  showEarnings?: boolean;
}) {
  const p = useColors();
  const { user, hasPermission } = useAuth();
  const timezone = useTenantTimezone();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const { width, fontScale } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const owner = user?.role === 'director';
  const current = scope.isCurrent();
  const canQuery = enabled && owner && current;
  const scheduleAllowed = owner && hasPermission('schedule_view');
  const salaryAllowed = owner && showEarnings && hasPermission('salary_view_all');
  const callsAllowed = owner && hasPermission('calls_view');
  const canConnect = owner && hasPermission('settings_manage');
  const pointId = user?.currentPointId ?? null;
  const scopeKey = JSON.stringify(scope.key);
  const access = useRef({
    mounted: true,
    scopeKey,
    canQuery,
    scheduleAllowed,
    salaryAllowed,
    callsAllowed,
    canConnect,
    earnings: null as TodayEarnings | null,
    employeeIds: new Set<string>(),
  });
  Object.assign(access.current, { scopeKey, canQuery, scheduleAllowed, salaryAllowed, callsAllowed, canConnect });
  useEffect(() => {
    access.current.mounted = true;
    return () => {
      access.current.mounted = false;
    };
  }, []);
  const featureCurrent = (feature: 'scheduleAllowed' | 'salaryAllowed' | 'callsAllowed' | 'canConnect') => {
    const latest = access.current;
    return latest.mounted && latest.scopeKey === scopeKey && latest.canQuery && latest[feature] && scope.isCurrent();
  };
  const assertFeature = (feature: 'scheduleAllowed' | 'salaryAllowed' | 'callsAllowed') => {
    if (!featureCurrent(feature)) throw new Error('Сессия изменилась');
  };
  const schedule = useQuery({
    queryKey: ['owner-home', ...scope.key, 'live-shifts-today'],
    queryFn: () =>
      loadOwnerHome(scope, async () => {
        assertFeature('scheduleAllowed');
        const response = await scheduleApi.getToday();
        assertFeature('scheduleAllowed');
        const data = ownerShiftRoster(response.data);
        if (!data) throw new Error('Не удалось прочитать смены');
        return { data };
      }),
    enabled: canQuery && scheduleAllowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: canQuery && scheduleAllowed ? 60_000 : false,
    placeholderData: undefined,
  });
  const earnings = useQuery({
    queryKey: ['owner-home', ...scope.key, 'live-earnings-today'],
    queryFn: () =>
      loadOwnerHome(scope, async () => {
        assertFeature('salaryAllowed');
        const response = await salaryApi.getTodayEarnings();
        assertFeature('salaryAllowed');
        const data = ownerTodayEarnings(response.data, { timezone, pointId });
        if (!data) throw new Error('Не удалось прочитать заработок за сегодня');
        return { data };
      }),
    enabled: canQuery && salaryAllowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: canQuery && salaryAllowed ? 60_000 : false,
    placeholderData: undefined,
  });
  const calls = useQuery<OwnerCallsSnapshot>({
    queryKey: ['owner-home', ...scope.key, 'live-calls-today', todayDate ?? 'today'],
    queryFn: () =>
      loadOwnerHome<OwnerCallsSnapshot>(scope, async () => {
        assertFeature('callsAllowed');
        let response;
        try {
          // An omitted date resolves TODAY in the tenant timezone on both provider paths.
          // Do not reuse the historical chart date or a yesterday-valued calendar snapshot.
          response = await callsApi.getCalls({});
        } catch (error) {
          assertFeature('callsAllowed');
          if (telephonyDisconnected(error)) return { data: { kind: 'disconnected' } };
          throw new Error('Не удалось обновить звонки');
        }
        assertFeature('callsAllowed');
        return { data: ownerCallsSnapshot(response.data) };
      }),
    enabled: canQuery && callsAllowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      canQuery && callsAllowed && query.state.data?.kind !== 'disconnected' ? 60_000 : false,
    placeholderData: undefined,
  });
  if (!owner || !current) return null;

  const shiftTone = ownerHomeSurfaces(p.mode === 'dark').service;
  const callTone =
    p.mode === 'dark'
      ? { background: '#32252d', ink: '#edb8c7', divider: '#533d48' }
      : { background: '#faeff2', ink: '#8c3f56', divider: '#e9d5dd' };
  const openCalls = (filter: CallsFilter = 'all') => {
    if (!featureCurrent('callsAllowed')) return;
    navigation.navigate('MoreTab', { screen: 'Calls', params: newCallsEntry(filter), initial: false });
  };
  const openIntegrations = () => {
    if (!featureCurrent('canConnect') || !featureCurrent('callsAllowed')) return;
    navigation.dispatch(
      CommonActions.navigate({ name: 'MoreTab', params: { screen: 'Integrations', initial: false } }),
    );
  };
  const retry = (label: string, fetching: boolean, refetch: () => unknown, ink: string) => (
    <View style={[styles.notice, fontScale > 1.2 && styles.noticeStacked]} accessibilityRole="alert">
      <Text
        style={[styles.note, styles.flex, fontScale > 1.2 && styles.noticeTextStacked, { color: p.text.secondary }]}
      >
        {label}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}. Повторить`}
        disabled={!canQuery || fetching}
        onPress={() => {
          if (canQuery && scope.isCurrent()) refetch();
        }}
        style={styles.action}
      >
        <Text style={[styles.link, { color: ink }]}>Повторить</Text>
      </TouchableOpacity>
    </View>
  );
  const offline = () => (
    <View style={styles.offline} accessibilityRole="alert">
      <Text style={[styles.name, { color: p.text.primary }]}>Нет связи</Text>
      <Text style={[styles.note, { color: p.text.secondary }]}>Обновим после подключения</Text>
    </View>
  );
  const roster =
    scheduleAllowed &&
    !schedule.isPending &&
    !schedule.isError &&
    !schedule.isPlaceholderData &&
    schedule.fetchStatus !== 'paused'
      ? (schedule.data ?? null)
      : null;
  const earned =
    salaryAllowed &&
    !earnings.isPending &&
    !earnings.isError &&
    !earnings.isPlaceholderData &&
    earnings.fetchStatus !== 'paused'
      ? ownerTodayEarnings(earnings.data, { timezone, pointId })
      : null;
  const allRows = ownerTeamRows(roster, earned);
  access.current.earnings = earned;
  access.current.employeeIds = new Set(allRows.map((row) => row.id));
  const visibleRows = expanded ? allRows : allRows.slice(0, 3);
  const openSchedule = (employeeId?: string) => {
    if (!featureCurrent('scheduleAllowed') || (employeeId && !access.current.employeeIds.has(employeeId))) return;
    navigation.dispatch(
      CommonActions.navigate({
        name: 'MoreTab',
        params: {
          screen: 'Schedule',
          params: {
            focusToday: true,
            ...(employeeId ? { focusEmployeeId: employeeId } : {}),
            focusRequestId: `${Date.now()}-${++scheduleFocusSequence}`,
          },
          initial: false,
        },
      }),
    );
  };
  const openSalary = (employeeId: string) => {
    if (!featureCurrent('salaryAllowed')) return;
    const latest = access.current.earnings;
    const employee = latest?.employees.find((item) => item.id === employeeId);
    if (!latest || !employee) return;
    navigation.dispatch(
      CommonActions.navigate({
        name: 'MoreTab',
        params: {
          screen: 'SalaryEmployee',
          params: {
            employeeId,
            employeeName: employee.name,
            month: latest.date.slice(0, 7),
            entryRequestId: `salary-${Date.now()}-${++scheduleFocusSequence}`,
          },
          initial: false,
        },
      }),
    );
  };
  const summary = calls.data?.kind === 'connected' ? calls.data.summary : null;
  const pendingCalls = calls.data?.kind === 'connected' ? (calls.data.pending ?? []) : [];
  const stackDetails = fontScale > 1.2 || width < 360;
  const stackTeamHeader = stackDetails || (earned !== null && ownerMoney(earned.total).length > 12);
  return (
    <>
      {(scheduleAllowed || salaryAllowed) && (
        <View
          key={`team-type-${fontScale}`}
          testID="owner-home-team"
          style={[styles.panel, { backgroundColor: shiftTone.background }]}
        >
          <View style={[styles.teamHeading, stackTeamHeader && styles.teamHeadingStacked]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Команда сегодня. Открыть график"
              accessibilityState={{ disabled: !canQuery || !scheduleAllowed }}
              disabled={!canQuery || !scheduleAllowed}
              onPress={() => openSchedule()}
              activeOpacity={0.65}
              style={[styles.teamHeadingLink, stackTeamHeader && styles.teamHeadingLinkStacked]}
            >
              <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
                Команда сегодня
              </Text>
              {scheduleAllowed && (
                <View style={styles.teamHeadingStatus}>
                  <Text style={[styles.note, { color: p.text.secondary }]}>
                    {roster ? (
                      roster.active.length ? (
                        <>
                          На смене ·{' '}
                          <Text style={[styles.activeCount, { color: p.text.primary }]}>{roster.active.length}</Text>
                        </>
                      ) : (
                        'Открытых смен нет'
                      )
                    ) : (
                      'График'
                    )}
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color={shiftTone.ink} />
                </View>
              )}
            </TouchableOpacity>
            {salaryAllowed && (
              <View style={[styles.teamTotal, stackTeamHeader && styles.teamTotalStacked]}>
                <Text style={[styles.note, { color: p.text.secondary }]}>
                  {earned && earned.date !== ownerTeamToday(timezone)
                    ? `За ${ownerDateLabel(earned.date, true)}`
                    : 'Заработано'}
                </Text>
                <Text
                  testID="owner-home-team-total"
                  accessibilityLabel={
                    earned ? `Заработок команды: ${ownerMoney(earned.total)}` : 'Заработок команды пока неизвестен'
                  }
                  style={[styles.totalAmount, stackTeamHeader && styles.totalAmountStacked, { color: p.text.primary }]}
                >
                  {earned ? ownerMoney(earned.total) : earnings.isPending ? '…' : '—'}
                </Text>
              </View>
            )}
          </View>
          <Animated.View layout={LinearTransition.duration(200).reduceMotion(ReduceMotion.System)}>
            {scheduleAllowed &&
              (schedule.fetchStatus === 'paused'
                ? offline()
                : !schedule.isPending && !roster
                  ? retry(
                      'Смены не обновились',
                      schedule.isFetching,
                      () => {
                        if (featureCurrent('scheduleAllowed')) schedule.refetch();
                      },
                      shiftTone.ink,
                    )
                  : null)}
            {salaryAllowed &&
              (earnings.fetchStatus === 'paused' ? (
                <Text style={[styles.teamNotice, styles.note, { color: p.text.secondary }]} accessibilityRole="alert">
                  Заработок недоступен без связи
                </Text>
              ) : !earnings.isPending && !earned ? (
                retry(
                  'Заработок не обновился',
                  earnings.isFetching,
                  () => {
                    if (featureCurrent('salaryAllowed')) earnings.refetch();
                  },
                  shiftTone.ink,
                )
              ) : null)}
            {!allRows.length && ((scheduleAllowed && schedule.isPending) || (salaryAllowed && earnings.isPending)) ? (
              <View style={styles.loading} accessibilityLabel="Загружаем команду">
                <Skeleton height={110} radius={8} />
              </View>
            ) : visibleRows.length ? (
              visibleRows.map((row) => {
                const initials = row.name
                  .split(/\s+/)
                  .map((part) => part[0] || '')
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                const status = scheduleAllowed && roster ? shiftDetail(row, timezone) : null;
                const amount = row.earnedAmount;
                const amountLabel = amount !== null ? ownerMoney(amount) : earnings.isPending ? '…' : '—';
                const stackPerson = stackDetails || amountLabel.length > 13;
                return (
                  <View
                    key={row.id}
                    testID={`owner-home-live-person-${row.id}`}
                    style={[styles.person, stackPerson && styles.personStacked, { borderTopColor: shiftTone.divider }]}
                  >
                    <TouchableOpacity
                      testID={`owner-home-team-schedule-${row.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.name}${status ? `. ${status}` : ''}. Открыть график`}
                      accessibilityState={{ disabled: !canQuery || !scheduleAllowed }}
                      disabled={!canQuery || !scheduleAllowed}
                      onPress={() => openSchedule(row.id)}
                      activeOpacity={0.65}
                      style={[styles.personIdentity, stackPerson && styles.personIdentityStacked]}
                    >
                      <EmployeeAvatar
                        userId={row.id}
                        avatar={row.avatar}
                        style={[styles.avatar, { backgroundColor: shiftTone.inset }]}
                        imageStyle={styles.avatarImage}
                      >
                        <Text style={[styles.initials, { color: shiftTone.ink }]}>{initials || '?'}</Text>
                      </EmployeeAvatar>
                      <View style={styles.personText}>
                        <Text style={[styles.personName, { color: p.text.primary }]}>{row.name}</Text>
                        {status && <Text style={[styles.note, { color: p.text.secondary }]}>{status}</Text>}
                      </View>
                    </TouchableOpacity>
                    {salaryAllowed && (
                      <TouchableOpacity
                        testID={`owner-home-team-salary-${row.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={
                          amount !== null
                            ? `${row.name}. Заработано ${amountLabel}. Открыть зарплату`
                            : `${row.name}. Заработок ${earnings.isPending ? 'загружается' : 'неизвестен'}`
                        }
                        accessibilityState={{ disabled: !canQuery || amount === null }}
                        disabled={!canQuery || amount === null}
                        onPress={() => openSalary(row.id)}
                        activeOpacity={0.65}
                        style={[styles.personMoney, stackPerson && styles.personMoneyStacked]}
                      >
                        <Text style={[styles.personAmount, { color: p.text.primary }]}>{amountLabel}</Text>
                        {amount !== null && <Ionicons name="chevron-forward" size={11} color={shiftTone.ink} />}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            ) : (
              (roster || earned) && (
                <Text style={[styles.teamNotice, styles.note, { color: p.text.secondary }]}>
                  {scheduleAllowed ? 'Открытых и запланированных смен нет' : 'Пока нет сотрудников'}
                </Text>
              )
            )}
            {allRows.length > 3 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={expanded ? 'Свернуть список сотрудников' : 'Показать всех сотрудников'}
                onPress={() => setExpanded(!expanded)}
                style={[styles.expand, { borderTopColor: shiftTone.divider }]}
              >
                <Text style={[styles.link, { color: shiftTone.ink }]}>
                  {expanded ? 'Свернуть' : `Ещё ${allRows.length - visibleRows.length}`}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={shiftTone.ink} />
              </TouchableOpacity>
            )}
          </Animated.View>
          {salaryAllowed && earned && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Как считается заработок"
              disabled={!canQuery}
              onPress={() => {
                if (!featureCurrent('salaryAllowed') || !access.current.earnings) return;
                Alert.alert(`Начислено за ${ownerDateLabel(access.current.earnings.date, true)}`, EARNINGS_EXPLANATION);
              }}
              style={styles.earningsInfo}
            >
              <Ionicons name="information-circle-outline" size={15} color={shiftTone.ink} />
              <Text style={[styles.note, styles.shrink, { color: p.text.secondary }]}>Как считается заработок</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {callsAllowed && (
        <View
          key={`calls-type-${fontScale}`}
          testID="owner-home-live-calls"
          style={[styles.panel, { backgroundColor: callTone.background }]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Звонки сегодня. Открыть журнал звонков"
            disabled={!canQuery}
            accessibilityState={{ disabled: !canQuery }}
            onPress={() => openCalls()}
            activeOpacity={0.65}
            style={styles.heading}
          >
            <View style={[styles.flex, styles.headingText]}>
              <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
                Звонки сегодня
              </Text>
              {/* /calls is tenant-wide even in a point-specific session. Never imply branch attribution. */}
              <Text style={[styles.note, { color: p.text.secondary }]}>По всей компании</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={callTone.ink} />
          </TouchableOpacity>
          {calls.fetchStatus === 'paused' ? (
            offline()
          ) : calls.isPending ? (
            <View style={styles.loading} accessibilityLabel="Загружаем звонки">
              <Skeleton height={100} radius={8} />
            </View>
          ) : calls.isError || !calls.data || calls.isPlaceholderData ? (
            retry('Звонки не обновились', calls.isFetching, calls.refetch, callTone.ink)
          ) : calls.data.kind === 'disconnected' ? (
            <View style={styles.disconnected}>
              <Text style={[styles.name, { color: p.text.primary }]}>Телефония не подключена</Text>
              {canConnect && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Подключить телефонию"
                  disabled={!canQuery}
                  onPress={openIntegrations}
                  style={styles.connect}
                >
                  <Text style={[styles.link, { color: callTone.ink }]}>Подключить</Text>
                  <Ionicons name="chevron-forward" size={14} color={callTone.ink} />
                </TouchableOpacity>
              )}
            </View>
          ) : summary ? (
            <>
              <TouchableOpacity
                testID="owner-home-calls-pending"
                accessibilityRole="button"
                accessibilityLabel={`Не перезвонили: ${summary.notCalledBack}. Открыть журнал звонков`}
                accessibilityHint="Звонки без перезвона за сегодня"
                disabled={!canQuery}
                onPress={() => openCalls('pending')}
                activeOpacity={0.6}
                style={[styles.callPending, { borderTopColor: callTone.divider }]}
              >
                <Text style={[styles.callCount, { color: p.text.primary }]}>{summary.notCalledBack}</Text>
                <View style={[styles.flex, styles.callPendingText]}>
                  <Text style={[styles.name, { color: p.text.primary }]}>Без перезвона</Text>
                  <Text style={[styles.note, { color: p.text.secondary }]}>
                    {summary.total === 0
                      ? 'Сегодня звонков пока нет'
                      : summary.notCalledBack > 0
                        ? 'Открыть список'
                        : 'Пропущенных без перезвона нет'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={callTone.ink} />
              </TouchableOpacity>
              {pendingCalls.length > 0 && (
                <View style={styles.callPreviews}>
                  {pendingCalls.map((call) => (
                    <TouchableOpacity
                      key={call.phone}
                      testID={`owner-home-pending-call-${call.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${call.name || ownerCallPhoneLabel(call.phone)}. Открыть звонки без перезвона`}
                      disabled={!canQuery}
                      onPress={() => openCalls('pending')}
                      style={styles.callPreview}
                    >
                      <View style={[styles.flex, styles.callPendingText]}>
                        <Text style={[styles.callPreviewName, { color: p.text.primary }]}>
                          {call.name || ownerCallPhoneLabel(call.phone)}
                        </Text>
                        <Text style={[styles.note, { color: p.text.secondary }]}>
                          {ownerClock(call.date, timezone)} ·{' '}
                          {call.attempts === 1 ? '1 звонок' : `Звонков: ${call.attempts}`}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={callTone.ink} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={[styles.callMetrics, stackDetails && styles.stacked, { borderTopColor: callTone.divider }]}>
                {[
                  { label: 'Принятые', count: summary.incoming - summary.missed, filter: 'incoming' as const },
                  { label: 'Пропущено', count: summary.missed, filter: 'missed' as const },
                  { label: 'Исходящие', count: summary.outgoing, filter: 'outgoing' as const },
                ].map(({ label, count, filter }) => (
                  <TouchableOpacity
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}: ${count}. Открыть журнал звонков`}
                    disabled={!canQuery}
                    onPress={() => openCalls(filter)}
                    activeOpacity={0.6}
                    style={[styles.callMetric, stackDetails && styles.callMetricStacked]}
                  >
                    <View style={styles.callMetricValue}>
                      <Text style={[styles.callMetricCount, { color: p.text.primary }]}>{count}</Text>
                      <Ionicons name="chevron-forward" size={12} color={callTone.ink} />
                    </View>
                    <Text style={[styles.note, styles.shrink, { color: p.text.secondary }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[styles.callTotals, { borderTopColor: callTone.divider }]}>
                <Text style={[styles.note, { color: p.text.secondary }]}>Всего {summary.total}</Text>
                {summary.incoming > 0 && (
                  <Text style={[styles.note, { color: p.text.secondary }]}>
                    Принято {Math.round(((summary.incoming - summary.missed) / summary.incoming) * 100)}% входящих
                  </Text>
                )}
              </View>
            </>
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: ownerWidgetLayout.gap,
    borderRadius: ownerWidgetLayout.radius,
    overflow: 'hidden',
    paddingBottom: 4,
  },
  heading: {
    minHeight: ownerWidgetLayout.headerMinHeight,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headingText: { gap: 2 },
  title: ownerWidgetText.title,
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  link: { ...ownerWidgetText.body, fontWeight: '600' },
  note: ownerWidgetText.label,
  name: { ...ownerWidgetText.body, fontWeight: '500' },
  teamHeading: {
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamHeadingStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  teamHeadingLink: {
    flex: 1,
    minWidth: 0,
    minHeight: ownerWidgetLayout.target,
    justifyContent: 'center',
    gap: 3,
  },
  teamHeadingLinkStacked: { flex: 0 },
  teamHeadingStatus: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  activeCount: ownerWidgetText.value,
  teamTotal: { flexShrink: 1, alignItems: 'flex-end', gap: 3 },
  teamTotalStacked: { alignItems: 'flex-start' },
  totalAmount: { ...ownerWidgetText.value, textAlign: 'right' },
  totalAmountStacked: { textAlign: 'left' },
  teamNotice: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 4, paddingBottom: 12 },
  person: {
    marginHorizontal: ownerWidgetLayout.inset,
    minHeight: 60,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  personIdentity: {
    minHeight: 60,
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personIdentityStacked: { flex: 0 },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  personName: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  personMoney: {
    minHeight: ownerWidgetLayout.target,
    minWidth: ownerWidgetLayout.target,
    maxWidth: '48%',
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  personMoneyStacked: { maxWidth: '100%', alignSelf: 'stretch', marginLeft: 46 },
  personAmount: {
    ...ownerWidgetText.smallValue,
    textAlign: 'right',
    flexShrink: 1,
  },
  earningsInfo: {
    minHeight: ownerWidgetLayout.target,
    paddingHorizontal: ownerWidgetLayout.inset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 18 },
  initials: { ...ownerWidgetText.label, fontWeight: '600' },
  expand: {
    minHeight: ownerWidgetLayout.target,
    marginHorizontal: ownerWidgetLayout.inset,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 2, paddingBottom: 16 },
  notice: {
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingBottom: 8,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  noticeStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
  noticeTextStacked: { flex: 0 },
  action: { minHeight: ownerWidgetLayout.target, justifyContent: 'center' },
  offline: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 4, paddingBottom: 16, gap: 3 },
  disconnected: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 4, paddingBottom: 12 },
  connect: {
    minHeight: ownerWidgetLayout.target,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callPending: {
    minHeight: 76,
    marginHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  callPendingText: { minWidth: 0, gap: 3 },
  callMetrics: {
    flexDirection: 'row',
    marginHorizontal: ownerWidgetLayout.inset,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  stacked: { flexDirection: 'column', gap: 0 },
  callMetric: { flex: 1, minWidth: 0, minHeight: 68, paddingVertical: 10, justifyContent: 'center', gap: 3 },
  callMetricStacked: {
    flex: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: 12,
  },
  callMetricValue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  callMetricCount: { ...ownerWidgetText.value, lineHeight: 24 },
  callCount: ownerWidgetText.metric,
  callPreviews: { marginHorizontal: ownerWidgetLayout.inset, paddingBottom: 8 },
  callPreview: { minHeight: 54, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  callPreviewName: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  callTotals: {
    marginHorizontal: ownerWidgetLayout.inset,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 4,
  },
});
