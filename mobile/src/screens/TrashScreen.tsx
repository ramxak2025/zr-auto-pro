/**
 * TrashScreen — mobile counterpart to the web TrashModal.
 * Lists soft-deleted products with two actions: Restore / Delete forever.
 * Footer button empties the bin in one call after a confirm.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { productsApi } from '../api/services';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Product } from '../../../shared/types';

const formatMoney = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

interface TrashScreenProps {
  /** Optional close handler — when provided (e.g. when rendered inside the
   *  warehouse ops modal), the back-chevron calls this instead of
   *  `navigation.goBack()`. Lets us host TrashScreen inline as a sheet
   *  without disturbing the navigator stack. */
  onClose?: () => void;
}

export default function TrashScreen({ onClose }: TrashScreenProps = {}) {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data: items, isLoading } = useQuery<Product[]>({
    queryKey: ['products-trash'],
    queryFn: async () => {
      const res = await productsApi.getTrash();
      return res.data;
    },
  });

  const filtered = useMemo(() => {
    const list = items ?? [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q));
  }, [items, search]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['products-trash'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const restoreMut = useMutation({
    mutationFn: (id: string) => productsApi.restore(id),
    onSuccess: invalidateAll,
    onError: () => Alert.alert('Ошибка', 'Не удалось восстановить'),
  });

  const hardDeleteMut = useMutation({
    mutationFn: (id: string) => productsApi.hardDelete(id),
    onSuccess: invalidateAll,
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  const emptyMut = useMutation({
    mutationFn: () => productsApi.emptyTrash(),
    onSuccess: invalidateAll,
    onError: () => Alert.alert('Ошибка', 'Не удалось очистить'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['products-trash'] });
    setRefreshing(false);
  };

  const confirmHardDelete = (p: Product) => {
    Alert.alert('Удалить навсегда', `Удалить "${p.name}" безвозвратно? Восстановление будет невозможно.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => hardDeleteMut.mutate(p.id) },
    ]);
  };

  const confirmEmpty = () => {
    if (!items || items.length === 0) return;
    Alert.alert('Очистить корзину', `Удалить все ${items.length} товаров навсегда? Восстановление будет невозможно.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Очистить', style: 'destructive', onPress: () => emptyMut.mutate() },
    ]);
  };

  const renderItem = ({ item }: { item: Product }) => (
    <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.iconBox}>
        <Ionicons name="trash-outline" size={20} color={colors.rose[500]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.sub, { color: palette.text.tertiary }]} numberOfLines={1}>
          {item.category || 'Без папки'}
          {'  ·  '}
          {formatMoney(item.sellPrice)}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.actionBtn}
        onPress={() => restoreMut.mutate(item.id)}
        disabled={restoreMut.isPending}
      >
        <Ionicons name="arrow-undo-outline" size={18} color={colors.green[600]} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionBtn}
        onPress={() => confirmHardDelete(item)}
        disabled={hardDeleteMut.isPending}
      >
        <Ionicons name="trash" size={18} color={colors.red[500]} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}>
        <TouchableOpacity onPress={() => (onClose ? onClose() : navigation.goBack())} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIcon}>
            <Ionicons name="trash-bin-outline" size={16} color={colors.rose[600]} />
          </View>
          <Text style={[styles.title, { color: palette.text.primary }]}>Корзина склада</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск..." />
      </View>

      {isLoading ? (
        <ListSkeleton count={6} />
      ) : !items || items.length === 0 ? (
        <EmptyState
          title="Корзина пуста"
          description="Удалённые товары сохраняются здесь и могут быть восстановлены."
        />
      ) : (
        <>
          <FlashList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
            }
          />
          <View style={[styles.footer, { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity style={styles.emptyBtn} onPress={confirmEmpty} disabled={emptyMut.isPending}>
              <Ionicons name="trash" size={16} color={colors.red[600]} />
              <Text style={styles.emptyBtnText}>
                {emptyMut.isPending ? 'Очищаю…' : `Очистить корзину (${items.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
    backgroundColor: colors.white,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.rose[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    marginBottom: spacing[2],
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.rose[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  sub: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: colors.white,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.red[50],
  },
  emptyBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.red[600] },
});
