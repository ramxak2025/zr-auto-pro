import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, Image, Dimensions,
  Modal as RNModal,
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
import ProductPickerModal from '../components/ProductPickerModal';
import type { FolderAnnotation } from '../components/ProductPickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Product, PaginatedResponse, StockMovement } from '../../../shared/types';

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

  // Inventory folder navigation (separate from main warehouse)
  const [invActivePath, setInvActivePath] = useState<string[]>([]);

  // Writeoff modal state
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [writeoffProductId, setWriteoffProductId] = useState('');
  const [writeoffProductName, setWriteoffProductName] = useState('');
  const [writeoffProductStock, setWriteoffProductStock] = useState(0);
  const [writeoffQty, setWriteoffQty] = useState('');
  const [writeoffReason, setWriteoffReason] = useState('');
  const [showWriteoffPicker, setShowWriteoffPicker] = useState(false);

  // Correction modal state
  const [showCorrectionPicker, setShowCorrectionPicker] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionProductId, setCorrectionProductId] = useState('');
  const [correctionProductName, setCorrectionProductName] = useState('');
  const [correctionProductStock, setCorrectionProductStock] = useState(0);
  const [correctionProductCostPrice, setCorrectionProductCostPrice] = useState(0);
  const [correctionNewStock, setCorrectionNewStock] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { search, limit }],
    queryFn: async () => { const res = await productsApi.getAll({ search, page: 1, limit }); return res.data; },
  });

  const { data: extraFolders } = useQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => { const res = await warehouseCategoriesApi.getAll(); return res.data; },
  });

  // Fetch inventory movements for folder annotations (always enabled)
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => { const res = await productsApi.getMovements({ limit: 1000 }); return res.data; },
    staleTime: 60_000,
  });

  // Map: productId -> last inventory check date
  const lastInventoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!inventoryMovements) return map;
    for (const m of inventoryMovements as any[]) {
      if (m.type !== 'inventory') continue;
      const existing = map.get(m.productId);
      if (!existing || new Date(m.createdAt) > new Date(existing)) {
        map.set(m.productId, m.createdAt);
      }
    }
    return map;
  }, [inventoryMovements]);

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

  // Compute folder annotations: last inventory date per folder
  const inventoryAnnotations = useMemo(() => {
    const annotations = new Map<string, FolderAnnotation>();
    if (!inventoryMovements || !allProducts.length) return annotations;

    const inventoryMoves = inventoryMovements.filter(m => m.type === 'inventory');
    const lastInvByProduct = new Map<string, Date>();
    for (const m of inventoryMoves) {
      const d = new Date(m.createdAt);
      const existing = lastInvByProduct.get(m.productId);
      if (!existing || d > existing) lastInvByProduct.set(m.productId, d);
    }

    const folderProducts = new Map<string, string[]>();
    for (const p of allProducts) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];
      if (catParts.length > 0) {
        const topFolder = catParts[0];
        if (!folderProducts.has(topFolder)) folderProducts.set(topFolder, []);
        folderProducts.get(topFolder)!.push(p.id);
      }
    }

    for (const [folder, productIds] of folderProducts) {
      const dates = productIds.map(id => lastInvByProduct.get(id)).filter(Boolean) as Date[];
      if (dates.length > 0) {
        const oldest = new Date(Math.min(...dates.map(d => d.getTime())));
        const formatted = oldest.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const allChecked = dates.length === productIds.length;
        annotations.set(folder, {
          label: allChecked ? `Проверено: ${formatted}` : `Частично: ${formatted}`,
          color: allChecked ? colors.green[600] : colors.orange[500],
        });
      } else {
        annotations.set(folder, { label: 'Не проверено', color: colors.gray[400] });
      }
    }

    return annotations;
  }, [inventoryMovements, allProducts]);

  // Per-product last inventory date map
  const lastInventoryByProduct = useMemo(() => {
    const map = new Map<string, Date>();
    if (!inventoryMovements) return map;
    const inventoryMoves = inventoryMovements.filter(m => m.type === 'inventory');
    for (const m of inventoryMoves) {
      const d = new Date(m.createdAt);
      const existing = map.get(m.productId);
      if (!existing || d > existing) map.set(m.productId, d);
    }
    return map;
  }, [inventoryMovements]);

  // Inventory folder structure (separate from main warehouse)
  const { invSubfolders, invCurrentProducts } = useMemo(() => {
    if (inventorySearch) {
      const filtered = allProducts.filter(p => p.name.toLowerCase().includes(inventorySearch.toLowerCase()));
      return { invSubfolders: new Map<string, { count: number }>(), invCurrentProducts: filtered };
    }

    const subs = new Map<string, { count: number }>();
    const prods: Product[] = [];

    for (const p of allProducts) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];

      const matchesPath = invActivePath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && invActivePath.length > 0) continue;

      if (catParts.length > invActivePath.length) {
        const folderName = catParts[invActivePath.length];
        const existing = subs.get(folderName) || { count: 0 };
        existing.count++;
        subs.set(folderName, existing);
      } else if (catParts.length === invActivePath.length) {
        prods.push(p);
      }
    }

    // Extra folders from API
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders) {
        const efParts = (ef.path || (ef as any).name || '').split('/');
        const matchesPath = invActivePath.every((seg: string, i: number) => efParts[i] === seg);
        if (matchesPath && efParts.length > invActivePath.length) {
          const folderName = efParts[invActivePath.length];
          if (!subs.has(folderName)) {
            subs.set(folderName, { count: 0 });
          }
        }
      }
    }

    if (invActivePath.length === 0) {
      for (const p of allProducts) {
        if (!p.category && !prods.includes(p)) prods.push(p);
      }
    }

    return { invSubfolders: subs, invCurrentProducts: prods };
  }, [allProducts, invActivePath, inventorySearch, extraFolders]);

  const invSortedFolders = Array.from(invSubfolders.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // Green highlight: check if folder has all products inventoried in last 24h
  const isFolderFullyChecked24h = (folderName: string): boolean => {
    const now = Date.now();
    const h24 = 24 * 60 * 60 * 1000;
    const prefix = [...invActivePath, folderName].join('/');
    const folderProducts = allProducts.filter(p => {
      const cat = p.category || '';
      return cat === prefix || cat.startsWith(prefix + '/');
    });
    if (folderProducts.length === 0) return false;
    return folderProducts.every(p => {
      const d = lastInventoryByProduct.get(p.id);
      return d && (now - d.getTime()) < h24;
    });
  };

  // Check if a product was counted in the current inventory session
  const isProductCountedInSession = (productId: string): boolean => {
    const item = inventoryItems.find(it => it.productId === productId);
    return !!item && item.actualStock !== String(item.currentStock);
  };

  // Get last inventory date for a product (for >24h display)
  const getProductLastInvDate = (productId: string): string | null => {
    const d = lastInventoryByProduct.get(productId);
    if (!d) return null;
    const now = Date.now();
    const h24 = 24 * 60 * 60 * 1000;
    if ((now - d.getTime()) >= h24) {
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
    return null;
  };

  // Is product checked within 24h (green tint)
  const isProductChecked24h = (productId: string): boolean => {
    const d = lastInventoryByProduct.get(productId);
    if (!d) return false;
    return (Date.now() - d.getTime()) < 24 * 60 * 60 * 1000;
  };

  // Inventory summary
  const inventorySummary = useMemo(() => {
    const checked = inventoryItems.filter(item => item.actualStock !== '' && item.actualStock !== String(item.currentStock));
    const total = inventoryItems.filter(item => item.actualStock !== '');
    let shortageAmount = 0;
    let excessAmount = 0;
    for (const item of checked) {
      const diff = (Number(item.actualStock) || 0) - item.currentStock;
      const product = allProducts.find(p => p.id === item.productId);
      const cost = product?.costPrice || 0;
      if (diff < 0) {
        shortageAmount += Math.abs(diff) * cost;
      } else if (diff > 0) {
        excessAmount += diff * cost;
      }
    }
    return { checkedCount: total.length, changedCount: checked.length, shortageAmount, excessAmount };
  }, [inventoryItems, allProducts]);

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
        const efParts = (ef.path || (ef as any).name || '').split('/');
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

  // Folder -> last inventory check date
  const folderLastCheck = useMemo(() => {
    const map = new Map<string, string>();
    if (lastInventoryMap.size === 0) return map;
    const prefix = activePath.length > 0 ? activePath.join('/') : '';
    const list = allProducts as any[];
    for (const [folderName] of sortedFolders) {
      const folderPrefix = prefix ? `${prefix}/${folderName}` : folderName;
      let latest: string | undefined;
      for (const p of list) {
        const cat = p.category || '';
        if (cat === folderPrefix || cat.startsWith(folderPrefix + '/')) {
          const d = lastInventoryMap.get(p.id);
          if (d && (!latest || new Date(d) > new Date(latest))) latest = d;
        }
      }
      if (latest) map.set(folderName, latest);
    }
    return map;
  }, [lastInventoryMap, sortedFolders, allProducts, activePath]);

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
    setInventoryReason('Инвентаризация');
    setInvActivePath([]);
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
      Alert.alert('Инвентаризация', 'Нет изменений в остатках');
      return;
    }

    // Compute shortage/excess totals
    let shortageTotal = 0;
    let excessTotal = 0;
    for (const item of changed) {
      const diff = (Number(item.actualStock) || 0) - item.currentStock;
      const product = allProducts.find(p => p.id === item.productId);
      const cost = product?.costPrice || 0;
      if (diff < 0) shortageTotal += Math.abs(diff) * cost;
      else if (diff > 0) excessTotal += diff * cost;
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
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      setShowInventoryModal(false);
      Alert.alert('Готово', `Инвентаризация завершена. Изменено: ${changed.length} товаров. Недостача: ${formatMoney(shortageTotal)}, Излишки: ${formatMoney(excessTotal)}`);
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка при инвентаризации');
    }
  };

  const filteredInventoryItems = inventorySearch
    ? inventoryItems.filter(item => item.name.toLowerCase().includes(inventorySearch.toLowerCase()))
    : inventoryItems;

  // --- Writeoff handlers ---
  const openWriteoff = () => {
    setShowOpsModal(false);
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
  };

  const handleInventoryPickerClose = () => {
    setShowInventoryPicker(false);
    setTimeout(() => setShowInventoryModal(true), 300);
  };

  // --- Correction handlers ---
  const openCorrection = () => {
    setShowOpsModal(false);
    setCorrectionProductId('');
    setCorrectionProductName('');
    setCorrectionProductStock(0);
    setCorrectionProductCostPrice(0);
    setCorrectionNewStock('');
    setCorrectionReason('');
    setShowCorrectionPicker(true);
  };

  const selectCorrectionProduct = (p: Product) => {
    setCorrectionProductId(p.id);
    setCorrectionProductName(p.name);
    setCorrectionProductStock(p.stock);
    setCorrectionProductCostPrice(p.costPrice || 0);
    setCorrectionNewStock(String(p.stock));
    setCorrectionReason('');
    setShowCorrectionPicker(false);
    setShowCorrectionModal(true);
  };

  const handleCorrectionSubmit = async () => {
    const newQty = Number(correctionNewStock);
    if (isNaN(newQty) || newQty < 0) {
      Alert.alert('Ошибка', 'Укажите корректное количество');
      return;
    }
    if (newQty === correctionProductStock) {
      Alert.alert('Корректировка', 'Остаток не изменён');
      return;
    }
    if (!correctionReason.trim()) {
      Alert.alert('Ошибка', 'Укажите причину корректировки');
      return;
    }

    try {
      await productsApi.updateStock(correctionProductId, {
        type: 'inventory' as const,
        quantity: newQty,
        reason: correctionReason.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      setShowCorrectionModal(false);
      const diff = newQty - correctionProductStock;
      Alert.alert('Готово', `Остаток "${correctionProductName}" скорректирован: ${correctionProductStock} → ${newQty} (${diff > 0 ? '+' : ''}${diff})`);
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка при корректировке');
    }
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
              <View style={styles.foldersList}>
                {sortedFolders.map(([folderName, info], idx) => (
                  <TouchableOpacity key={folderName} style={styles.folderRow} onPress={() => enterFolder(folderName)} activeOpacity={0.6}>
                    <View style={styles.folderIconBox}>
                      <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
                    </View>
                    <View style={styles.folderRowInfo}>
                      <Text style={styles.folderRowName} numberOfLines={1}>{folderName}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.folderRowCount}>{info.count} шт</Text>
                        {folderLastCheck.get(folderName) && (
                          <Text style={[styles.folderRowCount, { color: colors.green[600] }]}>
                            · проверка {new Date(folderLastCheck.get(folderName)!).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </Text>
                        )}
                      </View>
                    </View>
                    {info.hasLow && (
                      <View style={styles.folderRowAlert}>
                        <Ionicons name="alert-circle" size={14} color={colors.orange[500]} />
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
                  </TouchableOpacity>
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
        <TouchableOpacity style={styles.opsItem} onPress={openCorrection}>
          <View style={[styles.opsIcon, { backgroundColor: colors.purple[50] }]}>
            <Ionicons name="create-outline" size={22} color={colors.purple[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opsItemTitle}>{'Корректировка'}</Text>
            <Text style={styles.opsItemDesc}>{'Точечная корректировка остатков'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
        </TouchableOpacity>
      </Modal>

      {/* Full-screen Inventory Modal */}
      <RNModal visible={showInventoryModal} animationType="slide" onRequestClose={() => setShowInventoryModal(false)}>
        <SafeAreaView style={styles.invFullSafe} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={styles.invFullHeader}>
            <TouchableOpacity onPress={() => setShowInventoryModal(false)} style={styles.invFullBackBtn}>
              <Ionicons name="arrow-back" size={22} color={colors.gray[900]} />
            </TouchableOpacity>
            <Text style={styles.invFullTitle}>{'Инвентаризация'}</Text>
            <TouchableOpacity style={styles.invFullSubmitBtn} onPress={handleInventorySubmit}>
              <Text style={styles.invFullSubmitBtnText}>{'Провести'}</Text>
            </TouchableOpacity>
          </View>

          {/* Summary bar */}
          <View style={styles.invSummaryBar}>
            <View style={styles.invSummaryItem}>
              <Text style={styles.invSummaryLabel}>{'Проверено'}</Text>
              <Text style={styles.invSummaryValue}>{inventorySummary.checkedCount} {'товаров'}</Text>
            </View>
            <View style={styles.invSummaryItem}>
              <Text style={styles.invSummaryLabel}>{'Изменено'}</Text>
              <Text style={[styles.invSummaryValue, inventorySummary.changedCount > 0 && { color: colors.orange[600] }]}>{inventorySummary.changedCount}</Text>
            </View>
            {inventorySummary.shortageAmount > 0 && (
              <View style={styles.invSummaryItem}>
                <Text style={styles.invSummaryLabel}>{'Недостача'}</Text>
                <Text style={[styles.invSummaryValue, { color: colors.red[600] }]}>{formatMoney(inventorySummary.shortageAmount)}</Text>
              </View>
            )}
            {inventorySummary.excessAmount > 0 && (
              <View style={styles.invSummaryItem}>
                <Text style={styles.invSummaryLabel}>{'Излишек'}</Text>
                <Text style={[styles.invSummaryValue, { color: colors.green[600] }]}>{formatMoney(inventorySummary.excessAmount)}</Text>
              </View>
            )}
          </View>

          {/* Search */}
          <View style={styles.invFullSearchWrap}>
            <SearchInput
              value={inventorySearch}
              onChange={(v) => { setInventorySearch(v); if (v) setInvActivePath([]); }}
              placeholder={'Поиск товара...'}
            />
          </View>

          {/* Breadcrumb */}
          {invActivePath.length > 0 && !inventorySearch && (
            <View style={styles.invFullBreadcrumb}>
              <TouchableOpacity onPress={() => setInvActivePath([])} style={styles.breadcrumbItem}>
                <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
                <Text style={styles.breadcrumbText}>{'Все'}</Text>
              </TouchableOpacity>
              {invActivePath.map((seg, i) => (
                <React.Fragment key={i}>
                  <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
                  <TouchableOpacity onPress={() => setInvActivePath(prev => prev.slice(0, i + 1))} style={styles.breadcrumbItem}>
                    <Text style={[styles.breadcrumbText, i === invActivePath.length - 1 && styles.breadcrumbTextActive]}>
                      {seg}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          )}

          {/* Content: folders + products */}
          <FlatList
            data={invCurrentProducts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.invFullList}
            ListHeaderComponent={
              !inventorySearch && invSortedFolders.length > 0 ? (
                <View style={styles.invFullFoldersGrid}>
                  {invSortedFolders.map(([folderName, info]) => {
                    const isGreen = isFolderFullyChecked24h(folderName);
                    return (
                      <TouchableOpacity
                        key={folderName}
                        style={[
                          styles.invFullFolderCard,
                          isGreen && { backgroundColor: colors.green[50], borderColor: colors.green[200] },
                        ]}
                        onPress={() => setInvActivePath(prev => [...prev, folderName])}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.folderIconBox, isGreen && { backgroundColor: colors.green[100] }]}>
                          <Ionicons name="folder-open-outline" size={22} color={isGreen ? colors.green[600] : colors.primary[500]} />
                        </View>
                        <Text style={styles.folderName} numberOfLines={2}>{folderName}</Text>
                        <Text style={styles.folderCount}>{info.count} {'шт'}</Text>
                        {isGreen && (
                          <View style={styles.invFullFolderCheck}>
                            <Ionicons name="checkmark-circle" size={14} color={colors.green[500]} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const invItem = inventoryItems.find(it => it.productId === item.id);
              const actualStock = invItem?.actualStock ?? String(item.stock);
              const diff = (Number(actualStock) || 0) - item.stock;
              const countedInSession = isProductCountedInSession(item.id);
              const checked24h = isProductChecked24h(item.id);
              const lastDate = getProductLastInvDate(item.id);

              return (
                <View style={[
                  styles.invFullProductRow,
                  (countedInSession || checked24h) && { backgroundColor: colors.green[50], borderColor: colors.green[200] },
                ]}>
                  <View style={styles.invFullProductInfo}>
                    <Text style={styles.invFullProductName} numberOfLines={2}>{item.name}</Text>
                    {lastDate && (
                      <Text style={styles.invFullProductDate}>{'Проверено: '}{lastDate}</Text>
                    )}
                  </View>
                  <View style={styles.invFullProductStock}>
                    <Text style={styles.invFullProductStockLabel}>{'Сист.'}</Text>
                    <Text style={styles.invFullProductStockValue}>{item.stock}</Text>
                  </View>
                  <TextInput
                    value={actualStock}
                    onChangeText={(v) => {
                      setInventoryItems(prev => {
                        const exists = prev.find(it => it.productId === item.id);
                        if (exists) {
                          return prev.map(it => it.productId === item.id ? { ...it, actualStock: v } : it);
                        }
                        return [...prev, { productId: item.id, name: item.name, currentStock: item.stock, actualStock: v }];
                      });
                    }}
                    style={[styles.invFullProductInput, diff !== 0 && (diff > 0 ? styles.invInputPlus : styles.invInputMinus)]}
                    keyboardType="numeric"
                    placeholder={String(item.stock)}
                    placeholderTextColor={colors.gray[400]}
                  />
                  {diff !== 0 && (
                    <View style={[styles.invFullDiffBadge, diff > 0 ? styles.invFullDiffBadgePlus : styles.invFullDiffBadgeMinus]}>
                      <Text style={[styles.invFullDiffBadgeText, diff > 0 ? { color: colors.green[700] } : { color: colors.red[700] }]}>
                        {diff > 0 ? '+' : ''}{diff}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              !inventorySearch && invSortedFolders.length === 0 ? (
                <View style={styles.invFullEmpty}>
                  <Ionicons name="cube-outline" size={40} color={colors.gray[300]} />
                  <Text style={styles.invFullEmptyText}>{'Нет товаров в этой папке'}</Text>
                </View>
              ) : inventorySearch ? (
                <View style={styles.invFullEmpty}>
                  <Ionicons name="search-outline" size={40} color={colors.gray[300]} />
                  <Text style={styles.invFullEmptyText}>{'Ничего не найдено'}</Text>
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </RNModal>

      {/* Inventory Product Picker */}
      <ProductPickerModal
        visible={showInventoryPicker}
        onClose={handleInventoryPickerClose}
        onSelectProduct={addInventoryProduct}
        title="Добавить товар в инвентаризацию"
        getCartQty={(id) => inventoryItems.some(item => item.productId === id) ? 1 : 0}
        folderAnnotations={inventoryAnnotations}
      />

      {/* Writeoff Product Picker */}
      <ProductPickerModal
        visible={showWriteoffPicker}
        onClose={() => setShowWriteoffPicker(false)}
        onSelectProduct={selectWriteoffProduct}
        title="Выберите товар для списания"
      />

      {/* Writeoff Form Modal */}
      <Modal visible={showWriteoffModal} onClose={() => setShowWriteoffModal(false)} title={'Списание товара'}>
        <View style={styles.writeoffSelectedProduct}>
          <Ionicons name="cube-outline" size={20} color={colors.primary[600]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.writeoffSelectedName}>{writeoffProductName}</Text>
            <Text style={styles.writeoffSelectedStock}>{'На складе: '}{writeoffProductStock} {'шт'}</Text>
          </View>
          <TouchableOpacity onPress={() => { setShowWriteoffModal(false); setTimeout(() => setShowWriteoffPicker(true), 300); }}>
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

      {/* Correction Product Picker */}
      <ProductPickerModal
        visible={showCorrectionPicker}
        onClose={() => setShowCorrectionPicker(false)}
        onSelectProduct={selectCorrectionProduct}
        title="Выберите товар для корректировки"
      />

      {/* Correction Form Modal */}
      <Modal visible={showCorrectionModal} onClose={() => setShowCorrectionModal(false)} title={'Корректировка остатка'}>
        <View style={styles.writeoffSelectedProduct}>
          <Ionicons name="cube-outline" size={20} color={colors.purple[600]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.writeoffSelectedName}>{correctionProductName}</Text>
            <Text style={styles.writeoffSelectedStock}>{'На складе: '}{correctionProductStock} {'шт'}</Text>
          </View>
          <TouchableOpacity onPress={() => { setShowCorrectionModal(false); setTimeout(() => setShowCorrectionPicker(true), 300); }}>
            <Text style={{ fontSize: fontSize.xs, color: colors.purple[600] }}>{'Изменить'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Текущий остаток'}</Text>
          <View style={[styles.formInput, { backgroundColor: colors.gray[100], justifyContent: 'center' }]}>
            <Text style={{ fontSize: fontSize.sm, color: colors.gray[500] }}>{correctionProductStock} {'шт'}</Text>
          </View>
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Новый остаток'}</Text>
          <TextInput
            value={correctionNewStock}
            onChangeText={setCorrectionNewStock}
            style={styles.formInput}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.gray[400]}
            autoFocus
          />
          {correctionNewStock !== '' && Number(correctionNewStock) !== correctionProductStock && (
            <View style={styles.correctionDiffRow}>
              {Number(correctionNewStock) < correctionProductStock ? (
                <Text style={{ fontSize: fontSize.xs, color: colors.red[600] }}>
                  {'Недостача: '}{correctionProductStock - Number(correctionNewStock)} {'шт'} ({formatMoney((correctionProductStock - Number(correctionNewStock)) * correctionProductCostPrice)})
                </Text>
              ) : (
                <Text style={{ fontSize: fontSize.xs, color: colors.green[600] }}>
                  {'Излишек: +'}{Number(correctionNewStock) - correctionProductStock} {'шт'} ({formatMoney((Number(correctionNewStock) - correctionProductStock) * correctionProductCostPrice)})
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Причина корректировки *'}</Text>
          <TextInput
            value={correctionReason}
            onChangeText={setCorrectionReason}
            style={[styles.formInput, { minHeight: 56, textAlignVertical: 'top' }]}
            multiline
            placeholder={'Пересчёт, ошибка при приёмке...'}
            placeholderTextColor={colors.gray[400]}
          />
        </View>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCorrectionModal(false)}>
            <Text style={styles.cancelBtnText}>{'Отмена'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.purple[600] }]} onPress={handleCorrectionSubmit}>
            <Text style={styles.submitBtnText}>{'Применить'}</Text>
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
  foldersList: { marginBottom: spacing[3], backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], overflow: 'hidden' },
  folderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3.5], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  folderRowInfo: { flex: 1, marginLeft: spacing[3] },
  folderRowName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  folderRowCount: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  folderRowAlert: { marginRight: spacing[2] },
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
  // Add product button (inventory)
  addProductBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], marginBottom: spacing[3], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.primary[200], borderStyle: 'dashed', backgroundColor: colors.primary[50] },
  addProductBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary[600] },
  // Fullscreen photo
  fullscreenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullscreenClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  fullscreenImage: { width: SCREEN_WIDTH - 40, height: SCREEN_HEIGHT * 0.7 },
  // Full-screen Inventory
  invFullSafe: { flex: 1, backgroundColor: colors.white },
  invFullHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  invFullBackBtn: { width: 36, height: 36, borderRadius: borderRadius.lg, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center', marginRight: spacing[3] },
  invFullTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  invFullSubmitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  invFullSubmitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
  invSummaryBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.gray[50], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  invSummaryItem: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], backgroundColor: colors.white, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[200] },
  invSummaryLabel: { fontSize: 10, fontWeight: fontWeight.medium, color: colors.gray[400], textTransform: 'uppercase' },
  invSummaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 1 },
  invFullSearchWrap: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  invFullBreadcrumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingBottom: spacing[2], flexWrap: 'wrap', gap: spacing[1] },
  invFullFoldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: FOLDER_GAP, paddingBottom: spacing[4] },
  invFullFolderCard: {
    width: FOLDER_WIDTH,
    backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[3], alignItems: 'center',
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  invFullFolderCheck: { position: 'absolute', top: spacing[1.5], right: spacing[1.5] },
  invFullList: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[2] },
  invFullProductRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[3],
    shadowColor: colors.black, shadowOpacity: 0.02, shadowRadius: 2, elevation: 1,
  },
  invFullProductInfo: { flex: 1, minWidth: 0 },
  invFullProductName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  invFullProductDate: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  invFullProductStock: { alignItems: 'center', minWidth: 40 },
  invFullProductStockLabel: { fontSize: 9, color: colors.gray[400], textTransform: 'uppercase' },
  invFullProductStockValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[600] },
  invFullProductInput: {
    width: 70, backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300],
    borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5],
    fontSize: fontSize.sm, color: colors.gray[900], textAlign: 'center',
  },
  invFullDiffBadge: { minWidth: 36, paddingHorizontal: spacing[1.5], paddingVertical: 2, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  invFullDiffBadgePlus: { backgroundColor: colors.green[50] },
  invFullDiffBadgeMinus: { backgroundColor: colors.red[50] },
  invFullDiffBadgeText: { fontSize: 11, fontWeight: fontWeight.bold },
  invFullEmpty: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  invFullEmptyText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Correction
  correctionDiffRow: { marginTop: spacing[1.5] },
});
