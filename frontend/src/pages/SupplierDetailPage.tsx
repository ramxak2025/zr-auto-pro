import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Edit2,
  Plus,
  Minus,
  Truck,
  CreditCard,
  Package,
  Phone,
  User,
  Search,
  X,
  Trash2,
  FolderOpen,
  Calendar,
  ChevronLeft,
  Undo2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { suppliersApi, productsApi, stockMovementsApi, warehousesApi, warehouseCategoriesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import PhoneInput from '../components/PhoneInput';
import {
  Supplier,
  Delivery,
  SupplierPayment,
  Product,
  PaginatedResponse,
  StockMovement,
  Warehouse,
  UserRole,
} from '../types';
import { formatMoney } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

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
  price: number;
}

interface DeliveryFormData {
  date: string;
  items: DeliveryItemForm[];
  comment: string;
}

interface PaymentFormData {
  amount: number;
  date: string;
  comment: string;
}

function statusBadge(status: string) {
  // We only badge fully-paid deliveries. Unpaid / partial is the default state
  // in our "deliveries go on debt, settled in bulk" workflow — no need to
  // shout "Не оплачено" on every row.
  switch (status) {
    case 'paid':
      return <span className="badge-success">Оплачено</span>;
    case 'partial':
      return <span className="badge-warning">Частично</span>;
    case 'unpaid':
    default:
      return null;
  }
}

// ─── Product Picker (fullscreen, like checkout) ──────────────────────
function DeliveryProductPicker({
  isOpen,
  onClose,
  products,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onSelect: (p: Product) => void;
}) {
  const [search, setSearch] = useState('');
  const [activePath, setActivePath] = useState<string[]>([]);

  if (!isOpen) return null;

  const prefix = activePath.join('/');
  const subfolderMap = new Map<string, number>();
  const currentProducts: Product[] = [];

  for (const p of products) {
    const cat = p.category || '';
    const parts = cat ? cat.split('/') : [];
    if (activePath.length === 0) {
      if (!cat) currentProducts.push(p);
      else subfolderMap.set(parts[0], (subfolderMap.get(parts[0]) || 0) + 1);
    } else {
      if (cat === prefix) currentProducts.push(p);
      else if (cat.startsWith(prefix + '/')) {
        const next = cat.slice(prefix.length + 1).split('/')[0];
        subfolderMap.set(next, (subfolderMap.get(next) || 0) + 1);
      }
    }
  }
  const subfolders = Array.from(subfolderMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const searchResults = search.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : [];

  const goBack = () => {
    if (activePath.length > 0) setActivePath((prev) => prev.slice(0, -1));
    else onClose();
  };

  const handleSelect = (p: Product) => {
    onSelect(p);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <button type="button" onClick={goBack} className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600">
          {activePath.length > 0 ? <ChevronLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </button>
        <h2 className="text-lg font-semibold text-gray-900 truncate">
          {activePath.length > 0 ? activePath[activePath.length - 1] : 'Выбрать товар'}
        </h2>
      </div>
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="input pl-10 w-full"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {search.trim() ? (
          searchResults.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Ничего не найдено</p>
            </div>
          ) : (
            searchResults.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {p.photo ? (
                    <img src={p.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="w-5 h-5 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.category || 'Без категории'}</p>
                </div>
                <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{formatMoney(p.costPrice)}</span>
              </button>
            ))
          )
        ) : (
          <>
            {subfolders.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => setActivePath((prev) => [...prev, f.name])}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                <FolderOpen className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <span className="flex-1 text-left font-medium text-gray-900 truncate">{f.name}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{f.count}</span>
              </button>
            ))}
            {currentProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {p.photo ? (
                    <img src={p.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="w-5 h-5 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">
                    Остаток: {p.stock} {p.unit === 'm' ? 'м' : p.unit === 'l' ? 'л' : 'шт'}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{formatMoney(p.costPrice)}</span>
              </button>
            ))}
            {subfolders.length === 0 && currentProducts.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Нет товаров</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  // ROLE-ONLY: редактирование поставщика + приход/оплата/возврат/б/у-закупка —
  // только с suppliers_manage. Просмотр карточки — suppliers_access.
  const isOwnerClass =
    user?.role === UserRole.SUPERADMIN || user?.role === UserRole.DIRECTOR || user?.role === UserRole.ADMIN;
  const canManage = isOwnerClass || hasPermission('suppliers_manage');

  const [activeTab, setActiveTab] = useState<TabType>('deliveries');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
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

  // Supplier data
  const {
    data: supplier,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => suppliersApi.getById(id!),
    select: (res) => res.data as Supplier,
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

  // Deliveries
  const { data: deliveriesData } = useQuery({
    queryKey: ['supplier-deliveries', id],
    queryFn: () => suppliersApi.getDeliveries({ supplierId: id }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : (d as PaginatedResponse<Delivery>).data || [];
    },
    enabled: !!id,
  });
  const deliveries: Delivery[] = deliveriesData || [];

  // Payments
  const { data: paymentsData } = useQuery({
    queryKey: ['supplier-payments', id],
    queryFn: () => suppliersApi.getPayments({ supplierId: id }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : (d as PaginatedResponse<SupplierPayment>).data || [];
    },
    enabled: !!id,
  });
  const payments: SupplierPayment[] = paymentsData || [];

  // Products for delivery items. Shares the standard ['products'] cache key
  // with ProductsPage so mutations (create/delete/import) automatically
  // invalidate this too — picker always reflects current warehouse.
  // refetchOnMount: 'always' guarantees a fresh load every time the modal
  // opens, eliminating the "sometimes empty" bug when cache was stale.
  const { data: productsData } = useQuery({
    queryKey: ['products', 'all', 5000],
    queryFn: () => productsApi.getAll({ limit: 5000 }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : (d as PaginatedResponse<Product>).data || [];
    },
    enabled: isDeliveryModalOpen || showDeliveryPicker,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const products: Product[] = productsData || [];

  // Warehouses — used to find the defect warehouse for return-to-supplier
  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehousesApi.list(),
    select: (res) => res.data,
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
    queryFn: () => warehouseCategoriesApi.getAll(usedWarehouse!.id),
    select: (res) => res.data,
    enabled: !!usedWarehouse?.id && isUsedPurchaseSupplier,
    staleTime: 60_000,
  });
  const usedCategories: Array<{ id: string; path: string; sort_order: number }> = Array.isArray(usedCategoriesData)
    ? usedCategoriesData
    : [];

  // Defect-stock products picker (only items currently in defect warehouse)
  const { data: defectProductsData } = useQuery({
    queryKey: ['products', 'defect', defectWarehouse?.id],
    queryFn: () => productsApi.getAll({ limit: 5000, warehouseId: defectWarehouse!.id }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : (d as PaginatedResponse<Product>).data || [];
    },
    enabled: !!defectWarehouse?.id && (isReturnModalOpen || showReturnPicker),
    staleTime: 30_000,
  });
  const defectProducts: Product[] = defectProductsData || [];

  // Defect-return history for this supplier
  const { data: returnsData } = useQuery({
    queryKey: ['supplier-returns', id],
    queryFn: () => stockMovementsApi.list({ type: 'defect_return_to_supplier' }),
    select: (res) => (res.data || []).filter((m: StockMovement) => m.supplierId === id),
    enabled: !!id,
    staleTime: 30_000,
  });
  const returns: StockMovement[] = returnsData || [];

  // Edit supplier form
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
    mutationFn: (data: SupplierFormData) => suppliersApi.update(id!, data),
    onSuccess: () => {
      toast.success('Поставщик обновлен');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setIsEditModalOpen(false);
    },
    onError: () => toast.error('Ошибка при обновлении'),
  });

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      toast.error('Введите название');
      return;
    }
    updateMutation.mutate(editForm);
  };

  // Delivery form
  const emptyDeliveryForm: DeliveryFormData = {
    date: format(new Date(), 'yyyy-MM-dd'),
    items: [{ productId: '', quantity: 1, price: 0 }],
    comment: '',
  };
  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormData>(emptyDeliveryForm);

  const openDeliveryModal = () => {
    setDeliveryForm(emptyDeliveryForm);
    setIsDeliveryModalOpen(true);
  };

  const addDeliveryItem = () => {
    setDeliveryForm({
      ...deliveryForm,
      items: [...deliveryForm.items, { productId: '', quantity: 1, price: 0 }],
    });
  };

  const handleDeliveryProductSelected = (product: Product) => {
    setDeliveryForm((prev) => {
      const existing = prev.items.findIndex((i) => i.productId === product.id);
      if (existing !== -1) {
        const updated = [...prev.items];
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 };
        return { ...prev, items: updated };
      }
      // Remove empty placeholder rows
      const filtered = prev.items.filter((i) => i.productId);
      return {
        ...prev,
        items: [...filtered, { productId: product.id, quantity: 1, price: product.costPrice }],
      };
    });
  };

  const removeDeliveryItem = (index: number) => {
    setDeliveryForm({
      ...deliveryForm,
      items: deliveryForm.items.filter((_, i) => i !== index),
    });
  };

  const updateDeliveryItem = (index: number, field: keyof DeliveryItemForm, value: string | number) => {
    const updated = [...deliveryForm.items];
    updated[index] = { ...updated[index], [field]: value };
    setDeliveryForm({ ...deliveryForm, items: updated });
  };

  const createDeliveryMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createDelivery(data),
    onSuccess: () => {
      toast.success('Поставка создана');
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setIsDeliveryModalOpen(false);
    },
    onError: () => toast.error('Ошибка при создании поставки'),
  });

  const handleDeliverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = deliveryForm.items.filter((item) => item.productId && item.quantity > 0 && item.price > 0);
    if (validItems.length === 0) {
      toast.error('Добавьте хотя бы один товар');
      return;
    }
    createDeliveryMutation.mutate({
      supplierId: id,
      date: deliveryForm.date,
      items: validItems,
      comment: deliveryForm.comment,
    });
  };

  // Payment form
  const emptyPaymentForm: PaymentFormData = {
    amount: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    comment: '',
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

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.amount || paymentForm.amount <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }
    createPaymentMutation.mutate({
      supplierId: id,
      amount: paymentForm.amount,
      date: paymentForm.date,
      comment: paymentForm.comment,
    });
  };

  // ─── Return defect form ─────────────────────────────────────────────────────
  const [returnForm, setReturnForm] = useState<{
    productId: string;
    productName: string;
    productStock: number;
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
      purchasePrice: prev.purchasePrice || String(p.costPrice ?? ''),
    }));
  };

  const returnDefectMutation = useMutation({
    mutationFn: (body: { productId: string; qty: number; purchasePrice?: number; note?: string }) =>
      suppliersApi.returnDefect(id!, body),
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

  // Used-purchase mutation. Backend (POST /suppliers/:id/used-purchase)
  // atomically creates / increments the Б/У product, writes a delivery
  // + supplier-debt entry, and stamps a stock_movement with
  // is_used_purchase=true so the journal can render it specially.
  const usedPurchaseMutation = useMutation({
    mutationFn: (body: { productName: string; qty: number; purchasePrice: number; category?: string; note?: string }) =>
      suppliersApi.usedPurchase(id!, body),
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

  const handleUsedPurchaseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = usedPurchaseForm.productName.trim();
    const qty = Number(usedPurchaseForm.qty);
    const price = Number(usedPurchaseForm.purchasePrice);
    if (!name) {
      toast.error('Введите название товара');
      return;
    }
    if (!qty || qty <= 0) {
      toast.error('Количество должно быть больше нуля');
      return;
    }
    if (!(price >= 0)) {
      toast.error('Укажите корректную закупочную цену');
      return;
    }
    usedPurchaseMutation.mutate({
      productName: name,
      qty,
      purchasePrice: price,
      category: usedPurchaseForm.category.trim() || undefined,
      note: usedPurchaseForm.note.trim() || undefined,
    });
  };

  const handleReturnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnForm.productId) {
      toast.error('Выберите товар из склада брака');
      return;
    }
    const qty = Number(returnForm.qty);
    if (!qty || qty <= 0) {
      toast.error('Введите количество');
      return;
    }
    if (qty > returnForm.productStock) {
      toast.error(`Количество превышает остаток на складе брака (${returnForm.productStock})`);
      return;
    }
    const price = returnForm.purchasePrice.trim() ? Number(returnForm.purchasePrice) : undefined;
    returnDefectMutation.mutate({
      productId: returnForm.productId,
      qty,
      purchasePrice: price,
      note: returnForm.note.trim() || undefined,
    });
  };

  if (isLoading) return <LoadingSpinner />;

  if (isError || !supplier) {
    const is404 = (error as any)?.response?.status === 404;
    return (
      <div className="space-y-6">
        <button onClick={() => navigate('/suppliers')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          Назад
        </button>
        <EmptyState
          icon={Truck}
          title={is404 ? 'Поставщик не найден' : 'Ошибка загрузки'}
          description={is404 ? 'Возможно, он был удалён' : 'Проверьте подключение и попробуйте ещё раз'}
          action={!is404 ? { label: 'Повторить', onClick: () => window.location.reload() } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={() => navigate('/suppliers')} className="btn-secondary">
        <ArrowLeft className="w-4 h-4" />
        Назад к поставщикам
      </button>

      {/* Supplier info card */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
                {supplier.isSystem ? (
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-primary-50 text-primary-700">
                    Системный
                  </span>
                ) : null}
              </div>
              {isUsedPurchaseSupplier ? (
                <p className="mt-1 text-sm text-gray-500">
                  Через этого поставщика оформляется покупка б/у товаров у клиентов. Товар попадает на склад Б/У.
                </p>
              ) : (
                <>
                  {supplier.contactPerson && (
                    <p className="mt-1 text-gray-600 flex items-center gap-2">
                      <User className="w-4 h-4" />
                      {supplier.contactPerson}
                    </p>
                  )}
                  {supplier.phone && (
                    <p className="mt-1 text-gray-600 flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      {formatPhone(supplier.phone)}
                    </p>
                  )}
                  {supplier.comment && <p className="mt-2 text-sm text-gray-500">{supplier.comment}</p>}
                </>
              )}
            </div>
            {/* System suppliers are uneditable; backend would 403 anyway.
                Manage actions gated by suppliers_manage (owner-class bypass). */}
            {canManage &&
              (supplier.isSystem ? (
                <button
                  onClick={() => {
                    if (!usedWarehouse) {
                      toast.error('Склад Б/У не найден');
                      return;
                    }
                    setUsedPurchaseForm({ productName: '', qty: '', purchasePrice: '', category: '', note: '' });
                    setIsUsedPurchaseModalOpen(true);
                  }}
                  className="btn-primary flex-shrink-0"
                >
                  <Package className="w-4 h-4" />
                  Покупка б/у товара
                </button>
              ) : (
                <button onClick={openEditModal} className="btn-secondary flex-shrink-0">
                  <Edit2 className="w-4 h-4" />
                  Редактировать
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-label">Закупки всего</div>
          <div className="stat-value text-blue-600">{formatMoney(supplier.totalPurchases)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Оплачено</div>
          <div className="stat-value text-green-600">{formatMoney(supplier.totalPaid)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Текущий долг</div>
          <div className={`stat-value ${supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {formatMoney(supplier.currentDebt)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'deliveries'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck className="w-4 h-4 inline-block mr-1.5" />
          Поставки ({deliveries.length})
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'payments'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <CreditCard className="w-4 h-4 inline-block mr-1.5" />
          Оплаты ({payments.length})
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'returns'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Undo2 className="w-4 h-4 inline-block mr-1.5" />
          Возвраты ({returns.length})
        </button>
      </div>

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          {/* The "Новая поставка" action is hidden for the pinned
              used_purchase supplier — deliveries against that row are
              created via the dedicated "Покупка б/у товара" CTA above.
              Gated by suppliers_manage (owner-class bypass). */}
          {canManage && !isUsedPurchaseSupplier && (
            <div className="flex justify-end">
              <button onClick={openDeliveryModal} className="btn-primary">
                <Plus className="w-4 h-4" />
                Новая поставка
              </button>
            </div>
          )}

          {deliveries.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="Нет поставок"
              description="Создайте первую поставку от этого поставщика"
              action={canManage ? { label: 'Новая поставка', onClick: openDeliveryModal } : undefined}
            />
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => (
                <div key={delivery.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        <p className="text-sm font-semibold text-gray-900">
                          {format(new Date(delivery.date), 'dd MMM yyyy', { locale: ru })}
                        </p>
                      </div>
                      {delivery.comment && <p className="text-xs text-gray-500 mt-1.5 truncate">{delivery.comment}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-primary-600">{formatMoney(delivery.totalAmount)}</p>
                      <div className="mt-1">{statusBadge(delivery.paymentStatus)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <button onClick={openPaymentModal} className="btn-primary">
                <Plus className="w-4 h-4" />
                Новая оплата
              </button>
            </div>
          )}

          {payments.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Нет оплат"
              description="Запишите первую оплату поставщику"
              action={canManage ? { label: 'Новая оплата', onClick: openPaymentModal } : undefined}
            />
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => (
                <div key={payment.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        <p className="text-sm font-semibold text-gray-900">
                          {format(new Date(payment.date), 'dd MMM yyyy', { locale: ru })}
                        </p>
                      </div>
                      {payment.comment && <p className="text-xs text-gray-500 mt-1.5 truncate">{payment.comment}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-green-600">{formatMoney(payment.amount)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Returns Tab — defect returns to this supplier */}
      {activeTab === 'returns' && (
        <div className="space-y-4">
          {/* Same rationale as deliveries — defect returns make no
              sense against the used_purchase row. Gated by suppliers_manage. */}
          {canManage && !isUsedPurchaseSupplier && (
            <div className="flex justify-end">
              <button onClick={openReturnModal} className="btn-secondary" disabled={!defectWarehouse}>
                <Undo2 className="w-4 h-4" />
                Возврат брака
              </button>
            </div>
          )}

          {returns.length === 0 ? (
            <EmptyState
              icon={Undo2}
              title="Нет возвратов"
              description={
                defectWarehouse ? 'Здесь будет история возвратов брака этому поставщику' : 'Склад брака ещё не создан'
              }
              action={canManage && defectWarehouse ? { label: 'Возврат брака', onClick: openReturnModal } : undefined}
            />
          ) : (
            <div className="space-y-2">
              {returns.map((m) => {
                const qty = Math.abs(m.quantity);
                return (
                  <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          <p className="text-sm font-semibold text-gray-900">
                            {format(new Date(m.createdAt), 'dd MMM yyyy', { locale: ru })}
                          </p>
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1.5">{m.product?.name || '—'}</p>
                        {m.reason && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{m.reason}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-base font-bold text-rose-600">−{qty} шт</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit Supplier Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Редактировать поставщика">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="label">Название *</label>
            <input
              type="text"
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Контактное лицо</label>
            <input
              type="text"
              className="input"
              value={editForm.contactPerson}
              onChange={(e) => setEditForm({ ...editForm, contactPerson: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Телефон</label>
            <PhoneInput value={editForm.phone} onChange={(val) => setEditForm({ ...editForm, phone: val })} />
          </div>
          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={3}
              value={editForm.comment}
              onChange={(e) => setEditForm({ ...editForm, comment: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setIsEditModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={updateMutation.isPending} className="btn-primary">
              {updateMutation.isPending ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Delivery Modal */}
      <Modal
        isOpen={isDeliveryModalOpen}
        onClose={() => setIsDeliveryModalOpen(false)}
        title="Новая поставка"
        size="lg"
      >
        <form onSubmit={handleDeliverySubmit} className="space-y-4">
          <div>
            <label className="label">Дата</label>
            <input
              type="date"
              className="input w-40"
              value={deliveryForm.date}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, date: e.target.value })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Товары</label>
              <button
                type="button"
                onClick={() => setShowDeliveryPicker(true)}
                className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Добавить
              </button>
            </div>

            {deliveryForm.items.filter((i) => i.productId).length === 0 ? (
              <button
                type="button"
                onClick={() => setShowDeliveryPicker(true)}
                className="w-full py-8 border-2 border-dashed border-gray-200 rounded-xl text-center hover:border-primary-300 hover:bg-primary-50/30 transition-colors"
              >
                <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Нажмите чтобы добавить товар</p>
              </button>
            ) : (
              <div className="space-y-2">
                {deliveryForm.items.map((item, index) => {
                  if (!item.productId) return null;
                  const product = products.find((p) => p.id === item.productId);
                  return (
                    <div key={index} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{product?.name || 'Товар'}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="number"
                            min={0}
                            value={item.price || ''}
                            onChange={(e) => updateDeliveryItem(index, 'price', parseFloat(e.target.value) || 0)}
                            className="w-20 text-xs text-right border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder="Цена"
                          />
                          <span className="text-xs text-gray-400">₽/шт</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.quantity > 1) updateDeliveryItem(index, 'quantity', item.quantity - 1);
                          }}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateDeliveryItem(index, 'quantity', item.quantity + 1)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="text-sm font-semibold text-gray-700 flex-shrink-0 w-20 text-right">
                        {formatMoney(item.quantity * item.price)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDeliveryItem(index)}
                        className="p-1 text-red-400 hover:text-red-600 flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={deliveryForm.comment}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, comment: e.target.value })}
              placeholder="Примечание к поставке..."
            />
          </div>

          <div className="text-right text-sm font-semibold text-gray-700">
            Итого: {formatMoney(deliveryForm.items.reduce((sum, item) => sum + item.quantity * item.price, 0))}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setIsDeliveryModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={createDeliveryMutation.isPending} className="btn-primary">
              {createDeliveryMutation.isPending ? 'Сохранение...' : 'Создать поставку'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delivery Product Picker (fullscreen) */}
      <DeliveryProductPicker
        isOpen={showDeliveryPicker}
        onClose={() => setShowDeliveryPicker(false)}
        products={products}
        onSelect={handleDeliveryProductSelected}
      />

      {/* Create Payment Modal */}
      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Новая оплата поставщику">
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          <div>
            <label className="label">Сумма *</label>
            <input
              type="number"
              className="input"
              min={0}
              value={paymentForm.amount || ''}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  amount: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Дата</label>
            <input
              type="date"
              className="input"
              value={paymentForm.date}
              onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={paymentForm.comment}
              onChange={(e) => setPaymentForm({ ...paymentForm, comment: e.target.value })}
              placeholder="Примечание к оплате..."
            />
          </div>

          {supplier.currentDebt > 0 && (
            <p className="text-sm text-gray-500">
              Текущий долг: <span className="font-medium text-red-600">{formatMoney(supplier.currentDebt)}</span>
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={createPaymentMutation.isPending} className="btn-primary">
              {createPaymentMutation.isPending ? 'Сохранение...' : 'Записать оплату'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Return Defect Modal */}
      <Modal isOpen={isReturnModalOpen} onClose={() => setIsReturnModalOpen(false)} title="Возврат брака поставщику">
        <form onSubmit={handleReturnSubmit} className="space-y-4">
          <p className="text-xs text-gray-500">
            Возврат уменьшает остаток на складе брака и снижает долг перед поставщиком на сумму закупки.
          </p>

          {/* Product picker trigger */}
          <div>
            <label className="label">Товар *</label>
            {returnForm.productId ? (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <Package className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{returnForm.productName}</p>
                  <p className="text-[11px] text-gray-500">На складе брака: {returnForm.productStock} шт</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReturnPicker(true)}
                  className="text-primary-600 text-xs font-medium flex-shrink-0 hover:text-primary-700"
                >
                  Изменить
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowReturnPicker(true)}
                className="w-full py-6 border-2 border-dashed border-gray-200 rounded-xl text-center hover:border-amber-300 hover:bg-amber-50/30 transition-colors"
                disabled={!defectWarehouse}
              >
                <Package className="w-7 h-7 text-gray-300 mx-auto mb-1.5" />
                <p className="text-sm text-gray-400">Выбрать товар из склада брака</p>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Кол-во *</label>
              <input
                type="number"
                className="input"
                min={1}
                step="1"
                value={returnForm.qty}
                onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Цена закупки</label>
              <input
                type="number"
                className="input"
                min={0}
                step="0.01"
                value={returnForm.purchasePrice}
                onChange={(e) => setReturnForm({ ...returnForm, purchasePrice: e.target.value })}
                placeholder="Будет взята из товара"
              />
            </div>
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={returnForm.note}
              onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
              placeholder="Например: дефект упаковки, не подошёл и т. д."
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setIsReturnModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={returnDefectMutation.isPending} className="btn-primary">
              {returnDefectMutation.isPending ? 'Сохранение...' : 'Оформить возврат'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Return Product Picker — only defect-warehouse products */}
      <DeliveryProductPicker
        isOpen={showReturnPicker}
        onClose={() => setShowReturnPicker(false)}
        products={defectProducts}
        onSelect={handleReturnProductSelected}
      />

      {/* Used-purchase modal — free-form product name / qty / price /
          optional Б/У folder. Backend auto-creates or increments the
          matching SKU on the used warehouse. */}
      <Modal
        isOpen={isUsedPurchaseModalOpen}
        onClose={() => setIsUsedPurchaseModalOpen(false)}
        title="Покупка б/у товара"
      >
        <form onSubmit={handleUsedPurchaseSubmit} className="space-y-4">
          <p className="text-xs text-gray-500">
            Товар будет добавлен на склад Б/У. Долг поставщику вырастет на сумму закупки — погасите его позже через
            «Новая оплата».
          </p>

          <div>
            <label className="label">Название товара *</label>
            <input
              type="text"
              className="input"
              value={usedPurchaseForm.productName}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, productName: e.target.value })}
              placeholder="Например: Капот"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Количество *</label>
              <input
                type="number"
                className="input"
                min={1}
                step="1"
                value={usedPurchaseForm.qty}
                onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, qty: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="label">Закупочная цена, ₽ *</label>
              <input
                type="number"
                className="input"
                min={0}
                step="0.01"
                value={usedPurchaseForm.purchasePrice}
                onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, purchasePrice: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="label">Папка на складе Б/У</label>
            <input
              type="text"
              className="input"
              value={usedPurchaseForm.category}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, category: e.target.value })}
              placeholder="Необязательно"
            />
            {usedCategories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {usedCategories.slice(0, 16).map((cat) => {
                  const active = usedPurchaseForm.category === cat.path;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setUsedPurchaseForm({ ...usedPurchaseForm, category: cat.path })}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? 'border-primary-500 bg-primary-50 text-primary-700 font-semibold'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {cat.path}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {Number(usedPurchaseForm.qty) > 0 && Number(usedPurchaseForm.purchasePrice) >= 0 ? (
            <div className="flex items-center justify-between text-sm font-semibold pt-3 border-t border-gray-200">
              <span className="text-gray-700">Долг вырастет на:</span>
              <span className="text-rose-600">
                +{formatMoney(Number(usedPurchaseForm.qty) * Number(usedPurchaseForm.purchasePrice))}
              </span>
            </div>
          ) : null}

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={usedPurchaseForm.note}
              onChange={(e) => setUsedPurchaseForm({ ...usedPurchaseForm, note: e.target.value })}
              placeholder="Необязательно"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setIsUsedPurchaseModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={usedPurchaseMutation.isPending} className="btn-primary">
              {usedPurchaseMutation.isPending ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
