import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Minus, Truck, CreditCard, Package, User, Trash2, Undo2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { suppliersApi, productsApi, stockMovementsApi, warehousesApi, warehouseCategoriesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Money,
  PageHeader,
  QueryState,
  SkeletonCard,
  StatCard,
  TabPanel,
  Tabs,
  Textarea,
  Toolbar,
  cn,
  focusRing,
} from '../ui';
import type { DataTableColumn, TabItem } from '../ui';
import PhoneInput from '../components/PhoneInput';
import ProductPickerDrawer from '../components/warehouse/ProductPickerDrawer';
import type {
  Supplier,
  Delivery,
  SupplierPayment,
  Product,
  PaginatedResponse,
  StockMovement,
  Warehouse,
} from '../types';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { formatPhone } from '../../../shared/validation/phone';
import { formatQty, unitLabel } from '../utils/units';
import { parseNumberInput } from '../components/warehouse/format';
import { useUrlParams } from '../components/warehouse/useUrlParams';
import type { PurchaseReceiptContext, SupplierReturn } from '../../../shared/types';
import { useProcurementRecovery } from '../hooks/useProcurementRecovery';
import { ProcurementRecoveryPanel } from '../components/ProcurementRecoveryPanel';
import { parseReturnQuantity, sumReceiptLineCents } from '../../../shared/utils/procurementInput';

type TabType = 'deliveries' | 'payments' | 'returns';

interface SupplierFormData {
  name: string;
  phone: string;
  contactPerson: string;
  comment: string;
}

interface DeliveryItemForm {
  productId: string;
  quantity: number;
  /** Цена за единицу — строка ввода («12,5» печатается чисто), число — при отправке. */
  price: string;
  sellPrice: string;
}

interface DeliveryFormData {
  date: string;
  items: DeliveryItemForm[];
  comment: string;
}

interface PaymentFormData {
  amount: string;
  date: string;
  comment: string;
  /** 149 — «за какой месяц» платёж ('YYYY-MM'). Дефолт — текущий месяц. */
  periodMonth: string;
}

const fmtDay = (iso: string) => format(new Date(iso), 'd MMM yyyy', { locale: ru });
const itemPrice = (item: DeliveryItemForm) => parseNumberInput(item.price) ?? 0;

/** Массив из ответа, который может быть и списком, и постраничным конвертом. */
function asList<T>(d: T[] | PaginatedResponse<T>): T[] {
  return Array.isArray(d) ? d : d?.data || [];
}

function paymentStatusBadge(status: Delivery['paymentStatus']) {
  // Поставки уходят в долг и гасятся оптом — «не оплачено» не кричит, а
  // спокойно подписано; оплаченное и частичное выделяем тоном.
  switch (status) {
    case 'paid':
      return (
        <Badge tone="ok" dot>
          Оплачена
        </Badge>
      );
    case 'partial':
      return (
        <Badge tone="warn" dot>
          Частично
        </Badge>
      );
    default:
      return <span className="text-ink-3">в долг</span>;
  }
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const recovery = useProcurementRecovery({ contextId: id });
  // ROLE-ONLY: редактирование поставщика + приход/оплата/возврат/б/у-закупка —
  // только с suppliers_manage (байпас superadmin/director — внутри
  // hasPermission; admin — по матрице роли). Просмотр — suppliers_access.
  const canManage = hasPermission('suppliers_manage');
  // Календарь АВТОСЕРВИСА для дат-дефолтов форм прихода и оплаты (157).
  const { today: tenantToday, month: tenantMonth } = useTenantCalendar();
  // Round 14: сторно платежа + «Возврат от поставщика» — ОТДЕЛЬНАЯ галка
  // suppliers_payments_correct (manage её НЕ влечёт; сид — только Директор).
  // Сервер дублирует проверку на POST payments/:id/reverse и payments/refund.
  const canCorrectPayments = hasPermission('suppliers_payments_correct');

  // Вкладка — в URL (?tab=payments), чтобы F5 и «Назад» возвращали на неё.
  const [params, setParam] = useUrlParams();
  const tabParam = params.get('tab');
  const activeTab: TabType = tabParam === 'payments' || tabParam === 'returns' ? tabParam : 'deliveries';

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  // Возврат от поставщика (Round 14) — модал по образцу «Новая оплата».
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: '', comment: '' });
  // Сторно платежа (Round 14) — confirm-модал с полем причины.
  const [reverseTarget, setReverseTarget] = useState<SupplierPayment | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [deliveryReturnId, setDeliveryReturnId] = useState<string | null>(null);
  const [deliveryReturnReason, setDeliveryReturnReason] = useState('');
  const [deliveryReturnQty, setDeliveryReturnQty] = useState<Record<string, string>>({});
  const [showReturnPicker, setShowReturnPicker] = useState(false);
  // Used-purchase ("Покупка б/у товара") modal state. Only meaningful
  // when the current supplier has kind='used_purchase'.
  const [isUsedPurchaseModalOpen, setIsUsedPurchaseModalOpen] = useState(false);
  const [usedPurchaseForm, setUsedPurchaseForm] = useState({
    productName: '',
    qty: '',
    purchasePrice: '',
    category: '',
    note: '',
  });

  // ── Данные ──────────────────────────────────────────────────────────────────
  // Все queryFn кладут в кеш ТЕЛО ответа, а не axios-ответ: ключи 'products' и
  // 'warehouse-categories' — в whitelist persistent-кеша, а сырой ответ
  // (функции в config, XHR в request) не проходит structured clone и ронял
  // сохранение снимка целиком. ['warehouses'] — та же форма, что на Складе.
  const {
    data: supplier,
    isLoading,
    isError,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => (await suppliersApi.getById(id as string)).data as Supplier,
    enabled: !!id,
    retry: 1,
    staleTime: 30_000,
  });

  // If supplier returns 404, invalidate the list cache so stale entries are removed
  useEffect(() => {
    if (isError && (error as any)?.response?.status === 404) {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    }
  }, [isError, error, queryClient]);

  const deliveriesQuery = useQuery({
    queryKey: ['supplier-deliveries', id],
    queryFn: async () => asList<Delivery>((await suppliersApi.getDeliveries({ supplierId: id })).data),
    enabled: !!id,
  });
  const deliveries: Delivery[] = deliveriesQuery.data || [];

  const deliveryForReturnQuery = useQuery<Delivery>({
    queryKey: ['supplier-delivery-return-source', deliveryReturnId],
    queryFn: async () => (await suppliersApi.getDeliveryById(deliveryReturnId as string)).data,
    enabled: !!deliveryReturnId,
    staleTime: 0,
  });
  const supplierDocumentReturnsQuery = useQuery<SupplierReturn[]>({
    queryKey: ['supplier-financial-returns', id],
    queryFn: async () => (await suppliersApi.getReturns({ supplierId: id })).data,
    enabled: !!id,
    staleTime: 30_000,
  });

  const paymentsQuery = useQuery({
    queryKey: ['supplier-payments', id],
    queryFn: async () => asList<SupplierPayment>((await suppliersApi.getPayments({ supplierId: id })).data),
    enabled: !!id,
  });
  const payments: SupplierPayment[] = paymentsQuery.data || [];

  // Products for delivery items. Shares the standard ['products'] cache key
  // with ProductsPage so mutations (create/delete/import) automatically
  // invalidate this too — picker always reflects current warehouse.
  // refetchOnMount: 'always' guarantees a fresh load every time the modal
  // opens, eliminating the "sometimes empty" bug when cache was stale.
  const productsQuery = useQuery({
    queryKey: ['products', 'all', 5000],
    queryFn: async () => asList<Product>((await productsApi.getAll({ limit: 5000 })).data),
    enabled: isDeliveryModalOpen || showDeliveryPicker,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const products: Product[] = productsQuery.data || [];

  // Warehouses — used to find the defect warehouse for return-to-supplier
  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });
  const warehouses: Warehouse[] = warehousesData || [];
  const defectWarehouse = warehouses.find((w) => w.kind === 'defect');
  const usedWarehouse = warehouses.find((w) => w.kind === 'used');
  // System supplier → swap deliveries / returns actions for a single
  // primary "Покупка б/у товара" CTA. We never let the user manually
  // record deliveries or returns against this row.
  const isUsedPurchaseSupplier = supplier?.kind === 'used_purchase';

  // Existing folders inside the Б/У warehouse — surfaced as quick-pick
  // chips so the user doesn't retype folder names.
  const { data: usedCategoriesData } = useQuery({
    queryKey: ['warehouse-categories', { warehouseId: usedWarehouse?.id }],
    queryFn: async () => (await warehouseCategoriesApi.getAll(usedWarehouse?.id as string)).data,
    enabled: !!usedWarehouse?.id && isUsedPurchaseSupplier,
    staleTime: 60_000,
  });
  const usedCategories: Array<{ id: string; path: string; sort_order: number }> = Array.isArray(usedCategoriesData)
    ? usedCategoriesData
    : [];

  // Defect-stock products picker (only items currently in defect warehouse)
  const defectProductsQuery = useQuery({
    queryKey: ['products', 'defect', defectWarehouse?.id],
    queryFn: async () =>
      asList<Product>((await productsApi.getAll({ limit: 5000, warehouseId: defectWarehouse?.id as string })).data),
    enabled: !!defectWarehouse?.id && (isReturnModalOpen || showReturnPicker),
    staleTime: 30_000,
  });
  const defectProducts: Product[] = defectProductsQuery.data || [];

  // Defect-return history for this supplier
  const returnsQuery = useQuery({
    queryKey: ['supplier-returns', id],
    queryFn: async () => {
      const res = await stockMovementsApi.list({ type: 'defect_return_to_supplier' });
      return (res.data || []).filter((m: StockMovement) => m.supplierId === id);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
  const returns: StockMovement[] = returnsQuery.data || [];

  // ── Редактирование поставщика ───────────────────────────────────────────────
  const [editForm, setEditForm] = useState<SupplierFormData>({
    name: '',
    phone: '',
    contactPerson: '',
    comment: '',
  });

  const openEditModal = () => {
    if (!supplier) return;
    setEditForm({
      name: supplier.name,
      phone: supplier.phone || '',
      contactPerson: supplier.contactPerson || '',
      comment: supplier.comment || '',
    });
    setIsEditModalOpen(true);
  };

  const updateMutation = useMutation({
    mutationFn: (data: SupplierFormData) => suppliersApi.update(id as string, data),
    onSuccess: () => {
      toast.success('Поставщик обновлён');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setIsEditModalOpen(false);
    },
    onError: () => toast.error('Ошибка при обновлении'),
  });

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      toast.error('Введите название');
      return;
    }
    updateMutation.mutate(editForm);
  };

  // ── Поставка ───────────────────────────────────────────────────────────────
  const emptyDeliveryForm: DeliveryFormData = {
    // Дата по умолчанию — сегодня У АВТОСЕРВИСА (157), не у браузера: дата
    // уезжает на сервер как есть, а он считает сутки поясом тенанта — поставка,
    // оформленная поздним вечером из другого региона, вставала на чужой день.
    date: tenantToday,
    items: [],
    comment: '',
  };
  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormData>(emptyDeliveryForm);

  const deliveryProductIdsKey = [...new Set(deliveryForm.items.map((item) => item.productId))].sort().join(',');
  const deliveryPurchaseContext = useQuery<PurchaseReceiptContext[]>({
    queryKey: ['supplier-purchase-context', deliveryProductIdsKey, deliveryForm.date],
    enabled: isDeliveryModalOpen && !!deliveryProductIdsKey && !!deliveryForm.date,
    queryFn: async () => {
      const ids = deliveryProductIdsKey.split(',').filter(Boolean);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
      const all: PurchaseReceiptContext[] = [];
      for (const chunk of chunks) all.push(...(await suppliersApi.purchaseContext(chunk, deliveryForm.date)).data);
      return all;
    },
    staleTime: 0,
  });
  const deliveryContextByProduct = new Map(
    (deliveryPurchaseContext.data ?? []).map((context) => [context.productId, context]),
  );

  const openDeliveryModal = () => {
    setDeliveryForm(emptyDeliveryForm);
    setIsDeliveryModalOpen(true);
  };

  const handleDeliveryProductSelected = (product: Product) => {
    setDeliveryForm((prev) => {
      const existing = prev.items.findIndex((i) => i.productId === product.id);
      if (existing !== -1) {
        const updated = [...prev.items];
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 };
        return { ...prev, items: updated };
      }
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            productId: product.id,
            quantity: 1,
            price: String(product.costPrice ?? 0),
            sellPrice: product.sellPrice == null ? '' : String(product.sellPrice),
          },
        ],
      };
    });
  };

  const removeDeliveryItem = (index: number) => {
    setDeliveryForm({ ...deliveryForm, items: deliveryForm.items.filter((_, i) => i !== index) });
  };

  const updateDeliveryItem = (index: number, patch: Partial<DeliveryItemForm>) => {
    const updated = [...deliveryForm.items];
    updated[index] = { ...updated[index], ...patch };
    setDeliveryForm({ ...deliveryForm, items: updated });
  };

  const createDeliveryMutation = useMutation({
    mutationFn: (data: Parameters<typeof suppliersApi.createDelivery>[0]) =>
      recovery.execute<{ id: string }>({ operation: 'delivery-create', sourceId: id as string, contextId: id }, data),
    onSuccess: (res) => {
      if (!recovery.owns(res)) return;

      toast.success('Поставка создана');
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setIsDeliveryModalOpen(false);
    },
    onError: (err: any) => {
      if (!recovery.owns(err)) return;
      if (err?.code) {
        toast.error(err.message);
        return;
      }

      const status = err?.response?.status;
      toast.error(
        status === 409
          ? 'Ключ операции уже использован с другими данными. Проверьте список поставок.'
          : /остат|склад|количеств/i.test(String(err?.response?.data?.message ?? ''))
            ? 'Остаток товара изменился. Обновите склад и проверьте поставку.'
            : 'Не удалось создать поставку. Поля сохранены; повторите отправку без изменений.',
      );
    },
  });

  const deliveryReturnMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      requestId?: string;
      reason: string;
      items: Array<{ deliveryItemId: string; quantity: number }>;
    }) =>
      recovery.execute<Awaited<ReturnType<typeof suppliersApi.returnDelivery>>['data']>(
        { operation: 'delivery-return', sourceId: vars.id, contextId: id },
        { reason: vars.reason, items: vars.items },
      ),
    onSuccess: (res) => {
      if (!recovery.owns(res)) return;

      toast.success('Возврат поставщику оформлен. Исходная поставка сохранена в истории.');
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-delivery-return-source', deliveryReturnId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-financial-returns', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      setDeliveryReturnId(null);
    },
    onError: (err: any) => {
      if (!recovery.owns(err)) return;
      if (err?.code) {
        toast.error(err.message);
        return;
      }

      toast.error(
        err?.response?.status === 409
          ? 'Ключ операции уже связан с другими данными. Проверьте историю возвратов.'
          : /остат|склад|количеств/i.test(String(err?.response?.data?.message ?? ''))
            ? 'Недостаточно остатка для возврата. Проверьте актуальное наличие.'
            : 'Возврат не подтверждён. Поля сохранены; повторите с теми же значениями.',
      );
    },
  });

  const openDeliveryReturn = useCallback((deliveryId: string) => {
    setDeliveryReturnQty({});
    setDeliveryReturnReason('');

    setDeliveryReturnId(deliveryId);
  }, []);

  useEffect(() => {
    const sourceId = params.get('returnDeliveryId');
    if (!sourceId || !canManage || isUsedPurchaseSupplier) return;
    openDeliveryReturn(sourceId);
    setParam({ returnDeliveryId: null, tab: 'deliveries' }, { replace: true });
  }, [params, canManage, isUsedPurchaseSupplier, setParam, openDeliveryReturn]);

  const submitDeliveryReturn = (event: FormEvent) => {
    event.preventDefault();
    const source = deliveryForReturnQuery.data;
    if (!source || !deliveryReturnId || deliveryReturnMutation.isPending) return;
    const invalidLine = source.items.find((line) => {
      const raw = deliveryReturnQty[line.id] ?? '';
      return raw.trim() !== '' && parseReturnQuantity(raw, line.returnableQuantity ?? 0) === null;
    });
    if (invalidLine) {
      toast.error('Укажите количество не больше доступного остатка и не более чем с 3 знаками после запятой');
      return;
    }
    const items = source.items.flatMap((line) => {
      const quantity = parseReturnQuantity(deliveryReturnQty[line.id] ?? '', line.returnableQuantity ?? 0);
      return quantity ? [{ deliveryItemId: line.id, quantity }] : [];
    });
    if (!items.length || !deliveryReturnReason.trim()) {
      toast.error('Выберите количество возврата и укажите причину');
      return;
    }
    const payload = { id: deliveryReturnId, reason: deliveryReturnReason.trim(), items };
    deliveryReturnMutation.mutate({ ...payload });
  };

  const deliveryTotal =
    sumReceiptLineCents(deliveryForm.items.map((item) => ({ quantity: item.quantity, unitPrice: itemPrice(item) }))) /
    100;

  const handleDeliverySubmit = (e: FormEvent) => {
    e.preventDefault();
    if (createDeliveryMutation.isPending) return;
    const invalidRetail = deliveryForm.items.find((item) => {
      if (item.sellPrice.trim() === '') return false;
      const parsed = parseNumberInput(item.sellPrice);
      return parsed === null || parsed < 0;
    });
    if (invalidRetail) {
      toast.error('Проверьте розничную цену: укажите число или очистите поле, чтобы сохранить текущую цену');
      return;
    }
    const validItems = deliveryForm.items
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: itemPrice(item),
        ...(item.sellPrice.trim() !== '' ? { sellPrice: parseNumberInput(item.sellPrice) as number } : {}),
      }))
      .filter((item) => item.productId && item.quantity > 0 && item.price > 0);
    if (validItems.length === 0) {
      toast.error('Добавьте хотя бы один товар с ценой');
      return;
    }
    const payload = {
      supplierId: id as string,
      date: deliveryForm.date,
      items: validItems,
      comment: deliveryForm.comment,
    };
    createDeliveryMutation.mutate({ ...payload });
  };

  // ── Оплата ─────────────────────────────────────────────────────────────────
  const emptyPaymentForm: PaymentFormData = {
    amount: '',
    // Сегодня У АВТОСЕРВИСА — обоснование см. emptyDeliveryForm.
    date: tenantToday,
    comment: '',
    // 149 (семантика уточнена adversarial-ревью): дефолт поля = месяц ДАТЫ
    // платежа. При сабмите periodMonth отправляется ТОЛЬКО если отличается от
    // месяца даты — иначе undefined → NULL → точная дата-семантика отчётов
    // (дневные/недельные срезы «Закупки товара» не раздуваются до месяца).
    periodMonth: tenantMonth,
  };
  const [paymentForm, setPaymentForm] = useState<PaymentFormData>(emptyPaymentForm);

  const openPaymentModal = () => {
    setPaymentForm(emptyPaymentForm);
    setIsPaymentModalOpen(true);
  };

  const createPaymentMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createPayment(data),
    onSuccess: () => {
      toast.success('Оплата записана');
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setIsPaymentModalOpen(false);
    },
    onError: () => toast.error('Ошибка при записи оплаты'),
  });

  const handlePaymentSubmit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNumberInput(paymentForm.amount);
    if (!amount || amount <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }
    // 149 — «за какой месяц»: шлём ТОЛЬКО осознанный выбор месяца, ОТЛИЧНОГО
    // от месяца даты платежа (платёж в августе «за июль» уедет в июльский
    // отчёт). Совпадает с месяцем даты → undefined → NULL → платёж живёт по
    // точной дате факта (дневные/недельные срезы корректны).
    const dateMonth = (paymentForm.date || '').slice(0, 7);
    createPaymentMutation.mutate({
      supplierId: id,
      amount,
      date: paymentForm.date,
      comment: paymentForm.comment,
      periodMonth:
        paymentForm.periodMonth && paymentForm.periodMonth !== dateMonth ? paymentForm.periodMonth : undefined,
    });
  };

  // ── Корректировка платежей (Round 14) ───────────────────────────────────────
  const invalidatePayments = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] });
    queryClient.invalidateQueries({ queryKey: ['supplier', id] });
    queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
    // «Закупка товара» в Расходах — сторно исключает строку, возврат даёт минус.
    queryClient.invalidateQueries({ queryKey: ['supplier-payments-report'] });
  };

  // «Возврат от поставщика»: сервер пишет строку kind='refund' с отрицательной
  // суммой — долг поставщику растёт.
  const createRefundMutation = useMutation({
    mutationFn: (data: { supplierId: string; amount: number; comment?: string }) => suppliersApi.createRefund(data),
    onSuccess: () => {
      toast.success('Возврат от поставщика записан — долг вырос');
      invalidatePayments();
      setIsRefundModalOpen(false);
      setRefundForm({ amount: '', comment: '' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось записать возврат');
    },
  });

  const handleRefundSubmit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNumberInput(refundForm.amount);
    if (!amount || amount <= 0) {
      toast.error('Введите сумму возврата');
      return;
    }
    createRefundMutation.mutate({ supplierId: id as string, amount, comment: refundForm.comment || undefined });
  };

  // Сторно: строка платежа не удаляется — помечается «Сторнировано», долг
  // возвращается, авто-оплаченная поставка (098) снова становится «unpaid».
  const reversePaymentMutation = useMutation({
    mutationFn: (vars: { paymentId: string; reason?: string }) =>
      suppliersApi.reversePayment(vars.paymentId, { reason: vars.reason }),
    onSuccess: () => {
      toast.success('Платёж сторнирован — долг поставщику вернулся');
      invalidatePayments();
      setReverseTarget(null);
      setReverseReason('');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось сторнировать платёж');
    },
  });

  // ── Возврат брака ──────────────────────────────────────────────────────────
  const [returnForm, setReturnForm] = useState<{
    productId: string;
    productName: string;
    productStock: number;
    productUnit?: string;
    qty: string;
    purchasePrice: string;
    note: string;
  }>({ productId: '', productName: '', productStock: 0, qty: '1', purchasePrice: '', note: '' });

  const openReturnModal = () => {
    setReturnForm({ productId: '', productName: '', productStock: 0, qty: '1', purchasePrice: '', note: '' });
    setIsReturnModalOpen(true);
  };

  const handleReturnProductSelected = (p: Product) => {
    setReturnForm((prev) => ({
      ...prev,
      productId: p.id,
      productName: p.name,
      productStock: p.stock,
      productUnit: p.unit,
      purchasePrice: prev.purchasePrice || String(p.costPrice ?? ''),
    }));
  };

  const returnDefectMutation = useMutation({
    mutationFn: (body: { productId: string; qty: number; purchasePrice?: number; note?: string }) =>
      suppliersApi.returnDefect(id as string, body),
    onSuccess: () => {
      toast.success('Возврат брака зафиксирован');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-returns', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-writeoff-report'] });
      setIsReturnModalOpen(false);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Ошибка при оформлении возврата';
      toast.error(typeof msg === 'string' ? msg : 'Ошибка при оформлении возврата');
    },
  });

  const handleReturnSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!returnForm.productId) {
      toast.error('Выберите товар из склада брака');
      return;
    }
    const qty = parseNumberInput(returnForm.qty);
    if (!qty || qty <= 0) {
      toast.error('Введите количество');
      return;
    }
    if (qty > returnForm.productStock) {
      toast.error(`Количество превышает остаток на складе брака (${formatQty(returnForm.productStock)})`);
      return;
    }
    const price = returnForm.purchasePrice.trim()
      ? (parseNumberInput(returnForm.purchasePrice) ?? undefined)
      : undefined;
    returnDefectMutation.mutate({
      productId: returnForm.productId,
      qty,
      purchasePrice: price,
      note: returnForm.note.trim() || undefined,
    });
  };

  // ── Покупка б/у ────────────────────────────────────────────────────────────
  // Backend (POST /suppliers/:id/used-purchase) atomically creates / increments
  // the Б/У product, writes a delivery + supplier-debt entry, and stamps a
  // stock_movement with is_used_purchase=true so the journal can render it specially.
  const usedPurchaseMutation = useMutation({
    mutationFn: (body: { productName: string; qty: number; purchasePrice: number; category?: string; note?: string }) =>
      suppliersApi.usedPurchase(id as string, body),
    onSuccess: (_data, vars) => {
      toast.success(`«${vars.productName}» добавлен на склад Б/У`);
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      setIsUsedPurchaseModalOpen(false);
      setUsedPurchaseForm({ productName: '', qty: '', purchasePrice: '', category: '', note: '' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Ошибка при оформлении покупки';
      toast.error(typeof msg === 'string' ? msg : 'Ошибка при оформлении покупки');
    },
  });

  const usedQty = parseNumberInput(usedPurchaseForm.qty) ?? 0;
  const usedPrice = parseNumberInput(usedPurchaseForm.purchasePrice);

  const handleUsedPurchaseSubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = usedPurchaseForm.productName.trim();
    if (!name) {
      toast.error('Введите название товара');
      return;
    }
    if (!usedQty || usedQty <= 0) {
      toast.error('Количество должно быть больше нуля');
      return;
    }
    if (usedPrice === null || usedPrice < 0) {
      toast.error('Укажите корректную закупочную цену');
      return;
    }
    usedPurchaseMutation.mutate({
      productName: name,
      qty: usedQty,
      purchasePrice: usedPrice,
      category: usedPurchaseForm.category.trim() || undefined,
      note: usedPurchaseForm.note.trim() || undefined,
    });
  };

  const openUsedPurchaseModal = () => {
    if (!usedWarehouse) {
      toast.error('Склад Б/У не найден');
      return;
    }
    setUsedPurchaseForm({ productName: '', qty: '', purchasePrice: '', category: '', note: '' });
    setIsUsedPurchaseModalOpen(true);
  };

  // ── Состояния загрузки / ошибки ─────────────────────────────────────────────
  if (isLoading || isError || !supplier) {
    const is404 = (error as any)?.response?.status === 404;
    return (
      <div className="space-y-5">
        {canManage && (
          <ProcurementRecoveryPanel
            recovery={recovery}
            onRecovered={() => {
              for (const key of [
                'supplier',
                'supplier-deliveries',
                'suppliers',
                'supplier-financial-returns',
                'products',
                'stock-movements',
              ])
                void queryClient.invalidateQueries({ queryKey: [key] });
              toast.success('Результат операции восстановлен');
            }}
          />
        )}
        <PageHeader title="Поставщик" icon={Truck} backTo="/suppliers" />
        {!isLoading && (is404 || (!isError && !supplier)) ? (
          <Card>
            <EmptyState icon={Truck} title="Поставщик не найден" description="Возможно, он был удалён" />
          </Card>
        ) : (
          <QueryState
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            isFetching={isFetching}
            errorTitle="Не удалось загрузить поставщика"
            loader={
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <SkeletonCard lines={1} />
                  <SkeletonCard lines={1} />
                  <SkeletonCard lines={1} />
                </div>
                <SkeletonCard lines={4} />
              </div>
            }
          >
            <></>
          </QueryState>
        )}
      </div>
    );
  }

  const subtitle = isUsedPurchaseSupplier
    ? 'Через этого поставщика оформляется покупка б/у товаров у клиентов — товар попадает на склад Б/У'
    : [supplier.contactPerson, supplier.phone ? formatPhone(supplier.phone) : null, supplier.comment]
        .filter(Boolean)
        .join(' · ') || 'Контакт и телефон не указаны';

  const tabs: TabItem<TabType>[] = [
    { key: 'deliveries', label: 'Поставки', icon: Truck, count: deliveriesQuery.data ? deliveries.length : undefined },
    { key: 'payments', label: 'Оплаты', icon: CreditCard, count: paymentsQuery.data ? payments.length : undefined },
    { key: 'returns', label: 'Возвраты', icon: Undo2, count: returnsQuery.data ? returns.length : undefined },
  ];

  // ── Колонки таблиц ─────────────────────────────────────────────────────────
  const deliveryColumns: DataTableColumn<Delivery>[] = [
    {
      key: 'date',
      header: 'Дата',
      sortable: true,
      sortValue: (d) => d.date,
      render: (d) => <span className="font-medium tabular-nums text-ink">{fmtDay(d.date)}</span>,
      footer: (rows) => `Поставок: ${rows.length}`,
    },
    {
      key: 'comment',
      header: 'Комментарий',
      hideBelow: 'md',
      render: (d) => (
        <span className="block max-w-xs">
          <span className="block truncate">{d.comment || <span className="text-ink-3">—</span>}</span>
          {d.deletedAt && d.deleteReason && (
            <span className="block truncate text-xs text-bad-text">Причина удаления: {d.deleteReason}</span>
          )}
          {!d.deletedAt && d.correctedAt && (
            <span className="block truncate text-xs text-ink-3">
              Изменена {fmtDay(d.correctedAt)}
              {d.correctedByName ? ` · ${d.correctedByName}` : ''}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Оплата',
      hideBelow: 'sm',
      render: (d) =>
        // 154 — soft-delete: остатки и долг уже откачены сервером, строка
        // остаётся в истории с бейджем «Удалена» + зачёркнутой суммой.
        d.deletedAt ? <Badge tone="bad">Удалена</Badge> : paymentStatusBadge(d.paymentStatus),
    },
    {
      key: 'totalAmount',
      header: 'Сумма',
      numeric: true,
      sortable: true,
      render: (d) => (
        <Money value={d.totalAmount} className={d.deletedAt ? 'text-ink-3 line-through' : 'font-medium text-ink'} />
      ),
      footer: (rows) => <Money value={rows.filter((r) => !r.deletedAt).reduce((s, r) => s + r.totalAmount, 0)} />,
    },
    ...(canManage && !isUsedPurchaseSupplier
      ? [
          {
            key: 'return',
            header: 'Возврат',
            render: (d: Delivery) =>
              !d.deletedAt && d.items.some((line) => (line.returnableQuantity ?? line.quantity) > 0) ? (
                <Button size="sm" variant="secondary" icon={Undo2} onClick={() => openDeliveryReturn(d.id)}>
                  Оформить
                </Button>
              ) : (
                <span className="text-xs text-ink-3">—</span>
              ),
          } as DataTableColumn<Delivery>,
        ]
      : []),
  ];

  const paymentColumns: DataTableColumn<SupplierPayment>[] = [
    {
      key: 'date',
      header: 'Дата',
      sortable: true,
      sortValue: (p) => p.date,
      render: (p) => <span className="font-medium tabular-nums text-ink">{fmtDay(p.date)}</span>,
      footer: (rows) => `Оплат: ${rows.length}`,
    },
    {
      key: 'kind',
      header: 'Тип',
      hideBelow: 'sm',
      render: (p) =>
        p.reversedAt ? (
          <Badge tone="bad">Сторнировано</Badge>
        ) : p.kind === 'refund' ? (
          <Badge tone="info">Возврат от поставщика</Badge>
        ) : p.kind === 'defect_return' ? (
          <Badge tone="warn">Возврат брака</Badge>
        ) : (
          <Badge tone="ok" dot>
            Оплата
          </Badge>
        ),
    },
    {
      key: 'comment',
      header: 'Комментарий',
      hideBelow: 'md',
      render: (p) => (
        <span className="block max-w-xs">
          <span className="block truncate">{p.comment || <span className="text-ink-3">—</span>}</span>
          {p.reversedAt && p.reversalReason && (
            <span className="block truncate text-xs text-bad-text">Причина сторно: {p.reversalReason}</span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Сумма',
      numeric: true,
      sortable: true,
      render: (p) => (
        <Money
          value={p.amount}
          className={
            p.reversedAt
              ? 'text-ink-3 line-through'
              : p.amount < 0
                ? 'font-medium text-info-text'
                : 'font-medium text-ok-text'
          }
        />
      ),
      // В балансе участвуют только несторнированные строки (возврат — с минусом).
      footer: (rows) => <Money value={rows.filter((r) => !r.reversedAt).reduce((s, r) => s + r.amount, 0)} />,
    },
    ...(canCorrectPayments
      ? ([
          {
            key: 'actions',
            header: <span className="sr-only">Действия</span>,
            interactive: true,
            align: 'right',
            width: 140,
            // Возврат брака связан со складской операцией — сервер откажет
            // в сторно, кнопку не показываем.
            render: (p) =>
              !p.reversedAt && p.kind !== 'defect_return' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Undo2}
                  className="text-bad-text hover:bg-bad-soft hover:text-bad-text"
                  onClick={() => {
                    setReverseReason('');
                    setReverseTarget(p);
                  }}
                >
                  Сторнировать
                </Button>
              ) : null,
          },
        ] as DataTableColumn<SupplierPayment>[])
      : []),
  ];

  const returnColumns: DataTableColumn<StockMovement>[] = [
    {
      key: 'createdAt',
      header: 'Дата',
      sortable: true,
      sortValue: (m) => m.createdAt,
      render: (m) => <span className="font-medium tabular-nums text-ink">{fmtDay(m.createdAt)}</span>,
      footer: (rows) => `Возвратов: ${rows.length}`,
    },
    {
      key: 'product',
      header: 'Товар',
      render: (m) => <span className="text-ink">{m.product?.name || '—'}</span>,
    },
    {
      key: 'reason',
      header: 'Комментарий',
      hideBelow: 'md',
      render: (m) => (
        <span className="block max-w-xs truncate">{m.reason || <span className="text-ink-3">—</span>}</span>
      ),
    },
    {
      key: 'quantity',
      header: 'Кол-во',
      numeric: true,
      render: (m) => (
        <span className="font-medium text-bad-text">
          −{formatQty(Math.abs(m.quantity))} {unitLabel(m.product?.unit)}
        </span>
      ),
    },
  ];

  const editSaving = updateMutation.isPending;

  return (
    <div className="space-y-5">
      {canManage && (
        <ProcurementRecoveryPanel
          recovery={recovery}
          onRecovered={() => {
            for (const key of [
              'supplier',
              'supplier-deliveries',
              'suppliers',
              'supplier-financial-returns',
              'products',
              'stock-movements',
            ])
              void queryClient.invalidateQueries({ queryKey: [key] });
            toast.success('Результат операции восстановлен');
          }}
        />
      )}
      <PageHeader
        title={supplier.name}
        icon={Truck}
        backTo="/suppliers"
        subtitle={subtitle}
        meta={
          supplier.isSystem ? (
            <Badge tone="accent" size="sm">
              Системный
            </Badge>
          ) : undefined
        }
        actions={
          canManage ? (
            supplier.isSystem ? (
              <Button icon={Package} onClick={openUsedPurchaseModal}>
                Покупка б/у товара
              </Button>
            ) : (
              <Button variant="secondary" icon={Pencil} onClick={openEditModal}>
                Редактировать
              </Button>
            )
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Закупки всего" value={<Money value={supplier.totalPurchases} />} icon={Truck} />
        <StatCard label="Оплачено" value={<Money value={supplier.totalPaid} />} icon={Wallet} />
        <StatCard
          label="Текущий долг"
          value={<Money value={supplier.currentDebt} />}
          icon={CreditCard}
          tone={supplier.currentDebt > 0 ? 'bad' : 'neutral'}
          hint={supplier.currentDebt > 0 ? 'Погасите через «Новая оплата»' : 'Долга нет'}
        />
      </div>

      <Tabs
        aria-label="Разделы поставщика"
        idPrefix="supplier"
        items={tabs}
        value={activeTab}
        onChange={(key) => setParam({ tab: key === 'deliveries' ? null : key })}
      />

      <TabPanel idPrefix="supplier" tabKey="deliveries" active={activeTab === 'deliveries'} className="space-y-4">
        {/* «Новая поставка» скрыта для системного поставщика — приход по нему
            идёт через «Покупка б/у товара» в шапке. Гейт — suppliers_manage. */}
        {canManage && !isUsedPurchaseSupplier && (
          <Toolbar
            end={
              <Button icon={Plus} onClick={openDeliveryModal}>
                Новая поставка
              </Button>
            }
          >
            <p className="text-sm text-ink-3">Поставки увеличивают остатки склада и долг перед поставщиком</p>
          </Toolbar>
        )}
        <DataTable
          rows={deliveries}
          rowKey={(d) => d.id}
          columns={deliveryColumns}
          caption="Поставки от поставщика"
          rowClassName={(d) => (d.deletedAt ? 'opacity-60' : undefined)}
          isLoading={deliveriesQuery.isLoading}
          isError={deliveriesQuery.isError}
          onRetry={() => deliveriesQuery.refetch()}
          isFetching={deliveriesQuery.isFetching}
          errorTitle="Не удалось загрузить поставки"
          emptyState={{
            icon: Truck,
            title: 'Поставок пока нет',
            description: isUsedPurchaseSupplier
              ? 'Покупки б/у товаров появятся здесь'
              : 'Оформите первую поставку от этого поставщика',
          }}
        />
      </TabPanel>

      <TabPanel idPrefix="supplier" tabKey="payments" active={activeTab === 'payments'} className="space-y-4">
        {(canManage || (canCorrectPayments && !isUsedPurchaseSupplier)) && (
          <Toolbar
            end={
              <>
                {/* «Возврат от поставщика» — только с галкой корректировки платежей.
                    Для системного «Покупка б/у» канала не показываем. */}
                {canCorrectPayments && !isUsedPurchaseSupplier && (
                  <Button
                    variant="secondary"
                    icon={Undo2}
                    onClick={() => {
                      setRefundForm({ amount: '', comment: '' });
                      setIsRefundModalOpen(true);
                    }}
                  >
                    Возврат от поставщика
                  </Button>
                )}
                {canManage && (
                  <Button icon={Plus} onClick={openPaymentModal}>
                    Новая оплата
                  </Button>
                )}
              </>
            }
          >
            <p className="text-sm text-ink-3">Оплаты уменьшают долг; сторно возвращает его обратно</p>
          </Toolbar>
        )}
        <DataTable
          rows={payments}
          rowKey={(p) => p.id}
          columns={paymentColumns}
          caption="Оплаты поставщику"
          rowClassName={(p) => (p.reversedAt ? 'opacity-60' : undefined)}
          isLoading={paymentsQuery.isLoading}
          isError={paymentsQuery.isError}
          onRetry={() => paymentsQuery.refetch()}
          isFetching={paymentsQuery.isFetching}
          errorTitle="Не удалось загрузить оплаты"
          emptyState={{
            icon: CreditCard,
            title: 'Оплат пока нет',
            description: 'Запишите первую оплату поставщику',
          }}
        />
      </TabPanel>

      <TabPanel idPrefix="supplier" tabKey="returns" active={activeTab === 'returns'} className="space-y-4">
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h2 className="font-semibold text-ink">Возвраты из поставок</h2>
            <p className="text-sm text-ink-3">
              Возврат создаёт отдельный документ и кредит поставщика; исходная накладная и платежи остаются неизменными.
            </p>
          </div>
          {supplierDocumentReturnsQuery.isLoading ? <p className="text-sm text-ink-3">Загрузка истории…</p> : null}
          {supplierDocumentReturnsQuery.isError ? (
            <Button variant="secondary" onClick={() => supplierDocumentReturnsQuery.refetch()}>
              Повторить загрузку возвратов
            </Button>
          ) : null}
          {(supplierDocumentReturnsQuery.data ?? []).map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-3 text-sm"
            >
              <div>
                <p className="font-medium text-ink">
                  {fmtDay(item.date)} · источник {item.deliveryId.slice(0, 8)}
                </p>
                <p className="text-ink-3">
                  {item.reason || 'Причина не указана'} ·{' '}
                  {item.items.map((line) => `${line.name} × ${formatQty(line.quantity)}`).join(', ')}
                </p>
              </div>
              <div className="text-right">
                <Money value={item.totalAmount} className="font-semibold text-ink" />
                <p className="text-xs text-ink-3">
                  исходная сумма <Money value={item.sourceTotalAmount} />
                </p>
              </div>
            </div>
          ))}
          {!supplierDocumentReturnsQuery.isLoading &&
            !supplierDocumentReturnsQuery.isError &&
            (supplierDocumentReturnsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-ink-3">Документированных возвратов пока нет</p>
            )}
        </section>
        {/* Возврат брака по системному «Покупка б/у» каналу не имеет смысла. */}
        {canManage && !isUsedPurchaseSupplier && (
          <Toolbar
            end={
              <Button variant="secondary" icon={Undo2} onClick={openReturnModal} disabled={!defectWarehouse}>
                Возврат брака
              </Button>
            }
          >
            <p className="text-sm text-ink-3">
              {defectWarehouse
                ? 'Возврат уменьшает остаток на складе брака и долг перед поставщиком'
                : 'Склад брака ещё не создан — возврат недоступен'}
            </p>
          </Toolbar>
        )}
        <DataTable
          rows={returns}
          rowKey={(m) => m.id}
          columns={returnColumns}
          caption="Возвраты брака поставщику"
          isLoading={returnsQuery.isLoading}
          isError={returnsQuery.isError}
          onRetry={() => returnsQuery.refetch()}
          isFetching={returnsQuery.isFetching}
          errorTitle="Не удалось загрузить возвраты"
          emptyState={{
            icon: Undo2,
            title: 'Возвратов пока нет',
            description: defectWarehouse
              ? 'Здесь появится история возвратов брака этому поставщику'
              : 'Склад брака ещё не создан',
          }}
        />
      </TabPanel>

      <Modal
        isOpen={!!deliveryReturnId}
        onClose={() => {
          if (deliveryReturnMutation.isPending) return;
          setDeliveryReturnId(null);
        }}
        title="Возврат из поставки"
        description="Будет создан отдельный документ; сумма и оплата исходной накладной не изменятся. Возврат денег наличными оформляется отдельно."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeliveryReturnId(null);
              }}
              disabled={deliveryReturnMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="delivery-return-form" loading={deliveryReturnMutation.isPending}>
              Оформить возврат
            </Button>
          </>
        }
      >
        {deliveryForReturnQuery.isLoading ? (
          <p className="text-sm text-ink-3">Загрузка состава поставки…</p>
        ) : deliveryForReturnQuery.isError ? (
          <Button variant="secondary" onClick={() => deliveryForReturnQuery.refetch()}>
            Повторить загрузку
          </Button>
        ) : deliveryForReturnQuery.data ? (
          <form id="delivery-return-form" onSubmit={submitDeliveryReturn} className="space-y-4">
            <p className="text-sm text-ink-3">
              Источник: {fmtDay(deliveryForReturnQuery.data.date)} · исходная сумма{' '}
              <Money value={deliveryForReturnQuery.data.totalAmount} /> · возвращено{' '}
              <Money value={deliveryForReturnQuery.data.returnedAmount ?? 0} /> · нетто{' '}
              <Money value={deliveryForReturnQuery.data.netAmount ?? deliveryForReturnQuery.data.totalAmount} /> ·
              кредит поставщика <Money value={supplier.creditBalance ?? 0} />
            </p>
            <div className="space-y-3">
              {deliveryForReturnQuery.data.items.map((line) => {
                const max = line.returnableQuantity ?? 0;
                const returned = line.returnedQuantity ?? 0;
                return (
                  <div key={line.id} className="grid grid-cols-[1fr_7rem] items-center gap-3 border-b border-line pb-3">
                    <div>
                      <p className="font-medium text-ink">{line.product?.name || 'Товар'}</p>
                      <p className="text-xs text-ink-3">
                        Получено {formatQty(line.quantity)} · возвращено {formatQty(returned)} · доступно{' '}
                        {formatQty(max)} · {formatQty(line.price)} ₽/шт
                      </p>
                    </div>
                    <Input
                      aria-label={`Количество возврата — ${line.product?.name || 'товар'}`}
                      inputMode="decimal"
                      min={0}
                      max={max}
                      value={deliveryReturnQty[line.id] ?? ''}
                      disabled={deliveryReturnMutation.isPending || max <= 0}
                      onChange={(e) => setDeliveryReturnQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                );
              })}
            </div>
            <Field label="Причина" required>
              <Textarea
                value={deliveryReturnReason}
                onChange={(e) => setDeliveryReturnReason(e.target.value)}
                rows={2}
                disabled={deliveryReturnMutation.isPending}
                placeholder="Например: неподходящая деталь"
              />
            </Field>
          </form>
        ) : null}
      </Modal>

      {/* ── Редактировать поставщика ─────────────────────────────────────────── */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Редактировать поставщика"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} disabled={editSaving}>
              Отмена
            </Button>
            <Button type="submit" form="supplier-edit-form" loading={editSaving}>
              Сохранить
            </Button>
          </>
        }
      >
        <form id="supplier-edit-form" onSubmit={handleEditSubmit} className="space-y-4">
          <Field label="Название" htmlFor="sup-name" required>
            <Input
              id="sup-name"
              autoComplete="organization"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </Field>
          <Field label="Контактное лицо" htmlFor="sup-contact">
            <Input
              id="sup-contact"
              autoComplete="name"
              leftIcon={User}
              value={editForm.contactPerson}
              onChange={(e) => setEditForm({ ...editForm, contactPerson: e.target.value })}
            />
          </Field>
          <Field label="Телефон" htmlFor="sup-phone">
            <PhoneInput
              id="sup-phone"
              autoComplete="tel"
              value={editForm.phone}
              onChange={(val) => setEditForm({ ...editForm, phone: val })}
            />
          </Field>
          <Field label="Комментарий" htmlFor="sup-comment">
            <Textarea
              id="sup-comment"
              rows={3}
              value={editForm.comment}
              onChange={(e) => setEditForm({ ...editForm, comment: e.target.value })}
            />
          </Field>
        </form>
      </Modal>

      {/* ── Новая поставка ───────────────────────────────────────────────────── */}
      <Modal
        isOpen={isDeliveryModalOpen}
        onClose={() => {
          if (createDeliveryMutation.isPending) return;
          setIsDeliveryModalOpen(false);
        }}
        title="Новая поставка"
        description="Остатки склада вырастут, сумма поставки добавится в долг поставщику"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeliveryModalOpen(false);
              }}
              disabled={createDeliveryMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="delivery-form" loading={createDeliveryMutation.isPending}>
              Создать поставку
            </Button>
          </>
        }
      >
        <form id="delivery-form" onSubmit={handleDeliverySubmit} className="space-y-4">
          <Field label="Дата поставки" htmlFor="delivery-date">
            <Input
              id="delivery-date"
              type="date"
              value={deliveryForm.date}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, date: e.target.value })}
              className="sm:w-48"
            />
          </Field>
          {deliveryPurchaseContext.isError && (
            <Button type="button" variant="secondary" onClick={() => deliveryPurchaseContext.refetch()}>
              Не удалось загрузить историю закупок · Повторить
            </Button>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-2">Товары</span>
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowDeliveryPicker(true)}>
                Добавить товар
              </Button>
            </div>

            {deliveryForm.items.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowDeliveryPicker(true)}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3',
                  'transition-[border-color,background-color] duration-150 hover:border-accent hover:bg-accent-soft/40',
                  focusRing,
                )}
              >
                <Package className="h-7 w-7 text-ink-4" aria-hidden="true" />
                Нажмите, чтобы выбрать товар из каталога
              </button>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {deliveryForm.items.map((item, index) => {
                  const product = products.find((p) => p.id === item.productId);
                  const name = product?.name || 'Товар';
                  return (
                    <li key={item.productId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-medium text-ink">{name}</p>
                        {product && (
                          <p className="text-xs text-ink-3">
                            Остаток: {formatQty(product.stock)} {unitLabel(product.unit)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1" role="group" aria-label={`Количество — ${name}`}>
                        <IconButton
                          label="Меньше"
                          icon={Minus}
                          size="sm"
                          variant="secondary"
                          disabled={item.quantity <= 1}
                          onClick={() => updateDeliveryItem(index, { quantity: item.quantity - 1 })}
                        />
                        <span className="w-8 text-center text-sm font-medium tabular-nums text-ink" aria-live="polite">
                          {item.quantity}
                        </span>
                        <IconButton
                          label="Больше"
                          icon={Plus}
                          size="sm"
                          variant="secondary"
                          onClick={() => updateDeliveryItem(index, { quantity: item.quantity + 1 })}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input
                          size="sm"
                          inputMode="decimal"
                          aria-label={`Цена за единицу — ${name}`}
                          value={item.price}
                          invalid={!(itemPrice(item) > 0)}
                          onChange={(e) => updateDeliveryItem(index, { price: e.target.value })}
                          className="w-24 text-right tabular-nums"
                        />
                        <span className="whitespace-nowrap text-xs text-ink-3">₽/{unitLabel(product?.unit)}</span>
                      </div>
                      <Money
                        value={item.quantity * itemPrice(item)}
                        className="w-24 text-right text-sm font-semibold text-ink"
                      />
                      <IconButton
                        label={`Убрать ${name}`}
                        icon={Trash2}
                        size="sm"
                        variant="danger"
                        onClick={() => removeDeliveryItem(index)}
                      />
                      <div className="grid w-full grid-cols-1 gap-2 border-t border-line pt-2 sm:grid-cols-2">
                        <Field label="Розничная цена" hint="Пусто — сохранить текущую, 0 — установить ноль">
                          <Input
                            size="sm"
                            inputMode="decimal"
                            aria-label={`Розничная цена — ${name}`}
                            value={item.sellPrice}
                            disabled={createDeliveryMutation.isPending}
                            onChange={(e) => updateDeliveryItem(index, { sellPrice: e.target.value })}
                            className="w-36 text-right tabular-nums"
                          />
                        </Field>
                        {(() => {
                          const prior = deliveryContextByProduct.get(item.productId)?.previousPurchase;
                          if (deliveryPurchaseContext.isLoading)
                            return <p className="self-end text-xs text-ink-3">Загрузка истории закупок…</p>;
                          if (deliveryPurchaseContext.isError)
                            return (
                              <p className="self-end text-xs text-ink-3">
                                История закупок недоступна · используйте «Повторить» выше
                              </p>
                            );
                          if (!prior) return <p className="self-end text-xs text-ink-3">До этой даты закупок нет</p>;
                          const delta = itemPrice(item) - prior.price;
                          const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
                            Math.abs(delta),
                          );
                          const percent = prior.price > 0 ? ` · ${((delta / prior.price) * 100).toFixed(1)}%` : '';
                          return (
                            <p className="self-end text-xs text-ink-3">
                              Ранее: {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(prior.price)}{' '}
                              ₽ · {fmtDay(prior.date)} · источник {prior.deliveryId.slice(0, 8)} · разница{' '}
                              {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                              {rub} ₽{percent}
                            </p>
                          );
                        })()}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Field label="Комментарий" htmlFor="delivery-comment">
            <Textarea
              id="delivery-comment"
              rows={2}
              value={deliveryForm.comment}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, comment: e.target.value })}
              placeholder="Примечание к поставке…"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="text-ink-3">Итого по поставке</span>
            <Money value={deliveryTotal} className="font-semibold text-ink" />
          </div>
        </form>
      </Modal>

      <ProductPickerDrawer
        open={showDeliveryPicker}
        onClose={() => setShowDeliveryPicker(false)}
        title="Товар в поставку"
        subtitle="Повторный выбор увеличивает количество на 1"
        products={products}
        onSelect={handleDeliveryProductSelected}
        priceKind="cost"
        isLoading={productsQuery.isLoading}
        isError={productsQuery.isError}
        onRetry={() => productsQuery.refetch()}
        emptyTitle="Каталог пуст"
        emptyDescription="Сначала добавьте товары на склад"
      />

      {/* ── Новая оплата ────────────────────────────────────────────────────── */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title="Новая оплата поставщику"
        description={
          supplier.currentDebt > 0
            ? `Текущий долг: ${formatQty(supplier.currentDebt)} ₽`
            : 'Долга перед поставщиком нет'
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsPaymentModalOpen(false)}
              disabled={createPaymentMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="payment-form" loading={createPaymentMutation.isPending}>
              Записать оплату
            </Button>
          </>
        }
      >
        <form id="payment-form" onSubmit={handlePaymentSubmit} className="space-y-4">
          <Field label="Сумма, ₽" htmlFor="payment-amount" required>
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Дата" htmlFor="payment-date">
              <Input
                id="payment-date"
                type="date"
                value={paymentForm.date}
                onChange={(e) =>
                  // Смена даты подтягивает «За месяц» к месяцу новой даты: иначе
                  // залежавшийся дефолт (месяц открытия формы) уехал бы на сервер
                  // как якобы осознанный выбор периода. Пользователь может выбрать
                  // другой месяц ПОСЛЕ даты — тогда он и отправится.
                  setPaymentForm({
                    ...paymentForm,
                    date: e.target.value,
                    periodMonth: e.target.value ? e.target.value.slice(0, 7) : paymentForm.periodMonth,
                  })
                }
              />
            </Field>
            <Field
              label="За месяц"
              htmlFor="payment-month"
              hint="По умолчанию — месяц даты платежа. Выберите другой, если платите «за июль» в августе"
            >
              <Input
                id="payment-month"
                type="month"
                value={paymentForm.periodMonth}
                onChange={(e) => setPaymentForm({ ...paymentForm, periodMonth: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Комментарий" htmlFor="payment-comment">
            <Textarea
              id="payment-comment"
              rows={2}
              value={paymentForm.comment}
              onChange={(e) => setPaymentForm({ ...paymentForm, comment: e.target.value })}
              placeholder="Примечание к оплате…"
            />
          </Field>
        </form>
      </Modal>

      {/* ── Возврат от поставщика (Round 14) ─────────────────────────────────── */}
      <Modal
        isOpen={isRefundModalOpen}
        onClose={() => setIsRefundModalOpen(false)}
        title="Возврат от поставщика"
        description="Поставщик вернул вам деньги (переплата, возврат аванса): долг поставщику вырастет на сумму возврата"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsRefundModalOpen(false)}
              disabled={createRefundMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="refund-form" loading={createRefundMutation.isPending}>
              Записать возврат
            </Button>
          </>
        }
      >
        <form id="refund-form" onSubmit={handleRefundSubmit} className="space-y-4">
          <Field label="Сумма, ₽" htmlFor="refund-amount" required>
            <Input
              id="refund-amount"
              inputMode="decimal"
              value={refundForm.amount}
              onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
              placeholder="0"
              className="tabular-nums"
            />
          </Field>
          <Field label="Комментарий" htmlFor="refund-comment">
            <Textarea
              id="refund-comment"
              rows={2}
              value={refundForm.comment}
              onChange={(e) => setRefundForm({ ...refundForm, comment: e.target.value })}
              placeholder="Например: возврат переплаты"
            />
          </Field>
        </form>
      </Modal>

      {/* ── Сторно платежа (Round 14) ────────────────────────────────────────── */}
      <Modal
        isOpen={!!reverseTarget}
        onClose={() => {
          setReverseTarget(null);
          setReverseReason('');
        }}
        title="Сторнировать платёж?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setReverseTarget(null);
                setReverseReason('');
              }}
              disabled={reversePaymentMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              loading={reversePaymentMutation.isPending}
              onClick={() =>
                reverseTarget &&
                reversePaymentMutation.mutate({
                  paymentId: reverseTarget.id,
                  reason: reverseReason.trim() || undefined,
                })
              }
            >
              Сторнировать
            </Button>
          </>
        }
      >
        {reverseTarget && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              Платёж от {fmtDay(reverseTarget.date)} на{' '}
              <Money value={reverseTarget.amount} className="font-semibold text-ink" /> останется в истории зачёркнутым,
              а долг поставщику вернётся. Отменить сторно нельзя.
              {reverseTarget.deliveryId ? ' Связанная поставка снова станет неоплаченной.' : ''}
            </p>
            <Field label="Причина сторно" htmlFor="reverse-reason">
              <Textarea
                id="reverse-reason"
                rows={2}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Например: ошиблись суммой"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── Возврат брака ───────────────────────────────────────────────────── */}
      <Modal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        title="Возврат брака поставщику"
        description="Возврат уменьшает остаток на складе брака и снижает долг перед поставщиком на сумму закупки"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsReturnModalOpen(false)}
              disabled={returnDefectMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="return-form" loading={returnDefectMutation.isPending}>
              Оформить возврат
            </Button>
          </>
        }
      >
        <form id="return-form" onSubmit={handleReturnSubmit} className="space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Товар со склада брака</span>
            {returnForm.productId ? (
              <div className="flex items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5">
                <Package className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{returnForm.productName}</p>
                  <p className="text-xs text-ink-3">
                    На складе брака: {formatQty(returnForm.productStock)} {unitLabel(returnForm.productUnit)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowReturnPicker(true)}>
                  Изменить
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowReturnPicker(true)}
                disabled={!defectWarehouse}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3',
                  'transition-[border-color,background-color] duration-150 hover:border-warn hover:bg-warn-soft/60 disabled:opacity-50',
                  focusRing,
                )}
              >
                <Package className="h-6 w-6 text-ink-4" aria-hidden="true" />
                Выбрать товар из склада брака
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество" htmlFor="return-qty" required>
              <Input
                id="return-qty"
                inputMode="decimal"
                value={returnForm.qty}
                onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <Field label="Цена закупки, ₽" htmlFor="return-price" hint="Пусто — из карточки товара">
              <Input
                id="return-price"
                inputMode="decimal"
                value={returnForm.purchasePrice}
                onChange={(e) => setReturnForm({ ...returnForm, purchasePrice: e.target.value })}
                placeholder="Из товара"
                className="tabular-nums"
              />
            </Field>
          </div>

          <Field label="Комментарий" htmlFor="return-note">
            <Textarea
              id="return-note"
              rows={2}
              value={returnForm.note}
              onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
              placeholder="Например: дефект упаковки, не подошёл"
            />
          </Field>
        </form>
      </Modal>

      <ProductPickerDrawer
        open={showReturnPicker}
        onClose={() => setShowReturnPicker(false)}
        title="Товар со склада брака"
        products={defectProducts}
        onSelect={handleReturnProductSelected}
        priceKind="cost"
        isLoading={defectProductsQuery.isLoading}
        isError={defectProductsQuery.isError}
        onRetry={() => defectProductsQuery.refetch()}
        emptyTitle="На складе брака пусто"
        emptyDescription="Перенесите бракованный товар с основного склада, затем оформите возврат"
      />

      {/* ── Покупка б/у ─────────────────────────────────────────────────────── */}
      <Modal
        isOpen={isUsedPurchaseModalOpen}
        onClose={() => setIsUsedPurchaseModalOpen(false)}
        title="Покупка б/у товара"
        description="Товар попадёт на склад Б/У, долг поставщику вырастет на сумму закупки — погасите его через «Новая оплата»"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsUsedPurchaseModalOpen(false)}
              disabled={usedPurchaseMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="used-purchase-form" loading={usedPurchaseMutation.isPending}>
              Добавить на склад
            </Button>
          </>
        }
      >
        <form id="used-purchase-form" onSubmit={handleUsedPurchaseSubmit} className="space-y-4">
          <Field label="Название товара" htmlFor="used-name" required>
            <Input
              id="used-name"
              value={usedPurchaseForm.productName}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, productName: e.target.value })}
              placeholder="Например: Капот"
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество" htmlFor="used-qty" required>
              <Input
                id="used-qty"
                inputMode="decimal"
                value={usedPurchaseForm.qty}
                onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, qty: e.target.value })}
                placeholder="0"
                className="tabular-nums"
              />
            </Field>
            <Field label="Закупочная цена, ₽" htmlFor="used-price" required>
              <Input
                id="used-price"
                inputMode="decimal"
                value={usedPurchaseForm.purchasePrice}
                onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, purchasePrice: e.target.value })}
                placeholder="0"
                className="tabular-nums"
              />
            </Field>
          </div>

          <Field label="Папка на складе Б/У" htmlFor="used-category" hint="Необязательно">
            <Input
              id="used-category"
              value={usedPurchaseForm.category}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, category: e.target.value })}
              placeholder="Без папки"
              autoComplete="off"
            />
            {usedCategories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Существующие папки">
                {usedCategories.slice(0, 16).map((cat) => {
                  const active = usedPurchaseForm.category === cat.path;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      aria-pressed={active}
                      onClick={() => setUsedPurchaseForm({ ...usedPurchaseForm, category: active ? '' : cat.path })}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                        active
                          ? 'border-accent bg-accent-soft text-accent-text'
                          : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
                        focusRing,
                      )}
                    >
                      {cat.path}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {usedQty > 0 && usedPrice !== null && usedPrice >= 0 && (
            <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
              <span className="text-ink-2">Долг поставщику вырастет на</span>
              <Money value={usedQty * usedPrice} signed className="font-semibold text-bad-text" />
            </div>
          )}

          <Field label="Комментарий" htmlFor="used-note">
            <Textarea
              id="used-note"
              rows={2}
              value={usedPurchaseForm.note}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, note: e.target.value })}
              placeholder="Необязательно"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
