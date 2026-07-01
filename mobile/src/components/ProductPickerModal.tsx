import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
// still possible after the window elapses (or via the cart «+» button). 500 ms
// comfortably covers an accidental double-bounce without feeling sticky for
// an intentional second tap.
const ROW_TAP_DEBOUNCE_MS = 500;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Bug #58 — the in-cash picker must list EVERY product of the selected
// warehouse, fully in sync with the Склад (ProductsScreen) list. The old
// hard `limit: 500` silently truncated the server response at 500 rows:
// the backend sorts `ORDER BY p.name` (products.service.getAll), so any
// product whose name sorts past position 500 — e.g. «шланги газовые» («Ш»
// is near the end of the Cyrillic alphabet) — never reached the client.
// The picker then filters CLIENT-SIDE over that capped list, so neither
// folder-browsing nor search could ever surface those tail products, even
// though the warehouse screen found them (it searches SERVER-SIDE via
// `productsApi.getAll({ search })`, which matches across the whole table).
// The backend applies NO hard cap (`limit = parseInt(query.limit) || 100`),
// so a high ceiling returns the entire warehouse in one page. Real tenants
// never approach this count and FlashList virtualises the rows regardless,
// so browse + client-side search now see the complete, in-sync list.
const PICKER_PRODUCT_LIMIT = 100000;

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
  /**
   * Legacy folder-grid annotations. The picker no longer drills into folders
   * (flat list + filter chips now), so this is unused by the current caller —
   * kept in the public interface for backward compatibility so the parent
   * needs no edits.
   */
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
 * Memoised product row — visual mirror of `ProductsScreen.tsx`'s row so the
 * picker reads as the SAME list, just inside a modal sheet. Differences vs
 * warehouse:
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

export default function ProductPickerModal({
  visible,
  onClose,
  onSelectProduct,
  getCartQty,
  title = 'Товары',
  showCostPrice = false,
  warehouseId,
  warehouseSwitcher,
  warrantyNames,
}: ProductPickerModalProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  // Inline warehouse-switcher dropdown — local state. NOT a nested
  // RNModal: an RNModal-inside-an-RNModal froze the iOS app during the
  // present transition. An absolute-positioned dropdown sitting inside
  // the picker's own modal container avoids that entirely.
  const [showWarehouseDropdown, setShowWarehouseDropdown] = useState(false);
  // `localSearch` is what the input renders (every keystroke), `productSearch`
  // is the debounced value that drives the heavy filter useMemo. The 200 ms
  // debounce keeps the FlashList stable while the user is still typing, so
  // the rows don't reflow on every character.
  const [localSearch, setLocalSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  // Active folder filter chip. `null` === «Все» (no folder filter). Selecting
  // the active chip again clears it. Owner-chosen variant A: a flat product
  // list filtered by a horizontal chip strip instead of drilling into folders
  // and having to swipe back out to open another folder.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Running-cart review panel expand/collapse.
  const [cartExpanded, setCartExpanded] = useState(false);
  // Pull-to-refresh spinner (Task 2 — kill stale product lists).
  const [refreshing, setRefreshing] = useState(false);
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
    // A scan is a precise lookup — clear any active folder chip so the
    // scanned item surfaces regardless of which folder it lives in.
    setActiveCategory(null);
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
  // Cache-FIRST, not fresh-only. We render the cached list INSTANTLY, then let
  // SWR refresh the stock numbers in the background within ~150 ms. Stock is
  // still re-validated on every open (a short `staleTime` + the explicit
  // open-revalidate effect below), and the order is only committed on submit —
  // so the numbers the user commits to are fresh, without ever blanking sheet.
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
      // `PICKER_PRODUCT_LIMIT` (not 500) so the whole warehouse loads and the
      // picker mirrors Склад exactly — see bug #58 note on the constant.
      const params: { limit: number; warehouseId?: string } = { limit: PICKER_PRODUCT_LIMIT };
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

  // Revalidate on open (Task 2 — kill stale product lists). Masters keep the
  // app open for hours and stock moves under them, so different devices showed
  // different cached snapshots. Fire a background refetch every time the picker
  // becomes visible. Cache-first paint is preserved by `placeholderData` + the
  // persistent cache, so this never blanks the list — it only refreshes the
  // numbers. `refetch` identity is stable (React Query memoises it), so the
  // effect runs on each open, not on every render; React Query dedupes if the
  // mount fetch is already in flight.
  useEffect(() => {
    if (visible) refetch();
  }, [visible, refetch]);

  // Switching warehouse changes the product set; a category chip from the
  // previous warehouse may not exist here, so clear the folder filter.
  useEffect(() => {
    setActiveCategory(null);
  }, [warehouseId]);

  // Top-level folder chips — one per first-segment category. Tapping a chip
  // filters the flat list to that folder's whole subtree; «Все» clears it.
  const categoryChips = useMemo(() => {
    const products = Array.isArray(allProducts) ? allProducts : [];
    const set = new Set<string>();
    for (const p of products) {
      const cat = p.category || '';
      if (!cat) continue;
      const top = cat.split('/')[0].trim();
      if (top) set.add(top);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allProducts]);

  // Single flat product list, filtered by the active chip AND the search text
  // together. No folder drill-in/out — the whole warehouse is one list.
  const visibleProducts = useMemo(() => {
    let list = Array.isArray(allProducts) ? allProducts : [];
    if (activeCategory) {
      list = list.filter((p) => {
        const cat = p.category || '';
        return cat === activeCategory || cat.startsWith(`${activeCategory}/`);
      });
    }
    if (productSearch) {
      const q = productSearch.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [allProducts, activeCategory, productSearch]);

  // Running cart — derived from the parent's truth via `getCartQty`. We only
  // have an ADD callback (`onSelectProduct`) + a qty READER (`getCartQty`),
  // so the picker scans the loaded product list for anything with qty > 0 to
  // render the cart summary (count + total) and the review rows. One linear
  // pass; recomputed when the product list or the cart changes.
  const cart = useMemo(() => {
    const products = Array.isArray(allProducts) ? allProducts : [];
    const items: Array<{ product: Product; qty: number }> = [];
    let totalQty = 0;
    let totalSum = 0;
    if (getCartQty) {
      for (const p of products) {
        const qty = getCartQty(p.id);
        if (qty > 0) {
          items.push({ product: p, qty });
          totalQty += qty;
          totalSum += p.sellPrice * qty;
        }
      }
      items.sort((a, b) => a.product.name.localeCompare(b.product.name));
    }
    return { items, totalQty, totalSum };
  }, [allProducts, getCartQty]);

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

  const handleClose = useCallback(() => {
    setLocalSearch('');
    setProductSearch('');
    setActiveCategory(null);
    setCartExpanded(false);
    // Drop any per-product double-tap locks so the next open starts clean.
    lastTapRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onClose();
  }, [onClose]);

  // Edge-swipe-to-close. There's no folder navigation to pop anymore, so a
  // rightward swipe from the left edge simply dismisses the sheet. A ref keeps
  // the closure pointing at the latest `handleClose` without re-creating the
  // PanResponder.
  const panX = useRef(new Animated.Value(0)).current;
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dx > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && gs.x0 < 40,
      onPanResponderMove: (_, gs) => {
        if (gs.dx > 0) panX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 100) handleCloseRef.current();
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  // Double-tap guard on product ROWS. We DON'T disable the row in React state
  // (that would force a re-render of the whole virtualised list on every tap
  // and fight FlashList recycling); instead we gate on the cheap imperative
  // `lastTapRef` map declared above. An accidental rapid double-tap on the
  // same product fires `onSelectProduct` only ONCE; a deliberate re-add after
  // `ROW_TAP_DEBOUNCE_MS` (or the cart «+» button) still works.
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

  // Explicit «+» in the cart review — an intentional increment, so it is NOT
  // subject to the accidental-double-tap guard (a master may bump qty quickly).
  const handleCartAdd = useCallback(
    (product: Product) => {
      haptic('tap');
      onSelectProduct(product);
    },
    [onSelectProduct],
  );

  const handleDone = useCallback(() => {
    haptic('tap');
    handleClose();
  }, [handleClose]);

  const selectCategory = useCallback((next: string | null) => {
    haptic('select');
    setActiveCategory(next);
  }, []);

  // Pull-to-refresh (Task 2). Invalidate EVERY warehouse slot of the picker
  // cache (['all-products-check', ...]) so main/defect/used all refresh,
  // mirroring ProductsScreen.onRefresh. `invalidateQueries` refetches the
  // active (currently-mounted) query and the awaited promise resolves when
  // that network round-trip finishes, so the spinner reflects real work.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const renderItem = useCallback(
    ({ item }: { item: Product }) => {
      const qty = getCartQty ? getCartQty(item.id) : 0;
      const underWarranty = warrantyNames ? warrantyNames.has(item.name.trim().toLowerCase()) : false;
      return (
        <PickerProductRow
          product={item}
          cartQty={qty}
          showCostPrice={showCostPrice}
          underWarranty={underWarranty}
          onPress={handleSelect}
          palette={palette}
        />
      );
    },
    [getCartQty, handleSelect, showCostPrice, warrantyNames, palette],
  );

  const keyExtractor = useCallback((item: Product) => item.id, []);

  // First-load skeleton fires ONLY when there is no data at all yet
  // (`data === undefined`). When `data` is `[]` we trust the query and
  // show the genuine "Нет товаров" empty state — no flash before data
  // arrives because `placeholderData` keeps the previous list visible.
  //
  // Body state machine — every branch terminates in content, an empty
  // state, or QueryErrorState with «Повторить». The error branch only
  // fires when there is NO data to show (cold cache + both fetch attempts
  // failed); with stale data present the list stays up and the background
  // refetch failure is silent (stale-while-revalidate contract).
  const showInitialSkeleton = visible && allProducts === undefined && isLoading;
  const showErrorState = visible && allProducts === undefined && isError;
  const queryResolvedEmpty = visible && Array.isArray(allProducts) && allProducts.length === 0;
  const hasActiveFilter = !!productSearch || !!activeCategory;

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
              switcher pill on the right. The pill is presentational; tapping
              it toggles the inline dropdown so this component stays dumb. */}
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

          {/* Folder filter chips — horizontal, single-select, «Все» resets.
              Replaces the old folder grid + drill-in/out: tapping a chip
              filters the one flat list, no entering/leaving folders. Pinned
              under the search so it's always reachable while scrolling. */}
          {categoryChips.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.chipStripWrap}
              contentContainerStyle={styles.chipStrip}
            >
              <ChipButton
                label="Все"
                active={activeCategory === null}
                onPress={() => selectCategory(null)}
                palette={palette}
              />
              {categoryChips.map((c) => (
                <ChipButton
                  key={c}
                  label={c}
                  active={activeCategory === c}
                  onPress={() => selectCategory(activeCategory === c ? null : c)}
                  palette={palette}
                />
              ))}
            </ScrollView>
          ) : null}

          {/* Body — skeleton on cold start, error+retry when the fetch died
              with no cache to fall back on, FlashList otherwise. Wrapped in a
              flex:1 region so the running-cart bar always pins to the bottom. */}
          <View style={styles.body}>
            {showInitialSkeleton ? (
              <View style={styles.skeletonWrap}>
                <ListSkeleton count={8} />
              </View>
            ) : showErrorState ? (
              <View style={styles.stateWrap}>
                <QueryErrorState
                  title={'Не удалось загрузить товары'}
                  description={'Проверьте соединение и попробуйте ещё раз'}
                  onRetry={() => refetch()}
                />
              </View>
            ) : (
              <FlashList
                data={visibleProducts}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
                removeClippedSubviews
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
                }
                ListEmptyComponent={
                  queryResolvedEmpty ? (
                    <View style={styles.empty}>
                      <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
                      <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Нет товаров'}</Text>
                    </View>
                  ) : hasActiveFilter ? (
                    <View style={styles.empty}>
                      <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                      <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Ничего не найдено'}</Text>
                    </View>
                  ) : null
                }
              />
            )}
          </View>

          {/* Running cart review — expandable list of what's in the check so
              far. Increment-only «+» (the picker's public contract exposes an
              add callback + a qty reader, no decrement). Bounded height so it
              never eats the whole list. */}
          {cartExpanded && cart.items.length > 0 ? (
            <View
              style={[styles.cartPanel, { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle }]}
            >
              <ScrollView style={styles.cartScroll} keyboardShouldPersistTaps="handled">
                {cart.items.map(({ product, qty }) => (
                  <View key={product.id} style={[styles.cartRow, { borderBottomColor: palette.border.subtle }]}>
                    <Text style={[styles.cartRowName, { color: palette.text.primary }]} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={[styles.cartRowMeta, { color: palette.text.tertiary }]}>
                      {qty} × {formatMoney(product.sellPrice)}
                    </Text>
                    <Text style={[styles.cartRowSum, { color: palette.text.primary }]}>
                      {formatMoney(product.sellPrice * qty)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleCartAdd(product)}
                      style={[styles.cartRowPlus, { backgroundColor: palette.accent.primarySoft }]}
                      hitSlop={6}
                      accessibilityLabel={`Добавить ещё: ${product.name}`}
                    >
                      <Ionicons name="add" size={18} color={palette.accent.primaryText} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Running-cart bar — pinned to the bottom above the home indicator.
              Left = tappable summary (count + total, toggles the review panel);
              right = «Готово» (commit action = close, adds are already applied
              incrementally to the parent's check). */}
          <View
            style={[
              styles.cartBar,
              {
                backgroundColor: palette.bg.elevated,
                borderTopColor: palette.border.subtle,
                paddingBottom: Math.max(insets.bottom, spacing[2]),
              },
            ]}
          >
            {cart.items.length > 0 ? (
              <Pressable
                style={styles.cartSummary}
                onPress={() => setCartExpanded((v) => !v)}
                accessibilityLabel="Показать корзину"
              >
                <View style={[styles.cartIconWrap, { backgroundColor: palette.accent.primarySoft }]}>
                  <Ionicons name="cart" size={18} color={palette.accent.primaryText} />
                  <View style={styles.cartCountBadge}>
                    <Text style={styles.cartCountBadgeText}>{cart.totalQty}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cartTotalLabel, { color: palette.text.tertiary }]}>В чеке</Text>
                  <Text style={[styles.cartTotalValue, { color: palette.text.primary }]} numberOfLines={1}>
                    {formatMoney(cart.totalSum)}
                  </Text>
                </View>
                <Ionicons name={cartExpanded ? 'chevron-down' : 'chevron-up'} size={18} color={palette.text.tertiary} />
              </Pressable>
            ) : (
              <View style={styles.cartSummary}>
                <Text style={[styles.cartEmptyHint, { color: palette.text.tertiary }]}>
                  Нажмите на товар, чтобы добавить
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>Готово</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

interface ChipButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: SemanticPalette;
}

/**
 * Folder filter chip — pill mirror of the app's other chip strips (knowledge
 * FilterChips / ChecksScreen employee chips): filled accent when active,
 * hairline card when idle.
 */
const ChipButton = React.memo(function ChipButton({ label, active, onPress, palette }: ChipButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? palette.accent.primary : palette.bg.card,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.white : palette.text.secondary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

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
  // Warehouse switcher pill — lives in the modal HEADER on the right of the
  // title. Compact iosPill-family chip: pale primary fill, hairline tint
  // border, chevron-down icon hinting the dropdown.
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
  // Inline dropdown surface — anchored just below the header. Renders INSIDE
  // the picker's RNModal so iOS doesn't need to coordinate a second modal
  // present transition. Soft drop shadow + hairline rim so it floats above
  // the search row.
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
  // Folder filter chips
  chipStripWrap: { flexGrow: 0, marginBottom: spacing[1] },
  chipStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  chip: {
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    maxWidth: 200,
  },
  chipText: { fontSize: 13, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  // Products — visual mirror of ProductsScreen.productCard / productRow.
  // 56-pt photo (warehouse uses 42) for thumb-friendly cash hot-path taps.
  productCard: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
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
  body: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: spacing[4] },
  skeletonWrap: { flex: 1, paddingTop: spacing[2] },
  stateWrap: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing[10] },
  emptyText: { color: colors.gray[400], marginTop: spacing[2], fontSize: fontSize.sm },
  // Running-cart review panel + bar
  cartPanel: { borderTopWidth: StyleSheet.hairlineWidth },
  cartScroll: { maxHeight: SCREEN_HEIGHT * 0.28 },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cartRowName: { flex: 1, fontSize: 14, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  cartRowMeta: { fontSize: 12 },
  cartRowSum: { fontSize: 13, fontWeight: fontWeight.semibold, minWidth: 68, textAlign: 'right' },
  cartRowPlus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[1],
  },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cartSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cartIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountBadge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.white },
  cartTotalLabel: { fontSize: 11 },
  cartTotalValue: { fontSize: 17, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  cartEmptyHint: { fontSize: 13 },
  doneBtn: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { color: colors.white, fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.1 },
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
