/**
 * ReportsHubScreen — хаб раздела «Отчёты» (конструктор отчётов, 2026-09-25).
 *
 * Карточки отчётов из `REPORT_CATALOG` (shared/reports/catalog.ts —
 * единственный источник названий и описаний), сгруппированные по `group`.
 * Какие отчёты показывать, решает СЕРВЕР: GET /reports/builder/catalog отдаёт
 * `available/reason` по правам роли, owner-class и числу филиалов. Недоступные
 * скрыты; владельцу (director / superadmin) они показаны серым с причиной —
 * ему полезно знать, что «По филиалам» появится со вторым филиалом.
 *
 * Существующий «Финансовый отчёт» (ReportsScreen) остаётся отдельной первой
 * карточкой «Финансовый отчёт — подробно» → маршрут `FinancialReport`; из
 * старого экрана ничего не потеряно.
 *
 * Скорость: ['report-catalog'] в whitelist persistentCache + placeholderData —
 * хаб рисуется мгновенно на холодном старте, каталог обновляется фоном.
 * На pressIn карточки греем список фильтра отчёта (мастера/поставщики…),
 * чтобы шторка фильтра на следующем экране открывалась без спиннера.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IosScreenHeader from '../../components/IosScreenHeader';
import EmptyState from '../../components/EmptyState';
import QueryErrorState from '../../components/QueryErrorState';
import { SkeletonRow } from '../../components/Skeleton';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useIosSurface } from '../../platform/iosSurface';
import { reportBuilderApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { borderRadius, colors, softTint, spacing } from '../../theme';
import { extractApiErrorMessage } from '../../utils/apiError';
import {
  REPORT_CATALOG,
  REPORT_GROUP_LABELS,
  type ReportDefinition,
  type ReportGroup,
} from '../../../../shared/reports/catalog';
import type { ReportCatalogResponse, ReportId } from '../../../../shared/types';

export const REPORT_CATALOG_QUERY_KEY = ['report-catalog'] as const;

/** Иконка и акцент карточки по id отчёта — имена Ionicons, которые есть в шиме (lucide). */
export const REPORT_VISUALS: Record<ReportId, { icon: string; color: string }> = {
  summary: { icon: 'stats-chart-outline', color: colors.primary[600] },
  masters: { icon: 'people-outline', color: colors.indigo[600] },
  salary: { icon: 'wallet-outline', color: colors.green[600] },
  suppliers: { icon: 'cube-outline', color: colors.orange[600] },
  clients: { icon: 'person-outline', color: colors.teal[600] },
  products: { icon: 'pricetag-outline', color: colors.purple[600] },
  services: { icon: 'construct-outline', color: colors.blue[600] },
  payments: { icon: 'card-outline', color: colors.cyan[600] },
  expenses: { icon: 'trending-down-outline', color: colors.rose[600] },
  bookings: { icon: 'calendar-outline', color: colors.amber[600] },
  points: { icon: 'business-outline', color: colors.slate[600] },
};

const GROUP_ORDER: ReportGroup[] = ['summary', 'money', 'people', 'stock'];

interface HubEntry {
  def: ReportDefinition;
  available: boolean;
  reason?: string | null;
}

interface HubRowProps {
  icon: string;
  color: string;
  title: string;
  description: string;
  disabled?: boolean;
  last: boolean;
  onPress: () => void;
  onPressIn?: () => void;
}

function HubRow({ icon, color, title, description, disabled, last, onPress, onPressIn }: HubRowProps) {
  const palette = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, !last && [styles.rowDivider, { borderBottomColor: palette.border.subtle }]]}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      onPressIn={onPressIn}
      disabled={disabled}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.iconTile, { backgroundColor: disabled ? palette.bg.muted : softTint(color, palette.mode) }]}>
        <Ionicons name={icon as any} size={20} color={disabled ? palette.text.tertiary : color} />
      </View>
      <View style={styles.rowText}>
        <Text variant="bodyEmph" color={disabled ? palette.text.tertiary : palette.text.primary} numberOfLines={1}>
          {title}
        </Text>
        <Text
          variant="footnote"
          color={disabled ? (palette.mode === 'dark' ? colors.amber[200] : colors.amber[700]) : palette.text.secondary}
          numberOfLines={2}
        >
          {description}
        </Text>
      </View>
      {!disabled && <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />}
    </TouchableOpacity>
  );
}

export default function ReportsHubScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const isOwnerClass = user?.role === 'director' || user?.role === 'superadmin';
  const canFinancial = hasPermission('financial_reports');

  const catalogQuery = useQuery<ReportCatalogResponse>({
    queryKey: REPORT_CATALOG_QUERY_KEY,
    queryFn: async () => (await reportBuilderApi.catalog()).data,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  const groups = useMemo(() => {
    const byId = new Map<ReportId, { available: boolean; reason?: string | null }>();
    for (const r of catalogQuery.data?.reports ?? []) byId.set(r.id, { available: r.available, reason: r.reason });
    return GROUP_ORDER.map((group) => {
      const items: HubEntry[] = [];
      for (const def of REPORT_CATALOG) {
        if (def.group !== group) continue;
        const status = byId.get(def.id);
        if (!status) continue;
        if (status.available) items.push({ def, available: true });
        else if (isOwnerClass) items.push({ def, available: false, reason: status.reason });
      }
      return { group, label: REPORT_GROUP_LABELS[group], items };
    }).filter((g) => g.items.length > 0);
  }, [catalogQuery.data, isOwnerClass]);

  const openReport = useCallback(
    (def: ReportDefinition) => {
      navigation.navigate('ReportRun', { reportId: def.id });
    },
    [navigation],
  );

  const warmFilter = useCallback(
    (def: ReportDefinition) => {
      const kind = def.entityFilter?.kind;
      if (!kind) return;
      void queryClient.prefetchQuery({
        queryKey: ['report-filter-options', kind],
        queryFn: async () => (await reportBuilderApi.filterOptions(kind)).data,
        staleTime: 5 * 60_000,
      });
    },
    [queryClient],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await catalogQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [catalogQuery]);

  const loadingCold = catalogQuery.isLoading && !catalogQuery.data;
  const errorCold = catalogQuery.isError && !catalogQuery.data;
  const nothingAvailable = !!catalogQuery.data && groups.length === 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Отчёты" subtitle="Период, фильтры, экспорт в PDF" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          Platform.OS === 'android' ? { paddingBottom: tabBarHeight + spacing[4] } : null,
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {canFinancial && (
          <View style={styles.group}>
            <Text style={[surface.sectionLabel, styles.groupLabel]}>Финансы</Text>
            <View style={[surface.card, styles.card]}>
              <HubRow
                icon="bar-chart-outline"
                color={colors.purple[700]}
                title="Финансовый отчёт — подробно"
                description="Чистая прибыль, P&L, маржа, расходы по категориям, цели и прогноз"
                last
                onPress={() => navigation.navigate('FinancialReport')}
              />
            </View>
          </View>
        )}

        {loadingCold && (
          <View style={styles.group}>
            <Text style={[surface.sectionLabel, styles.groupLabel]}>Отчёты</Text>
            <View style={[surface.card, styles.card, styles.skeletonCard]}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          </View>
        )}

        {errorCold && (
          <QueryErrorState
            title="Не удалось загрузить список отчётов"
            description={extractApiErrorMessage(catalogQuery.error, 'Проверьте соединение и попробуйте ещё раз')}
            onRetry={() => catalogQuery.refetch()}
          />
        )}

        {nothingAvailable && !canFinancial && (
          <EmptyState
            icon="chart-bar"
            title="Нет доступных отчётов"
            description="Отчёты открываются правами роли: финансы, зарплата, поставщики, клиенты, склад, записи. Попросите владельца выдать нужный доступ."
          />
        )}

        {groups.map((g) => (
          <View key={g.group} style={styles.group}>
            <Text style={[surface.sectionLabel, styles.groupLabel]}>{g.label}</Text>
            <View style={[surface.card, styles.card]}>
              {g.items.map((entry, index) => {
                const visual = REPORT_VISUALS[entry.def.id];
                return (
                  <HubRow
                    key={entry.def.id}
                    icon={visual.icon}
                    color={visual.color}
                    title={entry.def.title}
                    description={entry.available ? entry.def.description : entry.reason || 'Недоступно'}
                    disabled={!entry.available}
                    last={index === g.items.length - 1}
                    onPress={() => openReport(entry.def)}
                    onPressIn={() => warmFilter(entry.def)}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[1],
    paddingBottom: spacing[4],
    gap: spacing[4],
  },
  group: { gap: spacing[1] },
  groupLabel: { marginLeft: spacing[1] },
  card: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  skeletonCard: { paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    minHeight: 64,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
});
