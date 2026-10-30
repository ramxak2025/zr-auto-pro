import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useColors } from '../../../contexts/ThemeContext';
import { usePosSettings } from '../../../hooks/usePosSettings';
import { Skeleton } from '../../../components/Skeleton';
import type { TabParamList } from '../../../navigation/AppNavigator';
import { ATTENTION_LABELS } from '../../../../../shared/utils/dashboardAttention';
import type { AttentionBucketId } from '../../../../../shared/types';
import { openAttention } from '../attentionNavigation';
import { ownerHomeSurfaces } from './ownerHomeSurfaces';
import { loadOwnerHome, type OwnerHomeScope } from './ownerHomeState';
import { ownerWidgetLayout, ownerWidgetText } from './ownerHomeWidgetDesign';

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
  todayDate,
}: {
  scope: OwnerHomeScope;
  enabled: boolean;
  todayDate?: string;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const tones = ownerHomeSurfaces(p.mode === 'dark');
  const { user, hasPermission } = useAuth();
  const { shiftModeEnabled, isCashier } = usePosSettings();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
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
  return (
    <>
      <View
        key={`attention-type-${fontScale}`}
        testID="owner-home-attention"
        style={[styles.section, styles.group, { backgroundColor: tones.attention.background }]}
      >
        <View style={styles.panelHeading}>
          <Ionicons name="alert-circle-outline" size={19} color={tones.attention.ink} />
          <Text accessibilityRole="header" style={[styles.title, styles.headingLabel, { color: p.text.primary }]}>
            Требует внимания
          </Text>
          <Text style={[styles.note, { color: p.text.secondary }]}>Сейчас</Text>
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
            <Text style={[styles.name, { color: p.text.secondary }]}>Срочных задач нет</Text>
          </View>
        )}
      </View>
      {(canOpenBoard || canOpenNfc || canOpenCashShift) && (
        <View
          key={`service-type-${fontScale}`}
          testID="owner-home-service"
          style={[styles.section, styles.group, { backgroundColor: tones.service.background }]}
        >
          <View style={styles.panelHeading}>
            <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
              Сервис сейчас
            </Text>
          </View>
          <View>
            {canOpenBoard && (
              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  styles.operationRow,
                  {
                    borderBottomColor: tones.service.divider,
                    borderBottomWidth: canOpenNfc || canOpenCashShift ? StyleSheet.hairlineWidth : 0,
                  },
                ]}
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
                style={[
                  styles.operationRow,
                  {
                    borderBottomColor: tones.service.divider,
                    borderBottomWidth: canOpenCashShift ? StyleSheet.hairlineWidth : 0,
                  },
                ]}
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
                style={styles.operationRow}
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
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: ownerWidgetLayout.gap },
  panelHeading: {
    minHeight: ownerWidgetLayout.headerMinHeight,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headingLabel: { flex: 1, minWidth: 0 },
  taskRow: {
    minHeight: 52,
    marginHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 10,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskLabel: { ...ownerWidgetText.body, flex: 1, minWidth: 0 },
  taskBadge: {
    minWidth: 30,
    minHeight: 28,
    borderRadius: 8,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCount: ownerWidgetText.smallValue,
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingBottom: 16,
    paddingTop: 8,
  },
  operationIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: ownerWidgetText.title,
  group: { borderRadius: ownerWidgetLayout.radius, overflow: 'hidden' },
  name: { ...ownerWidgetText.body, flex: 1, flexShrink: 1 },
  note: ownerWidgetText.label,
  retryRow: {
    paddingHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 8,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  padding: { padding: 16 },
  operationRow: {
    marginHorizontal: ownerWidgetLayout.inset,
    paddingVertical: 9,
    minHeight: 53,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
});
