import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import {
  suppliersApi,
  warehousesApi,
  productsApi,
  stockMovementsApi,
  warehouseCategoriesApi,
  purchaseOrdersApi,
} from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import ProductPickerModal from '../components/ProductPickerModal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import SupplierRequestSheet from './purchaseOrders/SupplierRequestSheet';
import { PO_STATUS_META, formatPoDate } from './purchaseOrders/purchaseOrderHelpers';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import {
  UserRole,
  type Supplier,
  type Delivery,
  type SupplierPayment,
  type Product,
  type Warehouse,
  type StockMovement,
  type PaginatedResponse,
  type PurchaseOrder,
  type PurchaseOrderSuggestionGroup,
} from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface DeliveryItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export default function SupplierDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { isRole } = useAuth();
  // Write gate for placing purchase orders — director / admin / superadmin
  // (matches PurchaseOrdersScreen); the server re-checks on every mutation.
  const canWriteOrders = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  // Theme-aware fragments spread over the static (light-default) modal-form
  // styles so the sheets read correctly in dark mode. Values match the
  // already-converted form inputs across the app (UsersScreen/Suppliers).
  const f = React.useMemo(
    () => ({
      input: {
        backgroundColor: palette.bg.muted,
        borderColor: palette.border.subtle,
        color: palette.text.primary,
      },
      label: { color: palette.text.secondary },
      actions: { borderTopColor: palette.border.subtle },
      cancel: { borderColor: palette.border.strong },
      cancelText: { color: palette.text.secondary },
    }),
    [palette],
  );
  const { id, openDefectReturn } = (route.params ?? {}) as { id: string; openDefectReturn?: boolean };
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'deliveries' | 'payments' | 'returns'>('deliveries');
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);
  // Latch — consume the route param once. Without this, re-running the
  // useEffect (e.g. on focus, on a query refetch that toggles defect
  // warehouse identity) would re-open the modal after the user
  // dismissed it.
  const [defectReturnConsumed, setDefectReturnConsumed] = useState(false);

  // Delivery form
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [deliveryComment, setDeliveryComment] = useState('');
  // Backdated-invoice support — owner can stamp a delivery with a past
  // date (накладные задним числом). Defaults to today; the backend
  // honors `date?: string` on CreateDeliveryRequest. Reset to today
  // every time the «Новая поставка» modal opens.
  const [deliveryDate, setDeliveryDate] = useState<Date>(new Date());
  const [deliveryDatePickerOpen, setDeliveryDatePickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // Payment form
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentComment, setPaymentComment] = useState('');

  // Return-defect form. Modal is rendered as a wide RN sheet (uses the
  // shared <Modal>), product picker reused for selection but scoped to
  // the defect warehouse via `productsApi.getAll({ warehouseId })`.
  const [returnDefectModalOpen, setReturnDefectModalOpen] = useState(false);
  const [defectPickerOpen, setDefectPickerOpen] = useState(false);
  const [defectProduct, setDefectProduct] = useState<Product | null>(null);
  const [defectQty, setDefectQty] = useState('');
  const [defectPurchasePrice, setDefectPurchasePrice] = useState('');
  const [defectNote, setDefectNote] = useState('');

  // «Сформировать запрос» sheet at the supplier level — seeded from the
  // reorder suggestions for THIS supplier (low-stock items grouped by
  // preferred supplier). Opened on demand; the suggestions query stays
  // disabled until then so we don't fetch on every detail open.
  const [requestOpen, setRequestOpen] = useState(false);

  // Used-purchase form. Owner types product name + qty + price + an
  // optional folder; backend auto-creates the SKU on the Б/У warehouse
  // and increments stock. The supplier's debt grows by qty*price.
  const [usedPurchaseModalOpen, setUsedPurchaseModalOpen] = useState(false);
  const [upName, setUpName] = useState('');
  const [upQty, setUpQty] = useState('');
  const [upPrice, setUpPrice] = useState('');
  // Розничная цена — опционально. Если оставить пустым, товар уходит на
  // склад Б/У с sellPrice=null и владелец установит цену позже через
  // inline-CTA в ProductsScreen.
  const [upSellPrice, setUpSellPrice] = useState('');
  const [upCategory, setUpCategory] = useState('');
  const [upNote, setUpNote] = useState('');

  const { data: supplier, isLoading } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const res = await suppliersApi.getById(id);
      return res.data;
    },
  });

  const { data: deliveries } = useQuery<Delivery[]>({
    queryKey: ['supplier-deliveries', id],
    queryFn: async () => {
      const res = await suppliersApi.getDeliveries({ supplierId: id });
      const body = res.data as unknown;
      return Array.isArray(body)
        ? (body as Delivery[])
        : Array.isArray((body as { data?: unknown })?.data)
          ? (body as { data: Delivery[] }).data
          : [];
    },
  });

  const { data: payments } = useQuery<SupplierPayment[]>({
    queryKey: ['supplier-payments', id],
    queryFn: async () => {
      const res = await suppliersApi.getPayments({ supplierId: id });
      const body = res.data as unknown;
      return Array.isArray(body)
        ? (body as SupplierPayment[])
        : Array.isArray((body as { data?: unknown })?.data)
          ? (body as { data: SupplierPayment[] }).data
          : [];
    },
  });

  // Warehouses — needed to discover the defect warehouse id. Reference
  // data, rarely changes, so a 10-min staleTime is fine.
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 10 * 60_000,
  });
  // Defensive: persisted-cache rehydration can deliver any shape if a
  // prior app version stored a different one. Guard against `.find` on
  // a non-array so a stale cache entry can't crash the detail screen.
  const warehouseList: Warehouse[] = Array.isArray(warehouses) ? warehouses : [];
  const defectWarehouse = warehouseList.find((w) => w.kind === 'defect') || null;
  const usedWarehouse = warehouseList.find((w) => w.kind === 'used') || null;
  // Pinned system supplier → owner buys second-hand goods from clients
  // through this row, never standard deliveries / returns.
  const isUsedPurchaseSupplier = supplier?.kind === 'used_purchase';

  // Products currently sitting in the defect warehouse. Only fetched when
  // we know the warehouse id — query stays disabled until then so React
  // Query doesn't spin up a request with `warehouseId=undefined`.
  const { data: defectProductsPage } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { warehouseId: defectWarehouse?.id }],
    queryFn: async () => {
      const res = await productsApi.getAll({ warehouseId: defectWarehouse!.id, limit: 500 });
      return res.data;
    },
    enabled: !!defectWarehouse?.id,
    staleTime: 60_000,
  });
  // Defensive coercion (see warehouseList rationale above).
  const defectProducts: Product[] = Array.isArray(defectProductsPage?.data)
    ? defectProductsPage!.data
    : Array.isArray(defectProductsPage as any)
      ? (defectProductsPage as unknown as Product[])
      : [];

  // Existing Б/У categories — surfaced as quick-pick chips in the used
  // purchase modal so the user can avoid typing a folder name twice.
  // Free-text input still wins; the chips are a suggestion list.
  const { data: usedCategoriesRaw } = useQuery<Array<{ id: string; path: string; sort_order: number }>>({
    queryKey: ['warehouse-categories', { warehouseId: usedWarehouse?.id }],
    queryFn: async () => (await warehouseCategoriesApi.getAll(usedWarehouse!.id)).data,
    enabled: !!usedWarehouse?.id && isUsedPurchaseSupplier,
    staleTime: 60_000,
  });
  const usedCategories = Array.isArray(usedCategoriesRaw) ? usedCategoriesRaw : [];

  // Past defect-returns for this supplier — populates the "Возвраты брака"
  // tab. Backend's /stock-movements list endpoint only filters by
  // warehouse / product / type / dates, so we ask it for every
  // `defect_return_to_supplier` movement in the tenant (capped at 200)
  // and grep client-side by supplierId. Cheap because:
  //   • the list is type-scoped server-side, so it's small,
  //   • a single supplier-detail screen is the only consumer,
  //   • 30s staleTime + persistent cache keep it warm.
  const { data: defectReturns } = useQuery<StockMovement[]>({
    queryKey: ['supplier-defect-returns', id],
    queryFn: async () => {
      const res = await stockMovementsApi.list({ type: 'defect_return_to_supplier' });
      const body = res.data as unknown;
      const list: StockMovement[] = Array.isArray(body)
        ? (body as StockMovement[])
        : Array.isArray((body as { data?: unknown })?.data)
          ? (body as { data: StockMovement[] }).data
          : [];
      return list.filter((m) => m.supplierId === id);
    },
    staleTime: 30_000,
  });

  // Purchase orders placed against THIS supplier — powers the «Заказы»
  // block. Skipped for the system used-purchase channel (you never place a
  // purchase order against it). Prefix ['purchase-orders', …] so the create
  // / detail screens' invalidateQueries(['purchase-orders']) refresh it too.
  const { data: supplierOrders } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', { supplierId: id }],
    queryFn: async () => {
      const res = await purchaseOrdersApi.list({ supplierId: id, limit: 50 });
      const body = res.data as unknown;
      return Array.isArray(body)
        ? (body as PurchaseOrder[])
        : Array.isArray((body as { data?: unknown })?.data)
          ? (body as { data: PurchaseOrder[] }).data
          : [];
    },
    enabled: !!id && !isUsedPurchaseSupplier,
    staleTime: 30_000,
  });

  // Reorder suggestions — fetched lazily when «Сформировать запрос» opens.
  // We pick the group matching THIS supplier and turn its low-stock items
  // into a price-request (name + qty), no prices/totals.
  const { data: suggestionGroups } = useQuery<PurchaseOrderSuggestionGroup[]>({
    queryKey: ['purchase-order-suggestions'],
    queryFn: async () => (await purchaseOrdersApi.suggestions()).data,
    enabled: requestOpen && !isUsedPurchaseSupplier,
    staleTime: 60_000,
  });
  const requestLines = React.useMemo(() => {
    const group = (suggestionGroups || []).find((g) => g.supplierId === id);
    return (group?.items || []).map((it) => ({ name: it.name, quantity: Math.max(1, it.suggestedQuantity) }));
  }, [suggestionGroups, id]);

  // Tab fallback — if the supplier turns out to be the system
  // used-purchase row and the active tab is the (now hidden)
  // 'returns', flip back to 'deliveries' so the screen doesn't show
  // an empty body. Cheap effect, runs once per supplier load.
  useEffect(() => {
    if (supplier?.kind === 'used_purchase' && tab === 'returns') {
      setTab('deliveries');
    }
  }, [supplier?.kind, tab]);

  // Auto-open «Возврат брака» modal when the caller passed
  // `openDefectReturn: true` (e.g. via the SuppliersScreen header CTA).
  // Defers until supplier is loaded AND we know which warehouse hosts
  // defect stock — opening earlier would show an empty picker. The
  // `defectReturnConsumed` latch guarantees at-most-once behaviour
  // even if dependencies rerun.
  //
  // Skipped silently for the system used-purchase supplier — defect
  // returns don't apply to it (it doesn't have standard deliveries
  // and the backend would 400 anyway).
  useEffect(() => {
    if (!openDefectReturn) return;
    if (defectReturnConsumed) return;
    if (!supplier) return;
    if (supplier.kind === 'used_purchase') {
      setDefectReturnConsumed(true);
      return;
    }
    if (!defectWarehouse) return;
    setDefectReturnConsumed(true);
    // Reset the form state then open. Matches the manual openReturnDefect
    // path so the modal lands fresh, not with stale numbers from a
    // previous session.
    setDefectProduct(null);
    setDefectQty('');
    setDefectPurchasePrice('');
    setDefectNote('');
    setReturnDefectModalOpen(true);
    // Clear the route param so a focus event later in the lifecycle
    // doesn't re-trigger us. setParams is idempotent.
    navigation.setParams({ openDefectReturn: undefined });
    // Explicit dep list — we want to retry only on the props that
    // actually unlock the action.
  }, [openDefectReturn, defectReturnConsumed, supplier, defectWarehouse, navigation]);

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-defect-returns', id] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
      // Defect stock + general products list both shift when stock is
      // moved out → refresh both. Predicate match catches any
      // ['products', { … }] variant since we keyed by an object.
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      // Б/У warehouse contents — refreshed alongside, since
      // used-purchase mutations write into it. Per-warehouse folder
      // lists also need a refresh because we may have created a new
      // category as part of the purchase.
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] }),
      // Stock-movements feed (the warehouse-documents tab on the
      // journal). Used-purchase rows show up there immediately.
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] }),
    ]);

  const createDeliveryMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createDelivery(d),
    onSuccess: () => {
      invalidateAll();
      setDeliveryModalOpen(false);
      setDeliveryItems([]);
      setDeliveryComment('');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании поставки'),
  });

  const createPaymentMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createPayment(d),
    onSuccess: () => {
      invalidateAll();
      setPaymentModalOpen(false);
      setPaymentAmount('');
      setPaymentComment('');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании платежа'),
  });

  // Backend (POST /suppliers/:id/return-defect) does three things atomically:
  //  1) decrement defect-warehouse stock by qty,
  //  2) log a stock_movements row of type defect_return_to_supplier,
  //  3) reduce supplier debt by qty * purchasePrice via supplier_payments.
  // We just need to refresh caches that mirror any of those values.
  const returnDefectMutation = useMutation({
    mutationFn: (body: { productId: string; qty: number; purchasePrice: number; note?: string }) =>
      suppliersApi.returnDefect(id, body),
    onSuccess: (_data, vars) => {
      const debtReduction = vars.qty * vars.purchasePrice;
      invalidateAll();
      setReturnDefectModalOpen(false);
      setDefectProduct(null);
      setDefectQty('');
      setDefectPurchasePrice('');
      setDefectNote('');
      Alert.alert('Возврат оформлен', `Долг поставщику уменьшен на ${formatMoney(debtReduction)}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Не удалось оформить возврат';
      Alert.alert('Ошибка', String(msg));
    },
  });

  // Used-purchase mutation. Backend (POST /suppliers/:id/used-purchase)
  // atomically creates / increments the Б/У product, writes a
  // stock_movement with is_used_purchase=true, and grows the supplier's
  // debt by qty*price.
  const usedPurchaseMutation = useMutation({
    mutationFn: (body: Parameters<typeof suppliersApi.usedPurchase>[1]) => suppliersApi.usedPurchase(id, body),
    onSuccess: (_data, vars) => {
      const debtIncrease = vars.qty * vars.purchasePrice;
      invalidateAll();
      setUsedPurchaseModalOpen(false);
      setUpName('');
      setUpQty('');
      setUpPrice('');
      setUpSellPrice('');
      setUpCategory('');
      setUpNote('');
      Alert.alert(
        'Товар добавлен',
        `«${vars.productName}» (${vars.qty} шт) добавлен на склад Б/У.\nДолг вырос на ${formatMoney(debtIncrease)}.${
          vars.sellPrice == null || vars.sellPrice === 0
            ? '\nРозничная цена не задана — установите её позже на складе.'
            : ''
        }`,
      );
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Не удалось оформить покупку';
      Alert.alert('Ошибка', String(msg));
    },
  });

  const handleSubmitUsedPurchase = () => {
    const name = upName.trim();
    const qty = Number(upQty);
    const price = Number(upPrice);
    if (!name) {
      Alert.alert('Ошибка', 'Введите название товара');
      return;
    }
    if (!qty || qty <= 0) {
      Alert.alert('Ошибка', 'Укажите количество больше нуля');
      return;
    }
    if (!(price >= 0)) {
      Alert.alert('Ошибка', 'Укажите корректную закупочную цену');
      return;
    }
    // Sell price опционально: если пусто или 0 — отправляем sellPrice=null,
    // бэк сохранит null. Если число > 0 — валидируем и шлём.
    const sellPriceRaw = upSellPrice.trim();
    let sellPrice: number | undefined;
    if (sellPriceRaw) {
      const parsed = Number(sellPriceRaw);
      if (!isFinite(parsed) || parsed < 0) {
        Alert.alert('Ошибка', 'Укажите корректную розничную цену или оставьте поле пустым.');
        return;
      }
      sellPrice = parsed;
    }
    usedPurchaseMutation.mutate({
      productName: name,
      qty,
      purchasePrice: price,
      ...(sellPrice !== undefined ? { sellPrice } : {}),
      category: upCategory.trim() || undefined,
      note: upNote.trim() || undefined,
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await invalidateAll();
    setRefreshing(false);
  };

  const addProduct = (product: Product) => {
    const existing = deliveryItems.find((i) => i.productId === product.id);
    if (existing) {
      setDeliveryItems((prev) =>
        prev.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)),
      );
    } else {
      setDeliveryItems((prev) => [
        ...prev,
        { productId: product.id, productName: product.name, quantity: 1, price: product.costPrice || 0 },
      ]);
    }
  };

  const updateItemQty = (productId: string, delta: number) => {
    setDeliveryItems((prev) =>
      prev.map((i) => {
        if (i.productId !== productId) return i;
        const newQty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQty };
      }),
    );
  };

  const updateItemPrice = (productId: string, price: string) => {
    setDeliveryItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, price: Number(price) || 0 } : i)));
  };

  const removeItem = (productId: string) => {
    setDeliveryItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const deliveryTotal = deliveryItems.reduce((s, i) => s + i.quantity * i.price, 0);

  const handleCreateDelivery = () => {
    if (deliveryItems.length === 0) {
      Alert.alert('Ошибка', 'Добавьте хотя бы один товар');
      return;
    }
    createDeliveryMutation.mutate({
      supplierId: id,
      // Backdated invoices — send the chosen date as ISO. Backend honors
      // `date?: string`; omitting it would default to server "now".
      date: deliveryDate.toISOString(),
      comment: deliveryComment || undefined,
      items: deliveryItems.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
    });
  };

  const handleCreatePayment = () => {
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите сумму');
      return;
    }
    createPaymentMutation.mutate({
      supplierId: id,
      amount: amt,
      comment: paymentComment || undefined,
    });
  };

  const handlePayFullDebt = () => {
    if (!supplier || supplier.currentDebt <= 0) return;
    setPaymentAmount(String(supplier.currentDebt));
    setPaymentComment('');
    setPaymentModalOpen(true);
  };

  // Open the return-defect modal. If we don't yet know the defect
  // warehouse, tell the user instead of opening an empty picker.
  const openReturnDefect = () => {
    if (!defectWarehouse) {
      Alert.alert('Брак-склад не найден', 'Перенесите товар в склад брака, прежде чем оформлять возврат.');
      return;
    }
    setDefectProduct(null);
    setDefectQty('');
    setDefectPurchasePrice('');
    setDefectNote('');
    setReturnDefectModalOpen(true);
  };

  const onPickDefectProduct = (p: Product) => {
    setDefectProduct(p);
    // Pre-fill the editable inputs from the product. Backend can derive
    // purchase price itself, but pre-fill matches owner mental model.
    setDefectPurchasePrice(String(p.costPrice ?? 0));
    setDefectQty('1');
    setDefectPickerOpen(false);
    setTimeout(() => setReturnDefectModalOpen(true), 250);
  };

  const handleReturnDefect = () => {
    if (!defectProduct) {
      Alert.alert('Выберите товар', 'Сначала выберите товар из склада брака.');
      return;
    }
    const qty = Number(defectQty);
    const price = Number(defectPurchasePrice);
    if (!qty || qty <= 0) {
      Alert.alert('Ошибка', 'Укажите количество больше нуля.');
      return;
    }
    if (qty > defectProduct.stock) {
      Alert.alert('Недостаточно на складе', `На складе брака доступно ${defectProduct.stock} шт.`);
      return;
    }
    if (!(price >= 0)) {
      Alert.alert('Ошибка', 'Укажите корректную закупочную цену.');
      return;
    }
    returnDefectMutation.mutate({
      productId: defectProduct.id,
      qty,
      purchasePrice: price,
      note: defectNote || undefined,
    });
  };

  if (isLoading) return <LoadingSpinner />;
  if (!supplier)
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <Text style={{ padding: 20, textAlign: 'center', color: palette.text.primary }}>Поставщик не найден</Text>
      </View>
    );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Header subtitle is set only for the system used-purchase
          supplier — it explains the channel up-front and gives the
          screen a visually distinct header treatment without having
          to fork IosScreenHeader. Regular contractors keep the plain
          name title. */}
      <IosScreenHeader
        title={supplier.name}
        subtitle={isUsedPurchaseSupplier ? 'Приём б/у запчастей от клиентов: долг поставщику растёт' : undefined}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Stats cards */}
        <View style={styles.statsRow}>
          <AnimatedCard
            style={[
              styles.statCard,
              { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.subtle },
            ]}
            index={0}
          >
            <Ionicons name="cart-outline" size={16} color={colors.blue[600]} style={{ marginBottom: 2 }} />
            <Text style={[styles.statLabel, { color: palette.text.secondary }]}>Закупки</Text>
            <Text style={[styles.statValue, { color: palette.text.primary }]}>
              {formatMoney(supplier.totalPurchases)}
            </Text>
          </AnimatedCard>
          <AnimatedCard
            style={[
              styles.statCard,
              { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.subtle },
            ]}
            index={1}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.green[600]} style={{ marginBottom: 2 }} />
            <Text style={[styles.statLabel, { color: palette.text.secondary }]}>Оплачено</Text>
            <Text style={[styles.statValue, { color: palette.text.primary }]}>{formatMoney(supplier.totalPaid)}</Text>
          </AnimatedCard>
          <AnimatedCard
            style={[
              styles.statCard,
              { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.subtle },
            ]}
            index={2}
          >
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={supplier.currentDebt > 0 ? colors.red[600] : palette.text.tertiary}
              style={{ marginBottom: 2 }}
            />
            <Text style={[styles.statLabel, { color: palette.text.secondary }]}>Долг</Text>
            <Text
              style={[styles.statValue, { color: supplier.currentDebt > 0 ? colors.red[600] : palette.text.primary }]}
            >
              {formatMoney(supplier.currentDebt)}
            </Text>
          </AnimatedCard>
        </View>

        {/* Quick pay debt button */}
        {supplier.currentDebt > 0 && (
          <TouchableOpacity style={styles.quickPayBtn} onPress={handlePayFullDebt}>
            <Ionicons name="wallet-outline" size={18} color={colors.white} />
            <Text style={styles.quickPayText}>Погасить долг {formatMoney(supplier.currentDebt)}</Text>
          </TouchableOpacity>
        )}

        {isUsedPurchaseSupplier ? (
          // System "Покупка б/у товара" supplier — single primary CTA.
          // Standard delivery / return flows make no sense here: we
          // always buy from a client and the product lands on Б/У.
          // Recolour `quickPayBtn` (default = red, for debt pay-off) to
          // primary blue — same visual hierarchy, neutral semantics.
          <TouchableOpacity
            style={[styles.quickPayBtn, { backgroundColor: colors.primary[600] }]}
            onPress={() => {
              if (!usedWarehouse) {
                Alert.alert('Склад Б/У не найден', 'Подождите загрузку складов или обновите экран.');
                return;
              }
              setUpName('');
              setUpQty('');
              setUpPrice('');
              setUpSellPrice('');
              setUpCategory('');
              setUpNote('');
              setUsedPurchaseModalOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="cube-outline" size={18} color={colors.white} />
            <Text style={styles.quickPayText}>Купить б/у запчасть</Text>
          </TouchableOpacity>
        ) : (
          // Secondary action: return defective stock to supplier. Always
          // available — even when there's no current debt the action is
          // legitimate (it can drive the debt negative = supplier owes us).
          // Styled as a subdued pill (outline + amber tint) to stay below
          // the primary "Погасить долг" CTA in the visual hierarchy.
          <TouchableOpacity
            style={[
              styles.secondaryActionBtn,
              { borderColor: palette.border.subtle, backgroundColor: palette.bg.card },
            ]}
            onPress={openReturnDefect}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-undo-outline" size={16} color={colors.orange[600]} />
            <Text style={[styles.secondaryActionText, { color: palette.text.primary }]}>Возврат брака</Text>
          </TouchableOpacity>
        )}

        {/* Info */}
        {(supplier.phone || supplier.contactPerson) && (
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            {supplier.contactPerson && (
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={16} color={palette.text.tertiary} />
                <Text style={[styles.infoText, { color: palette.text.primary }]}>{supplier.contactPerson}</Text>
              </View>
            )}
            {supplier.phone && (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={16} color={palette.text.tertiary} />
                <Text style={[styles.infoText, { color: palette.text.primary }]}>{formatPhone(supplier.phone)}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Заказы поставщику ─────────────────────────────────────────
            Per-supplier purchase orders, integrated into the «Поставщики»
            section. Hidden for the system used-purchase channel (you never
            place a purchase order against it). «Новый заказ» prefills this
            supplier; «Сформировать запрос» opens a price-request seeded
            from this supplier's low-stock reorder suggestions. */}
        {!isUsedPurchaseSupplier && (
          <View style={[styles.ordersCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.ordersHeader}>
              <Ionicons name="clipboard-outline" size={16} color={colors.primary[600]} />
              <Text style={[styles.ordersTitle, { color: palette.text.primary }]}>Заказы</Text>
              {(supplierOrders?.length ?? 0) > 0 && (
                <View style={[styles.ordersCountBadge, { backgroundColor: palette.bg.muted }]}>
                  <Text style={[styles.ordersCountText, { color: palette.text.secondary }]}>
                    {supplierOrders!.length}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.ordersActions}>
              {canWriteOrders && (
                <TouchableOpacity
                  style={styles.ordersPrimaryBtn}
                  onPress={() => {
                    haptic('tap');
                    navigation.navigate('PurchaseOrderCreate', { supplierId: id });
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={18} color={colors.white} />
                  <Text style={styles.ordersPrimaryBtnText}>Новый заказ</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.ordersSecondaryBtn, { borderColor: palette.border.strong }]}
                onPress={() => {
                  haptic('tap');
                  setRequestOpen(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="chatbubbles-outline" size={16} color={colors.primary[600]} />
                <Text style={[styles.ordersSecondaryBtnText, { color: palette.text.primary }]}>
                  Сформировать запрос
                </Text>
              </TouchableOpacity>
            </View>

            {supplierOrders === undefined ? null : supplierOrders.length === 0 ? (
              <Text style={[styles.ordersEmpty, { color: palette.text.tertiary }]}>Заказов поставщику пока нет</Text>
            ) : (
              <View>
                {supplierOrders.slice(0, 6).map((po) => {
                  const meta = PO_STATUS_META[po.status];
                  return (
                    <TouchableOpacity
                      key={po.id}
                      style={[styles.orderRow, { borderTopColor: palette.border.subtle }]}
                      onPress={() => navigation.navigate('PurchaseOrderDetail', { id: po.id, po })}
                      activeOpacity={0.6}
                    >
                      <View style={[styles.orderStatusChip, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.orderStatusText, { color: meta.text }]}>{meta.label}</Text>
                      </View>
                      <Text style={[styles.orderMeta, { color: palette.text.secondary }]} numberOfLines={1}>
                        {po.itemCount ?? 0} поз. · {formatPoDate(po.createdAt)}
                      </Text>
                      <Text style={[styles.orderTotal, { color: palette.text.primary }]}>{formatMoney(po.total)}</Text>
                      <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
                    </TouchableOpacity>
                  );
                })}
                {supplierOrders.length > 6 && (
                  <Text style={[styles.ordersMore, { color: palette.text.tertiary }]}>
                    и ещё {supplierOrders.length - 6}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Tabs.
            • Regular contractor — three tabs: Поставки + Платежи + Возвраты.
            • System used-purchase supplier — only two: Покупки + Платежи.
              Returns tab is hidden entirely because defect returns
              don't apply to the used-purchase channel (no standard
              deliveries to return against). We also rename "Поставки"
              → "Покупки" for the system row — it matches the verb in
              the corresponding CTA above and avoids confusing the
              owner with terminology that implies a contractor flow.
            • If the active tab becomes invalid (was on 'returns' and
              the row is system), we silently switch the active tab in
              an effect just below this block. */}
        <View style={[styles.tabRow, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              tab === 'deliveries' && styles.tabBtnActive,
              tab === 'deliveries' && { backgroundColor: palette.bg.card },
            ]}
            onPress={() => setTab('deliveries')}
          >
            <Ionicons
              name="cube-outline"
              size={15}
              color={tab === 'deliveries' ? colors.primary[600] : palette.text.tertiary}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.tabText,
                { color: palette.text.secondary },
                tab === 'deliveries' && [styles.tabTextActive, { color: palette.text.primary }],
              ]}
            >
              {isUsedPurchaseSupplier ? 'Покупки' : 'Поставки'} ({deliveries?.length || 0})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              tab === 'payments' && styles.tabBtnActive,
              tab === 'payments' && { backgroundColor: palette.bg.card },
            ]}
            onPress={() => setTab('payments')}
          >
            <Ionicons
              name="cash-outline"
              size={15}
              color={tab === 'payments' ? colors.primary[600] : palette.text.tertiary}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.tabText,
                { color: palette.text.secondary },
                tab === 'payments' && [styles.tabTextActive, { color: palette.text.primary }],
              ]}
            >
              Платежи ({payments?.length || 0})
            </Text>
          </TouchableOpacity>
          {!isUsedPurchaseSupplier && (
            <TouchableOpacity
              style={[
                styles.tabBtn,
                tab === 'returns' && styles.tabBtnActive,
                tab === 'returns' && { backgroundColor: palette.bg.card },
              ]}
              onPress={() => setTab('returns')}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={15}
                color={tab === 'returns' ? colors.primary[600] : palette.text.tertiary}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: palette.text.secondary },
                  tab === 'returns' && [styles.tabTextActive, { color: palette.text.primary }],
                ]}
              >
                Возвраты ({defectReturns?.length || 0})
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {tab === 'deliveries' && (
          <>
            {/* Системный «Покупка б/у товара» поставщик ведёт свои поставки
                автоматически — мы не даём заводить их руками. Для него выше
                по экрану уже отрисован отдельный CTA «Покупка б/у товара»,
                эта кнопка тут только запутает. На обычных поставщиках
                ничего не меняется. */}
            {!isUsedPurchaseSupplier && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => {
                  setDeliveryItems([]);
                  setDeliveryComment('');
                  // Stamp fresh "today" each open — owner can backdate it
                  // inside the modal if they're entering a past invoice.
                  setDeliveryDate(new Date());
                  setDeliveryModalOpen(true);
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
                <Text style={styles.actionBtnText}>Новая поставка</Text>
              </TouchableOpacity>
            )}

            {(deliveries || []).length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="cube-outline" size={36} color={palette.text.tertiary} />
                <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
                  {isUsedPurchaseSupplier ? 'Нет покупок' : 'Нет поставок'}
                </Text>
                {!isUsedPurchaseSupplier && (
                  <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                    История всех операций сохраняется навсегда
                  </Text>
                )}
              </View>
            )}

            {(deliveries || []).map((d) => {
              const isExpanded = expandedDelivery === d.id;
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[
                    styles.deliveryCard,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                  onPress={() => setExpandedDelivery(isExpanded ? null : d.id)}
                  activeOpacity={0.7}
                >
                  {/* Left accent bar */}
                  {/* Subtle accent — only for fully paid (green); unpaid/partial
                      look neutral, reflecting our "all deliveries go on debt
                      by default and are settled in bulk" workflow. */}
                  <View
                    style={[
                      styles.deliveryAccent,
                      {
                        backgroundColor: d.paymentStatus === 'paid' ? colors.green[500] : 'transparent',
                      },
                    ]}
                  />
                  <View style={styles.deliveryContent}>
                    <View style={styles.deliveryTop}>
                      <View style={styles.deliveryTopLeft}>
                        <Text style={[styles.deliveryDate, { color: palette.text.primary }]}>{formatDate(d.date)}</Text>
                        {d.paymentStatus === 'paid' && (
                          <View style={[styles.statusBadge, styles.statusPaid]}>
                            <Ionicons name="checkmark-circle" size={13} color={colors.green[700]} />
                            <Text style={[styles.statusBadgeText, { color: colors.green[700] }]}>Оплачено</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.deliveryTopRight}>
                        <Text style={[styles.deliveryAmount, { color: palette.text.primary }]}>
                          {formatMoney(d.totalAmount)}
                        </Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.gray[400]}
                        />
                      </View>
                    </View>

                    {/* Item count summary */}
                    <Text style={[styles.itemsSummary, { color: palette.text.tertiary }]}>
                      {d.items.length} {d.items.length === 1 ? 'товар' : d.items.length < 5 ? 'товара' : 'товаров'}
                    </Text>

                    {/* Expanded items list */}
                    {isExpanded && (
                      <View style={[styles.expandedItems, { borderTopColor: palette.border.subtle }]}>
                        {d.items.map((item, idx) => (
                          <View key={idx} style={styles.expandedItemRow}>
                            <Text
                              style={[styles.expandedItemName, { color: palette.text.secondary }]}
                              numberOfLines={1}
                            >
                              {item.product?.name || '—'}
                            </Text>
                            <Text style={[styles.expandedItemQty, { color: palette.text.tertiary }]}>
                              {item.quantity} x {formatMoney(item.price)}
                            </Text>
                            <Text style={[styles.expandedItemTotal, { color: palette.text.secondary }]}>
                              {formatMoney(item.total)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {d.comment && (
                      <Text style={[styles.commentText, { color: palette.text.tertiary }]}>{d.comment}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {tab === 'payments' && (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setPaymentAmount('');
                setPaymentComment('');
                setPaymentModalOpen(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.actionBtnText}>Новый платёж</Text>
            </TouchableOpacity>

            {(payments || []).length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="cash-outline" size={36} color={palette.text.tertiary} />
                <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Нет платежей</Text>
                {!isUsedPurchaseSupplier && (
                  <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                    История всех операций сохраняется навсегда
                  </Text>
                )}
              </View>
            )}

            {(payments || []).map((p) => (
              <View
                key={p.id}
                style={[styles.paymentCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <View style={[styles.deliveryAccent, { backgroundColor: colors.green[500] }]} />
                <View style={styles.paymentContent}>
                  <View style={styles.paymentTop}>
                    <View>
                      <Text style={[styles.paymentDate, { color: palette.text.primary }]}>{formatDate(p.date)}</Text>
                      {p.comment && (
                        <Text style={[styles.commentText, { color: palette.text.tertiary }]}>{p.comment}</Text>
                      )}
                    </View>
                    <Text style={styles.paymentAmount}>{formatMoney(p.amount)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {tab === 'returns' && (
          <>
            {/* Возврат брака — только для обычных поставщиков. У системного
                «Покупка б/у» поставщика нет товаров с закупкой через
                стандартный flow, поэтому возвращать им нечего. */}
            {!isUsedPurchaseSupplier && (
              <TouchableOpacity style={styles.actionBtn} onPress={openReturnDefect}>
                <Ionicons name="arrow-undo-outline" size={18} color={colors.primary[600]} />
                <Text style={styles.actionBtnText}>Оформить возврат брака</Text>
              </TouchableOpacity>
            )}

            {(defectReturns || []).length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="arrow-undo-outline" size={36} color={palette.text.tertiary} />
                <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Возвратов нет</Text>
                <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                  История всех операций сохраняется навсегда
                </Text>
              </View>
            )}

            {(defectReturns || []).map((m) => {
              // qty in stock_movements is negative for outflows; we
              // render the absolute value because the "Возврат брака"
              // header already conveys direction.
              const qty = Math.abs(m.quantity);
              const debtReduction = qty * (m.product?.costPrice ?? 0);
              return (
                <View
                  key={m.id}
                  style={[styles.paymentCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <View style={[styles.deliveryAccent, { backgroundColor: colors.orange[500] }]} />
                  <View style={styles.paymentContent}>
                    <View style={styles.paymentTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.paymentDate, { color: palette.text.primary }]} numberOfLines={1}>
                          {m.product?.name || 'Товар удалён'}
                        </Text>
                        <Text style={[styles.commentText, { marginTop: 2, color: palette.text.tertiary }]}>
                          {formatDate(m.createdAt)} · {qty} шт
                        </Text>
                        {m.reason ? (
                          <Text style={[styles.commentText, { color: palette.text.tertiary }]}>{m.reason}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.paymentAmount, { color: colors.orange[600] }]}>
                          −{formatMoney(debtReduction)}
                        </Text>
                        <Text style={[styles.commentText, { marginTop: 0, color: palette.text.tertiary }]}>долг</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* New Delivery Modal */}
      <Modal visible={deliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} title="Новая поставка">
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={styles.addItemBtn}
            onPress={() => {
              setDeliveryModalOpen(false);
              setTimeout(() => setProductPickerOpen(true), 300);
            }}
          >
            <Ionicons name="add" size={18} color={colors.primary[600]} />
            <Text style={styles.addItemText}>Добавить товар</Text>
          </TouchableOpacity>

          {deliveryItems.map((item) => (
            <View key={item.productId} style={[styles.deliveryFormItem, { borderBottomColor: palette.border.subtle }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.itemName, { color: palette.text.primary }]} numberOfLines={1}>
                  {item.productName}
                </Text>
                <View style={styles.itemControls}>
                  <TouchableOpacity
                    onPress={() => updateItemQty(item.productId, -1)}
                    style={[styles.qtyBtn, { backgroundColor: palette.bg.muted }]}
                  >
                    <Ionicons name="remove" size={16} color={palette.text.secondary} />
                  </TouchableOpacity>
                  <Text style={[styles.qtyText, { color: palette.text.primary }]}>{item.quantity}</Text>
                  <TouchableOpacity
                    onPress={() => updateItemQty(item.productId, 1)}
                    style={[styles.qtyBtn, { backgroundColor: palette.bg.muted }]}
                  >
                    <Ionicons name="add" size={16} color={palette.text.secondary} />
                  </TouchableOpacity>
                  <Text style={[styles.timesSign, { color: palette.text.tertiary }]}>x</Text>
                  <TextInput
                    value={String(item.price)}
                    onChangeText={(v) => updateItemPrice(item.productId, v)}
                    style={[styles.priceInput, f.input]}
                    keyboardType="numeric"
                  />
                  <Text style={[styles.itemTotal, { color: palette.text.secondary }]}>
                    {formatMoney(item.quantity * item.price)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => removeItem(item.productId)} style={{ padding: 4 }}>
                <Ionicons name="close" size={18} color={colors.red[400]} />
              </TouchableOpacity>
            </View>
          ))}

          {deliveryItems.length > 0 && (
            <View style={[styles.deliveryTotalRow, { borderTopColor: palette.border.strong }]}>
              <Text style={[styles.deliveryTotalLabel, { color: palette.text.primary }]}>Итого:</Text>
              <Text style={styles.deliveryTotalValue}>{formatMoney(deliveryTotal)}</Text>
            </View>
          )}

          {/* Дата поставки — позволяет заводить накладные задним числом.
              По умолчанию сегодня; тап открывает календарь
              (DateTimePickerModal, тот же, что в Расходах/Кассе). */}
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Дата поставки</Text>
            <TouchableOpacity
              style={[styles.dateField, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => setDeliveryDatePickerOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.primary[600]} />
              <Text style={[styles.dateFieldText, { color: palette.text.primary }]}>
                {formatDate(deliveryDate.toISOString())}
              </Text>
              <Ionicons name="chevron-down" size={16} color={palette.text.tertiary} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>

          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Комментарий</Text>
            <TextInput
              value={deliveryComment}
              onChangeText={setDeliveryComment}
              style={[styles.formInput, f.input, { height: 50, textAlignVertical: 'top' }]}
              multiline
              placeholder="Необязательно"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </ScrollView>

        <View style={[styles.formActions, f.actions]}>
          <TouchableOpacity style={[styles.cancelBtn, f.cancel]} onPress={() => setDeliveryModalOpen(false)}>
            <Text style={[styles.cancelBtnText, f.cancelText]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreateDelivery}>
            {createDeliveryMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Создать</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delivery date picker — backdated invoices. Shares the same
          calendar component used across Расходы / Касса / Отчёты. */}
      <DateTimePickerModal
        visible={deliveryDatePickerOpen}
        value={deliveryDate}
        mode="date"
        onConfirm={(d) => {
          setDeliveryDate(d);
          setDeliveryDatePickerOpen(false);
        }}
        onCancel={() => setDeliveryDatePickerOpen(false)}
      />

      {/* Product Picker with folder navigation */}
      <ProductPickerModal
        visible={productPickerOpen}
        onClose={() => {
          setProductPickerOpen(false);
          setTimeout(() => setDeliveryModalOpen(true), 300);
        }}
        onSelectProduct={addProduct}
        title="Выберите товар"
        showCostPrice={true}
        getCartQty={(id) => deliveryItems.find((i) => i.productId === id)?.quantity || 0}
      />

      {/* New Payment Modal */}
      <Modal visible={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Новый платёж">
        {supplier.currentDebt > 0 && (
          <View style={styles.debtInfo}>
            <View>
              <Text style={styles.debtInfoLabel}>Текущий долг</Text>
              <Text style={styles.debtInfoValue}>{formatMoney(supplier.currentDebt)}</Text>
            </View>
            <TouchableOpacity style={styles.payFullBtn} onPress={() => setPaymentAmount(String(supplier.currentDebt))}>
              <Text style={styles.payFullBtnText}>Весь долг</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.formField}>
          <Text style={[styles.formLabel, f.label]}>Сумма *</Text>
          <TextInput
            value={paymentAmount}
            onChangeText={setPaymentAmount}
            style={[styles.formInput, f.input]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, f.label]}>Комментарий</Text>
          <TextInput
            value={paymentComment}
            onChangeText={setPaymentComment}
            style={[styles.formInput, f.input, { height: 50, textAlignVertical: 'top' }]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={[styles.formActions, f.actions]}>
          <TouchableOpacity style={[styles.cancelBtn, f.cancel]} onPress={() => setPaymentModalOpen(false)}>
            <Text style={[styles.cancelBtnText, f.cancelText]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreatePayment}>
            {createPaymentMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Оплатить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Used-purchase modal — owner types a free-form product name +
          qty + price + optional folder. Backend auto-creates or
          increments the matching Б/У SKU and grows supplier debt. */}
      <Modal
        visible={usedPurchaseModalOpen}
        onClose={() => setUsedPurchaseModalOpen(false)}
        title="Покупка б/у запчасти"
      >
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          {/* Informational chip — owner needs to know the financial
              side of this action ends up in the «Покупка товара»
              expenses bucket. Backend handles the bookkeeping; UI
              just makes that contract visible so there's no surprise
              when reviewing expenses. */}
          <View
            style={[styles.expenseNotice, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.primary[600]} />
            <Text style={[styles.expenseNoticeText, { color: palette.text.secondary }]}>
              Эта покупка автоматически попадёт в расходы в категорию «Покупка товара».
            </Text>
          </View>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Название товара *</Text>
            <TextInput
              value={upName}
              onChangeText={setUpName}
              style={[styles.formInput, f.input]}
              placeholder="Например: Капот"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Количество *</Text>
            <TextInput
              value={upQty}
              onChangeText={setUpQty}
              style={[styles.formInput, f.input]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Закупочная цена, ₽ *</Text>
            <TextInput
              value={upPrice}
              onChangeText={setUpPrice}
              style={[styles.formInput, f.input]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          {/* Sell price — опционально. Если оставить пустым, бэк
              запишет sellPrice=null, и в ProductsScreen Б/У-складе
              появится CTA «Установить цену» на этой карточке. */}
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Розничная цена, ₽</Text>
            <TextInput
              value={upSellPrice}
              onChangeText={setUpSellPrice}
              style={[styles.formInput, f.input]}
              keyboardType="numeric"
              placeholder="Необязательно — задайте позже"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
              Если не заполнено, цена будет{' '}
              {Number(upPrice) > 0 ? `≈ ${formatMoney(Number(upPrice))} (= закупочной)` : 'не установлена'}.{'\n'}
              Установите её позже на складе Б/У.
            </Text>
          </View>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Папка на складе Б/У</Text>
            <TextInput
              value={upCategory}
              onChangeText={setUpCategory}
              style={[styles.formInput, f.input]}
              placeholder="Необязательно"
              placeholderTextColor={palette.text.tertiary}
            />
            {usedCategories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: spacing[2] }}
                contentContainerStyle={{ gap: spacing[2] }}
                keyboardShouldPersistTaps="handled"
              >
                {usedCategories.slice(0, 16).map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryChip,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      upCategory === cat.path && styles.categoryChipActive,
                    ]}
                    onPress={() => setUpCategory(cat.path)}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        { color: palette.text.secondary },
                        upCategory === cat.path && styles.categoryChipTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {cat.path}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {Number(upQty) > 0 && Number(upPrice) >= 0 ? (
            <View style={[styles.defectTotalRow, { borderTopColor: palette.border.subtle }]}>
              <Text style={[styles.defectTotalLabel, { color: palette.text.primary }]}>Долг вырастет на:</Text>
              <Text style={[styles.defectTotalValue, { color: colors.red[600] }]}>
                +{formatMoney(Number(upQty) * Number(upPrice))}
              </Text>
            </View>
          ) : null}

          <View style={styles.formField}>
            <Text style={[styles.formLabel, f.label]}>Комментарий</Text>
            <TextInput
              value={upNote}
              onChangeText={setUpNote}
              style={[styles.formInput, f.input, { height: 50, textAlignVertical: 'top' }]}
              multiline
              placeholder="Необязательно"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </ScrollView>

        <View style={[styles.formActions, f.actions]}>
          <TouchableOpacity style={[styles.cancelBtn, f.cancel]} onPress={() => setUsedPurchaseModalOpen(false)}>
            <Text style={[styles.cancelBtnText, f.cancelText]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitUsedPurchase}>
            {usedPurchaseMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Добавить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Return defective stock modal */}
      <Modal visible={returnDefectModalOpen} onClose={() => setReturnDefectModalOpen(false)} title="Возврат брака">
        {/* Picker trigger — same UX as the delivery flow's "Добавить товар" */}
        <TouchableOpacity
          style={[styles.addItemBtn, { marginBottom: spacing[3] }]}
          onPress={() => {
            setReturnDefectModalOpen(false);
            setTimeout(() => setDefectPickerOpen(true), 250);
          }}
        >
          <Ionicons name={defectProduct ? 'swap-horizontal' : 'cube-outline'} size={18} color={colors.primary[600]} />
          <Text style={styles.addItemText}>
            {defectProduct ? `Товар: ${defectProduct.name}` : 'Выбрать товар из брака'}
          </Text>
        </TouchableOpacity>

        {defectProduct ? (
          <View
            style={[styles.defectInfoBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <View style={styles.defectInfoRow}>
              <Text style={[styles.defectInfoLabel, { color: palette.text.tertiary }]}>На складе брака</Text>
              <Text style={[styles.defectInfoValue, { color: palette.text.primary }]}>{defectProduct.stock} шт</Text>
            </View>
            <View style={styles.defectInfoRow}>
              <Text style={[styles.defectInfoLabel, { color: palette.text.tertiary }]}>Закупочная (по умолчанию)</Text>
              <Text style={[styles.defectInfoValue, { color: palette.text.primary }]}>
                {formatMoney(defectProduct.costPrice ?? 0)}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.formField}>
          <Text style={[styles.formLabel, f.label]}>Количество *</Text>
          <TextInput
            value={defectQty}
            onChangeText={setDefectQty}
            style={[styles.formInput, f.input]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            editable={!!defectProduct}
          />
          {defectProduct && defectProduct.stock > 0 ? (
            <Text style={[styles.defectHint, { color: palette.text.tertiary }]}>
              Максимум: {defectProduct.stock} шт
            </Text>
          ) : null}
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, f.label]}>Закупочная цена, ₽ *</Text>
          <TextInput
            value={defectPurchasePrice}
            onChangeText={setDefectPurchasePrice}
            style={[styles.formInput, f.input]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            editable={!!defectProduct}
          />
        </View>

        {/* Live preview of the resulting debt reduction. Keeps the owner
            confident before they hit confirm. */}
        {defectProduct && Number(defectQty) > 0 && Number(defectPurchasePrice) >= 0 ? (
          <View style={[styles.defectTotalRow, { borderTopColor: palette.border.subtle }]}>
            <Text style={[styles.defectTotalLabel, { color: palette.text.primary }]}>Уменьшение долга:</Text>
            <Text style={[styles.defectTotalValue, { color: colors.orange[600] }]}>
              −{formatMoney(Number(defectQty) * Number(defectPurchasePrice))}
            </Text>
          </View>
        ) : null}

        <View style={styles.formField}>
          <Text style={[styles.formLabel, f.label]}>Комментарий</Text>
          <TextInput
            value={defectNote}
            onChangeText={setDefectNote}
            style={[styles.formInput, f.input, { height: 50, textAlignVertical: 'top' }]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={[styles.formActions, f.actions]}>
          <TouchableOpacity style={[styles.cancelBtn, f.cancel]} onPress={() => setReturnDefectModalOpen(false)}>
            <Text style={[styles.cancelBtnText, f.cancelText]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleReturnDefect}>
            {returnDefectMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Подтвердить возврат</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Defect-warehouse-scoped product picker. Different from the
          deliveries picker (which uses ProductPickerModal + folder
          navigation) because we already know the warehouse and want a
          flat searchable list of what's available to return. */}
      <DefectProductPickerModal
        visible={defectPickerOpen}
        onClose={() => {
          setDefectPickerOpen(false);
          setTimeout(() => setReturnDefectModalOpen(true), 250);
        }}
        products={defectProducts}
        onSelect={onPickDefectProduct}
        palette={palette}
      />

      {/* «Сформировать запрос» — price-request text (no prices) for THIS
          supplier, seeded from its low-stock reorder suggestions. */}
      <SupplierRequestSheet
        visible={requestOpen}
        onClose={() => setRequestOpen(false)}
        supplierName={supplier.name}
        supplierPhone={supplier.phone}
        lines={requestLines}
      />
    </View>
  );
}

// ── DefectProductPickerModal ──────────────────────────────────────────
// Lightweight searchable picker scoped to products that already live
// in the defect warehouse. Kept inside this file because it's
// supplier-specific UX and reuses the same <Modal> shell.
function DefectProductPickerModal({
  visible,
  onClose,
  products,
  onSelect,
  palette,
}: {
  visible: boolean;
  onClose: () => void;
  products: Product[];
  onSelect: (p: Product) => void;
  palette: ReturnType<typeof useColors>;
}) {
  const [q, setQ] = useState('');
  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : products;
  return (
    <Modal visible={visible} onClose={onClose} title="Товары на складе брака">
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Поиск по названию"
        placeholderTextColor={palette.text.tertiary}
        style={[
          styles.formInput,
          {
            marginBottom: spacing[3],
            backgroundColor: palette.bg.muted,
            borderColor: palette.border.subtle,
            color: palette.text.primary,
          },
        ]}
      />
      {filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="cube-outline" size={36} color={palette.text.tertiary} />
          <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>На складе брака ничего нет</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          {filtered.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.defectPickerRow, { borderBottomColor: palette.border.subtle }]}
              onPress={() => onSelect(p)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.defectPickerName, { color: palette.text.primary }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[styles.defectPickerSub, { color: palette.text.tertiary }]}>
                  {p.stock} шт · {formatMoney(p.costPrice ?? 0)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[2] },
  statCard: { flex: 1, borderRadius: borderRadius.xl, padding: spacing[3] },
  statLabel: { fontSize: 11, fontWeight: fontWeight.semibold },
  statValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginTop: 2 },
  // Quick pay
  quickPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.red[500],
  },
  quickPayText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  // Subdued pill — sits below the primary CTA in the visual hierarchy.
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  secondaryActionText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  // Return-defect form helpers
  defectInfoBox: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[4],
    gap: 4,
  },
  defectInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  defectInfoLabel: { fontSize: fontSize.xs },
  defectInfoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  defectHint: { fontSize: 11, marginTop: spacing[1] },
  defectTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    marginBottom: spacing[3],
  },
  defectTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  defectTotalValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  defectPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  defectPickerName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  defectPickerSub: { fontSize: 11, marginTop: 2 },
  // Info card
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1.5] },
  infoText: { fontSize: fontSize.sm, color: colors.gray[700] },
  // ── Per-supplier «Заказы» block ─────────────────────────────────────
  ordersCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    gap: spacing[3],
  },
  ordersHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  ordersTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  ordersCountBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    minWidth: 22,
    alignItems: 'center',
  },
  ordersCountText: { fontSize: 12, fontWeight: '700' },
  ordersActions: { flexDirection: 'row', gap: spacing[2] },
  ordersPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
  },
  ordersPrimaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  ordersSecondaryBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  ordersSecondaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  ordersEmpty: { fontSize: 13, textAlign: 'center', paddingVertical: spacing[2] },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  orderStatusChip: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  orderStatusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },
  orderMeta: { flex: 1, minWidth: 0, fontSize: 12 },
  orderTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  ordersMore: { fontSize: 12, textAlign: 'center', paddingTop: spacing[2] },
  // Tabs
  tabRow: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: borderRadius.xl, padding: 3 },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabTextActive: { color: colors.gray[900], fontWeight: fontWeight.semibold },
  // Action button
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderStyle: 'dashed',
    backgroundColor: colors.primary[50],
  },
  actionBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: spacing[8] },
  emptyText: { fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] },
  // Subtle footnote under an empty state — reminds the owner that
  // even after a debt is closed nothing here will be removed. Sits
  // below the primary message in a smaller weight.
  emptyHint: {
    fontSize: 12,
    color: colors.gray[400],
    marginTop: spacing[1],
    textAlign: 'center',
    paddingHorizontal: spacing[6],
    lineHeight: 16,
  },
  // Soft info banner inside the used-purchase modal — surfaces the
  // expenses-bookkeeping side-effect that's invisible from the form
  // itself.
  expenseNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[4],
  },
  expenseNoticeText: {
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
  // Delivery card with accent bar
  deliveryCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.gray[100],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  deliveryAccent: { width: 3.5 },
  deliveryContent: { flex: 1, padding: spacing[3] },
  deliveryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  deliveryTopLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  deliveryTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  deliveryDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deliveryAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  statusPaid: { backgroundColor: colors.green[50] },
  statusPartial: { backgroundColor: colors.yellow[50] },
  statusUnpaid: { backgroundColor: colors.red[50] },
  statusBadgeText: { fontSize: 10, fontWeight: fontWeight.semibold },
  itemsSummary: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1.5] },
  expandedItems: { marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[100] },
  expandedItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[1.5] },
  expandedItemName: { flex: 1, fontSize: fontSize.xs, color: colors.gray[700] },
  expandedItemQty: { fontSize: fontSize.xs, color: colors.gray[400], marginHorizontal: spacing[2] },
  expandedItemTotal: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    minWidth: 60,
    textAlign: 'right',
  },
  commentText: { fontSize: fontSize.xs, color: colors.gray[400], fontStyle: 'italic', marginTop: spacing[1.5] },
  // Payments
  paymentCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.gray[100],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  paymentContent: { flex: 1, padding: spacing[3] },
  paymentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  paymentAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
  // Delivery form
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[300],
    borderStyle: 'dashed',
    backgroundColor: colors.primary[50],
    marginBottom: spacing[3],
  },
  addItemText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  // Date field — tappable row that opens the calendar picker. Styled
  // like a read-only input so it reads as part of the form.
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
  },
  dateFieldText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  deliveryFormItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  itemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 4 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    minWidth: 20,
    textAlign: 'center',
  },
  timesSign: { color: colors.gray[400], fontSize: fontSize.sm },
  priceInput: {
    width: 60,
    height: 28,
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    fontSize: fontSize.xs,
    color: colors.gray[900],
    textAlign: 'center',
  },
  itemTotal: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  deliveryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderTopWidth: 2,
    borderTopColor: colors.gray[200],
    marginBottom: spacing[3],
  },
  deliveryTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deliveryTotalValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.primary[600] },
  // Payment form
  debtInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.red[50],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[4],
  },
  debtInfoLabel: { fontSize: fontSize.xs, color: colors.red[500] },
  debtInfoValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.red[700] },
  payFullBtn: {
    backgroundColor: colors.red[500],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.lg,
  },
  payFullBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
  // Form common
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
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  // Suggestion chips for existing Б/У folder paths — used in the used
  // purchase modal so the owner doesn't retype folder names. Free-text
  // input still wins; chips just fill the input on tap.
  categoryChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.gray[50],
  },
  categoryChipActive: {
    borderColor: colors.primary[600],
    backgroundColor: colors.primary[50],
  },
  categoryChipText: { fontSize: 12, color: colors.gray[700], fontWeight: fontWeight.medium },
  categoryChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
});
