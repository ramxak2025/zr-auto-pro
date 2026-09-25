import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, PackageCheck, XCircle, Send, Clock, Wallet, CalendarClock, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';

import { purchaseOrdersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Money,
  PageHeader,
  QueryState,
  SkeletonCard,
} from '../ui';
import type { DataTableColumn } from '../ui';
import PurchaseOrderStatusBadge from '../components/PurchaseOrderStatusBadge';

import type { PurchaseOrder, PurchaseOrderItem } from '../types';
import { formatMoney, formatDateTime, formatDateShort, formatDayKey } from '../../../shared/utils/formatters';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { formatQty } from '../utils/units';
import { parseNumberInput } from '../components/warehouse/format';

const outstanding = (it: PurchaseOrderItem) => Math.max(0, it.quantity - it.receivedQuantity);

// Закупочная цена из free-text поля («12,5» → 12.5); мусор/отрицательное → 0.
const parsePrice = (t: string): number => {
  const n = parseNumberInput(t || '');
  return n === null || n < 0 ? 0 : n;
};

// Количество к приёмке из free-text поля; мусор/отрицательное → 0.
const parseQty = (t: string): number => {
  const n = parseNumberInput(t || '');
  return n === null || n < 0 ? 0 : n;
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
  // «Принять сейчас» и цена закупки — free-text (запятая печатается чисто);
  // числа считаются при отправке. Приёмка в supply-режиме обновляет cost_price
  // товара (миграция 098).
  const [deltas, setDeltas] = useState<Record<string, string>>({});
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
    // В кеш — сам заказ, не axios-ответ (та же форма, что в PurchaseOrderEditPage).
    queryFn: async () => (await purchaseOrdersApi.getById(id as string)).data as PurchaseOrder,
    enabled: !!id,
  });

  // Caches touched when stock changes on receive.
  const invalidateAfterMutation = (next: PurchaseOrder) => {
    queryClient.setQueryData(['purchase-order', id], next);
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

  const invalidateSupplier = (supplierId?: string | null) => {
    if (supplierId) {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', supplierId] });
    }
    queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  };

  const orderMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.order(id as string),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      toast.success('Заказ оформлен');
    },
    onError: () => toast.error('Не удалось оформить заказ'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.cancel(id as string),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      toast.success('Заказ отменён');
    },
    onError: () => toast.error('Не удалось отменить заказ'),
  });

  // Каждая приёмка на вебе идёт в supply-режиме (миграция 098): шлём
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
      purchaseOrdersApi.receive(id as string, vars),
    onSuccess: (res, vars) => {
      invalidateAfterMutation(res.data);
      invalidateStock();
      invalidateSupplier(res.data.supplierId);
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
    mutationFn: (date: string) => purchaseOrdersApi.changeDate(id as string, date),
    onSuccess: (res) => {
      invalidateAfterMutation(res.data);
      invalidateStock();
      invalidateSupplier(res.data.supplierId);
      setDateModalOpen(false);
      toast.success('Дата поставки изменена');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Не удалось изменить дату поставки'),
  });

  const isBusy =
    orderMutation.isPending || cancelMutation.isPending || receiveMutation.isPending || changeDateMutation.isPending;

  const items = useMemo(() => po?.items || [], [po]);

  const enterReceiveMode = () => {
    const initDeltas: Record<string, string> = {};
    const initPrices: Record<string, string> = {};
    for (const it of items) {
      initDeltas[it.id] = String(outstanding(it));
      // По умолчанию — цена из заказа (снимок costPrice); владелец правит по факту.
      initPrices[it.id] = it.costPrice ? String(it.costPrice) : '';
    }
    setDeltas(initDeltas);
    setPrices(initPrices);
    setReceiveDate(today);
    setReceiveMode(true);
  };

  const exitReceiveMode = () => {
    setReceiveMode(false);
    setDeltas({});
    setPrices({});
  };

  // Строки к приёмке — только с положительным «принять сейчас» (кламп к остатку).
  const buildReceiveItems = (): ReceiveLine[] =>
    items
      .map((it) => {
        const qty = Math.min(parseQty(deltas[it.id] ?? ''), outstanding(it));
        if (qty <= 0) return null;
        return { itemId: it.id, receivedQuantity: qty, purchasePrice: parsePrice(prices[it.id] ?? '') };
      })
      .filter((x): x is ReceiveLine => x != null);

  // «Стоимость накладной» = Σ(принято × закупочная цена) по принимаемым строкам.
  const invoiceTotal = useMemo(
    () =>
      items.reduce((sum, it) => {
        const qty = Math.min(parseQty(deltas[it.id] ?? ''), outstanding(it));
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

  if (isLoading || isError) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader title="Заказ поставщику" icon={ShoppingCart} backTo="/purchase-orders" />
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить заказ"
          loader={
            <div className="space-y-5">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={4} />
            </div>
          }
        >
          <></>
        </QueryState>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader title="Заказ поставщику" icon={ShoppingCart} backTo="/purchase-orders" />
        <Card>
          <EmptyState
            icon={ShoppingCart}
            title="Заказ не найден"
            description="Возможно, он был удалён или ссылка устарела"
            action={{ label: 'К списку заказов', onClick: () => navigate('/purchase-orders') }}
          />
        </Card>
      </div>
    );
  }

  const isDraft = po.status === 'draft';
  const isOrdered = po.status === 'ordered';
  const isReceived = po.status === 'received';

  const columns: DataTableColumn<PurchaseOrderItem>[] = [
    {
      key: 'name',
      header: 'Товар',
      render: (it) => <span className="font-medium text-ink">{it.name}</span>,
      footer: () => 'Итого по заказу',
    },
    {
      key: 'quantity',
      header: 'Заказано',
      numeric: true,
      render: (it) => formatQty(it.quantity),
    },
    {
      key: 'receivedQuantity',
      header: 'Принято',
      numeric: true,
      hideBelow: 'sm',
      render: (it) => (
        <span
          className={it.receivedQuantity >= it.quantity && it.quantity > 0 ? 'font-medium text-ok-text' : undefined}
        >
          {formatQty(it.receivedQuantity)}
        </span>
      ),
    },
    ...(receiveMode
      ? ([
          {
            key: 'receiveNow',
            header: 'Принять сейчас',
            numeric: true,
            interactive: true,
            width: 120,
            render: (it) => (
              <Input
                size="sm"
                inputMode="decimal"
                aria-label={`Принять сейчас — ${it.name}`}
                value={deltas[it.id] ?? ''}
                disabled={outstanding(it) === 0}
                invalid={parseQty(deltas[it.id] ?? '') > outstanding(it)}
                onChange={(e) => setDeltas((prev) => ({ ...prev, [it.id]: e.target.value }))}
                className="text-right tabular-nums"
              />
            ),
          },
        ] as DataTableColumn<PurchaseOrderItem>[])
      : []),
    {
      key: 'costPrice',
      header: receiveMode ? 'Цена закупки' : 'Цена',
      numeric: true,
      interactive: receiveMode,
      width: receiveMode ? 128 : undefined,
      render: (it) =>
        receiveMode ? (
          <Input
            size="sm"
            inputMode="decimal"
            aria-label={`Цена закупки — ${it.name}`}
            placeholder="Цена"
            value={prices[it.id] ?? ''}
            disabled={outstanding(it) === 0}
            onChange={(e) => setPrices((prev) => ({ ...prev, [it.id]: e.target.value }))}
            className="text-right tabular-nums"
          />
        ) : (
          <Money value={it.costPrice} />
        ),
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      hideBelow: 'sm',
      render: (it) => <Money value={it.total} className="font-medium text-ink" />,
      footer: () => <Money value={po.total} />,
    },
  ];

  const actions = canWrite
    ? receiveMode
      ? [
          <Button key="cancel" variant="secondary" onClick={exitReceiveMode} disabled={isBusy}>
            Отмена
          </Button>,
          <Button key="paid" variant="secondary" icon={Wallet} onClick={() => choosePayMode('paid')} disabled={isBusy}>
            Оплатить сразу
          </Button>,
          <Button
            key="debt"
            icon={Clock}
            onClick={() => choosePayMode('debt')}
            loading={receiveMutation.isPending}
            disabled={isBusy}
          >
            Принять без оплаты
          </Button>,
        ]
      : [
          ...(isDraft
            ? [
                <Button
                  key="edit"
                  variant="secondary"
                  icon={Pencil}
                  onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
                  disabled={isBusy}
                >
                  Редактировать
                </Button>,
                <Button
                  key="cancel"
                  variant="danger"
                  icon={XCircle}
                  onClick={() => setCancelOpen(true)}
                  disabled={isBusy}
                >
                  Отменить
                </Button>,
                <Button
                  key="order"
                  icon={Send}
                  onClick={() => orderMutation.mutate()}
                  loading={orderMutation.isPending}
                  disabled={isBusy}
                >
                  Оформить заказ
                </Button>,
              ]
            : []),
          ...(isOrdered
            ? [
                <Button
                  key="cancel"
                  variant="danger"
                  icon={XCircle}
                  onClick={() => setCancelOpen(true)}
                  disabled={isBusy}
                >
                  Отменить
                </Button>,
                <Button key="receive" icon={PackageCheck} onClick={enterReceiveMode} disabled={isBusy}>
                  Принять поставку
                </Button>,
              ]
            : []),
          // Проведённая поставка: дату можно поправить задним числом (159)
          // — сервер перенесёт склад, накладную и деньги на неё же.
          ...(isReceived
            ? [
                <Button key="date" variant="secondary" icon={CalendarClock} onClick={openDateModal} disabled={isBusy}>
                  Изменить дату
                </Button>,
              ]
            : []),
        ]
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={po.supplierName || 'Без поставщика'}
        icon={ShoppingCart}
        backTo="/purchase-orders"
        meta={<PurchaseOrderStatusBadge status={po.status} />}
        subtitle={`Заказ от ${formatDateTime(po.createdAt, tenantTz)}`}
        actions={actions.length > 0 ? <>{actions}</> : undefined}
      />

      <Card>
        <CardHeader title="Сведения" dense />
        <CardBody padding="sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {po.createdByName && (
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-ink-3">Создал</dt>
                <dd className="text-right text-ink sm:text-left">{po.createdByName}</dd>
              </div>
            )}
            {po.orderedAt && (
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-ink-3">Оформлен</dt>
                <dd className="text-right tabular-nums text-ink sm:text-left">
                  {formatDateTime(po.orderedAt, tenantTz)}
                </dd>
              </div>
            )}
            {po.receivedAt && (
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-ink-3">Дата поставки</dt>
                <dd className="text-right tabular-nums text-ink sm:text-left">
                  {formatDateTime(po.receivedAt, tenantTz)}
                </dd>
              </div>
            )}
            {po.dateCorrectedAt && (
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-ink-3">Дата изменена</dt>
                <dd className="text-right tabular-nums text-ink sm:text-left">
                  {formatDateShort(po.dateCorrectedAt, tenantTz)}
                  {po.dateCorrectedByName ? ` · ${po.dateCorrectedByName}` : ''}
                </dd>
              </div>
            )}
            {po.note && (
              <div className="flex justify-between gap-4 sm:col-span-2 sm:block">
                <dt className="flex-shrink-0 text-ink-3">Комментарий</dt>
                <dd className="text-right text-ink sm:text-left">{po.note}</dd>
              </div>
            )}
            {!po.createdByName && !po.orderedAt && !po.receivedAt && !po.note && (
              <p className="text-ink-3 sm:col-span-2">Черновик: заказ ещё не оформлен</p>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Дата поставки (159) — в режиме приёмки. По умолчанию сегодня; можно
          выбрать прошедшую: ею сервер датирует склад, накладную и деньги. */}
      {receiveMode && (
        <Card padding="sm">
          <Field
            label="Дата поставки"
            htmlFor="po-receive-date"
            inline
            hint="Можно указать прошедшую — этой датой запишутся приход на склад, накладная и деньги"
          >
            <Input
              id="po-receive-date"
              type="date"
              max={today}
              value={receiveDate}
              onChange={(e) => setReceiveDate(e.target.value)}
              className="sm:w-48"
            />
          </Field>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Позиции"
          subtitle={receiveMode ? 'Укажите, сколько принимаете, и фактическую цену закупки' : `${items.length} поз.`}
          divider={false}
        />
        <DataTable bare rows={items} rowKey={(it) => it.id} columns={columns} caption="Позиции заказа" />
        {receiveMode && (
          <CardFooter>
            <span className="text-sm font-medium text-ink-2">Стоимость накладной</span>
            <Money value={invoiceTotal} className="text-lg font-semibold text-ink" />
          </CardFooter>
        )}
      </Card>

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
      <Modal
        isOpen={dateModalOpen}
        onClose={() => setDateModalOpen(false)}
        title="Дата поставки"
        description="На эту дату переедут приход товара на склад, накладная поставщика и оплата по ней. Суммы и остатки не меняются."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDateModalOpen(false)} disabled={isBusy}>
              Отмена
            </Button>
            <Button onClick={submitNewDate} loading={changeDateMutation.isPending} disabled={isBusy}>
              Сохранить
            </Button>
          </>
        }
      >
        <Field label="Новая дата" htmlFor="po-new-date">
          <Input
            id="po-new-date"
            type="date"
            max={today}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
