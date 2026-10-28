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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, type RouteProp, useNavigation } from '@react-navigation/native';
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
import type { InstallmentPlan } from '../../../shared/types';
import ScreenSectionHeader, { useScreenSectionScroll } from '../components/ScreenSectionHeader';
import { ScreenSectionFlashList, ScreenSectionScrollView } from '../components/ScreenSectionScrollable';
import { HeaderAction, HeaderIsland } from '../components/ScreenHeaderControls';
import ScreenHeaderMenu from '../components/ScreenHeaderMenu';

type Filter = 'open' | 'closed' | 'overdue';

export default function InstallmentsScreen() {
  const section = useScreenSectionScroll();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();
  const route = useRoute<RouteProp<{ Filters: { status?: Filter } }, 'Filters'>>();
  const [filter, setFilter] = useState<Filter>(route.params?.status ?? 'open');
  useEffect(() => {
    if (route.params?.status) {
      setFilter(route.params.status);
      navigation.setParams({ status: undefined });
    }
  }, [route.params?.status, navigation]);
  const [refreshing, setRefreshing] = useState(false);

  // Настройки напоминаний + write-действия — ключ debts_manage (сервер:
  // /installments reminder-settings, reminders/send, pay/payoff/PATCH → тот же
  // ключ; admin живёт по матрице из /auth/me).
  const isOwnerClass = hasPermission('debts_manage');

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

  // A replacement native scroller starts at zero; keep the heading on that same offset.
  const sectionBody = sorted === undefined || sorted.length === 0 ? 'terminal' : 'list';
  React.useEffect(() => section.reset(), [sectionBody, section.reset]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <ScreenSectionHeader scroll={section} title="Рассрочка">
        <HeaderIsland>
          <HeaderAction label="Назад" icon="chevron-back" onPress={() => navigation.goBack()} />
          <ScreenHeaderMenu
            label="Статус рассрочки"
            icon="filter-outline"
            title={filter === 'open' ? 'Открытые' : filter === 'closed' ? 'Закрытые' : 'Просроченные'}
            items={(
              [
                { key: 'open', label: 'Открытые' },
                { key: 'closed', label: 'Закрытые' },
                { key: 'overdue', label: 'Просроченные' },
              ] as const
            ).map((seg) => ({
              id: seg.key,
              label: seg.label,
              selected: filter === seg.key,
              onSelect: () => {
                haptic('tap');
                setFilter(seg.key);
              },
            }))}
          />
          {isOwnerClass && (
            <HeaderAction
              label="Напоминания о платежах"
              icon="notifications-outline"
              onPress={() => {
                haptic('tap');
                navigation.navigate('InstallmentReminderSettings');
              }}
            />
          )}
        </HeaderIsland>
      </ScreenSectionHeader>

      {sorted === undefined ? (
        <ScreenSectionScrollView
          style={{ flex: 1 }}
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          reserveSafeAreaBottom
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
        >
          <ListSkeleton count={6} />
        </ScreenSectionScrollView>
      ) : sorted.length === 0 ? (
        <ScreenSectionScrollView
          style={{ flex: 1 }}
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          reserveSafeAreaBottom
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
        >
          <EmptyState
            icon={filter === 'closed' ? 'check' : 'card'}
            title={
              filter === 'overdue'
                ? 'Просроченных рассрочек нет'
                : filter === 'open'
                  ? 'Открытых рассрочек нет'
                  : 'Закрытых рассрочек нет'
            }
            description={
              filter === 'overdue'
                ? 'Платежей с прошедшей датой нет.'
                : filter === 'open'
                  ? 'Оформите рассрочку при создании заказ-наряда — выберите способ оплаты «Рассрочка».'
                  : 'Здесь появятся полностью погашенные рассрочки.'
            }
          />
        </ScreenSectionScrollView>
      ) : (
        <ScreenSectionFlashList
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          style={{ flex: 1 }}
          reserveSafeAreaBottom
          data={sorted}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={[styles.list, { paddingTop: section.contentTop + spacing[1] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
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
  segmentedWrap: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
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
  // Явный lineHeight (Round 13 #3): 20pt-глиф в наследуемом body-боксе 22
  // подрезал верх «К получению» — тот же класс бага, что и hero деталки.
  summaryValue: { fontSize: fontSize.xl, lineHeight: 26, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
});
