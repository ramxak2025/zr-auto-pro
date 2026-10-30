import React, { useState } from 'react';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, salaryApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useColors } from '../../../contexts/ThemeContext';
import { usePosSettings } from '../../../hooks/usePosSettings';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import { Skeleton } from '../../../components/Skeleton';
import type { TabParamList } from '../../../navigation/AppNavigator';
import { ATTENTION_LABELS, EARNINGS_EXPLANATION } from '../../../../../shared/utils/dashboardAttention';
import type { AttentionBucketId } from '../../../../../shared/types';
import { openAttention } from '../attentionNavigation';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';
import { loadOwnerHome, ownerDateLabel, ownerMoney, type OwnerHomeScope } from './ownerHomeState';

const attentionIcons: Record<AttentionBucketId, keyof typeof Ionicons.glyphMap> = {
  bookings: 'calendar-outline',
  deferred: 'receipt-outline',
  'purchase-orders': 'cart-outline',
  'low-stock': 'cube-outline',
  installments: 'time-outline',
};

export function OwnerHomeRetry({
  text,
  onRetry,
  busy = false,
  inverse = false,
}: {
  text: string;
  onRetry: () => unknown;
  busy?: boolean;
  inverse?: boolean;
}) {
  const p = useColors();
  return (
    <View style={styles.retryRow} accessibilityRole="alert">
      <Text style={[styles.note, { color: inverse ? '#dce7ff' : p.text.secondary, flex: 1 }]}>{text}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${text}. Повторить`}
        disabled={busy}
        onPress={() => onRetry()}
        style={styles.action}
      >
        <Text style={{ color: inverse ? '#fff' : p.accent.primaryText }}>Повторить</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function OwnerHomeOperational({
  scope,
  enabled,
  showEarnings,
  todayDate,
}: {
  scope: OwnerHomeScope;
  enabled: boolean;
  showEarnings: boolean;
  todayDate?: string;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const tones = ownerHomeSurfaces(p.mode === 'dark');
  const largeText = fontScale > 1.2;
  const { user, hasPermission } = useAuth();
  const { shiftModeEnabled, isCashier } = usePosSettings();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const [expanded, setExpanded] = useState(false);
  const owner = user?.role === 'director';
  const attention = useQuery({
    queryKey: ['owner-home', ...scope.key, 'attention', todayDate ?? 'today'],
    queryFn: () => loadOwnerHome(scope, () => dashboardApi.attention()),
    enabled: enabled && owner,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: enabled ? 60_000 : false,
    placeholderData: undefined,
  });
  const salaryAllowed = owner && hasPermission('salary_view_all');
  const earnings = useQuery({
    queryKey: ['owner-home', ...scope.key, 'earnings', todayDate ?? 'today'],
    queryFn: () => loadOwnerHome(scope, () => salaryApi.getTodayEarnings()),
    enabled: enabled && salaryAllowed && showEarnings,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: enabled && showEarnings ? 60_000 : false,
    placeholderData: undefined,
  });
  const canOpenBoard = hasPermission('checks_view');
  const canOpenNfc = user?.tenant?.attendanceMode === 'nfc';
  const canOpenCashShift = shiftModeEnabled && isCashier;
  if (!owner) return null;
  const hasAttention = Array.isArray(attention.data?.buckets);
  const buckets = hasAttention
    ? attention.data!.buckets.filter(
        (bucket) =>
          bucket.error ||
          !attentionIcons[bucket.id] ||
          bucket.count === null ||
          !Number.isFinite(bucket.count) ||
          bucket.count !== 0,
      )
    : [];
  const employees = earnings.data?.employees ?? [];
  return (
    <>
      <View style={[styles.section, styles.group, { backgroundColor: tones.attention.background }]}>
        <View style={styles.panelHeading}>
          <Ionicons name="alert-circle-outline" size={19} color={tones.attention.ink} />
          <Text accessibilityRole="header" style={[styles.title, styles.headingLabel, { color: tones.attention.ink }]}>
            Требует внимания
          </Text>
          <Text style={[styles.note, { color: tones.attention.ink }]}>Сейчас</Text>
        </View>
        {attention.isPending ? (
          <View style={styles.padding}>
            <Skeleton height={76} radius={8} />
          </View>
        ) : attention.isError || !hasAttention ? (
          <OwnerHomeRetry text="Задачи не обновились" busy={attention.isFetching} onRetry={attention.refetch} />
        ) : buckets.length ? (
          buckets.map((bucket, index) => {
            const unavailable =
              bucket.error ||
              bucket.count === null ||
              !Number.isFinite(bucket.count) ||
              bucket.count < 0 ||
              !attentionIcons[bucket.id];
            return (
              <TouchableOpacity
                key={bucket.id}
                accessibilityRole="button"
                accessibilityLabel={
                  unavailable
                    ? `${ATTENTION_LABELS[bucket.id] ?? 'Задачи'}: не загрузилось. Повторить`
                    : `${ATTENTION_LABELS[bucket.id]}: ${bucket.count}`
                }
                disabled={unavailable && attention.isFetching}
                activeOpacity={0.6}
                onPress={() =>
                  unavailable
                    ? attention.refetch()
                    : openAttention(navigation, bucket.id, hasPermission('checks_view_all') ? undefined : user?.id)
                }
                style={[
                  styles.taskRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tones.attention.divider },
                ]}
              >
                <Ionicons name={attentionIcons[bucket.id] ?? 'refresh-outline'} size={20} color={tones.attention.ink} />
                <Text style={[styles.taskLabel, { color: p.text.primary }]}>
                  {ATTENTION_LABELS[bucket.id] ?? 'Задачи'}
                </Text>
                <View style={[styles.taskBadge, { backgroundColor: tones.attention.inset }]}>
                  {unavailable ? (
                    <Ionicons name="refresh-outline" size={16} color={tones.attention.ink} />
                  ) : (
                    <Text style={[styles.taskCount, { color: tones.attention.ink }]}>{bucket.count}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={13} color={tones.attention.ink} />
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.quietRow}>
            <Ionicons name="checkmark-done-outline" size={22} color={tones.attention.ink} />
            <Text style={[styles.name, { color: tones.attention.ink }]}>Срочных задач нет</Text>
          </View>
        )}
      </View>
      {(canOpenBoard || canOpenNfc || canOpenCashShift) && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.title, styles.singleHeading, { color: p.text.primary }]}>
            Сервис сейчас
          </Text>
          <View style={[styles.group, { backgroundColor: tones.service.background }]}>
            {canOpenBoard && (
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.operationRow, { borderBottomColor: tones.service.divider }]}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.navigate({ name: 'Checks', params: { screen: 'WorkBoard', initial: false } }),
                  )
                }
              >
                <View style={[styles.operationIcon, { backgroundColor: tones.service.inset }]}>
                  <Ionicons name="albums-outline" size={19} color={tones.service.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: p.text.primary }]}>Доска заказ-нарядов</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={p.text.secondary} />
              </TouchableOpacity>
            )}
            {canOpenNfc && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Открыть отметку NFC"
                style={[styles.operationRow, { borderBottomColor: tones.service.divider }]}
                onPress={() => navigation.dispatch(CommonActions.navigate({ name: 'NfcAttendance' }))}
              >
                <View style={[styles.operationIcon, { backgroundColor: tones.service.inset }]}>
                  <Ionicons name="radio-outline" size={19} color={tones.service.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: p.text.primary }]}>Рабочая смена</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={p.text.secondary} />
              </TouchableOpacity>
            )}
            {canOpenCashShift && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Открыть кассовую смену"
                style={[styles.operationRow, { borderBottomColor: tones.service.divider }]}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.navigate({ name: 'MoreTab', params: { screen: 'CashShift', initial: false } }),
                  )
                }
              >
                <View style={[styles.operationIcon, { backgroundColor: tones.service.inset }]}>
                  <Ionicons name="cash-outline" size={19} color={tones.service.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: p.text.primary }]}>Кассовая смена</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={p.text.secondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      {salaryAllowed && showEarnings && (
        <View style={[styles.section, styles.group, { backgroundColor: tones.earnings.background }]}>
          <View style={styles.earningsHeading}>
            <View style={styles.earningsHeadingText}>
              <Text accessibilityRole="header" style={[styles.title, { color: tones.earnings.ink }]}>
                Мастера сегодня
              </Text>
              <Text style={[styles.note, { color: p.text.secondary }]}>Заработок команды</Text>
            </View>
            {earnings.data && !earnings.isError && (
              <Text style={[styles.earningsTotal, { color: tones.earnings.ink }]}>
                {ownerMoney(earnings.data.total)}
              </Text>
            )}
          </View>
          <Animated.View layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}>
            {earnings.isPending ? (
              <View style={styles.padding}>
                <Skeleton height={100} radius={8} />
              </View>
            ) : earnings.isError ? (
              <OwnerHomeRetry text="Заработок не обновился" busy={earnings.isFetching} onRetry={earnings.refetch} />
            ) : employees.length ? (
              (expanded ? employees : employees.slice(0, 5)).map((employee) => (
                <View
                  key={employee.id}
                  testID={`owner-home-earnings-${employee.id}`}
                  style={[
                    styles.row,
                    largeText && styles.employeeRowStacked,
                    { borderBottomColor: tones.earnings.divider },
                  ]}
                >
                  <EmployeeAvatar
                    avatar={employee.avatar}
                    userId={employee.id}
                    style={[
                      styles.avatar,
                      largeText && styles.employeeAvatarTop,
                      { backgroundColor: tones.earnings.inset },
                    ]}
                    imageStyle={styles.avatar}
                  >
                    <Text style={{ color: p.text.secondary }}>{employee.name.trim().slice(0, 1)}</Text>
                  </EmployeeAvatar>
                  {largeText ? (
                    <View style={styles.employeeTextStack}>
                      <Text style={[styles.employeeStackedName, { color: p.text.primary }]}>{employee.name}</Text>
                      <Text
                        style={[
                          styles.amount,
                          styles.earnedChip,
                          {
                            color: employee.earnedAmount < 0 ? p.text.primary : tones.earnings.ink,
                            backgroundColor: tones.earnings.inset,
                          },
                        ]}
                      >
                        {ownerMoney(employee.earnedAmount)}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.name, { color: p.text.primary }]}>{employee.name}</Text>
                      <Text
                        style={[
                          styles.amount,
                          styles.earnedChip,
                          {
                            color: employee.earnedAmount < 0 ? p.text.primary : tones.earnings.ink,
                            backgroundColor: tones.earnings.inset,
                          },
                        ]}
                      >
                        {ownerMoney(employee.earnedAmount)}
                      </Text>
                    </>
                  )}
                </View>
              ))
            ) : (
              <Text style={[styles.empty, { color: p.text.secondary }]}>В этом филиале пока нет сотрудников</Text>
            )}
            {!earnings.isError && employees.length > 5 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={expanded ? 'Свернуть' : `Показать всех (${employees.length})`}
                style={[styles.more, { borderTopColor: tones.earnings.divider }]}
                activeOpacity={0.65}
                onPress={() => setExpanded(!expanded)}
              >
                <Text style={{ color: tones.earnings.ink, fontSize: 13, fontWeight: '500' }}>
                  {expanded ? 'Свернуть' : `Показать всех (${employees.length})`}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={tones.earnings.ink} />
              </TouchableOpacity>
            )}
          </Animated.View>
          {earnings.data && !earnings.isError && (
            <Text style={[styles.caption, { color: p.text.secondary }]}>
              {ownerDateLabel(earnings.data.date)} · {EARNINGS_EXPLANATION}
            </Text>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 14 },
  panelHeading: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headingLabel: { flex: 1, minWidth: 0 },
  taskRow: {
    minHeight: 48,
    marginHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskLabel: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  taskBadge: {
    minWidth: 29,
    minHeight: 27,
    borderRadius: 8,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCount: { fontSize: 15, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 16,
    paddingTop: 4,
  },
  earningsHeading: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  earningsHeadingText: { flex: 1, minWidth: 145, gap: 3 },
  earningsTotal: { fontSize: 20, lineHeight: 27, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  earnedChip: {
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  operationIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15 },
  singleHeading: { marginBottom: 7, paddingHorizontal: 2 },
  group: { borderRadius: 18, overflow: 'hidden' },
  rowIcon: { width: 25, alignItems: 'center', justifyContent: 'center' },
  row: {
    minHeight: 53,
    paddingHorizontal: 13,
    paddingVertical: 9,
    gap: 11,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 14, lineHeight: 20, flex: 1, flexShrink: 1 },
  employeeRowStacked: { alignItems: 'flex-start' },
  employeeAvatarTop: { marginTop: 3 },
  employeeTextStack: { flex: 1, minWidth: 0, gap: 4 },
  employeeStackedName: { fontSize: 14, lineHeight: 20 },
  amount: { fontSize: 15, lineHeight: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 18 },
  retryRow: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  empty: { fontSize: 14, lineHeight: 21, padding: 16 },
  padding: { padding: 16 },
  operationRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 9,
    minHeight: 53,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10 },
  caption: { fontSize: 11, lineHeight: 16, paddingBottom: 13, paddingHorizontal: 14, paddingTop: 6 },
});
