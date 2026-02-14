import { useState, useMemo, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getApiError } from '../api/axios';
import {
  ArrowLeft,
  Pencil,
  Plus,
  Minus,
  Loader2,
  Truck,
  Wallet,
  Package,
  CreditCard,
  Trash2,
  Search,
} from 'lucide-react';
import { suppliersApi, productsApi } from '../api/services';
import PhoneInput, { getPhoneRaw } from '../components/PhoneInput';
import type {
  Supplier,
  Delivery,
  SupplierPayment,
  Product,
  PaginatedResponse,
} from '../types';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

// ---------------------------------------------------------------------------
// Edit Supplier Modal
// ---------------------------------------------------------------------------

interface SupplierFormData {
  name: string;
  phone: string;
  contactPerson: string;
  comment: string;
}

interface SupplierEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier;
  onSubmit: (data: SupplierFormData) => void;
  isLoading: boolean;
}

function SupplierEditModal({
  isOpen,
  onClose,
  supplier,
  onSubmit,
  isLoading,
}: SupplierEditModalProps) {
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone || '');
  const [contactPerson, setContactPerson] = useState(supplier.contactPerson || '');
  const [comment, setComment] = useState(supplier.comment || '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название');
      return;
    }
    onSubmit({
      name: name.trim(),
      phone: getPhoneRaw(phone),
      contactPerson: contactPerson.trim(),
      comment: comment.trim(),
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать поставщика">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Телефон
          </label>
          <PhoneInput
            value={phone}
            onChange={setPhone}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Контактное лицо
          </label>
          <input
            type="text"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delivery Create Modal
// ---------------------------------------------------------------------------

interface DeliveryLineInput {
  key: string;
  productId: string;
  quantity: number;
  price: number;
}

interface DeliveryCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    date: string;
    items: { productId: string; quantity: number; price: number }[];
    comment: string;
  }) => void;
  isLoading: boolean;
  products: Product[];
}

function DeliveryCreateModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  products,
}: DeliveryCreateModalProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<DeliveryLineInput[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');

  // Build categories from products
  const categories = useMemo(() => {
    const catMap = new Map<string, Product[]>();
    products.forEach((p) => {
      const cat = p.category || 'Без категории';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(p);
    });
    return catMap;
  }, [products]);

  function addProduct(product: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        key: crypto.randomUUID(), productId: product.id, quantity: 1, price: product.costPrice,
        _name: product.name, _image: product.photo,
      }];
    });
  }

  function updateLineQty(key: string, qty: number) {
    if (qty <= 0) setLines((prev) => prev.filter((l) => l.key !== key));
    else setLines((prev) => prev.map((l) => l.key === key ? { ...l, quantity: qty } : l));
  }

  function updateLinePrice(key: string, price: number) {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, price } : l));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (validLines.length === 0) {
      toast.error('Добавьте хотя бы один товар');
      return;
    }
    onSubmit({
      date,
      items: validLines.map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price })),
      comment: comment.trim(),
    });
  }

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  // Filter products in catalog
  const filteredProducts = useMemo(() => {
    let items = catalogCategory ? (categories.get(catalogCategory) || []) : products;
    if (catalogSearch) {
      const q = catalogSearch.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(q));
    }
    return items;
  }, [catalogCategory, catalogSearch, products, categories]);

  // Get qty in cart for a product
  function getCartQty(productId: string): number {
    return lines.find((l) => l.productId === productId)?.quantity || 0;
  }

  if (!isOpen) return null;

  // Fullscreen product catalog
  if (showCatalog) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <button type="button" onClick={() => { if (catalogCategory) setCatalogCategory(null); else setShowCatalog(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-bold text-gray-900 flex-1">
            {catalogCategory || 'Выберите товар'}
          </h2>
          {lines.length > 0 && (
            <button type="button" onClick={() => setShowCatalog(false)}
              className="flex items-center gap-1.5 rounded-xl bg-primary-600 text-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-primary-700">
              <Package className="h-4 w-4" />
              {lines.length} шт
            </button>
          )}
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Поиск товара..." className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!catalogCategory && !catalogSearch ? (
            // Category grid
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[...categories.entries()].map(([cat, items]) => (
                <button key={cat} type="button" onClick={() => setCatalogCategory(cat)}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 hover:border-primary-300 hover:shadow-md transition-all active:scale-95">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-2xl">
                    {items[0]?.photo ? (
                      <img src={items[0].photo} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : '📦'}
                  </div>
                  <span className="text-sm font-semibold text-gray-900 text-center">{cat}</span>
                  <span className="text-[11px] text-gray-400">{items.length} товаров</span>
                </button>
              ))}
            </div>
          ) : (
            // Product grid
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredProducts.map((p) => {
                const qty = getCartQty(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-all active:scale-95 ${
                      qty > 0 ? 'border-primary-400 bg-primary-50/50 shadow-sm' : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md'
                    }`}>
                    {p.photo ? (
                      <img src={p.photo} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
                        <Package className="h-6 w-6" />
                      </div>
                    )}
                    <span className="text-xs font-semibold text-gray-900 text-center leading-tight line-clamp-2">{p.name}</span>
                    <span className="text-[11px] text-gray-500">{formatMoney(p.costPrice)}</span>
                    {qty > 0 && (
                      <div className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white text-[11px] font-bold shadow-sm">
                        {qty}
                      </div>
                    )}
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="col-span-full p-8 text-center text-sm text-gray-400">Ничего не найдено</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Новая поставка" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Дата</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => setShowCatalog(true)}
              className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition-colors w-full justify-center">
              <Package className="h-4 w-4" />Добавить товар
            </button>
          </div>
        </div>

        {/* Added products */}
        {lines.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-gray-200 rounded-xl">
            <Package className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Нажмите "Добавить товар" для выбора</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              return (
                <div key={line.key} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                  {(line as any)._image || product?.photo ? (
                    <img src={(line as any)._image || product?.photo} alt="" className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400 flex-shrink-0">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{(line as any)._name || product?.name || line.productId}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
                        <button type="button" onClick={() => updateLineQty(line.key, line.quantity - 1)}
                          className="px-2 py-1 text-gray-500 hover:bg-gray-100"><Minus className="h-3 w-3" /></button>
                        <span className="px-2 text-sm font-semibold text-gray-900 min-w-[24px] text-center">{line.quantity}</span>
                        <button type="button" onClick={() => updateLineQty(line.key, line.quantity + 1)}
                          className="px-2 py-1 text-gray-500 hover:bg-gray-100"><Plus className="h-3 w-3" /></button>
                      </div>
                      <span className="text-gray-300 text-xs">&times;</span>
                      <input type="number" value={line.price} onChange={(e) => updateLinePrice(line.key, parseFloat(e.target.value) || 0)}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:border-primary-400 focus:outline-none" min="0" step="0.01" />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{formatMoney(line.price * line.quantity)}</p>
                    <button type="button" onClick={() => removeLine(line.key)}
                      className="text-gray-300 hover:text-red-500 mt-1"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end text-base font-bold text-gray-900 pt-2">
              Итого: {formatMoney(total)}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Отмена
          </button>
          <button type="submit" disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Создать поставку
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Payment Create Modal
// ---------------------------------------------------------------------------

interface PaymentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { amount: number; date: string; comment: string }) => void;
  isLoading: boolean;
  currentDebt: number;
}

function PaymentCreateModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  currentDebt,
}: PaymentCreateModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [comment, setComment] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }
    onSubmit({
      amount: val,
      date,
      comment: comment.trim(),
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Новая оплата">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Текущий долг:{' '}
          <span className="font-semibold text-red-600">
            {formatMoney(currentDebt)}
          </span>
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Сумма <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            placeholder="0"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Дата
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Оплатить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabKey = 'deliveries' | 'payments';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const LIMIT = 20;

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('deliveries');
  const [editOpen, setEditOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);

  // ---- Queries ----

  const {
    data: supplier,
    isLoading,
    isError,
  } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const res = await suppliersApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: deliveriesData } = useQuery<PaginatedResponse<Delivery>>({
    queryKey: ['supplier-deliveries', id, deliveryPage],
    queryFn: async () => {
      const res = await suppliersApi.getDeliveries(id!, {
        page: deliveryPage,
        limit: LIMIT,
      });
      return res.data;
    },
    enabled: !!id && activeTab === 'deliveries',
    keepPreviousData: true,
  } as any);

  const { data: paymentsData } = useQuery<PaginatedResponse<SupplierPayment>>({
    queryKey: ['supplier-payments', id, paymentPage],
    queryFn: async () => {
      const res = await suppliersApi.getPayments(id!, {
        page: paymentPage,
        limit: LIMIT,
      });
      return res.data;
    },
    enabled: !!id && activeTab === 'payments',
    keepPreviousData: true,
  } as any);

  const { data: productsData } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products-all-for-delivery'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data;
    },
    staleTime: 5 * 60_000,
    enabled: deliveryOpen,
  });

  // ---- Mutations ----

  const updateSupplierMutation = useMutation({
    mutationFn: (data: SupplierFormData) => suppliersApi.update(id!, data),
    onSuccess: () => {
      toast.success('Поставщик обновлён');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      setEditOpen(false);
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось обновить поставщика')),
  });

  const createDeliveryMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createDelivery(id!, data),
    onSuccess: () => {
      toast.success('Поставка создана');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      setDeliveryOpen(false);
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось создать поставку')),
  });

  const createPaymentMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createPayment(id!, data),
    onSuccess: () => {
      toast.success('Оплата зарегистрирована');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] });
      setPaymentOpen(false);
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось создать оплату')),
  });

  // ---- Render ----

  if (isLoading) return <LoadingSpinner />;

  if (isError || !supplier) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/suppliers')}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к поставщикам
        </button>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Поставщик не найден</p>
        </div>
      </div>
    );
  }

  const deliveries = deliveriesData?.data || [];
  const deliveriesTotal = deliveriesData?.total || 0;
  const payments = paymentsData?.data || [];
  const paymentsTotal = paymentsData?.total || 0;
  const allProducts = productsData?.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/suppliers')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
            {supplier.contactPerson && (
              <p className="text-sm text-gray-500 mt-0.5">
                {supplier.contactPerson}
                {supplier.phone ? ` \u00B7 ${supplier.phone}` : ''}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Pencil className="h-4 w-4" />
          Редактировать
        </button>
      </div>

      {/* Financial cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <span className="text-sm text-gray-500">Закупки</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatMoney(supplier.totalPurchases)}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <CreditCard className="h-5 w-5 text-green-600" />
            </div>
            <span className="text-sm text-gray-500">Оплачено</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatMoney(supplier.totalPaid)}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
              <Wallet className="h-5 w-5 text-red-600" />
            </div>
            <span className="text-sm text-gray-500">Долг</span>
          </div>
          <p
            className={`text-2xl font-bold ${
              supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            {formatMoney(supplier.currentDebt)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('deliveries')}
            className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
              activeTab === 'deliveries'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Truck className="h-4 w-4" />
            Поставки
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
              activeTab === 'payments'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Wallet className="h-4 w-4" />
            Оплаты
          </button>
        </nav>
      </div>

      {/* Deliveries tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Поставки</h2>
            <button
              onClick={() => setDeliveryOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Новая поставка
            </button>
          </div>

          {deliveries.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <EmptyState
                icon={Truck}
                title="Нет поставок"
                description="Создайте первую поставку от этого поставщика"
              />
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/50">
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Дата
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Товаров
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                          Сумма
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Статус
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Комментарий
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deliveries.map((delivery) => {
                        const statusMap: Record<
                          string,
                          { label: string; className: string }
                        > = {
                          paid: {
                            label: 'Оплачена',
                            className: 'bg-green-50 text-green-700 border-green-200',
                          },
                          partial: {
                            label: 'Частично',
                            className:
                              'bg-yellow-50 text-yellow-700 border-yellow-200',
                          },
                          unpaid: {
                            label: 'Не оплачена',
                            className: 'bg-red-50 text-red-700 border-red-200',
                          },
                        };
                        const status =
                          statusMap[delivery.paymentStatus] || statusMap.unpaid;
                        return (
                          <tr key={delivery.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900">
                              {formatDate(delivery.date)}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {delivery.items?.length || 0}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900">
                              {formatMoney(delivery.totalAmount)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                              {delivery.comment || '\u2014'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <Pagination
                page={deliveryPage}
                total={deliveriesTotal}
                limit={LIMIT}
                onChange={setDeliveryPage}
              />
            </>
          )}
        </div>
      )}

      {/* Payments tab */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Оплаты</h2>
            <button
              onClick={() => setPaymentOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Новая оплата
            </button>
          </div>

          {payments.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <EmptyState
                icon={Wallet}
                title="Нет оплат"
                description="Зарегистрируйте оплату поставщику"
              />
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/50">
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Дата
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                          Сумма
                        </th>
                        <th className="px-4 py-3 font-semibold text-gray-600">
                          Комментарий
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900">
                            {formatDate(payment.date)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-green-600">
                            {formatMoney(payment.amount)}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {payment.comment || '\u2014'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Pagination
                page={paymentPage}
                total={paymentsTotal}
                limit={LIMIT}
                onChange={setPaymentPage}
              />
            </>
          )}
        </div>
      )}

      {/* Edit supplier modal */}
      {editOpen && supplier && (
        <SupplierEditModal
          key={supplier.id}
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          supplier={supplier}
          onSubmit={(data) => updateSupplierMutation.mutate(data)}
          isLoading={updateSupplierMutation.isPending}
        />
      )}

      {/* Delivery create modal */}
      {deliveryOpen && (
        <DeliveryCreateModal
          isOpen={deliveryOpen}
          onClose={() => setDeliveryOpen(false)}
          onSubmit={(data) => createDeliveryMutation.mutate(data)}
          isLoading={createDeliveryMutation.isPending}
          products={allProducts}
        />
      )}

      {/* Payment create modal */}
      {paymentOpen && (
        <PaymentCreateModal
          isOpen={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          onSubmit={(data) => createPaymentMutation.mutate(data)}
          isLoading={createPaymentMutation.isPending}
          currentDebt={supplier.currentDebt}
        />
      )}
    </div>
  );
}
