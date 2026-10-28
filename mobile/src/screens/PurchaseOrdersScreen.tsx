import { headerTouchSize, HeaderIsland, HeaderAction } from '../components/ScreenHeaderControls';
import { ScreenSectionScrollView, ScreenSectionFlashList } from '../components/ScreenSectionScrollable';
import ScreenSectionHeader, {
  type ScreenSectionScrollController,
  useScreenSectionScroll,
} from '../components/ScreenSectionHeader';

import { useRoute, type RouteProp, useFocusEffect, useNavigation } from '@react-navigation/native';
/**
 * PurchaseOrdersScreen — «Заказы поставщикам».
 *
 * Список заказов поставщикам с фильтром по статусу (Все / Черновик / Заказан /
 * Получен / Отменён) и по поставщику. Каждая строка: поставщик, число позиций,
 * сумма, бейдж статуса, дата. «+» в шапке открывает создание (только для
 * director/admin/superadmin — права на запись; сервер дублирует проверку).
 *
 * Reliability pattern (как в Журнале / Записях): data === undefined → скелетон;
 * isError && data === undefined → QueryErrorState «Повторить»; есть данные —
 * рендерим сразу даже во время фонового рефетча (SWR). Ключ ['purchase-orders',
 * {status, supplierId}] в persistent-cache whitelist → мгновенный cold start.
 *
 * Android-safe: FlashList + RefreshControl + inline-dropdown (без iOS-only API).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, Platform, Pressable } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { buildShadow } from '../platform/iosSurface';
import { purchaseOrdersApi, suppliersApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { colors, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { type PurchaseOrder, type PurchaseOrderStatus, type Supplier } from '../../../shared/types';
import {
  PO_STATUS_META,
  PO_STATUS_ORDER,
  getPoStatusMeta,
  formatMoney,
  formatPoDate,
  type PoStatusMeta,
} from './purchaseOrders/purchaseOrderHelpers';
import { TabBarScrollView as ScrollView } from '../components/TabBarScrollable';

type StatusFilter = 'all' | PurchaseOrderStatus;

// ── Row ───────────────────────────────────────────────────────────────────
interface RowProps {
  item: PurchaseOrder;
  onPress: (po: PurchaseOrder) => void;
  /** Theme-resolved status chip/icon colours — passed in so the memoised row
   *  stays subscription-free and reads the dark badge palette in dark mode. */
  meta: PoStatusMeta;
  cardBg: string;
  separatorColor: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  mutedBg: string;
}
const PurchaseOrderRow = React.memo(function PurchaseOrderRow({
  item,
  onPress,
  meta,
  cardBg,
  separatorColor,
  textPrimary,
  textSecondary,
  textTertiary,
  mutedBg,
}: RowProps) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: cardBg, borderBottomColor: separatorColor },
        pressed && { backgroundColor: mutedBg },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={18} color={meta.text} />
      </View>
      <View style={styles.rowInfo}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowSupplier, { color: textPrimary }]} numberOfLines={1}>
            {item.supplierName || 'Поставщик'}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusChipText, { color: meta.text }]}>{meta.label}</Text>
          </View>
        </View>
        <View style={styles.rowMeta}>
          <Ionicons name="cube-outline" size={12} color={textTertiary} />
          <Text style={[styles.rowMetaText, { color: textSecondary }]} numberOfLines={1}>
            {item.itemCount ?? 0} {'поз.'}
          </Text>
          <Text style={[styles.rowDot, { color: textTertiary }]}>·</Text>
          {/* У проведённой поставки ведущая дата — ДАТА ПОСТАВКИ (159), она
              может быть выбрана задним числом; у остальных — дата создания. */}
          <Text style={[styles.rowMetaText, { color: textTertiary }]} numberOfLines={1}>
            {formatPoDate(item.status === 'received' && item.receivedAt ? item.receivedAt : item.createdAt)}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowTotal, { color: textPrimary }]} numberOfLines={1}>
          {formatMoney(item.total)}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={textTertiary} />
      </View>
    </Pressable>
  );
});

/**
 * `embedded` — rendered INSIDE the «Поставщики» section (SuppliersScreen's
 * «Заказы» segment) instead of as a standalone route. In that mode the screen
 * drops its own IosScreenHeader (the host screen owns the title + the «+»
 * create action) and just renders the filter chips + list. When NOT embedded
 * it's the self-contained route still registered in MoreStack (reachable from
 * SuppliersScreen / SupplierDetailScreen).
 */
export default function PurchaseOrdersScreen({
  embedded = false,
  sectionController,
  sectionHeader,
}: {
  embedded?: boolean;
  sectionController?: ScreenSectionScrollController;
  sectionHeader?: (controls: React.ReactNode, actions?: React.ReactNode) => React.ReactNode;
} = {}) {
  const ownSection = useScreenSectionScroll();
  const section = sectionController ?? ownSection;
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  // Заказы поставщикам / приёмка — ключ suppliers_manage (сервер: мутации
  // purchase-orders → тот же ключ; admin живёт по матрице из /auth/me).
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('suppliers_manage');

  const route = useRoute<RouteProp<{ Filters: { status?: StatusFilter } }, 'Filters'>>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(route.params?.status ?? 'all');
  React.useEffect(() => {
    if (route.params?.status) {
      setStatusFilter(route.params.status);
      navigation.setParams({ status: undefined });
    }
  }, [route.params?.status, navigation]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Suppliers — for the supplier filter dropdown. Exclude the pinned system
  // supplier (Б/У channel) — you never place a purchase order against it.
  const { data: suppliersRaw } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await suppliersApi.getAll()).data.data,
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = useMemo(
    () => (suppliersRaw || []).filter((s) => !s.isSystem && s.kind !== 'used_purchase'),
    [suppliersRaw],
  );
  const selectedSupplierName = supplierId ? suppliers.find((s) => s.id === supplierId)?.name : null;

  const {
    data: orders,
    isLoading,
    isError,
    refetch,
  } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', { status: statusFilter, supplierId }],
    queryFn: async () => {
      const params: { status?: PurchaseOrderStatus; supplierId?: string; limit: number } = { limit: 100 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (supplierId) params.supplierId = supplierId;
      const res = await purchaseOrdersApi.list(params);
      return res.data.data;
    },
    // SWR — держим прошлый список при смене фильтра, без «пустого кадра».
    placeholderData: (prev) => prev,
  });

  // Возврат из создания/детали (где статус мог измениться) — освежаем список.
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    }, [queryClient]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    setRefreshing(false);
  }, [queryClient]);

  const openCreate = useCallback(() => {
    haptic('tap');
    navigation.navigate('PurchaseOrderCreate');
  }, [navigation]);

  const openDetail = useCallback(
    (po: PurchaseOrder) => {
      navigation.navigate('PurchaseOrderDetail', { id: po.id, po });
    },
    [navigation],
  );

  // Theme-resolved status palette — light returns the web-matched pale chips,
  // dark the translucent badge fills. Memoised per mode so memoised rows see a
  // stable `meta` reference and don't re-render on unrelated parent updates.
  const statusMeta = useMemo(() => getPoStatusMeta(palette.mode), [palette.mode]);

  const renderItem = useCallback(
    ({ item }: { item: PurchaseOrder }) => (
      <PurchaseOrderRow
        item={item}
        onPress={openDetail}
        meta={statusMeta[item.status]}
        cardBg={palette.bg.card}
        separatorColor={palette.border.subtle}
        textPrimary={palette.text.primary}
        textSecondary={palette.text.secondary}
        textTertiary={palette.text.tertiary}
        mutedBg={palette.bg.muted}
      />
    ),
    [
      openDetail,
      statusMeta,
      palette.bg.card,
      palette.bg.muted,
      palette.border.subtle,
      palette.text.primary,
      palette.text.secondary,
      palette.text.tertiary,
    ],
  );

  const list = orders ?? [];

  const sectionControls = (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.chipsScroll, { flexGrow: 0, flexShrink: 0 }]}
        contentContainerStyle={[styles.chipsRow, embedded && styles.chipsRowEmbedded]}
        keyboardShouldPersistTaps="handled"
      >
        {(['all', ...PO_STATUS_ORDER] as StatusFilter[]).map((s) => {
          const active = statusFilter === s;
          const label = s === 'all' ? 'Все' : PO_STATUS_META[s].label;
          return (
            <TouchableOpacity
              key={s}
              onPress={() => {
                if (s === statusFilter) return;
                haptic('select');
                setStatusFilter(s);
              }}
              activeOpacity={0.7}
              style={[
                [
                  styles.chip,
                  active
                    ? { backgroundColor: colors.primary[600], borderColor: colors.primary[600] }
                    : { backgroundColor: 'transparent', borderColor: palette.border.strong },
                ],
                { minWidth: headerTouchSize, minHeight: headerTouchSize },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? colors.white : palette.text.secondary }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={styles.supplierFilterWrap}>
        <TouchableOpacity
          style={[
            [styles.supplierFilterBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }],
            { minWidth: headerTouchSize, minHeight: headerTouchSize },
          ]}
          onPress={() => {
            haptic('tap');
            setShowSupplierDropdown((v) => !v);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="business-outline" size={15} color={palette.text.secondary} />
          <Text style={[styles.supplierFilterText, { color: palette.text.primary }]} numberOfLines={1}>
            {selectedSupplierName || 'Все поставщики'}
          </Text>
          {supplierId ? (
            <TouchableOpacity
              style={{ minWidth: headerTouchSize, minHeight: headerTouchSize }}
              hitSlop={8}
              onPress={() => {
                haptic('tap');
                setSupplierId(null);
                setShowSupplierDropdown(false);
              }}
            >
              <Ionicons name="close-circle" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          ) : (
            <Ionicons
              name={showSupplierDropdown ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={palette.text.tertiary}
            />
          )}
        </TouchableOpacity>

        {showSupplierDropdown ? (
          <View
            style={[
              styles.dropdown,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              buildShadow(palette, 'elevated'),
            ]}
          >
            <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <TouchableOpacity
                style={[
                  [styles.dropdownRow, { borderBottomColor: palette.border.subtle }],
                  { minWidth: headerTouchSize, minHeight: headerTouchSize },
                ]}
                onPress={() => {
                  haptic('select');
                  setSupplierId(null);
                  setShowSupplierDropdown(false);
                }}
              >
                <Text style={[styles.dropdownText, { color: palette.text.primary }]}>Все поставщики</Text>
                {!supplierId ? <Ionicons name="checkmark" size={18} color={colors.primary[600]} /> : null}
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    [styles.dropdownRow, { borderBottomColor: palette.border.subtle }],
                    { minWidth: headerTouchSize, minHeight: headerTouchSize },
                  ]}
                  onPress={() => {
                    haptic('select');
                    setSupplierId(s.id);
                    setShowSupplierDropdown(false);
                  }}
                >
                  <Text style={[styles.dropdownText, { color: palette.text.primary }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  {supplierId === s.id ? <Ionicons name="checkmark" size={18} color={colors.primary[600]} /> : null}
                </TouchableOpacity>
              ))}
              {suppliers.length === 0 ? (
                <Text style={[styles.dropdownEmpty, { color: palette.text.tertiary }]}>Нет поставщиков</Text>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </>
  );

  // Reset only when React replaces this screen's native root scroller.
  const sectionRootKind = orders === undefined || (list.length === 0 && !isLoading) ? 'state-scroll' : 'order-list';
  const previousSectionRootKind = React.useRef(sectionRootKind);
  React.useEffect(() => {
    if (previousSectionRootKind.current !== sectionRootKind) {
      previousSectionRootKind.current = sectionRootKind;
      section.reset();
    }
  }, [sectionRootKind, section.reset]);

  return (
    <View style={[styles.safe, embedded ? null : { backgroundColor: palette.bg.canvas }]}>
      {sectionHeader ? (
        sectionHeader(sectionControls)
      ) : (
        <ScreenSectionHeader scroll={section} title="Заказы поставщикам">
          <HeaderIsland layout="column">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <HeaderAction label="Назад" icon="chevron-back" onPress={() => navigation.goBack()} />
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {canWrite ? (
                  <TouchableOpacity
                    style={[styles.addBtn, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                    onPress={openCreate}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Новый заказ поставщику"
                  >
                    <Ionicons name="add" size={18} color={colors.white} />
                  </TouchableOpacity>
                ) : undefined}
              </View>
            </View>
            {sectionControls}
          </HeaderIsland>
        </ScreenSectionHeader>
      )}

      {/* ── Status filter chips ── */}

      {/* ── Supplier filter ── */}

      {/* ── Body ── */}
      {isError && orders === undefined ? (
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          contentInsetAdjustmentBehavior="never"
          scrollEventThrottle={16}
          contentContainerStyle={[styles.centerWrap, { paddingTop: section.contentTop }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          <QueryErrorState
            title="Не удалось загрузить заказы"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        </ScreenSectionScrollView>
      ) : orders === undefined ? (
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
        >
          <ListSkeleton count={6} />
        </ScreenSectionScrollView>
      ) : list.length === 0 && !isLoading ? (
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          contentInsetAdjustmentBehavior="never"
          scrollEventThrottle={16}
          contentContainerStyle={[styles.centerWrap, { paddingTop: section.contentTop }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          <EmptyState
            icon="truck"
            title={statusFilter === 'all' && !supplierId ? 'Нет заказов поставщикам' : 'Ничего не найдено'}
            description={
              statusFilter === 'all' && !supplierId
                ? 'Создайте заказ, чтобы пополнить склад и принять товар на приход'
                : 'Измените фильтр статуса или поставщика'
            }
            action={
              canWrite && statusFilter === 'all' && !supplierId
                ? { label: 'Новый заказ', onPress: openCreate }
                : undefined
            }
          />
        </ScreenSectionScrollView>
      ) : (
        <ScreenSectionFlashList
          onScroll={section.onScroll}
          contentInsetAdjustmentBehavior="never"
          scrollEventThrottle={16}
          data={list}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={[
            Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : undefined,
            { paddingTop: section.contentTop },
          ]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
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
  addBtn: {
    backgroundColor: colors.primary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Chip-row vertical bug fix ──────────────────────────────────────────
  // Корень бага «половина экрана пустоты вокруг чипов»: горизонтальный
  // ScrollView — прямой child flex:1-колонки (styles.safe). Без flexGrow:0
  // колонка растягивает его по вертикали, а contentContainer alignItems:
  // 'center' центрирует низкие чипы в середине высокой пустой полосы. То же
  // лечение задокументировано в ChecksScreen.kindChipsScroll: flexGrow/
  // flexShrink:0 + alignSelf:'flex-start' заставляют полосу обнимать высоту
  // контента, и список идёт сразу под ней.
  chipsScroll: { flexGrow: 0, flexShrink: 0, alignSelf: 'flex-start' },
  // Status chips — compact, refined pills (iOS-style). Inactive pills are
  // transparent with a hairline outline (not heavy grey blocks); the active
  // pill is a solid primary fill. Tight height + 12.5px label keep the row
  // from reading as a stack of buttons.
  chipsRow: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, gap: spacing[1.5], alignItems: 'center' },
  // Inside the «Поставщики» section the segmented control already provides the
  // top breathing room, so trim the chip-row's top padding there.
  chipsRowEmbedded: { paddingTop: 0 },
  chip: {
    paddingHorizontal: spacing[3],
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: headerTouchSize,
  },
  chipText: { fontSize: 12.5, fontWeight: '600', letterSpacing: -0.1 },

  // Supplier filter — slimmed to match the compact chip rhythm above.
  supplierFilterWrap: { paddingHorizontal: 0, paddingBottom: 0, zIndex: 10 },
  supplierFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  supplierFilterText: { flex: 1, fontSize: 13, fontWeight: '600' },
  dropdown: {
    marginTop: spacing[1.5],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    ...(Platform.OS === 'android' ? { elevation: 6 } : null),
  },
  dropdownScroll: { maxHeight: 260 },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownText: { flex: 1, fontSize: 15, fontWeight: '500' },
  dropdownEmpty: { fontSize: 13, padding: spacing[4], textAlign: 'center' },

  centerWrap: { flexGrow: 1, justifyContent: 'center' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowSupplier: { flexShrink: 1, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  statusChip: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  statusChipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], minWidth: 0 },
  rowMetaText: { fontSize: 12, flexShrink: 1 },
  rowDot: { fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: 2, flexDirection: 'row' },
  rowTotal: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
});
