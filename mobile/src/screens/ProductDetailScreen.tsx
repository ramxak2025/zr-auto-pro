/**
 * ProductDetailScreen — premium drill-down for ONE warehouse product.
 *
 * Reached by tapping a product row in ProductsScreen (which previously opened
 * the edit modal directly). Pushed onto the Products (Склад) tab-stack so the
 * floating glass tab bar stays visible and iOS edge-swipe pops back to the
 * warehouse list.
 *
 * What it shows (role-gated exactly like ProductRow — masters never see cost):
 *   • large photo → tap opens a fullscreen blurred preview;
 *   • name, category, low-stock indicator;
 *   • sell price, cost + margin% (cost/margin gated);
 *   • stock, supplier, barcode, unit, warranty;
 *   • a price-over-time spark chart (GET /products/:id/price-history);
 *   • a recent slice of stock movements with «Вся история» →
 *     the existing ProductMovementHistoryModal (shared cache key, instant).
 *
 * Edit: the «Изменить» affordance flips THIS screen into an inline edit mode
 * (NOT the old in-list modal) with every field — name, category, cost/sell
 * price, stock, min stock, unit, barcode, warranty, photo — saved through the
 * existing productsApi.update. «Перенести» reuses FolderPickerModal to drop the
 * product into another folder of the SAME warehouse (existing categories only,
 * no manual typing).
 *
 * Data: ONLY existing endpoints. `productsApi.getById` (full shape incl.
 * supplier), `productsApi.priceHistory` (typed ledger), and the same
 * `stockMovementsApi.list({ productId })` the modal uses — so opening the
 * full history is cache-instant. The passed `product` seeds `initialData`
 * so the screen paints with zero flicker, then revalidates in the background.
 *
 * Android-safe: shared RN only; haptics via the platform helper; glass
 * preview degrades through expo-blur on Android.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal as RNModal,
  Platform,
  Dimensions,
  ActivityIndicator,
  Alert,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';

import BarcodeScanner, { isBarcodeScannerAvailable } from '../components/BarcodeScanner';
import CachedImage from '../components/CachedImage';
import { KeyboardAwareView } from '../components/KeyboardAware';
import IosScreenHeader from '../components/IosScreenHeader';
import SectionHeader from '../components/SectionHeader';
import FolderPickerModal from '../components/FolderPickerModal';
import ProductMovementHistoryModal, {
  visualFor,
  formatMovementDateTime,
  formatQty,
} from '../components/ProductMovementHistoryModal';
import { DEFAULT_UNIT, UNIT_PRESETS, unitLabel } from '../utils/units';
import { readNumericField } from '../utils/numberInput';
import { extractApiErrorMessage } from '../utils/apiError';
import { Text } from '../platform/Typography';
import { productsApi, stockMovementsApi, uploadsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { colors, borderRadius, spacing } from '../theme';
import type { Product, StockMovement, ProductPriceHistoryEntry } from '../../../shared/types';
// Round 12 #6/#8: `barcode` now lives on the shared contract types — the old
// local ProductEditPayload superset-hack is gone.
import type { UpdateProductRequest } from '../../../shared/api/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const RECENT_COUNT = 4;

// ─── formatters ───────────────────────────────────────────────────────────
function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// Единицы измерения — единый модуль utils/units.ts (120, дробные количества):
// legacy-коды ('pcs','m','kg'…) маппятся на русские метки, новые значения
// хранятся сразу русскими ('шт','м','кг','л','уп','компл').

// Russian day pluralisation: 1 день, 2 дня, 5 дней.
function pluralDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дня';
  return 'дней';
}
function warrantyLabel(days: number | null): string {
  if (days == null || days <= 0) return 'Без гарантии';
  return `${days} ${pluralDays(days)}`;
}

// ─── spark-path helpers (local, pure — same shape used across analytics) ────
function buildSparkPath(values: number[], w: number, h: number, minV: number, maxV: number): string {
  if (values.length < 2) return '';
  const range = Math.max(maxV - minV, 1);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - 4 - ((v - minV) / range) * (h - 8),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cpx = (prev.x + cur.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
}
function buildSparkArea(values: number[], w: number, h: number, minV: number, maxV: number): string {
  const line = buildSparkPath(values, w, h, minV, maxV);
  if (!line) return '';
  return `${line} L ${w} ${h} L 0 ${h} Z`;
}

// Round 12 #5: callers OUTSIDE Склада (товарная строка чека в CheckDetail)
// only know the id — `product` became optional and `productId` was added.
// With only an id the screen fetches the product itself and owns the
// loading / «товар удалён» terminal states below.
type ProductDetailParams = { product?: Product; productId?: string; edit?: boolean };

export default function ProductDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();

  // ROLE-ONLY (консолидация 2026-07): управление складом (себестоимость +
  // редактирование) — только warehouse_manage. Бэкенд шлёт costPrice:0 и 403 на
  // PATCH не-менеджеру, поэтому себестоимость/маржу/редактор прячем (иначе
  // «0 ₽ себестоимости» и мёртвая кнопка «Сохранить»). Mirror ProductRow.
  // «Права как в Битрикс24» (2026-07): admin живёт по матрице из /auth/me;
  // superadmin/director байпасятся внутри самого hasPermission.
  const canManageWarehouse = hasPermission('warehouse_manage');
  // Себестоимость и маржу видит только тот, кто управляет складом (manage ⇒
  // backend отдаёт реальную costPrice; иначе costPrice:0 — показывать нельзя).
  const canSeeCostPrice = canManageWarehouse;
  // #60 — «Удаление на складе». manage ⇒ delete; либо явное warehouse_delete.
  const canDeleteWarehouse = hasPermission('warehouse_manage') || hasPermission('warehouse_delete');

  const passedProduct = (route.params as ProductDetailParams).product;
  // Tolerant id resolution: full product from Склада, bare id from a check's
  // product line. An empty id can't happen from real callers, but the query
  // below is `enabled`-gated on it anyway (renders the not-found state).
  const productId = passedProduct?.id ?? (route.params as ProductDetailParams).productId ?? '';

  const [refreshing, setRefreshing] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Edit-on-detail state ────────────────────────────────────────────────
  // The «Изменить» affordance flips THIS screen into an inline edit mode with
  // every field (name, category, prices, stock, unit, barcode, warranty,
  // photo) — replacing the old in-list modal entirely. «Перенести» reuses the
  // FolderPickerModal to drop the product into another folder of the SAME
  // warehouse without manual category typing.
  const [editing, setEditing] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [unit, setUnit] = useState('');
  const [barcode, setBarcode] = useState('');
  // Round 12 #6a — камера-скан прямо в поле «Штрихкод» формы редактирования.
  // Кнопка гейтится isBarcodeScannerAvailable (старый бинарь без expo-camera
  // просто не показывает её). Форма здесь ИНЛАЙНОВАЯ (не RNModal), поэтому
  // сканер-модалка презентуется без сиблинг-Modal проблем iOS.
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [warranty, setWarranty] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // Theme-aware fill/border/text for the edit inputs (correct in dark mode).
  const inputThemed = useMemo(
    () => ({ backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary }),
    [palette],
  );

  // Full product shape (supplier object, barcode, unit, warranty). The slim
  // list projection that seeded `passedProduct` omits the nested supplier, so
  // we re-fetch — but paint instantly from initialData (zero flicker). When
  // the caller passed only `productId` (product line of a check) there is no
  // initialData: the screen shows its own loading state, and a 404 (товар
  // удалён со склада) lands in the explicit not-found terminal state below —
  // retries are pointless for a deleted row, hence `retry: false` there.
  const {
    data: product,
    isPending: productPending,
    isError: productError,
  } = useQuery<Product>({
    queryKey: ['product', productId],
    queryFn: async () => (await productsApi.getById(productId)).data,
    initialData: passedProduct,
    enabled: !!productId,
    retry: (failureCount, err: any) => (err?.response?.status === 404 ? false : failureCount < 2),
    staleTime: 60_000,
  });

  // Price-change ledger (newest first). Typed via the new productsApi.priceHistory.
  const { data: priceHistory, isLoading: priceLoading } = useQuery<ProductPriceHistoryEntry[]>({
    queryKey: ['product-price-history', productId],
    queryFn: async () => (await productsApi.priceHistory(productId)).data,
    staleTime: 60_000,
  });

  // Recent movements — SAME cache key the modal uses
  // (['stock-movements','product',id,null]) so opening «Вся история» is
  // instant and the two never fight over a slot.
  const { data: movements } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements', 'product', productId, null],
    queryFn: async () => (await stockMovementsApi.list({ productId })).data,
    staleTime: 60_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['product-price-history', productId] }),
      queryClient.invalidateQueries({ queryKey: ['stock-movements', 'product', productId, null] }),
    ]);
    setRefreshing(false);
  }, [queryClient, productId]);

  // Seed the edit fields from a product snapshot.
  const seedFromProduct = useCallback((p: Product) => {
    setName(p.name);
    setCategory(p.category || '');
    setCostPrice(p.costPrice != null ? String(p.costPrice) : '');
    setSellPrice(p.sellPrice != null ? String(p.sellPrice) : '');
    setStock(p.stock != null ? String(p.stock) : '');
    setMinStock(p.minStock != null ? String(p.minStock) : '');
    // Нормализуем legacy-код ('pcs'→'шт') сразу в русскую метку — чипсы
    // подсветят актуальное значение, а сохранение перезапишет legacy-код.
    setUnit(unitLabel(p.unit));
    setBarcode(p.barcode || '');
    setWarranty(p.warrantyDays != null ? String(p.warrantyDays) : '');
    setPhotoUri(p.photo || null);
  }, []);

  // «Изменить» → enter inline edit mode (NOT the old modal). `product` can be
  // undefined while an id-only navigation is still loading — the affordance
  // isn't rendered then, the guard is for type-safety.
  const enterEdit = useCallback(() => {
    if (!product) return;
    haptic('tap');
    seedFromProduct(product);
    setEditing(true);
  }, [product, seedFromProduct]);

  const cancelEdit = useCallback(() => {
    haptic('tap');
    setEditing(false);
    setUploadingPhoto(false);
  }, []);

  // Deep-link: long-press → action sheet «Редактировать» pushes ProductDetail
  // with `edit: true` so we land straight in edit mode. Consume the param once.
  const editParam = (route.params as ProductDetailParams).edit;
  useEffect(() => {
    if (editParam && canManageWarehouse && product) {
      seedFromProduct(product);
      setEditing(true);
      navigation.setParams({ edit: undefined });
    }
    // Only react to the param flipping on — product/seed are stable enough.
    // (Callers who pass `edit` always pass the full product, so `product` is
    // present on the first run; the check is a type-guard, not a race fix.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam]);

  const saveMutation = useMutation({
    mutationFn: (data: UpdateProductRequest) => productsApi.update(productId, data),
    onSuccess: (res) => {
      haptic('success');
      // Update the detail card in place + invalidate every warehouse/picker
      // slot so the list, the cash picker and the folder tree all refresh.
      queryClient.setQueryData(['product', productId], res.data);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['product-price-history', productId] });
      setEditing(false);
      setMoveOpen(false);
    },
    // Реальная причина отказа сервера вместо немого «Не удалось сохранить»:
    // без неё владелец не видел, какое поле не приняли.
    onError: (err: unknown) => {
      haptic('error');
      Alert.alert('Ошибка', extractApiErrorMessage(err, 'Не удалось сохранить изменения'));
    },
  });

  // #60 — мягкое удаление товара (DELETE /products/:id → deleted_at). Товар
  // уходит в Корзину склада (TrashScreen), откуда восстанавливается. Гейт —
  // canDeleteWarehouse; бэкенд дополнительно проверяет warehouse_delete.
  const deleteMutation = useMutation({
    mutationFn: () => productsApi.remove(productId),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить товар');
    },
  });

  const confirmDelete = useCallback(() => {
    if (!product) return; // id-only навигация ещё грузится — кнопки нет, guard для типов
    haptic('warning');
    Alert.alert('Удалить товар', `«${product.name}» переместится в Корзину склада. Оттуда его можно восстановить.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
    // deleteMutation identity меняется на isPending — намеренно исключаем, чтобы
    // хендлер не пересоздавался в полёте.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.name]);

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }, []);

  const getDisplayPhotoUri = useCallback((photo: string | null): string | undefined => {
    if (!photo) return undefined;
    if (photo.startsWith('file://')) return photo;
    return getImageUrl(photo);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Укажите название товара');
      return;
    }
    // #63 — определяем, какое фото сохранить:
    //   • фото убрали (photoUri пуст) → null → бэкенд ОЧИЩАЕТ фото. Раньше
    //     здесь слался старый product.photo, поэтому удаление не «прилипало».
    //   • выбрали новое (file://) → загружаем и берём вернувшийся URL;
    //   • не трогали (существующий серверный путь) → отправляем как есть.
    let uploadedPhotoPath: string | null;
    if (!photoUri) {
      uploadedPhotoPath = null;
    } else if (photoUri.startsWith('file://')) {
      try {
        setUploadingPhoto(true);
        const filename = photoUri.split('/').pop() || 'photo.jpg';
        const res = await uploadsApi.upload(photoUri, filename);
        uploadedPhotoPath = res.data.url;
      } catch {
        setUploadingPhoto(false);
        Alert.alert('Ошибка', 'Не удалось загрузить фото');
        return;
      }
      setUploadingPhoto(false);
    } else {
      uploadedPhotoPath = photoUri;
    }
    // Числа читаем через readNumericField: запятая с русской цифровой
    // клавиатуры iOS — полноценный разделитель («1250,50» = 1250.5), тогда как
    // прежний `Number(costPrice) || 0` молча превращал такой ввод в 0. Мусор
    // (null) не отправляем нулём — показываем ошибку поля.
    const parsedCost = readNumericField(costPrice, 'money');
    const parsedSell = readNumericField(sellPrice, 'money');
    const parsedStock = readNumericField(stock, 'qty');
    const parsedMinStock = readNumericField(minStock, 'qty');
    if (parsedCost === null || parsedSell === null || parsedStock === null || parsedMinStock === null) {
      Alert.alert('Ошибка', 'Цены и остаток вводятся числом — проверьте заполнение.');
      return;
    }

    const payload: UpdateProductRequest = {
      name: name.trim(),
      category,
      unit: unit.trim() || DEFAULT_UNIT,
      // @IsInt на бэкенде: дробная гарантия отклонила бы весь PATCH.
      warrantyDays: warranty.trim() === '' ? null : Math.max(0, Math.floor(Number(warranty) || 0)),
      barcode: barcode.trim(),
      photo: uploadedPhotoPath,
    };

    // PATCH — ЧАСТИЧНЫЙ: числовое поле уходит на сервер, только если владелец
    // его реально изменил.
    //
    // Именно из-за безусловной отправки `stock` не сохранялась себестоимость:
    // товар, проданный «в минус» (оверселл разрешён продуктово, см.
    // checks.service «сток уходит в МИНУС»), имеет stock < 0, а
    // UpdateProductDto.stock объявлен @Min(0) — ValidationPipe отклонял ВЕСЬ
    // PATCH с «stock must not be less than 0», и новая цена не доезжала.
    // Заодно не плодим лишние записи в price_history / stock_movements.
    // Masters never see cost — don't let a hidden field zero it out.
    if (canSeeCostPrice && parsedCost !== product?.costPrice) payload.costPrice = parsedCost;
    if (parsedSell !== product?.sellPrice) payload.sellPrice = parsedSell;
    if (parsedStock !== product?.stock) payload.stock = parsedStock;
    if (parsedMinStock !== product?.minStock) payload.minStock = parsedMinStock;
    saveMutation.mutate(payload);
  }, [
    name,
    category,
    sellPrice,
    stock,
    minStock,
    unit,
    warranty,
    barcode,
    costPrice,
    canSeeCostPrice,
    photoUri,
    saveMutation,
    product,
  ]);

  // Folder move. In edit mode the picker only updates the category field (saved
  // with the rest of the form); from read-only it commits immediately.
  const handleMoveConfirm = useCallback(
    (categoryPath: string) => {
      if (editing) {
        setCategory(categoryPath);
        setMoveOpen(false);
        return;
      }
      saveMutation.mutate({ category: categoryPath });
    },
    [editing, saveMutation],
  );

  // NULL-SAFE while an id-only navigation is loading (no initialData) — the
  // early terminal-state return below fires before the main JSX reads these.
  const displayPhotoUri = product ? getImageUrl(product.photo) : undefined;
  const lowStock = !!product && product.stock <= product.minStock && product.minStock > 0;
  const margin =
    product && product.costPrice > 0 ? ((product.sellPrice - product.costPrice) / product.costPrice) * 100 : null;
  const categoryLabel = product?.category ? product.category.split('/').pop() : undefined;

  // Build the price walk: oldest "before" point, then every "after". Reverse
  // because the backend orders newest-first.
  const { sellSeries, costSeries, minV, maxV, firstSell, lastSell } = useMemo(() => {
    const h = priceHistory ?? [];
    if (h.length === 0) {
      return { sellSeries: [] as number[], costSeries: [] as number[], minV: 0, maxV: 0, firstSell: 0, lastSell: 0 };
    }
    const chrono = [...h].reverse();
    const sell = [chrono[0].sellPriceBefore, ...chrono.map((e) => e.sellPriceAfter)];
    const cost = [chrono[0].costPriceBefore, ...chrono.map((e) => e.costPriceAfter)];
    const pool = canSeeCostPrice ? [...sell, ...cost] : sell;
    return {
      sellSeries: sell,
      costSeries: cost,
      minV: Math.min(...pool),
      maxV: Math.max(...pool),
      firstSell: sell[0],
      lastSell: sell[sell.length - 1],
    };
  }, [priceHistory, canSeeCostPrice]);

  const chartW = SCREEN_WIDTH - spacing[4] * 2 - spacing[4] * 2;
  const chartH = 96;
  const hasChart = sellSeries.length >= 2;
  const priceTrend = hasChart ? lastSell - firstSell : 0;

  const recentMovements = useMemo(() => (movements ?? []).slice(0, RECENT_COUNT), [movements]);

  // ── Terminal states (id-only navigation из чека, round 12 #5) ─────────────
  // Без initialData экран обязан пережить «product ещё не приехал»: короткий
  // спиннер, а 404/ошибка (товар удалён со склада / вычищен из Корзины) —
  // честное объяснение с кнопкой «Назад» вместо краша на product.id. ВАЖНО:
  // ранний return стоит ПОСЛЕ всех хуков выше — порядок хуков стабилен.
  if (!product) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Товар" onBack={() => navigation.goBack()} />
        <View style={styles.terminalState}>
          {!!productId && productPending && !productError ? (
            <ActivityIndicator color={palette.accent.primary} />
          ) : (
            <>
              <Ionicons name="cube-outline" size={48} color={palette.text.tertiary} />
              <Text variant="title3" color={palette.text.primary} style={styles.terminalTitle}>
                Товар удалён со склада
              </Text>
              <Text variant="footnote" color={palette.text.tertiary} style={styles.terminalText}>
                Карточка недоступна: товар удалён или больше не существует. Строка в чеке при этом сохранена.
              </Text>
              <TouchableOpacity
                style={[styles.terminalBackBtn, { backgroundColor: palette.accent.primary }]}
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
                accessibilityLabel="Назад"
              >
                <Text variant="bodyEmph" color={colors.white}>
                  Назад
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={editing ? 'Редактирование' : product.name}
        subtitle={editing ? undefined : categoryLabel}
        onBack={editing ? cancelEdit : () => navigation.goBack()}
        trailing={
          canManageWarehouse ? (
            editing ? (
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveBtn, { backgroundColor: palette.accent.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Сохранить изменения"
                disabled={saveMutation.isPending || uploadingPhoto}
                hitSlop={8}
              >
                {saveMutation.isPending || uploadingPhoto ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text variant="bodyEmph" color={colors.white}>
                    Сохранить
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={enterEdit}
                style={[styles.editBtn, { backgroundColor: palette.bg.muted }]}
                accessibilityRole="button"
                accessibilityLabel="Изменить товар"
                hitSlop={8}
              >
                <Ionicons name="create-outline" size={18} color={palette.accent.primary} />
              </TouchableOpacity>
            )
          ) : undefined
        }
      />

      {editing ? (
        // Клавиатура (миграция на keyboard-controller): KeyboardAwareView
        // вместо RN-core KAV с ручным offset=8 — offset берётся из insets,
        // одинаково на iOS и Android.
        <KeyboardAwareView style={{ flex: 1 }}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[10] }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* PHOTO picker */}
            <TouchableOpacity
              style={[styles.photoWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={pickImage}
              activeOpacity={0.85}
            >
              {photoUri ? (
                <CachedImage source={{ uri: getDisplayPhotoUri(photoUri) }} style={styles.photo} resizeMode="cover" />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Ionicons name="camera-outline" size={40} color={palette.text.tertiary} />
                  <Text variant="footnote" color={palette.text.tertiary} style={{ marginTop: spacing[2] }}>
                    Добавить фото
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            {photoUri ? (
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.photoActionBtn} onPress={pickImage}>
                  <Ionicons name="swap-horizontal" size={16} color={palette.accent.primary} />
                  <Text variant="footnote" color={palette.accent.primary}>
                    Заменить
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoActionBtn} onPress={() => setPhotoUri(null)}>
                  <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
                  <Text variant="footnote" color={colors.red[500]}>
                    Удалить
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Name */}
            <EditField label="Название" palette={palette}>
              <TextInput
                value={name}
                onChangeText={setName}
                style={[styles.input, inputThemed]}
                placeholder="Например: Масло моторное 5W-30"
                placeholderTextColor={palette.text.tertiary}
              />
            </EditField>

            {/* Category → folder picker (no manual typing) */}
            <EditField label="Папка (категория)" palette={palette}>
              <TouchableOpacity
                style={[styles.input, styles.inputAsButton, inputThemed]}
                onPress={() => {
                  haptic('tap');
                  setMoveOpen(true);
                }}
                activeOpacity={0.7}
              >
                <Text variant="body" color={category ? palette.text.primary : palette.text.tertiary} numberOfLines={1}>
                  {category || 'Без папки — выбрать…'}
                </Text>
                <Ionicons name="folder-open-outline" size={18} color={palette.accent.primary} />
              </TouchableOpacity>
            </EditField>

            {/* Prices */}
            <View style={styles.fieldRow}>
              {canSeeCostPrice ? (
                <EditField label="Себестоимость" palette={palette} style={{ flex: 1 }}>
                  <TextInput
                    value={costPrice}
                    onChangeText={setCostPrice}
                    style={[styles.input, inputThemed]}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={palette.text.tertiary}
                  />
                </EditField>
              ) : null}
              <EditField label="Цена продажи" palette={palette} style={{ flex: 1 }}>
                <TextInput
                  value={sellPrice}
                  onChangeText={setSellPrice}
                  style={[styles.input, inputThemed]}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={palette.text.tertiary}
                />
              </EditField>
            </View>

            {/* Stock */}
            <View style={styles.fieldRow}>
              <EditField
                label={`Остаток${unit && unit !== DEFAULT_UNIT ? ` (${unit})` : ''}`}
                palette={palette}
                style={{ flex: 1 }}
              >
                <TextInput
                  value={stock}
                  onChangeText={setStock}
                  style={[styles.input, inputThemed]}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={palette.text.tertiary}
                />
              </EditField>
              <EditField label="Мин. остаток" palette={palette} style={{ flex: 1 }}>
                <TextInput
                  value={minStock}
                  onChangeText={setMinStock}
                  style={[styles.input, inputThemed]}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={palette.text.tertiary}
                />
              </EditField>
            </View>

            {/* Unit — чипсы-пресеты (120, дробные количества). Нестандартная
                legacy-единица («мл», «г»…) показывается дополнительным чипом,
                чтобы её можно было оставить, а не потерять при сохранении. */}
            <EditField label="Единица измерения" palette={palette}>
              <View style={styles.unitChipsRow}>
                {(UNIT_PRESETS.includes(unit as (typeof UNIT_PRESETS)[number])
                  ? [...UNIT_PRESETS]
                  : [...UNIT_PRESETS, unit]
                )
                  .filter(Boolean)
                  .map((u) => {
                    const active = unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        onPress={() => {
                          haptic('tap');
                          setUnit(u);
                        }}
                        style={[
                          styles.unitChip,
                          {
                            backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                            borderColor: active ? palette.accent.primary : palette.border.subtle,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text variant="bodyEmph" color={active ? colors.white : palette.text.secondary}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </EditField>

            {/* Warranty */}
            <EditField label="Гарантия (дней)" palette={palette}>
              <TextInput
                value={warranty}
                onChangeText={setWarranty}
                style={[styles.input, inputThemed]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
            </EditField>

            {/* Barcode — с кнопкой камеры-скана (round 12 #6a). На бинаре без
                expo-camera кнопки нет — остаётся ручной ввод. */}
            <EditField label="Штрихкод" palette={palette}>
              <View style={styles.barcodeRow}>
                <TextInput
                  value={barcode}
                  onChangeText={setBarcode}
                  style={[styles.input, inputThemed, { flex: 1 }]}
                  placeholder="EAN-13 / QR / свой код"
                  placeholderTextColor={palette.text.tertiary}
                  autoCapitalize="none"
                />
                {isBarcodeScannerAvailable ? (
                  <TouchableOpacity
                    style={[styles.barcodeScanBtn, { backgroundColor: palette.bg.muted }]}
                    onPress={() => {
                      haptic('tap');
                      setBarcodeScanOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Сканировать штрих-код камерой"
                    hitSlop={4}
                  >
                    <Ionicons name="barcode-outline" size={22} color={palette.accent.primary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </EditField>

            {/* Save / cancel */}
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
                onPress={cancelEdit}
                activeOpacity={0.8}
              >
                <Text variant="bodyEmph" color={palette.text.secondary}>
                  Отмена
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
                onPress={handleSave}
                disabled={saveMutation.isPending || uploadingPhoto}
                activeOpacity={0.85}
              >
                {saveMutation.isPending || uploadingPhoto ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text variant="bodyEmph" color={colors.white}>
                    Сохранить
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAwareView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
          }
        >
          {/* PHOTO — tap to open fullscreen preview. */}
          <TouchableOpacity
            activeOpacity={displayPhotoUri ? 0.9 : 1}
            disabled={!displayPhotoUri}
            onPress={() => {
              if (displayPhotoUri) {
                haptic('tap');
                setFullscreenPhoto(displayPhotoUri);
              }
            }}
            style={[styles.photoWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            {displayPhotoUri ? (
              <CachedImage source={{ uri: displayPhotoUri }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="cube-outline" size={56} color={palette.text.tertiary} />
              </View>
            )}
            {displayPhotoUri ? (
              <View style={styles.expandBadge}>
                <Ionicons name="expand-outline" size={15} color={colors.white} />
              </View>
            ) : null}
          </TouchableOpacity>

          {/* NAME + category + low-stock pill */}
          <View style={styles.titleBlock}>
            <Text variant="title1" color={palette.text.primary} style={styles.name}>
              {product.name}
            </Text>
            <View style={styles.titleMetaRow}>
              {categoryLabel ? (
                <View style={[styles.chip, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="folder-outline" size={12} color={palette.text.tertiary} />
                  <Text variant="caption" color={palette.text.secondary}>
                    {categoryLabel}
                  </Text>
                </View>
              ) : null}
              {lowStock ? (
                <View style={[styles.chip, { backgroundColor: colors.red[500] + '18' }]}>
                  <Ionicons name="alert-circle" size={12} color={colors.red[500]} />
                  <Text variant="caption" color={colors.red[600]}>
                    Мало на складе
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* PRICE / STOCK summary tiles */}
          <View style={styles.statsGrid}>
            <StatTile
              icon="pricetag-outline"
              label="Цена продажи"
              value={formatMoney(product.sellPrice)}
              accent={colors.green[600]}
              palette={palette}
            />
            <StatTile
              icon="cube-outline"
              label="Остаток"
              value={`${formatQty(product.stock)} ${unitLabel(product.unit)}`}
              accent={lowStock ? colors.red[500] : palette.accent.primary}
              palette={palette}
              danger={lowStock}
            />
            {canSeeCostPrice ? (
              <>
                <StatTile
                  icon="wallet-outline"
                  label="Себестоимость"
                  value={formatMoney(product.costPrice)}
                  accent={colors.orange[500]}
                  palette={palette}
                />
                <StatTile
                  icon="trending-up-outline"
                  label="Маржа"
                  value={margin != null ? `${margin.toFixed(0)}%` : '—'}
                  accent={margin != null && margin < 0 ? colors.red[500] : colors.purple[600]}
                  palette={palette}
                />
              </>
            ) : null}
          </View>

          {/* «Перенести» — drop the product into another folder of THIS warehouse
            via the folder picker (no manual category typing). */}
          {canManageWarehouse ? (
            <TouchableOpacity
              style={[styles.moveRowBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                setMoveOpen(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.moveRowIcon, { backgroundColor: palette.accent.primarySoft }]}>
                <Ionicons name="arrow-redo-outline" size={17} color={palette.accent.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyEmph" color={palette.text.primary}>
                  Перенести в другую папку
                </Text>
                <Text variant="caption" color={palette.text.tertiary}>
                  {categoryLabel ? `Сейчас: ${categoryLabel}` : 'Сейчас: без папки'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          ) : null}

          {/* INFO card — supplier / barcode / unit / warranty */}
          <SectionHeader title="Информация" />
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <InfoRow
              icon="business-outline"
              label="Поставщик"
              value={product.supplier?.name ?? (product.supplierId ? '—' : 'Не указан')}
              palette={palette}
            />
            <InfoRow
              icon="barcode-outline"
              label="Штрихкод"
              value={product.barcode || 'Не указан'}
              palette={palette}
              mono={!!product.barcode}
            />
            <InfoRow icon="scale-outline" label="Единица измерения" value={unitLabel(product.unit)} palette={palette} />
            <InfoRow
              icon="shield-checkmark-outline"
              label="Гарантия"
              value={warrantyLabel(product.warrantyDays)}
              palette={palette}
              last
            />
          </View>

          {/* PRICE HISTORY chart */}
          <SectionHeader title="Динамика цены" />
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            {hasChart ? (
              <>
                <View style={styles.chartHeader}>
                  <View>
                    <Text variant="caption" color={palette.text.tertiary}>
                      Текущая цена
                    </Text>
                    <Text variant="title3" color={palette.text.primary}>
                      {formatMoney(lastSell)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.trendPill,
                      { backgroundColor: (priceTrend >= 0 ? colors.green[500] : colors.red[500]) + '18' },
                    ]}
                  >
                    <Ionicons
                      name={priceTrend >= 0 ? 'arrow-up' : 'arrow-down'}
                      size={12}
                      color={priceTrend >= 0 ? colors.green[600] : colors.red[600]}
                    />
                    <Text variant="caption" color={priceTrend >= 0 ? colors.green[600] : colors.red[600]}>
                      {priceTrend >= 0 ? '+' : ''}
                      {formatMoney(priceTrend)}
                    </Text>
                  </View>
                </View>

                <Svg width={chartW} height={chartH}>
                  <Defs>
                    <SvgGrad id="priceSparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={palette.accent.primary} stopOpacity={0.22} />
                      <Stop offset="1" stopColor={palette.accent.primary} stopOpacity={0} />
                    </SvgGrad>
                  </Defs>
                  <Path d={buildSparkArea(sellSeries, chartW, chartH, minV, maxV)} fill="url(#priceSparkGrad)" />
                  {canSeeCostPrice && costSeries.length >= 2 ? (
                    <Path
                      d={buildSparkPath(costSeries, chartW, chartH, minV, maxV)}
                      stroke={colors.orange[500]}
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      fill="none"
                      strokeLinecap="round"
                    />
                  ) : null}
                  <Path
                    d={buildSparkPath(sellSeries, chartW, chartH, minV, maxV)}
                    stroke={palette.accent.primary}
                    strokeWidth={2.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>

                <View style={styles.chartFooter}>
                  <Text variant="caption" color={palette.text.tertiary}>
                    Мин {formatMoney(Math.min(...sellSeries))}
                  </Text>
                  {canSeeCostPrice ? (
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: colors.orange[500] }]} />
                      <Text variant="caption" color={palette.text.tertiary}>
                        Себест.
                      </Text>
                    </View>
                  ) : null}
                  <Text variant="caption" color={palette.text.tertiary}>
                    Макс {formatMoney(Math.max(...sellSeries))}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.emptyInline}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="analytics-outline" size={22} color={palette.text.tertiary} />
                </View>
                <Text variant="footnote" color={palette.text.secondary} style={styles.emptyText}>
                  {priceLoading ? 'Загрузка…' : 'История цен появится после первого изменения цены товара.'}
                </Text>
              </View>
            )}
          </View>

          {/* RECENT MOVEMENTS — slice; «Вся история» opens the full modal. */}
          <SectionHeader title="Движение товара" />
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            {recentMovements.length === 0 ? (
              <View style={styles.emptyInline}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="swap-horizontal-outline" size={22} color={palette.text.tertiary} />
                </View>
                <Text variant="footnote" color={palette.text.secondary} style={styles.emptyText}>
                  Поступления, расход, списания и переносы появятся здесь.
                </Text>
              </View>
            ) : (
              recentMovements.map((m, i) => (
                <MovementLine key={m.id} movement={m} palette={palette} last={i === recentMovements.length - 1} />
              ))
            )}
            {recentMovements.length > 0 ? (
              <TouchableOpacity
                style={[styles.allHistoryBtn, { borderTopColor: palette.border.subtle }]}
                onPress={() => {
                  haptic('tap');
                  setHistoryOpen(true);
                }}
                activeOpacity={0.7}
              >
                <Text variant="bodyEmph" color={palette.accent.primary}>
                  Вся история
                </Text>
                <Ionicons name="chevron-forward" size={16} color={palette.accent.primary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* #60 — удаление товара. Видно только тем, у кого есть право
              «Удаление на складе» (или owner-class). Мягкое → в Корзину. */}
          {canDeleteWarehouse ? (
            <TouchableOpacity
              style={[
                styles.deleteBtn,
                { borderColor: colors.red[500] + '55', backgroundColor: colors.red[500] + '12' },
              ]}
              onPress={confirmDelete}
              disabled={deleteMutation.isPending}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Удалить товар"
            >
              {deleteMutation.isPending ? (
                <ActivityIndicator color={colors.red[600]} size="small" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
                  <Text variant="bodyEmph" color={colors.red[600]}>
                    Удалить товар
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      {/* Folder picker — «Перенести» / category field. Scoped to the product's
          own warehouse so it never moves between warehouses. */}
      <FolderPickerModal
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        warehouseId={product.warehouseId}
        currentCategory={editing ? category : product.category}
        onConfirm={handleMoveConfirm}
        busy={!editing && saveMutation.isPending}
      />

      {/* Full movement journal — shares the cache key, so it opens instantly. */}
      <ProductMovementHistoryModal
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        productId={historyOpen ? productId : null}
        productName={product.name}
        productUnit={product.unit}
        onOpenCheck={(checkId) => {
          // Закрываем модалку и уходим кросс-таб в Журнал → CheckDetail:
          // CheckDetail недостижим из ProductsStack напрямую.
          setHistoryOpen(false);
          navigation.navigate('Checks', { screen: 'CheckDetail', params: { id: checkId } });
        }}
      />

      {/* Fullscreen photo preview — mirrors the warehouse list preview UX. */}
      <RNModal
        visible={!!fullscreenPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenPhoto(null)}
      >
        <Pressable style={styles.fullscreenOverlay} onPress={() => setFullscreenPhoto(null)}>
          <BlurView intensity={Platform.OS === 'android' ? 24 : 40} tint="dark" style={StyleSheet.absoluteFill} />
          {Platform.OS === 'android' && <View pointerEvents="none" style={styles.fullscreenScrim} />}
          {fullscreenPhoto ? (
            <Pressable style={styles.fullscreenImageWrap} onPress={(e) => e.stopPropagation?.()}>
              <CachedImage source={{ uri: fullscreenPhoto }} style={styles.fullscreenImage} resizeMode="cover" />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.fullscreenClose}
            onPress={() => setFullscreenPhoto(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color={colors.white} />
          </Pressable>
        </Pressable>
      </RNModal>

      {/* Камера-скан для поля «Штрихкод» (round 12 #6a). Открывается ТОЛЬКО
          когда другие модалки экрана закрыты — сиблинг-Modal конфликтов iOS
          нет. Одноразовый скан: код падает в поле, сканер закрывается. */}
      <BarcodeScanner
        visible={barcodeScanOpen}
        onClose={() => setBarcodeScanOpen(false)}
        onScanned={(code) => {
          setBarcode(code.trim());
          setBarcodeScanOpen(false);
        }}
        hint="Наведите камеру на штрих-код — он подставится в поле"
      />
    </View>
  );
}

// ─── sub-components ─────────────────────────────────────────────────────────
interface EditFieldProps {
  label: string;
  palette: ReturnType<typeof useColors>;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}
function EditField({ label, palette, style, children }: EditFieldProps) {
  return (
    <View style={[styles.field, style]}>
      <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

interface StatTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
  palette: ReturnType<typeof useColors>;
  danger?: boolean;
}
function StatTile({ icon, label, value, accent, palette, danger }: StatTileProps) {
  return (
    <View style={[styles.statTile, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={[styles.statTileIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons name={icon} size={15} color={accent} />
      </View>
      <Text
        variant="title3"
        color={danger ? colors.red[600] : palette.text.primary}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={styles.statTileValue}
      >
        {value}
      </Text>
      <Text variant="caption" color={palette.text.tertiary} numberOfLines={1} style={styles.statTileLabel}>
        {label}
      </Text>
    </View>
  );
}

interface InfoRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  palette: ReturnType<typeof useColors>;
  mono?: boolean;
  last?: boolean;
}
function InfoRow({ icon, label, value, palette, mono, last }: InfoRowProps) {
  return (
    <View
      style={[
        styles.infoRow,
        !last && { borderBottomColor: palette.border.subtle, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.infoLeft}>
        <Ionicons name={icon} size={17} color={palette.text.tertiary} />
        <Text variant="body" color={palette.text.secondary}>
          {label}
        </Text>
      </View>
      <Text
        variant="bodyEmph"
        color={palette.text.primary}
        numberOfLines={1}
        style={[styles.infoValue, mono && styles.infoValueMono]}
      >
        {value}
      </Text>
    </View>
  );
}

interface MovementLineProps {
  movement: StockMovement;
  palette: ReturnType<typeof useColors>;
  last?: boolean;
}
function MovementLine({ movement, palette, last }: MovementLineProps) {
  const v = visualFor(movement.type);
  return (
    <View
      style={[
        styles.moveRow,
        !last && { borderBottomColor: palette.border.subtle, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={[styles.moveIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name={v.icon} size={18} color={v.color} />
      </View>
      <View style={styles.moveBody}>
        <Text variant="bodyEmph" color={palette.text.primary} numberOfLines={1}>
          {v.label}
        </Text>
        <Text variant="caption" color={palette.text.tertiary}>
          {formatMovementDateTime(movement.createdAt)}
        </Text>
      </View>
      <View style={styles.moveRight}>
        <Text variant="bodyEmph" color={v.sign === '' ? palette.text.primary : v.color}>
          {v.sign}
          {formatQty(movement.quantity)}
        </Text>
        <Text variant="caption" color={palette.text.tertiary}>
          {'→ '}
          {formatQty(movement.stockAfter)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Terminal states — id-only навигация из чека (round 12 #5): спиннер, пока
  // товар едет, и «Товар удалён со склада» на 404/ошибке.
  terminalState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[3],
  },
  terminalTitle: { textAlign: 'center' },
  terminalText: { textAlign: 'center', maxWidth: 300 },
  terminalBackBtn: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
  },

  // «Штрихкод» + кнопка камеры-скана (round 12 #6a).
  barcodeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  barcodeScanBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[2] },

  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    height: 36,
    paddingHorizontal: spacing[3.5],
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // «Перенести» row (view mode)
  moveRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[2],
  },
  moveRowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  // Edit form
  field: { marginTop: spacing[3], gap: spacing[1.5] },
  fieldLabel: { textTransform: 'uppercase', letterSpacing: 0.3 },
  fieldRow: { flexDirection: 'row', gap: spacing[3] },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 15,
  },
  inputAsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  // Чипсы единиц измерения (120, дробные количества).
  unitChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  unitChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing[5], marginTop: spacing[3] },
  photoActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  editActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[6] },
  cancelBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtn: {
    flex: 1,
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Photo
  photoWrap: {
    width: '100%',
    height: SCREEN_WIDTH * 0.62,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  expandBadge: {
    position: 'absolute',
    top: spacing[3],
    right: spacing[3],
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Title block
  titleBlock: { gap: spacing[2], marginTop: spacing[2] },
  name: { letterSpacing: -0.4 },
  titleMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  // Stats grid (2 cols)
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2.5],
    marginTop: spacing[2],
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    gap: 4,
  },
  statTileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  statTileValue: { fontVariant: ['tabular-nums'] },
  statTileLabel: { textTransform: 'uppercase', letterSpacing: 0.3 },

  // Cards
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    marginTop: spacing[1],
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  infoLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], flexShrink: 0 },
  infoValue: { flexShrink: 1, textAlign: 'right' },
  infoValueMono: { fontVariant: ['tabular-nums'], letterSpacing: 0.5 },

  // Chart
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: spacing[4],
    marginBottom: spacing[3],
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chartFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 2, borderRadius: 1 },

  // Empty inline state inside a card
  emptyInline: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[6],
    gap: spacing[3],
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { textAlign: 'center', maxWidth: 260 },

  // Movement lines
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  moveIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBody: { flex: 1, minWidth: 0, gap: 2 },
  moveRight: { alignItems: 'flex-end', gap: 2 },
  allHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing[3.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  // #60 — «Удалить товар» (view mode)
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[5],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },

  // Fullscreen photo
  fullscreenOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullscreenScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  fullscreenImageWrap: {
    width: '90%',
    height: '70%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  fullscreenImage: { width: '100%', height: '100%', borderRadius: 24 },
  fullscreenClose: {
    position: 'absolute',
    top: 56,
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
