import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, Alert, ScrollView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
// entityLinks намеренно не импортируются здесь: тап по карточке журнала
// должен всегда вести в CheckDetail, а не на клиента/авто/мастера.
// Переходы на сущности живут внутри открытой деталки чека.
import { checksApi, usersApi, productsApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, PaginatedResponse, User, StockMovement, Delivery } from '../../../shared/types';

const paymentLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};
function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string) {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
}
function formatDateGroup(d: string) {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Сегодня';
  if (dt.toDateString() === yesterday.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const paymentStatusLabels: Record<string, string> = { paid: 'Оплачено', partial: 'Частично', unpaid: 'Не оплачено' };
const paymentStatusColors: Record<string, { bg: string; text: string }> = {
  paid: { bg: colors.green[50], text: colors.green[700] },
  partial: { bg: colors.amber[50], text: colors.amber[600] },
  unpaid: { bg: colors.red[50], text: colors.red[700] },
};

const movementTypeLabels: Record<string, string> = {
  inventory: 'Инвентаризация',
  writeoff: 'Списание',
  income: 'Приход',
  expense: 'Расход',
  // Новые типы (миграция 0XX_defect_used_returns). UI-имена согласованы с
  // веб-журналом и backend StockMovementType (shared/types).
  defect_transfer: 'Перенос в брак',
  used_transfer: 'Перенос в Б/У',
  defect_return_to_supplier: 'Возврат поставщику',
};

// Special label for `isUsedPurchase=true` rows — overrides the generic
// "Приход" label coming from movementTypeLabels.income.
const USED_PURCHASE_LABEL = 'Покупка Б/У';

const movementTypeIcons: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string; accentColor: string }> =
  {
    inventory: { name: 'clipboard-outline', color: colors.blue[600], accentColor: colors.blue[500] },
    writeoff: { name: 'trash-outline', color: colors.red[600], accentColor: colors.red[500] },
    income: { name: 'arrow-down-outline', color: colors.green[600], accentColor: colors.green[500] },
    expense: { name: 'arrow-up-outline', color: colors.orange[500], accentColor: colors.orange[500] },
    // Перенос в брак — янтарный (предупреждение, но не критический «трэш»),
    // икона щита-предостережения. amber[600] используется и для бордера —
    // в нашей палитре нет 500.
    defect_transfer: { name: 'warning-outline', color: colors.amber[600], accentColor: colors.amber[600] },
    // Перенос в Б/У — нейтральный swap, indigo чтоб отделить от прихода.
    // indigo тоже без 500 в палитре, оставляем 600 для accent.
    used_transfer: { name: 'swap-horizontal-outline', color: colors.indigo[600], accentColor: colors.indigo[600] },
    // Возврат поставщику — красный (товар физически уходит со склада),
    // стрелка возврата.
    defect_return_to_supplier: {
      name: 'arrow-undo-outline',
      color: colors.red[600],
      accentColor: colors.red[500],
    },
  };

// Дополнительная палитра для inbound used-purchase rows. Цвет cyan
// отличает её от обычного зелёного "Приход" — owner не путает покупку
// нового товара с покупкой б/у у клиента.
const USED_PURCHASE_ICON = {
  name: 'cube-outline' as keyof typeof Ionicons.glyphMap,
  color: colors.cyan[600],
  accentColor: colors.cyan[400],
};

// Outflow-движения — количество показываем со знаком «−» и красным цветом.
// inventory всегда нейтральный знак (это коррекция, а не приход/расход).
const NEGATIVE_MOVEMENT_TYPES = new Set<string>([
  'writeoff',
  'expense',
  'defect_transfer',
  'used_transfer',
  'defect_return_to_supplier',
]);

type ActiveTab = 'checks' | 'warehouse';

// Stable separator — module-level so FlashList doesn't get a new
// component identity each parent render (would force unnecessary
// separator unmounts/remounts between rows).
const ListGap = () => <View style={{ height: spacing[2] }} />;

// ── CheckRow ───────────────────────────────────────────────────────────
// Memoised journal row. Extracted to module scope so FlashList can
// recycle the React element without prop identity changing every parent
// render. Only re-renders when ITS row's props (check, showDateHeader,
// permissions) shift — the previous version rebuilt every visible row
// whenever any of `dateHeaderByIndex / canDelete / canViewProfit /
// handleDelete / navigation / queryClient` recreated, which happened
// on every Journal-screen re-render (typing in search, refetching,
// SWR data swap). Net: 30+ rows worth of TouchableOpacity / 6 nested
// Views / 4 Ionicons per row would re-render on each parent tick. With
// React.memo + stable props we keep cells static across SWR refetches.
interface CheckRowProps {
  check: Check;
  showDateHeader: boolean;
  dateGroupLabel: string;
  canDelete: boolean;
  canViewProfit: boolean;
  onOpen: (checkId: string) => void;
  onDelete: (checkId: string, checkNumber: number) => void;
  palette: SemanticPalette;
}
const CheckRow = React.memo(function CheckRow({
  check,
  showDateHeader,
  dateGroupLabel,
  canDelete,
  canViewProfit,
  onOpen,
  onDelete,
  palette,
}: CheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];
  // Time string — computed once per row mount; row is memoised, so the
  // `new Date(...).toLocaleTimeString(...)` no longer runs on every
  // parent re-render of the screen.
  const timeLabel = new Date(check.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <View>
      {showDateHeader && (
        <View style={styles.dateGroupHeader}>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
          <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{dateGroupLabel}</Text>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.checkCard,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          check.isDeferred && styles.checkCardDeferred,
        ]}
        onPress={() => onOpen(check.id)}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.accentBar,
            check.isDeferred ? { backgroundColor: colors.red[400] } : { backgroundColor: colors.primary[400] },
          ]}
        />
        <View style={styles.checkContent}>
          <View style={styles.checkHeader}>
            <View style={styles.checkHeaderLeft}>
              <Text style={[styles.checkNumber, { color: palette.text.primary }]}>#{check.number}</Text>
              {check.isDeferred && (
                <View style={styles.deferredBadge}>
                  <Text style={styles.deferredText}>Отложен</Text>
                </View>
              )}
              <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
                  {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Text style={[styles.checkTotal, { color: palette.text.primary }]}>
                {formatMoney(check.totalRevenue)}
              </Text>
              {canDelete && (
                <TouchableOpacity
                  onPress={() => onDelete(check.id, check.number)}
                  style={styles.deleteBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.checkInfoRow}>
            {check.client?.fullName ? (
              <View style={styles.infoChip}>
                <Ionicons name="person-outline" size={11} color={palette.text.tertiary} />
                <Text style={[styles.infoChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                  {check.client.fullName}
                </Text>
              </View>
            ) : null}
            {check.car && (
              <View style={styles.infoChip}>
                <Ionicons name="car-outline" size={11} color={palette.text.tertiary} />
                <Text style={[styles.infoChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                  {check.car.makeModel}
                </Text>
                {check.car.plateNumber && <Text style={styles.plateTag}>{check.car.plateNumber}</Text>}
              </View>
            )}
          </View>

          {check.comment && (
            <Text style={styles.commentText} numberOfLines={1}>
              {check.comment}
            </Text>
          )}

          <View style={styles.checkFooter}>
            <Text style={[styles.footerTime, { color: palette.text.tertiary }]}>{timeLabel}</Text>
            {check.master && (
              <Text style={[styles.footerMaster, { color: palette.text.tertiary }]}>{check.master.fullName}</Text>
            )}
            {canViewProfit && (
              <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                {check.profit >= 0 ? '+' : ''}
                {formatMoney(check.profit)}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
});

// Unified warehouse document item for the list
type WarehouseDoc =
  | { kind: 'movement'; data: StockMovement; sortDate: string }
  | { kind: 'delivery'; data: Delivery; sortDate: string };

// ── WarehouseDocRow ────────────────────────────────────────────────────
// Memoised row for the warehouse-documents tab. Module-scope so React
// can `React.memo` it correctly without per-render closure recreation.
// Renders either a stock-movement card or a delivery card — picked by
// `item.kind`. The only prop that ever changes is `item`; the `onSelect`
// setter from `useState` is stable across renders.
interface WarehouseDocRowProps {
  item: WarehouseDoc;
  onSelect: (doc: WarehouseDoc) => void;
  palette: SemanticPalette;
}
const WarehouseDocRow = React.memo(function WarehouseDocRow({ item, onSelect, palette }: WarehouseDocRowProps) {
  if (item.kind === 'movement') {
    const m = item.data;
    // "Покупка Б/У" — отдельная палитра (cyan) и лейбл. Owner brief:
    // эти движения должны визуально выделяться в журнале.
    const isUsedPurchase = !!m.isUsedPurchase;
    const typeInfo = isUsedPurchase
      ? USED_PURCHASE_ICON
      : movementTypeIcons[m.type] || movementTypeIcons.income;
    const label = isUsedPurchase ? USED_PURCHASE_LABEL : movementTypeLabels[m.type];
    const qtyColor = isUsedPurchase
      ? colors.cyan[600]
      : NEGATIVE_MOVEMENT_TYPES.has(m.type)
        ? colors.red[600]
        : colors.green[600];
    return (
      <TouchableOpacity
        style={[styles.warehouseCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        activeOpacity={0.7}
        onPress={() => onSelect(item)}
      >
        <View style={[styles.warehouseAccent, { backgroundColor: typeInfo.accentColor }]} />
        <View style={styles.warehouseCardContent}>
          <View style={styles.warehouseCardHeader}>
            <View style={[styles.warehouseIconWrap, { backgroundColor: typeInfo.accentColor + '18' }]}>
              <Ionicons name={typeInfo.name as any} size={18} color={typeInfo.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.warehouseCardTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {m.product?.name || 'Товар'}
              </Text>
              <Text style={[styles.warehouseCardSubtitle, { color: palette.text.tertiary }]}>{label}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.warehouseQty, { color: qtyColor }]}>
                {NEGATIVE_MOVEMENT_TYPES.has(m.type) ? '-' : '+'}
                {m.quantity} шт
              </Text>
              <Text style={[styles.warehouseDate, { color: palette.text.tertiary }]}>{formatDate(m.createdAt)}</Text>
            </View>
          </View>
          {(m.reason || m.user) && (
            <View style={[styles.warehouseCardFooter, { borderTopColor: palette.border.subtle }]}>
              {m.reason ? (
                <Text style={[styles.warehouseReason, { color: palette.text.secondary }]} numberOfLines={1}>
                  {m.reason}
                </Text>
              ) : null}
              {m.user ? (
                <Text style={[styles.warehouseUser, { color: palette.text.tertiary }]}>{m.user.fullName}</Text>
              ) : null}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }
  // Delivery — payment-status badges intentionally absent here per
  // product policy (debt tracking lives in the Suppliers screen).
  const d = item.data;
  return (
    <TouchableOpacity
      style={[styles.warehouseCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      activeOpacity={0.7}
      onPress={() => onSelect(item)}
    >
      <View style={[styles.warehouseAccent, { backgroundColor: colors.green[500] }]} />
      <View style={styles.warehouseCardContent}>
        <View style={styles.warehouseCardHeader}>
          <View style={[styles.warehouseIconWrap, { backgroundColor: colors.green[500] + '18' }]}>
            <Ionicons name="bus-outline" size={18} color={colors.green[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.warehouseCardTitle, { color: palette.text.primary }]} numberOfLines={1}>
              {d.supplier?.name || 'Поставщик'}
            </Text>
            <Text style={[styles.warehouseCardSubtitle, { color: palette.text.tertiary }]}>
              Поставка {d.items?.length || 0} поз.
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.warehouseQty, { color: palette.text.primary }]}>{formatMoney(d.totalAmount)}</Text>
            <Text style={[styles.warehouseDate, { color: palette.text.tertiary }]}>{formatDate(d.date)}</Text>
          </View>
        </View>
        {d.comment ? (
          <View style={[styles.warehouseCardFooter, { borderTopColor: palette.border.subtle }]}>
            <Text style={[styles.warehouseReason, { color: palette.text.secondary }]} numberOfLines={1}>
              {d.comment}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

export default function ChecksScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');

  const [activeTab, setActiveTab] = useState<ActiveTab>('checks');
  const [search, setSearch] = useState('');
  // Page-based infinite scroll. The first page is the most recent checks
  // (the API sorts desc by date, so today's rows land first); subsequent
  // pages are appended below as the user scrolls. We stay on a small page
  // size so the first paint feels instant and old data is fetched lazily.
  const limit = 20;
  const [refreshing, setRefreshing] = useState(false);
  // No-op kept so historical onChange handlers below stay readable.
  // Filter changes flip the queryKey; useInfiniteQuery resets to page 1
  // automatically — we never need to reset a page counter explicitly.
  const setPage = (_: number | ((p: number) => number)) => {
    /* noop — useInfiniteQuery owns paging now */
  };

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [filterMasterId, setFilterMasterId] = useState('');
  const [showDateFromPicker, setShowDateFromPicker] = useState(false);
  const [showDateToPicker, setShowDateToPicker] = useState(false);

  const [selectedDoc, setSelectedDoc] = useState<WarehouseDoc | null>(null);

  const activeFilterCount = (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (filterMasterId ? 1 : 0);

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const activeUsers = useMemo(() => (allUsers || []).filter((u) => u.isActive), [allUsers]);

  const formatFilterDate = (d: Date) =>
    `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const {
    data: checksData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedResponse<Check>>({
    // Page key intentionally excludes the page number so all loaded
    // pages share a single cache entry. This is what lets the user
    // come back from a check detail and still see today + older
    // pages already loaded — no re-fetch flash.
    queryKey: [
      'checks-infinite',
      search,
      dateFrom ? toISODate(dateFrom) : '',
      dateTo ? toISODate(dateTo) : '',
      filterMasterId,
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const params: Record<string, any> = { page: pageParam as number, limit };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = toISODate(dateFrom);
      if (dateTo) params.dateTo = toISODate(dateTo);
      if (filterMasterId) params.masterId = filterMasterId;
      const res = await checksApi.getAll(params);
      return res.data;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + (p?.data?.length ?? 0), 0);
      return loaded < (lastPage?.total ?? 0) ? allPages.length + 1 : undefined;
    },
    // Журнал — холодный список, который меняется редко (новые чеки идут
    // через invalidate в delete/create мутациях). 5 минут «свежо», 30 минут
    // живёт в памяти — возврат с CheckDetail попадает прямо в кеш.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Принципиально: не перезапрашивать на каждый mount. Возврат с детали
    // чека не должен снова грузить страницу — данные уже в кеше.
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  // Warehouse documents queries
  const { data: movementsData, isLoading: movementsLoading } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements();
      return res.data;
    },
    staleTime: 60_000,
    enabled: activeTab === 'warehouse',
  });

  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery<Delivery[]>({
    queryKey: ['supplier-deliveries'],
    queryFn: async () => {
      const res = await suppliersApi.getDeliveries();
      return res.data;
    },
    staleTime: 60_000,
    enabled: activeTab === 'warehouse',
  });

  const warehouseDocs = useMemo<WarehouseDoc[]>(() => {
    const docs: WarehouseDoc[] = [];
    if (movementsData) {
      for (const m of movementsData) {
        docs.push({ kind: 'movement', data: m, sortDate: m.createdAt });
      }
    }
    if (deliveriesData) {
      for (const d of deliveriesData) {
        docs.push({ kind: 'delivery', data: d, sortDate: d.date });
      }
    }
    docs.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());
    return docs;
  }, [movementsData, deliveriesData]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onSuccess: () => {
      // Cover both the legacy `['checks', ...]` key (used by paginated
      // queries elsewhere — Reports / Salary etc.) and the new infinite
      // key the journal owns. invalidateQueries with a prefix invalidates
      // any longer key that starts with it, so this is intentional.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить'),
  });

  const handleDelete = useCallback(
    (checkId: string, checkNumber: number) => {
      Alert.alert('Удалить чек', `Удалить чек #${checkNumber}? Это действие необратимо.`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate(checkId) },
      ]);
    },
    [deleteMutation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'checks') {
      await queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
    } else {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stock-movements'] }),
        queryClient.invalidateQueries({ queryKey: ['supplier-deliveries'] }),
      ]);
    }
    setRefreshing(false);
  };

  // Flatten all loaded pages — newest first comes from page 1, older
  // appended below from page 2+. The reduce avoids creating a fresh
  // array on every render unless the underlying pages change.
  const checks = useMemo(() => (checksData?.pages ?? []).flatMap((p) => p?.data ?? []), [checksData?.pages]);
  const total = checksData?.pages?.[0]?.total ?? 0;

  // Group checks by date — precompute «у этого индекса нужен заголовок?»
  // на основе всего массива `checks`. Раньше использовался mutable
  // `lastDateGroup`, который через closure rendered'ил неправильно при
  // recycling в FlashList (карточки рисовались не строго по порядку).
  const dateHeaderByIndex = useMemo(() => {
    const flags: boolean[] = new Array(checks.length).fill(false);
    let prev = '';
    for (let i = 0; i < checks.length; i++) {
      const grp = formatDateGroup(checks[i].date);
      if (grp !== prev) {
        flags[i] = true;
        prev = grp;
      }
    }
    return flags;
  }, [checks]);

  // Stable navigation handler — `useCallback` so the prop passed to
  // CheckRow doesn't change across screen renders (would bust React.memo).
  const openCheckDetail = useCallback(
    (checkId: string) => {
      // ВАЖНО: НЕ прайми кеш `['check', id]` row-данными из журнала.
      // Прошлая итерация делала setQueryData с row payload, в котором
      // `services` / `products` могут быть undefined (list endpoint
      // не отдаёт их детально), и CheckDetailScreen потом крэшил на
      // `check.services.length` / `(check.products || []).map(...)`.
      // CheckDetailScreen теперь сам делает безопасный placeholderData
      // lookup через queryClient.getQueriesData(['checks-infinite']),
      // и при этом guard'ит .length / .map от undefined. См. iter#12.
      navigation.navigate('CheckDetail', { id: checkId });
    },
    [navigation],
  );

  const renderCheck = useCallback(
    ({ item: check, index }: { item: Check; index: number }) => (
      <CheckRow
        check={check}
        showDateHeader={dateHeaderByIndex[index] === true}
        dateGroupLabel={formatDateGroup(check.date)}
        canDelete={canDelete}
        canViewProfit={canViewProfit}
        onOpen={openCheckDetail}
        onDelete={handleDelete}
        palette={palette}
      />
    ),
    [dateHeaderByIndex, canDelete, canViewProfit, openCheckDetail, handleDelete, palette],
  );

  const renderWarehouseDoc = useCallback(
    ({ item }: { item: WarehouseDoc }) => (
      <WarehouseDocRow item={item} onSelect={setSelectedDoc} palette={palette} />
    ),
    [palette],
  );

  const isWarehouseLoading = movementsLoading || deliveriesLoading;
  // No IosScreenHeader on this screen — the tab bar already names it
  // «Журнал», so we just reserve the top safe-area inset ourselves so
  // the search bar doesn't slide under the Dynamic Island / status bar.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top + 8, backgroundColor: palette.bg.canvas }]}>
      {/* Header removed per owner — the screen reads as Журнал from the
          tab-bar label already, and the count duplicates info shown at
          the bottom of the list (pagination). Less chrome → more list. */}

      {/* Search + Filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Поиск по клиенту, авто, номеру..."
          />
        </View>
        <TouchableOpacity
          style={[
            styles.filterBtn,
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            activeFilterCount > 0 && styles.filterBtnActive,
          ]}
          onPress={() => setShowFilters(!showFilters)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeFilterCount > 0 ? 'funnel' : 'funnel-outline'}
            size={18}
            color={activeFilterCount > 0 ? colors.primary[600] : palette.text.secondary}
          />
          {activeFilterCount > 0 && (
            <View style={[styles.filterCountDot, { borderColor: palette.bg.canvas }]}>
              <Text style={styles.filterCountDotText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Segmented control: Checks | Warehouse documents */}
      <View style={styles.segmentedWrap}>
        <View style={[styles.segmentedControl, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              activeTab === 'checks' && [styles.segmentBtnActive, { backgroundColor: palette.bg.card }],
            ]}
            onPress={() => setActiveTab('checks')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="receipt-outline"
              size={15}
              color={activeTab === 'checks' ? colors.primary[700] : palette.text.secondary}
            />
            <Text
              style={[
                styles.segmentBtnText,
                { color: palette.text.secondary },
                activeTab === 'checks' && styles.segmentBtnTextActive,
              ]}
            >
              Чеки
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              activeTab === 'warehouse' && [styles.segmentBtnActive, { backgroundColor: palette.bg.card }],
            ]}
            onPress={() => setActiveTab('warehouse')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="cube-outline"
              size={15}
              color={activeTab === 'warehouse' ? colors.primary[700] : palette.text.secondary}
            />
            <Text
              style={[
                styles.segmentBtnText,
                { color: palette.text.secondary },
                activeTab === 'warehouse' && styles.segmentBtnTextActive,
              ]}
            >
              Склад. документы
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filters panel (only for checks tab) */}
      {showFilters && activeTab === 'checks' && (
        <View style={styles.filtersPanel}>
          {/* Date range */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowDateFromPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  dateFrom && { color: palette.text.primary },
                ]}
              >
                {dateFrom ? formatFilterDate(dateFrom) : 'С даты'}
              </Text>
              {dateFrom && (
                <TouchableOpacity
                  onPress={() => {
                    setDateFrom(null);
                    setPage(1);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <Ionicons name="arrow-forward" size={12} color={palette.text.tertiary} />
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowDateToPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  dateTo && { color: palette.text.primary },
                ]}
              >
                {dateTo ? formatFilterDate(dateTo) : 'По дату'}
              </Text>
              {dateTo && (
                <TouchableOpacity
                  onPress={() => {
                    setDateTo(null);
                    setPage(1);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Employee filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing[2] }}>
            <View style={{ flexDirection: 'row', gap: spacing[1.5] }}>
              <TouchableOpacity
                style={[
                  styles.empChip,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  !filterMasterId && styles.empChipActive,
                ]}
                onPress={() => {
                  setFilterMasterId('');
                  setPage(1);
                }}
              >
                <Text
                  style={[
                    styles.empChipText,
                    { color: palette.text.secondary },
                    !filterMasterId && styles.empChipTextActive,
                  ]}
                >
                  Все
                </Text>
              </TouchableOpacity>
              {activeUsers.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={[
                    styles.empChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    filterMasterId === u.id && styles.empChipActive,
                  ]}
                  onPress={() => {
                    setFilterMasterId(filterMasterId === u.id ? '' : u.id);
                    setPage(1);
                  }}
                >
                  <Text
                    style={[
                      styles.empChipText,
                      { color: palette.text.secondary },
                      filterMasterId === u.id && styles.empChipTextActive,
                    ]}
                  >
                    {u.fullName?.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearFiltersBtn}
              onPress={() => {
                setDateFrom(null);
                setDateTo(null);
                setFilterMasterId('');
                setPage(1);
              }}
            >
              <Ionicons name="close-circle-outline" size={14} color={colors.red[500]} />
              <Text style={styles.clearFiltersBtnText}>Сбросить фильтры</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Date pickers */}
      <DateTimePickerModal
        visible={showDateFromPicker}
        value={dateFrom || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDateFromPicker(false);
          setDateFrom(d);
          setPage(1);
        }}
        onCancel={() => setShowDateFromPicker(false)}
      />
      <DateTimePickerModal
        visible={showDateToPicker}
        value={dateTo || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDateToPicker(false);
          setDateTo(d);
          setPage(1);
        }}
        onCancel={() => setShowDateToPicker(false)}
      />

      {/* Content */}
      {activeTab === 'checks' ? (
        <>
          {/* Cold-start path:
             - `checksData === undefined` ⇒ never fetched yet AND no cached
               value — show skeleton (NOT an EmptyState — empty state on
               cold start was the "пусто" flash the owner reported).
             - `checksData` defined but list empty AND not currently fetching ⇒
               legitimate empty state.
             - `checksData` defined ⇒ render the list immediately, even
               while a background refetch is in flight (SWR). */}
          {checksData === undefined ? (
            <ListSkeleton count={8} />
          ) : checks.length === 0 && !isLoading ? (
            <EmptyState title="Чеков не найдено" description="Попробуйте изменить фильтры" />
          ) : (
            <FlashList
              data={checks}
              keyExtractor={(item) => item.id}
              renderItem={renderCheck}
              contentContainerStyle={[
                styles.list,
                Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null,
              ]}
              contentInset={{ bottom: tabBarHeight }}
              scrollIndicatorInsets={{ bottom: tabBarHeight }}
              automaticallyAdjustContentInsets={false}
              // removeClippedSubviews is iOS-default; on Android the
              // journal can grow to hundreds of rows so we opt in
              // explicitly to avoid offscreen draws dragging the UI
              // thread during fast flings.
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              onEndReached={() => {
                if (hasNextPage && !isFetchingNextPage) fetchNextPage();
              }}
              onEndReachedThreshold={0.6}
              ItemSeparatorComponent={ListGap}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary[500]} />
                  </View>
                ) : null
              }
            />
          )}
        </>
      ) : (
        <>
          {/* Same cold-start logic as the checks tab — skeleton until at
             least one of the two underlying queries has data, then render
             the merged list. EmptyState only when both queries finished
             AND the merged list is still empty. */}
          {movementsData === undefined && deliveriesData === undefined ? (
            /* Skeleton list — gradual reveal from top, no white-empty
               flash. Same component the checks list uses, so the two
               tabs feel identical during loading. */
            <ListSkeleton count={8} />
          ) : warehouseDocs.length === 0 && !isWarehouseLoading ? (
            <EmptyState title="Документов не найдено" description="Складские движения и поставки появятся здесь" />
          ) : (
            <FlashList
              data={warehouseDocs}
              keyExtractor={(item) => (item.kind === 'movement' ? `m-${item.data.id}` : `d-${item.data.id}`)}
              renderItem={renderWarehouseDoc}
              contentContainerStyle={[
                styles.list,
                Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null,
              ]}
              contentInset={{ bottom: tabBarHeight }}
              scrollIndicatorInsets={{ bottom: tabBarHeight }}
              automaticallyAdjustContentInsets={false}
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              ItemSeparatorComponent={ListGap}
            />
          )}
        </>
      )}
      {/* Warehouse Document Detail Modal */}
      <Modal
        visible={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={
          selectedDoc?.kind === 'movement'
            ? selectedDoc.data.isUsedPurchase
              ? USED_PURCHASE_LABEL
              : movementTypeLabels[selectedDoc.data.type] || 'Документ'
            : 'Поставка'
        }
      >
        {selectedDoc?.kind === 'movement' &&
          (() => {
            const m = selectedDoc.data;
            const isUsedPurchase = !!m.isUsedPurchase;
            const typeInfo = isUsedPurchase
              ? USED_PURCHASE_ICON
              : movementTypeIcons[m.type] || movementTypeIcons.income;
            const label = isUsedPurchase ? USED_PURCHASE_LABEL : movementTypeLabels[m.type];
            const qtyColor = isUsedPurchase
              ? colors.cyan[600]
              : NEGATIVE_MOVEMENT_TYPES.has(m.type)
                ? colors.red[600]
                : colors.green[600];
            return (
              <View style={{ gap: spacing[3] }}>
                <View style={[styles.docDetailHeader, { borderBottomColor: palette.border.subtle }]}>
                  <View style={[styles.docDetailIcon, { backgroundColor: typeInfo.accentColor + '18' }]}>
                    <Ionicons name={typeInfo.name as any} size={28} color={typeInfo.color} />
                  </View>
                  <Text style={[styles.docDetailType, { color: palette.text.primary }]}>{label}</Text>
                </View>

                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Товар</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{m.product?.name || '—'}</Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Количество</Text>
                  <Text style={[styles.docDetailValue, { color: qtyColor }]}>
                    {NEGATIVE_MOVEMENT_TYPES.has(m.type) ? '-' : '+'}
                    {m.quantity} шт
                  </Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Остаток до</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{m.stockBefore} шт</Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Остаток после</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{m.stockAfter} шт</Text>
                </View>
                {m.reason && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Причина</Text>
                    <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{m.reason}</Text>
                  </View>
                )}
                {m.user && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Сотрудник</Text>
                    <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{m.user.fullName}</Text>
                  </View>
                )}
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Дата</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>
                    {formatDate(m.createdAt)}
                  </Text>
                </View>
              </View>
            );
          })()}

        {selectedDoc?.kind === 'delivery' &&
          (() => {
            // Per product policy a warehouse delivery has no payment status
            // displayed here — supplier-side debts/payments live in the
            // Suppliers screen, not in the journal detail.
            const d = selectedDoc.data;
            return (
              <View style={{ gap: spacing[3] }}>
                <View style={[styles.docDetailHeader, { borderBottomColor: palette.border.subtle }]}>
                  <View style={[styles.docDetailIcon, { backgroundColor: colors.green[50] }]}>
                    <Ionicons name="bus-outline" size={28} color={colors.green[600]} />
                  </View>
                  <Text style={[styles.docDetailType, { color: palette.text.primary }]}>Поставка</Text>
                </View>

                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Поставщик</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>
                    {d.supplier?.name || '—'}
                  </Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Дата</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>{formatDate(d.date)}</Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Сумма</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary, fontWeight: fontWeight.bold }]}>
                    {formatMoney(d.totalAmount)}
                  </Text>
                </View>

                {d.items && d.items.length > 0 && (
                  <View style={[styles.docDetailItems, { backgroundColor: palette.bg.muted }]}>
                    <Text style={[styles.docDetailItemsTitle, { color: palette.text.primary }]}>
                      Товары ({d.items.length})
                    </Text>
                    {d.items.map((item, idx) => (
                      <View key={idx} style={styles.docDetailItemRow}>
                        <Text style={[styles.docDetailItemName, { color: palette.text.secondary }]} numberOfLines={1}>
                          {item.product?.name || '—'}
                        </Text>
                        <Text style={[styles.docDetailItemQty, { color: palette.text.tertiary }]}>
                          {item.quantity} x {formatMoney(item.price)}
                        </Text>
                        <Text style={[styles.docDetailItemTotal, { color: palette.text.primary }]}>
                          {formatMoney(item.total)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {d.comment && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Комментарий</Text>
                    <Text style={[styles.docDetailValue, { color: palette.text.primary, fontStyle: 'italic' }]}>
                      {d.comment}
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // ── Header ──────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  totalBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.primary[100],
  },
  totalBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.primary[600],
  },
  // ── Search + Filter row ─────────────────────────────────────────
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[1],
  },
  searchInputWrap: {
    flex: 1,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  filterBtnActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[300],
  },
  filterCountDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.white,
  },
  filterCountDotText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },

  // ── Segmented Control ───────────────────────────────────────────
  segmentedWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  segmentBtnTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },

  // ── Filters panel ───────────────────────────────────────────────
  filtersPanel: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  filterDateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  filterDateText: { flex: 1, fontSize: fontSize.xs, color: colors.gray[400] },
  empChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[100],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  empChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  empChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  empChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
  clearFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    marginTop: spacing[2],
    paddingVertical: spacing[1.5],
  },
  clearFiltersBtnText: { fontSize: fontSize.xs, color: colors.red[500], fontWeight: fontWeight.medium },

  // ── List ────────────────────────────────────────────────────────
  // iOS: bottom space reserved via FlashList's contentInset prop so
  // the floating Liquid Glass bar shows live content scrolling under
  // it. Android: contentInset is silently ignored by the platform, so
  // we add an explicit paddingBottom equal to the M3 NavigationBar
  // height (added inline at the FlashList consumers below to avoid
  // hard-coding the bar height here).
  list: { paddingHorizontal: spacing[4] },

  // Date group headers
  dateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
  },
  dateGroupLine: { flex: 1, height: 1, backgroundColor: colors.gray[200] },
  dateGroupText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Check card -- compact with left accent
  checkCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  checkCardDeferred: { backgroundColor: '#fef8f8', borderColor: colors.red[100] },
  accentBar: { width: 3.5 },
  checkContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },

  // Header row
  checkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deferredBadge: {
    backgroundColor: colors.red[100],
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deleteBtn: { padding: 2 },

  // Info chips row
  checkInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5], marginBottom: spacing[1] },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoChipText: { fontSize: 12, color: colors.gray[600], maxWidth: 120 },
  plateTag: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.primary[700],
    backgroundColor: colors.primary[50],
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    marginLeft: 2,
  },

  // Comment
  commentText: { fontSize: 11, color: colors.amber[600], fontStyle: 'italic', marginBottom: spacing[1] },

  // Footer
  checkFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footerTime: { fontSize: 11, color: colors.gray[400] },
  footerMaster: { fontSize: 11, color: colors.gray[400], flex: 1 },
  footerProfit: { fontSize: 11, fontWeight: fontWeight.bold },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },

  // ── Warehouse document cards ────────────────────────────────────
  warehouseCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  warehouseAccent: {
    width: 3.5,
  },
  warehouseCardContent: {
    flex: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  warehouseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
  },
  warehouseIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warehouseCardTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    marginBottom: 1,
  },
  warehouseCardSubtitle: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  warehouseQty: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  warehouseDate: {
    fontSize: 11,
    color: colors.gray[400],
    marginTop: 1,
  },
  warehouseCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingTop: spacing[1.5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[100],
  },
  warehouseReason: {
    flex: 1,
    fontSize: 11,
    color: colors.gray[500],
    fontStyle: 'italic',
  },
  warehouseUser: {
    fontSize: 11,
    color: colors.gray[400],
  },
  paymentStatusBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  paymentStatusText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },

  // ── Document Detail Modal ─────────────────────────────────────
  docDetailHeader: {
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  docDetailIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docDetailType: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  docDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1.5],
  },
  docDetailLabel: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    flex: 1,
  },
  docDetailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[900],
    flex: 1,
    textAlign: 'right',
  },
  docDetailStatusBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  docDetailStatusText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  docDetailItems: {
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    gap: spacing[2],
  },
  docDetailItemsTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[700],
    marginBottom: spacing[1],
  },
  docDetailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[1],
  },
  docDetailItemName: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.gray[700],
  },
  docDetailItemQty: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginHorizontal: spacing[2],
  },
  docDetailItemTotal: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    minWidth: 60,
    textAlign: 'right',
  },
});
