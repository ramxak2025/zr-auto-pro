import { useState, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Pencil,
  Plus,
  Loader2,
  Truck,
  Wallet,
  Package,
  CreditCard,
  Trash2,
} from 'lucide-react';
import { suppliersApi, productsApi } from '../api/services';
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
      phone: phone.trim(),
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
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
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
  const [lines, setLines] = useState<DeliveryLineInput[]>([
    { key: crypto.randomUUID(), productId: '', quantity: 1, price: 0 },
  ]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), productId: '', quantity: 1, price: 0 },
    ]);
  }

  function updateLine(key: string, field: Partial<DeliveryLineInput>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, ...field };
        // Auto-fill price from product costPrice
        if (field.productId) {
          const product = products.find((p) => p.id === field.productId);
          if (product) updated.price = product.costPrice;
        }
        return updated;
      }),
    );
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
      items: validLines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        price: l.price,
      })),
      comment: comment.trim(),
    });
  }

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Новая поставка" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Дата
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 max-w-xs"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Товары</label>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
            >
              <Plus className="h-4 w-4" />
              Добавить строку
            </button>
          </div>

          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-3">
              <select
                value={line.productId}
                onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
              >
                <option value="">Выберите товар</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={line.quantity}
                onChange={(e) =>
                  updateLine(line.key, { quantity: parseInt(e.target.value) || 1 })
                }
                min="1"
                placeholder="Кол-во"
                className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
              />
              <input
                type="number"
                value={line.price}
                onChange={(e) =>
                  updateLine(line.key, {
                    price: parseFloat(e.target.value) || 0,
                  })
                }
                min="0"
                step="0.01"
                placeholder="Цена"
                className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
              />
              <span className="w-28 text-right text-sm font-medium text-gray-900">
                {formatMoney(line.price * line.quantity)}
              </span>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex justify-end text-sm font-semibold text-gray-900">
            Итого: {formatMoney(total)}
          </div>
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
    onError: () => toast.error('Не удалось обновить поставщика'),
  });

  const createDeliveryMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createDelivery(id!, data),
    onSuccess: () => {
      toast.success('Поставка создана');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] });
      setDeliveryOpen(false);
    },
    onError: () => toast.error('Не удалось создать поставку'),
  });

  const createPaymentMutation = useMutation({
    mutationFn: (data: any) => suppliersApi.createPayment(id!, data),
    onSuccess: () => {
      toast.success('Оплата зарегистрирована');
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] });
      setPaymentOpen(false);
    },
    onError: () => toast.error('Не удалось создать оплату'),
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
