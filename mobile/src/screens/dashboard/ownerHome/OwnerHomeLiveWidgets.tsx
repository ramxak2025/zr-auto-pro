import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { callsApi, scheduleApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useColors } from '../../../contexts/ThemeContext';
import { useTenantTimezone } from '../../../contexts/TenantTimezoneContext';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import { Skeleton } from '../../../components/Skeleton';
import type { TabParamList } from '../../../navigation/AppNavigator';
import type { TodayEmployeeStatus } from '../../../../../shared/types';
import { loadOwnerHome, ownerClock, type OwnerHomeScope } from './ownerHomeState';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';

type CallsSummary = Awaited<ReturnType<typeof callsApi.getCalls>>['data']['summary'];
type CallsSnapshot = { kind: 'connected'; summary: CallsSummary } | { kind: 'disconnected' };
type ShiftRoster = { active: TodayEmployeeStatus[]; planned: TodayEmployeeStatus[] };

/** Only an open shift is live evidence. A worked calendar day can already be closed. */
export function ownerShiftRoster(value: unknown): ShiftRoster | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  const roster: ShiftRoster = { active: [], planned: [] };
  for (const employee of value) {
    if (
      !employee ||
      typeof employee.userId !== 'string' ||
      !employee.userId.trim() ||
      ids.has(employee.userId) ||
      typeof employee.isWorking !== 'boolean' ||
      typeof employee.hasSchedule !== 'boolean' ||
      typeof employee.isDayOff !== 'boolean' ||
      (employee.note != null && typeof employee.note !== 'string')
    )
      return null;
    ids.add(employee.userId);
    if (employee.isWorking) {
      roster.active.push(employee);
    } else if (
      employee.hasSchedule &&
      !employee.isDayOff &&
      !employee.actualArrival &&
      !employee.lateStatus &&
      employee.lateMinutes === 0 &&
      !/больнич|прогул/i.test(employee.note ?? '')
    ) {
      roster.planned.push(employee);
    }
  }
  return roster;
}

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

function shiftDetail(employee: TodayEmployeeStatus, active: boolean, timezone: string): string {
  if (active) {
    return employee.actualArrival && Number.isFinite(Date.parse(employee.actualArrival))
      ? `Приход ${ownerClock(employee.actualArrival, timezone)}`
      : 'Смена открыта';
  }
  const validTime = (value?: string | null) => (value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null);
  const start = validTime(employee.shiftStart);
  const end = validTime(employee.shiftEnd);
  return start && end ? `${start}–${end}` : start ? `С ${start}` : 'По плану';
}

export default function OwnerHomeLiveWidgets({
  scope,
  enabled,
  todayDate,
}: {
  scope: OwnerHomeScope;
  enabled: boolean;
  /** Current tenant date from the server; a cache hint, never the historical chart's selected date. */
  todayDate?: string;
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
  const callsAllowed = owner && hasPermission('calls_view');
  const canConnect = owner && hasPermission('settings_manage');
  const schedule = useQuery({
    queryKey: ['owner-home', ...scope.key, 'live-shifts-today', todayDate ?? 'today'],
    queryFn: () =>
      loadOwnerHome(scope, async () => {
        const response = await scheduleApi.getToday();
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
  const open = (screen: 'Schedule' | 'Calls' | 'Integrations') => {
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
  const roster = schedule.data;
  const allRows = roster
    ? [
        ...roster.active.map((employee) => ({ employee, active: true })),
        ...roster.planned.map((employee) => ({ employee, active: false })),
      ]
    : [];
  const visibleRows = expanded ? allRows : allRows.slice(0, 3);
  const summary = calls.data?.kind === 'connected' ? calls.data.summary : null;
  return (
    <>
      {scheduleAllowed && (
        <View testID="owner-home-live-shifts" style={[styles.panel, { backgroundColor: shiftTone.background }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Кто на смене. Открыть график"
            onPress={() => open('Schedule')}
            activeOpacity={0.65}
            style={styles.heading}
          >
            <Text accessibilityRole="header" style={[styles.title, styles.flex, { color: shiftTone.ink }]}>
              Кто на смене
            </Text>
            <Text style={[styles.link, { color: shiftTone.ink }]}>График</Text>
            <Ionicons name="chevron-forward" size={14} color={shiftTone.ink} />
          </TouchableOpacity>
          <Animated.View layout={LinearTransition.duration(200).reduceMotion(ReduceMotion.System)}>
            {schedule.fetchStatus === 'paused' ? (
              offline(shiftTone.ink)
            ) : schedule.isPending ? (
              <View style={styles.loading} accessibilityLabel="Загружаем смены">
                <Skeleton height={110} radius={8} />
              </View>
            ) : schedule.isError || !roster || schedule.isPlaceholderData ? (
              retry('Смены не обновились', schedule.isFetching, schedule.refetch, shiftTone.ink)
            ) : (
              <>
                <Text style={[styles.groupLabel, { color: shiftTone.ink }]}>
                  {roster.active.length ? `На смене · ${roster.active.length}` : 'Открытых смен нет'}
                </Text>
                {visibleRows.map(({ employee, active }, index) => {
                  const name = typeof employee.fullName === 'string' ? employee.fullName.trim() : '';
                  const initials = name
                    .split(/\s+/)
                    .map((part) => part[0] || '')
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <React.Fragment key={employee.userId}>
                      {!active && (index === 0 || visibleRows[index - 1].active) && (
                        <Text style={[styles.groupLabel, styles.planLabel, { color: shiftTone.ink }]}>
                          По плану · {roster.planned.length}
                        </Text>
                      )}
                      <View testID={`owner-home-live-person-${employee.userId}`} style={styles.person}>
                        <EmployeeAvatar
                          userId={employee.userId}
                          avatar={employee.avatar}
                          style={[styles.avatar, { backgroundColor: shiftTone.inset }]}
                          imageStyle={styles.avatarImage}
                        >
                          <Text style={[styles.initials, { color: shiftTone.ink }]}>{initials || '?'}</Text>
                        </EmployeeAvatar>
                        <View style={styles.flex}>
                          <Text style={[styles.name, { color: p.text.primary }]}>{name || 'Сотрудник'}</Text>
                          <Text style={[styles.note, { color: shiftTone.ink }]}>
                            {shiftDetail(employee, active, timezone)}
                          </Text>
                        </View>
                      </View>
                    </React.Fragment>
                  );
                })}
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
              </>
            )}
          </Animated.View>
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
  groupLabel: { paddingHorizontal: 18, paddingBottom: 6, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  planLabel: { paddingTop: 10 },
  person: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
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
