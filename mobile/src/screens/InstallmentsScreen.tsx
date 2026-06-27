/**
 * InstallmentsScreen — «Рассрочка». Replaces the old manual «Должники /
 * дебиторка» list. Lists installment plans (created server-side when a check is
 * sold with paymentMethod 'installment') with a segmented «Открытые | Закрытые»
 * filter. Each row shows the client, originating заказ-наряд, paid/total
 * progress, outstanding remainder, due label and status. Tapping a plan opens
 * InstallmentDetail (repayment + history). The header gear opens reminder
 * settings (owner-class only — director/admin/superadmin).
 *
 * Reads (`installmentsApi.list`) are open to any tenant user; the write actions
 * downstream are role-gated AND enforced server-side.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import InstallmentRow from '../components/installments/InstallmentRow';
import { formatInstallmentMoney } from '../components/installments/installmentUi';
import { installmentsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { InstallmentPlan } from '../../../shared/types';

type Filter = 'open' | 'closed';

export default function InstallmentsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const [filter, setFilter] = useState<Filter>('open');
  const [refreshing, setRefreshing] = useState(false);

  // Reminder settings + the write actions are owner-class (director/admin/superadmin).
  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);

  const { data: plansRaw, isLoading } = useQuery<InstallmentPlan[]>({
    queryKey: ['installments', 'list', filter],
    queryFn: async () => {
      const res = await installmentsApi.list({ status: filter });
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const plans = plansRaw ?? undefined;

  // Open filter: overdue first, then soonest due. Closed: most-recently closed.
  const sorted = useMemo(() => {
    if (!plans) return undefined;
    const list = [...plans];
    if (filter === 'open') {
      list.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        const ad = a.dueInDays ?? 1e9;
        const bd = b.dueInDays ?? 1e9;
        return ad - bd;
      });
    }
    return list;
  }, [plans, filter]);

  const totalOutstanding = useMemo(() => (sorted ?? []).reduce((sum, p) => sum + (p.remaining || 0), 0), [sorted]);
  const overdueCount = useMemo(() => (sorted ?? []).filter((p) => p.overdue).length, [sorted]);

  const handlePress = useCallback(
    (plan: InstallmentPlan) => {
      haptic('select');
      navigation.navigate('InstallmentDetail', { plan });
    },
    [navigation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['installments'] });
    setRefreshing(false);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: InstallmentPlan; index: number }) => (
      <InstallmentRow item={item} index={index} onPress={handlePress} palette={palette} />
    ),
    [handlePress, palette],
  );

  const listHeader =
    filter === 'open' && sorted && sorted.length > 0 ? (
      <View style={[styles.summaryCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>Открытых</Text>
          <Text style={[styles.summaryValue, { color: palette.text.primary }]}>{sorted.length}</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>К получению</Text>
          <Text style={[styles.summaryValue, { color: colors.amber[600] }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatInstallmentMoney(totalOutstanding)}
          </Text>
        </View>
        {overdueCount > 0 ? (
          <>
            <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>Просрочено</Text>
              <Text style={[styles.summaryValue, { color: colors.red[600] }]}>{overdueCount}</Text>
            </View>
          </>
        ) : null}
      </View>
    ) : null;

  const segmented = (
    <View style={styles.segmentedWrap}>
      <View style={[styles.segmentedControl, { backgroundColor: palette.bg.muted }]}>
        {(
          [
            { key: 'open', label: 'Открытые', icon: 'time-outline' },
            { key: 'closed', label: 'Закрытые', icon: 'checkmark-done-outline' },
          ] as const
        ).map((seg) => {
          const active = filter === seg.key;
          return (
            <TouchableOpacity
              key={seg.key}
              style={[styles.segmentBtn, active && [styles.segmentBtnActive, { backgroundColor: palette.bg.card }]]}
              onPress={() => {
                haptic('tap');
                setFilter(seg.key);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name={seg.icon} size={15} color={active ? colors.primary[700] : palette.text.secondary} />
              <Text
                style={[
                  styles.segmentBtnText,
                  { color: active ? colors.primary[700] : palette.text.secondary },
                  active && styles.segmentBtnTextActive,
                ]}
              >
                {seg.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Рассрочка"
        onBack={() => navigation.goBack()}
        centerTitle
        trailing={
          isOwnerClass ? (
            <TouchableOpacity
              onPress={() => {
                haptic('tap');
                navigation.navigate('InstallmentReminderSettings');
              }}
              style={[styles.gearBtn, { backgroundColor: palette.bg.muted }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Напоминания о платежах"
            >
              <Ionicons name="notifications-outline" size={19} color={palette.text.secondary} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {segmented}

      {sorted === undefined ? (
        <ListSkeleton count={6} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={filter === 'open' ? 'card' : 'check'}
          title={filter === 'open' ? 'Открытых рассрочек нет' : 'Закрытых рассрочек нет'}
          description={
            filter === 'open'
              ? 'Оформите рассрочку при создании заказ-наряда — выберите способ оплаты «Рассрочка».'
              : 'Здесь появятся полностью погашенные рассрочки.'
          }
        />
      ) : (
        <FlashList
          data={sorted}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.list}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  gearBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  // Segmented control
  segmentedWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[1], paddingBottom: spacing[2] },
  segmentedControl: { flexDirection: 'row', borderRadius: borderRadius.lg, padding: 3 },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  segmentBtnActive: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentBtnText: { fontSize: 13, fontWeight: fontWeight.medium },
  segmentBtnTextActive: { fontWeight: fontWeight.bold },

  // Summary card
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[4],
    marginBottom: spacing[3],
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: spacing[1] },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  summaryLabel: { fontSize: 12, fontWeight: fontWeight.medium },
  summaryValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
});
