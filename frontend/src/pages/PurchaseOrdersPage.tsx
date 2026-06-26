import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';

import { purchaseOrdersApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import PurchaseOrderStatusBadge from '../components/PurchaseOrderStatusBadge';
import { UserRole } from '../types';
import type { PurchaseOrder, PurchaseOrderStatus, PaginatedResponse, Supplier } from '../types';
import { formatMoney, formatDateShort } from '../../../shared/utils/formatters';

const STATUS_TABS: { value: '' | PurchaseOrderStatus; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'ordered', label: 'Заказано' },
  { value: 'received', label: 'Получено' },
  { value: 'cancelled', label: 'Отменён' },
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { isRole } = useAuth();
  const canWrite = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [status, setStatus] = useState<'' | PurchaseOrderStatus>('');
  const [supplierId, setSupplierId] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', { status, supplierId, page }],
    queryFn: () =>
      purchaseOrdersApi.list({
        status: status || undefined,
        supplierId: supplierId || undefined,
        page,
        limit,
      }),
    select: (res) => res.data as PaginatedResponse<PurchaseOrder>,
  });

  // Supplier dropdown options
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', { search: '', page: 1, limit: 1000 }],
    queryFn: () => suppliersApi.getAll({ page: 1, limit: 1000 }),
    select: (res) => (res.data as PaginatedResponse<Supplier>).data,
    staleTime: 5 * 60 * 1000,
  });

  const orders = data?.data || [];
  const total = data?.total || 0;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Заказы поставщикам</h1>
        {canWrite && (
          <button onClick={() => navigate('/purchase-orders/new')} className="btn-primary">
            <Plus className="w-4 h-4" />
            Создать заказ
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Status pills */}
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <button
                key={tab.value || 'all'}
                onClick={() => {
                  setStatus(tab.value);
                  resetPage();
                }}
                className={`px-3.5 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                  active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Supplier filter */}
        <select
          className="input max-w-xs"
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            resetPage();
          }}
        >
          <option value="">Все поставщики</option>
          {(suppliers || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Нет заказов"
          description="Создайте заказ поставщику, чтобы пополнить склад"
          action={canWrite ? { label: 'Создать заказ', onClick: () => navigate('/purchase-orders/new') } : undefined}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {orders.map((po) => (
              <div
                key={po.id}
                onClick={() => navigate(`/purchase-orders/${po.id}`)}
                className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-semibold text-gray-900 text-sm truncate">
                    {po.supplierName || 'Без поставщика'}
                  </span>
                  <PurchaseOrderStatusBadge status={po.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {formatDateShort(po.createdAt)} · {po.itemCount ?? 0} поз.
                  </span>
                  <span className="font-semibold text-gray-900">{formatMoney(po.total)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th>Дата</th>
                  <th className="text-center">Позиций</th>
                  <th>Статус</th>
                  <th className="text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => (
                  <tr
                    key={po.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/purchase-orders/${po.id}`)}
                  >
                    <td className="font-medium text-gray-900">{po.supplierName || 'Без поставщика'}</td>
                    <td className="text-gray-600">{formatDateShort(po.createdAt)}</td>
                    <td className="text-center text-gray-600">{po.itemCount ?? 0}</td>
                    <td>
                      <PurchaseOrderStatusBadge status={po.status} />
                    </td>
                    <td className="text-right font-medium text-gray-900">{formatMoney(po.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      )}
    </div>
  );
}
