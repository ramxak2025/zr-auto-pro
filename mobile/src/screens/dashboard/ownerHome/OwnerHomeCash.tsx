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
import { ownerWidgetLayout, ownerWidgetText } from './ownerHomeWidgetDesign';

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
          accent: '#bad0ab',
          quiet: '#b6c1b0',
          divider: '#40503c',
          inset: '#2c352b',
          warning: '#f1bb9b',
        }
      : {
          background: '#eff4e9',
          accent: '#536d46',
          quiet: '#5b6656',
          divider: '#d3dfc9',
          inset: '#e8efdf',
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
  const stackTenders =
    stacked || (snapshot !== null && Math.max(ownerMoney(snapshot.cash).length, ownerMoney(snapshot.card).length) > 14);
  const open = (screen: 'CashFlow' | 'CashShift' | 'Points') => {
    if (!featureCurrent(screen === 'CashFlow' ? 'flowAllowed' : 'financialAllowed', screen === 'CashShift')) return;
    if (screen === 'Points' && access.current.pointKey !== pointKey) return;
    navigation.dispatch(CommonActions.navigate({ name: 'MoreTab', params: { screen, initial: false } }));
  };
  const notice = (message: string, source: 'payments' | 'balance') => {
    const query = source === 'payments' ? payments : balance;
    const paused = query.fetchStatus === 'paused';
    return (
      <View style={[styles.notice, stacked && styles.stacked]} accessibilityRole="alert">
        <Text style={[styles.note, styles.flex, { color: p.text.primary }]}>
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
            <Text style={[styles.link, { color: tone.accent }]}>Повторить</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };
  const amount = (value: number | null, testID: string, size: 'metric' | 'value' | 'smallValue' = 'value') => (
    <Text
      testID={testID}
      style={[
        styles.amount,
        ownerWidgetText[size],
        { color: value !== null && value < 0 ? tone.warning : p.text.primary },
      ]}
    >
      {value === null ? '—' : ownerMoney(value)}
    </Text>
  );
  return (
    <View
      key={`cash-type-${fontScale}`}
      testID="owner-home-cash"
      style={[styles.panel, { backgroundColor: tone.background }]}
    >
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
        <Ionicons name="wallet-outline" size={19} color={tone.accent} />
        <Text accessibilityRole="header" style={[styles.title, styles.flex, { color: p.text.primary }]}>
          Деньги сегодня
        </Text>
        {flowAllowed && <Ionicons name="chevron-forward" size={16} color={tone.accent} />}
      </TouchableOpacity>

      {snapshot ? (
        <View style={styles.body}>
          <View style={styles.total}>
            <Text style={[styles.caption, { color: tone.quiet }]}>
              Оплаты чеков{point.kind === 'choose' ? ' · Все филиалы' : ''}
            </Text>
            {amount(snapshot.total, 'owner-home-cash-total', 'metric')}
            <Text style={[styles.caption, { color: tone.quiet }]}>По дате чеков · с учётом возвратов</Text>
          </View>
          <View style={[styles.tenders, stackTenders && styles.stacked]}>
            <View style={styles.tender}>
              <View style={styles.tenderLabel}>
                <Ionicons name="cash-outline" size={15} color={tone.accent} />
                <Text style={[styles.caption, { color: tone.quiet }]}>Наличные</Text>
              </View>
              {amount(snapshot.cash, 'owner-home-cash-cash')}
            </View>
            <View
              style={[
                styles.tender,
                styles.tenderSecond,
                stackTenders && styles.tenderSecondStacked,
                { borderColor: tone.divider },
              ]}
            >
              <View style={styles.tenderLabel}>
                <Ionicons name="card-outline" size={15} color={tone.accent} />
                <Text style={[styles.caption, { color: tone.quiet }]}>Карта</Text>
              </View>
              {amount(snapshot.card, 'owner-home-cash-card')}
            </View>
          </View>
          {snapshot.installmentPaid !== null && snapshot.installmentPaid > 0 && (
            <View style={[styles.separated, { borderTopColor: tone.divider }]}>
              <View style={[styles.totalRow, stacked && styles.stacked]}>
                <Text style={[styles.note, styles.flex, { color: p.text.primary }]}>Погашения рассрочки</Text>
                {amount(snapshot.installmentPaid, 'owner-home-cash-installments', 'smallValue')}
              </View>
              <Text style={[styles.caption, { color: tone.quiet }]}>Отдельно от оплат чеков</Text>
              {snapshot.installmentPaidCash !== null && snapshot.installmentPaidCard !== null && (
                <View style={styles.repaymentParts}>
                  <Text style={[styles.caption, { color: tone.quiet }]}>
                    Наличные <Text style={{ color: p.text.primary }}>{ownerMoney(snapshot.installmentPaidCash)}</Text>
                  </Text>
                  <Text style={[styles.caption, { color: tone.quiet }]}>
                    Карта <Text style={{ color: p.text.primary }}>{ownerMoney(snapshot.installmentPaidCard)}</Text>
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      ) : payments.fetchStatus !== 'paused' &&
        (payments.isPending || (!payments.isFetchedAfterMount && !payments.isError)) ? (
        <View style={styles.loading} accessibilityLabel="Загружаем оплаты за сегодня">
          <Skeleton height={132} radius={10} />
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
              <Text style={[styles.note, { color: p.text.primary }]}>Кассовая смена</Text>
              <Text style={[styles.caption, { color: tone.quiet }]}>Выберите филиал для остатка</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={tone.accent} />
          </TouchableOpacity>
        ) : point.kind === 'unknown' || point.kind === 'mismatch' ? (
          <View style={styles.balanceContent} accessibilityRole="alert">
            <Text style={[styles.note, { color: p.text.primary }]}>Кассовая смена</Text>
            <Text style={[styles.caption, { color: tone.quiet }]}>
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
                <Text style={[styles.link, { color: tone.accent }]}>Проверить филиал</Text>
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
            <View style={[styles.flex, styles.balanceSummary]}>
              <View style={[styles.totalRow, stacked && styles.stacked]}>
                <Text style={[styles.note, styles.flex, { color: p.text.primary }]}>
                  {shift.kind === 'open' ? 'Наличные в смене' : 'Нет открытой кассовой смены'}
                </Text>
                {shift.kind === 'open' ? amount(shift.expectedAmount, 'owner-home-cash-balance') : null}
              </View>
              {(shift.kind === 'open' || point.name) && (
                <Text style={[styles.caption, { color: tone.quiet }]}>
                  {shift.kind === 'open' ? 'Остаток по учёту' : point.name}
                  {shift.kind === 'open' && point.name ? ` · ${point.name}` : ''}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={tone.accent} />
          </TouchableOpacity>
        ) : balance.fetchStatus !== 'paused' &&
          (balance.isPending || (!balance.isFetchedAfterMount && !balance.isError)) ? (
          <View style={styles.loading} accessibilityLabel="Загружаем остаток кассовой смены">
            <Skeleton height={42} radius={10} />
          </View>
        ) : (
          notice('Остаток не обновился', 'balance')
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: ownerWidgetLayout.radius, overflow: 'hidden', marginTop: ownerWidgetLayout.gap },
  heading: {
    minHeight: ownerWidgetLayout.headerMinHeight,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: ownerWidgetText.title,
  body: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 2, paddingBottom: ownerWidgetLayout.inset },
  total: { gap: 3 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  amount: { flexShrink: 1 },
  note: ownerWidgetText.body,
  caption: ownerWidgetText.label,
  flex: { flex: 1, minWidth: 0 },
  tenders: { flexDirection: 'row', gap: 14, marginTop: 14 },
  tender: { flex: 1, minWidth: 0, gap: 3 },
  tenderSecond: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 14 },
  tenderSecondStacked: { borderLeftWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: 0, paddingTop: 10 },
  tenderLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  separated: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  repaymentParts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 3, marginTop: 4 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  balance: { minHeight: 64 },
  balanceSummary: { gap: 2 },
  balanceLink: {
    minHeight: 64,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  balanceContent: { paddingHorizontal: ownerWidgetLayout.inset, paddingVertical: 12, gap: 3 },
  notice: {
    minHeight: 70,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  action: { minHeight: ownerWidgetLayout.target, justifyContent: 'center' },
  link: { ...ownerWidgetText.body, fontWeight: '600' },
  loading: { paddingHorizontal: ownerWidgetLayout.inset, paddingTop: 6, paddingBottom: ownerWidgetLayout.inset },
});
