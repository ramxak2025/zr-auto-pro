import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Dimensions,
  Modal as RNModal,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import CachedImage from '../components/CachedImage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Pressable } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { productsApi, warehouseCategoriesApi, uploadsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import AnimatedCard from '../components/AnimatedCard';
import ProductPickerModal from '../components/ProductPickerModal';
import type { FolderAnnotation } from '../components/ProductPickerModal';
import TrashScreen from './TrashScreen';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Product, PaginatedResponse, StockMovement } from '../../../shared/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const FOLDER_COLS = 3;
const FOLDER_GAP = spacing[2];
const FOLDER_WIDTH = (SCREEN_WIDTH - spacing[4] * 2 - FOLDER_GAP * (FOLDER_COLS - 1)) / FOLDER_COLS;

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD'
  );
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// FolderRow \u2014 \u0441\u0442\u0430\u0442\u0438\u0447\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430 \u043F\u0430\u043F\u043A\u0438 (iOS, \u0431\u0435\u0437 swipe).
//
// \u0420\u0435\u0448\u0435\u043D\u0438\u0435 iter#12 \u043F\u043E\u0441\u043B\u0435 iPhone-\u0442\u0435\u0441\u0442\u0430: \u043D\u0430 iOS swipe-actions \u0434\u043B\u044F \u043F\u0430\u043F\u043E\u043A \u0438
// \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043D\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u043B\u0438 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E (gesture handler \u0442\u0435\u0440\u044F\u043B \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0432\u043D\u0443\u0442\u0440\u0438
// FlashList ListHeaderComponent), \u0438 \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u044F\u0432\u043D\u043E \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u043B \u0443\u0431\u0440\u0430\u0442\u044C \u0438\u0445
// \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E. \u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435/\u043F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u0430\u043F\u043E\u043A \u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043D\u0430 iOS \u0442\u0435\u043F\u0435\u0440\u044C \u043D\u0435
// \u0434\u0435\u043B\u0430\u0435\u0442\u0441\u044F \u0438\u0437 \u043C\u043E\u0431\u0438\u043B\u043A\u0438 \u2014 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0447\u0435\u0440\u0435\u0437
// web-\u0430\u0434\u043C\u0438\u043D. \u041A\u043E\u043C\u043F\u043E\u043D\u0435\u043D\u0442 \u0432\u044B\u043D\u0435\u0441\u0435\u043D \u043D\u0430 module-level, \u0447\u0442\u043E\u0431\u044B FlashList \u043F\u0435\u0440\u0435\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B
// React-\u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043F\u0440\u0438 \u0441\u043A\u0440\u043E\u043B\u043B\u0435.
//
// \u041F\u0435\u0440\u0435\u043D\u043E\u0441 \u043D\u0430 Android/Web:
//   \u2022 Android \u2014 \u0442\u043E\u0442 \u0436\u0435 React-\u043A\u043E\u043C\u043F\u043E\u043D\u0435\u043D\u0442, \u043D\u0438\u043A\u0430\u043A\u0438\u0445 swipe-\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0435\u0439.
//   \u2022 Web \u2014 \u044D\u0442\u043E\u0442 \u0436\u0435 \u0432\u0438\u0437\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u044F\u0437\u044B\u043A; \u043D\u0430 web edit/delete \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0447\u0435\u0440\u0435\u0437
//     SuppliersPage-style swipe \u0438\u043B\u0438 dropdown-\u043C\u0435\u043D\u044E \u043F\u043E \u0442\u0430\u043F\u0443.
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface FolderRowProps {
  folderName: string;
  count: number;
  hasLow: boolean;
  lastCheckIso?: string;
  onOpen: (name: string) => void;
}

const FolderRow = React.memo(function FolderRow({ folderName, count, hasLow, lastCheckIso, onOpen }: FolderRowProps) {
  return (
    <TouchableOpacity onPress={() => onOpen(folderName)} activeOpacity={0.6} style={styles.folderRow}>
      <View style={styles.folderIconBox}>
        <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
      </View>
      <View style={styles.folderRowInfo}>
        <Text style={styles.folderRowName} numberOfLines={1}>
          {folderName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.folderRowCount}>
            {count} {'\u0448\u0442'}
          </Text>
          {lastCheckIso && (
            <Text style={[styles.folderRowCount, { color: colors.green[600] }]}>
              {'\u00B7 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 '}
              {new Date(lastCheckIso).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              })}
            </Text>
          )}
        </View>
      </View>
      {hasLow && (
        <View style={styles.folderRowAlert}>
          <Ionicons name="alert-circle" size={14} color={colors.orange[500]} />
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
    </TouchableOpacity>
  );
});

// ── ProductRow ────────────────────────────────────────────────────────
// Memoised row for the warehouse list. Module-scope so `React.memo` can
// short-circuit re-renders to "props unchanged" without per-screen
// closure churn. Inline form was rebuilding the full subtree on every
// parent render (search keystroke, SWR refetch, filter chip toggle).
interface ProductRowProps {
  item: Product;
  index: number;
  hideCategory: boolean;
  canSeeCostPrice: boolean;
  onOpenEdit: (product: Product) => void;
  onOpenPhoto: (uri: string) => void;
}
const ProductRow = React.memo(function ProductRow({
  item,
  index,
  hideCategory,
  canSeeCostPrice,
  onOpenEdit,
  onOpenPhoto,
}: ProductRowProps) {
  const lowStock = item.stock <= item.minStock && item.minStock > 0;
  const pUri = getImageUrl(item.photo);
  return (
    <AnimatedCard index={index} style={styles.productCard} onPress={() => onOpenEdit(item)}>
      <View style={styles.productRow}>
        <TouchableOpacity
          onPress={() => {
            if (pUri) onOpenPhoto(pUri);
          }}
        >
          {pUri ? (
            <CachedImage source={{ uri: pUri }} style={styles.productPhoto} resizeMode="cover" />
          ) : (
            <View style={styles.productPhotoPlaceholder}>
              <Ionicons name="cube-outline" size={22} color={colors.gray[300]} />
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>
            {item.name}
          </Text>
          {item.category && !hideCategory && (
            <Text style={styles.productCategory}>{item.category.split('/').pop()}</Text>
          )}
          <View style={styles.productPrices}>
            <Text style={styles.productSellPrice}>{formatMoney(item.sellPrice)}</Text>
            {canSeeCostPrice && <Text style={styles.productCostPrice}>Себест. {formatMoney(item.costPrice)}</Text>}
          </View>
        </View>
        <View style={styles.productStockWrap}>
          {lowStock && (
            <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />
          )}
          <Text style={[styles.productStock, lowStock && styles.productStockLow]}>{item.stock}</Text>
          <Text style={styles.productStockLabel}>шт</Text>
        </View>
      </View>
    </AnimatedCard>
  );
});

export default function ProductsScreen() {
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const insetsTop = useSafeAreaInsets().top;
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { hasPermission, user } = useAuth();
  const isOwner = user?.role === 'director' || user?.role === 'superadmin';
  const canManageWarehouse = hasPermission('warehouse_access');
  // Directors, admins, superadmins see cost price. Masters don't.
  const canSeeCostPrice = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';

  const [search, setSearch] = useState('');
  const limit = 500;
  const [refreshing, setRefreshing] = useState(false);
  // activePath теперь живёт в route.params, чтобы каждый уровень папки был
  // отдельным push в native stack. iOS edge-swipe слева делает pop —
  // возврат на уровень выше без необходимости целиться в кнопку.
  // Корневой вход в таб не имеет params → activePath = [].
  const activePath: string[] = route.params?.activePath ?? [];

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
  // Корзина склада — full-screen modal hosted from the warehouse ops modal,
  // rather than a separate "Ещё" tab item, because soft-deleted products are
  // a warehouse concern.
  const [showTrashModal, setShowTrashModal] = useState(false);

  // Fullscreen photo view
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  // Inventory modal state
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryItems, setInventoryItems] = useState<
    { productId: string; name: string; currentStock: number; actualStock: string }[]
  >([]);
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
    queryFn: async () => {
      const res = await productsApi.getAll({ search, page: 1, limit });
      return res.data;
    },
  });

  const { data: extraFolders } = useQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll();
      return res.data;
    },
  });

  // Fetch inventory movements for folder annotations (always enabled)
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements({ limit: 1000 });
      return res.data;
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      closeModal();
    },
    onError: () =>
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0442\u043E\u0432\u0430\u0440\u0430',
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      closeModal();
    },
    onError: () =>
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438',
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: () =>
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438',
      ),
  });

  const stockMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { type: 'income' | 'expense' | 'writeoff' | 'inventory'; quantity: number; reason?: string };
    }) => productsApi.updateStock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: any) =>
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        err?.response?.data?.message ||
          '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0430',
      ),
  });

  // Удаление/переименование папок и реордер на iOS отключены iter#12 —
  // ни одно из этих действий из мобилки сейчас не делается. Соответствующие
  // мутации (`warehouseCategoriesApi.remove/rename/updateOrder`) остались
  // на бэке и доступны через web-админ. Никакого UI они здесь больше не
  // имеют, чтобы не подкидывать нестабильный gesture-стек.

  const allProducts = data?.data || [];

  // Compute folder annotations: last inventory date per folder
  const inventoryAnnotations = useMemo(() => {
    const annotations = new Map<string, FolderAnnotation>();
    if (!inventoryMovements || !allProducts.length) return annotations;

    const inventoryMoves = inventoryMovements.filter((m) => m.type === 'inventory');
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
      const dates = productIds.map((id) => lastInvByProduct.get(id)).filter(Boolean) as Date[];
      if (dates.length > 0) {
        const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
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
    const inventoryMoves = inventoryMovements.filter((m) => m.type === 'inventory');
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
      const filtered = allProducts.filter((p) => p.name.toLowerCase().includes(inventorySearch.toLowerCase()));
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
    const folderProducts = allProducts.filter((p) => {
      const cat = p.category || '';
      return cat === prefix || cat.startsWith(prefix + '/');
    });
    if (folderProducts.length === 0) return false;
    return folderProducts.every((p) => {
      const d = lastInventoryByProduct.get(p.id);
      return d && now - d.getTime() < h24;
    });
  };

  // Check if a product was counted in the current inventory session
  const isProductCountedInSession = (productId: string): boolean => {
    const item = inventoryItems.find((it) => it.productId === productId);
    return !!item && item.actualStock !== String(item.currentStock);
  };

  // Get last inventory date for a product (for >24h display)
  const getProductLastInvDate = (productId: string): string | null => {
    const d = lastInventoryByProduct.get(productId);
    if (!d) return null;
    const now = Date.now();
    const h24 = 24 * 60 * 60 * 1000;
    if (now - d.getTime() >= h24) {
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
    return null;
  };

  // Is product checked within 24h (green tint)
  const isProductChecked24h = (productId: string): boolean => {
    const d = lastInventoryByProduct.get(productId);
    if (!d) return false;
    return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
  };

  // Inventory summary
  const inventorySummary = useMemo(() => {
    const checked = inventoryItems.filter(
      (item) => item.actualStock !== '' && item.actualStock !== String(item.currentStock),
    );
    const total = inventoryItems.filter((item) => item.actualStock !== '');
    let shortageAmount = 0;
    let excessAmount = 0;
    for (const item of checked) {
      const diff = (Number(item.actualStock) || 0) - item.currentStock;
      const product = allProducts.find((p) => p.id === item.productId);
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

  // Attach catId + sortOrder from warehouse_categories and sort by sort_order.
  const sortedFolders = useMemo(() => {
    const prefix = activePath.join('/');
    const catLookup = new Map<string, { id: string; sort_order: number }>();
    if (Array.isArray(extraFolders)) {
      for (const wc of extraFolders as Array<{ id: string; path: string; sort_order?: number }>) {
        catLookup.set(wc.path, { id: wc.id, sort_order: wc.sort_order || 0 });
      }
    }
    return Array.from(subfolders.entries())
      .map(([name, info]) => {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        const cat = catLookup.get(fullPath);
        return [name, { ...info, fullPath, catId: cat?.id || '', sortOrder: cat?.sort_order || 0 }] as const;
      })
      .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0]));
  }, [subfolders, extraFolders, activePath]);

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

  // Спуститься на уровень глубже: push нового instance ProductsScreen с
  // обновлённым activePath. push (а не navigate) гарантирует именно новый
  // фрейм в стеке — без него navigate с теми же params upsert-ит текущий
  // экран и swipe-back перестаёт работать.
  const enterFolder = (name: string) => {
    navigation.push('ProductsHome', { activePath: [...activePath, name] });
  };
  // Возврат на уровень `level` через breadcrumb: popToTop при level=0,
  // в остальных случаях pop'аем разницу. popToTop безопасен на корне.
  const goToLevel = (level: number) => {
    if (level >= activePath.length) return;
    const popCount = activePath.length - level;
    if (level === 0) {
      navigation.popToTop();
    } else {
      navigation.pop(popCount);
    }
  };

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
    setName('');
    setCategory(activePath.join('/') || '');
    setCostPrice('');
    setSellPrice('');
    setStock('');
    setMinStock('');
    setPhotoUri(null);
    setModalOpen(true);
  };

  // useCallback so the row's onPress identity is stable across SWR
  // refetches; otherwise React.memo on ProductRow can't short-circuit
  // re-renders. Setters from useState are already stable so the deps
  // array is intentionally empty.
  const openEdit = useCallback((p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setCategory(p.category || '');
    setCostPrice(String(p.costPrice));
    setSellPrice(String(p.sellPrice));
    setStock(String(p.stock));
    setMinStock(String(p.minStock));
    setPhotoUri(p.photo ? (p.photo.startsWith('http') ? p.photo : p.photo) : null);
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
    setPhotoUri(null);
  };

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
        Alert.alert(
          '\u041E\u0448\u0438\u0431\u043A\u0430',
          '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0444\u043E\u0442\u043E',
        );
        setUploadingPhoto(false);
        return;
      }
      setUploadingPhoto(false);
    } else if (!photoUri) {
      uploadedPhotoPath = undefined; // photo was removed
    }

    const payload = {
      name,
      category: category || undefined,
      costPrice: Number(costPrice) || 0,
      sellPrice: Number(sellPrice) || 0,
      stock: Number(stock) || 0,
      minStock: Number(minStock) || 0,
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
    setInventoryItems(
      allProducts.map((p) => ({
        productId: p.id,
        name: p.name,
        currentStock: p.stock,
        actualStock: String(p.stock),
      })),
    );
    setShowInventoryModal(true);
  };

  const handleInventorySubmit = async () => {
    const changed = inventoryItems.filter((item) => String(item.currentStock) !== item.actualStock);
    if (changed.length === 0) {
      Alert.alert('Инвентаризация', 'Нет изменений в остатках');
      return;
    }

    // Compute shortage/excess totals
    let shortageTotal = 0;
    let excessTotal = 0;
    for (const item of changed) {
      const diff = (Number(item.actualStock) || 0) - item.currentStock;
      const product = allProducts.find((p) => p.id === item.productId);
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
      Alert.alert(
        'Готово',
        `Инвентаризация завершена. Изменено: ${changed.length} товаров. Недостача: ${formatMoney(shortageTotal)}, Излишки: ${formatMoney(excessTotal)}`,
      );
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка при инвентаризации');
    }
  };

  const filteredInventoryItems = inventorySearch
    ? inventoryItems.filter((item) => item.name.toLowerCase().includes(inventorySearch.toLowerCase()))
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
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E',
      );
      return;
    }
    if (qty > writeoffProductStock) {
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        `\u041D\u0435\u043B\u044C\u0437\u044F \u0441\u043F\u0438\u0441\u0430\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u0447\u0435\u043C \u0435\u0441\u0442\u044C \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435 (${writeoffProductStock})`,
      );
      return;
    }
    if (!writeoffReason.trim()) {
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0440\u0438\u0447\u0438\u043D\u0443 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F',
      );
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
      Alert.alert(
        '\u0413\u043E\u0442\u043E\u0432\u043E',
        `\u0421\u043F\u0438\u0441\u0430\u043D\u043E ${qty} \u0448\u0442. "${writeoffProductName}"`,
      );
    } catch (err: any) {
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        err?.response?.data?.message ||
          '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0438',
      );
    }
  };

  const addInventoryProduct = (p: Product) => {
    // Only add if not already in the list
    if (!inventoryItems.find((item) => item.productId === p.id)) {
      setInventoryItems((prev) => [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          currentStock: p.stock,
          actualStock: String(p.stock),
        },
      ]);
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
      Alert.alert(
        'Готово',
        `Остаток "${correctionProductName}" скорректирован: ${correctionProductStock} → ${newQty} (${diff > 0 ? '+' : ''}${diff})`,
      );
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

  // Header for the products FlashList — папки + breadcrumb. Мемоизирован,
  // чтобы FlashList не пересоздавал ListHeaderComponent на каждый рендер
  // ProductsScreen и folder rows физически переиспользовались.
  const ListHeader = useMemo(() => {
    if (search || sortedFolders.length === 0) return null;
    return (
      <View style={styles.foldersList}>
        {sortedFolders.map(([folderName, info]) => (
          <FolderRow
            key={folderName}
            folderName={folderName}
            count={info.count}
            hasLow={info.hasLow}
            lastCheckIso={folderLastCheck.get(folderName)}
            onOpen={enterFolder}
          />
        ))}
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sortedFolders, folderLastCheck]);

  // Stable references for the warehouse FlashList — keys and render
  // function. The renderItem indirection lets the memoised ProductRow
  // do its own equality check on each item; the wrapper only re-creates
  // when one of the captured props (search, canSeeCostPrice, handlers)
  // actually changes.
  const productKey = useCallback((item: Product) => item.id, []);
  const renderProductItem = useCallback(
    ({ item, index }: { item: Product; index: number }) => (
      <ProductRow
        item={item}
        index={index}
        hideCategory={!!search}
        canSeeCostPrice={canSeeCostPrice}
        onOpenEdit={openEdit}
        onOpenPhoto={setFullscreenPhoto}
      />
    ),
    // openEdit is recreated each render (uses local state), and search
    // changes drive `hideCategory`. canSeeCostPrice is a stable bool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, canSeeCostPrice, openEdit],
  );

  return (
    <View style={styles.safe}>
      {/* Unified iOS header \u2014 same component as \u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 / \u0416\u0443\u0440\u043D\u0430\u043B
          / \u041F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0438. Title + product count subtitle on the left,
          warehouse-ops + add buttons in the trailing slot. */}
      <IosScreenHeader
        title={'\u0421\u043A\u043B\u0430\u0434'}
        subtitle={data === undefined ? undefined : `${warehouseStats.count} \u0442\u043E\u0432\u0430\u0440\u043E\u0432`}
        trailing={
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
        }
      />

      {/* Stats cards (\u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C / \u0432 \u0440\u043E\u0437\u043D. \u0446\u0435\u043D\u0430\u0445) intentionally
          REMOVED from the warehouse top \u2014 these belong in the Reports
          screen, not in the warehouse header. Owner spec: "\u0441\u043A\u043B\u0430\u0434 \u0438\u043C\u0435\u0435\u0442
          \u0430\u043A\u043A\u0443\u0440\u0430\u0442\u043D\u0443\u044E \u0448\u0430\u043F\u043A\u0443 \u0431\u0435\u0437 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0445 \u0441\u0443\u043C\u043C". */}

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
          onChange={(v) => {
            setSearch(v);
            // \u0412\u0432\u0435\u0434\u0451\u043D \u043F\u043E\u0438\u0441\u043A \u2192 \u0441\u0445\u043B\u043E\u043F\u044B\u0432\u0430\u0435\u043C \u0441\u0442\u0435\u043A \u0434\u043E \u043A\u043E\u0440\u043D\u044F, \u0447\u0442\u043E\u0431\u044B \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B
            // \u0438\u0441\u043A\u0430\u043B\u0438\u0441\u044C \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u0441\u043A\u043B\u0430\u0434\u0443, \u0430 \u043D\u0435 \u0432\u043D\u0443\u0442\u0440\u0438 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0438.
            if (v && activePath.length > 0) navigation.popToTop();
          }}
          placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
        />
      </View>

      {/* Loading: show skeleton when no data yet (cold start, no cache hit). */}
      {/* Empty state only fires when query has resolved (data !== undefined) */}
      {/* AND the result is genuinely empty \u2014 never on a stale-undefined flash. */}
      {isLoading || data === undefined ? (
        <ListSkeleton count={8} />
      ) : !search && sortedFolders.length === 0 && currentProducts.length === 0 ? (
        <EmptyState
          title={'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}
          description={
            activePath.length > 0
              ? '\u0412 \u044D\u0442\u043E\u0439 \u043F\u0430\u043F\u043A\u0435 \u043F\u0443\u0441\u0442\u043E'
              : '\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440'
          }
          action={
            !activePath.length
              ? { label: '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', onPress: openCreate }
              : undefined
          }
        />
      ) : (
        <FlashList
          data={currentProducts}
          keyExtractor={productKey}
          // Memoised module-level component renders the row; the
          // wrapper here is only a closure that wires per-screen state
          // (search, permissions, photo lightbox setter). React.memo on
          // ProductRow short-circuits re-renders when those props are
          // stable, which they are across SWR refetches.
          renderItem={renderProductItem}
          contentContainerStyle={styles.list}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          // Each product row carries a heavy CachedImage thumbnail.
          // Explicitly enable clipped-subview removal so Android
          // doesn't keep them mounted off-screen while flinging.
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          ListHeaderComponent={ListHeader}
        />
      )}

      {/* Create/Edit Modal with photo upload */}
      <Modal
        visible={modalOpen}
        onClose={closeModal}
        title={
          editingProduct
            ? '\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u043E\u0432\u0430\u0440'
            : '\u041D\u043E\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440'
        }
      >
        {/* Photo section */}
        <View style={styles.photoSection}>
          <TouchableOpacity style={styles.photoPickerWrap} onPress={pickImage}>
            {photoUri ? (
              <CachedImage
                source={{ uri: getDisplayPhotoUri(photoUri) }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.photoPickerPlaceholder}>
                <Ionicons name="camera-outline" size={28} color={colors.gray[400]} />
                <Text style={styles.photoPickerText}>
                  {'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0444\u043E\u0442\u043E'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {photoUri && (
            <View style={styles.photoActions}>
              <TouchableOpacity style={styles.photoActionBtn} onPress={pickImage}>
                <Ionicons name="swap-horizontal" size={16} color={colors.primary[600]} />
                <Text style={styles.photoActionText}>{'\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.photoActionBtn}
                onPress={() => setFullscreenPhoto(getDisplayPhotoUri(photoUri)!)}
              >
                <Ionicons name="expand-outline" size={16} color={colors.primary[600]} />
                <Text style={styles.photoActionText}>{'\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoActionBtn} onPress={() => setPhotoUri(null)}>
                <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
                <Text style={[styles.photoActionText, { color: colors.red[500] }]}>
                  {'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435'}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.formInput}
            placeholder={'\u041C\u0430\u0441\u043B\u043E \u043C\u043E\u0442\u043E\u0440\u043D\u043E\u0435...'}
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>
            {'\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F (\u043F\u0430\u043F\u043A\u0430)'}
          </Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            style={styles.formInput}
            placeholder={'\u041C\u0430\u0441\u043B\u0430/\u041C\u043E\u0442\u043E\u0440\u043D\u044B\u0435'}
            placeholderTextColor={colors.gray[400]}
          />
          <Text style={styles.formHint}>
            {
              '\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 / \u0434\u043B\u044F \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438'
            }
          </Text>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>
              {'\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C'}
            </Text>
            <TextInput
              value={costPrice}
              onChangeText={setCostPrice}
              style={styles.formInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[400]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>
              {'\u0426\u0435\u043D\u0430 \u043F\u0440\u043E\u0434\u0430\u0436\u0438'}
            </Text>
            <TextInput
              value={sellPrice}
              onChangeText={setSellPrice}
              style={styles.formInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[400]}
            />
          </View>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u041E\u0441\u0442\u0430\u0442\u043E\u043A'}</Text>
            <TextInput
              value={stock}
              onChangeText={setStock}
              style={styles.formInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[400]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{'\u041C\u0438\u043D. \u043E\u0441\u0442\u0430\u0442\u043E\u043A'}</Text>
            <TextInput
              value={minStock}
              onChangeText={setMinStock}
              style={styles.formInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[400]}
            />
          </View>
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>{'\u041E\u0442\u043C\u0435\u043D\u0430'}</Text>
          </TouchableOpacity>
          {editingProduct && (
            <TouchableOpacity
              style={styles.deleteFormBtn}
              onPress={() => {
                setDeleteId(editingProduct.id);
                closeModal();
              }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending || updateMutation.isPending || uploadingPhoto ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {editingProduct
                  ? '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C'
                  : '\u0421\u043E\u0437\u0434\u0430\u0442\u044C'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Warehouse Operations Modal */}
      <Modal
        visible={showOpsModal}
        onClose={() => setShowOpsModal(false)}
        title={
          '\u0421\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438'
        }
      >
        <TouchableOpacity style={styles.opsItem} onPress={openInventory}>
          <View style={[styles.opsIcon, { backgroundColor: colors.blue[50] }]}>
            <Ionicons name="clipboard-outline" size={22} color={colors.blue[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opsItemTitle}>
              {'\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F'}
            </Text>
            <Text style={styles.opsItemDesc}>
              {
                '\u041F\u0435\u0440\u0435\u0441\u0447\u0451\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435'
              }
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.opsItem} onPress={openWriteoff}>
          <View style={[styles.opsIcon, { backgroundColor: colors.red[50] }]}>
            <Ionicons name="trash-outline" size={22} color={colors.red[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opsItemTitle}>{'\u0421\u043F\u0438\u0441\u0430\u043D\u0438\u0435'}</Text>
            <Text style={styles.opsItemDesc}>
              {
                '\u0421\u043F\u0438\u0441\u0430\u0442\u044C \u0431\u0440\u0430\u043A, \u043F\u043E\u0442\u0435\u0440\u0438, \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u043A\u0443'
              }
            </Text>
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

        {/* Корзина склада — soft-deleted products. Lives here (not in
            "Ещё") because it's a warehouse-only concern. */}
        {canManageWarehouse && (
          <TouchableOpacity
            style={styles.opsItem}
            onPress={() => {
              setShowOpsModal(false);
              setShowTrashModal(true);
            }}
          >
            <View style={[styles.opsIcon, { backgroundColor: colors.rose[50] }]}>
              <Ionicons name="trash-bin-outline" size={22} color={colors.rose[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.opsItemTitle}>{'Корзина'}</Text>
              <Text style={styles.opsItemDesc}>{'Восстановление удалённых товаров'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
          </TouchableOpacity>
        )}
      </Modal>

      {/* Full-screen Корзина modal — hosts TrashScreen with an explicit
          onClose so it can be dismissed without touching the navigator. */}
      <RNModal visible={showTrashModal} animationType="slide" onRequestClose={() => setShowTrashModal(false)}>
        <TrashScreen onClose={() => setShowTrashModal(false)} />
      </RNModal>

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
              <Text style={styles.invSummaryValue}>
                {inventorySummary.checkedCount} {'товаров'}
              </Text>
            </View>
            <View style={styles.invSummaryItem}>
              <Text style={styles.invSummaryLabel}>{'Изменено'}</Text>
              <Text
                style={[styles.invSummaryValue, inventorySummary.changedCount > 0 && { color: colors.orange[600] }]}
              >
                {inventorySummary.changedCount}
              </Text>
            </View>
            {inventorySummary.shortageAmount > 0 && (
              <View style={styles.invSummaryItem}>
                <Text style={styles.invSummaryLabel}>{'Недостача'}</Text>
                <Text style={[styles.invSummaryValue, { color: colors.red[600] }]}>
                  {formatMoney(inventorySummary.shortageAmount)}
                </Text>
              </View>
            )}
            {inventorySummary.excessAmount > 0 && (
              <View style={styles.invSummaryItem}>
                <Text style={styles.invSummaryLabel}>{'Излишек'}</Text>
                <Text style={[styles.invSummaryValue, { color: colors.green[600] }]}>
                  {formatMoney(inventorySummary.excessAmount)}
                </Text>
              </View>
            )}
          </View>

          {/* Search */}
          <View style={styles.invFullSearchWrap}>
            <SearchInput
              value={inventorySearch}
              onChange={(v) => {
                setInventorySearch(v);
                if (v) setInvActivePath([]);
              }}
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
                  <TouchableOpacity
                    onPress={() => setInvActivePath((prev) => prev.slice(0, i + 1))}
                    style={styles.breadcrumbItem}
                  >
                    <Text
                      style={[styles.breadcrumbText, i === invActivePath.length - 1 && styles.breadcrumbTextActive]}
                    >
                      {seg}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          )}

          {/* Content: folders + products */}
          <FlashList
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
                        onPress={() => setInvActivePath((prev) => [...prev, folderName])}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.folderIconBox, isGreen && { backgroundColor: colors.green[100] }]}>
                          <Ionicons
                            name="folder-open-outline"
                            size={22}
                            color={isGreen ? colors.green[600] : colors.primary[500]}
                          />
                        </View>
                        <Text style={styles.folderName} numberOfLines={2}>
                          {folderName}
                        </Text>
                        <Text style={styles.folderCount}>
                          {info.count} {'шт'}
                        </Text>
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
              const invItem = inventoryItems.find((it) => it.productId === item.id);
              const actualStock = invItem?.actualStock ?? String(item.stock);
              const diff = (Number(actualStock) || 0) - item.stock;
              const countedInSession = isProductCountedInSession(item.id);
              const checked24h = isProductChecked24h(item.id);
              const lastDate = getProductLastInvDate(item.id);

              return (
                <View
                  style={[
                    styles.invFullProductRow,
                    (countedInSession || checked24h) && {
                      backgroundColor: colors.green[50],
                      borderColor: colors.green[200],
                    },
                  ]}
                >
                  <View style={styles.invFullProductInfo}>
                    <Text style={styles.invFullProductName} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {lastDate && (
                      <Text style={styles.invFullProductDate}>
                        {'Проверено: '}
                        {lastDate}
                      </Text>
                    )}
                  </View>
                  <View style={styles.invFullProductStock}>
                    <Text style={styles.invFullProductStockLabel}>{'Сист.'}</Text>
                    <Text style={styles.invFullProductStockValue}>{item.stock}</Text>
                  </View>
                  <TextInput
                    value={actualStock}
                    onChangeText={(v) => {
                      setInventoryItems((prev) => {
                        const exists = prev.find((it) => it.productId === item.id);
                        if (exists) {
                          return prev.map((it) => (it.productId === item.id ? { ...it, actualStock: v } : it));
                        }
                        return [
                          ...prev,
                          { productId: item.id, name: item.name, currentStock: item.stock, actualStock: v },
                        ];
                      });
                    }}
                    style={[
                      styles.invFullProductInput,
                      diff !== 0 && (diff > 0 ? styles.invInputPlus : styles.invInputMinus),
                    ]}
                    keyboardType="numeric"
                    placeholder={String(item.stock)}
                    placeholderTextColor={colors.gray[400]}
                  />
                  {diff !== 0 && (
                    <View
                      style={[
                        styles.invFullDiffBadge,
                        diff > 0 ? styles.invFullDiffBadgePlus : styles.invFullDiffBadgeMinus,
                      ]}
                    >
                      <Text
                        style={[
                          styles.invFullDiffBadgeText,
                          diff > 0 ? { color: colors.green[700] } : { color: colors.red[700] },
                        ]}
                      >
                        {diff > 0 ? '+' : ''}
                        {diff}
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
        getCartQty={(id) => (inventoryItems.some((item) => item.productId === id) ? 1 : 0)}
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
            <Text style={styles.writeoffSelectedStock}>
              {'На складе: '}
              {writeoffProductStock} {'шт'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setShowWriteoffModal(false);
              setTimeout(() => setShowWriteoffPicker(true), 300);
            }}
          >
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
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.red[600] }]}
            onPress={handleWriteoffSubmit}
          >
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
      <Modal
        visible={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        title={'Корректировка остатка'}
      >
        <View style={styles.writeoffSelectedProduct}>
          <Ionicons name="cube-outline" size={20} color={colors.purple[600]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.writeoffSelectedName}>{correctionProductName}</Text>
            <Text style={styles.writeoffSelectedStock}>
              {'На складе: '}
              {correctionProductStock} {'шт'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setShowCorrectionModal(false);
              setTimeout(() => setShowCorrectionPicker(true), 300);
            }}
          >
            <Text style={{ fontSize: fontSize.xs, color: colors.purple[600] }}>{'Изменить'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formField}>
          <Text style={styles.formLabel}>{'Текущий остаток'}</Text>
          <View style={[styles.formInput, { backgroundColor: colors.gray[100], justifyContent: 'center' }]}>
            <Text style={{ fontSize: fontSize.sm, color: colors.gray[500] }}>
              {correctionProductStock} {'шт'}
            </Text>
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
                  {'Недостача: '}
                  {correctionProductStock - Number(correctionNewStock)} {'шт'} (
                  {formatMoney((correctionProductStock - Number(correctionNewStock)) * correctionProductCostPrice)})
                </Text>
              ) : (
                <Text style={{ fontSize: fontSize.xs, color: colors.green[600] }}>
                  {'Излишек: +'}
                  {Number(correctionNewStock) - correctionProductStock} {'шт'} (
                  {formatMoney((Number(correctionNewStock) - correctionProductStock) * correctionProductCostPrice)})
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
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.purple[600] }]}
            onPress={handleCorrectionSubmit}
          >
            <Text style={styles.submitBtnText}>{'Применить'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Fullscreen Photo Viewer — native iOS preview:
          • backdrop is UIBlurEffect dark, not a flat black
          • tapping ANYWHERE outside the image closes it
          • image has rounded continuous corners and respects safe area
          • close button is a translucent glyph in the top-right */}
      <RNModal
        visible={!!fullscreenPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenPhoto(null)}
      >
        <Pressable style={styles.fullscreenOverlay} onPress={() => setFullscreenPhoto(null)}>
          {/* expo-blur intensity > ~25 is expensive / flaky on Android.
              Cap it there and rely on the alpha-tinted backdrop layer
              below for visual depth. */}
          <BlurView intensity={Platform.OS === 'android' ? 24 : 90} tint="dark" style={StyleSheet.absoluteFill} />
          {Platform.OS === 'android' && (
            <View pointerEvents="none" style={styles.fullscreenAndroidScrim} />
          )}
          {/* Inner Pressable absorbs taps on the image so the image
              itself doesn't dismiss the preview — only the backdrop does. */}
          {fullscreenPhoto && (
            <Pressable style={styles.fullscreenImageWrap} onPress={(e) => e.stopPropagation?.()}>
              <CachedImage source={{ uri: fullscreenPhoto }} style={styles.fullscreenImage} resizeMode="contain" />
            </Pressable>
          )}
          <Pressable
            style={styles.fullscreenClose}
            onPress={() => setFullscreenPhoto(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color={colors.white} />
          </Pressable>
        </Pressable>
      </RNModal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440'}
        message={'\u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B?'}
        confirmText={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}
        variant="danger"
      />

      {/* iter#12: на iOS убран весь UI редактирования и удаления папок —
          swipe-actions работали нестабильно, владелец явно попросил
          выкинуть. Удаление/переименование/реордер папок остаются
          доступны через web-админ (backend endpoints не трогали). */}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  countBadge: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  countBadgeText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[500] },
  opsBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.orange[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    alignItems: 'center',
  },
  statLabel: { fontSize: 9, fontWeight: fontWeight.semibold, color: colors.gray[400], letterSpacing: 0.5 },
  statValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 2 },
  // Breadcrumb
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingVertical: 2 },
  breadcrumbText: { fontSize: fontSize.xs, color: colors.primary[600], fontWeight: fontWeight.medium },
  breadcrumbTextActive: { color: colors.gray[900], fontWeight: fontWeight.bold },
  searchWrap: { paddingHorizontal: spacing[4] },
  // iOS-grouped list: rows are flush — no gap, no horizontal padding (rows
  // own their gutter). The list itself sits on a slightly grey background
  // with a top hairline that meets the search bar.
  list: { paddingHorizontal: 0, paddingTop: 0 },
  // Folders — iOS plain inset-grouped style. No outer card, just rows that
  // share the same hairline treatment as the products below them so the
  // entire screen reads as ONE continuous Settings-style list.
  foldersList: { marginBottom: 0, backgroundColor: colors.white },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  folderRowMain: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  folderRowInfo: { flex: 1, marginLeft: spacing[3] },
  folderRowName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  folderRowCount: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  folderRowAlert: { marginRight: spacing[2] },
  // Swipe-left actions on a folder row (Изменить + Удалить).
  // Same UX language as Поставщики (SuppliersScreen).
  swipeActionsRow: { flexDirection: 'row' },
  swipeEditAction: {
    backgroundColor: colors.primary[600],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeEditText: { color: colors.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  swipeDeleteAction: {
    backgroundColor: colors.red[500],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteText: { color: colors.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  foldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: FOLDER_GAP, marginBottom: spacing[4] },
  folderCard: {
    width: FOLDER_WIDTH,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  folderIconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1.5],
  },
  folderName: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    textAlign: 'center',
    lineHeight: 14,
  },
  folderCount: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  folderAlert: { position: 'absolute', top: spacing[1.5], right: spacing[1.5] },
  // Products
  // Compact iOS-style list rows — flat white surface with hairline separators,
  // matches the look of native Settings / Mail lists on iPhone.
  productCard: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  productPhoto: { width: 42, height: 42, borderRadius: borderRadius.md },
  productPhotoPlaceholder: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: 15, fontWeight: fontWeight.semibold, color: colors.gray[900], letterSpacing: -0.1 },
  productCategory: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  productPrices: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 },
  productSellPrice: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.primary[700] },
  productCostPrice: { fontSize: 11, color: colors.gray[400] },
  productStockWrap: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 44, paddingLeft: spacing[1] },
  productStock: { fontSize: 16, fontWeight: '700' as const, color: colors.gray[900], letterSpacing: -0.3 },
  productStockLow: { color: colors.red[500] },
  productStockLabel: { fontSize: 10, color: colors.gray[400], marginTop: -1 },
  // Photo section in form
  photoSection: { marginBottom: spacing[4], alignItems: 'center' },
  photoPickerWrap: {
    width: 100,
    height: 100,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.gray[200],
    borderStyle: 'dashed',
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray[50],
  },
  photoPickerText: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  photoActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2] },
  photoActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  photoActionText: { fontSize: 12, color: colors.primary[600], fontWeight: fontWeight.medium },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formHint: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  formRowFields: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deleteFormBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[50],
  },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  // Ops modal
  opsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  opsIcon: { width: 44, height: 44, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  opsItemTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  opsItemDesc: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  // Inventory
  invHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  invHeaderText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500], textTransform: 'uppercase' },
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
  },
  invName: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], marginRight: spacing[2] },
  invWas: { width: 55, textAlign: 'center', fontSize: fontSize.sm, color: colors.gray[400] },
  invInput: {
    width: 70,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
    textAlign: 'center',
  },
  invInputPlus: { borderColor: colors.green[400], backgroundColor: colors.green[50] },
  invInputMinus: { borderColor: colors.red[400], backgroundColor: colors.red[50] },
  // Writeoff
  writeoffItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  writeoffItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  writeoffItemStock: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  writeoffSelectedProduct: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  writeoffSelectedName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  writeoffSelectedStock: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  // Add product button (inventory)
  addProductBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    marginBottom: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderStyle: 'dashed',
    backgroundColor: colors.primary[50],
  },
  addProductBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary[600] },
  // Fullscreen photo — backdrop is a translucent dark BlurView (set
  // separately, not via backgroundColor), wrap centers the image, and
  // the image gets continuous rounded corners.
  fullscreenOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  // Android fallback scrim: expo-blur on Android caps poorly at high
  // intensity, so we overlay a translucent dark surface for the same
  // perceived contrast without the blur cost.
  fullscreenAndroidScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  fullscreenImageWrap: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  fullscreenClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: { width: SCREEN_WIDTH - 40, height: SCREEN_HEIGHT * 0.7 },
  // Full-screen Inventory
  invFullSafe: { flex: 1, backgroundColor: colors.white },
  invFullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  invFullBackBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  invFullTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  invFullSubmitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  invFullSubmitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
  invSummaryBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  invSummaryItem: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  invSummaryLabel: { fontSize: 10, fontWeight: fontWeight.medium, color: colors.gray[400], textTransform: 'uppercase' },
  invSummaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 1 },
  invFullSearchWrap: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  invFullBreadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  invFullFoldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: FOLDER_GAP, paddingBottom: spacing[4] },
  invFullFolderCard: {
    width: FOLDER_WIDTH,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  invFullFolderCheck: { position: 'absolute', top: spacing[1.5], right: spacing[1.5] },
  invFullList: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[2] },
  invFullProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 1,
  },
  invFullProductInfo: { flex: 1, minWidth: 0 },
  invFullProductName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  invFullProductDate: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  invFullProductStock: { alignItems: 'center', minWidth: 40 },
  invFullProductStockLabel: { fontSize: 9, color: colors.gray[400], textTransform: 'uppercase' },
  invFullProductStockValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[600] },
  invFullProductInput: {
    width: 70,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
    textAlign: 'center',
  },
  invFullDiffBadge: {
    minWidth: 36,
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invFullDiffBadgePlus: { backgroundColor: colors.green[50] },
  invFullDiffBadgeMinus: { backgroundColor: colors.red[50] },
  invFullDiffBadgeText: { fontSize: 11, fontWeight: fontWeight.bold },
  invFullEmpty: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  invFullEmptyText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Correction
  correctionDiffRow: { marginTop: spacing[1.5] },
});
