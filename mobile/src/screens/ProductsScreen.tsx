import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Image, Dimensions,
  Modal as RNModal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { productsApi, warehouseCategoriesApi, uploadsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
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
const SCREEN_HEIGHT = Dimensions.get('window').height;
const FOLDER_COLS = 3;
const FOLDER_GAP = spacing[2];
const FOLDER_WIDTH = (SCREEN_WIDTH - spacing[4] * 2 - FOLDER_GAP * (FOLDER_COLS - 1)) / FOLDER_COLS;

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD'; }

export default function ProductsScreen() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const limit = 500;
  const [refreshing, setRefreshing] = useState(false);
  const [activePath, setActivePath] = useState<string[]>([]);

  // Product create/edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null); // local image URI or existing server path
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showOpsModal, setShowOpsModal] = useState(false);

  // Fullscreen photo view
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  // Inventory modal state
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryItems, setInventoryItems] = useState<{ productId: string; name: string; currentStock: number; actualStock: string }[]>([]);
  const [inventoryReason, setInventoryReason] = useState('');
  const [showInventoryPicker, setShowInventoryPicker] = useState(false);
  const [inventoryPickerSearch, setInventoryPickerSearch] = useState('');

  // Writeoff modal state
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [writeoffProductId, setWriteoffProductId] = useState('');
  const [writeoffProductName, setWriteoffProductName] = useState('');
  const [writeoffProductStock, setWriteoffProductStock] = useState(0);
  const [writeoffQty, setWriteoffQty] = useState('');
  const [writeoffReason, setWriteoffReason] = useState('');
  const [writeoffSearch, setWriteoffSearch] = useState('');
  const [writeoffStep, setWriteoffStep] = useState<'select' | 'form'>('select');
  const [showWriteoffPicker, setShowWriteoffPicker] = useState(false);

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
    onError: () => Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0442\u043E\u0432\u0430\u0440\u0430'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); closeModal(); },
    onError: () => Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: () => Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438'),
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { type: 'income' | 'expense' | 'writeoff' | 'inventory'; quantity: number; reason?: string } }) =>
      productsApi.updateStock(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); },
    onError: (err: any) => Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', err?.response?.data?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0430'),
  });

  const allProducts = data?.data || [];

  // Stats
  const warehouseStats = useMemo(() => {
    let costTotal = 0;
    let sellTotal = 0;
    for (const p of allProducts) {
      costTotal += (p.costPrice || 0) * (p.stock || 0);
      sellTotal += (p.sellPrice || 0) * (p.stock || 0);
    }
    return { costTotal, sellTotal, count: allProducts.length };
  }, [allProducts]);

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

  // --- Image picking ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const openCreate = () => {
    setEditingProduct(null);
    setName(''); setCategory(activePath.join('/') || ''); setCostPrice(''); setSellPrice(''); setStock(''); setMinStock('');
    setPhotoUri(null);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name); setCategory(p.category || ''); setCostPrice(String(p.costPrice)); setSellPrice(String(p.sellPrice));
    setStock(String(p.stock)); setMinStock(String(p.minStock));
    setPhotoUri(p.photo ? (p.photo.startsWith('http') ? p.photo : p.photo) : null);
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingProduct(null); setPhotoUri(null); };

  const handleSubmit = async () => {
    let uploadedPhotoPath = editingProduct?.photo || undefined;

    // Upload new photo if it's a local file URI
    if (photoUri && photoUri.startsWith('file://')) {
      try {
        setUploadingPhoto(true);
        const filename = photoUri.split('/').pop() || 'photo.jpg';
        const res = await uploadsApi.upload(photoUri, filename);
        uploadedPhotoPath = res.data.url;
      } catch {
        Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0444\u043E\u0442\u043E');
        setUploadingPhoto(false);
        return;
      }
      setUploadingPhoto(false);
    } else if (!photoUri) {
      uploadedPhotoPath = undefined; // photo was removed
    }

    const payload = {
      name, category: category || undefined,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0,
      stock: Number(stock) || 0, minStock: Number(minStock) || 0,
      photo: uploadedPhotoPath,
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

  // --- Inventory handlers ---
  const openInventory = () => {
    setShowOpsModal(false);
    setInventorySearch('');
    setInventoryReason('\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F');
    // Pre-fill all products with current stock
    setInventoryItems(allProducts.map(p => ({
      productId: p.id,
      name: p.name,
      currentStock: p.stock,
      actualStock: String(p.stock),
    })));
    setShowInventoryModal(true);
  };

  const handleInventorySubmit = async () => {
    const changed = inventoryItems.filter(item => String(item.currentStock) !== item.actualStock);
    if (changed.length === 0) {
      Alert.alert('\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F', '\u041D\u0435\u0442 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u0432 \u043E\u0441\u0442\u0430\u0442\u043A\u0430\u0445');
      return;
    }

    try {
      for (const item of changed) {
        await productsApi.updateStock(item.productId, {
          type: 'inventory' as const,
          quantity: Number(item.actualStock) || 0,
          reason: inventoryReason || undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowInventoryModal(false);
      Alert.alert('\u0413\u043E\u0442\u043E\u0432\u043E', `\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u043E: ${changed.length} \u0442\u043E\u0432\u0430\u0440\u043E\u0432`);
    } catch (err: any) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', err?.response?.data?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u0438');
    }
  };

  const filteredInventoryItems = inventorySearch
    ? inventoryItems.filter(item => item.name.toLowerCase().includes(inventorySearch.toLowerCase()))
    : inventoryItems;

  // --- Writeoff handlers ---
  const openWriteoff = () => {
    setShowOpsModal(false);
    setWriteoffStep('select');
    setWriteoffSearch('');
    setWriteoffProductId('');
    setWriteoffProductName('');
    setWriteoffProductStock(0);
    setWriteoffQty('');
    setWriteoffReason('');
    setShowWriteoffPicker(true);
  };

  const selectWriteoffProduct = (p: Product) => {
    setWriteoffProductId(p.id);
    setWriteoffProductName(p.name);
    setWriteoffProductStock(p.stock);
    setWriteoffQty('');
    setWriteoffReason('');
    setShowWriteoffPicker(false);
    setWriteoffStep('form');
    setShowWriteoffModal(true);
  };

  const handleWriteoffSubmit = async () => {
    const qty = Number(writeoffQty);
    if (!qty || qty <= 0) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E');
      return;
    }
    if (qty > writeoffProductStock) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', `\u041D\u0435\u043B\u044C\u0437\u044F \u0441\u043F\u0438\u0441\u0430\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u0447\u0435\u043C \u0435\u0441\u0442\u044C \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 (${writeoffProductStock})`);
      return;
    }
    if (!writeoffReason.trim()) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0440\u0438\u0447\u0438\u043D\u0443 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F');
      return;
    }

    try {
      await productsApi.updateStock(writeoffProductId, {
        type: 'writeoff' as const,
        quantity: qty,
        reason: writeoffReason.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowWriteoffModal(false);
      Alert.alert('\u0413\u043E\u0442\u043E\u0432\u043E', `\u0421\u043F\u0438\u0441\u0430\u043D\u043E ${qty} \u0448\u0442. "${writeoffProductName}"`);
    } catch (err: any) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', err?.response?.data?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0438');
    }
  };

  const filteredWriteoffProducts = writeoffSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(writeoffSearch.toLowerCase()))
    : allProducts;

  const filteredInventoryPickerProducts = inventoryPickerSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(inventoryPickerSearch.toLowerCase()))
    : allProducts;

  const addInventoryProduct = (p: Product) => {
    // Only add if not already in the list
    if (!inventoryItems.find(item => item.productId === p.id)) {
      setInventoryItems(prev => [...prev, {
        productId: p.id,
        name: p.name,
        currentStock: p.stock,
        actualStock: String(p.stock),
      }]);
    }
    setShowInventoryPicker(false);
    setInventoryPickerSearch('');
  };

  // Photo display helper
  const getDisplayPhotoUri = (photo: string | null | undefined): string | undefined => {
    if (!photo) return undefined;
    if (photo.startsWith('file://')) return photo;
    return getImageUrl(photo);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header with title + action buttons */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <Ionicons name="cube" size={20} color={colors.primary[600]} />
          <Text style={styles.title}>{'\u0421\u043A\u043B\u0430\u0434'}</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{warehouseStats.count} {'\u0442\u043E\u0432\u0430\u0440\u043E\u0432'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {hasPermission('warehouse_access') && (
            <TouchableOpacity style={styles.opsBtn} onPress={() => setShowOpsModal(true)}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.orange[600]} />
            </TouchableOpacity>
          )}
          {hasPermission('warehouse_access') && (
            <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
              <Ionicons name="add" size={18} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Stats cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{'\u0421\u0415\u0411\u0415\u0421\u0422\u041E\u0418\u041C\u041E\u0421\u0422\u042C \u0421\u041A\u041B\u0410\u0414\u0410'}</Text>
          <Text style={styles.statValue}>{formatMoney(warehouseStats.costTotal)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{'\u0412 \u0420\u041E\u0417\u041D. \u0426\u0415\u041D\u0410\u0425'}</Text>
          <Text style={styles.statValue}>{formatMoney(warehouseStats.sellTotal)}</Text>
        </View>
      </View>

      {/* Breadcrumb */}
      {activePath.length > 0 && !search && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => goToLevel(0)} style={styles.breadcrumbItem}>
            <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.breadcrumbText}>{'\u0412\u0441\u0435'}</Text>
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
          placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
        />
      </View>

      {isLoading ? (
        <LoadingSpinner />
      ) : !search && sortedFolders.length === 0 && currentProducts.length === 0 ? (
        <EmptyState
          title={'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}
          description={activePath.length > 0 ? '\u0412 \u044D\u0442\u043E\u0439 \u043F\u0430\u043F\u043A\u0435 \u043F\u0443\u0441\u0442\u043E' : '\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440'}
          action={!activePath.length ? { label: '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', onPress: openCreate } : undefined}
        />
      ) : (
        <FlatList
          data={currentProducts}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const lowStock = item.stock <= item.minStock && item.minStock > 0;
            const pUri = getImageUrl(item.photo);
            return (
              <AnimatedCard index={index} style={styles.productCard} onPress={() => openEdit(item)}>
                <View style={styles.productRow}>
                  <TouchableOpacity onPress={() => { if (pUri) setFullscreenPhoto(pUri); }}>
                    {pUri ? (
                      <Image source={{ uri: pUri }} style={styles.productPhoto} resizeMode="cover" />
                    ) : (
                      <View style={styles.productPhotoPlaceholder}>
                        <Ionicons name="cube-outline" size={22} color={colors.gray[300]} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                    {item.category && !search && (
                      <Text style={styles.productCategory}>{item.category.split('/').pop()}</Text>
                    )}
                    <View style={styles.productPrices}>
                      <Text style={styles.productSellPrice}>{formatMoney(item.sellPrice)}</Text>
                      <Text style={styles.productCostPrice}>{'\u0421\u0435\u0431\u0435\u0441\u0442.'} {formatMoney(item.costPrice)}</Text>
                    </View>
                  </View>
                  <View style={styles.productStockWrap}>
                    {lowStock && <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />}
                    <Text style={[styles.productStock, lowStock && styles.productStockLow]}>{item.stock}</Text>
                    <Text style={styles.productStockLabel}>{'\u0448\u0442'}</Text>
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
                      <Ionicons name="folder-open-outline" size={22} color={colors.primary[500]} />
                    </View>
                    <Text style={styles.folderName} numberOfLines={2}>{folderName}</Text>
                    <Text style={styles.folderCount}>{info.count} {'\u0448\u0442'}</Text>
                    {info.hasLow && (
                      <View style={styles.folderAlert}>
                        <Ionicons name="alert-circle" size={12} color={colors.orange[500]} />
                      </View>
                    )}
                  </AnimatedCard>
                ))}
              </View>
            ) : null
          }
        />
      )}

      {/* Create/Edit Modal with photo upload */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingProduct ? '\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u043E\u0432\u0430\u0440' : '\u041D\u043E\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440'}>
        {/* Photo section */}
        <View style={styles.photoSection}>
          <TouchableOpacity style={styles.photoPickerWrap} onPress={pickImage}>
            {photoUri ? (
              <Image source={{ uri: getDisplayPhotoUri(photoUri) }} style={styles.photoPreview} resizeMode="cover" />
            ) : (
              <View style={styles.photoPickerPlaceholder}>
                <Ionicons name="camera-outline" size={28} color={colors.gray[400]} />
                <Text style={styles.photoPickerText}>{'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0444\u043E\u0442\u043E'}</Text>
              </View>
            )}
          </TouchableOpacity>
          {photoUri && (
            <View style={styles.photoActions}>
              <TouchableOpacity style={styles.photoActionBtn} onPress={pickImage}>
                <Ionicons name="swap-horizontal" size={16} color={colors.primary[600]} />
                <Text style={styles.photoActionText}>{'\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoActionBtn} onPress={() => setFullscreenPhoto(getDisplayPhotoUri(photoUri)!)}>
                <Ionicons name="expand-outline" size={16} color={colors.primary[600]} />
                <Text style={styles.photoActionText}>{'\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoActionBtn} onPress={() => setPhotoUri(null)}>
                <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
                <Text style={[styles.photoActionText, { color: colors.red[500] }]}>{'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435'}</Text>
          <TextInput value={name} onChangeText={setName} style={styles.formInput} placeholder={'\u041C\u0430\u0441\u043B\u043E \u043C\u043E\u0442\u043E\u0440\u043D\u043E\u0435...'} placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F (\u043F\u0430\u043F\u043A\u0430)'}</Text>
          <TextInput value={category} onChangeText={setCategory} style={styles.formInput} placeholder={'\u041C\u0430\u0441\u043B\u0430/\u041C\u043E\u0442\u043E\u0440\u043D\u044B\u0435'} placeholderTextColor={colors.gray[400]} />
          <Text style={styles.formHint}>{'\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 / \u0434\u043B\u044F \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438'}</Text>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C'}</Text>
            <TextInput value={costPrice} onChangeText={setCostPrice} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u0426\u0435\u043D\u0430 \u043F\u0440\u043E\u0434\u0430\u0436\u0438'}</Text>
            <TextInput value={sellPrice} onChangeText={setSellPrice} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u041E\u0441\u0442\u0430\u0442\u043E\u043A'}</Text>
            <TextInput value={stock} onChangeText={setStock} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u041C\u0438\u043D. \u043E\u0441\u0442\u0430\u0442\u043E\u043A'}</Text>
            <TextInput value={minStock} onChangeText={setMinStock} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
          </View>
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>{'\u041E\u0442\u043C\u0435\u043D\u0430'}</Text>
          </TouchableOpacity>
          {editingProduct && (
            <TouchableOpacity style={styles.deleteFormBtn} onPress={() => { setDeleteId(editingProduct.id); closeModal(); }}>
              <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {(createMutation.isPending || updateMutation.isPending || uploadingPhoto) ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingProduct ? '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C' : '\u0421\u043E\u0437\u0434\u0430\u0442\u044C'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Warehouse Operations Modal */}
      <Modal visible={showOpsModal} onClose={() => setShowOpsModal(false)} title={'\u0421\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438'}>
        <TouchableOpacity style={styles.opsItem} onPress={openInventory}>
          <View style={[styles.opsIcon, { backgroundColor: colors.blue[50] }]}>
            <Ionicons name="clipboard-outline" size={22} color={colors.blue[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opsItemTitle}>{'\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F'}</Text>
            <Text style={styles.opsItemDesc}>{'\u041F\u0435\u0440\u0435\u0441\u0447\u0451\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.opsItem} onPress={openWriteoff}>
          <View style={[styles.opsIcon, { backgroundColor: colors.red[50] }]}>
            <Ionicons name="trash-outline" size={22} color={colors.red[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opsItemTitle}>{'\u0421\u043F\u0438\u0441\u0430\u043D\u0438\u0435'}</Text>
            <Text style={styles.opsItemDesc}>{'\u0421\u043F\u0438\u0441\u0430\u0442\u044C \u0431\u0440\u0430\u043A, \u043F\u043E\u0442\u0435\u0440\u0438, \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u043A\u0443'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
        </TouchableOpacity>
      </Modal>

      {/* Inventory Modal */}
      <Modal visible={showInventoryModal} onClose={() => setShowInventoryModal(false)} title={'\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'\u041F\u0440\u0438\u0447\u0438\u043D\u0430'}</Text>
          <TextInput
            value={inventoryReason}
            onChangeText={setInventoryReason}
            style={styles.formInput}
            placeholder={'\u041F\u043B\u0430\u043D\u043E\u0432\u0430\u044F \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F'}
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <TextInput
            value={inventorySearch}
            onChangeText={setInventorySearch}
            style={styles.formInput}
            placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
            placeholderTextColor={colors.gray[400]}
          />
        </View>

        <TouchableOpacity
          style={styles.addProductBtn}
          onPress={() => { setInventoryPickerSearch(''); setShowInventoryPicker(true); }}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
          <Text style={styles.addProductBtnText}>{'Добавить товар'}</Text>
        </TouchableOpacity>

        <View style={styles.invHeader}>
          <Text style={[styles.invHeaderText, { flex: 1 }]}>{'Товар'}</Text>
          <Text style={[styles.invHeaderText, { width: 55, textAlign: 'center' }]}>{'Было'}</Text>
          <Text style={[styles.invHeaderText, { width: 70, textAlign: 'center' }]}>{'Факт'}</Text>
        </View>

        {filteredInventoryItems.map((item, idx) => {
          const diff = (Number(item.actualStock) || 0) - item.currentStock;
          return (
            <View key={item.productId} style={styles.invRow}>
              <Text style={styles.invName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.invWas}>{item.currentStock}</Text>
              <TextInput
                value={item.actualStock}
                onChangeText={(v) => {
                  setInventoryItems(prev => prev.map((it, i) =>
                    it.productId === item.productId ? { ...it, actualStock: v } : it
                  ));
                }}
                style={[styles.invInput, diff !== 0 && (diff > 0 ? styles.invInputPlus : styles.invInputMinus)]}
                keyboardType="numeric"
              />
            </View>
          );
        })}

        <View style={[styles.formActions, { marginTop: spacing[4] }]}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowInventoryModal(false)}>
            <Text style={styles.cancelBtnText}>{'\u041E\u0442\u043C\u0435\u043D\u0430'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleInventorySubmit}>
            <Text style={styles.submitBtnText}>{'\u041F\u0440\u043E\u0432\u0435\u0441\u0442\u0438'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Inventory Product Picker - 80% bottom sheet */}
      <RNModal visible={showInventoryPicker} transparent animationType="fade" onRequestClose={() => setShowInventoryPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowInventoryPicker(false)} />
          <View style={styles.bottomSheet}>
            <View style={styles.bottomSheetHandle} />
            <Text style={styles.bottomSheetTitle}>{'Добавить товар в инвентаризацию'}</Text>
            <View style={{ paddingHorizontal: spacing[4], marginBottom: spacing[3] }}>
              <TextInput
                value={inventoryPickerSearch}
                onChangeText={setInventoryPickerSearch}
                style={styles.formInput}
                placeholder={'Поиск товара...'}
                placeholderTextColor={colors.gray[400]}
                autoFocus
              />
            </View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {filteredInventoryPickerProducts.map(p => {
                const alreadyAdded = inventoryItems.some(item => item.productId === p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.bottomSheetItem, alreadyAdded && { opacity: 0.5 }]}
                    onPress={() => addInventoryProduct(p)}
                    disabled={alreadyAdded}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.writeoffItemName}>{p.name}</Text>
                      <Text style={styles.writeoffItemStock}>{'Остаток: '}{p.stock} {'шт'}{alreadyAdded ? ' (уже добавлен)' : ''}</Text>
                    </View>
                    {!alreadyAdded && <Ionicons name="add-circle-outline" size={20} color={colors.primary[600]} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </RNModal>

      {/* Writeoff Product Picker - 80% bottom sheet */}
      <RNModal visible={showWriteoffPicker} transparent animationType="fade" onRequestClose={() => setShowWriteoffPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowWriteoffPicker(false)} />
          <View style={styles.bottomSheet}>
            <View style={styles.bottomSheetHandle} />
            <Text style={styles.bottomSheetTitle}>{'Выберите товар для списания'}</Text>
            <View style={{ paddingHorizontal: spacing[4], marginBottom: spacing[3] }}>
              <TextInput
                value={writeoffSearch}
                onChangeText={setWriteoffSearch}
                style={styles.formInput}
                placeholder={'Поиск товара...'}
                placeholderTextColor={colors.gray[400]}
                autoFocus
              />
            </View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {filteredWriteoffProducts.map(p => (
                <TouchableOpacity key={p.id} style={styles.bottomSheetItem} onPress={() => selectWriteoffProduct(p)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.writeoffItemName}>{p.name}</Text>
                    <Text style={styles.writeoffItemStock}>{'Остаток: '}{p.stock} {'шт'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </RNModal>

      {/* Writeoff Form Modal */}
      <Modal visible={showWriteoffModal} onClose={() => setShowWriteoffModal(false)} title={'Списание товара'}>
        <View style={styles.writeoffSelectedProduct}>
          <Ionicons name="cube-outline" size={20} color={colors.primary[600]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.writeoffSelectedName}>{writeoffProductName}</Text>
            <Text style={styles.writeoffSelectedStock}>{'На складе: '}{writeoffProductStock} {'шт'}</Text>
          </View>
          <TouchableOpacity onPress={() => { setShowWriteoffModal(false); setWriteoffSearch(''); setShowWriteoffPicker(true); }}>
            <Text style={{ fontSize: fontSize.xs, color: colors.primary[600] }}>{'Изменить'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Количество к списанию'}</Text>
          <TextInput
            value={writeoffQty}
            onChangeText={setWriteoffQty}
            style={styles.formInput}
            keyboardType="numeric"
            placeholder={`Макс: ${writeoffProductStock}`}
            placeholderTextColor={colors.gray[400]}
            autoFocus
          />
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Причина списания *'}</Text>
          <TextInput
            value={writeoffReason}
            onChangeText={setWriteoffReason}
            style={[styles.formInput, { minHeight: 56, textAlignVertical: 'top' }]}
            multiline
            placeholder={'Брак, порча, просрочка...'}
            placeholderTextColor={colors.gray[400]}
          />
        </View>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowWriteoffModal(false)}>
            <Text style={styles.cancelBtnText}>{'Отмена'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.red[600] }]} onPress={handleWriteoffSubmit}>
            <Text style={styles.submitBtnText}>{'Списать'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Fullscreen Photo Viewer */}
      <RNModal visible={!!fullscreenPhoto} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <View style={styles.fullscreenOverlay}>
          <TouchableOpacity style={styles.fullscreenClose} onPress={() => setFullscreenPhoto(null)}>
            <Ionicons name="close" size={28} color={colors.white} />
          </TouchableOpacity>
          {fullscreenPhoto && (
            <Image
              source={{ uri: fullscreenPhoto }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </RNModal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440'}
        message={'\u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B?'}
        confirmText={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  countBadge: { backgroundColor: colors.gray[100], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  countBadgeText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[500] },
  opsBtn: { width: 36, height: 36, borderRadius: borderRadius.xl, backgroundColor: colors.orange[50], alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 36, height: 36, borderRadius: borderRadius.xl, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  statCard: { flex: 1, backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3], alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: fontWeight.semibold, color: colors.gray[400], letterSpacing: 0.5 },
  statValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 2 },
  // Breadcrumb
  breadcrumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingBottom: spacing[2], flexWrap: 'wrap', gap: spacing[1] },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingVertical: 2 },
  breadcrumbText: { fontSize: fontSize.xs, color: colors.primary[600], fontWeight: fontWeight.medium },
  breadcrumbTextActive: { color: colors.gray[900], fontWeight: fontWeight.bold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[2] },
  // Folders - 3 cols
  foldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: FOLDER_GAP, marginBottom: spacing[4] },
  folderCard: {
    width: FOLDER_WIDTH,
    backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[3], alignItems: 'center',
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  folderIconBox: { width: 40, height: 40, borderRadius: borderRadius.lg, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1.5] },
  folderName: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[900], textAlign: 'center', lineHeight: 14 },
  folderCount: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  folderAlert: { position: 'absolute', top: spacing[1.5], right: spacing[1.5] },
  // Products
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
  // Photo section in form
  photoSection: { marginBottom: spacing[4], alignItems: 'center' },
  photoPickerWrap: { width: 100, height: 100, borderRadius: borderRadius.xl, overflow: 'hidden', borderWidth: 2, borderColor: colors.gray[200], borderStyle: 'dashed' },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray[50] },
  photoPickerText: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  photoActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2] },
  photoActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing[1], paddingHorizontal: spacing[2] },
  photoActionText: { fontSize: 12, color: colors.primary[600], fontWeight: fontWeight.medium },
  // Form
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
  // Ops modal
  opsItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  opsIcon: { width: 44, height: 44, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  opsItemTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  opsItemDesc: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  // Inventory
  invHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  invHeaderText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500], textTransform: 'uppercase' },
  invRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  invName: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], marginRight: spacing[2] },
  invWas: { width: 55, textAlign: 'center', fontSize: fontSize.sm, color: colors.gray[400] },
  invInput: { width: 70, backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5], fontSize: fontSize.sm, color: colors.gray[900], textAlign: 'center' },
  invInputPlus: { borderColor: colors.green[400], backgroundColor: colors.green[50] },
  invInputMinus: { borderColor: colors.red[400], backgroundColor: colors.red[50] },
  // Writeoff
  writeoffItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  writeoffItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  writeoffItemStock: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  writeoffSelectedProduct: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: colors.primary[50], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[4] },
  writeoffSelectedName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  writeoffSelectedStock: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  // Bottom sheet (80% product picker)
  bottomSheet: { height: SCREEN_HEIGHT * 0.8, backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  bottomSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.gray[200], alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  bottomSheetTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  bottomSheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], paddingHorizontal: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  // Add product button (inventory)
  addProductBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], marginBottom: spacing[3], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.primary[200], borderStyle: 'dashed', backgroundColor: colors.primary[50] },
  addProductBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary[600] },
  // Fullscreen photo
  fullscreenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullscreenClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  fullscreenImage: { width: SCREEN_WIDTH - 40, height: SCREEN_HEIGHT * 0.7 },
});
