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
import { productsApi, warehouseCategoriesApi, uploadsApi, warehousesApi, stockMovementsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import { BottomSheet } from '../components/BottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import AnimatedCard from '../components/AnimatedCard';
import ProductPickerModal from '../components/ProductPickerModal';
import type { FolderAnnotation } from '../components/ProductPickerModal';
import ProductMovementHistoryModal from '../components/ProductMovementHistoryModal';
import TrashScreen from './TrashScreen';
import WarehouseSwitcher from '../components/WarehouseSwitcher';
import FreshnessBadge from '../components/FreshnessBadge';
import BarcodeScanner from '../components/BarcodeScanner';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { PRODUCT_LIST_FIELDS } from '../constants/productFields';
import type { Product, PaginatedResponse, StockMovement, Warehouse } from '../../../shared/types';

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
  /** Palette tokens \u2014 passed in so the memoised row picks up dark mode
   *  without subscribing to the theme context itself. */
  rowBg: string;
  separatorColor: string;
  textPrimary: string;
  textTertiary: string;
  iconBoxBg: string;
}

const FolderRow = React.memo(function FolderRow({
  folderName,
  count,
  hasLow,
  lastCheckIso,
  onOpen,
  rowBg,
  separatorColor,
  textPrimary,
  textTertiary,
  iconBoxBg,
}: FolderRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onOpen(folderName)}
      activeOpacity={0.6}
      style={[styles.folderRow, { backgroundColor: rowBg, borderBottomColor: separatorColor }]}
    >
      <View style={[styles.folderIconBox, { backgroundColor: iconBoxBg }]}>
        <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
      </View>
      <View style={styles.folderRowInfo}>
        <Text style={[styles.folderRowName, { color: textPrimary }]} numberOfLines={1}>
          {folderName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.folderRowCount, { color: textTertiary }]}>
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
      <Ionicons name="chevron-forward" size={16} color={textTertiary} />
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
  /** Row tap — opens the dedicated ProductDetailScreen. */
  onOpenDetail: (product: Product) => void;
  onOpenPhoto: (uri: string) => void;
  /** Long-press handler — when present, shown via AnimatedCard.onLongPress.
   *  Used by ProductsScreen to open the per-product action sheet (move to
   *  defect / Б-У) when viewing the main warehouse. */
  onLongPress?: (product: Product) => void;
  /** "Установить цену" — inline-CTA для товаров на складе Б/У без
   *  розничной цены. Когда передан, заменяет sellPrice в карточке. */
  onSetSellPrice?: (product: Product) => void;
  /** Palette tokens — passed in so the memoised row picks up dark mode
   *  without subscribing to the theme context itself. */
  rowBg: string;
  separatorColor: string;
  textPrimary: string;
  textTertiary: string;
  photoPlaceholderBg: string;
  /** Theme-aware fill for the «Установить цену» CTA — pale amber in light,
   *  a translucent amber glow in dark (washed amber[50] reads dirty on the
   *  dark canvas). Computed by the parent so the row stays prop-driven. */
  pricelessCtaBg: string;
}
const ProductRow = React.memo(function ProductRow({
  item,
  index,
  hideCategory,
  canSeeCostPrice,
  onOpenDetail,
  onOpenPhoto,
  onLongPress,
  onSetSellPrice,
  rowBg,
  separatorColor,
  textPrimary,
  textTertiary,
  photoPlaceholderBg,
  pricelessCtaBg,
}: ProductRowProps) {
  const lowStock = item.stock <= item.minStock && item.minStock > 0;
  const pUri = getImageUrl(item.photo);
  // Товар «без цены» — пустой или нулевой sellPrice. Б/У-склад часто
  // заводит товары с null'ом, чтобы владелец выставил цену позже.
  const missingSellPrice = onSetSellPrice && (item.sellPrice == null || item.sellPrice === 0);
  return (
    <AnimatedCard
      index={index}
      style={[styles.productCard, { backgroundColor: rowBg, borderBottomColor: separatorColor }]}
      onPress={() => onOpenDetail(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
    >
      <View style={styles.productRow}>
        <TouchableOpacity
          onPress={() => {
            if (pUri) onOpenPhoto(pUri);
          }}
        >
          {pUri ? (
            <CachedImage source={{ uri: pUri }} style={styles.productPhoto} resizeMode="cover" />
          ) : (
            <View style={[styles.productPhotoPlaceholder, { backgroundColor: photoPlaceholderBg }]}>
              <Ionicons name="cube-outline" size={22} color={textTertiary} />
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.category && !hideCategory && (
            <Text style={[styles.productCategory, { color: textTertiary }]}>{item.category.split('/').pop()}</Text>
          )}
          <View style={styles.productPrices}>
            {missingSellPrice ? (
              <TouchableOpacity
                onPress={() => onSetSellPrice!(item)}
                style={[styles.pricelessCta, { backgroundColor: pricelessCtaBg }]}
                hitSlop={6}
                accessibilityLabel="Установить розничную цену"
              >
                <Ionicons name="pricetag-outline" size={12} color={colors.amber[700]} />
                <Text style={styles.pricelessCtaText}>Установить цену</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.productSellPrice}>{formatMoney(item.sellPrice)}</Text>
            )}
            {canSeeCostPrice && (
              <Text style={[styles.productCostPrice, { color: textTertiary }]}>
                Себест. {formatMoney(item.costPrice)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.productStockWrap}>
          {lowStock && <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />}
          <Text style={[styles.productStock, { color: textPrimary }, lowStock && styles.productStockLow]}>
            {item.stock}
          </Text>
          <Text style={[styles.productStockLabel, { color: textTertiary }]}>шт</Text>
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
  const palette = useColors();
  // Theme-aware override for the shared `styles.formInput` so warehouse
  // form sheets render correctly in dark mode (muted fill, hairline
  // border, primary text). In light mode these tokens resolve to the
  // exact same values the static style used (gray[50]/gray[300]/gray[900]
  // → bg.muted/border.subtle/text.primary), so light mode is unchanged.
  const formInputThemed = React.useMemo(
    () => ({
      backgroundColor: palette.bg.muted,
      borderColor: palette.border.subtle,
      color: palette.text.primary,
    }),
    [palette],
  );
  const { hasPermission, user } = useAuth();
  const isOwner = user?.role === 'director' || user?.role === 'superadmin';
  const canManageWarehouse = hasPermission('warehouse_access');
  // Directors, admins, superadmins see cost price. Masters don't.
  const canSeeCostPrice = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';

  const [search, setSearch] = useState('');
  const limit = 500;
  // Slim list payload (audit #5) — `?fields=` projection. The field set now
  // lives in src/constants/productFields.ts (PRODUCT_LIST_FIELDS), shared
  // with the AuthContext login prefetch so the warmed cache entry is
  // byte-identical to what this screen fetches itself.
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

  // Barcode scan → product lookup. Tapping «Сканировать» in the header opens
  // the camera; a decoded code is matched against the loaded list's `barcode`
  // field (PRODUCT_LIST_FIELDS includes it) and opens that product, or offers
  // to create one when nothing matches.
  const [showScanner, setShowScanner] = useState(false);

  // Inventory modal state
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryItems, setInventoryItems] = useState<
    { productId: string; name: string; currentStock: number; actualStock: string }[]
  >([]);
  const [inventoryReason, setInventoryReason] = useState('');
  const [showInventoryPicker, setShowInventoryPicker] = useState(false);
  // Non-null while the sequential per-item inventory commit runs —
  // drives the «N из M…» counter on the submit button and blocks re-entry.
  const [inventoryCommitProgress, setInventoryCommitProgress] = useState<{ done: number; total: number } | null>(null);

  // Inventory folder navigation (separate from main warehouse)
  const [invActivePath, setInvActivePath] = useState<string[]>([]);

  // Writeoff modal state
  const [showWriteoffModal, setShowWriteoffModal] = useState(false);
  const [writeoffProductId, setWriteoffProductId] = useState('');
  const [writeoffProductName, setWriteoffProductName] = useState('');
  const [writeoffProductStock, setWriteoffProductStock] = useState(0);
  const [writeoffProductCostPrice, setWriteoffProductCostPrice] = useState(0);
  const [writeoffQty, setWriteoffQty] = useState('');
  const [writeoffReason, setWriteoffReason] = useState('');
  // Two-mode writeoff: 'expense' = recordAsExpense=true (по закупке),
  // 'simple' = recordAsExpense=false (просто списать). Default 'expense'
  // because owners overwhelmingly want the cost reflected in financials.
  const [writeoffMode, setWriteoffMode] = useState<'expense' | 'simple'>('expense');
  const [showWriteoffPicker, setShowWriteoffPicker] = useState(false);

  // Warehouse switcher state. The list of warehouses is fetched once
  // (cached/persisted); the selection lives in component state and
  // intentionally does NOT persist across mounts — owner spec.
  const [showWarehouseSwitcher, setShowWarehouseSwitcher] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);

  // Per-product action sheet (only on main warehouse): edit / move to
  // defect / move to used. Opened by long-press on a product row.
  const [actionsForProduct, setActionsForProduct] = useState<Product | null>(null);

  // «История движения товара» — read-only журнал stock-movements по одному
  // товару. Открывается из action-sheet (long-press) и из окна
  // редактирования товара. null → модалка закрыта.
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);

  // "Установить цену" — inline-редактор розничной цены для товаров
  // склада Б/У. Открывается тапом по CTA «Установить цену» на карточке
  // товара. Используется только в used-варианте, чтобы не дублировать
  // полное окно редактирования товара.
  const [sellPriceProduct, setSellPriceProduct] = useState<Product | null>(null);
  const [sellPriceInput, setSellPriceInput] = useState('');

  // Transfer dialog state — used for both defect_transfer and
  // used_transfer because the body shape is identical (only the
  // movement type differs).
  const [transferTarget, setTransferTarget] = useState<'defect' | 'used' | null>(null);
  const [transferProduct, setTransferProduct] = useState<Product | null>(null);
  const [transferQty, setTransferQty] = useState('');
  // Причина обязательна для defect_transfer (бэк требует) и валидируется
  // на нашей стороне до отправки. Для used_transfer пока опционально —
  // если бэк начнёт требовать, валидация поднимется здесь же.
  const [transferReason, setTransferReason] = useState('');

  // Correction modal state
  const [showCorrectionPicker, setShowCorrectionPicker] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionProductId, setCorrectionProductId] = useState('');
  const [correctionProductName, setCorrectionProductName] = useState('');
  const [correctionProductStock, setCorrectionProductStock] = useState(0);
  const [correctionProductCostPrice, setCorrectionProductCostPrice] = useState(0);
  const [correctionNewStock, setCorrectionNewStock] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  // Warehouses list — server returns the 3 fixed rows (main / defect /
  // used). Persisted (PERSISTED_KEYS contains 'warehouses') so the
  // switcher opens instantly on cold start.
  const {
    data: warehouses,
    isFetching: whIsFetching,
    isLoading: whIsLoading,
    dataUpdatedAt: whDataUpdatedAt,
    isError: whIsError,
    refetch: whRefetch,
  } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await warehousesApi.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 60_000,
  });

  // Derive the warehouse that is currently selected. We pick the "main"
  // warehouse by default; otherwise honour the user's explicit choice.
  // `selectedWarehouseId` lives in local state and resets on mount, so
  // entering /Склад always starts on the main warehouse.
  const activeWarehouse = useMemo<Warehouse | null>(() => {
    if (!warehouses || warehouses.length === 0) return null;
    if (selectedWarehouseId) {
      const found = warehouses.find((w) => w.id === selectedWarehouseId);
      if (found) return found;
    }
    return warehouses.find((w) => w.kind === 'main') ?? warehouses[0];
  }, [warehouses, selectedWarehouseId]);

  const activeWarehouseId = activeWarehouse?.id;
  const isMainWarehouse = activeWarehouse?.kind === 'main';

  const { data, isLoading, isFetching, dataUpdatedAt, isError, refetch } = useQuery<PaginatedResponse<Product>>({
    // Include warehouseId in the key so each warehouse owns its own
    // cache slot — switching tabs is instant via `placeholderData` while
    // the new slot's fresh data arrives in the background.
    queryKey: ['products', { search, limit, warehouseId: activeWarehouseId ?? null }],
    queryFn: async () => {
      const res = await productsApi.getAll({
        search,
        page: 1,
        limit,
        // Project to the columns the list actually renders. Cast because
        // `fields` is a pass-through axios query param, not part of the
        // shared PaginationParams contract (which we must not touch).
        fields: PRODUCT_LIST_FIELDS,
        ...(activeWarehouseId ? { warehouseId: activeWarehouseId } : {}),
      } as Parameters<typeof productsApi.getAll>[0] & { fields: string });
      return res.data;
    },
    // Defence-in-depth: the global QueryClient already sets
    // placeholderData = prev=>prev, but writing it here too makes the
    // intent explicit and survives any future global default change.
    placeholderData: (prev) => prev,
    // ALWAYS enabled — deliberately NO `enabled` gate. The previous
    // `enabled: !!activeWarehouseId || warehouses === undefined` stranded
    // the screen in an ETERNAL skeleton whenever the warehouses query
    // resolved to `[]`: data was defined, no id could be derived, the
    // query sat disabled in pending/idle forever (data === undefined,
    // isLoading false) and the render gate below showed a dead loader
    // with nothing in flight. The backend falls back to the main
    // warehouse when `warehouseId` is omitted, so firing un-scoped in
    // that state renders real content instead. On the normal path the
    // hydrated/prefetched ['warehouses'] cache makes `activeWarehouseId`
    // available on the very first render → exactly one scoped fetch, no
    // extra traffic.
  });

  // Per-warehouse folders (migration 032). Each warehouse owns its own
  // tree — switching warehouse changes the visible folder list, no
  // bleed-through. We still gate by `activeWarehouseId` so the first
  // render (before the warehouses query resolves) doesn't fire an
  // un-scoped categories request that would later be discarded.
  const { data: extraFolders } = useQuery({
    queryKey: activeWarehouseId
      ? ['warehouse-categories', { warehouseId: activeWarehouseId }]
      : ['warehouse-categories'],
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll(activeWarehouseId || undefined);
      return res.data;
    },
    enabled: !!activeWarehouseId,
  });

  // Inventory movements drive two things only: the "проверка DD.MM.YY"
  // folder badges (visible in browse mode, never while searching) and the
  // green "checked recently" annotations inside the inventory modal/picker.
  // Audit #5: this used to fire UNCONDITIONALLY with limit:1000 on every
  // screen entry — the heaviest non-list fetch — even during a product
  // search where its output is never read. Gate it to the cases that
  // actually consume it so a cold search doesn't pay for movements.
  //
  // Backend hard-caps movements at LIMIT 200 (products.service.getMovements)
  // and ignores any higher `limit`, so requesting 1000 was wasted intent;
  // ask for 200 to match reality.
  // `!search` ≈ browse/folder mode, the only state where folder "проверка"
  // badges can render. We deliberately don't also test `sortedFolders.length`
  // here — that value is derived further down the component and isn't in
  // scope yet; gating on search-vs-browse already removes the fetch from the
  // hot path (typing a product search). A flat warehouse with no folders may
  // still fetch once, which is harmless: the badges simply have nowhere to
  // show.
  const needsInventoryMovements =
    !search || // folder badges visible in browse mode
    showInventoryModal || // inventory sheet green-tints rows
    showInventoryPicker; // inventory picker shows folder annotations
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements({ limit: 200 });
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
    enabled: needsInventoryMovements,
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
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Product picker in \u041A\u0430\u0441\u0441\u0430 reads the full list under its own key \u2014
      // keep it in sync, otherwise the picker shows stale price/stock.
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      closeModal();
    },
    onError: () => {
      haptic('error');
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0442\u043E\u0432\u0430\u0440\u0430',
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      closeModal();
    },
    onError: () => {
      haptic('error');
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438',
      );
    },
  });

  // Optimistic stock update \u2014 applies the new value to every cached
  // products list immediately, so the row in the warehouse jumps to its
  // new number before the network round-trip completes. The server
  // response is the source of truth: invalidation in `onSettled`
  // overwrites any drift between optimistic delta and actual stockAfter
  // (e.g. parallel sale on another device).
  const stockMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { type: 'income' | 'expense' | 'writeoff' | 'inventory'; quantity: number; reason?: string };
    }) => productsApi.updateStock(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['products'] });
      const prev = queryClient.getQueriesData<PaginatedResponse<Product> | undefined>({ queryKey: ['products'] });
      // Compute the optimistic delta for the row matching `id`. Inventory
      // sets stock absolutely; income adds; expense / writeoff subtract.
      queryClient.setQueriesData<PaginatedResponse<Product> | undefined>({ queryKey: ['products'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((p) => {
            if (p.id !== id) return p;
            const next =
              data.type === 'inventory'
                ? data.quantity
                : data.type === 'income'
                  ? p.stock + data.quantity
                  : p.stock - data.quantity;
            return { ...p, stock: Math.max(0, next) };
          }),
        };
      });
      return { prev };
    },
    onError: (err: any, _vars, ctx) => {
      haptic('error');
      ctx?.prev.forEach(([key, val]) => queryClient.setQueryData(key, val));
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        err?.response?.data?.message ||
          '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0430',
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
    },
  });

  // Удаление/переименование папок и реордер на iOS отключены iter#12 —
  // ни одно из этих действий из мобилки сейчас не делается. Соответствующие
  // мутации (`warehouseCategoriesApi.remove/rename/updateOrder`) остались
  // на бэке и доступны через web-админ. Никакого UI они здесь больше не
  // имеют, чтобы не подкидывать нестабильный gesture-стек.

  const allProducts = Array.isArray(data?.data) ? data.data : [];

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

  // Row tap → dedicated detail screen (pushed onto THIS Products tab-stack so
  // the floating tab bar stays visible and edge-swipe pops back to the list).
  const openDetail = useCallback(
    (p: Product) => {
      haptic('tap');
      navigation.navigate('ProductDetail', { product: p });
    },
    [navigation],
  );

  // Barcode scan → find the matching product (by `barcode`) in the loaded list
  // and open it; offer to create one when nothing matches. We match against
  // the already-loaded warehouse list (no barcode lookup endpoint exists), so
  // a code from a product on ANOTHER warehouse won't resolve here.
  const handleBarcodeScanned = useCallback(
    (code: string) => {
      setShowScanner(false);
      const needle = code.trim();
      const match = allProducts.find((p) => String(p.barcode || '').trim() === needle);
      if (match) {
        haptic('success');
        navigation.navigate('ProductDetail', { product: match });
        return;
      }
      haptic('warning');
      Alert.alert('Товар не найден', `Штрих-код ${needle} не привязан ни к одному товару этого склада.`, [
        { text: 'Отмена', style: 'cancel' },
        ...(hasPermission('warehouse_access') && activeWarehouse?.kind === 'main'
          ? [{ text: 'Создать товар', onPress: openCreate }]
          : []),
      ]);
    },
    // `openCreate` is a stable screen-scope function; allProducts/activeWarehouse
    // change with data — intentionally included so the latest list is matched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allProducts, navigation, activeWarehouse, hasPermission],
  );

  // ProductDetailScreen's «Изменить» reuses THIS screen's edit modal: it sets
  // `editProduct` on our route and pops back. Consume it once, open the modal,
  // then clear the param so a re-focus/re-render doesn't re-open it.
  const editProductParam: Product | undefined = route.params?.editProduct;
  React.useEffect(() => {
    if (!editProductParam) return;
    openEdit(editProductParam);
    navigation.setParams({ editProduct: undefined });
  }, [editProductParam, openEdit, navigation]);

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
      // New products inherit the currently selected warehouse. On edit
      // we don't override warehouseId — moving between warehouses is
      // done via dedicated transfer actions, not the edit form.
      ...(editingProduct ? {} : activeWarehouseId ? { warehouseId: activeWarehouseId } : {}),
    };
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // Invalidate ALL warehouse slots — the user might have moved stock
    // between warehouses since the last refresh, and we don't want to
    // leave defect/used stale.
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
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

  // Inventory commit is a sequence of independent per-item server calls —
  // NOT a transaction. A mid-loop failure used to abort the whole batch
  // silently (items before the failure were committed, the rest were not,
  // and the user only saw a generic error). Now every item is attempted,
  // failures are collected and can be retried without re-sending the
  // items that already landed on the server.
  const commitInventoryItems = async (
    toCommit: { productId: string; name: string; currentStock: number; actualStock: string }[],
    totals: { shortageTotal: number; excessTotal: number; sessionCount: number },
  ) => {
    setInventoryCommitProgress({ done: 0, total: toCommit.length });
    const failed: typeof toCommit = [];
    let firstErrorMsg = '';
    try {
      for (let i = 0; i < toCommit.length; i++) {
        const item = toCommit[i];
        try {
          await productsApi.updateStock(item.productId, {
            type: 'inventory' as const,
            quantity: Number(item.actualStock) || 0,
            reason: inventoryReason || undefined,
          });
          // The sheet now reflects the server: the row is no longer
          // «changed», so a retry pass won't re-send it.
          setInventoryItems((prev) =>
            prev.map((it) =>
              it.productId === item.productId ? { ...it, currentStock: Number(item.actualStock) || 0 } : it,
            ),
          );
        } catch (err: any) {
          failed.push(item);
          if (!firstErrorMsg) firstErrorMsg = err?.response?.data?.message || '';
        }
        setInventoryCommitProgress({ done: i + 1, total: toCommit.length });
      }
    } finally {
      // Whatever happened, part of the batch may have landed on the
      // server — the cached lists must refetch.
      setInventoryCommitProgress(null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
    }

    if (failed.length === 0) {
      haptic('success');
      setShowInventoryModal(false);
      Alert.alert(
        'Готово',
        `Инвентаризация завершена. Изменено: ${totals.sessionCount} товаров. Недостача: ${formatMoney(totals.shortageTotal)}, Излишки: ${formatMoney(totals.excessTotal)}`,
      );
      return;
    }

    haptic('error');
    const failedList = failed.map((f) => `• ${f.name}`).join('\n');
    Alert.alert(
      'Инвентаризация не завершена',
      `Проведено ${toCommit.length - failed.length} из ${toCommit.length}. Не удалось обновить:\n${failedList}` +
        (firstErrorMsg ? `\n\n${firstErrorMsg}` : ''),
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Повторить незавершённые', onPress: () => commitInventoryItems(failed, totals) },
      ],
    );
  };

  const handleInventorySubmit = async () => {
    if (inventoryCommitProgress) return;
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

    await commitInventoryItems(changed, { shortageTotal, excessTotal, sessionCount: changed.length });
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
    setWriteoffProductCostPrice(p.costPrice || 0);
    setWriteoffQty('');
    setWriteoffReason('');
    setWriteoffMode('expense');
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
    if (!activeWarehouseId) {
      Alert.alert(
        '\u041E\u0448\u0438\u0431\u043A\u0430',
        '\u0421\u043A\u043B\u0430\u0434 \u0435\u0449\u0451 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D',
      );
      return;
    }

    try {
      await stockMovementsApi.create({
        type: 'writeoff' as const,
        warehouseId: activeWarehouseId,
        productId: writeoffProductId,
        quantity: qty,
        purchasePrice: writeoffProductCostPrice,
        recordAsExpense: writeoffMode === 'expense',
        reason: writeoffReason.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      setShowWriteoffModal(false);
      Alert.alert(
        '\u0413\u043E\u0442\u043E\u0432\u043E',
        `\u0421\u043F\u0438\u0441\u0430\u043D\u043E ${qty} \u0448\u0442. "${writeoffProductName}"${writeoffMode === 'expense' ? ' (\u0441 \u0443\u0447\u0451\u0442\u043E\u043C \u0432 \u0440\u0430\u0441\u0445\u043E\u0434\u0430\u0445)' : ''}`,
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

  // --- Sell price editor (Б/У warehouse) -----------------------------
  // Открывает компактный модал-форму с одним полем «цена ₽». На submit
  // вызывает productsApi.setSellPrice и инвалидирует products-cache —
  // карточка моментально перерисуется с цифрой вместо CTA.
  const openSellPriceEditor = useCallback((p: Product) => {
    setSellPriceProduct(p);
    // Если у товара уже есть какая-то цена (но мы её всё равно показали
    // как «без цены», бывает при null'е) — заполним поле. В обычном
    // null-кейсе поле остаётся пустым.
    setSellPriceInput(p.sellPrice && p.sellPrice > 0 ? String(p.sellPrice) : '');
  }, []);

  const closeSellPriceEditor = () => {
    setSellPriceProduct(null);
    setSellPriceInput('');
  };

  const setSellPriceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) => productsApi.setSellPrice(id, price),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      closeSellPriceEditor();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось установить цену');
    },
  });

  const handleSetSellPriceSubmit = () => {
    if (!sellPriceProduct) return;
    const price = Number(sellPriceInput);
    if (!isFinite(price) || price <= 0) {
      Alert.alert('Ошибка', 'Цена должна быть больше 0.');
      return;
    }
    setSellPriceMutation.mutate({ id: sellPriceProduct.id, price });
  };

  // --- Transfer handlers (main → defect / used) ----------------------
  // Long-press on a product row (main warehouse only) opens the action
  // sheet `actionsForProduct`. Selecting one of the transfer actions
  // populates `transferTarget` + `transferProduct` and opens the qty
  // dialog. On submit we POST a `defect_transfer` or `used_transfer`
  // stock movement and invalidate the products query so both the source
  // and (when the user switches) the target list refresh.
  const openTransferDialog = (target: 'defect' | 'used', product: Product) => {
    setTransferTarget(target);
    setTransferProduct(product);
    setTransferQty('');
    setTransferReason('');
    setActionsForProduct(null);
  };

  const closeTransferDialog = () => {
    setTransferTarget(null);
    setTransferProduct(null);
    setTransferQty('');
    setTransferReason('');
  };

  const handleTransferSubmit = async () => {
    if (!transferProduct || !transferTarget) return;
    const qty = Number(transferQty);
    if (!qty || qty <= 0) {
      Alert.alert('Ошибка', 'Укажите количество');
      return;
    }
    if (qty > transferProduct.stock) {
      Alert.alert('Ошибка', `Нельзя перенести больше чем есть на складе (${transferProduct.stock})`);
      return;
    }
    if (!warehouses || warehouses.length === 0) {
      Alert.alert('Ошибка', 'Склады ещё не загружены');
      return;
    }
    const source = warehouses.find((w) => w.kind === 'main');
    const target = warehouses.find((w) => w.kind === transferTarget);
    if (!source || !target) {
      Alert.alert('Ошибка', 'Не удалось определить склад');
      return;
    }
    const reasonTrimmed = transferReason.trim();
    // Для defect — причина обязательна. У used_transfer оставляем
    // её опциональной, чтобы не ломать привычку владельца.
    if (transferTarget === 'defect' && !reasonTrimmed) {
      Alert.alert('Ошибка', 'Укажите причину переноса в брак.');
      return;
    }

    try {
      if (transferTarget === 'defect') {
        // Используем удобный wrapper — UI явно говорит «перевод в брак»,
        // и в кодовой базе одно место, которое отвечает за этот flow.
        await stockMovementsApi.transferToDefect({
          productId: transferProduct.id,
          fromWarehouseId: source.id,
          quantity: qty,
          reason: reasonTrimmed,
        });
      } else {
        await stockMovementsApi.create({
          type: 'used_transfer',
          sourceWarehouseId: source.id,
          targetWarehouseId: target.id,
          productId: transferProduct.id,
          quantity: qty,
          purchasePrice: transferProduct.costPrice || 0,
          ...(reasonTrimmed ? { reason: reasonTrimmed } : {}),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      const targetLabel = transferTarget === 'defect' ? 'брак' : 'Б/У';
      const productName = transferProduct.name;
      closeTransferDialog();
      Alert.alert('Готово', `Перенесено ${qty} шт. "${productName}" в ${targetLabel}`);
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка при переносе');
    }
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
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
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
      <View style={[styles.foldersList, { backgroundColor: palette.bg.card }]}>
        {sortedFolders.map(([folderName, info]) => (
          <FolderRow
            key={folderName}
            folderName={folderName}
            count={info.count}
            hasLow={info.hasLow}
            lastCheckIso={folderLastCheck.get(folderName)}
            onOpen={enterFolder}
            rowBg={palette.bg.card}
            separatorColor={palette.border.subtle}
            textPrimary={palette.text.primary}
            textTertiary={palette.text.tertiary}
            iconBoxBg={palette.accent.primarySoft}
          />
        ))}
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search,
    sortedFolders,
    folderLastCheck,
    palette.bg.card,
    palette.border.subtle,
    palette.text.primary,
    palette.text.tertiary,
    palette.accent.primarySoft,
  ]);

  // Stable references for the warehouse FlashList — keys and render
  // function. The renderItem indirection lets the memoised ProductRow
  // do its own equality check on each item; the wrapper only re-creates
  // when one of the captured props (search, canSeeCostPrice, handlers)
  // actually changes.
  const productKey = useCallback((item: Product) => item.id, []);
  // Stable long-press handler. `openActionsForProduct` is recreated each
  // render but the eslint-disable below already covers that case for
  // openEdit; we add isMainWarehouse to deps to flip the wiring when the
  // user switches warehouses.
  const openActionsForProduct = useCallback((p: Product) => {
    setActionsForProduct(p);
  }, []);
  // Б/У-склад — единственное место, где имеет смысл inline-редактор
  // розничной цены: товары там создаются с null-ом цены, чтобы владелец
  // выставил её позже. На основном складе цена всегда задаётся при
  // создании, поэтому CTA не показываем.
  const isUsedWarehouse = activeWarehouse?.kind === 'used';
  const renderProductItem = useCallback(
    ({ item, index }: { item: Product; index: number }) => (
      <ProductRow
        item={item}
        index={index}
        hideCategory={!!search}
        canSeeCostPrice={canSeeCostPrice}
        onOpenDetail={openDetail}
        onOpenPhoto={setFullscreenPhoto}
        // Long-press only enabled on the main warehouse — moving FROM
        // defect/used isn't a defined movement type yet.
        onLongPress={isMainWarehouse && canManageWarehouse ? openActionsForProduct : undefined}
        onSetSellPrice={isUsedWarehouse && canManageWarehouse ? openSellPriceEditor : undefined}
        rowBg={palette.bg.card}
        separatorColor={palette.border.subtle}
        textPrimary={palette.text.primary}
        textTertiary={palette.text.tertiary}
        photoPlaceholderBg={palette.bg.muted}
        pricelessCtaBg={palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50]}
      />
    ),
    // openEdit is recreated each render (uses local state), and search
    // changes drive `hideCategory`. canSeeCostPrice is a stable bool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      search,
      canSeeCostPrice,
      openDetail,
      isMainWarehouse,
      isUsedWarehouse,
      canManageWarehouse,
      openActionsForProduct,
      openSellPriceEditor,
      palette.bg.card,
      palette.bg.muted,
      palette.border.subtle,
      palette.text.primary,
      palette.text.tertiary,
      palette.mode,
    ],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Unified iOS header \u2014 same component as \u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 / \u0416\u0443\u0440\u043D\u0430\u043B
          / \u041F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0438. Title becomes the warehouse name (e.g. "\u0421\u043A\u043B\u0430\u0434
          \u0431\u0440\u0430\u043A\u0430") so the user always knows which warehouse they're
          looking at. A leading layers-glyph button (and a tap on the
          title itself, via `leading` slot + onPress in the title row
          below) opens the warehouse switcher sheet. */}
      <IosScreenHeader
        title={activeWarehouse?.name || '\u0421\u043A\u043B\u0430\u0434'}
        subtitle={data === undefined ? undefined : `${warehouseStats.count} \u0442\u043E\u0432\u0430\u0440\u043E\u0432`}
        leading={
          warehouses && warehouses.length > 1 ? (
            <TouchableOpacity
              onPress={() => setShowWarehouseSwitcher(true)}
              style={[styles.switcherBtn, { backgroundColor: palette.bg.muted }]}
              accessibilityRole="button"
              accessibilityLabel={'\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0441\u043A\u043B\u0430\u0434'}
              hitSlop={8}
            >
              <Ionicons name="layers-outline" size={18} color={palette.text.primary} />
              <Ionicons name="chevron-down" size={12} color={palette.text.secondary} style={{ marginLeft: -2 }} />
            </TouchableOpacity>
          ) : null
        }
        trailing={
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            {/* Сканировать — barcode → найти и открыть товар. Read-only action,
                shown to everyone who can see the warehouse. The scanner itself
                degrades gracefully if the camera native module isn't linked. */}
            <TouchableOpacity
              style={[
                styles.opsBtn,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.orange[600], 'dark') : colors.orange[50] },
              ]}
              onPress={() => {
                haptic('tap');
                setShowScanner(true);
              }}
              accessibilityLabel="Сканировать штрих-код"
            >
              <Ionicons name="barcode-outline" size={18} color={colors.primary[600]} />
            </TouchableOpacity>
            {hasPermission('warehouse_access') && (
              <TouchableOpacity
                style={[
                  styles.opsBtn,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.orange[600], 'dark') : colors.orange[50],
                  },
                ]}
                onPress={() => setShowOpsModal(true)}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.orange[600]} />
              </TouchableOpacity>
            )}
            {/* «+» создаёт товар в текущем складе. На складе брака этого
                делать нельзя: товары туда попадают только переводом со
                склада или возвратом от клиента (бэк бы 400'нул). Скрываем
                кнопку, чтобы UI не путал владельца. На used (Б/У) товары
                заводятся через «Покупка б/у» у системного поставщика,
                поэтому на used-складе тоже прячем создание. */}
            {hasPermission('warehouse_access') && activeWarehouse?.kind === 'main' && (
              <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
                <Ionicons name="add" size={18} color={colors.white} />
              </TouchableOpacity>
            )}
          </View>
        }
      />
      {/* FreshnessBadge \u2014 HYBRID-perf plan. Pinned just under the header,
          driven by the products + warehouses queries. Hidden when there
          is no data yet (cold cache miss + first fetch) so we don't
          stack a pulsing pill on top of the skeleton. */}
      <View style={styles.freshnessRow}>
        <FreshnessBadge
          queries={[
            { isFetching, isLoading, dataUpdatedAt },
            { isFetching: whIsFetching, isLoading: whIsLoading, dataUpdatedAt: whDataUpdatedAt },
          ]}
        />
      </View>
      {/* Title-tap zone \u2014 owner spec: tapping the word "\u0421\u043A\u043B\u0430\u0434" itself
          opens the switcher. The IosScreenHeader doesn't expose a
          title-press hook, so we overlay an invisible Pressable that
          covers the title text region. Pinned to insetsTop so it sits
          right over the title row regardless of device safe area. */}
      {warehouses && warehouses.length > 1 && (
        <Pressable
          onPress={() => setShowWarehouseSwitcher(true)}
          style={[styles.titleTapZone, { top: insetsTop + spacing[2] }]}
          accessibilityRole="button"
          accessibilityLabel={'\u0421\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u043A\u043B\u0430\u0434'}
        />
      )}

      {/* Stats cards (\u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C / \u0432 \u0440\u043E\u0437\u043D. \u0446\u0435\u043D\u0430\u0445) intentionally
          REMOVED from the warehouse top \u2014 these belong in the Reports
          screen, not in the warehouse header. Owner spec: "\u0441\u043A\u043B\u0430\u0434 \u0438\u043C\u0435\u0435\u0442
          \u0430\u043A\u043A\u0443\u0440\u0430\u0442\u043D\u0443\u044E \u0448\u0430\u043F\u043A\u0443 \u0431\u0435\u0437 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0445 \u0441\u0443\u043C\u043C". */}

      {/* Breadcrumb */}
      {activePath.length > 0 && !search && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => goToLevel(0)} style={styles.breadcrumbItem}>
            <Ionicons name="home-outline" size={14} color={palette.accent.primary} />
            <Text style={[styles.breadcrumbText, { color: palette.accent.primary }]}>{'\u0412\u0441\u0435'}</Text>
          </TouchableOpacity>
          {activePath.map((seg, i) => (
            <React.Fragment key={i}>
              <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
              <TouchableOpacity onPress={() => goToLevel(i + 1)} style={styles.breadcrumbItem}>
                <Text
                  style={[
                    styles.breadcrumbText,
                    { color: palette.accent.primary },
                    i === activePath.length - 1 && [styles.breadcrumbTextActive, { color: palette.text.primary }],
                  ]}
                >
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

      {/* \u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u043F\u043B\u0430\u0448\u043A\u0430 \u0434\u043B\u044F defect-\u0441\u043A\u043B\u0430\u0434\u0430. \u0422\u043E\u0432\u0430\u0440\u044B \u0442\u0443\u0434\u0430 \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442
          \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 \u043F\u0435\u0440\u0435\u043D\u043E\u0441 / \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u2014 UI \u044D\u0442\u043E \u043E\u0431\u044A\u044F\u0441\u043D\u044F\u0435\u0442, \u0447\u0442\u043E\u0431\u044B
          \u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 \u043D\u0435 \u0438\u0441\u043A\u0430\u043B \u043A\u043D\u043E\u043F\u043A\u0443 \u00AB+\u00BB. \u0412\u0438\u0434\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u043A\u043E\u0440\u043D\u0435 \u0441\u043A\u043B\u0430\u0434\u0430,
          \u043D\u0435 \u0434\u0443\u0431\u043B\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043D\u0430 \u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430\u0445, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0437\u0430\u0433\u0440\u043E\u043C\u043E\u0436\u0434\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A. */}
      {activeWarehouse?.kind === 'defect' && activePath.length === 0 && !search && (
        <View
          style={[styles.defectInfoHint, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.orange[600]} />
          <Text style={[styles.defectInfoHintText, { color: palette.text.secondary }]}>
            Товары попадают в брак только через перемещение со склада или возврат от клиента
          </Text>
        </View>
      )}

      {/* Render gate \u2014 EVERY branch terminates in content, EmptyState or
          QueryErrorState. Never an eternal skeleton:
            1. data !== undefined           \u2192 list / EmptyState (stale-while-revalidate);
            2. data === undefined + isError \u2192 QueryErrorState with \u00ab\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c\u00bb
               (retries products AND, if it also failed, warehouses);
            3. data === undefined, no error \u2192 skeleton, which is always
               transient because the query has no `enabled` gate \u2014 a fetch
               is in flight or about to start, and its terminal states are
               exactly branches 1 and 2. */}
      {data === undefined && isError ? (
        <QueryErrorState
          title={
            '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u043a\u043b\u0430\u0434'
          }
          description={
            '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437'
          }
          onRetry={() => {
            refetch();
            // The warehouses list feeds the switcher + the scoped query
            // key \u2014 if it died too, heal it from the same button instead
            // of leaving the header degraded until pull-to-refresh.
            if (whIsError) whRefetch();
          }}
        />
      ) : data === undefined ? (
        <ListSkeleton count={8} />
      ) : !search && sortedFolders.length === 0 && currentProducts.length === 0 ? (
        <EmptyState
          title={'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}
          description={
            activeWarehouse?.kind === 'defect'
              ? '\u0422\u043E\u0432\u0430\u0440\u044B \u043F\u043E\u043F\u0430\u0434\u0430\u044E\u0442 \u0432 \u0431\u0440\u0430\u043A \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435 \u0441\u043E \u0441\u043A\u043B\u0430\u0434\u0430 \u0438\u043B\u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u043E\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0430'
              : activeWarehouse?.kind === 'used'
                ? '\u0411/\u0423 \u0442\u043E\u0432\u0430\u0440\u044B \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u043E\u0433\u043E \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0430 \u00AB\u041F\u043E\u043A\u0443\u043F\u043A\u0430 \u0431/\u0443\u00BB'
                : activePath.length > 0
                  ? '\u0412 \u044D\u0442\u043E\u0439 \u043F\u0430\u043F\u043A\u0435 \u043F\u0443\u0441\u0442\u043E'
                  : '\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440'
          }
          action={
            // Action-\u043A\u043D\u043E\u043F\u043A\u0430 \u00AB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C\u00BB \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u043C \u0441\u043A\u043B\u0430\u0434\u0435:
            // \u043D\u0430 defect/used \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u0438\u0434\u0451\u0442 \u0434\u0440\u0443\u0433\u0438\u043C \u043F\u0443\u0442\u0451\u043C.
            !activePath.length && activeWarehouse?.kind === 'main'
              ? { label: '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C', onPress: openCreate }
              : undefined
          }
        />
      ) : (
        <FlashList
          data={currentProducts}
          keyExtractor={productKey}
          // FlashList v2 auto-measures rows; no estimatedItemSize prop.
          // Memoised module-level component renders the row; the
          // wrapper here is only a closure that wires per-screen state
          // (search, permissions, photo lightbox setter). React.memo on
          // ProductRow short-circuits re-renders when those props are
          // stable, which they are across SWR refetches.
          renderItem={renderProductItem}
          contentContainerStyle={[
            styles.list,
            // iOS uses contentInset; Android needs explicit
            // paddingBottom or the last row sits under the M3 bar.
            Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null,
          ]}
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
          <TouchableOpacity
            style={[styles.photoPickerWrap, { borderColor: palette.border.subtle }]}
            onPress={pickImage}
          >
            {photoUri ? (
              <CachedImage
                source={{ uri: getDisplayPhotoUri(photoUri) }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.photoPickerPlaceholder, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="camera-outline" size={28} color={palette.text.tertiary} />
                <Text style={[styles.photoPickerText, { color: palette.text.tertiary }]}>
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
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
            {'\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435'}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={[styles.formInput, formInputThemed]}
            placeholder={'\u041C\u0430\u0441\u043B\u043E \u043C\u043E\u0442\u043E\u0440\u043D\u043E\u0435...'}
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
            {'\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F (\u043F\u0430\u043F\u043A\u0430)'}
          </Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            style={[styles.formInput, formInputThemed]}
            placeholder={'\u041C\u0430\u0441\u043B\u0430/\u041C\u043E\u0442\u043E\u0440\u043D\u044B\u0435'}
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.formHint, { color: palette.text.tertiary }]}>
            {
              '\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 / \u0434\u043B\u044F \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u0438'
            }
          </Text>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
              {'\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C'}
            </Text>
            <TextInput
              value={costPrice}
              onChangeText={setCostPrice}
              style={[styles.formInput, formInputThemed]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
              {'\u0426\u0435\u043D\u0430 \u043F\u0440\u043E\u0434\u0430\u0436\u0438'}
            </Text>
            <TextInput
              value={sellPrice}
              onChangeText={setSellPrice}
              style={[styles.formInput, formInputThemed]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
              {'\u041E\u0441\u0442\u0430\u0442\u043E\u043A'}
            </Text>
            <TextInput
              value={stock}
              onChangeText={setStock}
              style={[styles.formInput, formInputThemed]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
              {'\u041C\u0438\u043D. \u043E\u0441\u0442\u0430\u0442\u043E\u043A'}
            </Text>
            <TextInput
              value={minStock}
              onChangeText={setMinStock}
              style={[styles.formInput, formInputThemed]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </View>
        {editingProduct && (
          <TouchableOpacity
            style={[styles.historyLink, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}
            onPress={() => {
              const p = editingProduct;
              closeModal();
              setHistoryProduct(p);
            }}
          >
            <Ionicons name="swap-horizontal-outline" size={18} color={palette.accent.primary} />
            <Text style={[styles.historyLinkText, { color: palette.text.primary }]}>
              {'\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
        )}
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeModal}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>
              {'\u041E\u0442\u043C\u0435\u043D\u0430'}
            </Text>
          </TouchableOpacity>
          {editingProduct && (
            <TouchableOpacity
              style={[
                styles.deleteFormBtn,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
              ]}
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

      {/* Warehouse Operations - bottom-sheet action list (#2/#7
          consistency). Pull-to-dismiss + blur backdrop. heightRatio
          auto-fits the 3-4 rows. */}
      <BottomSheet
        visible={showOpsModal}
        onClose={() => setShowOpsModal(false)}
        title={
          '\u0421\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438'
        }
        heightRatio={0.5}
      >
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={() => {
            // Open the full-screen scan-driven Инвентаризация (ProductsStack).
            // The legacy inline-modal flow (openInventory) is retained in code
            // as a fallback but is no longer the active entry point.
            setShowOpsModal(false);
            navigation.navigate('Inventory');
          }}
        >
          <View
            style={[
              styles.opsIcon,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50] },
            ]}
          >
            <Ionicons name="clipboard-outline" size={22} color={colors.blue[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>
              {'\u0418\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044F'}
            </Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {
                '\u041F\u0435\u0440\u0435\u0441\u0447\u0451\u0442 \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435'
              }
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]} onPress={openWriteoff}>
          <View
            style={[
              styles.opsIcon,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
            ]}
          >
            <Ionicons name="trash-outline" size={22} color={colors.red[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>
              {'\u0421\u043F\u0438\u0441\u0430\u043D\u0438\u0435'}
            </Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {
                '\u0421\u043F\u0438\u0441\u0430\u0442\u044C \u0431\u0440\u0430\u043A, \u043F\u043E\u0442\u0435\u0440\u0438, \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u043A\u0443'
              }
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={openCorrection}
        >
          <View
            style={[
              styles.opsIcon,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.purple[600], 'dark') : colors.purple[50] },
            ]}
          >
            <Ionicons name="create-outline" size={22} color={colors.purple[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'Корректировка'}</Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {'Точечная корректировка остатков'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>

        {/* Корзина склада — soft-deleted products. Lives here (not in
            "Ещё") because it's a warehouse-only concern. */}
        {canManageWarehouse && (
          <TouchableOpacity
            style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
            onPress={() => {
              setShowOpsModal(false);
              setShowTrashModal(true);
            }}
          >
            <View
              style={[
                styles.opsIcon,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.rose[600], 'dark') : colors.rose[50] },
              ]}
            >
              <Ionicons name="trash-bin-outline" size={22} color={colors.rose[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'Корзина'}</Text>
              <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
                {'Восстановление удалённых товаров'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
        )}
      </BottomSheet>

      {/* Full-screen Корзина modal — hosts TrashScreen with an explicit
          onClose so it can be dismissed without touching the navigator. */}
      <RNModal visible={showTrashModal} animationType="slide" onRequestClose={() => setShowTrashModal(false)}>
        <TrashScreen onClose={() => setShowTrashModal(false)} />
      </RNModal>

      {/* Barcode scanner — header «Сканировать» → найти товар по штрих-коду. */}
      <BarcodeScanner visible={showScanner} onClose={() => setShowScanner(false)} onScanned={handleBarcodeScanned} />

      {/* Inventory modal — pageSheet on iOS so the sheet drops in from
          the top of the screen leaving the previous content visible
          underneath (the iOS Mail-attachment / Files-share idiom). This
          guarantees the header buttons sit inside the working area:
          the system handle bar at the top is OUR top inset, so the
          "Назад" / "Провести" controls never slide under the Dynamic
          Island or the status bar.

          Android: RNModal ignores `presentationStyle` so the modal
          stays full-bleed there — Android doesn't have the Dynamic
          Island problem and SafeAreaView's top edge handles the
          status bar inset cleanly. */}
      <RNModal
        visible={showInventoryModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInventoryModal(false)}
      >
        <SafeAreaView style={[styles.invFullSafe, { backgroundColor: palette.bg.canvas }]} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={[styles.invFullHeader, { borderBottomColor: palette.border.subtle }]}>
            <TouchableOpacity
              onPress={() => setShowInventoryModal(false)}
              style={[styles.invFullBackBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="arrow-back" size={22} color={palette.text.primary} />
            </TouchableOpacity>
            <Text style={[styles.invFullTitle, { color: palette.text.primary }]}>{'Инвентаризация'}</Text>
            <TouchableOpacity
              style={[styles.invFullSubmitBtn, inventoryCommitProgress ? { opacity: 0.6 } : null]}
              onPress={handleInventorySubmit}
              disabled={!!inventoryCommitProgress}
            >
              <Text style={styles.invFullSubmitBtnText}>
                {inventoryCommitProgress
                  ? `${inventoryCommitProgress.done} из ${inventoryCommitProgress.total}…`
                  : 'Провести'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Summary bar */}
          <View
            style={[
              styles.invSummaryBar,
              { backgroundColor: palette.bg.muted, borderBottomColor: palette.border.subtle },
            ]}
          >
            <View
              style={[styles.invSummaryItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.invSummaryLabel, { color: palette.text.tertiary }]}>{'Проверено'}</Text>
              <Text style={[styles.invSummaryValue, { color: palette.text.primary }]}>
                {inventorySummary.checkedCount} {'товаров'}
              </Text>
            </View>
            <View
              style={[styles.invSummaryItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.invSummaryLabel, { color: palette.text.tertiary }]}>{'Изменено'}</Text>
              <Text
                style={[
                  styles.invSummaryValue,
                  { color: palette.text.primary },
                  inventorySummary.changedCount > 0 && { color: colors.orange[600] },
                ]}
              >
                {inventorySummary.changedCount}
              </Text>
            </View>
            {inventorySummary.shortageAmount > 0 && (
              <View
                style={[
                  styles.invSummaryItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                ]}
              >
                <Text style={[styles.invSummaryLabel, { color: palette.text.tertiary }]}>{'Недостача'}</Text>
                <Text style={[styles.invSummaryValue, { color: colors.red[600] }]}>
                  {formatMoney(inventorySummary.shortageAmount)}
                </Text>
              </View>
            )}
            {inventorySummary.excessAmount > 0 && (
              <View
                style={[
                  styles.invSummaryItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                ]}
              >
                <Text style={[styles.invSummaryLabel, { color: palette.text.tertiary }]}>{'Излишек'}</Text>
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
                  <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
                  <TouchableOpacity
                    onPress={() => setInvActivePath((prev) => prev.slice(0, i + 1))}
                    style={styles.breadcrumbItem}
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        i === invActivePath.length - 1 && [
                          styles.breadcrumbTextActive,
                          { color: palette.text.primary },
                        ],
                      ]}
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
                          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                          isGreen &&
                            (palette.mode === 'dark'
                              ? { backgroundColor: 'rgba(34,197,94,0.13)', borderColor: 'rgba(34,197,94,0.32)' }
                              : { backgroundColor: colors.green[50], borderColor: colors.green[200] }),
                        ]}
                        onPress={() => setInvActivePath((prev) => [...prev, folderName])}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.folderIconBox,
                            { backgroundColor: palette.accent.primarySoft },
                            isGreen && {
                              backgroundColor: palette.mode === 'dark' ? 'rgba(34,197,94,0.18)' : colors.green[100],
                            },
                          ]}
                        >
                          <Ionicons
                            name="folder-open-outline"
                            size={22}
                            color={isGreen ? colors.green[600] : colors.primary[500]}
                          />
                        </View>
                        <Text style={[styles.folderName, { color: palette.text.primary }]} numberOfLines={2}>
                          {folderName}
                        </Text>
                        <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>
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
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    (countedInSession || checked24h) &&
                      (palette.mode === 'dark'
                        ? { backgroundColor: 'rgba(34,197,94,0.13)', borderColor: 'rgba(34,197,94,0.32)' }
                        : { backgroundColor: colors.green[50], borderColor: colors.green[200] }),
                  ]}
                >
                  <View style={styles.invFullProductInfo}>
                    <Text style={[styles.invFullProductName, { color: palette.text.primary }]} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {lastDate && (
                      <Text style={[styles.invFullProductDate, { color: palette.text.tertiary }]}>
                        {'Проверено: '}
                        {lastDate}
                      </Text>
                    )}
                  </View>
                  <View style={styles.invFullProductStock}>
                    <Text style={[styles.invFullProductStockLabel, { color: palette.text.tertiary }]}>{'Сист.'}</Text>
                    <Text style={[styles.invFullProductStockValue, { color: palette.text.secondary }]}>
                      {item.stock}
                    </Text>
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
                      {
                        backgroundColor: palette.bg.muted,
                        borderColor: palette.border.subtle,
                        color: palette.text.primary,
                      },
                      diff !== 0 && (diff > 0 ? styles.invInputPlus : styles.invInputMinus),
                      diff !== 0 && {
                        backgroundColor:
                          palette.mode === 'dark'
                            ? softTint(diff > 0 ? colors.green[400] : colors.red[400], 'dark')
                            : diff > 0
                              ? colors.green[50]
                              : colors.red[50],
                      },
                    ]}
                    keyboardType="numeric"
                    placeholder={String(item.stock)}
                    placeholderTextColor={palette.text.tertiary}
                  />
                  {diff !== 0 && (
                    <View
                      style={[
                        styles.invFullDiffBadge,
                        {
                          backgroundColor:
                            palette.mode === 'dark'
                              ? softTint(diff > 0 ? colors.green[600] : colors.red[600], 'dark')
                              : diff > 0
                                ? colors.green[50]
                                : colors.red[50],
                        },
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
                  <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
                  <Text style={[styles.invFullEmptyText, { color: palette.text.tertiary }]}>
                    {'Нет товаров в этой папке'}
                  </Text>
                </View>
              ) : inventorySearch ? (
                <View style={styles.invFullEmpty}>
                  <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                  <Text style={[styles.invFullEmptyText, { color: palette.text.tertiary }]}>{'Ничего не найдено'}</Text>
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

      {/* Writeoff Form — bottom sheet with pull-to-dismiss (consistency
          with Correction #2). Two modes (по закупке / просто): expense
          mode books an `expenses` row alongside the stock movement; the
          simple mode only decrements the stock. Taller form → 0.82. */}
      <BottomSheet
        visible={showWriteoffModal}
        onClose={() => setShowWriteoffModal(false)}
        title={'Списание товара'}
        heightRatio={0.82}
      >
        <View style={[styles.writeoffSelectedProduct, { backgroundColor: palette.accent.primarySoft }]}>
          <Ionicons name="cube-outline" size={20} color={palette.accent.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.writeoffSelectedName, { color: palette.text.primary }]}>{writeoffProductName}</Text>
            <Text style={[styles.writeoffSelectedStock, { color: palette.text.secondary }]}>
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
            <Text style={{ fontSize: fontSize.xs, color: palette.accent.primaryText }}>{'Изменить'}</Text>
          </TouchableOpacity>
        </View>

        {/* Two-mode radio. Radios are big tap targets, hairline-bordered
            and theme-aware so dark mode renders correctly. */}
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Режим списания'}</Text>
          <View style={{ gap: spacing[2] }}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setWriteoffMode('expense')}
              style={[
                styles.writeoffRadioRow,
                {
                  backgroundColor: palette.bg.card,
                  borderColor: writeoffMode === 'expense' ? palette.accent.primary : palette.border.subtle,
                },
              ]}
            >
              <View
                style={[
                  styles.writeoffRadioCircle,
                  {
                    borderColor: writeoffMode === 'expense' ? palette.accent.primary : palette.border.strong,
                    backgroundColor: writeoffMode === 'expense' ? palette.accent.primary : 'transparent',
                  },
                ]}
              >
                {writeoffMode === 'expense' && <Ionicons name="checkmark" size={14} color={colors.white} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.writeoffRadioTitle, { color: palette.text.primary }]}>
                  {'По закупке (как расход)'}
                </Text>
                <Text style={[styles.writeoffRadioDesc, { color: palette.text.tertiary }]}>
                  {'Списанная сумма попадёт в расходы. Закуп: '}
                  {formatMoney(writeoffProductCostPrice)}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setWriteoffMode('simple')}
              style={[
                styles.writeoffRadioRow,
                {
                  backgroundColor: palette.bg.card,
                  borderColor: writeoffMode === 'simple' ? palette.accent.primary : palette.border.subtle,
                },
              ]}
            >
              <View
                style={[
                  styles.writeoffRadioCircle,
                  {
                    borderColor: writeoffMode === 'simple' ? palette.accent.primary : palette.border.strong,
                    backgroundColor: writeoffMode === 'simple' ? palette.accent.primary : 'transparent',
                  },
                ]}
              >
                {writeoffMode === 'simple' && <Ionicons name="checkmark" size={14} color={colors.white} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.writeoffRadioTitle, { color: palette.text.primary }]}>
                  {'Просто списать (без расхода)'}
                </Text>
                <Text style={[styles.writeoffRadioDesc, { color: palette.text.tertiary }]}>
                  {'Уменьшает остаток, но не отражается в финансах.'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Количество к списанию'}</Text>
          <TextInput
            value={writeoffQty}
            onChangeText={setWriteoffQty}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="numeric"
            placeholder={`Макс: ${writeoffProductStock}`}
            placeholderTextColor={palette.text.tertiary}
            autoFocus
          />
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Причина списания *'}</Text>
          <TextInput
            value={writeoffReason}
            onChangeText={setWriteoffReason}
            style={[
              styles.formInput,
              {
                minHeight: 56,
                textAlignVertical: 'top',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            multiline
            placeholder={'Брак, порча, просрочка...'}
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => setShowWriteoffModal(false)}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>{'Отмена'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.red[600] }]}
            onPress={handleWriteoffSubmit}
          >
            <Text style={styles.submitBtnText}>{'Списать'}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Correction Product Picker */}
      <ProductPickerModal
        visible={showCorrectionPicker}
        onClose={() => setShowCorrectionPicker(false)}
        onSelectProduct={selectCorrectionProduct}
        title="Выберите товар для корректировки"
      />

      {/* Correction Form — bottom sheet with pull-to-dismiss.
          Owner ask (#2): окно всплывает снизу с блюр-подложкой и
          закрывается жестом «потянуть вниз». BottomSheet даёт pan-to-
          dismiss + spring + ModalBlurBackdrop (никакой тёмной тонировки).
          Высота 0.66 — форма короткая, autoFocus-поле «Новый остаток»
          остаётся над клавиатурой. */}
      <BottomSheet
        visible={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
        title={'Корректировка остатка'}
        heightRatio={0.66}
      >
        <View style={[styles.writeoffSelectedProduct, { backgroundColor: palette.accent.primarySoft }]}>
          <Ionicons name="cube-outline" size={20} color={colors.purple[600]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.writeoffSelectedName, { color: palette.text.primary }]}>{correctionProductName}</Text>
            <Text style={[styles.writeoffSelectedStock, { color: palette.text.secondary }]}>
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
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Текущий остаток'}</Text>
          <View
            style={[styles.formInput, formInputThemed, { backgroundColor: palette.bg.muted, justifyContent: 'center' }]}
          >
            <Text style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>
              {correctionProductStock} {'шт'}
            </Text>
          </View>
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Новый остаток'}</Text>
          <TextInput
            value={correctionNewStock}
            onChangeText={setCorrectionNewStock}
            style={[styles.formInput, formInputThemed]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
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
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Причина корректировки *'}</Text>
          <TextInput
            value={correctionReason}
            onChangeText={setCorrectionReason}
            style={[styles.formInput, formInputThemed, { minHeight: 56, textAlignVertical: 'top' }]}
            multiline
            placeholder={'Пересчёт, ошибка при приёмке...'}
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => setShowCorrectionModal(false)}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>{'Отмена'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.purple[600] }]}
            onPress={handleCorrectionSubmit}
          >
            <Text style={styles.submitBtnText}>{'Применить'}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

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
              below for visual depth. PERF: iOS dropped 90 → 40 — this is a
              transient fullscreen modal (blur stays, per owner ask) but a
              90-intensity full-screen UIVisualEffectView on top of the
              always-on Liquid Glass tab bar was a heavy GPU spike on open. */}
          <BlurView intensity={Platform.OS === 'android' ? 24 : 40} tint="dark" style={StyleSheet.absoluteFill} />
          {Platform.OS === 'android' && <View pointerEvents="none" style={styles.fullscreenAndroidScrim} />}
          {/* Inner Pressable absorbs taps on the image so the image
              itself doesn't dismiss the preview — only the backdrop does. */}
          {fullscreenPhoto && (
            <Pressable style={styles.fullscreenImageWrap} onPress={(e) => e.stopPropagation?.()}>
              {/*
                resizeMode='cover' so the photo fills the rounded
                rectangle uniformly — no transparent letterbox stripes
                that would make the rounded corners look wrong. The
                wrap has overflow:hidden (defence in depth) AND the
                image carries `borderRadius: 24` directly, so the
                rounded corners are clipped on the GPU on both
                platforms. Black bg below the image colour so any
                stretch artefact reads as a solid background, not the
                blurred backdrop.
              */}
              <CachedImage source={{ uri: fullscreenPhoto }} style={styles.fullscreenImage} resizeMode="cover" />
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

      {/* Warehouse switcher sheet (main / defect / used). */}
      <WarehouseSwitcher
        visible={showWarehouseSwitcher}
        onClose={() => setShowWarehouseSwitcher(false)}
        warehouses={warehouses || []}
        selectedId={activeWarehouseId ?? null}
        onSelect={(wh) => setSelectedWarehouseId(wh.id)}
      />

      {/* Per-product action sheet — shown only on main warehouse.
          Surfaces edit + "Перенести в брак" + "Перенести в Б/У". */}
      <Modal
        visible={!!actionsForProduct}
        onClose={() => setActionsForProduct(null)}
        title={actionsForProduct?.name || 'Действия с товаром'}
      >
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={() => {
            const p = actionsForProduct;
            setActionsForProduct(null);
            if (p) setHistoryProduct(p);
          }}
        >
          <View style={[styles.opsIcon, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="swap-horizontal-outline" size={22} color={palette.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'История движения'}</Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {'Поступления, расход, списания, переносы'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={() => {
            const p = actionsForProduct;
            setActionsForProduct(null);
            if (p) openEdit(p);
          }}
        >
          <View style={[styles.opsIcon, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="create-outline" size={22} color={palette.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'Редактировать'}</Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>{'Изменить параметры товара'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={() => actionsForProduct && openTransferDialog('defect', actionsForProduct)}
        >
          <View style={[styles.opsIcon, { backgroundColor: 'rgba(239, 68, 68, 0.14)' }]}>
            <Ionicons name="warning-outline" size={22} color={colors.red[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'Перенести в брак'}</Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {'Списать с основного склада на склад брака'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.opsItem, { borderBottomColor: palette.border.subtle }]}
          onPress={() => actionsForProduct && openTransferDialog('used', actionsForProduct)}
        >
          <View style={[styles.opsIcon, { backgroundColor: 'rgba(245, 158, 11, 0.16)' }]}>
            <Ionicons name="sync-outline" size={22} color={colors.orange[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.opsItemTitle, { color: palette.text.primary }]}>{'Перенести в Б/У'}</Text>
            <Text style={[styles.opsItemDesc, { color: palette.text.tertiary }]}>
              {'Списать с основного склада на склад Б/У'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
      </Modal>

      {/* «История движения товара» — read-only журнал stock-movements.
          Full-screen modal, FlashList, cache-first. Открывается из
          action-sheet (long-press) и из окна редактирования товара. */}
      <ProductMovementHistoryModal
        visible={!!historyProduct}
        onClose={() => setHistoryProduct(null)}
        productId={historyProduct?.id ?? null}
        productName={historyProduct?.name}
      />

      {/* Transfer qty dialog — same shape for defect_transfer and
          used_transfer; only the action title and movement type differ. */}
      <Modal
        visible={!!transferTarget && !!transferProduct}
        onClose={closeTransferDialog}
        title={transferTarget === 'defect' ? 'Перенести в брак' : 'Перенести в Б/У'}
      >
        {transferProduct && (
          <>
            <View style={[styles.writeoffSelectedProduct, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="cube-outline" size={20} color={palette.accent.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.writeoffSelectedName, { color: palette.text.primary }]}>
                  {transferProduct.name}
                </Text>
                <Text style={[styles.writeoffSelectedStock, { color: palette.text.secondary }]}>
                  {'На основном складе: '}
                  {transferProduct.stock} {'шт'}
                </Text>
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{'Количество'}</Text>
              <TextInput
                value={transferQty}
                onChangeText={setTransferQty}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                keyboardType="numeric"
                placeholder={`Макс: ${transferProduct.stock}`}
                placeholderTextColor={palette.text.tertiary}
                autoFocus
              />
            </View>

            {/* Reason — обязательное для брака. Размечаем * только когда
                target=defect; для used_transfer оставляем чистый «опционально». */}
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
                {transferTarget === 'defect' ? 'Причина переноса *' : 'Причина / комментарий'}
              </Text>
              <TextInput
                value={transferReason}
                onChangeText={setTransferReason}
                style={[
                  styles.formInput,
                  {
                    minHeight: 64,
                    textAlignVertical: 'top',
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                multiline
                placeholder={
                  transferTarget === 'defect' ? 'Например: повреждена упаковка, не подлежит продаже' : 'Необязательно'
                }
                placeholderTextColor={palette.text.tertiary}
              />
            </View>

            <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
                onPress={closeTransferDialog}
              >
                <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>{'Отмена'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  { backgroundColor: transferTarget === 'defect' ? colors.red[600] : colors.orange[600] },
                ]}
                onPress={handleTransferSubmit}
              >
                <Text style={styles.submitBtnText}>{'Перенести'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Modal>

      {/* Установить розничную цену — мини-модал для Б/У товаров.
          Видим только когда `sellPriceProduct` не null. Один input + две
          кнопки; productsApi.setSellPrice обновит сервер. */}
      <Modal
        visible={!!sellPriceProduct}
        onClose={closeSellPriceEditor}
        title={sellPriceProduct ? `Цена: ${sellPriceProduct.name}` : 'Установить цену'}
      >
        {sellPriceProduct && (
          <>
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Розничная цена, ₽</Text>
              <TextInput
                value={sellPriceInput}
                onChangeText={setSellPriceInput}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
                autoFocus
              />
              <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
                Себестоимость: {formatMoney(sellPriceProduct.costPrice || 0)}
              </Text>
            </View>
            <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
                onPress={closeSellPriceEditor}
              >
                <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={handleSetSellPriceSubmit} activeOpacity={0.85}>
                {setSellPriceMutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Сохранить</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </Modal>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Warehouse switcher button in the header leading slot. Stays
  // theme-aware via inline backgroundColor from palette.bg.muted —
  // these dimensions match the 36×36 squircle that IosScreenHeader
  // uses for its built-in back button so the header reads as
  // consistent across screens.
  switcherBtn: {
    height: 36,
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  // Invisible tap zone that overlays the header title text. Sized to
  // cover the title region (the centre of the header). The owner can
  // tap "Склад брака" anywhere in that strip and the switcher opens.
  // The `top` is set inline from `insetsTop + spacing[2]` so it aligns
  // with the actual title row regardless of device safe area.
  titleTapZone: {
    position: 'absolute',
    left: 64, // skip the leading button area
    right: 120, // skip the trailing buttons area
    height: 44, // approx header row height — title + subtitle
  },
  // Writeoff mode radio rows. Hairline-bordered cards with a leading
  // circle radio — light/dark theme-aware via inline backgroundColor.
  writeoffRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
  },
  writeoffRadioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  writeoffRadioTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  writeoffRadioDesc: { fontSize: fontSize.xs, marginTop: 2 },
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
  // FreshnessBadge slot — right-aligned, sits just below the header.
  freshnessRow: {
    paddingHorizontal: spacing[4],
    alignItems: 'flex-end',
    minHeight: 14,
  },
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
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[2],
  },
  historyLinkText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
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
  invInputPlus: { borderColor: colors.green[400] },
  invInputMinus: { borderColor: colors.red[400] },
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
    // The wrap doesn't clip — `overflow: hidden` on a wrapper around an
    // Image with resizeMode='contain' wouldn't visibly round the image
    // corners because the image's transparent letterboxing extends to
    // the wrap edges. Instead we apply `borderRadius` directly to the
    // image style below, which RN's <Image> honours natively at the
    // GPU level on both platforms.
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
  fullscreenImage: {
    width: SCREEN_WIDTH - 40,
    height: SCREEN_HEIGHT * 0.7,
    borderRadius: 24,
    backgroundColor: '#000',
  },
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
  invFullDiffBadgeText: { fontSize: 11, fontWeight: fontWeight.bold },
  invFullEmpty: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  invFullEmptyText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Correction
  correctionDiffRow: { marginTop: spacing[1.5] },
  // ── Defect / used warehouse hint banner ─────────────────────────
  // Тонкая полоска под поиском в браке: объясняет, как товары туда
  // попадают. Не «alert», а информационный nudge — без тяжёлого фона.
  defectInfoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    marginBottom: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  defectInfoHintText: { fontSize: 12, lineHeight: 16, flex: 1 },
  // ── Used warehouse: inline "Установить цену" CTA ────────────────
  // Под товарами на складе Б/У с sellPrice == null/0 показываем
  // компактный CTA вместо суммы. По нажатию открывается inline
  // редактор-prompt; цена правится через productsApi.setSellPrice.
  pricelessCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.amber[200],
    alignSelf: 'flex-start',
  },
  pricelessCtaText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.amber[700] },
});
