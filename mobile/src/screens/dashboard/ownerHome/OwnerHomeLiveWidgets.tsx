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
import {
  ownerShiftRoster,
  ownerTeamRows,
  ownerTeamToday,
  ownerTodayEarnings,
  type OwnerTeamRow,
} from './ownerHomeTeam';

export { ownerShiftRoster } from './ownerHomeTeam';

type CallsSummary = Awaited<ReturnType<typeof callsApi.getCalls>>['data']['summary'];
type CallsSnapshot = { kind: 'connected'; summary: CallsSummary } | { kind: 'disconnected' };
let scheduleFocusSequence = 0;

/** Reject unavailable or inconsistent totals rather than turning them into reassuring zeros. */
export function ownerCallsSummary(value: unknown): CallsSummary | null {
  if (!value || typeof value !== 'object') return null;
  const summary = value as CallsSummary;
  const fields = [summary.total, summary.incoming, summary.outgoing, summary.missed, summary.notCalledBack];
  if (fields.some((count) => !Number.isSafeInteger(count) || count < 0)) return null;
  if (
    summary.total !== summary.incoming + summary.outgoing ||
    summary.missed > summary.incoming ||
    summary.notCalledBack > summary.missed
  )
    return null;
  return {
    total: summary.total,
    incoming: summary.incoming,
    outgoing: summary.outgoing,
    missed: summary.missed,
    notCalledBack: summary.notCalledBack,
  };
}

/** CallsService emits this exact response only when neither supported provider is connected. */
export function ownerTelephonyDisconnected(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  return (
    response?.status === 400 &&
    response.data?.message === 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.'
  );
}

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
    earnings: null as TodayEarnings | null,
    employeeIds: new Set<string>(),
  });
  Object.assign(access.current, { scopeKey, canQuery, scheduleAllowed, salaryAllowed });
  useEffect(() => {
    access.current.mounted = true;
    return () => {
      access.current.mounted = false;
    };
  }, []);
  const featureCurrent = (feature: 'scheduleAllowed' | 'salaryAllowed') => {
    const latest = access.current;
    return latest.mounted && latest.scopeKey === scopeKey && latest.canQuery && latest[feature] && scope.isCurrent();
  };
  const assertFeature = (feature: 'scheduleAllowed' | 'salaryAllowed') => {
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
  const calls = useQuery<CallsSnapshot>({
    queryKey: ['owner-home', ...scope.key, 'live-calls-today', todayDate ?? 'today'],
    queryFn: () =>
      loadOwnerHome<CallsSnapshot>(scope, async () => {
        try {
          // An omitted date resolves TODAY in the tenant timezone on both provider paths.
          // Do not reuse the historical chart date or a yesterday-valued calendar snapshot.
          const response = await callsApi.getCalls({});
          const summary = ownerCallsSummary(response.data?.summary);
          if (!summary) throw new Error('Не удалось прочитать сводку звонков');
          // Retain no customer rows, phone numbers or recording URLs in this widget's cache.
          return { data: { kind: 'connected', summary } };
        } catch (error) {
          if (ownerTelephonyDisconnected(error)) return { data: { kind: 'disconnected' } };
          throw error;
        }
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
      ? { background: '#32252d', ink: '#edb8c7', divider: '#533d48', quiet: '#d3b7c0' }
      : { background: '#faeff2', ink: '#8c3f56', divider: '#e9d5dd', quiet: '#795966' };
  const open = (screen: 'Calls' | 'Integrations') => {
    if (!scope.isCurrent()) return;
    navigation.dispatch(CommonActions.navigate({ name: 'MoreTab', params: { screen, initial: false } }));
  };
  const retry = (label: string, fetching: boolean, refetch: () => unknown, ink: string) => (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={[styles.note, styles.flex, { color: ink }]}>{label}</Text>
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
  const offline = (ink: string) => (
    <View style={styles.offline} accessibilityRole="alert">
      <Text style={[styles.name, { color: ink }]}>Нет связи</Text>
      <Text style={[styles.note, { color: ink }]}>Обновим после подключения</Text>
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
  return (
    <>
      {(scheduleAllowed || salaryAllowed) && (
        <View testID="owner-home-team" style={[styles.panel, { backgroundColor: shiftTone.background }]}>
          <View style={[styles.teamHeading, fontScale > 1.2 && styles.teamHeadingStacked]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Команда сегодня. Открыть график"
              accessibilityState={{ disabled: !canQuery || !scheduleAllowed }}
              disabled={!canQuery || !scheduleAllowed}
              onPress={() => openSchedule()}
              activeOpacity={0.65}
              style={styles.teamHeadingLink}
            >
              <Text accessibilityRole="header" style={[styles.teamTitle, { color: shiftTone.ink }]}>
                Команда сегодня
              </Text>
              {scheduleAllowed && (
                <View style={styles.teamHeadingStatus}>
                  <Text style={[styles.note, { color: shiftTone.ink }]}>
                    {roster
                      ? roster.active.length
                        ? `На смене · ${roster.active.length}`
                        : 'Открытых смен нет'
                      : 'График'}
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color={shiftTone.ink} />
                </View>
              )}
            </TouchableOpacity>
            {salaryAllowed && (
              <View style={styles.teamTotal}>
                <Text style={[styles.totalLabel, { color: shiftTone.ink }]}>
                  {earned && earned.date !== ownerTeamToday(timezone)
                    ? `За ${ownerDateLabel(earned.date, true)}`
                    : 'Заработано'}
                </Text>
                <Text
                  testID="owner-home-team-total"
                  accessibilityLabel={
                    earned ? `Заработок команды: ${ownerMoney(earned.total)}` : 'Заработок команды пока неизвестен'
                  }
                  style={[styles.totalAmount, { color: shiftTone.ink }]}
                >
                  {earned ? ownerMoney(earned.total) : earnings.isPending ? '…' : '—'}
                </Text>
              </View>
            )}
          </View>
          <Animated.View layout={LinearTransition.duration(200).reduceMotion(ReduceMotion.System)}>
            {scheduleAllowed &&
              (schedule.fetchStatus === 'paused'
                ? offline(shiftTone.ink)
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
                <Text style={[styles.teamNotice, styles.note, { color: shiftTone.ink }]} accessibilityRole="alert">
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
              visibleRows.map((row, index) => {
                const initials = row.name
                  .split(/\s+/)
                  .map((part) => part[0] || '')
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                const status = scheduleAllowed && roster ? shiftDetail(row, timezone) : null;
                const amount = row.earnedAmount;
                const amountLabel = amount !== null ? ownerMoney(amount) : earnings.isPending ? '…' : '—';
                return (
                  <View
                    key={row.id}
                    testID={`owner-home-live-person-${row.id}`}
                    style={[
                      styles.person,
                      (fontScale > 1.2 || width < 360) && styles.personStacked,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: shiftTone.divider },
                    ]}
                  >
                    <TouchableOpacity
                      testID={`owner-home-team-schedule-${row.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.name}${status ? `. ${status}` : ''}. Открыть график`}
                      accessibilityState={{ disabled: !canQuery || !scheduleAllowed }}
                      disabled={!canQuery || !scheduleAllowed}
                      onPress={() => openSchedule(row.id)}
                      activeOpacity={0.65}
                      style={[styles.personIdentity, (fontScale > 1.2 || width < 360) && styles.personIdentityStacked]}
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
                        {status && <Text style={[styles.personStatus, { color: shiftTone.ink }]}>{status}</Text>}
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
                        style={[styles.personMoney, (fontScale > 1.2 || width < 360) && styles.personMoneyStacked]}
                      >
                        <Text style={[styles.personAmount, { color: shiftTone.ink }]}>{amountLabel}</Text>
                        {amount !== null && <Ionicons name="chevron-forward" size={11} color={shiftTone.ink} />}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            ) : (
              (roster || earned) && (
                <Text style={[styles.teamNotice, styles.note, { color: shiftTone.ink }]}>
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
              <Text style={[styles.totalLabel, { color: shiftTone.ink }]}>Как считается заработок</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {callsAllowed && (
        <View testID="owner-home-live-calls" style={[styles.panel, { backgroundColor: callTone.background }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Звонки сегодня. Открыть журнал звонков"
            onPress={() => open('Calls')}
            activeOpacity={0.65}
            style={styles.heading}
          >
            <Text accessibilityRole="header" style={[styles.title, styles.flex, { color: callTone.ink }]}>
              Звонки сегодня
            </Text>
            <Ionicons name="chevron-forward" size={14} color={callTone.ink} />
          </TouchableOpacity>
          {/* /calls is tenant-wide even in a point-specific session. Never imply branch attribution. */}
          <Text style={[styles.scopeLabel, { color: callTone.quiet }]}>По всей компании</Text>
          {calls.fetchStatus === 'paused' ? (
            offline(callTone.ink)
          ) : calls.isPending ? (
            <View style={styles.loading} accessibilityLabel="Загружаем звонки">
              <Skeleton height={100} radius={8} />
            </View>
          ) : calls.isError || !calls.data || calls.isPlaceholderData ? (
            retry('Звонки не обновились', calls.isFetching, calls.refetch, callTone.ink)
          ) : calls.data.kind === 'disconnected' ? (
            <View style={styles.disconnected}>
              <Text style={[styles.name, { color: callTone.ink }]}>Телефония не подключена</Text>
              {canConnect && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Подключить телефонию"
                  onPress={() => open('Integrations')}
                  style={styles.connect}
                >
                  <Text style={[styles.link, { color: callTone.ink }]}>Подключить</Text>
                  <Ionicons name="chevron-forward" size={14} color={callTone.ink} />
                </TouchableOpacity>
              )}
            </View>
          ) : summary ? (
            <>
              <View style={[styles.callMetrics, (fontScale > 1.2 || width < 360) && styles.stacked]}>
                {[
                  { label: 'Не перезвонили', count: summary.notCalledBack },
                  { label: 'Пропущено', count: summary.missed },
                ].map(({ label, count }) => (
                  <TouchableOpacity
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}: ${count}. Открыть журнал звонков`}
                    onPress={() => open('Calls')}
                    activeOpacity={0.6}
                    style={styles.callMetric}
                  >
                    <Text style={[styles.callCount, { color: count > 0 ? callTone.ink : callTone.quiet }]}>
                      {count}
                    </Text>
                    <View style={styles.metricLabel}>
                      <Text style={[styles.note, { color: callTone.ink }]}>{label}</Text>
                      <Ionicons name="chevron-forward" size={12} color={callTone.ink} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[styles.callTotals, { borderTopColor: callTone.divider }]}>
                <Text style={[styles.note, { color: callTone.quiet }]}>Всего {summary.total}</Text>
                <Text style={[styles.note, { color: callTone.quiet }]}>Входящие {summary.incoming}</Text>
                <Text style={[styles.note, { color: callTone.quiet }]}>Исходящие {summary.outgoing}</Text>
              </View>
            </>
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 20, borderRadius: 22, overflow: 'hidden', paddingBottom: 4 },
  heading: {
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  flex: { flex: 1 },
  link: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  teamHeading: {
    paddingHorizontal: 16,
    paddingTop: 7,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamHeadingStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  teamHeadingLink: { flex: 1, minWidth: 0, minHeight: 52, justifyContent: 'center', gap: 3, paddingVertical: 5 },
  teamTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15 },
  teamHeadingStatus: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  teamTotal: { flexShrink: 1, alignItems: 'flex-end', gap: 3 },
  totalLabel: { fontSize: 11, lineHeight: 16 },
  totalAmount: { fontSize: 17, lineHeight: 23, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right' },
  teamNotice: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  person: {
    marginHorizontal: 16,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  personIdentity: {
    minHeight: 54,
    flex: 1,
    minWidth: 0,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personIdentityStacked: { flex: 0 },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  personName: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  personStatus: { fontSize: 11, lineHeight: 16 },
  personMoney: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: '48%',
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  personMoneyStacked: { maxWidth: '100%', alignSelf: 'flex-end', marginLeft: 46 },
  personAmount: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 1,
  },
  earningsInfo: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
  initials: { fontSize: 12, fontWeight: '600' },
  expand: {
    minHeight: 48,
    marginTop: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 16 },
  notice: { paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', gap: 12, alignItems: 'center' },
  action: { minHeight: 48, justifyContent: 'center' },
  offline: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16, gap: 3 },
  scopeLabel: { paddingHorizontal: 18, fontSize: 12, lineHeight: 16, marginTop: -4, marginBottom: 4 },
  disconnected: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12 },
  connect: { minHeight: 48, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  callMetrics: { flexDirection: 'row', paddingHorizontal: 18, gap: 20 },
  stacked: { flexDirection: 'column', gap: 0 },
  callMetric: { flex: 1, minHeight: 100, paddingVertical: 12, justifyContent: 'center', gap: 4 },
  callCount: { fontSize: 30, lineHeight: 36, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.7 },
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  callTotals: {
    marginHorizontal: 18,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 4,
  },
});
