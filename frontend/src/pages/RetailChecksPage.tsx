import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, ShoppingBag } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { checksApi } from '../api/services';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { zoned } from '../utils/tenantTime';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Money } from '../ui/Money';
import { CheckStatusBadge, PaymentBadge } from '../components/checks/checkBadges';
import type { Check, PaginatedResponse } from '../types';

const LIMIT = 20;
/** Сортируемый заголовок DataTable: кнопка flex-row-reverse уезжает по базовой линии — выравниваем по середине. */
const SORT_HEADER_FIX = '[&>button]:align-middle';

/**
 * Чеки «Розничного покупателя» — продажи без привязки к клиенту. Точка входа —
 * карточка «Розничный покупатель» на странице «Клиенты» (G2). Страница в URL
 * (?page=), строки — ссылки на деталь чека.
 */
export default function RetailChecksPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const timeZone = useTenantTimezone();

  const {
    data: checksData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', 'retail', page],
    queryFn: async () => {
      const res = await checksApi.getAll({ page, limit: LIMIT, retail: 'true' });
      return res.data;
    },
  });

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;

  const columns: DataTableColumn<Check>[] = [
    {
      key: 'number',
      header: '№',
      primary: true,
      width: 72,
      render: (c) => <span className="tabular-nums">{c.number}</span>,
    },
    {
      key: 'date',
      header: 'Дата',
      sortable: true,
      width: 160,
      className: 'whitespace-nowrap',
      headerClassName: SORT_HEADER_FIX,
      sortValue: (c) => c.date,
      render: (c) => (
        <span className="tabular-nums">
          {format(zoned(c.date, timeZone), 'dd.MM.yyyy', { locale: ru })}
          <span className="ml-1.5 text-xs text-ink-3">{format(zoned(c.date, timeZone), 'HH:mm')}</span>
        </span>
      ),
    },
    { key: 'master', header: 'Мастер', hideBelow: 'md', render: (c) => c.master?.fullName ?? '—' },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      sortable: true,
      width: 140,
      headerClassName: SORT_HEADER_FIX,
      sortValue: (c) => c.totalRevenue,
      render: (c) => (
        <Money value={c.totalRevenue} className={c.isReturned ? 'text-ink-3 line-through' : 'font-semibold text-ink'} />
      ),
      footer: (rows) => <Money value={rows.reduce((s, c) => s + (c.totalRevenue || 0), 0)} />,
    },
    { key: 'payment', header: 'Оплата', hideBelow: 'sm', render: (c) => <PaymentBadge check={c} /> },
    {
      key: 'status',
      header: 'Статус',
      render: (c) => <CheckStatusBadge check={c} />,
      footer: <span className="text-xs font-medium text-ink-3">Итого на странице</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Розничный покупатель"
        icon={ShoppingBag}
        backTo="/clients"
        subtitle={total > 0 ? `Чеки без привязки к клиенту · ${total}` : 'Чеки без привязки к клиенту'}
      />

      <DataTable
        caption="Чеки розничного покупателя"
        columns={columns}
        rows={checks}
        rowKey={(c) => c.id}
        rowHref={(c) => `/checks/${c.id}`}
        rowLabel={(c) => `Чек №${c.number}`}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        emptyState={{ icon: FileText, title: 'Нет чеков', description: 'Розничных продаж без клиента пока не было' }}
      />

      <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => setParams({ page: String(p) })} />
    </div>
  );
}
