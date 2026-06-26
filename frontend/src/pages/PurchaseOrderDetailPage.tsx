import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, PackageCheck, XCircle, Send } from 'lucide-react';
import toast from 'react-hot-toast';

import { purchaseOrdersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import PurchaseOrderStatusBadge from '../components/PurchaseOrderStatusBadge';
import { UserRole } from '../types';
import type { PurchaseOrder, PurchaseOrderItem } from '../types';
import { formatMoney, formatDateTime } from '../../../shared/utils/formatters';

const outstanding = (it: PurchaseOrderItem) => Math.max(0, it.quantity - it.receivedQuantity);

export default function PurchaseOrderDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const canWrite = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [receiveMode, setReceiveMode] = useState(false);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrdersApi.getById(id!),
    select: (res) => res.data as PurchaseOrder,
    enabled: !!id,
  });

  // Caches touched when stock changes on receive.
  const invalidateAfterMutation = (next: PurchaseOrder) => {
    queryClient.setQueryData(['purchase-order', id], { data: next });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
  };

  // Receiving additionally moves stock — refresh product/warehouse caches.
  const invalidateStock = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['products-all'] });
    queryClient.invalidateQueries({ queryKey: ['low-stock'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-stats'] });
    queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order-suggestions'] });
  };

  const orderMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.order(id!),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      toast.success('Заказ оформлен');
    },
    onError: () => toast.error('Не удалось оформить заказ'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.cancel(id!),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      toast.success('Заказ отменён');
    },
    onError: () => toast.error('Не удалось отменить заказ'),
  });

  const receiveMutation = useMutation({
    mutationFn: (payload?: { items?: Array<{ itemId: string; receivedQuantity: number }> }) =>
      purchaseOrdersApi.receive(id!, payload),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      invalidateStock();
      setReceiveMode(false);
      setDeltas({});
      toast.success(res.data.status === 'received' ? 'Заказ получен полностью' : 'Приёмка проведена');
    },
    onError: () => toast.error('Не удалось провести приёмку'),
  });

  const isBusy = orderMutation.isPending || cancelMutation.isPending || receiveMutation.isPending;

  const items = useMemo(() => po?.items || [], [po]);

  const enterReceiveMode = () => {
    const init: Record<string, number> = {};
    for (const it of items) init[it.id] = outstanding(it);
    setDeltas(init);
    setReceiveMode(true);
  };

  const confirmPartialReceive = () => {
    const payloadItems = items
      .map((it) => ({ itemId: it.id, receivedQuantity: Math.min(deltas[it.id] || 0, outstanding(it)) }))
      .filter((x) => x.receivedQuantity > 0);
    if (payloadItems.length === 0) {
      toast.error('Укажите количество для приёмки');
      return;
    }
    receiveMutation.mutate({ items: payloadItems });
  };

  if (isLoading) return <LoadingSpinner />;
  if (!po) {
    return (
      <EmptyState
        title="Заказ не найден"
        action={{ label: 'К списку заказов', onClick: () => navigate('/purchase-orders') }}
      />
    );
  }

  const isDraft = po.status === 'draft';
  const isOrdered = po.status === 'ordered';

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/purchase-orders')}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{po.supplierName || 'Без поставщика'}</h1>
            <PurchaseOrderStatusBadge status={po.status} />
          </div>
          <p className="text-sm text-gray-500">{formatDateTime(po.createdAt)}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="card card-body space-y-2 text-sm">
        {po.createdByName && (
          <div className="flex justify-between">
            <span className="text-gray-500">Создал</span>
            <span className="text-gray-900">{po.createdByName}</span>
          </div>
        )}
        {po.orderedAt && (
          <div className="flex justify-between">
            <span className="text-gray-500">Оформлен</span>
            <span className="text-gray-900">{formatDateTime(po.orderedAt)}</span>
          </div>
        )}
        {po.receivedAt && (
          <div className="flex justify-between">
            <span className="text-gray-500">Получен</span>
            <span className="text-gray-900">{formatDateTime(po.receivedAt)}</span>
          </div>
        )}
        {po.note && (
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 flex-shrink-0">Комментарий</span>
            <span className="text-gray-900 text-right">{po.note}</span>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="text-center">Заказано</th>
              <th className="text-center">Принято</th>
              {receiveMode && <th className="text-center">Принять сейчас</th>}
              <th className="text-right">Цена</th>
              <th className="text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="font-medium text-gray-900">{it.name}</td>
                <td className="text-center text-gray-600">{it.quantity}</td>
                <td className="text-center text-gray-600">{it.receivedQuantity}</td>
                {receiveMode && (
                  <td className="text-center">
                    <input
                      type="number"
                      min={0}
                      max={outstanding(it)}
                      step="any"
                      inputMode="decimal"
                      className="input w-24 mx-auto text-center"
                      value={deltas[it.id] ?? 0}
                      disabled={outstanding(it) === 0}
                      onChange={(e) =>
                        setDeltas((prev) => ({
                          ...prev,
                          [it.id]: Math.min(Math.max(0, e.target.valueAsNumber || 0), outstanding(it)),
                        }))
                      }
                    />
                  </td>
                )}
                <td className="text-right text-gray-600">{formatMoney(it.costPrice)}</td>
                <td className="text-right font-medium text-gray-900">{formatMoney(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
          <span className="text-sm font-medium text-gray-600">Итого</span>
          <span className="text-lg font-bold text-gray-900">{formatMoney(po.total)}</span>
        </div>
      </div>

      {/* Actions */}
      {canWrite && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {receiveMode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setReceiveMode(false);
                  setDeltas({});
                }}
                disabled={isBusy}
                className="btn-secondary"
              >
                Отмена
              </button>
              <button type="button" onClick={confirmPartialReceive} disabled={isBusy} className="btn-primary">
                <PackageCheck className="w-4 h-4" />
                {receiveMutation.isPending ? 'Приёмка...' : 'Подтвердить приёмку'}
              </button>
            </>
          ) : (
            <>
              {isDraft && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
                    disabled={isBusy}
                    className="btn-secondary"
                  >
                    <Pencil className="w-4 h-4" />
                    Редактировать
                  </button>
                  <button type="button" onClick={() => setCancelOpen(true)} disabled={isBusy} className="btn-danger">
                    <XCircle className="w-4 h-4" />
                    Отменить
                  </button>
                  <button
                    type="button"
                    onClick={() => orderMutation.mutate()}
                    disabled={isBusy}
                    className="btn-primary"
                  >
                    <Send className="w-4 h-4" />
                    {orderMutation.isPending ? 'Оформление...' : 'Оформить заказ'}
                  </button>
                </>
              )}
              {isOrdered && (
                <>
                  <button type="button" onClick={() => setCancelOpen(true)} disabled={isBusy} className="btn-danger">
                    <XCircle className="w-4 h-4" />
                    Отменить
                  </button>
                  <button type="button" onClick={enterReceiveMode} disabled={isBusy} className="btn-secondary">
                    Принять частично
                  </button>
                  <button
                    type="button"
                    onClick={() => receiveMutation.mutate(undefined)}
                    disabled={isBusy}
                    className="btn-primary"
                  >
                    <PackageCheck className="w-4 h-4" />
                    {receiveMutation.isPending ? 'Приёмка...' : 'Принять всё'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Отменить заказ?"
        message="Заказ будет переведён в статус «Отменён». Это действие нельзя отменить."
        confirmText="Отменить заказ"
        variant="danger"
      />
    </div>
  );
}
