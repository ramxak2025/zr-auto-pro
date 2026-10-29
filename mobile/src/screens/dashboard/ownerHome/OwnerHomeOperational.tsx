import React, { useState } from 'react';
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
  const buckets = attention.data?.buckets.filter((bucket) => bucket.error || (bucket.count ?? 0) > 0) ?? [];
  const employees = earnings.data?.employees ?? [];
  return (
    <>
      <View style={styles.section}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
            Требует внимания
          </Text>
          <Text style={[styles.note, { color: p.text.secondary }]}>Сейчас</Text>
        </View>
        <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
          {attention.isPending ? (
            <View style={styles.padding}>
              <Skeleton height={76} radius={8} />
            </View>
          ) : attention.isError ? (
            <OwnerHomeRetry text="Задачи не обновились" busy={attention.isFetching} onRetry={attention.refetch} />
          ) : buckets.length ? (
            buckets.map((bucket) =>
              bucket.error ? (
                <OwnerHomeRetry
                  key={bucket.id}
                  text={`${ATTENTION_LABELS[bucket.id]}: не загрузилось`}
                  busy={attention.isFetching}
                  onRetry={attention.refetch}
                />
              ) : (
                <TouchableOpacity
                  key={bucket.id}
                  style={[styles.row, { borderBottomColor: p.border.subtle }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${ATTENTION_LABELS[bucket.id]}: ${bucket.count}`}
                  onPress={() =>
                    openAttention(navigation, bucket.id, hasPermission('checks_view_all') ? undefined : user?.id)
                  }
                >
                  <View style={styles.rowIcon}>
                    <Ionicons
                      name={attentionIcons[bucket.id]}
                      size={20}
                      color={
                        bucket.id === 'bookings'
                          ? p.accent.primaryText
                          : bucket.id === 'low-stock'
                            ? p.mode === 'dark'
                              ? '#e1bb85'
                              : '#876139'
                            : p.text.secondary
                      }
                    />
                  </View>
                  <Text style={[styles.name, { color: p.text.primary }]}>{ATTENTION_LABELS[bucket.id]}</Text>
                  <Text style={[styles.amount, { color: p.text.primary }]}>{bucket.count}</Text>
                  <Ionicons name="chevron-forward" size={15} color={p.text.secondary} />
                </TouchableOpacity>
              ),
            )
          ) : (
            <Text style={[styles.empty, { color: p.text.secondary }]}>Срочных задач нет</Text>
          )}
        </View>
      </View>
      {(canOpenBoard || canOpenNfc || canOpenCashShift) && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.title, styles.singleHeading, { color: p.text.primary }]}>
            Сервис сейчас
          </Text>
          <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
            {canOpenBoard && (
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.operationRow, { borderBottomColor: p.border.subtle }]}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.navigate({ name: 'Checks', params: { screen: 'WorkBoard', initial: false } }),
                  )
                }
              >
                <Ionicons name="albums-outline" size={21} color={p.accent.primaryText} />
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
                style={[styles.operationRow, { borderBottomColor: p.border.subtle }]}
                onPress={() => navigation.dispatch(CommonActions.navigate({ name: 'NfcAttendance' }))}
              >
                <Ionicons name="radio-outline" size={21} color={p.accent.primaryText} />
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
                style={[styles.operationRow, { borderBottomColor: p.border.subtle }]}
                onPress={() =>
                  navigation.dispatch(
                    CommonActions.navigate({ name: 'MoreTab', params: { screen: 'CashShift', initial: false } }),
                  )
                }
              >
                <Ionicons name="cash-outline" size={21} color={p.accent.primaryText} />
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
        <View style={styles.section}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
              Мастера сегодня
            </Text>
            {earnings.data && !earnings.isError && (
              <Text style={[styles.amount, { color: p.text.primary }]}>{ownerMoney(earnings.data.total)}</Text>
            )}
          </View>
          <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
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
                  style={[styles.row, largeText && styles.employeeRowStacked, { borderBottomColor: p.border.subtle }]}
                >
                  <EmployeeAvatar
                    avatar={employee.avatar}
                    userId={employee.id}
                    style={[styles.avatar, largeText && styles.employeeAvatarTop, { backgroundColor: p.bg.muted }]}
                    imageStyle={styles.avatar}
                  >
                    <Text style={{ color: p.text.secondary }}>{employee.name.trim().slice(0, 1)}</Text>
                  </EmployeeAvatar>
                  {largeText ? (
                    <View style={styles.employeeTextStack}>
                      <Text style={[styles.employeeStackedName, { color: p.text.primary }]}>{employee.name}</Text>
                      <Text style={[styles.amount, { color: p.text.primary }]}>
                        {ownerMoney(employee.earnedAmount)}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.name, { color: p.text.primary }]}>{employee.name}</Text>
                      <Text style={[styles.amount, { color: p.text.primary }]}>
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
                style={styles.more}
                onPress={() => setExpanded(!expanded)}
              >
                <Text style={{ color: p.accent.primaryText }}>
                  {expanded ? 'Свернуть' : `Показать всех (${employees.length})`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
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
  section: { marginTop: 18 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 30,
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15 },
  singleHeading: { marginBottom: 7, paddingHorizontal: 2 },
  group: { borderRadius: 16, overflow: 'hidden' },
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
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 10 },
  caption: { fontSize: 12, lineHeight: 18, marginTop: 8, paddingHorizontal: 2 },
});
