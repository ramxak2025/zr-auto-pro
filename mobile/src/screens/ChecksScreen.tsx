import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi, usersApi, productsApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, PaginatedResponse, User, StockMovement, Delivery } from '../../../shared/types';

const paymentLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', warranty: 'Гарантия', cash_card: 'Нал/Карта' };
function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
};

const movementTypeIcons: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string; accentColor: string }> = {
  inventory: { name: 'clipboard-outline', color: colors.blue[600], accentColor: colors.blue[500] },
  writeoff: { name: 'trash-outline', color: colors.red[600], accentColor: colors.red[500] },
  income: { name: 'arrow-down-outline', color: colors.green[600], accentColor: colors.green[500] },
  expense: { name: 'arrow-up-outline', color: colors.orange[500], accentColor: colors.orange[500] },
};

type ActiveTab = 'checks' | 'warehouse';

// Unified warehouse document item for the list
type WarehouseDoc =
  | { kind: 'movement'; data: StockMovement; sortDate: string }
  | { kind: 'delivery'; data: Delivery; sortDate: string };

export default function ChecksScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');

  const [activeTab, setActiveTab] = useState<ActiveTab>('checks');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const [refreshing, setRefreshing] = useState(false);

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
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
    staleTime: 5 * 60_000,
  });

  const activeUsers = useMemo(() => (allUsers || []).filter(u => u.isActive), [allUsers]);

  const formatFilterDate = (d: Date) => `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', page, search, dateFrom ? toISODate(dateFrom) : '', dateTo ? toISODate(dateTo) : '', filterMasterId],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = toISODate(dateFrom);
      if (dateTo) params.dateTo = toISODate(dateTo);
      if (filterMasterId) params.masterId = filterMasterId;
      const res = await checksApi.getAll(params);
      return res.data;
    },
    staleTime: 30_000,
  });

  // Warehouse documents queries
  const { data: movementsData, isLoading: movementsLoading } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements'],
    queryFn: async () => { const res = await productsApi.getMovements(); return res.data; },
    staleTime: 60_000,
    enabled: activeTab === 'warehouse',
  });

  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery<Delivery[]>({
    queryKey: ['supplier-deliveries'],
    queryFn: async () => { const res = await suppliersApi.getDeliveries(); return res.data; },
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
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить'),
  });

  const handleDelete = (checkId: string, checkNumber: number) => {
    Alert.alert('Удалить чек', `Удалить чек #${checkNumber}? Это действие необратимо.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate(checkId) },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'checks') {
      await queryClient.invalidateQueries({ queryKey: ['checks'] });
    } else {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stock-movements'] }),
        queryClient.invalidateQueries({ queryKey: ['supplier-deliveries'] }),
      ]);
    }
    setRefreshing(false);
  };

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;
  const hasMore = page * limit < total;

  // Group checks by date for visual separation
  let lastDateGroup = '';

  const renderCheck = ({ item: check, index }: { item: Check; index: number }) => {
    const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
    const badge = badgeColors[badgeKey];
    const currentDateGroup = formatDateGroup(check.date);
    const showDateHeader = currentDateGroup !== lastDateGroup;
    if (showDateHeader) lastDateGroup = currentDateGroup;

    return (
      <View>
        {showDateHeader && (
          <View style={styles.dateGroupHeader}>
            <View style={styles.dateGroupLine} />
            <Text style={styles.dateGroupText}>{currentDateGroup}</Text>
            <View style={styles.dateGroupLine} />
          </View>
        )}
        <TouchableOpacity
          style={[styles.checkCard, check.isDeferred && styles.checkCardDeferred]}
          onPress={() => navigation.navigate('CheckDetail', { id: check.id })}
          activeOpacity={0.7}
        >
          {/* Left accent bar */}
          <View style={[styles.accentBar, check.isDeferred ? { backgroundColor: colors.red[400] } : { backgroundColor: colors.primary[400] }]} />

          <View style={styles.checkContent}>
            {/* Top row: number + badges + delete */}
            <View style={styles.checkHeader}>
              <View style={styles.checkHeaderLeft}>
                <Text style={styles.checkNumber}>#{check.number}</Text>
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
                <Text style={styles.checkTotal}>{formatMoney(check.totalRevenue)}</Text>
                {canDelete && (
                  <TouchableOpacity
                    onPress={() => handleDelete(check.id, check.number)}
                    style={styles.deleteBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={14} color={colors.gray[300]} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Client & car -- compact single row */}
            <View style={styles.checkInfoRow}>
              {check.client?.fullName ? (
                <View style={styles.infoChip}>
                  <Ionicons name="person-outline" size={11} color={colors.gray[400]} />
                  <Text style={styles.infoChipText} numberOfLines={1}>{check.client.fullName}</Text>
                </View>
              ) : null}
              {check.car && (
                <View style={styles.infoChip}>
                  <Ionicons name="car-outline" size={11} color={colors.gray[400]} />
                  <Text style={styles.infoChipText} numberOfLines={1}>{check.car.makeModel}</Text>
                  {check.car.plateNumber && <Text style={styles.plateTag}>{check.car.plateNumber}</Text>}
                </View>
              )}
            </View>

            {/* Comment preview */}
            {check.comment && (
              <Text style={styles.commentText} numberOfLines={1}>{check.comment}</Text>
            )}

            {/* Footer: time + master + profit */}
            <View style={styles.checkFooter}>
              <Text style={styles.footerTime}>
                {new Date(check.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </Text>
              {check.master && <Text style={styles.footerMaster}>{check.master.fullName}</Text>}
              {canViewProfit && (
                <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                  {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderWarehouseDoc = ({ item }: { item: WarehouseDoc }) => {
    if (item.kind === 'movement') {
      const m = item.data;
      const typeInfo = movementTypeIcons[m.type] || movementTypeIcons.income;
      return (
        <TouchableOpacity style={styles.warehouseCard} activeOpacity={0.7} onPress={() => setSelectedDoc(item)}>
          <View style={[styles.warehouseAccent, { backgroundColor: typeInfo.accentColor }]} />
          <View style={styles.warehouseCardContent}>
            <View style={styles.warehouseCardHeader}>
              <View style={[styles.warehouseIconWrap, { backgroundColor: typeInfo.accentColor + '18' }]}>
                <Ionicons name={typeInfo.name as any} size={18} color={typeInfo.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.warehouseCardTitle} numberOfLines={1}>
                  {m.product?.name || 'Товар'}
                </Text>
                <Text style={styles.warehouseCardSubtitle}>
                  {movementTypeLabels[m.type]}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.warehouseQty, { color: m.type === 'writeoff' || m.type === 'expense' ? colors.red[600] : colors.green[600] }]}>
                  {m.type === 'writeoff' || m.type === 'expense' ? '-' : '+'}{m.quantity} шт
                </Text>
                <Text style={styles.warehouseDate}>
                  {formatDate(m.createdAt)}
                </Text>
              </View>
            </View>
            {(m.reason || m.user) && (
              <View style={styles.warehouseCardFooter}>
                {m.reason ? (
                  <Text style={styles.warehouseReason} numberOfLines={1}>
                    {m.reason}
                  </Text>
                ) : null}
                {m.user ? (
                  <Text style={styles.warehouseUser}>
                    {m.user.fullName}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    }

    // Delivery
    const d = item.data;
    const statusStyle = paymentStatusColors[d.paymentStatus] || paymentStatusColors.unpaid;
    return (
      <TouchableOpacity style={styles.warehouseCard} activeOpacity={0.7} onPress={() => setSelectedDoc(item)}>
        <View style={[styles.warehouseAccent, { backgroundColor: colors.green[500] }]} />
        <View style={styles.warehouseCardContent}>
          <View style={styles.warehouseCardHeader}>
            <View style={[styles.warehouseIconWrap, { backgroundColor: colors.green[500] + '18' }]}>
              <Ionicons name="bus-outline" size={18} color={colors.green[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.warehouseCardTitle} numberOfLines={1}>
                {d.supplier?.name || 'Поставщик'}
              </Text>
              <Text style={styles.warehouseCardSubtitle}>
                Поставка  {d.items?.length || 0} поз.
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.warehouseQty, { color: colors.gray[900] }]}>
                {formatMoney(d.totalAmount)}
              </Text>
              <Text style={styles.warehouseDate}>
                {formatDate(d.date)}
              </Text>
            </View>
          </View>
          <View style={styles.warehouseCardFooter}>
            <View style={[styles.paymentStatusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.paymentStatusText, { color: statusStyle.text }]}>
                {paymentStatusLabels[d.paymentStatus] || d.paymentStatus}
              </Text>
            </View>
            {d.comment ? (
              <Text style={styles.warehouseReason} numberOfLines={1}>
                {d.comment}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Reset lastDateGroup when data changes
  lastDateGroup = '';

  const isWarehouseLoading = movementsLoading || deliveriesLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LinearGradient colors={[colors.primary[400], colors.primary[600]] as [string, string]} style={styles.headerIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name="receipt-outline" size={18} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Журнал</Text>
          {total > 0 && activeTab === 'checks' && (
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>{total}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Search + Filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); lastDateGroup = ''; }} placeholder="Поиск по клиенту, авто, номеру..." />
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => setShowFilters(!showFilters)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeFilterCount > 0 ? 'funnel' : 'funnel-outline'}
            size={18}
            color={activeFilterCount > 0 ? colors.primary[600] : colors.gray[500]}
          />
          {activeFilterCount > 0 && (
            <View style={styles.filterCountDot}>
              <Text style={styles.filterCountDotText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Segmented control: Checks | Warehouse documents */}
      <View style={styles.segmentedWrap}>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'checks' && styles.segmentBtnActive]}
            onPress={() => setActiveTab('checks')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="receipt-outline"
              size={15}
              color={activeTab === 'checks' ? colors.primary[700] : colors.gray[500]}
            />
            <Text style={[styles.segmentBtnText, activeTab === 'checks' && styles.segmentBtnTextActive]}>
              Чеки
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'warehouse' && styles.segmentBtnActive]}
            onPress={() => setActiveTab('warehouse')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="cube-outline"
              size={15}
              color={activeTab === 'warehouse' ? colors.primary[700] : colors.gray[500]}
            />
            <Text style={[styles.segmentBtnText, activeTab === 'warehouse' && styles.segmentBtnTextActive]}>
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
            <TouchableOpacity style={styles.filterDateBtn} onPress={() => setShowDateFromPicker(true)}>
              <Ionicons name="calendar-outline" size={14} color={colors.gray[500]} />
              <Text style={[styles.filterDateText, dateFrom && { color: colors.gray[900] }]}>
                {dateFrom ? formatFilterDate(dateFrom) : 'С даты'}
              </Text>
              {dateFrom && (
                <TouchableOpacity onPress={() => { setDateFrom(null); setPage(1); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={14} color={colors.gray[400]} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <Ionicons name="arrow-forward" size={12} color={colors.gray[300]} />
            <TouchableOpacity style={styles.filterDateBtn} onPress={() => setShowDateToPicker(true)}>
              <Ionicons name="calendar-outline" size={14} color={colors.gray[500]} />
              <Text style={[styles.filterDateText, dateTo && { color: colors.gray[900] }]}>
                {dateTo ? formatFilterDate(dateTo) : 'По дату'}
              </Text>
              {dateTo && (
                <TouchableOpacity onPress={() => { setDateTo(null); setPage(1); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={14} color={colors.gray[400]} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Employee filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing[2] }}>
            <View style={{ flexDirection: 'row', gap: spacing[1.5] }}>
              <TouchableOpacity
                style={[styles.empChip, !filterMasterId && styles.empChipActive]}
                onPress={() => { setFilterMasterId(''); setPage(1); }}
              >
                <Text style={[styles.empChipText, !filterMasterId && styles.empChipTextActive]}>Все</Text>
              </TouchableOpacity>
              {activeUsers.map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={[styles.empChip, filterMasterId === u.id && styles.empChipActive]}
                  onPress={() => { setFilterMasterId(filterMasterId === u.id ? '' : u.id); setPage(1); }}
                >
                  <Text style={[styles.empChipText, filterMasterId === u.id && styles.empChipTextActive]}>
                    {u.fullName?.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.clearFiltersBtn} onPress={() => { setDateFrom(null); setDateTo(null); setFilterMasterId(''); setPage(1); }}>
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
        onConfirm={(d) => { setShowDateFromPicker(false); setDateFrom(d); setPage(1); }}
        onCancel={() => setShowDateFromPicker(false)}
      />
      <DateTimePickerModal
        visible={showDateToPicker}
        value={dateTo || new Date()}
        mode="date"
        onConfirm={(d) => { setShowDateToPicker(false); setDateTo(d); setPage(1); }}
        onCancel={() => setShowDateToPicker(false)}
      />

      {/* Content */}
      {activeTab === 'checks' ? (
        <>
          {isLoading ? (
            <LoadingSpinner />
          ) : checks.length === 0 ? (
            <EmptyState title="Чеков не найдено" description="Попробуйте изменить фильтры" />
          ) : (
            <FlatList
              data={checks}
              keyExtractor={(item) => item.id}
              renderItem={renderCheck}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
              onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
              onEndReachedThreshold={0.5}
              ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
            />
          )}
        </>
      ) : (
        <>
          {isWarehouseLoading ? (
            <LoadingSpinner />
          ) : warehouseDocs.length === 0 ? (
            <EmptyState title="Документов не найдено" description="Складские движения и поставки появятся здесь" />
          ) : (
            <FlatList
              data={warehouseDocs}
              keyExtractor={(item) => item.kind === 'movement' ? `m-${item.data.id}` : `d-${item.data.id}`}
              renderItem={renderWarehouseDoc}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
              ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
            />
          )}
        </>
      )}
      {/* Warehouse Document Detail Modal */}
      <Modal visible={!!selectedDoc} onClose={() => setSelectedDoc(null)} title={selectedDoc?.kind === 'movement' ? movementTypeLabels[selectedDoc.data.type] || 'Документ' : 'Поставка'}>
        {selectedDoc?.kind === 'movement' && (() => {
          const m = selectedDoc.data;
          const typeInfo = movementTypeIcons[m.type] || movementTypeIcons.income;
          return (
            <View style={{ gap: spacing[3] }}>
              <View style={styles.docDetailHeader}>
                <View style={[styles.docDetailIcon, { backgroundColor: typeInfo.accentColor + '18' }]}>
                  <Ionicons name={typeInfo.name as any} size={28} color={typeInfo.color} />
                </View>
                <Text style={styles.docDetailType}>{movementTypeLabels[m.type]}</Text>
              </View>

              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Товар</Text>
                <Text style={styles.docDetailValue}>{m.product?.name || '—'}</Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Количество</Text>
                <Text style={[styles.docDetailValue, { color: m.type === 'writeoff' || m.type === 'expense' ? colors.red[600] : colors.green[600] }]}>
                  {m.type === 'writeoff' || m.type === 'expense' ? '-' : '+'}{m.quantity} шт
                </Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Остаток до</Text>
                <Text style={styles.docDetailValue}>{m.stockBefore} шт</Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Остаток после</Text>
                <Text style={styles.docDetailValue}>{m.stockAfter} шт</Text>
              </View>
              {m.reason && (
                <View style={styles.docDetailRow}>
                  <Text style={styles.docDetailLabel}>Причина</Text>
                  <Text style={styles.docDetailValue}>{m.reason}</Text>
                </View>
              )}
              {m.user && (
                <View style={styles.docDetailRow}>
                  <Text style={styles.docDetailLabel}>Сотрудник</Text>
                  <Text style={styles.docDetailValue}>{m.user.fullName}</Text>
                </View>
              )}
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Дата</Text>
                <Text style={styles.docDetailValue}>{formatDate(m.createdAt)}</Text>
              </View>
            </View>
          );
        })()}

        {selectedDoc?.kind === 'delivery' && (() => {
          const d = selectedDoc.data;
          const statusStyle = paymentStatusColors[d.paymentStatus] || paymentStatusColors.unpaid;
          return (
            <View style={{ gap: spacing[3] }}>
              <View style={styles.docDetailHeader}>
                <View style={[styles.docDetailIcon, { backgroundColor: colors.green[50] }]}>
                  <Ionicons name="bus-outline" size={28} color={colors.green[600]} />
                </View>
                <Text style={styles.docDetailType}>Поставка</Text>
              </View>

              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Поставщик</Text>
                <Text style={styles.docDetailValue}>{d.supplier?.name || '—'}</Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Дата</Text>
                <Text style={styles.docDetailValue}>{formatDate(d.date)}</Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Сумма</Text>
                <Text style={[styles.docDetailValue, { fontWeight: fontWeight.bold }]}>{formatMoney(d.totalAmount)}</Text>
              </View>
              <View style={styles.docDetailRow}>
                <Text style={styles.docDetailLabel}>Статус</Text>
                <View style={[styles.docDetailStatusBadge, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[styles.docDetailStatusText, { color: statusStyle.text }]}>
                    {paymentStatusLabels[d.paymentStatus] || d.paymentStatus}
                  </Text>
                </View>
              </View>

              {d.items && d.items.length > 0 && (
                <View style={styles.docDetailItems}>
                  <Text style={styles.docDetailItemsTitle}>Товары ({d.items.length})</Text>
                  {d.items.map((item, idx) => (
                    <View key={idx} style={styles.docDetailItemRow}>
                      <Text style={styles.docDetailItemName} numberOfLines={1}>{item.product?.name || '—'}</Text>
                      <Text style={styles.docDetailItemQty}>{item.quantity} x {formatMoney(item.price)}</Text>
                      <Text style={styles.docDetailItemTotal}>{formatMoney(item.total)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {d.comment && (
                <View style={styles.docDetailRow}>
                  <Text style={styles.docDetailLabel}>Комментарий</Text>
                  <Text style={[styles.docDetailValue, { fontStyle: 'italic' }]}>{d.comment}</Text>
                </View>
              )}
            </View>
          );
        })()}
      </Modal>
    </SafeAreaView>
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
  filterDateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  filterDateText: { flex: 1, fontSize: fontSize.xs, color: colors.gray[400] },
  empChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, backgroundColor: colors.gray[100], borderWidth: 1, borderColor: colors.gray[200] },
  empChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  empChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  empChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
  clearFiltersBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1.5], marginTop: spacing[2], paddingVertical: spacing[1.5] },
  clearFiltersBtnText: { fontSize: fontSize.xs, color: colors.red[500], fontWeight: fontWeight.medium },

  // ── List ────────────────────────────────────────────────────────
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8] },

  // Date group headers
  dateGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2.5], marginTop: spacing[1] },
  dateGroupLine: { flex: 1, height: 1, backgroundColor: colors.gray[200] },
  dateGroupText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 0.5 },

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
  checkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1.5] },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deferredBadge: { backgroundColor: colors.red[100], paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deleteBtn: { padding: 2 },

  // Info chips row
  checkInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5], marginBottom: spacing[1] },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoChipText: { fontSize: 12, color: colors.gray[600], maxWidth: 120 },
  plateTag: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.primary[700], backgroundColor: colors.primary[50], paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden', marginLeft: 2 },

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
