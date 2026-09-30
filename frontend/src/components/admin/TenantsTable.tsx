import { Building2 } from 'lucide-react';

import type { Tenant } from '../../types';
import { formatPhone } from '../../../../shared/validation/phone';
import SubscriptionPeriodBadge from '../SubscriptionPeriodBadge';
import { DataTable, type DataTableColumn, type DataTableEmpty } from '../../ui/DataTable';
import { Money } from '../../ui/Money';
import { cn } from '../../ui/cn';
import { TenantStatusBadges, formatDateRu, isTenantExpired } from './adminUi';

export interface TenantsTableProps {
  rows: Tenant[];
  /** Куда ведёт строка: кабинет суперадмина и кабинет менеджера — разные маршруты. */
  rowHref: (tenant: Tenant) => string;
  caption: string;
  isLoading: boolean;
  isError: boolean;
  isFetching?: boolean;
  onRetry: () => void;
  errorTitle: string;
  emptyState: DataTableEmpty;
  /** Колонка с собственными кнопками справа (например, «Передать другому»). */
  actionColumn?: DataTableColumn<Tenant>;
}

/** Таблица автосервисов менеджера: название, статус, тариф, срок подписки. */
export default function TenantsTable({
  rows,
  rowHref,
  caption,
  isLoading,
  isError,
  isFetching,
  onRetry,
  errorTitle,
  emptyState,
  actionColumn,
}: TenantsTableProps) {
  const columns: DataTableColumn<Tenant>[] = [
    {
      key: 'name',
      header: 'Автосервис',
      primary: true,
      truncate: true,
      sortable: true,
      sortValue: (t) => t.name,
      render: (t) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{t.name}</span>
            <span className="block truncate text-xs font-normal tabular-nums text-ink-3">
              {t.phone ? formatPhone(t.phone) : '—'}
            </span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Статус', render: (t) => <TenantStatusBadges tenant={t} size="sm" /> },
    {
      key: 'plan',
      header: 'Тариф',
      hideBelow: 'md',
      sortable: true,
      sortValue: (t) => t.plan?.name ?? '',
      render: (t) =>
        t.plan?.name ? (
          <span className="block">
            <span className="block text-ink">{t.plan.name}</span>
            <span className="block text-xs tabular-nums text-ink-3">
              <Money value={t.monthlyPrice} />
              /мес
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Не назначен</span>
        ),
    },
    {
      key: 'subscription',
      header: 'Подписка',
      sortable: true,
      sortValue: (t) => t.subscriptionEnd ?? '',
      render: (t) => (
        <span className="flex flex-col items-start gap-1">
          {t.subscriptionEnd ? (
            <span className={cn('tabular-nums', isTenantExpired(t) ? 'font-medium text-bad-text' : 'text-ink-2')}>
              до {formatDateRu(t.subscriptionEnd, 'd MMM yyyy')}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          )}
          <span className="hidden md:inline-flex">
            <SubscriptionPeriodBadge kind={t.currentPeriodKind} until={t.subscriptionEnd} size="sm" />
          </span>
        </span>
      ),
    },
  ];
  if (actionColumn) columns.push(actionColumn);

  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(t) => t.id}
      rowHref={rowHref}
      rowLabel={(t) => `Открыть автосервис «${t.name}»`}
      columns={columns}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isFetching={isFetching}
      errorTitle={errorTitle}
      emptyState={emptyState}
    />
  );
}
