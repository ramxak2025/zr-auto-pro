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
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import CachedImage from './CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { ListSkeleton } from './Skeleton';
import type { Product } from '../../../shared/types';

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

interface ProductPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  getCartQty?: (productId: string) => number;
  title?: string;
  showCostPrice?: boolean;
  folderAnnotations?: Map<string, FolderAnnotation>;
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
  onPress: (product: Product) => void;
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
  onPress,
}: PickerProductRowItemProps) {
  const lowStock = product.stock <= product.minStock && product.minStock > 0;
  const photoUrl = getImageUrl((product as { photo?: string }).photo);
  const categoryLeaf = product.category ? product.category.split('/').pop() : null;
  return (
    <Pressable
      onPress={() => onPress(product)}
      style={({ pressed }) => [styles.productCard, pressed && styles.productCardPressed]}
    >
      <View style={styles.productRow}>
        {photoUrl ? (
          <CachedImage source={{ uri: photoUrl }} style={styles.productPhoto} resizeMode="cover" />
        ) : (
          <View style={styles.productPhotoPlaceholder}>
            <Ionicons name="cube-outline" size={24} color={colors.gray[300]} />
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>
            {product.name}
          </Text>
          {categoryLeaf ? <Text style={styles.productCategory}>{categoryLeaf}</Text> : null}
          <View style={styles.productPrices}>
            <Text style={styles.productSellPrice}>{formatMoney(product.sellPrice)}</Text>
            {showCostPrice ? (
              <Text style={styles.productCostPrice}>
                {'Себест.'} {formatMoney(product.costPrice)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.productStockWrap}>
          {lowStock ? (
            <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />
          ) : null}
          <Text style={[styles.productStock, lowStock && styles.productStockLow]}>{product.stock}</Text>
          <Text style={styles.productStockLabel}>{'шт'}</Text>
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
}

/**
 * Folder grid — three columns, mirror of the inventory folder grid in
 * `ProductsScreen.tsx` (`foldersGrid` style + FOLDER_WIDTH constant).
 * Lives as ONE FlashList row so it recycles cleanly with the product
 * cells below.
 */
const FolderGridRow = React.memo(function FolderGridRow({ entries, annotations, onSelect }: FolderGridRowProps) {
  return (
    <View style={styles.foldersGrid}>
      {entries.map(([name, count]) => {
        const annotation = annotations?.get(name);
        return (
          <TouchableOpacity key={name} style={styles.folderCard} onPress={() => onSelect(name)} activeOpacity={0.6}>
            <View style={styles.folderIconBox}>
              <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
            </View>
            <Text style={styles.folderName} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.folderCount}>
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
}: ProductPickerModalProps) {
  const [productPath, setProductPath] = useState<string[]>([]);
  // `localSearch` is what the input renders (every keystroke), `productSearch`
  // is the debounced value that drives the heavy filter+folder useMemo. The
  // 200 ms debounce keeps the FlashList stable while the user is still
  // typing, so the rows don't reflow on every character.
  const [localSearch, setLocalSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // so opening the picker is a cache hit on the first try, then revalidates
  // in the background. `placeholderData: prev => prev` is also redundantly
  // set on the global QueryClient — kept here too as defence in depth.
  const { data: allProducts, isLoading } = useQuery<Product[]>({
    queryKey: ['all-products-check'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 500 });
      return (res.data?.data || res.data) as Product[];
    },
    enabled: visible,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });

  const { sortedProductFolders, visibleProducts } = useMemo(() => {
    const products = allProducts || [];
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onClose();
  }, [onClose]);

  const handleSelect = useCallback(
    (product: Product) => {
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
        return <FolderGridRow entries={item.entries} annotations={item.annotations} onSelect={handleEnterFolder} />;
      }
      const qty = getCartQty ? getCartQty(item.product.id) : 0;
      return (
        <PickerProductRow product={item.product} cartQty={qty} showCostPrice={showCostPrice} onPress={handleSelect} />
      );
    },
    [getCartQty, handleEnterFolder, handleSelect, showCostPrice],
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
  const showInitialSkeleton = visible && allProducts === undefined && isLoading;
  const queryResolvedEmpty = visible && Array.isArray(allProducts) && allProducts.length === 0;

  return (
    <RNModal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={[styles.container, { transform: [{ translateX: panX }] }]} {...panResponder.panHandlers}>
          {/* Handle bar */}
          <View style={styles.handle}>
            <View style={styles.handleBar} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.gray[600]} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{title}</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TextInput
              value={localSearch}
              onChangeText={handleSearchChange}
              style={styles.searchInput}
              placeholder={'Поиск товара...'}
              placeholderTextColor={colors.gray[400]}
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
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Breadcrumbs */}
          {!productSearch && productPath.length > 0 ? (
            <View style={styles.breadcrumbRow}>
              <TouchableOpacity onPress={() => setProductPath([])} style={styles.breadcrumbItem}>
                <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
              {productPath.map((seg, i) => (
                <React.Fragment key={`${seg}-${i}`}>
                  <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
                  <TouchableOpacity
                    onPress={() => setProductPath((prev) => prev.slice(0, i + 1))}
                    style={styles.breadcrumbItem}
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        i === productPath.length - 1 && {
                          color: colors.gray[900],
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

          {/* Body — skeleton on cold start, FlashList otherwise */}
          {showInitialSkeleton ? (
            <View style={styles.skeletonWrap}>
              <ListSkeleton count={8} />
            </View>
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
                    <Ionicons name="cube-outline" size={40} color={colors.gray[300]} />
                    <Text style={styles.emptyText}>{'Нет товаров'}</Text>
                  </View>
                ) : productSearch ? (
                  <View style={styles.empty}>
                    <Ionicons name="search-outline" size={40} color={colors.gray[300]} />
                    <Text style={styles.emptyText}>{'Ничего не найдено'}</Text>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
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
});
