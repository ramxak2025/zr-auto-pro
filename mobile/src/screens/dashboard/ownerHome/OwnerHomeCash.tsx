import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { cashShiftsApi, pointsApi, reportsApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useColors } from '../../../contexts/ThemeContext';
import { useTenantTimezone } from '../../../contexts/TenantTimezoneContext';
import { POINTS_QUERY_KEY } from '../../../hooks/usePoints';
import { Skeleton } from '../../../components/Skeleton';
import type { TabParamList } from '../../../navigation/AppNavigator';
import type { PointsListResponse } from '../../../../../shared/types';
import { loadOwnerHome, ownerMoney, type OwnerHomeScope } from './ownerHomeState';
import { ownerCashIsToday, ownerCashPayments, ownerCashPoint, ownerCashShift } from './ownerHomeCashState';

/** Today's check payments and the current shift have deliberately separate accounting bases. */
export default function OwnerHomeCash({
  scope,
  enabled,
}: {
  scope: OwnerHomeScope;
  enabled: boolean;
  todayDate?: string;
}) {
  const p = useColors();
  const { user, hasPermission } = useAuth();
  const timezone = useTenantTimezone();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  const owner = user?.role === 'director';
  const current = scope.isCurrent();
  const canQuery = enabled && owner && current;
  const financialAllowed = owner && hasPermission('financial_reports');
  const flowAllowed = owner && (hasPermission('cashflow_view_all') || hasPermission('cashflow_view'));
  // Observe the toolbar's canonical metadata without another request, point
  // switch, cash-mode activation, or a provider/settings query.
  const points = useQuery<PointsListResponse>({
    queryKey: POINTS_QUERY_KEY,
    queryFn: async () => (await pointsApi.list()).data,
    enabled: false,
  });
  const point = ownerCashPoint(
    user?.currentPointId ?? null,
    !points.isError && !points.isPending && !points.isPlaceholderData ? points.data : undefined,
  );
  const pointKey = point.kind === 'ready' ? `${point.kind}:${point.pointId ?? ''}` : point.kind;
  const scopeKey = JSON.stringify(scope.key);
  const access = useRef({ mounted: true, scopeKey, pointKey, canQuery, financialAllowed, flowAllowed });
  Object.assign(access.current, { scopeKey, pointKey, canQuery, financialAllowed, flowAllowed });
  useEffect(() => {
    access.current.mounted = true;
    return () => {
      access.current.mounted = false;
    };
  }, []);
  const featureCurrent = (feature: 'financialAllowed' | 'flowAllowed', checkPoint = false) => {
    const latest = access.current;
    return (
      latest.mounted &&
      latest.scopeKey === scopeKey &&
      latest.canQuery &&
      latest[feature] &&
      (!checkPoint || (latest.pointKey === pointKey && point.kind === 'ready')) &&
      scope.isCurrent()
    );
  };
  const assertCurrent = (checkPoint = false) => {
    if (!featureCurrent('financialAllowed', checkPoint)) throw new Error('Сессия изменилась');
  };
  const payments = useQuery({
    // Keep the full DashboardV2 payload and the native widget's cache contract.
    // Historical profit navigation never changes this key or API period.
    queryKey: ['owner-home', ...scope.key, 'native-widget-today'],
    queryFn: () =>
      loadOwnerHome(scope, async () => {
        assertCurrent();
        const response = await reportsApi.dashboardV2({ period: 'today' });
        assertCurrent();
        return response;
      }),
    enabled: canQuery && financialAllowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: () => (featureCurrent('financialAllowed') ? 60_000 : false),
    placeholderData: undefined,
  });
  const balance = useQuery({
    queryKey: ['owner-home', ...scope.key, 'cash-shift-current', pointKey],
    queryFn: () =>
      loadOwnerHome(scope, async () => {
        assertCurrent(true);
        const response = await cashShiftsApi.current();
        assertCurrent(true);
        return response;
      }),
    enabled: canQuery && financialAllowed && point.kind === 'ready',
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: () => (featureCurrent('financialAllowed', true) ? 60_000 : false),
    placeholderData: undefined,
  });
  if (!owner || !current || !financialAllowed) return null;

  const tone =
    p.mode === 'dark'
      ? {
          background: '#252e25',
          ink: '#ccddc3',
          quiet: '#b5c7ac',
          divider: '#40503c',
          inset: '#303d2d',
          warning: '#f1bb9b',
        }
      : {
          background: '#eff4e9',
          ink: '#405a35',
          quiet: '#53694a',
          divider: '#d3dfc9',
          inset: '#e2ecd9',
          warning: '#963f24',
        };
  const snapshot =
    !payments.isPending &&
    !payments.isError &&
    !payments.isPlaceholderData &&
    payments.isFetchedAfterMount &&
    payments.fetchStatus !== 'paused' &&
    ownerCashIsToday(payments.dataUpdatedAt, timezone)
      ? ownerCashPayments(payments.data)
      : null;
  const shift =
    !balance.isPending &&
    !balance.isError &&
    !balance.isPlaceholderData &&
    balance.isFetchedAfterMount &&
    balance.fetchStatus !== 'paused'
      ? ownerCashShift(balance.data, point, user?.tenantId ?? null)
      : null;
  const open = (screen: 'CashFlow' | 'CashShift' | 'Points') => {
    if (!featureCurrent(screen === 'CashFlow' ? 'flowAllowed' : 'financialAllowed', screen === 'CashShift')) return;
    if (screen === 'Points' && access.current.pointKey !== pointKey) return;
    navigation.dispatch(CommonActions.navigate({ name: 'MoreTab', params: { screen, initial: false } }));
  };
  const notice = (message: string, source: 'payments' | 'balance') => {
    const query = source === 'payments' ? payments : balance;
    const paused = query.fetchStatus === 'paused';
    return (
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={[styles.note, styles.flex, { color: tone.ink }]}>
          {paused ? 'Нет связи · обновим после подключения' : message}
        </Text>
        {!paused && (
          <TouchableOpacity
            testID={`owner-home-cash-${source}-retry`}
            accessibilityRole="button"
            accessibilityLabel={`${message}. Повторить`}
            disabled={!canQuery || query.isFetching}
            onPress={() => {
              if (featureCurrent('financialAllowed', source === 'balance')) void query.refetch();
            }}
            style={styles.action}
          >
            <Text style={[styles.link, { color: tone.ink }]}>Повторить</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };
  const amount = (value: number | null, testID: string, large = false) => (
    <Text
      testID={testID}
      style={[
        large ? styles.balanceAmount : styles.amount,
        { color: value !== null && value < 0 ? tone.warning : tone.ink },
      ]}
    >
      {value === null ? '—' : ownerMoney(value)}
    </Text>
  );
  return (
    <View testID="owner-home-cash" style={[styles.panel, { backgroundColor: tone.background }]}>
      <TouchableOpacity
        testID="owner-home-cash-flow"
        accessibilityRole="button"
        accessibilityLabel="Деньги сегодня. Открыть движение денег"
        accessibilityState={{ disabled: !canQuery || !flowAllowed }}
        disabled={!canQuery || !flowAllowed}
        onPress={() => open('CashFlow')}
        activeOpacity={0.65}
        style={styles.heading}
      >
        <Ionicons name="wallet-outline" size={20} color={tone.ink} />
        <Text accessibilityRole="header" style={[styles.title, styles.flex, { color: tone.ink }]}>
          Деньги сегодня
        </Text>
        {flowAllowed && <Ionicons name="chevron-forward" size={16} color={tone.ink} />}
      </TouchableOpacity>

      {snapshot ? (
        <View style={styles.body}>
          <View style={[styles.totalRow, stacked && styles.stacked]}>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: tone.ink }]}>Оплаты чеков</Text>
              {point.kind === 'choose' && <Text style={[styles.caption, { color: tone.quiet }]}>Все филиалы</Text>}
            </View>
            {amount(snapshot.total, 'owner-home-cash-total')}
          </View>
          <View style={[styles.tenders, stacked && styles.stacked]}>
            <View style={styles.tender}>
              <View style={styles.tenderLabel}>
                <Ionicons name="cash-outline" size={15} color={tone.quiet} />
                <Text style={[styles.note, { color: tone.quiet }]}>Наличные</Text>
              </View>
              {amount(snapshot.cash, 'owner-home-cash-cash')}
            </View>
            <View style={styles.tender}>
              <View style={styles.tenderLabel}>
                <Ionicons name="card-outline" size={15} color={tone.quiet} />
                <Text style={[styles.note, { color: tone.quiet }]}>Карта</Text>
              </View>
              {amount(snapshot.card, 'owner-home-cash-card')}
            </View>
          </View>
          <Text style={[styles.caption, { color: tone.quiet }]}>По дате чеков · с учётом возвратов</Text>
          {snapshot.installmentPaid !== null && snapshot.installmentPaid > 0 && (
            <View style={[styles.separated, { borderTopColor: tone.divider }]}>
              <View style={[styles.totalRow, stacked && styles.stacked]}>
                <Text style={[styles.note, styles.flex, { color: tone.ink }]}>Погашения рассрочки</Text>
                {amount(snapshot.installmentPaid, 'owner-home-cash-installments')}
              </View>
              {snapshot.installmentPaidCash !== null && snapshot.installmentPaidCard !== null && (
                <View style={styles.repaymentParts}>
                  <Text style={[styles.caption, { color: tone.quiet }]}>
                    Наличные {ownerMoney(snapshot.installmentPaidCash)}
                  </Text>
                  <Text style={[styles.caption, { color: tone.quiet }]}>
                    Карта {ownerMoney(snapshot.installmentPaidCard)}
                  </Text>
                </View>
              )}
            </View>
          )}
          <View style={[styles.separated, { borderTopColor: tone.divider }]}>
            <View style={styles.tenderLabel}>
              <Ionicons name="shield-checkmark-outline" size={15} color={tone.quiet} />
              <Text style={[styles.note, { color: tone.ink }]}>Гарантия · справочно</Text>
            </View>
            <View style={[styles.warranty, stacked && styles.stacked]}>
              <View style={styles.tender}>
                <Text style={[styles.caption, { color: tone.quiet }]}>По чекам</Text>
                {amount(snapshot.warranty, 'owner-home-cash-warranty')}
              </View>
              <View style={styles.tender}>
                <Text style={[styles.caption, { color: tone.quiet }]}>Затраты</Text>
                {amount(snapshot.warrantyLoss, 'owner-home-cash-warranty-cost')}
              </View>
            </View>
          </View>
        </View>
      ) : payments.fetchStatus !== 'paused' &&
        (payments.isPending || (!payments.isFetchedAfterMount && !payments.isError)) ? (
        <View style={styles.loading} accessibilityLabel="Загружаем оплаты за сегодня">
          <Skeleton height={154} radius={10} />
        </View>
      ) : (
        notice('Оплаты не обновились', 'payments')
      )}

      <View style={[styles.balance, { backgroundColor: tone.inset }]}>
        {point.kind === 'choose' ? (
          <TouchableOpacity
            testID="owner-home-cash-choose-point"
            accessibilityRole="button"
            accessibilityLabel="Для остатка кассы выберите филиал"
            disabled={!canQuery}
            onPress={() => open('Points')}
            style={styles.balanceLink}
          >
            <View style={styles.flex}>
              <Text style={[styles.label, { color: tone.ink }]}>Остаток в кассовой смене</Text>
              <Text style={[styles.note, { color: tone.quiet }]}>Выберите филиал</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={tone.ink} />
          </TouchableOpacity>
        ) : point.kind === 'unknown' || point.kind === 'mismatch' ? (
          <View style={styles.balanceContent} accessibilityRole="alert">
            <Text style={[styles.label, { color: tone.ink }]}>Остаток в кассовой смене</Text>
            <Text style={[styles.note, { color: tone.quiet }]}>
              {points.isPending && !points.isError ? 'Уточняем филиал…' : 'Не удалось определить кассу'}
            </Text>
            {(!points.isPending || points.isError) && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Проверить филиал кассы"
                disabled={!canQuery}
                onPress={() => open('Points')}
                style={styles.action}
              >
                <Text style={[styles.link, { color: tone.ink }]}>Проверить филиал</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : shift ? (
          <TouchableOpacity
            testID="owner-home-cash-shift"
            accessibilityRole="button"
            accessibilityLabel={
              shift.kind === 'open'
                ? `Остаток наличных по учёту ${ownerMoney(shift.expectedAmount)}. Открыть кассовую смену`
                : 'Открытой кассовой смены нет. Открыть кассовые смены'
            }
            accessibilityState={{ disabled: !canQuery }}
            disabled={!canQuery}
            onPress={() => open('CashShift')}
            activeOpacity={0.65}
            style={styles.balanceLink}
          >
            <View style={styles.flex}>
              <Text style={[styles.label, { color: tone.ink }]}>
                {shift.kind === 'open' ? 'Наличные в смене' : 'Нет открытой кассовой смены'}
              </Text>
              {shift.kind === 'open' ? amount(shift.expectedAmount, 'owner-home-cash-balance', true) : null}
              <Text style={[styles.caption, { color: tone.quiet }]}>
                {shift.kind === 'open' ? 'Остаток по учёту' : 'Остаток появится в открытой смене'}
                {point.name ? ` · ${point.name}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={tone.ink} />
          </TouchableOpacity>
        ) : balance.fetchStatus !== 'paused' &&
          (balance.isPending || (!balance.isFetchedAfterMount && !balance.isError)) ? (
          <View style={styles.loading} accessibilityLabel="Загружаем остаток кассовой смены">
            <Skeleton height={70} radius={10} />
          </View>
        ) : (
          notice('Остаток не обновился', 'balance')
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 22, overflow: 'hidden', marginBottom: 14 },
  heading: {
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { paddingHorizontal: 18, paddingBottom: 15 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  amount: { fontSize: 17, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  balanceAmount: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
    marginVertical: 2,
  },
  note: { fontSize: 13, lineHeight: 19 },
  caption: { fontSize: 12, lineHeight: 18 },
  flex: { flex: 1, minWidth: 0 },
  tenders: { flexDirection: 'row', gap: 16, paddingTop: 13, paddingBottom: 7 },
  tender: { flex: 1, minWidth: 0, gap: 2 },
  tenderLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  separated: { marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth },
  repaymentParts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 3 },
  warranty: { flexDirection: 'row', gap: 16, paddingTop: 7 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  balance: { minHeight: 88 },
  balanceLink: {
    minHeight: 88,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  balanceContent: { paddingHorizontal: 18, paddingVertical: 15, gap: 4 },
  notice: {
    minHeight: 70,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  action: { minHeight: 48, justifyContent: 'center' },
  link: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  loading: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 16 },
});
