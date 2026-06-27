import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, Alert, ScrollView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
// entityLinks намеренно не импортируются здесь: тап по карточке журнала
// должен всегда вести в CheckDetail, а не на клиента/авто/мастера.
// Переходы на сущности живут внутри открытой деталки чека.
import { checksApi, usersApi, journalApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import FreshnessBadge from '../components/FreshnessBadge';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, paymentMethodBadgeColor } from '../theme';
import { buildShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { AutexaGlassHeader } from 'autexa-liquid-glass';
import type { Check, PaginatedResponse, User, JournalDoc } from '../../../shared/types';

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

// ── Journal warehouse-docs kind metadata ───────────────────────────────
// Owner-facing labels for each JournalDoc kind. Mirrors the backend
// `KIND_META` map (backend/src/journal/journal.service.ts) so chip
// labels and row titles stay consistent across web and mobile.
type JournalKind = JournalDoc['kind'];

const journalKindLabels: Record<JournalKind, string> = {
  purchase: 'Покупки',
  return_to_supplier: 'Возврат поставщику',
  customer_return: 'Возврат клиента',
  defect_transfer: 'Брак',
  writeoff: 'Списания',
  supplier_payment: 'Платежи',
  used_purchase: 'Б/У',
};

// Visual tokens for each JournalDoc kind. Used by both the row card
// (left accent bar + icon background) and the kind chip filter row.
// Each block intentionally uses a distinct color so a glance is enough
// to tell a purchase apart from a writeoff / payment / used-purchase.
const journalKindVisual: Record<
  JournalKind,
  {
    icon: keyof typeof Ionicons.glyphMap;
    accentColor: string;
    iconColor: string;
    // Optional override for the row card background — used by
    // `used_purchase` so those rows visually pop (purple tint).
    cardBg?: string;
  }
> = {
  purchase: { icon: 'cube-outline', accentColor: colors.green[500], iconColor: colors.green[600] },
  return_to_supplier: { icon: 'arrow-undo-outline', accentColor: colors.orange[500], iconColor: colors.orange[600] },
  // Customer return — goods come BACK into stock (an inflow, like a purchase),
  // but visually teal so it never reads as a supplier purchase or a supplier
  // return. Distinct from green (purchase) and orange (return_to_supplier).
  customer_return: {
    icon: 'arrow-undo-outline',
    accentColor: colors.teal[600],
    iconColor: colors.teal[600],
    cardBg: colors.teal[50],
  },
  defect_transfer: { icon: 'warning-outline', accentColor: colors.red[500], iconColor: colors.red[600] },
  writeoff: { icon: 'trash-outline', accentColor: colors.gray[400], iconColor: colors.gray[600] },
  supplier_payment: { icon: 'cash-outline', accentColor: colors.blue[500], iconColor: colors.blue[600] },
  // Used-purchase rows get a stronger visual treatment per owner brief —
  // soft purple background so they stand out from the generic green
  // purchase rows even on a busy day.
  used_purchase: {
    icon: 'car-outline',
    accentColor: colors.purple[600],
    iconColor: colors.purple[700],
    cardBg: colors.purple[50],
  },
};

// Outflow rows — amount shown with `-` prefix and red tint. `customer_return`
// is deliberately NOT here: like `purchase`, it is a STOCK INFLOW (goods come
// back onto the shelf), and the row amount is the goods' cost value, so it reads
// as `+` to match the existing purchase convention. (The customer's cash refund
// is reversed separately on the check itself — F1 in returns.service.ts — and is
// not what this warehouse-doc row represents.) Its teal tint keeps it visually
// distinct from a green purchase.
const NEGATIVE_KINDS = new Set<JournalKind>(['return_to_supplier', 'defect_transfer', 'writeoff', 'supplier_payment']);

// Ordered list of kind chips above the warehouse-docs list. `null` is
// the "Все" filter — passes no `type` param to the API.
const KIND_CHIPS: Array<{ key: JournalKind | null; label: string }> = [
  { key: null, label: 'Все' },
  { key: 'purchase', label: journalKindLabels.purchase },
  { key: 'customer_return', label: journalKindLabels.customer_return },
  { key: 'return_to_supplier', label: journalKindLabels.return_to_supplier },
  { key: 'defect_transfer', label: journalKindLabels.defect_transfer },
  { key: 'writeoff', label: journalKindLabels.writeoff },
  { key: 'supplier_payment', label: journalKindLabels.supplier_payment },
  { key: 'used_purchase', label: journalKindLabels.used_purchase },
];

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
  /**
   * Fires on `onPressIn` — kicks off the detail prefetch BEFORE the
   * navigation push happens. By the time the CheckDetailScreen mounts,
   * the canonical `['check', id]` query is already resolved (or at
   * least in-flight). Net: detail view paints instantly on iPhone.
   */
  onPressIn: (checkId: string) => void;
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
  onPressIn,
  onDelete,
  palette,
}: CheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = getBadgeColors(palette.mode)[badgeKey];
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
          buildShadow(palette),
          {
            backgroundColor: palette.bg.card,
            borderColor: check.isDeferred
              ? palette.mode === 'dark'
                ? 'rgba(239,68,68,0.3)'
                : colors.red[100]
              : palette.border.subtle,
          },
          check.isDeferred && styles.checkCardDeferred,
        ]}
        onPress={() => onOpen(check.id)}
        onPressIn={() => onPressIn(check.id)}
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
                <View
                  style={[
                    styles.deferredBadge,
                    {
                      backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.18)' : colors.red[100],
                    },
                  ]}
                >
                  <Text style={styles.deferredText}>Отложен</Text>
                </View>
              )}
              {/* Возвращённый чек — красная плашка с иконкой стрелки.
                  Стоит рядом с «Отложен», чтобы оба статуса читались
                  с одной точки. Сам чек остаётся кликабельным — деталка
                  откроется как обычно (см. openCheckDetail). */}
              {check.isReturned && (
                <View style={styles.returnedBadge}>
                  <Ionicons name="arrow-undo" size={9} color={colors.white} />
                  <Text style={styles.returnedBadgeText}>ВОЗВРАТ</Text>
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

// ── WarehouseDocRow ────────────────────────────────────────────────────
// Memoised row for the warehouse-documents tab. Renders a unified
// `JournalDoc` regardless of kind — the backend `journal/warehouse-docs`
// endpoint normalises stock_movements + supplier_payments into a single
// shape. Kind-specific styling (accent bar color, icon, money sign) is
// driven by `journalKindVisual[item.kind]`.
//
// Module-scope so React can `React.memo` correctly without per-render
// closure recreation. The only prop that ever changes is `item`; the
// `onSelect` setter from `useState` is stable across renders.
interface WarehouseDocRowProps {
  item: JournalDoc;
  onSelect: (doc: JournalDoc) => void;
  palette: SemanticPalette;
}
const WarehouseDocRow = React.memo(function WarehouseDocRow({ item, onSelect, palette }: WarehouseDocRowProps) {
  const visual = journalKindVisual[item.kind];
  const isNegative = NEGATIVE_KINDS.has(item.kind);
  const amountColor =
    item.kind === 'used_purchase'
      ? colors.purple[700]
      : item.kind === 'customer_return'
        ? colors.teal[600]
        : isNegative
          ? colors.red[600]
          : colors.green[600];
  // Title prefers payeeName for supplier_payment ("Оплата: ООО Х"),
  // otherwise falls back to the backend-provided title.
  const title = item.kind === 'supplier_payment' && item.payeeName ? `Оплата: ${item.payeeName}` : item.title;
  const subtitle = item.subtitle || journalKindLabels[item.kind];
  return (
    <TouchableOpacity
      style={[
        styles.warehouseCard,
        buildShadow(palette),
        {
          backgroundColor: visual.cardBg || palette.bg.card,
          borderColor: palette.border.subtle,
        },
      ]}
      activeOpacity={0.7}
      onPress={() => onSelect(item)}
    >
      <View style={[styles.warehouseAccent, { backgroundColor: visual.accentColor }]} />
      <View style={styles.warehouseCardContent}>
        <View style={styles.warehouseCardHeader}>
          <View style={[styles.warehouseIconWrap, { backgroundColor: visual.accentColor + '18' }]}>
            <Ionicons name={visual.icon} size={18} color={visual.iconColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.warehouseCardTitle, { color: palette.text.primary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.warehouseCardSubtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.warehouseQty, { color: amountColor }]}>
              {isNegative ? '-' : '+'}
              {formatMoney(Math.abs(item.amount))}
            </Text>
            <Text style={[styles.warehouseDate, { color: palette.text.tertiary }]}>{formatDate(item.occurredAt)}</Text>
          </View>
        </View>
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
  // «Возвраты» — chip-фильтр над списком. Когда активен, оставляем
  // только чеки с isReturned=true. Реализован на клиенте через filter
  // по уже загруженным страницам, чтобы не плодить новый serverside-
  // param. Серверный фильтр потом можно добавить, когда появится
  // отдельный endpoint /checks/returns.
  const [returnsOnly, setReturnsOnly] = useState(false);
  // «Отложенные» — СЕРВЕРНЫЙ фильтр: бэк принимает аддитивный параметр
  // isDeferred=true (GET /checks) и отдаёт только отложенные черновики.
  // В отличие от returnsOnly это не клиентский filter — отложенные могут
  // не попасть на уже загруженные страницы, поэтому фильтруем на сервере.
  const [deferredOnly, setDeferredOnly] = useState(false);
  const [showDateFromPicker, setShowDateFromPicker] = useState(false);
  const [showDateToPicker, setShowDateToPicker] = useState(false);

  // Warehouse-tab kind filter — null means "Все". Persists across tab
  // switches so toggling Чеки → Складские документы keeps the last
  // chosen chip active.
  const [warehouseKind, setWarehouseKind] = useState<JournalKind | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<JournalDoc | null>(null);

  const activeFilterCount =
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (filterMasterId ? 1 : 0) + (returnsOnly ? 1 : 0) + (deferredOnly ? 1 : 0);

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const activeUsers = useMemo(() => (Array.isArray(allUsers) ? allUsers : []).filter((u) => u.isActive), [allUsers]);

  // Near-live journal: poll the loaded pages every 30s, but only while the
  // screen is focused, so a backgrounded Журнал tab spends no JS tick or
  // network roundtrip. (The client-side If-None-Match/304 layer was removed —
  // see api/axios.ts — so each poll is a normal full GET.) Pattern mirrors
  // CallsScreen's focus-gated poll.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );

  const formatFilterDate = (d: Date) =>
    `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const {
    data: checksData,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    dataUpdatedAt,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
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
      // Слот 5 — фильтр «Отложенные». Всегда присутствует (стабильная
      // длина ключа); позиции 0..4 НЕ двигать — persistentCache
      // (POSITIONAL_SEARCH_IDX) опирается на то, что search стоит в
      // индексе 1. Новые фильтры — только дописывать в хвост.
      deferredOnly ? 'deferred' : '',
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const params: Record<string, any> = { page: pageParam as number, limit };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = toISODate(dateFrom);
      if (dateTo) params.dateTo = toISODate(dateTo);
      if (filterMasterId) params.masterId = filterMasterId;
      // isDeferred — аддитивный серверный параметр: true → только
      // отложенные. Выключенный фильтр параметр НЕ шлёт (undefined),
      // поведение и ответ сервера идентичны прежним.
      if (deferredOnly) params.isDeferred = true;
      const res = await checksApi.getAll(params);
      return res.data;
    },
    // ВАЖНО: считаем по НОМЕРУ страницы (lastPageParam), а не по длине
    // allPages — с maxPages TanStack выбрасывает самые старые страницы
    // из кеша, и allPages.length перестаёт совпадать с номером последней.
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const page = (lastPageParam as number) ?? 1;
      return page * limit < (lastPage?.total ?? 0) ? page + 1 : undefined;
    },
    getPreviousPageParam: (_firstPage, _allPages, firstPageParam) => {
      const page = (firstPageParam as number) ?? 1;
      return page > 1 ? page - 1 : undefined;
    },
    // RNPERF-7: держим в кеше максимум 5 страниц (100 строк). 30-секундный
    // focus-poll перезапрашивает ТОЛЬКО удержанные страницы — без maxPages
    // глубокий скролл превращал каждый poll в десятки последовательных
    // запросов. Выпавшие при глубоком скролле свежие страницы дозагружаются
    // обратно через fetchPreviousPage (onStartReached на FlashList) при
    // скролле к началу списка.
    maxPages: 5,
    // Журнал — холодный список, который меняется редко (новые чеки идут
    // через invalidate в delete/create мутациях). 5 минут «свежо», 30 минут
    // живёт в памяти — возврат с CheckDetail попадает прямо в кеш.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Принципиально: не перезапрашивать на каждый mount. Возврат с детали
    // чека не должен снова грузить страницу — данные уже в кеше.
    refetchOnMount: false,
    // Near-live: refetch loaded pages on network reconnect + on a focus-gated
    // 30s poll. Scroll position / pagination untouched — useInfiniteQuery
    // refetches the already-loaded pages in place.
    refetchOnReconnect: true,
    refetchInterval: pollEnabled ? 30_000 : false,
    placeholderData: (prev) => prev,
  });

  // ── Warehouse documents (unified journal feed) ──────────────────
  // Single source of truth: `journalApi.warehouseDocs(...)` merges
  // stock_movements + supplier_payments serverside and returns a
  // pre-sorted JournalDoc[].
  //
  // We deliberately fetch the FULL feed (no `?type=` param) and filter
  // by `kind` on the client below. Reasons:
  //   1. Robustness — the server's `?type=` whitelist (journal.controller
  //      WarehouseDocsQueryDto `@IsIn`) lagged behind the kinds the FE
  //      offers: `customer_return` was added to the journal everywhere
  //      EXCEPT that DTO, so `?type=customer_return` 400'd and the
  //      «Возврат клиента» chip showed an empty list. Filtering the loaded
  //      list by `kind` makes every chip work regardless of the DTO and
  //      future-proofs new kinds without a backend round-trip.
  //   2. Speed — the backend already caps the feed at 500 rows, so one
  //      cached fetch + an in-memory filter is instant when switching
  //      chips (no per-chip refetch / white flash). Mirrors the existing
  //      client-side `returnsOnly` filter on the checks tab.
  // The cache key has no `warehouseKind`, so all chips share one entry.
  const { data: allWarehouseDocs = [], isLoading: warehouseLoading } = useQuery<JournalDoc[]>({
    queryKey: ['journal-warehouse-docs'],
    queryFn: async () => {
      const res = await journalApi.warehouseDocs({});
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
    enabled: activeTab === 'warehouse',
    placeholderData: (prev) => prev,
  });

  // Apply the active kind chip on the client. `null` («Все») passes
  // everything through. Each non-null chip shows EXACTLY its own kind —
  // the backend `kind` is already canonical (stock_movements.type →
  // kind mapping lives in journal.service.ts), so this is a 1:1 match
  // with no duplicates and no empty-from-bad-mapping results.
  const warehouseDocs = useMemo(
    () => (warehouseKind ? allWarehouseDocs.filter((d) => d.kind === warehouseKind) : allWarehouseDocs),
    [allWarehouseDocs, warehouseKind],
  );

  // Optimistic delete — UX feels instant because the row disappears
  // BEFORE the server confirms. The rollback path restores the cache
  // snapshot if the network rejects (rare, but possible: 403 on a
  // permission downgrade, 404 if someone else already deleted, etc.).
  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onMutate: async (id: string) => {
      // Cancel anything in-flight against this list — otherwise the
      // refetch lands after our local mutation and resurrects the row.
      await queryClient.cancelQueries({ queryKey: ['checks-infinite'] });
      const prev = queryClient.getQueriesData<{ pages?: { data?: Check[]; total?: number }[] }>({
        queryKey: ['checks-infinite'],
      });
      // Eager remove across every page-set variant currently in cache.
      // Each `data.pages[*].data[*]` is the flat per-page array.
      queryClient.setQueriesData<{ pages?: { data?: Check[]; total?: number }[] } | undefined>(
        { queryKey: ['checks-infinite'] },
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: (p?.data ?? []).filter((c) => c.id !== id),
              total: (p?.total ?? 0) - ((p?.data ?? []).some((c) => c.id === id) ? 1 : 0),
            })),
          };
        },
      );
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      // Restore every variant we snapshotted in onMutate.
      ctx?.prev.forEach(([key, val]) => queryClient.setQueryData(key, val));
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить');
    },
    onSettled: () => {
      // Server is authoritative once the mutation settles. Cover both
      // the legacy `['checks', ...]` key (used by paginated queries
      // elsewhere — Reports / Salary etc.) and the new infinite key
      // the journal owns. invalidateQueries with a prefix invalidates
      // any longer key that starts with it.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      // Real dashboard keys (legacy `['dashboard']` matched no active
      // query). Owner deleting a check from the Journal still wants
      // the dashboard / cashflow numbers to drop accordingly.
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
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
      await queryClient.invalidateQueries({ queryKey: ['journal-warehouse-docs'] });
    }
    setRefreshing(false);
  };

  // Flatten all loaded pages — newest first comes from page 1, older
  // appended below from page 2+. The reduce avoids creating a fresh
  // array on every render unless the underlying pages change.
  const allLoadedChecks = useMemo(
    () =>
      (Array.isArray(checksData?.pages) ? checksData.pages : []).flatMap((p) => (Array.isArray(p?.data) ? p.data : [])),
    [checksData?.pages],
  );
  // Returns-only фильтр работает на уже загруженных страницах. Бэк
  // не отдаёт серверный isReturned-параметр (пока), но `placeholderData`
  // + `checks-infinite` cache держат страницы тёплыми — клиентский
  // filter мгновенный.
  const checks = useMemo(
    () => (returnsOnly ? allLoadedChecks.filter((c) => !!c.isReturned) : allLoadedChecks),
    [allLoadedChecks, returnsOnly],
  );
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

  // Prefetch-on-tap — fires on `onPressIn` (before the navigation push)
  // so the detail screen mounts with the canonical query already
  // in-flight. CheckDetailScreen forces `refetchOnMount: 'always'`
  // because payment status is critical, but the prefetch shaves the
  // network round-trip off the perceived load time.
  const prefetchCheckDetail = useCallback(
    (checkId: string) => {
      queryClient.prefetchQuery({
        queryKey: ['check', checkId],
        queryFn: async () => {
          const res = await checksApi.getById(checkId);
          return res.data;
        },
        staleTime: 30_000,
      });
    },
    [queryClient],
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
        onPressIn={prefetchCheckDetail}
        onDelete={handleDelete}
        palette={palette}
      />
    ),
    [dateHeaderByIndex, canDelete, canViewProfit, openCheckDetail, prefetchCheckDetail, handleDelete, palette],
  );

  const renderWarehouseDoc = useCallback(
    ({ item }: { item: JournalDoc }) => <WarehouseDocRow item={item} onSelect={setSelectedDoc} palette={palette} />,
    [palette],
  );

  const isWarehouseLoading = warehouseLoading;
  // No IosScreenHeader on this screen — the tab bar already names it
  // «Журнал», so we just reserve the top safe-area inset ourselves so
  // the search bar doesn't slide under the Dynamic Island / status bar.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top + 8, backgroundColor: palette.bg.canvas }]}>
      {/* Header removed per owner — the screen reads as Журнал from the
          tab-bar label already, and the count duplicates info shown at
          the bottom of the list (pagination). Less chrome → more list. */}

      {/* Freshness pill — HYBRID-perf plan. ChecksScreen renders from
          persistent cache instantly on cold start, so we expose the
          "background refresh" state to the user as a 10pt secondary pill.
          Position: above the search row, right-aligned, no chrome unless
          actively fetching. */}
      <View style={styles.freshnessRow}>
        {/* «Доска» — вход на канбан-доску заказ-нарядов (приёмка → в работе →
            готов → выдан). Живёт в ChecksStack, поэтому плавающий таб-бар
            остаётся виден, а back возвращает в Журнал. Доска — другой ракурс
            тех же чеков, поэтому вход логично рядом с журналом. */}
        <TouchableOpacity
          style={[styles.boardEntryBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          onPress={() => {
            haptic('tap');
            navigation.navigate('WorkBoard');
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Открыть доску заказ-нарядов"
        >
          <Ionicons name="albums-outline" size={15} color={colors.primary[600]} />
          <Text style={styles.boardEntryText}>Доска</Text>
        </TouchableOpacity>
        <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
      </View>

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
            buildShadow(palette),
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
              activeTab === 'checks' && [
                styles.segmentBtnActive,
                buildShadow(palette),
                { backgroundColor: palette.bg.card },
              ],
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
              activeTab === 'warehouse' && [
                styles.segmentBtnActive,
                buildShadow(palette),
                { backgroundColor: palette.bg.card },
              ],
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
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
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
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
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

          {/* Returns-only toggle — moved inside the filter sheet (was
              a standalone chip above the list). Owner brief: keep the
              functionality but hide it behind the funnel button so the
              main view stays clean. */}
          <TouchableOpacity
            onPress={() => setReturnsOnly((v) => !v)}
            activeOpacity={0.7}
            style={[
              styles.returnsToggleRow,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              returnsOnly && styles.returnsToggleRowActive,
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: returnsOnly }}
            accessibilityLabel="Только возвраты клиентов"
          >
            <Ionicons
              name="arrow-undo-outline"
              size={14}
              color={returnsOnly ? colors.red[600] : palette.text.secondary}
            />
            <Text style={[styles.returnsToggleLabel, { color: returnsOnly ? colors.red[700] : palette.text.primary }]}>
              Возврат клиента
            </Text>
            <View
              style={[
                styles.returnsToggleSwitch,
                { backgroundColor: returnsOnly ? colors.red[500] : palette.border.subtle },
              ]}
            >
              <View style={[styles.returnsToggleSwitchKnob, returnsOnly && styles.returnsToggleSwitchKnobOn]} />
            </View>
          </TouchableOpacity>

          {/* «Отложенные» — серверный фильтр по isDeferred. Тот же
              toggle-row паттерн, что и «Только возвраты» выше. Красная
              палитра сознательно совпадает с плашкой «Отложен» на
              карточках чеков (red[100]/red[700]) — фильтр и статус
              читаются как одно состояние. */}
          <TouchableOpacity
            onPress={() => {
              setDeferredOnly((v) => !v);
              setPage(1);
            }}
            activeOpacity={0.7}
            style={[
              styles.returnsToggleRow,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              deferredOnly && styles.returnsToggleRowActive,
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: deferredOnly }}
            accessibilityLabel="Только отложенные"
          >
            <Ionicons name="time-outline" size={14} color={deferredOnly ? colors.red[600] : palette.text.secondary} />
            <Text style={[styles.returnsToggleLabel, { color: deferredOnly ? colors.red[700] : palette.text.primary }]}>
              Отложенные
            </Text>
            {/* Счётчик «бесплатный»: когда фильтр активен, total первой
                страницы УЖЕ равен числу отложенных — отдельный запрос
                ради цифры не нужен. isPlaceholderData-guard прячет цифру,
                пока на экране данные предыдущего ключа (иначе на миг
                мелькал бы общий total всех чеков). */}
            {deferredOnly && !isPlaceholderData && checksData !== undefined && (
              <View
                style={[
                  styles.deferredCountBadge,
                  { backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.18)' : colors.red[100] },
                ]}
              >
                <Text style={styles.deferredCountBadgeText}>{total}</Text>
              </View>
            )}
            <View
              style={[
                styles.returnsToggleSwitch,
                { backgroundColor: deferredOnly ? colors.red[500] : palette.border.subtle },
              ]}
            >
              <View style={[styles.returnsToggleSwitchKnob, deferredOnly && styles.returnsToggleSwitchKnobOn]} />
            </View>
          </TouchableOpacity>

          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearFiltersBtn}
              onPress={() => {
                setDateFrom(null);
                setDateTo(null);
                setFilterMasterId('');
                setReturnsOnly(false);
                setDeferredOnly(false);
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
             - `isError` И ни одной загруженной страницы (нет даже кеша) ⇒
               честный error-state с «Повторить» — раньше тут показывался
               вводящий в заблуждение skeleton/empty. Если кеш есть —
               показываем список (SWR), фон сам дотянет свежее.
             - `checksData === undefined` ⇒ never fetched yet AND no cached
               value — show skeleton (NOT an EmptyState — empty state on
               cold start was the "пусто" flash the owner reported).
             - `checksData` defined but list empty AND not currently fetching ⇒
               legitimate empty state.
             - `checksData` defined ⇒ render the list immediately, even
               while a background refetch is in flight (SWR). */}
          {isError && checksData === undefined ? (
            // ScrollView-обёртка нужна ради pull-to-refresh: жест должен
            // работать и из error-state, а не только когда список жив.
            <ScrollView
              contentContainerStyle={styles.errorStateWrap}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
            >
              <EmptyState
                icon="warning"
                title="Не удалось загрузить журнал"
                description="Проверьте подключение к интернету и попробуйте ещё раз"
                action={{ label: 'Повторить', onPress: () => refetch() }}
              />
            </ScrollView>
          ) : checksData === undefined ? (
            <ListSkeleton count={8} />
          ) : checks.length === 0 && !isLoading ? (
            <EmptyState title="Чеков не найдено" description="Попробуйте изменить фильтры" />
          ) : (
            <FlashList
              data={checks}
              keyExtractor={(item) => item.id}
              renderItem={renderCheck}
              // FlashList v2 auto-measures rows; no estimatedItemSize.
              contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
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
              // Симметричная подгрузка вверх: когда maxPages выкинул
              // страницу 1 (самые свежие чеки), скролл к началу списка
              // дотягивает её обратно. FlashList v2 держит позицию через
              // maintainVisibleContentPosition (включён по умолчанию).
              onStartReached={() => {
                if (hasPreviousPage && !isFetchingPreviousPage) fetchPreviousPage();
              }}
              onStartReachedThreshold={0.2}
              ItemSeparatorComponent={ListGap}
              ListHeaderComponent={
                isFetchingPreviousPage ? (
                  <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary[500]} />
                  </View>
                ) : null
              }
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
          {/* Kind filter chips — drive `journalApi.warehouseDocs({type})`.
              Horizontal scroll so all 7 chips fit on small screens.

              The chip strip sits on a NATIVE Liquid-Glass material
              (AutexaGlassHeader → UIVisualEffectView, auto-upgraded to iOS 26
              UIGlassEffect). The glass is a pure visual background: the chips
              below are unchanged RN TouchableOpacity, still drive the same
              `warehouseKind` state + query, and render BYTE-FOR-BYTE the same
              on Android / iOS where the native module is unavailable (then
              AutexaGlassHeader is a transparent passthrough View). See
              modules/autexa-liquid-glass/src/AutexaGlassHeader.tsx. */}
          <AutexaGlassHeader variant="thinMaterial" style={styles.kindChipsGlass}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.kindChipsScroll}
              contentContainerStyle={styles.kindChipsRow}
            >
              <View style={styles.kindChipsRowInner}>
                {KIND_CHIPS.map((chip) => {
                  const active = warehouseKind === chip.key;
                  const visual = chip.key ? journalKindVisual[chip.key] : null;
                  return (
                    <TouchableOpacity
                      key={chip.key ?? 'all'}
                      onPress={() => setWarehouseKind(chip.key)}
                      activeOpacity={0.7}
                      style={[
                        styles.kindChip,
                        {
                          backgroundColor: active ? (visual?.accentColor ?? colors.primary[600]) : palette.bg.muted,
                          borderColor: active ? (visual?.accentColor ?? colors.primary[600]) : palette.border.subtle,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={chip.label}
                    >
                      {visual && (
                        <Ionicons name={visual.icon} size={12} color={active ? colors.white : palette.text.secondary} />
                      )}
                      <Text style={[styles.kindChipText, { color: active ? colors.white : palette.text.secondary }]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </AutexaGlassHeader>

          {/* Cold-start path: skeleton only while the very first (unfiltered)
             fetch is in flight. Switching chips never shows a skeleton —
             the feed is already loaded and we filter it in memory.
             Empty state is filter-aware: distinguish «no documents at all»
             from «no documents of THIS kind», so an empty chip reads as a
             real (correct) result, not a broken filter. */}
          {isWarehouseLoading && allWarehouseDocs.length === 0 ? (
            <ListSkeleton count={8} />
          ) : warehouseDocs.length === 0 ? (
            warehouseKind && allWarehouseDocs.length > 0 ? (
              <EmptyState
                title={`Нет документов: ${journalKindLabels[warehouseKind].toLowerCase()}`}
                description="Измените фильтр или выберите «Все»"
              />
            ) : (
              <EmptyState title="Документов не найдено" description="Складские движения и поставки появятся здесь" />
            )
          ) : (
            <FlashList
              data={warehouseDocs}
              keyExtractor={(item) => `${item.kind}-${item.id}`}
              renderItem={renderWarehouseDoc}
              contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
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
      {/* Warehouse Document Detail Modal — driven by JournalDoc. The
          backend already normalises kind / title / subtitle / amount, so
          the modal is a thin presentational view. Payment-status badges
          are intentionally absent: warehouse docs have no "paid /
          unpaid" semantic; supplier debt lives in the Suppliers screen. */}
      <Modal
        visible={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={selectedDoc ? journalKindLabels[selectedDoc.kind] : ''}
      >
        {selectedDoc &&
          (() => {
            const doc = selectedDoc;
            const visual = journalKindVisual[doc.kind];
            const isNegative = NEGATIVE_KINDS.has(doc.kind);
            const amountColor =
              doc.kind === 'used_purchase'
                ? colors.purple[700]
                : doc.kind === 'customer_return'
                  ? colors.teal[600]
                  : isNegative
                    ? colors.red[600]
                    : colors.green[600];
            return (
              <View style={{ gap: spacing[3] }}>
                <View style={[styles.docDetailHeader, { borderBottomColor: palette.border.subtle }]}>
                  <View style={[styles.docDetailIcon, { backgroundColor: visual.accentColor + '18' }]}>
                    <Ionicons name={visual.icon} size={28} color={visual.iconColor} />
                  </View>
                  <Text style={[styles.docDetailType, { color: palette.text.primary }]}>
                    {journalKindLabels[doc.kind]}
                  </Text>
                </View>

                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Описание</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]} numberOfLines={3}>
                    {doc.title}
                  </Text>
                </View>
                {doc.payeeName && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Поставщик</Text>
                    <Text style={[styles.docDetailValue, { color: palette.text.primary }]} numberOfLines={2}>
                      {doc.payeeName}
                    </Text>
                  </View>
                )}
                {doc.subtitle && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Комментарий</Text>
                    <Text
                      style={[styles.docDetailValue, { color: palette.text.primary, fontStyle: 'italic' }]}
                      numberOfLines={4}
                    >
                      {doc.subtitle}
                    </Text>
                  </View>
                )}
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Сумма</Text>
                  <Text style={[styles.docDetailValue, { color: amountColor, fontWeight: fontWeight.bold }]}>
                    {isNegative ? '-' : '+'}
                    {formatMoney(Math.abs(doc.amount))}
                  </Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Дата</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>
                    {formatDate(doc.occurredAt)}
                  </Text>
                </View>
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
  // «Доска» entry (left) + FreshnessBadge (right) — single row above search.
  freshnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[1],
    minHeight: 28,
  },
  boardEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  boardEntryText: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.primary[600] },
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

  // ── Returns-only toggle row (lives inside the filter sheet) ─────
  // Owner brief: "Возвраты" is hidden from the main header — it now
  // lives behind the funnel button as a labelled switch row, matching
  // the rest of the filter UI.
  returnsToggleRow: {
    marginTop: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  returnsToggleRowActive: {
    // No background flip — the switch itself signals state. We only
    // boost the border to a faint red so it reads as "filter on" at
    // a glance.
    borderColor: colors.red[300],
  },
  returnsToggleLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  returnsToggleSwitch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    padding: 2,
    justifyContent: 'center',
  },
  returnsToggleSwitchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  returnsToggleSwitchKnobOn: {
    transform: [{ translateX: 16 }],
  },
  // Счётчик отложенных на toggle-row «Отложенные». Цветовая пара
  // red[100]/red[700] — ровно та же, что у плашки «Отложен» на карточке
  // чека (deferredBadge/deferredText), bg в dark-mode задаётся inline.
  deferredCountBadge: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginRight: spacing[1],
  },
  deferredCountBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.red[700] },

  // ── Warehouse kind chips (above the warehouse-docs list) ────────
  // Horizontal scroll row driving `journalApi.warehouseDocs({ type })`.
  // Корень бага: ScrollView — прямой child flex-колонки (styles.safe,
  // flex:1). Без flexGrow:0 колонка растягивала горизонтальный
  // ScrollView по вертикали, и чипы «плавали» в середине высокой
  // пустой полосы. flexGrow/flexShrink:0 заставляют ScrollView
  // обнимать высоту контента (chip 32 + paddingBottom) — компактная
  // полоса, под которой список идёт сразу. alignSelf:'flex-start'
  // защищает от cross-axis stretch на узких/широких iPhone.
  // Native Liquid-Glass material strip behind the kind chips. Must hug the
  // chip-row height (flexGrow/flexShrink: 0), same lesson as kindChipsScroll
  // below — the parent is a flex column (styles.safe, flex:1) and without
  // this the glass band would stretch to fill the column and the chips would
  // float in the middle of a tall empty strip. Full-width so the material
  // reads edge-to-edge; the chips keep their own paddingHorizontal. A little
  // top padding gives the chips breathing room inside the glass. On Android /
  // no-module this style applies to a plain transparent View (no visual
  // change vs. before).
  kindChipsGlass: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    paddingTop: spacing[1.5],
  },
  kindChipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  kindChipsRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  kindChipsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    height: 32,
    minHeight: 32,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  kindChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

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

  // Error-state контейнер (чеки не загрузились и кеша нет): растягиваем
  // ScrollView на весь экран и центрируем EmptyState, чтобы блок стоял
  // там же, где skeleton/empty — без прыжков layout'а между состояниями.
  errorStateWrap: { flexGrow: 1, justifyContent: 'center' },

  // Date group headers
  dateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
  },
  dateGroupLine: { flex: 1, height: 1 },
  dateGroupText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Check card -- compact with left accent
  checkCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
  },
  checkCardDeferred: {},
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
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  deferredBadge: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  // Возвращённый чек — насыщенно красная плашка с иконкой стрелки.
  // Сильнее «Отложен», потому что возврат — терминальное состояние:
  // редактировать чек больше нельзя.
  returnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.red[500],
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  returnedBadgeText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: 0.3 },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
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
});
