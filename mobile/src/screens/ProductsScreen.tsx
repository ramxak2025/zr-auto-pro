import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Product, PaginatedResponse } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function ProductsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { search, page, limit }],
    queryFn: async () => { const res = await productsApi.getAll({ search, page, limit }); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => productsApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании товара'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении'),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setName(''); setCategory(''); setCostPrice(''); setSellPrice(''); setStock(''); setMinStock('');
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name); setCategory(p.category || ''); setCostPrice(String(p.costPrice)); setSellPrice(String(p.sellPrice));
    setStock(String(p.stock)); setMinStock(String(p.minStock));
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingProduct(null); };

  const handleSubmit = () => {
    const payload = {
      name, category: category || undefined,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0,
      stock: Number(stock) || 0, minStock: Number(minStock) || 0,
    };
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    setRefreshing(false);
  };

  const products = data?.data || [];
  const total = data?.total || 0;
  const hasMore = page * limit < total;

  const renderProduct = ({ item }: { item: Product }) => {
    const lowStock = item.stock <= item.minStock && item.minStock > 0;
    return (
      <TouchableOpacity style={styles.productCard} onPress={() => openEdit(item)} activeOpacity={0.7}>
        <View style={styles.productRow}>
          {item.photo ? (
            <Image source={{ uri: item.photo }} style={styles.productPhoto} />
          ) : (
            <View style={styles.productPhotoPlaceholder}>
              <Text style={{ fontSize: 20 }}>📦</Text>
            </View>
          )}
          <View style={styles.productInfo}>
            <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
            {item.category && <Text style={styles.productCategory}>{item.category}</Text>}
            <View style={styles.productPrices}>
              <Text style={styles.productSellPrice}>{formatMoney(item.sellPrice)}</Text>
              <Text style={styles.productCostPrice}>Себест. {formatMoney(item.costPrice)}</Text>
            </View>
          </View>
          <View style={styles.productStockWrap}>
            <Text style={[styles.productStock, lowStock && styles.productStockLow]}>
              {item.stock}
            </Text>
            <Text style={styles.productStockLabel}>шт</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Склад</Text>
        {hasPermission('warehouse_access') && (
          <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
            <Text style={styles.addBtnText}>+ Новый</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Поиск товара..." />
      </View>

      {isLoading ? (
        <LoadingSpinner />
      ) : products.length === 0 ? (
        <EmptyState title="Нет товаров" description={search ? 'Ничего не найдено' : 'Добавьте первый товар'} action={!search ? { label: 'Добавить', onPress: openCreate } : undefined} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
          onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingProduct ? 'Редактировать товар' : 'Новый товар'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Название</Text>
          <TextInput value={name} onChangeText={setName} style={styles.formInput} placeholder="Масло моторное..." placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Категория</Text>
          <TextInput value={category} onChangeText={setCategory} style={styles.formInput} placeholder="Масла, фильтры..." placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>Себестоимость</Text>
            <TextInput value={costPrice} onChangeText={setCostPrice} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>Цена продажи</Text>
            <TextInput value={sellPrice} onChangeText={setSellPrice} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>Остаток</Text>
            <TextInput value={stock} onChangeText={setStock} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>Мин. остаток</Text>
            <TextInput value={minStock} onChangeText={setMinStock} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          {editingProduct && (
            <TouchableOpacity style={styles.deleteFormBtn} onPress={() => { setDeleteId(editingProduct.id); closeModal(); }}>
              <Text style={styles.deleteFormBtnText}>Удалить</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {(createMutation.isPending || updateMutation.isPending) ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingProduct ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить товар"
        message="Вы уверены?"
        confirmText="Удалить"
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2] },
  productCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3], shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  productPhoto: { width: 48, height: 48, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: { width: 48, height: 48, borderRadius: borderRadius.lg, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  productCategory: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 1 },
  productPrices: { flexDirection: 'row', gap: spacing[3], marginTop: 4 },
  productSellPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productCostPrice: { fontSize: fontSize.xs, color: colors.gray[400] },
  productStockWrap: { alignItems: 'center' },
  productStock: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productStockLow: { color: colors.red[500] },
  productStockLabel: { fontSize: 10, color: colors.gray[400] },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formRowFields: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deleteFormBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.red[50] },
  deleteFormBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
