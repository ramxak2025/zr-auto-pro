import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { tenantsApi, plansApi } from '../api/services';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Tenant, Plan, PlatformStats } from '../../../shared/types';

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatFullDate(d: string): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isExpired(dateStr?: string | null): boolean {
  if (!dateStr) return true;
  return new Date(dateStr) < new Date();
}

function getSubscriptionStatusColor(tenant: Tenant): { bg: string; text: string; label: string } {
  if (!tenant.isActive) return { bg: colors.red[50], text: colors.red[700], label: 'Отключён' };
  if (!tenant.subscriptionEnd) return { bg: colors.gray[100], text: colors.gray[600], label: 'Без подписки' };
  if (isExpired(tenant.subscriptionEnd)) return { bg: colors.red[50], text: colors.red[700], label: 'Истекла' };
  const daysLeft = Math.ceil((new Date(tenant.subscriptionEnd!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 7) return { bg: colors.amber[50], text: colors.amber[600], label: `${daysLeft} дн.` };
  return { bg: colors.green[50], text: colors.green[700], label: 'Активна' };
}

type TabKey = 'overview' | 'tenants' | 'plans';
const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'overview', label: 'Обзор', icon: 'grid-outline' },
  { key: 'tenants', label: 'Клиенты', icon: 'business-outline' },
  { key: 'plans', label: 'Планы', icon: 'pricetags-outline' },
];

const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'checks_view', label: 'Заказ-наряды' },
  { key: 'clients_view', label: 'Клиенты и авто' },
  { key: 'warehouse_view', label: 'Склад' },
  { key: 'services_view', label: 'Услуги' },
  { key: 'suppliers_view', label: 'Поставщики' },
  { key: 'cashflow_view', label: 'Движение денег' },
  { key: 'salary_view', label: 'Зарплата' },
  { key: 'schedule_view', label: 'Расписание' },
  { key: 'reports_view', label: 'Отчёты' },
  { key: 'users_manage', label: 'Пользователи' },
  { key: 'export_data', label: 'Экспорт данных' },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  Stat Card
// ═══════════════════════════════════════════════════════════════════════════════

function StatCard({
  title, value, subtitle, icon, gradientColors, index,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradientColors: readonly [string, string];
  index: number;
}) {
  return (
    <AnimatedCard index={index} style={styles.statCard}>
      <LinearGradient
        colors={gradientColors as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statGradient}
      >
        <View style={styles.statIconWrap}>
          <Ionicons name={icon} size={22} color="rgba(255,255,255,0.9)" />
        </View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
        {subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
      </LinearGradient>
    </AnimatedCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Overview Tab
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewTab({
  stats, tenants, plans,
}: {
  stats?: PlatformStats;
  tenants: Tenant[];
  plans: Plan[];
}) {
  const palette = useColors();
  const totalRevenue = useMemo(() => tenants.reduce((s, t) => s + (t.monthlyPrice || 0), 0), [tenants]);
  const activeSubs = useMemo(() => tenants.filter(t => t.isActive && t.subscriptionEnd && !isExpired(t.subscriptionEnd)).length, [tenants]);
  const expiringSoon = useMemo(() => tenants.filter(t => {
    if (!t.subscriptionEnd || !t.isActive) return false;
    const days = Math.ceil((new Date(t.subscriptionEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length, [tenants]);

  return (
    <View style={styles.tabContent}>
      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <StatCard
          index={0}
          title="Всего клиентов"
          value={String(stats?.totalTenants ?? tenants.length)}
          subtitle={`${stats?.activeTenants ?? tenants.filter(t => t.isActive).length} активных`}
          icon="business"
          gradientColors={[colors.primary[500], colors.primary[700]]}
        />
        <StatCard
          index={1}
          title="Подписки"
          value={String(activeSubs)}
          subtitle={expiringSoon > 0 ? `${expiringSoon} истекают` : 'Все в порядке'}
          icon="shield-checkmark"
          gradientColors={[colors.green[500], colors.green[700]]}
        />
        <StatCard
          index={2}
          title="MRR"
          value={formatMoney(totalRevenue)}
          subtitle="Ежемесячный доход"
          icon="trending-up"
          gradientColors={[colors.purple[700], '#4f46e5']}
        />
        <StatCard
          index={3}
          title="Пользователи"
          value={String(stats?.totalUsers ?? 0)}
          subtitle={`${plans.length} тариф(ов)`}
          icon="people"
          gradientColors={[colors.orange[500], colors.orange[600]]}
        />
      </View>

      {/* Recent tenants */}
      <AnimatedCard
        index={4}
        style={[styles.sectionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeader}>
          <Ionicons name="time-outline" size={18} color={palette.text.secondary} />
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Последние клиенты</Text>
        </View>
        {tenants.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={40} color={colors.gray[300]} />
            <Text style={styles.emptyText}>Нет клиентов</Text>
          </View>
        ) : (
          tenants
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5)
            .map((tenant) => {
              const status = getSubscriptionStatusColor(tenant);
              return (
                <View key={tenant.id} style={[styles.recentTenantRow, { borderTopColor: palette.border.subtle }]}>
                  <View style={styles.tenantAvatar}>
                    <Text style={styles.tenantAvatarText}>
                      {tenant.name?.charAt(0)?.toUpperCase() || 'T'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.recentTenantName, { color: palette.text.primary }]} numberOfLines={1}>
                      {tenant.name}
                    </Text>
                    <Text style={[styles.recentTenantDate, { color: palette.text.tertiary }]}>
                      {formatDate(tenant.createdAt)}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                  </View>
                </View>
              );
            })
        )}
      </AnimatedCard>

      {/* Plan distribution */}
      {plans.length > 0 && (
        <AnimatedCard
          index={5}
          style={[styles.sectionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="pie-chart-outline" size={18} color={palette.text.secondary} />
            <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Распределение по тарифам</Text>
          </View>
          {plans.map((plan) => {
            const count = tenants.filter(t => t.planId === plan.id).length;
            const pct = tenants.length > 0 ? Math.round((count / tenants.length) * 100) : 0;
            return (
              <View key={plan.id} style={styles.planDistRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.planDistHeader}>
                    <Text style={[styles.planDistName, { color: palette.text.primary }]}>{plan.name}</Text>
                    <Text style={[styles.planDistCount, { color: palette.text.tertiary }]}>{count} клиент(ов)</Text>
                  </View>
                  <View style={[styles.progressBarBg, { backgroundColor: palette.bg.muted }]}>
                    <View style={[styles.progressBarFill, { width: `${pct}%` }]} />
                  </View>
                </View>
                <Text style={styles.planDistPct}>{pct}%</Text>
              </View>
            );
          })}
        </AnimatedCard>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tenant Detail Expandable
// ═══════════════════════════════════════════════════════════════════════════════

function TenantDetailCard({
  tenant, plans, onToggleActive, onChangePlan, togglingId, changingPlanId,
}: {
  tenant: Tenant;
  plans: Plan[];
  onToggleActive: (t: Tenant) => void;
  onChangePlan: (t: Tenant, planId: string) => void;
  togglingId: string | null;
  changingPlanId: string | null;
}) {
  const palette = useColors();
  const [expanded, setExpanded] = useState(false);
  const status = getSubscriptionStatusColor(tenant);
  const planName = tenant.plan?.name || plans.find(p => p.id === tenant.planId)?.name || 'Не назначен';

  return (
    <AnimatedCard
      index={0}
      style={[styles.tenantCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <TouchableOpacity
        style={styles.tenantCardHeader}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.tenantAvatar}>
          <Text style={styles.tenantAvatarText}>
            {tenant.name?.charAt(0)?.toUpperCase() || 'T'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tenantName, { color: palette.text.primary }]} numberOfLines={1}>{tenant.name}</Text>
          <View style={styles.tenantMeta}>
            <Text style={[styles.tenantPlan, { color: palette.text.secondary }]}>{planName}</Text>
            <Text style={styles.metaDot}>{'\u00B7'}</Text>
            <Text style={[styles.tenantUsers, { color: palette.text.tertiary }]}>
              {tenant.userCount ?? tenant.users?.length ?? 0} польз.
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.gray[400]}
          style={{ marginLeft: spacing[2] }}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.tenantDetailBody}>
          <View style={[styles.detailDivider, { backgroundColor: palette.border.subtle }]} />

          {/* Info rows */}
          <View style={styles.detailGrid}>
            <DetailRow icon="business-outline" label="Компания" value={tenant.name} />
            {tenant.phone && <DetailRow icon="call-outline" label="Телефон" value={tenant.phone} />}
            {tenant.email && <DetailRow icon="mail-outline" label="Email" value={tenant.email} />}
            {tenant.address && <DetailRow icon="location-outline" label="Адрес" value={tenant.address} />}
            <DetailRow icon="calendar-outline" label="Создан" value={formatFullDate(tenant.createdAt)} />
          </View>

          {/* Subscription info */}
          <View style={styles.detailSection}>
            <Text style={[styles.detailSectionTitle, { color: palette.text.secondary }]}>Подписка</Text>
            <View style={[styles.detailInfoCard, { backgroundColor: palette.bg.muted }]}>
              <View style={styles.detailInfoRow}>
                <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>Тариф</Text>
                <Text style={[styles.detailInfoValue, { color: palette.text.primary }]}>{planName}</Text>
              </View>
              <View style={styles.detailInfoRow}>
                <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>Стоимость</Text>
                <Text style={[styles.detailInfoValue, { color: palette.text.primary }]}>{formatMoney(tenant.monthlyPrice)}/мес</Text>
              </View>
              <View style={styles.detailInfoRow}>
                <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>Оплачено до</Text>
                <Text style={[
                  styles.detailInfoValue,
                  { color: palette.text.primary },
                  isExpired(tenant.subscriptionEnd) && { color: colors.red[600] },
                ]}>
                  {tenant.subscriptionEnd ? formatFullDate(tenant.subscriptionEnd) : 'Не указано'}
                </Text>
              </View>
              <View style={styles.detailInfoRow}>
                <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>Макс. польз.</Text>
                <Text style={[styles.detailInfoValue, { color: palette.text.primary }]}>{tenant.maxUsers}</Text>
              </View>
            </View>
          </View>

          {/* Legal details */}
          {(tenant.inn || tenant.legalName) && (
            <View style={styles.detailSection}>
              <Text style={[styles.detailSectionTitle, { color: palette.text.secondary }]}>Юр. данные</Text>
              <View style={[styles.detailInfoCard, { backgroundColor: palette.bg.muted }]}>
                {tenant.legalName && (
                  <View style={styles.detailInfoRow}>
                    <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>Юр. имя</Text>
                    <Text style={[styles.detailInfoValue, { color: palette.text.primary }]}>{tenant.legalName}</Text>
                  </View>
                )}
                {tenant.inn && (
                  <View style={styles.detailInfoRow}>
                    <Text style={[styles.detailInfoLabel, { color: palette.text.secondary }]}>ИНН</Text>
                    <Text style={[styles.detailInfoValue, { color: palette.text.primary }]}>{tenant.inn}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Notes */}
          {tenant.subscriptionNote && (
            <View style={styles.noteBlock}>
              <Ionicons name="information-circle-outline" size={16} color={colors.blue[500]} />
              <Text style={styles.noteText}>{tenant.subscriptionNote}</Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                tenant.isActive ? styles.actionBtnDanger : styles.actionBtnSuccess,
              ]}
              onPress={() => onToggleActive(tenant)}
              disabled={togglingId === tenant.id}
              activeOpacity={0.7}
            >
              {togglingId === tenant.id ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons
                    name={tenant.isActive ? 'pause-circle-outline' : 'play-circle-outline'}
                    size={16}
                    color={colors.white}
                  />
                  <Text style={styles.actionBtnText}>
                    {tenant.isActive ? 'Отключить' : 'Активировать'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => {
                const planOptions = plans.filter(p => p.id !== tenant.planId);
                if (planOptions.length === 0) {
                  Alert.alert('Нет доступных тарифов', 'Все тарифы уже назначены или отсутствуют.');
                  return;
                }
                Alert.alert(
                  'Сменить тариф',
                  `Выберите тариф для "${tenant.name}"`,
                  [
                    ...planOptions.map(p => ({
                      text: `${p.name} (${formatMoney(p.monthlyPrice)}/мес)`,
                      onPress: () => onChangePlan(tenant, p.id),
                    })),
                    { text: 'Отмена', style: 'cancel' as const },
                  ],
                );
              }}
              disabled={changingPlanId === tenant.id}
              activeOpacity={0.7}
            >
              {changingPlanId === tenant.id ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="swap-horizontal-outline" size={16} color={colors.white} />
                  <Text style={styles.actionBtnText}>Сменить тариф</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </AnimatedCard>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const palette = useColors();
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={palette.text.tertiary} />
      <Text style={[styles.detailLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: palette.text.primary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tenants Tab
// ═══════════════════════════════════════════════════════════════════════════════

function TenantsTab({
  tenants, plans, onToggleActive, onChangePlan, togglingId, changingPlanId,
}: {
  tenants: Tenant[];
  plans: Plan[];
  onToggleActive: (t: Tenant) => void;
  onChangePlan: (t: Tenant, planId: string) => void;
  togglingId: string | null;
  changingPlanId: string | null;
}) {
  const palette = useColors();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'expired'>('all');

  const filtered = useMemo(() => {
    let list = tenants;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.phone?.toLowerCase().includes(q) ||
        t.email?.toLowerCase().includes(q),
      );
    }
    switch (filterStatus) {
      case 'active':
        list = list.filter(t => t.isActive && !isExpired(t.subscriptionEnd));
        break;
      case 'inactive':
        list = list.filter(t => !t.isActive);
        break;
      case 'expired':
        list = list.filter(t => t.isActive && isExpired(t.subscriptionEnd));
        break;
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tenants, search, filterStatus]);

  const statusFilters: { key: typeof filterStatus; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'active', label: 'Активные' },
    { key: 'expired', label: 'Просрочены' },
    { key: 'inactive', label: 'Отключены' },
  ];

  return (
    <View style={styles.tabContent}>
      {/* Search */}
      <AnimatedCard
        index={0}
        style={[styles.searchCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color={palette.text.tertiary} />
          <TextInput
            style={[styles.searchInput, { color: palette.text.primary }]}
            placeholder="Поиск по названию, телефону..."
            placeholderTextColor={palette.text.tertiary}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      </AnimatedCard>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filtersContent}>
        {statusFilters.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterChip,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              filterStatus === f.key && styles.filterChipActive,
            ]}
            onPress={() => setFilterStatus(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.filterChipText,
              { color: palette.text.secondary },
              filterStatus === f.key && styles.filterChipTextActive,
            ]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count */}
      <Text style={[styles.resultsCount, { color: palette.text.tertiary }]}>
        {filtered.length} из {tenants.length} клиент(ов)
      </Text>

      {/* Tenants list */}
      {filtered.length === 0 ? (
        <AnimatedCard
          index={1}
          style={[styles.emptyCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="search-outline" size={48} color={palette.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Ничего не найдено</Text>
          <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>Попробуйте изменить параметры поиска</Text>
        </AnimatedCard>
      ) : (
        filtered.map((tenant) => (
          <TenantDetailCard
            key={tenant.id}
            tenant={tenant}
            plans={plans}
            onToggleActive={onToggleActive}
            onChangePlan={onChangePlan}
            togglingId={togglingId}
            changingPlanId={changingPlanId}
          />
        ))
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Plans Tab
// ═══════════════════════════════════════════════════════════════════════════════

function PlansTab({ plans, tenants }: { plans: Plan[]; tenants: Tenant[] }) {
  const palette = useColors();
  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder),
    [plans],
  );

  if (plans.length === 0) {
    return (
      <View style={styles.tabContent}>
        <AnimatedCard
          index={0}
          style={[styles.emptyCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="pricetags-outline" size={48} color={palette.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Нет тарифов</Text>
          <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>Тарифные планы ещё не созданы</Text>
        </AnimatedCard>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      {sortedPlans.map((plan, idx) => {
        const subscriberCount = tenants.filter(t => t.planId === plan.id).length;
        const features: string[] = Array.isArray(plan.features) ? plan.features : [];
        const isPopular = subscriberCount === Math.max(...plans.map(p => tenants.filter(t => t.planId === p.id).length));
        return (
          <AnimatedCard
            key={plan.id}
            index={idx}
            style={[styles.planCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            {isPopular && subscriberCount > 0 && (
              <LinearGradient
                colors={[colors.primary[500], colors.primary[600]]}
                style={styles.popularBanner}
              >
                <Ionicons name="star" size={12} color={colors.white} />
                <Text style={styles.popularBannerText}>Популярный</Text>
              </LinearGradient>
            )}
            <View style={styles.planCardBody}>
              <View style={styles.planCardHeaderRow}>
                <View>
                  <Text style={[styles.planCardName, { color: palette.text.primary }]}>{plan.name}</Text>
                  {plan.description && (
                    <Text style={[styles.planCardDesc, { color: palette.text.secondary }]}>{plan.description}</Text>
                  )}
                </View>
                <View style={[
                  styles.planActiveBadge,
                  { backgroundColor: plan.isActive ? colors.green[50] : colors.gray[100] },
                ]}>
                  <View style={[
                    styles.planActiveDot,
                    { backgroundColor: plan.isActive ? colors.green[500] : colors.gray[400] },
                  ]} />
                  <Text style={[
                    styles.planActiveText,
                    { color: plan.isActive ? colors.green[700] : colors.gray[500] },
                  ]}>
                    {plan.isActive ? 'Активен' : 'Отключён'}
                  </Text>
                </View>
              </View>

              {/* Price */}
              <View style={styles.planPriceBlock}>
                <Text style={[styles.planPriceValue, { color: palette.text.primary }]}>
                  {plan.monthlyPrice.toLocaleString('ru-RU')}
                </Text>
                <Text style={[styles.planPriceSuffix, { color: palette.text.secondary }]}> \u20BD/мес</Text>
              </View>

              {/* Stats */}
              <View style={styles.planStatsRow}>
                <View style={[styles.planStatItem, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="people" size={14} color={colors.primary[600]} />
                  <Text style={[styles.planStatText, { color: palette.text.primary }]}>До {plan.maxUsers} польз.</Text>
                </View>
                <View style={[styles.planStatItem, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="business" size={14} color={colors.purple[700]} />
                  <Text style={[styles.planStatText, { color: palette.text.primary }]}>{subscriberCount} подписчик(ов)</Text>
                </View>
              </View>

              {/* Features */}
              <View style={[styles.planFeaturesList, { borderTopColor: palette.border.subtle }]}>
                {ALL_FEATURES.map(feat => {
                  const included = features.includes(feat.key);
                  return (
                    <View key={feat.key} style={styles.planFeatureRow}>
                      <Ionicons
                        name={included ? 'checkmark-circle' : 'close-circle'}
                        size={16}
                        color={included ? colors.green[500] : palette.text.tertiary}
                      />
                      <Text style={[
                        styles.planFeatureText,
                        { color: palette.text.primary },
                        !included && [styles.planFeatureTextDisabled, { color: palette.text.tertiary }],
                      ]}>
                        {feat.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </AnimatedCard>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main Screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);

  // ── Queries ──
  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => { const res = await tenantsApi.getAll(); return res.data; },
  });

  const { data: stats } = useQuery<PlatformStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => { const res = await tenantsApi.getStats(); return res.data; },
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => { const res = await plansApi.getAll(); return res.data; },
  });

  const isLoading = tenantsLoading || plansLoading;

  // ── Mutations ──
  const toggleActiveMutation = useMutation({
    mutationFn: async (tenant: Tenant) => {
      setTogglingId(tenant.id);
      await tenantsApi.update(tenant.id, { isActive: !tenant.isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => {
      Alert.alert('Ошибка', 'Не удалось обновить статус клиента');
    },
    onSettled: () => setTogglingId(null),
  });

  const changePlanMutation = useMutation({
    mutationFn: async ({ tenantId, planId }: { tenantId: string; planId: string }) => {
      setChangingPlanId(tenantId);
      const plan = plans.find(p => p.id === planId);
      await tenantsApi.update(tenantId, {
        planId,
        monthlyPrice: plan?.monthlyPrice,
        maxUsers: plan?.maxUsers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: () => {
      Alert.alert('Ошибка', 'Не удалось сменить тариф');
    },
    onSettled: () => setChangingPlanId(null),
  });

  const handleToggleActive = useCallback((tenant: Tenant) => {
    Alert.alert(
      tenant.isActive ? 'Отключить клиента?' : 'Активировать клиента?',
      `${tenant.name} будет ${tenant.isActive ? 'отключён' : 'активирован'}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: tenant.isActive ? 'Отключить' : 'Активировать',
          style: tenant.isActive ? 'destructive' : 'default',
          onPress: () => toggleActiveMutation.mutate(tenant),
        },
      ],
    );
  }, [toggleActiveMutation]);

  const handleChangePlan = useCallback((tenant: Tenant, planId: string) => {
    changePlanMutation.mutate({ tenantId: tenant.id, planId });
  }, [changePlanMutation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] }),
    ]);
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Админ-панель" onBack={() => navigation.goBack()} />

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? colors.primary[600] : palette.text.tertiary}
            />
            <Text style={[
              styles.tabText,
              { color: palette.text.tertiary },
              activeTab === tab.key && styles.tabTextActive,
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary[600]} />
          <Text style={[styles.loadingText, { color: palette.text.tertiary }]}>Загрузка данных...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[600]}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'overview' && (
            <OverviewTab stats={stats} tenants={tenants} plans={plans} />
          )}
          {activeTab === 'tenants' && (
            <TenantsTab
              tenants={tenants}
              plans={plans}
              onToggleActive={handleToggleActive}
              onChangePlan={handleChangePlan}
              togglingId={togglingId}
              changingPlanId={changingPlanId}
            />
          )}
          {activeTab === 'plans' && (
            <PlansTab plans={plans} tenants={tenants} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: colors.primary[50],
  },
  tabText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[400],
  },
  tabTextActive: {
    color: colors.primary[600],
    fontWeight: fontWeight.semibold,
  },
  // Loading
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  loadingText: {
    fontSize: fontSize.sm,
    color: colors.gray[400],
  },
  // Scroll
  scrollContent: {
    paddingBottom: spacing[12],
  },
  tabContent: {
    padding: spacing[4],
    gap: spacing[3],
  },
  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  statCard: {
    width: '47.5%' as any,
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  statGradient: {
    padding: spacing[4],
    minHeight: 130,
    justifyContent: 'flex-end',
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  statValue: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  statTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  statSubtitle: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  // Section card
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    gap: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  // Recent tenant row
  recentTenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.gray[50],
  },
  tenantAvatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  tenantAvatarText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.primary[700],
  },
  recentTenantName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  recentTenantDate: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },
  // Status badge
  statusBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  // Plan distribution
  planDistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  planDistHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  planDistName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[800],
  },
  planDistCount: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  planDistPct: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primary[600],
    width: 36,
    textAlign: 'right',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary[500],
    borderRadius: borderRadius.full,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.gray[400],
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[8],
    alignItems: 'center',
    gap: spacing[2],
  },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[700],
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.gray[400],
    textAlign: 'center',
  },
  // Search
  searchCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.gray[900],
    paddingVertical: spacing[3],
  },
  // Filters
  filtersScroll: {
    flexGrow: 0,
  },
  filtersContent: {
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  filterChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  filterChipActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[300],
  },
  filterChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  filterChipTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },
  resultsCount: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: spacing[1],
  },
  // Tenant card
  tenantCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tenantCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    gap: spacing[3],
  },
  tenantName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  tenantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: 2,
  },
  tenantPlan: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
  },
  metaDot: {
    fontSize: fontSize.xs,
    color: colors.gray[300],
  },
  tenantUsers: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  // Tenant detail body
  tenantDetailBody: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
    gap: spacing[3],
  },
  detailDivider: {
    height: 1,
    backgroundColor: colors.gray[100],
  },
  detailGrid: {
    gap: spacing[2],
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  detailLabel: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    width: 80,
  },
  detailValue: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[800],
  },
  detailSection: {
    gap: spacing[2],
  },
  detailSectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[700],
  },
  detailInfoCard: {
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    gap: spacing[2],
  },
  detailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailInfoLabel: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
  },
  detailInfoValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  // Note
  noteBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.blue[50],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
  },
  noteText: {
    fontSize: fontSize.xs,
    color: colors.blue[600],
    flex: 1,
  },
  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  actionBtnDanger: {
    backgroundColor: colors.red[500],
  },
  actionBtnSuccess: {
    backgroundColor: colors.green[500],
  },
  actionBtnPrimary: {
    backgroundColor: colors.primary[600],
  },
  actionBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  // Plan cards
  planCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  popularBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[1.5],
  },
  popularBannerText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  planCardBody: {
    padding: spacing[5],
    gap: spacing[3],
  },
  planCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planCardName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  planCardDesc: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    marginTop: 2,
  },
  planActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  planActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  planActiveText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  planPriceBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planPriceValue: {
    fontSize: 32,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  planPriceSuffix: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
  },
  planStatsRow: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  planStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.gray[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
  },
  planStatText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
  },
  planFeaturesList: {
    gap: spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    paddingTop: spacing[3],
  },
  planFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  planFeatureText: {
    fontSize: fontSize.sm,
    color: colors.gray[700],
  },
  planFeatureTextDisabled: {
    color: colors.gray[400],
    textDecorationLine: 'line-through',
  },
});
