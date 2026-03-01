import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, PaginatedResponse, User } from '../../../shared/types';

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

export default function ChecksScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');

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
    await queryClient.invalidateQueries({ queryKey: ['checks'] });
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

            {/* Client & car — compact single row */}
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

  // Reset lastDateGroup when data changes
  lastDateGroup = '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="receipt" size={20} color={colors.primary[600]} />
          <Text style={styles.title}>Журнал чеков</Text>
          {total > 0 && <Text style={styles.totalCount}>{total}</Text>}
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('CheckCreate')}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newBtnText}>Новый</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Filter toggle */}
      <View style={styles.searchWrap}>
        <View style={{ flex: 1 }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); lastDateGroup = ''; }} placeholder="Поиск по клиенту, авто, номеру..." />
        </View>
        <TouchableOpacity style={[styles.filterToggle, activeFilterCount > 0 && styles.filterToggleActive]} onPress={() => setShowFilters(!showFilters)}>
          <Ionicons name="options-outline" size={18} color={activeFilterCount > 0 ? colors.primary[600] : colors.gray[500]} />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {/* Filters panel */}
      {showFilters && (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalCount: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[600], backgroundColor: colors.primary[50], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full, overflow: 'hidden' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary[600], paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  newBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[1] },
  filterToggle: { width: 40, height: 40, borderRadius: borderRadius.lg, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  filterToggleActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  filterBadge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.white },
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
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8] },

  // Date group headers
  dateGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2.5], marginTop: spacing[1] },
  dateGroupLine: { flex: 1, height: 1, backgroundColor: colors.gray[200] },
  dateGroupText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 0.5 },

  // Check card — compact with left accent
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
});
