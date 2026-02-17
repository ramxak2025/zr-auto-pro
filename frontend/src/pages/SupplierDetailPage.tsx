import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Edit2,
  Plus,
  Truck,
  CreditCard,
  Package,
  Phone,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { suppliersApi, productsApi } from '../api/services';
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
} from '../types';

type TabType = 'deliveries' | 'payments';

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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'UZS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function statusBadge(status: string) {
  switch (status) {
    case 'paid':
      return <span className="badge-success">Оплачено</span>;
    case 'partial':
      return <span className="badge-warning">Частично</span>;
    case 'unpaid':
      return <span className="badge-danger">Не оплачено</span>;
    default:
      return <span className="badge-default">{status}</span>;
  }
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabType>('deliveries');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Supplier data
  const {
    data: supplier,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => suppliersApi.getById(id!),
    select: (res) => res.data as Supplier,
    enabled: !!id,
  });

  // Deliveries
  const { data: deliveriesData } = useQuery({
    queryKey: ['supplier-deliveries', id],
    queryFn: () => suppliersApi.getDeliveries({ supplierId: id }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : ((d as PaginatedResponse<Delivery>).data || []);
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
      return Array.isArray(d) ? d : ((d as PaginatedResponse<SupplierPayment>).data || []);
    },
    enabled: !!id,
  });
  const payments: SupplierPayment[] = paymentsData || [];

  // Products for delivery items
  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.getAll({ limit: 1000 }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : ((d as PaginatedResponse<Product>).data || []);
    },
  });
  const products: Product[] = productsData || [];

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
  const [deliveryForm, setDeliveryForm] =
    useState<DeliveryFormData>(emptyDeliveryForm);

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

  const removeDeliveryItem = (index: number) => {
    if (deliveryForm.items.length <= 1) return;
    setDeliveryForm({
      ...deliveryForm,
      items: deliveryForm.items.filter((_, i) => i !== index),
    });
  };

  const updateDeliveryItem = (
    index: number,
    field: keyof DeliveryItemForm,
    value: string | number
  ) => {
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
    const validItems = deliveryForm.items.filter(
      (item) => item.productId && item.quantity > 0 && item.price > 0
    );
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
  const [paymentForm, setPaymentForm] =
    useState<PaymentFormData>(emptyPaymentForm);

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

  if (isLoading) return <LoadingSpinner />;

  if (isError || !supplier) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/suppliers')}
          className="btn-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад
        </button>
        <EmptyState
          icon={Truck}
          title="Поставщик не найден"
          description="Возможно, он был удален"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/suppliers')}
        className="btn-secondary"
      >
        <ArrowLeft className="w-4 h-4" />
        Назад к поставщикам
      </button>

      {/* Supplier info card */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {supplier.name}
              </h1>
              {supplier.contactPerson && (
                <p className="mt-1 text-gray-600 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {supplier.contactPerson}
                </p>
              )}
              {supplier.phone && (
                <p className="mt-1 text-gray-600 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  {supplier.phone}
                </p>
              )}
              {supplier.comment && (
                <p className="mt-2 text-sm text-gray-500">{supplier.comment}</p>
              )}
            </div>
            <button onClick={openEditModal} className="btn-secondary">
              <Edit2 className="w-4 h-4" />
              Редактировать
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-label">Закупки всего</div>
          <div className="stat-value text-blue-600">
            {formatCurrency(supplier.totalPurchases)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Оплачено</div>
          <div className="stat-value text-green-600">
            {formatCurrency(supplier.totalPaid)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Текущий долг</div>
          <div
            className={`stat-value ${
              supplier.currentDebt > 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            {formatCurrency(supplier.currentDebt)}
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
      </div>

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={openDeliveryModal} className="btn-primary">
              <Plus className="w-4 h-4" />
              Новая поставка
            </button>
          </div>

          {deliveries.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="Нет поставок"
              description="Создайте первую поставку от этого поставщика"
              action={{ label: 'Новая поставка', onClick: openDeliveryModal }}
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th className="text-right">Сумма</th>
                    <th>Статус</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="text-gray-900">
                        {format(new Date(delivery.date), 'dd.MM.yyyy', {
                          locale: ru,
                        })}
                      </td>
                      <td className="text-right font-medium text-gray-900">
                        {formatCurrency(delivery.totalAmount)}
                      </td>
                      <td>{statusBadge(delivery.paymentStatus)}</td>
                      <td className="text-gray-500 text-sm">
                        {delivery.comment || '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={openPaymentModal} className="btn-primary">
              <Plus className="w-4 h-4" />
              Новая оплата
            </button>
          </div>

          {payments.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Нет оплат"
              description="Запишите первую оплату поставщику"
              action={{ label: 'Новая оплата', onClick: openPaymentModal }}
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th className="text-right">Сумма</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="text-gray-900">
                        {format(new Date(payment.date), 'dd.MM.yyyy', {
                          locale: ru,
                        })}
                      </td>
                      <td className="text-right font-medium text-green-600">
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="text-gray-500 text-sm">
                        {payment.comment || '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Supplier Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Редактировать поставщика"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="label">Название *</label>
            <input
              type="text"
              className="input"
              value={editForm.name}
              onChange={(e) =>
                setEditForm({ ...editForm, name: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Контактное лицо</label>
            <input
              type="text"
              className="input"
              value={editForm.contactPerson}
              onChange={(e) =>
                setEditForm({ ...editForm, contactPerson: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Телефон</label>
            <PhoneInput
              value={editForm.phone}
              onChange={(val) => setEditForm({ ...editForm, phone: val })}
            />
          </div>
          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={3}
              value={editForm.comment}
              onChange={(e) =>
                setEditForm({ ...editForm, comment: e.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="btn-primary"
            >
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
              className="input"
              value={deliveryForm.date}
              onChange={(e) =>
                setDeliveryForm({ ...deliveryForm, date: e.target.value })
              }
            />
          </div>

          <div>
            <label className="label">Товары</label>
            <div className="space-y-3">
              {deliveryForm.items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-end gap-2 p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <label className="label text-xs">Товар</label>
                    <select
                      className="input"
                      value={item.productId}
                      onChange={(e) =>
                        updateDeliveryItem(index, 'productId', e.target.value)
                      }
                    >
                      <option value="">Выберите товар</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className="label text-xs">Кол-во</label>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateDeliveryItem(
                          index,
                          'quantity',
                          parseInt(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="w-32">
                    <label className="label text-xs">Цена</label>
                    <input
                      type="number"
                      className="input"
                      min={0}
                      value={item.price}
                      onChange={(e) =>
                        updateDeliveryItem(
                          index,
                          'price',
                          parseFloat(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="w-28 text-right text-sm font-medium text-gray-700 pb-2">
                    {formatCurrency(item.quantity * item.price)}
                  </div>
                  {deliveryForm.items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDeliveryItem(index)}
                      className="btn-secondary btn-sm text-red-500 hover:text-red-700 pb-2"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDeliveryItem}
              className="btn-secondary btn-sm mt-2"
            >
              <Plus className="w-3 h-3" />
              Добавить товар
            </button>
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={deliveryForm.comment}
              onChange={(e) =>
                setDeliveryForm({ ...deliveryForm, comment: e.target.value })
              }
              placeholder="Примечание к поставке..."
            />
          </div>

          <div className="text-right text-sm font-semibold text-gray-700">
            Итого:{' '}
            {formatCurrency(
              deliveryForm.items.reduce(
                (sum, item) => sum + item.quantity * item.price,
                0
              )
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setIsDeliveryModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createDeliveryMutation.isPending}
              className="btn-primary"
            >
              {createDeliveryMutation.isPending
                ? 'Сохранение...'
                : 'Создать поставку'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Payment Modal */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title="Новая оплата поставщику"
      >
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
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, date: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Комментарий</label>
            <textarea
              className="input"
              rows={2}
              value={paymentForm.comment}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, comment: e.target.value })
              }
              placeholder="Примечание к оплате..."
            />
          </div>

          {supplier.currentDebt > 0 && (
            <p className="text-sm text-gray-500">
              Текущий долг:{' '}
              <span className="font-medium text-red-600">
                {formatCurrency(supplier.currentDebt)}
              </span>
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setIsPaymentModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createPaymentMutation.isPending}
              className="btn-primary"
            >
              {createPaymentMutation.isPending
                ? 'Сохранение...'
                : 'Записать оплату'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
