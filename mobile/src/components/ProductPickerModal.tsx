import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  Animated,
  Modal as RNModal,
  PanResponder,
  Pressable,
  Alert,
  AccessibilityInfo,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import CachedImage from './CachedImage';
import ModalBlurBackdrop from './ModalBlurBackdrop';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import { buildShadow } from '../platform/iosSurface';
import type { SemanticPalette } from '../theme/palette';
import { ListSkeleton } from './Skeleton';
import QueryErrorState from './QueryErrorState';
import { haptic } from '../platform/haptics';
import type { Product } from '../../../shared/types';

// Rapid double-tap window. A second press on the SAME product row within
// this window is treated as an accidental double-tap and ignored, so an
// itchy finger adds the item once instead of twice. A deliberate re-add is
// still possible after the window elapses (or via the qty stepper in the
// cart). 500 ms comfortably covers an accidental double-bounce without
// feeling sticky for an intentional second tap.
const ROW_TAP_DEBOUNCE_MS = 500;

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const FOLDER_COLS = 3;
const FOLDER_GAP = spacing[2];
const FOLDER_WIDTH = (SCREEN_WIDTH - spacing[4] * 2 - FOLDER_GAP * (FOLDER_COLS - 1)) / FOLDER_COLS;

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

export interface FolderAnnotation {
  label: string;
  color: string;
}

/**
 * Inline warehouse switcher — owner-shape so the picker renders the
 * options as an INLINE dropdown WITHIN its own modal, not a second
 * nested RNModal. Nested RNModal-over-RNModal froze iOS during the
 * sheet present transition; an inline overlay is rock-solid.
 *
 * Parent (CheckCreateScreen) hands us the list of warehouses + the
 * currently-selected id + a setter; the modal owns the open/close
 * state of the dropdown internally.
 */
export interface WarehouseSwitcherInline {
  /** Currently selected warehouse id. */
  value: string | null;
  /** Active label shown on the chip. */
  label: string;
  /** Full warehouse list to render inside the dropdown. */
  options: Array<{ id: string; name: string; kind: 'main' | 'defect' | 'used' }>;
  /** Called when the user picks a warehouse. */
  onChange: (id: string) => void;
}

interface ProductPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  getCartQty?: (productId: string) => number;
  title?: string;
  showCostPrice?: boolean;
  folderAnnotations?: Map<string, FolderAnnotation>;
  /**
   * Active warehouse id used to filter the query — when set the picker fires
   * `productsApi.getAll({ warehouseId, limit })` so brak / used / main are
   * distinct caches. State lives in the parent (CheckCreateScreen).
   */
  warehouseId?: string | null;
  /** Inline warehouse switcher (rendered as an in-modal dropdown). */
  warehouseSwitcher?: WarehouseSwitcherInline;
  /**
   * #12: имена товаров, на которые у текущего клиента ЕСТЬ активная гарантия
   * (из `warrantyApi.active` — поле `name`, нормализованное lower-case+trim).
   * Чисто презентационная подсказка: на совпавших строках рисуется бейдж
   * «На гарантии». Опционально — без него (или для retail-покупателя)
   * пикер работает как раньше. Контракт API не трогаем: у `ActiveWarranty`
   * нет productId, поэтому сопоставление идёт по имени.
   */
  warrantyNames?: ReadonlySet<string>;
}

/**
 * Discriminated row union for the FlashList — folders sit above products
 * in the same virtualised list so we never re-render the whole sheet on
 * folder/product navigation. `header` placeholders the folders grid as a
 * single sticky-ish row at the top so FlashList can recycle every other
 * cell as a product row of the same shape.
 */
type FolderRow = {
  type: 'folders';
  entries: Array<[string, number]>;
  annotations?: Map<string, FolderAnnotation>;
};
type ProductRow = { type: 'product'; product: Product };
type Row = FolderRow | ProductRow;

interface PickerProductRowItemProps {
  product: Product;
  cartQty: number;
  showCostPrice: boolean;
  /** #12: товар на гарантии у текущего клиента — рисуем бейдж. */
  underWarranty?: boolean;
  onPress: (product: Product) => void;
  palette: SemanticPalette;
}

/**
 * Memoised product row — visual mirror of `ProductsScreen.tsx`'s row at
 * lines ~885-936 so the picker reads as the SAME list, just inside a
 * modal sheet. Differences vs warehouse:
 *   - 56x56 photo (warehouse uses 42 — bigger here for thumb-friendly
 *     tap targets in the cash hot path).
 *   - Right column shows stock + cart-qty badge instead of an edit
 *     chevron.
 * Otherwise: same hairline separators, same numberOfLines={2}, same
 * category subtitle, same low-stock alert icon, same prices row.
 */
const PickerProductRow = React.memo(function PickerProductRow({
  product,
  cartQty,
  showCostPrice,
  underWarranty,
  onPress,
  palette,
}: PickerProductRowItemProps) {
  const lowStock = product.stock <= product.minStock && product.minStock > 0;
  const photoUrl = getImageUrl((product as { photo?: string }).photo);
  const categoryLeaf = product.category ? product.category.split('/').pop() : null;
  return (
    <Pressable
      onPress={() => onPress(product)}
      style={({ pressed }) => [
        styles.productCard,
        { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle },
        pressed && { backgroundColor: palette.bg.muted },
      ]}
    >
      <View style={styles.productRow}>
        {photoUrl ? (
          <CachedImage source={{ uri: photoUrl }} style={styles.productPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.productPhotoPlaceholder, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="cube-outline" size={24} color={palette.text.tertiary} />
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: palette.text.primary }]} numberOfLines={2}>
            {product.name}
          </Text>
          {underWarranty ? (
            <View style={styles.warrantyBadge}>
              <Ionicons name="shield-checkmark" size={11} color={colors.amber[700]} />
              <Text style={styles.warrantyBadgeText}>На гарантии</Text>
            </View>
          ) : null}
          {categoryLeaf ? (
            <Text style={[styles.productCategory, { color: palette.text.tertiary }]}>{categoryLeaf}</Text>
          ) : null}
          <View style={styles.productPrices}>
            <Text style={[styles.productSellPrice, { color: palette.accent.primaryText }]}>
              {formatMoney(product.sellPrice)}
            </Text>
            {showCostPrice ? (
              <Text style={[styles.productCostPrice, { color: palette.text.tertiary }]}>
                {'Себест.'} {formatMoney(product.costPrice)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.productStockWrap}>
          {lowStock ? (
            <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />
          ) : null}
          <Text style={[styles.productStock, { color: palette.text.primary }, lowStock && styles.productStockLow]}>
            {product.stock}
          </Text>
          <Text style={[styles.productStockLabel, { color: palette.text.tertiary }]}>{'шт'}</Text>
          {cartQty > 0 ? (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartQty}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

interface FolderGridRowProps {
  entries: Array<[string, number]>;
  annotations?: Map<string, FolderAnnotation>;
  onSelect: (name: string) => void;
  palette: SemanticPalette;
}

/**
 * Folder grid — three columns, mirror of the inventory folder grid in
 * `ProductsScreen.tsx` (`foldersGrid` style + FOLDER_WIDTH constant).
 * Lives as ONE FlashList row so it recycles cleanly with the product
 * cells below.
 */
const FolderGridRow = React.memo(function FolderGridRow({
  entries,
  annotations,
  onSelect,
  palette,
}: FolderGridRowProps) {
  return (
    <View style={styles.foldersGrid}>
      {entries.map(([name, count]) => {
        const annotation = annotations?.get(name);
        return (
          <TouchableOpacity
            key={name}
            style={[
              styles.folderCard,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              buildShadow(palette),
            ]}
            onPress={() => onSelect(name)}
            activeOpacity={0.6}
          >
            <View style={[styles.folderIconBox, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
            </View>
            <Text style={[styles.folderName, { color: palette.text.primary }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>
              {count} {'тов.'}
            </Text>
            {annotation ? (
              <Text style={[styles.folderAnnotation, { color: annotation.color }]} numberOfLines={1}>
                {annotation.label}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

export default function ProductPickerModal({
  visible,
  onClose,
  onSelectProduct,
  getCartQty,
  title = 'Товары',
  showCostPrice = false,
  folderAnnotations,
  warehouseId,
  warehouseSwitcher,
  warrantyNames,
}: ProductPickerModalProps) {
  const palette = useColors();
  const [productPath, setProductPath] = useState<string[]>([]);
  // Inline warehouse-switcher dropdown — local state. NOT a nested
  // RNModal: an RNModal-inside-an-RNModal froze the iOS app during the
  // present transition. An absolute-positioned dropdown sitting inside
  // the picker's own modal container avoids that entirely.
  const [showWarehouseDropdown, setShowWarehouseDropdown] = useState(false);
  // `localSearch` is what the input renders (every keystroke), `productSearch`
  // is the debounced value that drives the heavy filter+folder useMemo. The
  // 200 ms debounce keeps the FlashList stable while the user is still
  // typing, so the rows don't reflow on every character.
  const [localSearch, setLocalSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-product last-accepted-tap timestamps for the double-tap guard.
  // Declared up here (not next to `handleSelect`) so `handleClose`, which
  // clears it, can reference it without a temporal-dead-zone ordering snag.
  const lastTapRef = useRef<Map<string, number>>(new Map());

  // ── Barcode scanner (expo-camera CameraView with barcode hint) ────────────
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const openScanner = useCallback(async () => {
    let perm = cameraPermission;
    if (!perm?.granted) {
      perm = await requestCameraPermission();
    }
    if (perm?.granted) {
      setShowScanner(true);
    } else {
      Alert.alert('Нет доступа к камере', 'Разрешите доступ к камере в настройках устройства');
    }
  }, [cameraPermission, requestCameraPermission]);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    setShowScanner(false);
    setLocalSearch(data);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setProductSearch(data), 200);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setLocalSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setProductSearch(text), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Same query key as `CheckCreateScreen` and `AuthContext.prefetchAfterLogin`
  // (`['all-products-check']`) so opening the picker is a CACHE HIT on the
  // first try — the login-time prefetch + the persistent-cache whitelist
  // (`'all-products-check'` ∈ PERSISTED_KEYS) keep this slot warm even on a
  // cold start, and the standalone Warehouse screen has already pre-warmed it
  // too. We then revalidate in the background (stale-while-revalidate).
  //
  // When `warehouseId` is supplied the key gains a second segment so each
  // warehouse (main / brak / used) has its own cache slot. Without the
  // warehouse filter we keep the legacy `['all-products-check']` key so the
  // login-time prefetch remains a hit.
  //
  // Cache-FIRST, not fresh-only. The previous version disabled
  // `placeholderData` and forced `refetchOnMount: 'always'` + `staleTime: 0`
  // "to never show stale stock" — but that produced the exact bug the owner
  // reported: opening «Добавить товар» flashed an EMPTY list (or a long
  // spinner) while the always-on cold fetch ran, even though a perfectly
  // good cached list was sitting in the QueryClient. We now mirror
  // ProductsScreen: render the cached list INSTANTLY, then let SWR refresh
  // the stock numbers in the background within ~150 ms. Stock is still
  // re-validated on every open (a short `staleTime` means the background
  // refetch fires), and the order is only committed on submit — so the
  // numbers the user commits to are fresh, without ever blanking the sheet.
  const queryClient = useQueryClient();
  // Which warehouse is "main"? Needed by the placeholder seeding below —
  // the login-time prefetch and the CheckCreateScreen mount prefetch warm
  // the UN-scoped ['all-products-check'] slot, and the backend serves the
  // MAIN warehouse for that un-scoped request. So the un-scoped cache is a
  // valid instant placeholder ONLY when the scoped key points at main.
  const mainWarehouseId = warehouseSwitcher?.options.find((w) => w.kind === 'main')?.id ?? null;

  const {
    data: allProducts,
    isLoading,
    isError,
    refetch,
  } = useQuery<Product[]>({
    queryKey: warehouseId ? ['all-products-check', { warehouseId }] : ['all-products-check'],
    queryFn: async () => {
      const params: { limit: number; warehouseId?: string } = { limit: 500 };
      if (warehouseId) params.warehouseId = warehouseId;
      const res = await productsApi.getAll(params);
      return (res.data?.data || res.data) as Product[];
    },
    enabled: visible,
    // Keep the previous list visible across mounts/refetches so the picker
    // never blanks — same stale-while-revalidate idiom as ProductsScreen
    // and the global QueryClient default. Explicit here as defence in depth.
    //
    // Cold-slot seeding: the very first open after login uses the SCOPED
    // key ['all-products-check', { warehouseId: <main> }] (the parent seeds
    // `pickerWarehouseId` to main as soon as ['warehouses'] resolves), but
    // both prefetches warm the legacy UN-scoped slot — a structural cache
    // MISS that used to show a skeleton on the first-ever open. When the
    // scoped slot is empty AND it targets the main warehouse, borrow the
    // un-scoped data as placeholder: identical payload (server defaults to
    // main), shown instantly, replaced by the scoped fetch in ~150 ms.
    // Defect/used warehouses never borrow — main's products would be wrong.
    placeholderData: (prev) => {
      if (prev !== undefined) return prev;
      if (warehouseId && warehouseId === mainWarehouseId) {
        return queryClient.getQueryData<Product[]>(['all-products-check']);
      }
      return undefined;
    },
    // Short staleTime → opening the picker still triggers a background
    // refetch (fresh stock lands in ~150 ms) WITHOUT throwing away the
    // cached list we show on the first frame.
    staleTime: 30_000,
  });

  const { sortedProductFolders, visibleProducts } = useMemo(() => {
    const products = Array.isArray(allProducts) ? allProducts : [];
    if (productSearch) {
      const q = productSearch.toLowerCase();
      return {
        sortedProductFolders: [] as Array<[string, number]>,
        visibleProducts: products.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q)),
        ),
      };
    }

    const subs = new Map<string, number>();
    const prods: Product[] = [];

    for (const p of products) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];
      const matchesPath = productPath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && productPath.length > 0) continue;

      if (catParts.length > productPath.length) {
        const folderName = catParts[productPath.length];
        subs.set(folderName, (subs.get(folderName) || 0) + 1);
      } else if (catParts.length === productPath.length) {
        prods.push(p);
      }
    }

    if (productPath.length === 0) {
      for (const p of products) {
        if (!p.category && !prods.includes(p)) prods.push(p);
      }
    }

    return {
      sortedProductFolders: Array.from(subs.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      visibleProducts: prods,
    };
  }, [allProducts, productPath, productSearch]);

  // Compose folders + products into ONE list so FlashList virtualises the
  // whole sheet (no nested ScrollView, no over-rendering). The folders
  // grid lives in row 0, products fill the rest.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!productSearch && sortedProductFolders.length > 0) {
      out.push({ type: 'folders', entries: sortedProductFolders, annotations: folderAnnotations });
    }
    for (const p of visibleProducts) out.push({ type: 'product', product: p });
    return out;
  }, [productSearch, sortedProductFolders, visibleProducts, folderAnnotations]);

  // Card slide-up entrance. We drive it ourselves (instead of RNModal's
  // built-in `animationType="slide"`) so the ModalBlurBackdrop stays a
  // STATIC full-screen frosted layer and only the card slides in — the
  // proper iOS sheet idiom. RNModal's "slide" would drag the blur up from
  // the bottom with the card, which reads as a "rising blur panel".
  const cardTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => {
        reduceMotionRef.current = !!r;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (visible) {
      if (reduceMotionRef.current) {
        cardTranslateY.setValue(0);
      } else {
        cardTranslateY.setValue(SCREEN_HEIGHT * 0.5);
        Animated.spring(cardTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 26,
          stiffness: 260,
          mass: 0.9,
        }).start();
      }
    } else {
      cardTranslateY.setValue(SCREEN_HEIGHT);
    }
  }, [visible, cardTranslateY]);

  // Swipe-to-go-back from the folder navigation
  const panX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dx > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && gs.x0 < 40,
      onPanResponderMove: (_, gs) => {
        if (gs.dx > 0) panX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 100) {
          if (productPath.length > 0) {
            setProductPath((prev) => prev.slice(0, -1));
          } else {
            handleClose();
          }
        }
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const handleClose = useCallback(() => {
    setLocalSearch('');
    setProductSearch('');
    setProductPath([]);
    // Drop any per-product double-tap locks so the next open starts clean.
    lastTapRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onClose();
  }, [onClose]);

  // Double-tap guard. We DON'T disable the row in React state (that would
  // force a re-render of the whole virtualised list on every tap and fight
  // FlashList recycling); instead we gate on the cheap imperative
  // `lastTapRef` map declared above. An accidental rapid double-tap on the
  // same product fires `onSelectProduct` only ONCE; a deliberate re-add
  // after `ROW_TAP_DEBOUNCE_MS` (or the qty stepper in the cart) still works.
  const handleSelect = useCallback(
    (product: Product) => {
      const now = Date.now();
      const last = lastTapRef.current.get(product.id) ?? 0;
      if (now - last < ROW_TAP_DEBOUNCE_MS) {
        // Accidental double-tap — swallow it. No haptic, no second add.
        return;
      }
      lastTapRef.current.set(product.id, now);
      // Light tactile + the row's cart-qty badge bump (via getCartQty) give
      // the user immediate "it registered" feedback, so they don't tap again.
      haptic('tap');
      onSelectProduct(product);
    },
    [onSelectProduct],
  );

  const handleEnterFolder = useCallback((name: string) => {
    setProductPath((prev) => [...prev, name]);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.type === 'folders') {
        return (
          <FolderGridRow
            entries={item.entries}
            annotations={item.annotations}
            onSelect={handleEnterFolder}
            palette={palette}
          />
        );
      }
      const qty = getCartQty ? getCartQty(item.product.id) : 0;
      const underWarranty = warrantyNames ? warrantyNames.has(item.product.name.trim().toLowerCase()) : false;
      return (
        <PickerProductRow
          product={item.product}
          cartQty={qty}
          showCostPrice={showCostPrice}
          underWarranty={underWarranty}
          onPress={handleSelect}
          palette={palette}
        />
      );
    },
    [getCartQty, handleEnterFolder, handleSelect, showCostPrice, warrantyNames, palette],
  );

  const keyExtractor = useCallback((item: Row, index: number) => {
    if (item.type === 'folders') return `folders-${index}`;
    return item.product.id;
  }, []);

  const getItemType = useCallback((item: Row) => item.type, []);

  // First-load skeleton fires ONLY when there is no data at all yet
  // (`data === undefined`). When `data` is `[]` we trust the query and
  // show the genuine "Нет товаров" empty state — no flash before data
  // arrives because `placeholderData` keeps the previous list visible.
  //
  // Body state machine — every branch terminates in content, an empty
  // state, or QueryErrorState with «Повторить». The error branch only
  // fires when there is NO data to show (cold cache + both fetch attempts
  // failed); with stale data present the list stays up and the background
  // refetch failure is silent (stale-while-revalidate contract). Without
  // this branch an errored cold query rendered a completely BLANK sheet
  // forever: skeleton was off (isLoading false once status==='error') and
  // the FlashList empty-component resolved to `null`.
  const showInitialSkeleton = visible && allProducts === undefined && isLoading;
  const showErrorState = visible && allProducts === undefined && isError;
  const queryResolvedEmpty = visible && Array.isArray(allProducts) && allProducts.length === 0;

  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        {/* Premium frosted blur backdrop (#6/#7) — replaces the old flat
            rgba(0,0,0,0.4) dim. Static full-screen layer; tapping the
            visible area above the card closes the picker. The card slides
            up via `cardTranslateY` (not RNModal's "slide", which would
            drag the blur up too); swipe-back stays on `panResponder`. */}
        <ModalBlurBackdrop onPress={handleClose} />
        <Animated.View
          style={[
            styles.container,
            { backgroundColor: palette.bg.elevated },
            { transform: [{ translateX: panX }, { translateY: cardTranslateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Handle bar */}
          <View style={styles.handle}>
            <View style={[styles.handleBar, { backgroundColor: palette.border.strong }]} />
          </View>

          {/* Header — close button on the left, title centered, warehouse
              switcher pill on the right. Owner ask: "не просто над поиском
              справа в шапке этого окна справа от Товары и там нет все
              склады! там конкретно должны переключаться не смешиваясь."
              The pill is presentational; tapping it opens the parent's
              bottom-sheet so this component stays dumb. */}
          <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
            <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="close" size={22} color={palette.text.secondary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: palette.text.primary }]}>{title}</Text>
            {warehouseSwitcher ? (
              <TouchableOpacity
                onPress={() => setShowWarehouseDropdown((v) => !v)}
                style={[
                  styles.headerWarehouseChip,
                  { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary },
                ]}
                activeOpacity={0.7}
                accessibilityLabel="Выбрать склад"
              >
                <Text style={[styles.headerWarehouseChipText, { color: palette.accent.primaryText }]} numberOfLines={1}>
                  {warehouseSwitcher.label}
                </Text>
                <Ionicons
                  name={showWarehouseDropdown ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={palette.accent.primaryText}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 36 }} />
            )}
          </View>

          {/* Inline warehouse-switcher dropdown. Absolute-positioned
              overlay covering only the body region so the user can
              still tap the chip again to dismiss. Lives INSIDE the
              picker's RNModal — no nested modal, no iOS freeze. */}
          {warehouseSwitcher && showWarehouseDropdown ? (
            <View
              style={[
                styles.warehouseDropdown,
                { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                buildShadow(palette, 'elevated'),
              ]}
            >
              {warehouseSwitcher.options.map((w) => {
                const iconName =
                  w.kind === 'defect' ? 'warning-outline' : w.kind === 'used' ? 'cube-outline' : 'home-outline';
                const sub =
                  w.kind === 'defect' ? 'Брак' : w.kind === 'used' ? 'Б/У — подержанные детали' : 'Основной склад';
                const active = warehouseSwitcher.value === w.id;
                return (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.warehouseDropdownRow, { borderBottomColor: palette.border.subtle }]}
                    onPress={() => {
                      warehouseSwitcher.onChange(w.id);
                      setShowWarehouseDropdown(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={iconName as never} size={18} color={palette.accent.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.warehouseDropdownName, { color: palette.text.primary }]}>{w.name}</Text>
                      <Text style={[styles.warehouseDropdownSub, { color: palette.text.secondary }]}>{sub}</Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark" size={20} color={palette.accent.primary} />
                    ) : (
                      <View style={{ width: 20 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {/* Search */}
          <View style={[styles.searchWrap, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="search-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              value={localSearch}
              onChangeText={handleSearchChange}
              style={[styles.searchInput, { color: palette.text.primary }]}
              placeholder={'Поиск товара...'}
              placeholderTextColor={palette.text.tertiary}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {localSearch ? (
              <TouchableOpacity
                onPress={() => {
                  setLocalSearch('');
                  setProductSearch('');
                }}
              >
                <Ionicons name="close-circle-outline" size={18} color={palette.text.tertiary} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={openScanner} hitSlop={8} accessibilityLabel="Сканировать штрих-код">
                <Ionicons name="barcode-outline" size={20} color={colors.primary[500]} />
              </TouchableOpacity>
            )}
          </View>

          {/* Full-screen barcode scanner modal */}
          <RNModal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
            <View style={styles.scannerContainer}>
              {showScanner && cameraPermission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
                  }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
              ) : null}
              <View style={styles.scannerOverlay} pointerEvents="box-none">
                <View style={styles.scannerCornerBox} />
                <Text style={styles.scannerHint}>Наведите камеру на штрих-код товара</Text>
              </View>
              <TouchableOpacity style={styles.scannerCancelBtn} onPress={() => setShowScanner(false)}>
                <Ionicons name="close" size={22} color={colors.white} />
                <Text style={styles.scannerCancelText}>Отмена</Text>
              </TouchableOpacity>
            </View>
          </RNModal>

          {/* Breadcrumbs */}
          {!productSearch && productPath.length > 0 ? (
            <View style={styles.breadcrumbRow}>
              <TouchableOpacity onPress={() => setProductPath([])} style={styles.breadcrumbItem}>
                <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
              {productPath.map((seg, i) => (
                <React.Fragment key={`${seg}-${i}`}>
                  <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
                  <TouchableOpacity
                    onPress={() => setProductPath((prev) => prev.slice(0, i + 1))}
                    style={styles.breadcrumbItem}
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        i === productPath.length - 1 && {
                          color: palette.text.primary,
                          fontWeight: fontWeight.bold,
                        },
                      ]}
                    >
                      {seg}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          ) : null}

          {/* Body — skeleton on cold start, error+retry when the fetch
              died with no cache to fall back on, FlashList otherwise */}
          {showInitialSkeleton ? (
            <View style={styles.skeletonWrap}>
              <ListSkeleton count={8} />
            </View>
          ) : showErrorState ? (
            <QueryErrorState
              title={'Не удалось загрузить товары'}
              description={'Проверьте соединение и попробуйте ещё раз'}
              onRetry={() => refetch()}
            />
          ) : (
            <FlashList
              data={rows}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                queryResolvedEmpty ? (
                  <View style={styles.empty}>
                    <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
                    <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Нет товаров'}</Text>
                  </View>
                ) : productSearch ? (
                  <View style={styles.empty}>
                    <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                    <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Ничего не найдено'}</Text>
                  </View>
                ) : null
              }
            />
          )}
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  // Transparent host: the dim is now a frosted ModalBlurBackdrop
  // (absolute-fill, behind the card). Card stays pinned to the bottom.
  overlay: { flex: 1, justifyContent: 'flex-end' },
  container: {
    height: SCREEN_HEIGHT * 0.82,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: { alignItems: 'center', paddingVertical: spacing[2] },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: 0 },
  // Warehouse switcher pill — lives in the modal HEADER on the right
  // of the title (owner ask: "справа в шапке этого окна справа от
  // Товары"). Compact iosPill-family chip: pale primary fill,
  // hairline tint border, chevron-down icon hinting the bottom-sheet.
  headerWarehouseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: colors.primary[50],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary[100],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    maxWidth: 160,
  },
  headerWarehouseChipText: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    color: colors.primary[700],
    letterSpacing: -0.1,
  },
  // Inline dropdown surface — anchored just below the header. Renders
  // INSIDE the picker's RNModal so iOS doesn't need to coordinate a
  // second modal present transition. Soft drop shadow + hairline rim
  // so it floats above the search row.
  warehouseDropdown: {
    marginHorizontal: spacing[4],
    marginTop: 4,
    marginBottom: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  warehouseDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[100],
  },
  warehouseDropdownName: {
    fontSize: 15,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  warehouseDropdownSub: {
    fontSize: 12,
    color: colors.gray[500],
    marginTop: 1,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[1],
  },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingVertical: 2 },
  breadcrumbText: { fontSize: fontSize.xs, color: colors.primary[600], fontWeight: fontWeight.medium },
  // Folders — three-column grid, mirror of ProductsScreen.foldersGrid /
  // folderCard / folderIconBox so the picker reads as the same surface.
  foldersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FOLDER_GAP,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
  },
  folderCard: {
    width: FOLDER_WIDTH,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[3],
    alignItems: 'center',
    gap: spacing[1],
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
    marginBottom: spacing[1],
  },
  folderName: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    textAlign: 'center',
    lineHeight: 14,
  },
  folderCount: { fontSize: 10, color: colors.gray[400], marginTop: 2 },
  folderAnnotation: { fontSize: 9, fontWeight: fontWeight.medium, marginTop: 2, textAlign: 'center' },
  // Products — visual mirror of ProductsScreen.productCard / productRow.
  // 56-pt photo (warehouse uses 42) for thumb-friendly cash hot-path taps.
  productCard: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  productCardPressed: { backgroundColor: colors.gray[50] },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  productPhoto: { width: 56, height: 56, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: { flex: 1, minWidth: 0 },
  productName: {
    fontSize: 15,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    letterSpacing: -0.1,
  },
  productCategory: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  // #12: бейдж «На гарантии» — янтарный, в семействе с гарантийными чипами
  // карточки клиента. Self-hiding: рисуется только при underWarranty.
  warrantyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.amber[50],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.amber[200],
  },
  warrantyBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.amber[700], letterSpacing: 0.1 },
  productPrices: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 },
  productSellPrice: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.primary[700] },
  productCostPrice: { fontSize: 11, color: colors.gray[400] },
  productStockWrap: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 48, paddingLeft: spacing[1] },
  productStock: { fontSize: 16, fontWeight: '700' as const, color: colors.gray[900], letterSpacing: -0.3 },
  productStockLow: { color: colors.red[500] },
  productStockLabel: { fontSize: 10, color: colors.gray[400], marginTop: -1 },
  cartBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cartBadgeText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.white },
  // List
  listContent: { paddingBottom: spacing[12] },
  skeletonWrap: { flex: 1, paddingTop: spacing[2] },
  empty: { alignItems: 'center', paddingVertical: spacing[10] },
  emptyText: { color: colors.gray[400], marginTop: spacing[2], fontSize: fontSize.sm },
  // Barcode scanner
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCornerBox: {
    width: 220,
    height: 160,
    borderWidth: 2,
    borderColor: colors.primary[400],
    borderRadius: borderRadius.xl,
    backgroundColor: 'transparent',
  },
  scannerHint: {
    marginTop: spacing[4],
    color: colors.white,
    fontSize: fontSize.sm,
    textAlign: 'center',
    opacity: 0.85,
    paddingHorizontal: spacing[8],
  },
  scannerCancelBtn: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  scannerCancelText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
