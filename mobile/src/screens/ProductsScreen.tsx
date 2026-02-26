import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, warehouseCategoriesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Product, PaginatedResponse } from '../../../shared/types';

const SCREEN_WIDTH = Dimensions.get('window').width;

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function ProductsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const limit = 500;
  const [refreshing, setRefreshing] = useState(false);
  const [activePath, setActivePath] = useState<string[]>([]);

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
    queryKey: ['products', { search, limit }],
    queryFn: async () => { const res = await productsApi.getAll({ search, page: 1, limit }); return res.data; },
  });

  const { data: extraFolders } = useQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => { const res = await warehouseCategoriesApi.getAll(); return res.data; },
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

  const allProducts = data?.data || [];

  // Build folder structure
  const { subfolders, currentProducts } = useMemo(() => {
    if (search) {
      return { subfolders: new Map<string, { count: number; hasLow: boolean }>(), currentProducts: allProducts };
    }

    const subs = new Map<string, { count: number; hasLow: boolean }>();
    const prods: Product[] = [];

    for (const p of allProducts) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];

      const matchesPath = activePath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && activePath.length > 0) continue;

      if (catParts.length > activePath.length) {
        const folderName = catParts[activePath.length];
        const existing = subs.get(folderName) || { count: 0, hasLow: false };
        existing.count++;
        if (p.stock <= p.minStock && p.minStock > 0) existing.hasLow = true;
        subs.set(folderName, existing);
      } else if (catParts.length === activePath.length) {
        prods.push(p);
      }
    }

    // Extra folders from API
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders) {
        const efParts = (ef.path || ef.name || '').split('/');
        const matchesPath = activePath.every((seg: string, i: number) => efParts[i] === seg);
        if (matchesPath && efParts.length > activePath.length) {
          const folderName = efParts[activePath.length];
          if (!subs.has(folderName)) {
            subs.set(folderName, { count: 0, hasLow: false });
          }
        }
      }
    }

    if (activePath.length === 0) {
      for (const p of allProducts) {
        if (!p.category && !prods.includes(p)) prods.push(p);
      }
    }

    return { subfolders: subs, currentProducts: prods };
  }, [allProducts, activePath, search, extraFolders]);

  const sortedFolders = Array.from(subfolders.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const enterFolder = (name: string) => setActivePath(prev => [...prev, name]);
  const goToLevel = (level: number) => setActivePath(prev => prev.slice(0, level));

  const openCreate = () => {
    setEditingProduct(null);
    setName(''); setCategory(activePath.join('/') || ''); setCostPrice(''); setSellPrice(''); setStock(''); setMinStock('');
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="cube" size={20} color={colors.primary[600]} />
          <Text style={styles.title}>Склад</Text>
        </View>
        {hasPermission('warehouse_access') && (
          <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
            <Ionicons name="add" size={18} color={colors.white} />
            <Text style={styles.addBtnText}>Новый</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Breadcrumb */}
      {activePath.length > 0 && !search && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => goToLevel(0)} style={styles.breadcrumbItem}>
            <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.breadcrumbText}>Все</Text>
          </TouchableOpacity>
          {activePath.map((seg, i) => (
            <React.Fragment key={i}>
              <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
              <TouchableOpacity onPress={() => goToLevel(i + 1)} style={styles.breadcrumbItem}>
                <Text style={[styles.breadcrumbText, i === activePath.length - 1 && styles.breadcrumbTextActive]}>
                  {seg}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      )}

      <View style={styles.searchWrap}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); if (v) setActivePath([]); }}
          placeholder="Поиск товара..."
        />
      </View>

      {isLoading ? (
        <LoadingSpinner />
      ) : !search && sortedFolders.length === 0 && currentProducts.length === 0 ? (
        <EmptyState
          title="Нет товаров"
          description={activePath.length > 0 ? 'В этой папке пусто' : 'Добавьте первый товар'}
          action={!activePath.length ? { label: 'Добавить', onPress: openCreate } : undefined}
        />
      ) : (
        <FlatList
          data={currentProducts}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const lowStock = item.stock <= item.minStock && item.minStock > 0;
            return (
              <AnimatedCard index={index} style={styles.productCard} onPress={() => openEdit(item)}>
                <View style={styles.productRow}>
                  {item.photo ? (
                    <Image source={{ uri: item.photo }} style={styles.productPhoto} resizeMode="cover" />
                  ) : (
                    <View style={styles.productPhotoPlaceholder}>
                      <Ionicons name="cube-outline" size={22} color={colors.gray[300]} />
                    </View>
                  )}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                    {item.category && !search && (
                      <Text style={styles.productCategory}>{item.category.split('/').pop()}</Text>
                    )}
                    <View style={styles.productPrices}>
                      <Text style={styles.productSellPrice}>{formatMoney(item.sellPrice)}</Text>
                      <Text style={styles.productCostPrice}>Себест. {formatMoney(item.costPrice)}</Text>
                    </View>
                  </View>
                  <View style={styles.productStockWrap}>
                    {lowStock && <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />}
                    <Text style={[styles.productStock, lowStock && styles.productStockLow]}>{item.stock}</Text>
                    <Text style={styles.productStockLabel}>шт</Text>
                  </View>
                </View>
              </AnimatedCard>
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
          ListHeaderComponent={
            !search && sortedFolders.length > 0 ? (
              <View style={styles.foldersGrid}>
                {sortedFolders.map(([folderName, info], idx) => (
                  <AnimatedCard key={folderName} index={idx} style={styles.folderCard} onPress={() => enterFolder(folderName)}>
                    <View style={styles.folderIconBox}>
                      <Ionicons name="folder-open-outline" size={24} color={colors.primary[500]} />
                    </View>
                    <Text style={styles.folderName} numberOfLines={1}>{folderName}</Text>
                    <Text style={styles.folderCount}>{info.count} шт</Text>
                    {info.hasLow && (
                      <View style={styles.folderAlert}>
                        <Ionicons name="alert-circle" size={14} color={colors.orange[500]} />
                      </View>
                    )}
                  </AnimatedCard>
                ))}
              </View>
            ) : null
          }
        />
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingProduct ? 'Редактировать товар' : 'Новый товар'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Название</Text>
          <TextInput value={name} onChangeText={setName} style={styles.formInput} placeholder="Масло моторное..." placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Категория (папка)</Text>
          <TextInput value={category} onChangeText={setCategory} style={styles.formInput} placeholder="Масла/Моторные" placeholderTextColor={colors.gray[400]} />
          <Text style={styles.formHint}>Используйте / для вложенности</Text>
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
              <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
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
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary[600], paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingBottom: spacing[2], flexWrap: 'wrap', gap: spacing[1] },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingVertical: 2 },
  breadcrumbText: { fontSize: fontSize.xs, color: colors.primary[600], fontWeight: fontWeight.medium },
  breadcrumbTextActive: { color: colors.gray[900], fontWeight: fontWeight.bold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[2] },
  foldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[4], paddingHorizontal: spacing[0.5] },
  folderCard: {
    width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3] - spacing[1]) / 2,
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[4], alignItems: 'center',
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  folderIconBox: { width: 48, height: 48, borderRadius: borderRadius.xl, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2] },
  folderName: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.gray[900], textAlign: 'center' },
  folderCount: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
  folderAlert: { position: 'absolute', top: spacing[2], right: spacing[2] },
  productCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3], shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  productPhoto: { width: 52, height: 52, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: { width: 52, height: 52, borderRadius: borderRadius.lg, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gray[100] },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  productCategory: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  productPrices: { flexDirection: 'row', gap: spacing[3], marginTop: 4 },
  productSellPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productCostPrice: { fontSize: fontSize.xs, color: colors.gray[400] },
  productStockWrap: { alignItems: 'center', minWidth: 36 },
  productStock: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productStockLow: { color: colors.red[500] },
  productStockLabel: { fontSize: 10, color: colors.gray[400] },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formHint: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  formRowFields: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deleteFormBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.red[50] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
