import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';

import { purchaseOrdersApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { DataTable, Money, PageHeader, Pagination, Select, Tabs, Toolbar, buttonClasses } from '../ui';
import type { DataTableColumn, TabItem } from '../ui';
import PurchaseOrderStatusBadge from '../components/PurchaseOrderStatusBadge';

import type { PurchaseOrder, PurchaseOrderStatus, PaginatedResponse } from '../types';
import { formatDateShort } from '../../../shared/utils/formatters';
import { countLabel } from '../components/warehouse/format';
import { pageParam, useUrlParams } from '../components/warehouse/useUrlParams';

const LIMIT = 20;

// У проведённой поставки ведущая дата — ДАТА ПОСТАВКИ (159): её можно выбрать
// при приёмке задним числом и поправить потом. У остальных статусов даты
// поставки ещё нет — показываем дату создания заказа.
const poDateIso = (po: { status: string; receivedAt?: string | null; createdAt: string }): string =>
  po.status === 'received' && po.receivedAt ? po.receivedAt : po.createdAt;

type StatusTab = 'all' | PurchaseOrderStatus;
const STATUS_VALUES: PurchaseOrderStatus[] = ['draft', 'ordered', 'received', 'cancelled'];
const STATUS_TABS: TabItem<StatusTab>[] = [
  { key: 'all', label: 'Все' },
  { key: 'draft', label: 'Черновики' },
  { key: 'ordered', label: 'Заказано' },
  { key: 'received', label: 'Получено' },
  { key: 'cancelled', label: 'Отменён' },
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // Заказы поставщикам: мутации — suppliers_manage (backend purchase-orders/;
  // волна Битрикс24). Просмотр списка — suppliers_access (гейт меню).
  const canWrite = hasPermission('suppliers_manage');

  // Статус, поставщик и страница — в URL.
  const [params, setParam] = useUrlParams();
  const rawStatus = params.get('status') ?? '';
  const status: '' | PurchaseOrderStatus = (STATUS_VALUES as string[]).includes(rawStatus)
    ? (rawStatus as PurchaseOrderStatus)
    : '';
  const supplierId = params.get('supplier') ?? '';
  const page = pageParam(params);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['purchase-orders', { status, supplierId, page }],
    queryFn: async () => {
      const res = await purchaseOrdersApi.list({
        status: status || undefined,
        supplierId: supplierId || undefined,
        page,
        limit: LIMIT,
      });
      return res.data as PaginatedResponse<PurchaseOrder>;
    },
  });

  // Поставщики для фильтра. В кеш — массив, а не axios-ответ: ключ 'suppliers'
  // в whitelist persistent-кеша, а сырой ответ не проходит structured clone.
  // Тот же ключ и та же форма данных — в PurchaseOrderEditPage.
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', { search: '', page: 1, limit: 1000 }],
    queryFn: async () => {
      const res = await suppliersApi.getAll({ page: 1, limit: 1000 });
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const orders = data?.data ?? [];
  const total = data?.total ?? 0;

  const columns: DataTableColumn<PurchaseOrder>[] = [
    {
      key: 'supplierName',
      header: 'Поставщик',
      primary: true,
      render: (po) => po.supplierName || 'Без поставщика',
      footer: (rows) => `Итого на странице (${rows.length})`,
    },
    {
      key: 'date',
      header: 'Дата',
      hideBelow: 'sm',
      sortable: true,
      sortValue: (po) => poDateIso(po),
      render: (po) => <span className="tabular-nums text-ink-2">{formatDateShort(poDateIso(po))}</span>,
    },
    {
      key: 'itemCount',
      header: 'Позиций',
      numeric: true,
      hideBelow: 'md',
      render: (po) => po.itemCount ?? 0,
    },
    {
      key: 'status',
      header: 'Статус',
      render: (po) => <PurchaseOrderStatusBadge status={po.status} />,
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      sortable: true,
      render: (po) => <Money value={po.total} className="font-medium text-ink" />,
      footer: (rows) => <Money value={rows.reduce((sum, r) => sum + (r.total || 0), 0)} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Заказы поставщикам"
        icon={ShoppingCart}
        subtitle={data ? countLabel(total, ['заказ', 'заказа', 'заказов']) : undefined}
        actions={
          canWrite ? (
            <Link to="/purchase-orders/new" className={buttonClasses()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Создать заказ
            </Link>
          ) : undefined
        }
      />

      <Toolbar>
        <Tabs
          variant="pills"
          aria-label="Статус заказа"
          idPrefix="po-status"
          items={STATUS_TABS}
          value={status || 'all'}
          onChange={(key) => setParam({ status: key === 'all' ? null : key, page: null })}
        />
        <Select
          aria-label="Поставщик"
          value={supplierId}
          onChange={(e) => setParam({ supplier: e.target.value || null, page: null })}
          placeholder="Все поставщики"
          options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
          className="w-full sm:w-60"
        />
      </Toolbar>

      <DataTable
        rows={orders}
        rowKey={(po) => po.id}
        rowHref={(po) => `/purchase-orders/${po.id}`}
        rowLabel={(po) => `Открыть заказ: ${po.supplierName || 'без поставщика'}, ${formatDateShort(poDateIso(po))}`}
        columns={columns}
        caption="Заказы поставщикам"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        emptyState={{
          icon: ShoppingCart,
          title: status || supplierId ? 'Заказов с такими условиями нет' : 'Заказов пока нет',
          description:
            status || supplierId
              ? 'Измените статус или поставщика в фильтре'
              : 'Создайте заказ поставщику, чтобы пополнить склад',
          action:
            canWrite && !status && !supplierId
              ? { label: 'Создать заказ', onClick: () => navigate('/purchase-orders/new') }
              : undefined,
        }}
      />

      <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => setParam({ page: p === 1 ? null : p })} />
    </div>
  );
}
