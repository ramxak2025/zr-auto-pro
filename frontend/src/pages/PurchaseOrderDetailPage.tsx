import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, PackageCheck, XCircle, Send, Clock, Wallet, CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';

import { purchaseOrdersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import InlineLoader from '../components/InlineLoader';
import QueryState from '../components/QueryState';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import PurchaseOrderStatusBadge from '../components/PurchaseOrderStatusBadge';

import type { PurchaseOrder, PurchaseOrderItem } from '../types';
import { formatMoney, formatDateTime, formatDateShort, formatDayKey } from '../../../shared/utils/formatters';
import { useTenantTimezone } from '../hooks/useTenantTimezone';

const outstanding = (it: PurchaseOrderItem) => Math.max(0, it.quantity - it.receivedQuantity);

// Закупочная цена из free-text поля («12,5» → 12.5); мусор/отрицательное → 0.
const parsePrice = (t: string): number => {
  const n = parseFloat((t || '').replace(',', '.'));
  return Number.isNaN(n) || n < 0 ? 0 : n;
};

type PayMode = 'debt' | 'paid';
type ReceiveLine = { itemId: string; receivedQuantity: number; purchasePrice: number };

export default function PurchaseOrderDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Мутации заказа (приёмка/отмена/правка) — suppliers_manage (волна Битрикс24).
  const canWrite = hasPermission('suppliers_manage');
  // «Сегодня» календарём АВТОСЕРВИСА, а не браузера (157). Потолок даты
  // поставки сервер считает в поясе тенанта: бухгалтер, открывший админку из
  // другого региона, иначе либо не мог выбрать сегодняшний день, либо получал
  // 400 на дате, которую ему разрешил выбрать `max` у input.
  const tenantTz = useTenantTimezone();
  const today = formatDayKey(new Date(), tenantTz);

  const [receiveMode, setReceiveMode] = useState(false);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  // Закупочная цена за единицу по строке (free-text, чтобы «12,5» печаталось
  // чисто) — приёмка в supply-режиме обновляет cost_price товара (миграция 098).
  const [prices, setPrices] = useState<Record<string, string>>({});
  // Выбранный способ приёмки для подтверждения: 'debt' (в долг) / 'paid'
  // (оплатить сразу). null — диалог закрыт.
  const [pendingMode, setPendingMode] = useState<PayMode | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Дата поставки (159): при приёмке — выбирается (в т.ч. прошедшая), у
  // проведённой поставки — меняется задним числом через модалку.
  const [receiveDate, setReceiveDate] = useState<string>(() => today);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [newDate, setNewDate] = useState<string>('');

  const {
    data: po,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
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

  // Каждая приёмка на вебе теперь идёт в supply-режиме (миграция 098): шлём
  // paymentMode + закупочные цены → сервер обновляет cost_price товара, заводит
  // поставку и либо растит долг поставщику ('debt'), либо создаёт авто-платёж
  // ('paid'). Инвалидируем леджер поставщика, чтобы Поставки/Платежи/Долг
  // освежились сразу.
  const receiveMutation = useMutation({
    // `receivedAt` шлём ТОЛЬКО когда владелец реально выбрал другую дату:
    // «сегодня» в браузере дальневосточного пояса может быть «завтра» по МСК,
    // и сервер честно отклонил бы такую приёмку как будущую. Без поля сервер
    // ставит свой текущий момент — прежнее поведение.
    mutationFn: (vars: { items: ReceiveLine[]; paymentMode: PayMode; receivedAt?: string }) =>
      purchaseOrdersApi.receive(id!, vars),
    onSuccess: (res, vars) => {
      invalidateAfterMutation(res.data);
      invalidateStock();
      const supplierId = res.data.supplierId;
      if (supplierId) {
        queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-payments', supplierId] });
      }
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setReceiveMode(false);
      setDeltas({});
      setPrices({});
      const total = vars.items.reduce((s, l) => s + l.receivedQuantity * l.purchasePrice, 0);
      const dateSuffix = vars.receivedAt ? ` (дата поставки ${vars.receivedAt.split('-').reverse().join('.')})` : '';
      setReceiveDate(today);
      toast.success(
        (vars.paymentMode === 'paid'
          ? `Поставка на ${formatMoney(total)} принята и оплачена`
          : `Поставка на ${formatMoney(total)} принята в долг поставщику`) + dateSuffix,
      );
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Не удалось провести приёмку'),
  });

  // Смена даты УЖЕ ПРОВЕДЁННОЙ поставки (159). Сервер одной транзакцией
  // переносит на новую дату накладную, оплату, движения склада и received_at.
  const changeDateMutation = useMutation({
    mutationFn: (date: string) => purchaseOrdersApi.changeDate(id!, date),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      invalidateStock();
      const supplierId = res.data.supplierId;
      if (supplierId) {
        queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-payments', supplierId] });
      }
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setDateModalOpen(false);
      toast.success('Дата поставки изменена');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Не удалось изменить дату поставки'),
  });

  const isBusy =
    orderMutation.isPending || cancelMutation.isPending || receiveMutation.isPending || changeDateMutation.isPending;

  const items = useMemo(() => po?.items || [], [po]);

  const enterReceiveMode = () => {
    const initDeltas: Record<string, number> = {};
    const initPrices: Record<string, string> = {};
    for (const it of items) {
      initDeltas[it.id] = outstanding(it);
      // По умолчанию — цена из заказа (снимок costPrice); владелец правит по факту.
      initPrices[it.id] = it.costPrice ? String(it.costPrice) : '';
    }
    setDeltas(initDeltas);
    setPrices(initPrices);
    setReceiveDate(today);
    setReceiveMode(true);
  };

  // Строки к приёмке — только с положительным «принять сейчас» (кламп к остатку).
  const buildReceiveItems = (): ReceiveLine[] =>
    items
      .map((it) => {
        const qty = Math.min(deltas[it.id] || 0, outstanding(it));
        if (qty <= 0) return null;
        return { itemId: it.id, receivedQuantity: qty, purchasePrice: parsePrice(prices[it.id] ?? '') };
      })
      .filter((x): x is ReceiveLine => x != null);

  // «Стоимость накладной» = Σ(принято × закупочная цена) по принимаемым строкам.
  const invoiceTotal = useMemo(
    () =>
      items.reduce((sum, it) => {
        const qty = Math.min(deltas[it.id] || 0, outstanding(it));
        if (qty <= 0) return sum;
        return sum + qty * parsePrice(prices[it.id] ?? '');
      }, 0),
    [items, deltas, prices],
  );

  const choosePayMode = (mode: PayMode) => {
    if (buildReceiveItems().length === 0) {
      toast.error('Укажите количество для приёмки');
      return;
    }
    setPendingMode(mode);
  };

  const confirmReceive = () => {
    if (!pendingMode) return;
    const payloadItems = buildReceiveItems();
    if (payloadItems.length === 0) {
      toast.error('Укажите количество для приёмки');
      return;
    }
    if (receiveDate > today) {
      toast.error('Дата поставки не может быть в будущем');
      return;
    }
    receiveMutation.mutate({
      items: payloadItems,
      paymentMode: pendingMode,
      receivedAt: receiveDate !== today ? receiveDate : undefined,
    });
  };

  const openDateModal = () => {
    // Предзаполняем текущей датой поставки — владелец правит, а не вводит с нуля.
    // День проведённой поставки — тоже календарём автосервиса: иначе модалка
    // предлагала бы изменить дату на соседний день просто из-за пояса браузера.
    setNewDate(po?.receivedAt ? formatDayKey(new Date(po.receivedAt), tenantTz) : today);
    setDateModalOpen(true);
  };

  const submitNewDate = () => {
    if (!newDate) {
      toast.error('Выберите дату поставки');
      return;
    }
    if (newDate > today) {
      toast.error('Дата поставки не может быть в будущем');
      return;
    }
    changeDateMutation.mutate(newDate);
  };

  if (isLoading) return <InlineLoader minHeight="min-h-[60vh]" />;
  // A network failure (or a 404 that threw) — offer an explicit, recoverable error
  // instead of falling through to the "not found" empty state.
  if (isError) {
    return (
      <QueryState isLoading={false} isError onRetry={refetch} isFetching={isFetching} minHeight="min-h-[60vh]">
        <></>
      </QueryState>
    );
  }
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
  const isReceived = po.status === 'received';

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
        {po.dateCorrectedAt && (
          <div className="flex justify-between">
            <span className="text-gray-500">Дата изменена</span>
            <span className="text-gray-900">
              {formatDateShort(po.dateCorrectedAt)}
              {po.dateCorrectedByName ? ` · ${po.dateCorrectedByName}` : ''}
            </span>
          </div>
        )}
        {po.note && (
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 flex-shrink-0">Комментарий</span>
            <span className="text-gray-900 text-right">{po.note}</span>
          </div>
        )}
      </div>

      {/* Дата поставки (159) — в режиме приёмки. По умолчанию сегодня; можно
          выбрать прошедшую: ею сервер датирует склад, накладную и деньги. */}
      {receiveMode && (
        <div className="card card-body flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <label className="label mb-0" htmlFor="po-receive-date">
              Дата поставки
            </label>
            <p className="text-xs text-gray-500">
              Можно указать прошедшую — этой датой запишутся приход на склад, накладная и деньги.
            </p>
          </div>
          <input
            id="po-receive-date"
            type="date"
            max={today}
            className="input w-44"
            value={receiveDate}
            onChange={(e) => setReceiveDate(e.target.value)}
          />
        </div>
      )}

      {/* Items */}
      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="text-center">Заказано</th>
              <th className="text-center">Принято</th>
              {receiveMode && <th className="text-center">Принять сейчас</th>}
              <th className="text-right">{receiveMode ? 'Цена закупки' : 'Цена'}</th>
              <th className="text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="font-medium text-gray-900">{it.name}</td>
                <td className="text-center text-gray-600 tabular-nums">{it.quantity}</td>
                <td className="text-center text-gray-600 tabular-nums">{it.receivedQuantity}</td>
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
                <td className="text-right text-gray-600 tabular-nums">
                  {receiveMode ? (
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="input w-28 ml-auto text-right"
                      placeholder="Цена"
                      value={prices[it.id] ?? ''}
                      disabled={outstanding(it) === 0}
                      onChange={(e) => setPrices((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    />
                  ) : (
                    formatMoney(it.costPrice)
                  )}
                </td>
                <td className="text-right font-medium text-gray-900 tabular-nums">{formatMoney(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
          <span className="text-sm font-medium text-gray-600">Итого</span>
          <span className="text-lg font-bold text-gray-900 tabular-nums">{formatMoney(po.total)}</span>
        </div>
        {receiveMode && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-primary-50/60">
            <span className="text-sm font-medium text-gray-600">Стоимость накладной</span>
            <span className="text-lg font-bold text-primary-700 tabular-nums">{formatMoney(invoiceTotal)}</span>
          </div>
        )}
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
                  setPrices({});
                }}
                disabled={isBusy}
                className="btn-secondary"
              >
                Отмена
              </button>
              <button type="button" onClick={() => choosePayMode('debt')} disabled={isBusy} className="btn-primary">
                <Clock className="w-4 h-4" />
                {receiveMutation.isPending ? 'Приёмка...' : 'Принять без оплаты'}
              </button>
              <button
                type="button"
                onClick={() => choosePayMode('paid')}
                disabled={isBusy}
                className="btn bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 shadow-sm"
              >
                <Wallet className="w-4 h-4" />
                Оплатить сразу
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
                  <button type="button" onClick={enterReceiveMode} disabled={isBusy} className="btn-primary">
                    <PackageCheck className="w-4 h-4" />
                    Принять поставку
                  </button>
                </>
              )}
              {/* Проведённая поставка: дату можно поправить задним числом (159)
                  — сервер перенесёт склад, накладную и деньги на неё же. */}
              {isReceived && (
                <button type="button" onClick={openDateModal} disabled={isBusy} className="btn-secondary">
                  <CalendarClock className="w-4 h-4" />
                  Изменить дату
                </button>
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

      <ConfirmDialog
        isOpen={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        onConfirm={confirmReceive}
        title={pendingMode === 'paid' ? 'Оплатить и принять?' : 'Принять в долг?'}
        message={
          (pendingMode === 'paid'
            ? `Поставка на ${formatMoney(invoiceTotal)} будет принята на склад, а платёж на эту сумму создастся автоматически.`
            : `Поставка на ${formatMoney(invoiceTotal)} будет принята на склад. Сумма добавится в долг поставщику — погасите позже через «Новая оплата».`) +
          (receiveDate !== today
            ? ` Дата поставки — ${receiveDate.split('-').reverse().join('.')}: ею будут записаны склад, накладная и деньги.`
            : '')
        }
        confirmText={pendingMode === 'paid' ? 'Оплатить сразу' : 'Принять в долг'}
        variant="primary"
      />

      {/* Смена даты проведённой поставки (159) */}
      <Modal isOpen={dateModalOpen} onClose={() => setDateModalOpen(false)} title="Дата поставки" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="po-new-date">
              Новая дата
            </label>
            <input
              id="po-new-date"
              type="date"
              max={today}
              className="input"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <p className="text-sm text-gray-500">
            На эту дату переедут приход товара на склад, накладная поставщика и оплата по ней. Суммы и остатки не
            меняются.
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setDateModalOpen(false)}>
              Отмена
            </button>
            <button type="button" className="btn-primary" onClick={submitNewDate} disabled={isBusy}>
              {changeDateMutation.isPending ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
