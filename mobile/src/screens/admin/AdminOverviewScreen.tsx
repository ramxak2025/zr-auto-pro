/**
 * AdminOverviewScreen — the dashboard of the platform-operator shell.
 *
 * Суперадмин:
 *   • Hero metrics straight from getStats() (PlatformStats): MRR, ARPU,
 *     активные / истёкшие тенанты, новые за месяц, всего пользователей.
 *     These are SERVER-computed — we never re-derive MRR client-side.
 *   • «Менеджеры»: долг менеджеров и оплаты, проведённые через менеджеров, за месяц.
 *   • «Истекают / просрочены» board: tenants whose subscription is within the
 *     next 30 days or already past. «Продлить» открывает ту же форму, что и карточка
 *     автосервиса (сумма / тип / дата) — быстрого «+30 дней» без формы больше нет.
 *   • «Последние клиенты»: the 5 newest tenants.
 *
 * Менеджер (только свои автосервисы, managerApi):
 *   • Плитки из сводки: клиенты, активные, истекают за 7 дней, оплаты за месяц,
 *     «Моя доля», «Долг владельцу»; кнопка «Новый автосервис».
 *   • «Истекают и просрочены» (до 7 дней) с той же формой продления и «Последние автосервисы».
 *
 * On the visual system — IosScreenHeader, iosCard, theme palette.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { tenantsApi, adminApi, managerApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type {
  Tenant,
  PlatformStats,
  ManagerSummary,
  SubscriptionRevenue,
  SubscriptionRevenuePoint,
  RegistrationRequest,
} from '../../../../shared/types';
import type { SemanticPalette } from '../../theme/palette';
import {
  balanceColor,
  daysLeft,
  formatDate,
  formatMoney,
  formatMoneyExact,
  formatMonthShort,
  formatPercent,
  tenantRowStatus,
  useAdminMode,
  InitialAvatar,
  MetricTile,
  StatusChip,
} from './adminShared';
import ExtendSubscriptionSheet from './ExtendSubscriptionSheet';
import ManagerCreateTenantSheet from './ManagerCreateTenantSheet';

const CHART_HEIGHT = 56;
/** Окно «Истекают» на обзоре: у суперадмина месяц, у менеджера — неделя (как плитка «Истекает за 7 дней»). */
const SUPERADMIN_EXPIRING_DAYS = 30;
const MANAGER_EXPIRING_DAYS = 7;

/** Активные подписки, что кончаются в ближайшие `days` дней или уже просрочены; самые срочные сверху. */
function expiringWithin(tenants: Tenant[], days: number): Tenant[] {
  return tenants
    .filter((t) => {
      if (!t.isActive) return false;
      const left = daysLeft(t.subscriptionEnd);
      return left !== null && left <= days;
    })
    .sort((a, b) => (daysLeft(a.subscriptionEnd) ?? 0) - (daysLeft(b.subscriptionEnd) ?? 0));
}

function newestFive(tenants: Tenant[]): Tenant[] {
  return [...tenants].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
}

/**
 * Форма продления для обеих ролей: строка «Продлить» открывает шторку. Цель держим в
 * состоянии отдельно от `open`, чтобы шторка уезжала с анимацией, а не пропадала.
 */
function useExtendSheet() {
  const [target, setTarget] = React.useState<Tenant | null>(null);
  const [open, setOpen] = React.useState(false);
  const openExtend = React.useCallback((tenant: Tenant) => {
    haptic('tap');
    setTarget(tenant);
    setOpen(true);
  }, []);
  const sheet = (
    <ExtendSubscriptionSheet
      visible={open}
      tenant={target}
      currentKind={target?.currentPeriodKind ?? null}
      onClose={() => setOpen(false)}
    />
  );
  return { openExtend, sheet };
}

export default function AdminOverviewScreen() {
  const mode = useAdminMode();
  return mode === 'manager' ? <ManagerOverview /> : <SuperadminOverview />;
}

function SuperadminOverview() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const { openExtend, sheet } = useExtendSheet();

  const { data: stats } = useQuery<PlatformStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => (await tenantsApi.getStats()).data,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await tenantsApi.getAll()).data,
  });

  // Pending self-service registration requests (123) — drives the top card's
  // count badge. Shares the exact query key the review screen uses so the two
  // stay in lock-step after an approve/reject invalidates the family.
  const { data: pendingRequests = [] } = useQuery<RegistrationRequest[]>({
    queryKey: ['admin-registration-requests', 'pending'],
    queryFn: async () => (await adminApi.listRegistrationRequests('pending')).data,
  });
  const pendingCount = pendingRequests.length;

  // 122 — collected PAID subscription revenue (this-month / total, paid vs free
  // extension counts, monthly series). Free extensions never count as revenue.
  const { data: revenue } = useQuery<SubscriptionRevenue>({
    queryKey: ['admin-subscription-revenue'],
    queryFn: async () => (await adminApi.getSubscriptionRevenue()).data,
  });

  // Server returns the series newest-first; take the most recent 8 and flip to
  // oldest→newest so the mini-chart reads left → right like a calendar.
  const chartPoints = React.useMemo<SubscriptionRevenuePoint[]>(
    () => (revenue?.monthly ?? []).slice(0, 8).reverse(),
    [revenue?.monthly],
  );

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-revenue'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-registration-requests'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  // Истекают (next 30 days) OR уже просрочены — only active tenants matter.
  const expiringBoard = React.useMemo(() => expiringWithin(tenants, SUPERADMIN_EXPIRING_DAYS), [tenants]);
  const recent = React.useMemo(() => newestFive(tenants), [tenants]);

  const openTenant = React.useCallback((id: string) => navigation.navigate('AdminTenantDetail', { id }), [navigation]);

  const managersDebt = stats?.managersBalanceTotal ?? 0;

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
        {/* Self-service registration requests — top card with a pending count. */}
        <Pressable
          onPress={() => {
            haptic('tap');
            navigation.navigate('AdminRegistrationRequests');
          }}
          style={[styles.requestsCard, surface.card]}
        >
          <View
            style={[
              styles.requestsIcon,
              { backgroundColor: pendingCount > 0 ? palette.accent.primarySoft : palette.bg.muted },
            ]}
          >
            <Ionicons
              name="mail-unread-outline"
              size={22}
              color={pendingCount > 0 ? palette.accent.primaryText : palette.text.tertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.requestsTitle, { color: palette.text.primary }]}>Заявки на регистрацию</Text>
            <Text style={[styles.requestsSub, { color: palette.text.tertiary }]}>
              {pendingCount > 0 ? `${pendingCount} ждут решения` : 'Новых заявок нет'}
            </Text>
          </View>
          {pendingCount > 0 ? (
            <View style={[styles.requestsBadge, { backgroundColor: palette.accent.primary }]}>
              <Text style={styles.requestsBadgeText}>{pendingCount}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
        </Pressable>

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

        {/* Managers: долг перед владельцем и оплаты, что прошли через менеджеров */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Менеджеры</Text>
        <View style={styles.grid}>
          <MetricTile
            icon="cash-outline"
            tint={colors.red[600]}
            value={formatMoney(managersDebt)}
            valueColor={balanceColor(managersDebt, palette)}
            label="Долг менеджеров"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="people-outline"
            tint={colors.primary[600]}
            value={formatMoney(stats?.paidByManagersThisMonth ?? 0)}
            label="Оплаты через менеджеров за месяц"
            surfaceCard={surface.card}
            palette={palette}
          />
        </View>

        {/* Paid subscription revenue */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Платная выручка от подписок</Text>
        <View style={[surface.card, styles.revenueCard]}>
          <View style={styles.revenueTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.revenueValue, { color: palette.text.primary }]}>
                {formatMoney(revenue?.paidRevenueThisMonth ?? 0)}
              </Text>
              <Text style={[styles.revenueCaption, { color: palette.text.tertiary }]}>Собрано за этот месяц</Text>
            </View>
            <View style={styles.revenueTotalBox}>
              <Text style={[styles.revenueTotalValue, { color: palette.text.secondary }]}>
                {formatMoney(revenue?.paidRevenueTotal ?? 0)}
              </Text>
              <Text style={[styles.revenueCaption, { color: palette.text.tertiary }]}>Всего</Text>
            </View>
          </View>

          {chartPoints.some((p) => p.paidRevenue > 0) ? (
            <PaidRevenueChart points={chartPoints} palette={palette} />
          ) : (
            <Text style={[styles.revenueEmpty, { color: palette.text.tertiary }]}>
              Пока нет платных продлений за последние месяцы
            </Text>
          )}

          <View style={[styles.revenueFooter, { borderTopColor: palette.border.subtle }]}>
            <View style={styles.revenueStat}>
              <View style={[styles.revenueDot, { backgroundColor: colors.green[500] }]} />
              <Text style={[styles.revenueStatText, { color: palette.text.secondary }]}>
                {revenue?.paidExtensionsThisMonth ?? 0} платных за месяц
              </Text>
            </View>
            <View style={styles.revenueStat}>
              <View style={[styles.revenueDot, { backgroundColor: palette.text.tertiary }]} />
              <Text style={[styles.revenueStatText, { color: palette.text.tertiary }]}>
                {revenue?.freeExtensionsThisMonth ?? 0} бесплатных · не выручка
              </Text>
            </View>
          </View>
        </View>

        {/* Expiring / lapsed board */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Истекают и просрочены</Text>
        <ExpiringBoard
          items={expiringBoard}
          emptyText="Нет подписок, требующих внимания"
          palette={palette}
          surfaceCard={surface.card}
          onOpen={openTenant}
          onExtend={openExtend}
        />

        {/* Recent tenants */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Последние клиенты</Text>
        <RecentBoard
          items={recent}
          emptyText="Нет клиентов"
          palette={palette}
          surfaceCard={surface.card}
          onOpen={openTenant}
        />
      </ScrollView>

      {sheet}
    </View>
  );
}

function ManagerOverview() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const { openExtend, sheet } = useExtendSheet();

  // Ключи ['manager', …] — не в persistent cache: деньги на диск не пишем.
  const {
    data: summary,
    isPending: summaryPending,
    isError: summaryError,
  } = useQuery<ManagerSummary>({
    queryKey: ['manager', 'summary'],
    queryFn: async () => (await managerApi.summary()).data,
    placeholderData: (prev) => prev,
  });

  const {
    data: tenants = [],
    isPending: tenantsPending,
    isError: tenantsError,
  } = useQuery<Tenant[]>({
    queryKey: ['manager', 'tenants'],
    queryFn: async () => (await managerApi.tenants()).data,
    placeholderData: (prev) => prev,
  });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['manager', 'summary'] }),
      queryClient.invalidateQueries({ queryKey: ['manager', 'tenants'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const expiringBoard = React.useMemo(() => expiringWithin(tenants, MANAGER_EXPIRING_DAYS), [tenants]);
  const recent = React.useMemo(() => newestFive(tenants), [tenants]);

  const openTenant = React.useCallback((id: string) => navigation.navigate('AdminTenantDetail', { id }), [navigation]);

  const counts = summary?.tenants;
  const balance = summary?.balance ?? 0;
  // Переплата — расчётов внесено больше, чем набежало долей: показываем её отдельной подписью.
  const overpaid = balance <= -0.005;
  const sharePercent = summary?.ownerSharePercent;

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Кабинет менеджера"
        subtitle={user?.fullName || 'Подключение и сопровождение автосервисов'}
      />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        <Pressable
          onPress={() => {
            haptic('tap');
            setCreateOpen(true);
          }}
          style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.primaryBtnText}>Новый автосервис</Text>
        </Pressable>

        <View style={styles.quickActions}>
          <Pressable
            style={[styles.quickAction, surface.card]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('AdminTenants', { screen: 'AdminTenantsHome' })}
          >
            <Ionicons name="business-outline" size={22} color={palette.accent.primary} />
            <Text style={[styles.quickActionTitle, { color: palette.text.primary }]}>Мои автосервисы</Text>
            <Text style={{ color: palette.text.tertiary }}>Подписки и доступы</Text>
          </Pressable>
          <Pressable
            style={[styles.quickAction, surface.card]}
            accessibilityRole="button"
            onPress={() => navigation.navigate('AdminMore', { screen: 'ManagerLedger' })}
          >
            <Ionicons name="wallet-outline" size={22} color={palette.accent.primary} />
            <Text style={[styles.quickActionTitle, { color: palette.text.primary }]}>Расчёты</Text>
            <Text style={{ color: palette.text.tertiary }}>Оплаты и моя доля</Text>
          </Pressable>
        </View>
        {(summaryError || tenantsError) && (
          <Pressable style={[styles.notice, surface.card]} onPress={onRefresh} accessibilityRole="button">
            <Text style={{ color: palette.text.secondary }}>
              Не удалось обновить кабинет. Нажмите, чтобы повторить.
            </Text>
          </Pressable>
        )}
        {(summaryPending || tenantsPending) && (
          <Text style={{ color: palette.text.tertiary }}>Загружаем данные кабинета…</Text>
        )}

        <View style={styles.grid}>
          <MetricTile
            icon="business"
            tint={colors.primary[600]}
            value={counts ? String(counts.total) : tenantsPending || tenantsError ? '—' : String(tenants.length)}
            label="Клиентов"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="checkmark-circle"
            tint={colors.green[600]}
            value={counts ? String(counts.active) : '—'}
            label="Активных"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="alarm-outline"
            tint={colors.orange[500]}
            value={counts ? String(counts.expiringIn7d) : '—'}
            label="Истекает за 7 дней"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="card-outline"
            tint={colors.blue[600]}
            value={summary ? formatMoneyExact(summary.paidThisMonth) : '—'}
            label="Оплат за месяц"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="wallet-outline"
            tint={colors.green[600]}
            value={summary ? formatMoneyExact(summary.myShareThisMonth) : '—'}
            label={sharePercent != null ? `Моя доля · ${formatPercent(100 - sharePercent)}` : 'Моя доля'}
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricTile
            icon="cash-outline"
            tint={colors.red[600]}
            value={summary ? formatMoneyExact(Math.abs(balance)) : '—'}
            valueColor={balanceColor(balance, palette)}
            label={overpaid ? 'Переплата владельцу' : 'Долг владельцу'}
            surfaceCard={surface.card}
            palette={palette}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Истекают и просрочены</Text>
        <ExpiringBoard
          items={expiringBoard}
          emptyText={
            tenantsPending
              ? 'Загрузка…'
              : tenantsError
                ? 'Список подписок недоступен'
                : 'Нет подписок, требующих внимания'
          }
          palette={palette}
          surfaceCard={surface.card}
          onOpen={openTenant}
          onExtend={openExtend}
        />

        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Последние автосервисы</Text>
        <RecentBoard
          items={recent}
          emptyText={
            tenantsPending
              ? 'Загрузка…'
              : tenantsError
                ? 'Список автосервисов недоступен'
                : 'Пока нет автосервисов. Нажмите «Новый автосервис».'
          }
          palette={palette}
          surfaceCard={surface.card}
          onOpen={openTenant}
        />
      </ScrollView>

      <ManagerCreateTenantSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onOpenTenant={(tenant) => navigation.navigate('AdminTenantDetail', { id: tenant.id })}
      />
      {sheet}
    </View>
  );
}

/** Сколько осталось до конца подписки словами: «Осталось 3 дн.», «Истекает сегодня», «Просрочено на 2 дн.». */
function expiryCaption(left: number | null): string {
  if (left === null) return '';
  if (left < 0) return `Просрочено на ${Math.abs(left)} дн.`;
  if (left === 0) return 'Истекает сегодня';
  return `Осталось ${left} дн.`;
}

interface BoardProps {
  items: Tenant[];
  emptyText: string;
  palette: SemanticPalette;
  surfaceCard: object;
  onOpen: (id: string) => void;
}

function ExpiringBoard({
  items,
  emptyText,
  palette,
  surfaceCard,
  onOpen,
  onExtend,
}: BoardProps & { onExtend: (t: Tenant) => void }) {
  return (
    <View style={[styles.card, surfaceCard]}>
      {items.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="shield-checkmark-outline" size={36} color={palette.text.tertiary} />
          <Text style={[styles.emptyText, { color: palette.text.secondary }]}>{emptyText}</Text>
        </View>
      ) : (
        items.map((t, i) => {
          const left = daysLeft(t.subscriptionEnd);
          const overdue = left !== null && left < 0;
          return (
            <Pressable
              key={t.id}
              onPress={() => onOpen(t.id)}
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
                  {expiryCaption(left)}
                </Text>
              </View>
              <Pressable
                onPress={() => onExtend(t)}
                style={[styles.extendBtn, { backgroundColor: palette.accent.primary }]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Продлить подписку «${t.name}»`}
              >
                <Text style={styles.extendBtnText}>Продлить</Text>
              </Pressable>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function RecentBoard({ items, emptyText, palette, surfaceCard, onOpen }: BoardProps) {
  return (
    <View style={[styles.card, surfaceCard]}>
      {items.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="business-outline" size={36} color={palette.text.tertiary} />
          <Text style={[styles.emptyText, { color: palette.text.secondary }]}>{emptyText}</Text>
        </View>
      ) : (
        items.map((t, i) => (
          <Pressable
            key={t.id}
            onPress={() => onOpen(t.id)}
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
            <StatusChip status={tenantRowStatus(t, palette.mode)} />
          </Pressable>
        ))
      )}
    </View>
  );
}

/**
 * Mini bar chart of monthly PAID subscription revenue (oldest → newest). Bars
 * with zero revenue render as a faint stub so the month still reads on the axis.
 * Pure Views — no chart lib, Android-safe.
 */
function PaidRevenueChart({ points, palette }: { points: SubscriptionRevenuePoint[]; palette: SemanticPalette }) {
  const max = Math.max(1, ...points.map((p) => p.paidRevenue));
  return (
    <View style={styles.chartRow}>
      {points.map((p) => {
        const hasRevenue = p.paidRevenue > 0;
        const h = hasRevenue ? Math.max(4, Math.round((p.paidRevenue / max) * CHART_HEIGHT)) : 3;
        return (
          <View key={p.month} style={styles.chartCol}>
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: h, backgroundColor: hasRevenue ? palette.accent.primary : palette.border.strong },
                ]}
              />
            </View>
            <Text style={[styles.chartMonth, { color: palette.text.tertiary }]} numberOfLines={1}>
              {formatMonthShort(p.month)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { padding: spacing[4] },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  quickAction: { flex: 1, minWidth: 140, padding: spacing[4], gap: spacing[2] },
  quickActionTitle: { fontSize: 15, fontWeight: '600' },
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  requestsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
  },
  requestsIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestsTitle: { fontSize: 15, fontWeight: '700' },
  requestsSub: { fontSize: 12.5, marginTop: 2 },
  requestsBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestsBadgeText: { color: colors.white, fontSize: 12, fontWeight: '800' },
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
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
  },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  card: { padding: spacing[2], gap: 0 },
  // Paid revenue block
  revenueCard: { gap: spacing[3.5] },
  revenueTopRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  revenueValue: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  revenueCaption: { fontSize: 12, marginTop: 2 },
  revenueTotalBox: { alignItems: 'flex-end' },
  revenueTotalValue: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  revenueEmpty: { fontSize: 13, textAlign: 'center', paddingVertical: spacing[3] },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[1.5], height: CHART_HEIGHT + 20 },
  chartCol: { flex: 1, alignItems: 'center', gap: spacing[1] },
  chartTrack: { height: CHART_HEIGHT, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  chartBar: { width: '72%', borderRadius: 4, minHeight: 3 },
  chartMonth: { fontSize: 10, fontWeight: '600' },
  revenueFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  revenueStat: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  revenueDot: { width: 8, height: 8, borderRadius: 4 },
  revenueStatText: { fontSize: 12.5, fontWeight: '600' },
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    minWidth: 72,
  },
  extendBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
