/**
 * AdminOverviewScreen — the superadmin platform dashboard.
 *
 *   • Hero metrics straight from getStats() (PlatformStats): MRR, ARPU,
 *     активные / истёкшие тенанты, новые за месяц, всего пользователей.
 *     These are SERVER-computed — we never re-derive MRR client-side.
 *   • «Истекают / просрочены» board: tenants whose subscription is within the
 *     next 30 days or already past, each with a one-tap «Продлить» (+30 дней).
 *   • «Последние клиенты»: the 5 newest tenants.
 *
 * On the visual system — IosScreenHeader, iosCard, theme palette.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { tenantsApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Tenant, PlatformStats } from '../../../../shared/types';
import {
  formatMoney,
  formatDate,
  daysLeft,
  tenantStatus,
  StatusChip,
  InitialAvatar,
} from './adminShared';

export default function AdminOverviewScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const [extendingId, setExtendingId] = React.useState<string | null>(null);

  const { data: stats } = useQuery<PlatformStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => (await tenantsApi.getStats()).data,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await tenantsApi.getAll()).data,
  });

  const extendMutation = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      setExtendingId(id);
      await tenantsApi.extend(id, days);
    },
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось продлить подписку');
    },
    onSettled: () => setExtendingId(null),
  });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  // Истекают (next 30 days) OR уже просрочены — only active tenants matter.
  const expiringBoard = React.useMemo(() => {
    return tenants
      .filter((t) => {
        if (!t.isActive) return false;
        const left = daysLeft(t.subscriptionEnd);
        return left !== null && left <= 30;
      })
      .sort((a, b) => (daysLeft(a.subscriptionEnd) ?? 0) - (daysLeft(b.subscriptionEnd) ?? 0));
  }, [tenants]);

  const recent = React.useMemo(
    () =>
      [...tenants]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [tenants],
  );

  const confirmExtend = React.useCallback(
    (t: Tenant) => {
      haptic('tap');
      Alert.alert('Продлить подписку', `Продлить «${t.name}» на 30 дней?`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Продлить', onPress: () => extendMutation.mutate({ id: t.id, days: 30 }) },
      ]);
    },
    [extendMutation],
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Платформа" subtitle="Обзор Autexa" />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {/* Hero MRR card */}
        <View style={[styles.heroCard, surface.card]}>
          <View style={styles.heroTopRow}>
            <View style={[styles.heroIcon, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="trending-up" size={22} color={palette.accent.primaryText} />
            </View>
            <Text style={[styles.heroLabel, { color: palette.text.secondary }]}>Ежемесячный доход · MRR</Text>
          </View>
          <Text style={[styles.heroValue, { color: palette.text.primary }]}>{formatMoney(stats?.mrr ?? 0)}</Text>
          <Text style={[styles.heroSub, { color: palette.text.tertiary }]}>
            ARPU {formatMoney(stats?.arpu ?? 0)} · {stats?.activeTenants ?? 0} активных
          </Text>
        </View>

        {/* Metric grid */}
        <View style={styles.grid}>
          <MetricTile
            icon="business"
            tint={colors.primary[600]}
            value={String(stats?.totalTenants ?? tenants.length)}
            label="Всего тенантов"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="checkmark-circle"
            tint={colors.green[600]}
            value={String(stats?.activeTenants ?? 0)}
            label="Активные"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="alert-circle"
            tint={colors.red[600]}
            value={String(stats?.expiredTenants ?? 0)}
            label="Истёкшие"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="people"
            tint={colors.purple[700]}
            value={String(stats?.totalUsers ?? 0)}
            label="Пользователи"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="sparkles"
            tint={colors.orange[500]}
            value={String(stats?.newTenantsThisMonth ?? 0)}
            label="Новые за месяц"
            surfaceCard={surface.card}
            palette={palette}
          />
        </View>

        {/* Expiring / lapsed board */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Истекают и просрочены</Text>
        <View style={[styles.card, surface.card]}>
          {expiringBoard.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="shield-checkmark-outline" size={36} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.secondary }]}>
                Нет подписок, требующих внимания
              </Text>
            </View>
          ) : (
            expiringBoard.map((t, i) => {
              const left = daysLeft(t.subscriptionEnd);
              const overdue = left !== null && left < 0;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => navigation.navigate('AdminTenantDetail', { id: t.id })}
                  style={[
                    styles.expRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
                  ]}
                >
                  <InitialAvatar name={t.name} palette={palette} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.expName, { color: palette.text.primary }]} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={[styles.expMeta, { color: overdue ? colors.red[600] : palette.text.tertiary }]}>
                      {overdue
                        ? `Просрочено на ${Math.abs(left!)} дн.`
                        : left === 0
                          ? 'Истекает сегодня'
                          : `Осталось ${left} дн.`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => confirmExtend(t)}
                    disabled={extendingId === t.id}
                    style={[styles.extendBtn, { backgroundColor: palette.accent.primary }]}
                    hitSlop={6}
                  >
                    {extendingId === t.id ? (
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="add" size={14} color={colors.white} />
                        <Text style={styles.extendBtnText}>30 дн.</Text>
                      </>
                    )}
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </View>

        {/* Recent tenants */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Последние клиенты</Text>
        <View style={[styles.card, surface.card]}>
          {recent.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="business-outline" size={36} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Нет клиентов</Text>
            </View>
          ) : (
            recent.map((t, i) => (
              <Pressable
                key={t.id}
                onPress={() => navigation.navigate('AdminTenantDetail', { id: t.id })}
                style={[
                  styles.expRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
                ]}
              >
                <InitialAvatar name={t.name} palette={palette} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.expName, { color: palette.text.primary }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={[styles.expMeta, { color: palette.text.tertiary }]}>{formatDate(t.createdAt)}</Text>
                </View>
                <StatusChip status={tenantStatus(t)} />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function MetricTile({
  icon,
  tint,
  value,
  label,
  surfaceCard,
  palette,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: string;
  label: string;
  surfaceCard: object;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.tile, surfaceCard]}>
      <View style={[styles.tileIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={[styles.tileValue, { color: palette.text.primary }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  heroCard: {
    padding: spacing[5],
    gap: spacing[1],
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], marginBottom: spacing[1] },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: { fontSize: 13, fontWeight: '600' },
  heroValue: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  heroSub: { fontSize: 13, marginTop: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  tile: {
    width: '47.5%',
    padding: spacing[3.5],
    gap: spacing[1],
  },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  tileValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  tileLabel: { fontSize: 12, fontWeight: '500' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  card: { padding: spacing[2], gap: 0 },
  expRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[2],
  },
  expName: { fontSize: 15, fontWeight: '600' },
  expMeta: { fontSize: 12, marginTop: 1 },
  extendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    minWidth: 64,
    justifyContent: 'center',
  },
  extendBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  emptyText: { fontSize: 14 },
});
