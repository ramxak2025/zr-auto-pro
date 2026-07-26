/**
 * ProductPickerScreen — полноэкранный пикер товаров для Кассы (Round 8 #2).
 *
 * Владелец после реального прогона отверг плоский список с чипами (Round 7):
 * вернулись ПАПКИ, как на Складе. Каждый уровень папки — ОТДЕЛЬНЫЙ push этого
 * же роута на КОРНЕВОЙ стек (`ProductPicker`, params `{ folderPath }`), в
 * точности как ProductsScreen пушит `ProductsHome` с новым `activePath`:
 * нативный iOS edge-swipe = подъём ровно на один уровень папки.
 *
 * Выход из пикера:
 *   • Корневой уровень — gestureEnabled: false (см. AppNavigator): edge-swipe
 *     НИКОГДА не закрывает пикер (явное требование владельца). Глубже —
 *     жест включён и pop'ает один уровень.
 *   • «Готово» (нижний бар, есть на КАЖДОМ уровне) и «X» в шапке корня
 *     разматывают ВСЕ уровни пикера разом: navigation.pop(depth + 1) — все
 *     экраны пикера лежат подряд над Кассой, глубина известна из folderPath.
 *   • Android hardware back: native-stack по умолчанию pop'ает один экран =
 *     один уровень папки вверх; на корне закрывает пикер (эквивалент «X»,
 *     осознанное действие — в отличие от случайного свайпа). Отдельный
 *     BackHandler не нужен — нужное поведение даёт сама архитектура
 *     push-per-level.
 *
 * Корзина живёт в CheckCreateScreen (productLines / addProductLine /
 * decrementProductLine); мост — module-level session store
 * (`utils/productPickerSession.ts`), НЕ функции в route.params (те дают
 * non-serializable warning). Тап по строке = добавить (haptic +
 * ROW_TAP_DEBOUNCE_MS защита от дребезга); при qty > 0 на строке появляется
 * компактный степпер «− qty +» — владельческая «кнопка убрать возле
 * количества»: случайное добавление обратимо прямо в списке.
 *
 * Данные: ТЕ ЖЕ query keys, что и ProductPickerModal / прогрев Кассы —
 * `['all-products-check', { warehouseId }]` (весь склад, PICKER_PRODUCT_LIMIT)
 * и `['warehouse-categories', { warehouseId }]`. Оба ключа в PERSISTED_KEYS и
 * греются prefetch'ем логина/Кассы, поэтому первый кадр — из кеша
 * (placeholderData prev=>prev + main-склад заимствует un-scoped слот),
 * ревалидация — в фоне при каждом открытии. Поиск — по ВСЕМУ складу (плоские
 * результаты, не только текущая папка), локальный дебаунс 200 мс.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from '../components/CachedImage';
import BarcodeScanner from '../components/BarcodeScanner';
import { ListSkeleton } from '../components/Skeleton';
import QueryErrorState from '../components/QueryErrorState';
import { productsApi, warehouseCategoriesApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { buildShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import {
  getProductPickerSession,
  getProductPickerSessionVersion,
  subscribeProductPickerSession,
} from '../utils/productPickerSession';
import { formatQty, unitLabel } from '../utils/units';
import type { Product } from '../../../shared/types';

/** Окно дребезга: повторный тап по ТОЙ ЖЕ строке в этом окне игнорируется
 *  (случайный двойной тап добавляет один раз). Осознанный повтор — после окна
 *  или через явный «+» степпера. Тот же контракт, что в ProductPickerModal. */
const ROW_TAP_DEBOUNCE_MS = 500;

/** Весь склад одной страницей — MUST mirror PICKER_CACHE_PRODUCT_LIMIT в
 *  CheckCreateScreen и PICKER_PRODUCT_LIMIT в ProductPickerModal: все трое
 *  делят один query key, меньший limit тут снова уронил бы «хвост» склада
 *  (bug #58 / Round 7 audit #1). */
const PICKER_PRODUCT_LIMIT = 100000;

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── Строка папки — визуальное зеркало FolderRow Склада (ProductsScreen) ────
interface PickerFolderRowProps {
  name: string;
  count: number;
  hasLow: boolean;
  onOpen: (name: string) => void;
  palette: SemanticPalette;
}

const PickerFolderRow = React.memo(function PickerFolderRow({
  name,
  count,
  hasLow,
  onOpen,
  palette,
}: PickerFolderRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onOpen(name)}
      activeOpacity={0.6}
      style={[styles.folderRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
      accessibilityRole="button"
      accessibilityLabel={`Открыть папку ${name}`}
    >
      <View style={[styles.folderIconBox, { backgroundColor: palette.accent.primarySoft }]}>
        <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
      </View>
      <View style={styles.folderInfo}>
        <Text style={[styles.folderName, { color: palette.text.primary }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>{count} шт</Text>
      </View>
      {hasLow ? <Ionicons name="alert-circle" size={14} color={colors.orange[500]} style={styles.folderAlert} /> : null}
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </TouchableOpacity>
  );
});

// ── Строка товара — зеркало PickerProductRow модалки + степпер «− qty +» ───
interface PickerProductRowProps {
  product: Product;
  cartQty: number;
  showCostPrice: boolean;
  underWarranty: boolean;
  onPress: (product: Product) => void;
  onIncrement: (product: Product) => void;
  onDecrement: (product: Product) => void;
  palette: SemanticPalette;
}

const PickerProductRow = React.memo(function PickerProductRow({
  product,
  cartQty,
  showCostPrice,
  underWarranty,
  onPress,
  onIncrement,
  onDecrement,
  palette,
}: PickerProductRowProps) {
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
      accessibilityLabel={`Добавить в чек: ${product.name}`}
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
        {cartQty > 0 ? (
          /* Товар уже в чеке: компактный степпер прямо на строке. «−» — та
             самая «кнопка убрать возле количества»: снимает единицу, на нуле
             удаляет строку; «+» — осознанный повтор мимо защиты от дребезга.
             Остаток уезжает мелкой строкой над степпером. */
          <View style={styles.stepperCol}>
            <View style={styles.stockInline}>
              {lowStock ? <Ionicons name="alert-circle" size={12} color={colors.red[500]} /> : null}
              <Text style={[styles.stockInlineText, { color: lowStock ? colors.red[500] : palette.text.tertiary }]}>
                {formatQty(product.stock)} {unitLabel(product.unit)}
              </Text>
            </View>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                onPress={() => onDecrement(product)}
                style={[styles.stepBtn, { backgroundColor: palette.bg.muted }]}
                hitSlop={8}
                accessibilityLabel={`Убрать: ${product.name}`}
              >
                <Ionicons name="remove" size={18} color={colors.red[500]} />
              </TouchableOpacity>
              <View style={styles.qtyBadge}>
                <Text style={styles.qtyBadgeText}>{formatQty(cartQty)}</Text>
              </View>
              <TouchableOpacity
                onPress={() => onIncrement(product)}
                style={[styles.stepBtn, { backgroundColor: palette.accent.primarySoft }]}
                hitSlop={8}
                accessibilityLabel={`Добавить ещё: ${product.name}`}
              >
                <Ionicons name="add" size={18} color={palette.accent.primaryText} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.productStockWrap}>
            {lowStock ? (
              <Ionicons name="alert-circle" size={14} color={colors.red[500]} style={{ marginBottom: 2 }} />
            ) : null}
            <Text style={[styles.productStock, { color: palette.text.primary }, lowStock && styles.productStockLow]}>
              {product.stock}
            </Text>
            <Text style={[styles.productStockLabel, { color: palette.text.tertiary }]}>{'шт'}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

type PickerListRow =
  | { type: 'folder'; key: string; name: string; count: number; hasLow: boolean }
  | { type: 'product'; key: string; product: Product };

export default function ProductPickerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const folderPath: string[] = useMemo(() => route.params?.folderPath ?? [], [route.params?.folderPath]);
  const depth = folderPath.length;
  const isRoot = depth === 0;
  const title = isRoot ? 'Товары' : folderPath[folderPath.length - 1];

  // ── Сессия Кассы (см. utils/productPickerSession.ts) ─────────────────────
  useSyncExternalStore(subscribeProductPickerSession, getProductPickerSessionVersion);
  const session = getProductPickerSession();

  // Защита: экран без живой сессии (state-restoration / deep-link) — закрыться.
  useEffect(() => {
    if (!session) navigation.goBack();
  }, [session, navigation]);

  const warehouseId = session?.warehouseId ?? null;
  const warehouses = session?.warehouses ?? [];
  const mainWarehouseId = useMemo(() => warehouses.find((w) => w.kind === 'main')?.id ?? null, [warehouses]);

  // ── Поиск: input рисует каждое нажатие, фильтр едет за 200мс-дебаунсом,
  //    чтобы FlashList не перескакивал на каждой букве. ──────────────────────
  const [localSearch, setLocalSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((text: string) => {
    setLocalSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(text), 200);
  }, []);
  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLocalSearch('');
    setDebouncedSearch('');
  }, []);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const [showWarehouseDropdown, setShowWarehouseDropdown] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  // Round 12 #6в — «пикать подряд»: сканер работает в continuous-режиме,
  // после каждого успешного скана остаётся открытым; пилюля показывает
  // «+1 Название · в чеке N». Счётчик — на сессию сканера (сброс на открытии).
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const scanAddCountRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);

  // ── Товары — ТОТ ЖЕ ключ/лимит, что модалка и прогрев Кассы. Кеш-first:
  //    placeholderData держит предыдущий список (плюс main-склад заимствует
  //    un-scoped слот логин-префетча), staleTime 30с + refetch на открытии
  //    корня освежают остатки в фоне без блэнка. ──────────────────────────────
  const {
    data: allProducts,
    isLoading,
    isError,
    refetch,
  } = useQuery<Product[]>({
    queryKey: warehouseId ? ['all-products-check', { warehouseId }] : ['all-products-check'],
    queryFn: async () => {
      const params: { limit: number; warehouseId?: string } = { limit: PICKER_PRODUCT_LIMIT };
      if (warehouseId) params.warehouseId = warehouseId;
      const res = await productsApi.getAll(params);
      return (res.data?.data || res.data) as Product[];
    },
    placeholderData: (prev) => {
      if (prev !== undefined) return prev;
      if (warehouseId && warehouseId === mainWarehouseId) {
        return queryClient.getQueryData<Product[]>(['all-products-check']);
      }
      return undefined;
    },
    staleTime: 30_000,
  });

  // Ревалидация при открытии пикера (Round 7 Task 2 — живые остатки): один
  // явный фоновый refetch на mount КОРНЕВОГО уровня. Глубокие уровни делят
  // тот же кеш-слот — им хватает staleTime; React Query дедупит параллельные.
  useEffect(() => {
    if (isRoot) refetch();
  }, [isRoot, refetch]);

  // ── Папки склада (пустые + sort_order) — тот же ключ, что Склад/прогрев. ──
  const { data: extraFolders } = useQuery({
    queryKey: warehouseId ? ['warehouse-categories', { warehouseId }] : ['warehouse-categories'],
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll(warehouseId || undefined);
      return res.data;
    },
    enabled: !!warehouseId,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });

  // ── Корзина: qty по productId + итоги нижнего бара — из session.productLines
  //    (прямое зеркало строк чека, включая товары с других складов). ─────────
  const sessionLines = session?.productLines;
  const cartMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of sessionLines ?? []) {
      if (l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
    }
    return m;
  }, [sessionLines]);
  const cartTotals = useMemo(() => {
    let qty = 0;
    let sum = 0;
    for (const l of sessionLines ?? []) {
      qty += l.quantity;
      sum += l.sellPrice * l.quantity;
    }
    return { qty, sum };
  }, [sessionLines]);

  // ── Ряды списка: поиск → плоские результаты по ВСЕМУ складу; иначе папки
  //    текущего уровня + товары ровно этого уровня (алгоритм ProductsScreen). ─
  const searchActive = debouncedSearch.trim().length > 0;
  const listRows = useMemo<PickerListRow[]>(() => {
    const products = Array.isArray(allProducts) ? allProducts : [];
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      const rows: PickerListRow[] = [];
      for (const p of products) {
        if (
          p.name.toLowerCase().includes(q) ||
          (p.category && p.category.toLowerCase().includes(q)) ||
          // Round 12 #6в: скан-промах кладёт код в поиск — матчим и barcode,
          // чтобы частичный/чужой код всё же находил кандидатов.
          (p.barcode && String(p.barcode).toLowerCase().includes(q))
        ) {
          rows.push({ type: 'product', key: p.id, product: p });
        }
      }
      return rows;
    }

    const subs = new Map<string, { count: number; hasLow: boolean }>();
    const prods: Product[] = [];
    for (const p of products) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];
      const matchesPath = folderPath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && folderPath.length > 0) continue;
      if (catParts.length > folderPath.length) {
        const folderName = catParts[folderPath.length];
        const existing = subs.get(folderName) || { count: 0, hasLow: false };
        existing.count++;
        if (p.stock <= p.minStock && p.minStock > 0) existing.hasLow = true;
        subs.set(folderName, existing);
      } else if (catParts.length === folderPath.length) {
        prods.push(p);
      }
    }
    // Пустые папки из warehouse_categories — как на Складе (тот же
    // path||name fallback, что в ProductsScreen).
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders) {
        const efPath: string = ef.path || (ef as any).name || '';
        if (!efPath) continue;
        const efParts = efPath.split('/');
        const matchesPath = folderPath.every((seg, i) => efParts[i] === seg);
        if (matchesPath && efParts.length > folderPath.length) {
          const folderName = efParts[folderPath.length];
          if (!subs.has(folderName)) subs.set(folderName, { count: 0, hasLow: false });
        }
      }
    }
    // Порядок папок: sort_order из warehouse_categories, затем алфавит — как Склад.
    const prefix = folderPath.join('/');
    const orderLookup = new Map<string, number>();
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders) {
        if (ef.path) orderLookup.set(ef.path, ef.sort_order || 0);
      }
    }
    const folders = Array.from(subs.entries())
      .map(([name, info]) => {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        return { name, ...info, sortOrder: orderLookup.get(fullPath) || 0 };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const rows: PickerListRow[] = folders.map((f) => ({
      type: 'folder',
      key: `folder:${f.name}`,
      name: f.name,
      count: f.count,
      hasLow: f.hasLow,
    }));
    for (const p of prods) rows.push({ type: 'product', key: p.id, product: p });
    return rows;
  }, [allProducts, extraFolders, debouncedSearch, folderPath]);

  // ── Действия ──────────────────────────────────────────────────────────────
  // Защита от дребезга — императивная map, НЕ state (state дёргал бы весь
  // виртуализированный список на каждый тап). Контракт как в модалке.
  const lastTapRef = useRef<Map<string, number>>(new Map());
  const handleRowPress = useCallback((product: Product) => {
    const s = getProductPickerSession();
    if (!s) return;
    const now = Date.now();
    const last = lastTapRef.current.get(product.id) ?? 0;
    if (now - last < ROW_TAP_DEBOUNCE_MS) return; // случайный двойной тап
    lastTapRef.current.set(product.id, now);
    haptic('tap');
    s.addProduct(product);
  }, []);

  // Явные «+»/«−» степпера — осознанные действия, мимо защиты от дребезга.
  const handleIncrement = useCallback((product: Product) => {
    const s = getProductPickerSession();
    if (!s) return;
    haptic('tap');
    s.addProduct(product);
  }, []);
  const handleDecrement = useCallback((product: Product) => {
    const s = getProductPickerSession();
    if (!s) return;
    haptic('tap');
    s.decrementProduct(product.id);
  }, []);

  // Спуск в папку: push НОВОГО инстанса этого же роута (как Склад). push, а
  // не navigate — navigate с теми же params upsert-ит текущий экран и
  // edge-swipe назад перестаёт работать.
  const enterFolder = useCallback(
    (name: string) => {
      haptic('select');
      navigation.push('ProductPicker', { folderPath: [...folderPath, name] });
    },
    [navigation, folderPath],
  );

  // «Готово» / «X»: размотать ВСЕ уровни пикера одним pop(depth + 1) — под
  // ними лежит Касса (таб или пушнутый edit-CheckCreate), popToTop нельзя:
  // он снёс бы и пушнутый CheckCreate.
  const handleDone = useCallback(() => {
    haptic('tap');
    navigation.pop(depth + 1);
  }, [navigation, depth]);

  // Round 12 #6в: скан в Кассе = МГНОВЕННОЕ добавление в чек. Exact-match по
  // загруженному списку склада (тот же источник, что и строки пикера); попал —
  // добавляем ТЕМ ЖЕ путём, что тап по строке, но МИМО lastTapRef-дебаунса
  // (образец handleIncrement: скан — осознанное действие, cooldown уже даёт
  // сам continuous-сканер) и оставляем камеру открытой — складской сценарий
  // «пикать подряд». Промах — прежнее поведение: код в поиск (клиентский
  // фильтр ниже теперь матчит и barcode), haptic warning, сканер закрывается,
  // чтобы показать результаты/пустое состояние.
  const handleScanned = useCallback(
    (code: string) => {
      const needle = code.trim();
      const products = Array.isArray(allProducts) ? allProducts : [];
      const match = needle ? products.find((p) => String(p.barcode || '').trim() === needle) : undefined;
      if (match) {
        const s = getProductPickerSession();
        if (s) {
          haptic('success');
          s.addProduct(match);
          scanAddCountRef.current += 1;
          setScanFeedback(`+1 ${match.name} · в чеке ${scanAddCountRef.current}`);
          return; // сканер НЕ закрываем — ждём следующий товар
        }
      }
      haptic('warning');
      setShowScanner(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setLocalSearch(needle);
      setDebouncedSearch(needle); // скан — точный запрос, без дебаунса
    },
    [allProducts],
  );

  const openScanner = useCallback(() => {
    haptic('tap');
    scanAddCountRef.current = 0;
    setScanFeedback(null);
    setShowScanner(true);
  }, []);

  // Pull-to-refresh: инвалидируем ВСЕ склады пикерного кеша (main/брак/Б-У),
  // зеркало ProductsScreen.onRefresh / модалки.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const sessionWarrantyNames = session?.warrantyNames;
  const sessionShowCostPrice = !!session?.showCostPrice;
  const renderItem = useCallback(
    ({ item }: { item: PickerListRow }) => {
      if (item.type === 'folder') {
        return (
          <PickerFolderRow
            name={item.name}
            count={item.count}
            hasLow={item.hasLow}
            onOpen={enterFolder}
            palette={palette}
          />
        );
      }
      const qty = cartMap.get(item.product.id) ?? 0;
      const underWarranty = sessionWarrantyNames
        ? sessionWarrantyNames.has(item.product.name.trim().toLowerCase())
        : false;
      return (
        <PickerProductRow
          product={item.product}
          cartQty={qty}
          showCostPrice={sessionShowCostPrice}
          underWarranty={underWarranty}
          onPress={handleRowPress}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          palette={palette}
        />
      );
    },
    [
      enterFolder,
      cartMap,
      sessionWarrantyNames,
      sessionShowCostPrice,
      handleRowPress,
      handleIncrement,
      handleDecrement,
      palette,
    ],
  );

  const keyExtractor = useCallback((item: PickerListRow) => item.key, []);
  const getItemType = useCallback((item: PickerListRow) => item.type, []);

  const warehouseLabel = useMemo(() => {
    const w = warehouseId ? warehouses.find((x) => x.id === warehouseId) : warehouses.find((x) => x.kind === 'main');
    return w?.name || 'Основной склад';
  }, [warehouses, warehouseId]);

  // Стейт-машина тела — как в модалке: скелетон только на голодном кеше,
  // ошибка только когда показать нечего (stale-while-revalidate молчит).
  const showInitialSkeleton = allProducts === undefined && isLoading;
  const showErrorState = allProducts === undefined && isError;
  const queryResolvedEmpty = Array.isArray(allProducts) && allProducts.length === 0;

  if (!session) return null; // закрываемся в effect выше

  return (
    <View style={[styles.container, { backgroundColor: palette.bg.canvas, paddingTop: insets.top }]}>
      {/* ── Шапка: X (корень) / назад-шеврон (глубже) + заголовок + свитчер
             склада (только корень). ────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
        {isRoot ? (
          <TouchableOpacity
            onPress={handleDone}
            style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
            accessibilityLabel="Закрыть пикер товаров"
          >
            <Ionicons name="close" size={22} color={palette.text.secondary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
            accessibilityLabel="Назад на уровень выше"
          >
            <Ionicons name="chevron-back" size={22} color={palette.text.secondary} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        {isRoot && warehouses.length > 0 ? (
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
              {warehouseLabel}
            </Text>
            <Ionicons
              name={showWarehouseDropdown ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={palette.accent.primaryText}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Инлайн-дропдаун складов (только корень) — in-flow, как в модалке. */}
      {isRoot && showWarehouseDropdown ? (
        <View
          style={[
            styles.warehouseDropdown,
            { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
            buildShadow(palette, 'elevated'),
          ]}
        >
          {warehouses.map((w) => {
            const iconName =
              w.kind === 'defect' ? 'warning-outline' : w.kind === 'used' ? 'cube-outline' : 'home-outline';
            const sub =
              w.kind === 'defect' ? 'Брак' : w.kind === 'used' ? 'Б/У — подержанные детали' : 'Основной склад';
            const active = warehouseId === w.id;
            return (
              <TouchableOpacity
                key={w.id}
                style={[styles.warehouseDropdownRow, { borderBottomColor: palette.border.subtle }]}
                onPress={() => {
                  session.setWarehouseId(w.id);
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

      {/* ── Поиск по всему складу + сканер штрих-кода (корень) ───────────── */}
      <View style={[styles.searchWrap, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="search-outline" size={16} color={palette.text.tertiary} />
        <TextInput
          value={localSearch}
          onChangeText={handleSearchChange}
          style={[styles.searchInput, { color: palette.text.primary }]}
          placeholder={isRoot ? 'Поиск товара...' : 'Поиск по всему складу...'}
          placeholderTextColor={palette.text.tertiary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {localSearch ? (
          <TouchableOpacity onPress={clearSearch} hitSlop={8} accessibilityLabel="Очистить поиск">
            <Ionicons name="close-circle-outline" size={18} color={palette.text.tertiary} />
          </TouchableOpacity>
        ) : isRoot ? (
          <TouchableOpacity onPress={openScanner} hitSlop={8} accessibilityLabel="Сканировать штрих-код">
            <Ionicons name="barcode-outline" size={20} color={colors.primary[500]} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Тело: скелетон → ошибка (без кеша) → FlashList папки+товары ──── */}
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
            data={listRows}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            removeClippedSubviews
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
            }
            ListEmptyComponent={
              searchActive ? (
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                  <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Ничего не найдено'}</Text>
                </View>
              ) : queryResolvedEmpty ? (
                <View style={styles.empty}>
                  <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
                  <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Нет товаров'}</Text>
                </View>
              ) : !isRoot && Array.isArray(allProducts) ? (
                <View style={styles.empty}>
                  <Ionicons name="folder-open-outline" size={40} color={palette.text.tertiary} />
                  <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>{'Папка пуста'}</Text>
                </View>
              ) : null
            }
          />
        )}
      </View>

      {/* ── Нижний бар корзины — на КАЖДОМ уровне: счётчик + сумма + Готово. */}
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
        {cartTotals.qty > 0 ? (
          <View style={styles.cartSummary}>
            <View style={[styles.cartIconWrap, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="cart" size={18} color={palette.accent.primaryText} />
              <View style={styles.cartCountBadge}>
                <Text style={styles.cartCountBadgeText}>{formatQty(cartTotals.qty)}</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cartTotalLabel, { color: palette.text.tertiary }]}>В чеке</Text>
              <Text style={[styles.cartTotalValue, { color: palette.text.primary }]} numberOfLines={1}>
                {formatMoney(cartTotals.sum)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.cartSummary}>
            <Text style={[styles.cartEmptyHint, { color: palette.text.tertiary }]}>
              Нажмите на товар, чтобы добавить
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.85} accessibilityLabel="Готово">
          <Text style={styles.doneBtnText}>Готово</Text>
        </TouchableOpacity>
      </View>

      {/* Сканер штрих-кода — общий компонент (Склад/Инвентаризация), здесь в
          continuous-режиме (round 12 #6в): успешный скан добавляет товар в чек
          и оставляет камеру открытой («пикать подряд»), пилюля показывает
          последний добавленный товар и счётчик. Haptic отдаёт handleScanned. */}
      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScanned={handleScanned}
        continuous
        statusText={scanFeedback}
        hint="Наведите камеру на штрих-код — товар добавится в чек"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  headerSpacer: { width: 36 },
  headerWarehouseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    maxWidth: 160,
  },
  headerWarehouseChipText: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  warehouseDropdown: {
    marginHorizontal: spacing[4],
    marginTop: 4,
    marginBottom: spacing[2],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  warehouseDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  warehouseDropdownName: { fontSize: 15, fontWeight: fontWeight.semibold },
  warehouseDropdownSub: { fontSize: 12, marginTop: 1 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, paddingVertical: 0 },
  // Папки — зеркало folderRow Склада (иконка-бокс, имя, счётчик, шеврон).
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderInfo: { flex: 1, marginLeft: spacing[3], minWidth: 0 },
  folderName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  folderCount: { fontSize: 11, marginTop: 1 },
  folderAlert: { marginRight: spacing[2] },
  // Товары — зеркало PickerProductRow модалки (56pt фото, hairline).
  productCard: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  productPhoto: { width: 56, height: 56, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: 15, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  productCategory: { fontSize: 11, marginTop: 1 },
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
  productSellPrice: { fontSize: 13, fontWeight: fontWeight.semibold },
  productCostPrice: { fontSize: 11 },
  productStockWrap: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 48, paddingLeft: spacing[1] },
  productStock: { fontSize: 16, fontWeight: '700' as const, letterSpacing: -0.3 },
  productStockLow: { color: colors.red[500] },
  productStockLabel: { fontSize: 10, marginTop: -1 },
  // Степпер «− qty +» на строке товара, который уже в чеке.
  stepperCol: { alignItems: 'flex-end', justifyContent: 'center', paddingLeft: spacing[1], gap: 4 },
  stockInline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stockInlineText: { fontSize: 11 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBadgeText: { fontSize: 13, fontWeight: fontWeight.bold, color: colors.white },
  // Тело + состояния
  body: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: spacing[4] },
  skeletonWrap: { flex: 1, paddingTop: spacing[2] },
  stateWrap: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing[10] },
  emptyText: { marginTop: spacing[2], fontSize: fontSize.sm },
  // Нижний бар корзины
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
});
