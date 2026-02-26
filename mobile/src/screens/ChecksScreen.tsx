import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import AnimatedCard from '../components/AnimatedCard';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, PaginatedResponse } from '../../../shared/types';

const paymentLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', warranty: 'Гарантия', cash_card: 'Нал/Карта' };
function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { const dt = new Date(d); return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

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

  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', page, search],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit };
      if (search) params.search = search;
      const res = await checksApi.getAll(params);
      return res.data;
    },
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

  const renderCheck = ({ item: check }: { item: Check }) => {
    const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
    const badge = badgeColors[badgeKey];

    return (
      <TouchableOpacity
        style={[styles.checkCard, check.isDeferred && styles.checkCardDeferred]}
        onPress={() => navigation.navigate('CheckDetail', { id: check.id })}
        activeOpacity={0.7}
      >
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
          {canDelete && (
            <TouchableOpacity
              onPress={() => handleDelete(check.id, check.number)}
              style={styles.deleteBtn}
            >
              <Ionicons name="close" size={16} color={colors.gray[300]} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.checkBody}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
            <Ionicons name="person-outline" size={14} color={colors.gray[400]} />
            <Text style={styles.checkClient} numberOfLines={1}>
              {check.client?.fullName ?? 'Розничный покупатель'}
            </Text>
          </View>
          {check.car && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
              <Ionicons name="car-outline" size={14} color={colors.gray[400]} />
              <Text style={styles.checkCar} numberOfLines={1}>
                {check.car.makeModel} · {check.car.plateNumber}
              </Text>
            </View>
          )}
        </View>

        {check.comment && (
          <View style={styles.commentBox}>
            <Text style={styles.commentText} numberOfLines={2}>{check.comment}</Text>
          </View>
        )}

        <View style={styles.checkFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerDate}>{formatDate(check.date)}</Text>
            {check.master && <Text style={styles.footerMaster} numberOfLines={1}>{check.master.fullName}</Text>}
          </View>
          <Text style={styles.checkTotal}>{formatMoney(check.totalRevenue)}</Text>
        </View>

        {canViewProfit && (
          <View style={styles.profitRow}>
            <Text style={styles.profitLabel}>Прибыль</Text>
            <Text style={[styles.profitValue, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
              {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="receipt" size={20} color={colors.primary[600]} />
          <Text style={styles.title}>Чеки</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('CheckCreate')}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newBtnText}>Новый</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Поиск по клиенту, авто, номеру..." />
      </View>

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
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary[600], paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  newBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  checkCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], overflow: 'hidden', shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  checkCardDeferred: { backgroundColor: '#fef2f2', borderColor: colors.red[200] },
  checkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingTop: spacing[3.5], paddingBottom: spacing[2.5] },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  checkNumber: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deferredBadge: { backgroundColor: colors.red[100], paddingHorizontal: spacing[1.5], paddingVertical: 2, borderRadius: borderRadius.full },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  paymentBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  deleteBtn: { padding: spacing[1.5] },
  deleteBtnText: { fontSize: 14, color: colors.gray[300] },
  checkBody: { paddingHorizontal: spacing[4], gap: spacing[1], marginBottom: spacing[3] },
  checkClient: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[800] },
  checkCar: { fontSize: fontSize.sm, color: colors.gray[600] },
  commentBox: { marginHorizontal: spacing[4], marginBottom: spacing[3], backgroundColor: colors.amber[50], borderRadius: borderRadius.lg, padding: spacing[2.5], borderWidth: 1, borderColor: colors.amber[100] },
  commentText: { fontSize: fontSize.xs, color: colors.amber[600] },
  checkFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderTopWidth: 1, borderTopColor: colors.gray[50], backgroundColor: 'rgba(249,250,251,0.5)' },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1 },
  footerDate: { fontSize: fontSize.xs, color: colors.gray[400] },
  footerMaster: { fontSize: fontSize.xs, color: colors.gray[400] },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  profitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[100] },
  profitLabel: { fontSize: fontSize.xs, color: colors.gray[400] },
  profitValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },
});
