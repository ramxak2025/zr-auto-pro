import type { ReactNode } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Activity, Banknote, ClipboardList, Clock, CreditCard, Package, Users } from 'lucide-react';

import type { TenantCabinet } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import { Card, CardHeader } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import { ErrorRow, MiniStat, formatDateRu } from './adminUi';

export interface TenantSubscriptionCardProps {
  /** Кабинет автосервиса (GET /tenants/:id/cabinet или GET /manager/tenants/:id/cabinet) — одинаковый у обоих ролей. */
  cabinet?: TenantCabinet;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  className?: string;
}

/** Карточка «Подписка» + «Показатели клиента»: общая для карточки автосервиса суперадмина и менеджера. */
export default function TenantSubscriptionCard({
  cabinet,
  isError,
  isFetching,
  onRetry,
  className,
}: TenantSubscriptionCardProps) {
  const subStatus = cabinet?.subscription;
  const metrics = cabinet?.metrics;

  return (
    <Card padding="none" className={className}>
      <CardHeader icon={CreditCard} title="Подписка" subtitle="Тариф, срок и лимит сотрудников" />
      <div className="px-5 py-4">
        {isError && !subStatus ? (
          <ErrorRow message="Не удалось загрузить данные подписки" onRetry={onRetry} loading={isFetching} />
        ) : !subStatus ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton variant="text" className="w-20" />
                <Skeleton className="mt-2 h-5 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MiniStat label="Тариф" value={subStatus.planName || 'Не назначен'} />
            <MiniStat label="Стоимость" value={`${formatMoney(subStatus.planPrice)}/мес`} />
            <MiniStat
              label="Действует до"
              value={subStatus.subscriptionEnd ? formatDateRu(subStatus.subscriptionEnd, 'd MMMM yyyy') : 'Не указано'}
              tone={subStatus.status === 'expired' ? 'bad' : 'neutral'}
            />
            <MiniStat label="Сотрудников" value={`${subStatus.currentUsers} / ${subStatus.maxUsers}`} />
          </dl>
        )}
      </div>

      {/* Показатели клиента — сигналы активности */}
      <div className="border-t border-line px-5 py-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Показатели клиента</h3>
        {isError && !metrics ? (
          <p className="text-sm text-ink-3">Показатели недоступны — повторите загрузку выше.</p>
        ) : !metrics ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              icon={ClipboardList}
              label="Заказ-наряды"
              value={metrics.checksTotal}
              hint={`за 30 дней: ${metrics.checksLast30d}`}
            />
            <MetricTile
              icon={Banknote}
              label="Выручка"
              value={formatMoney(metrics.revenueTotal)}
              hint={`за 30 дней: ${formatMoney(metrics.revenueLast30d)}`}
            />
            <MetricTile
              icon={Users}
              label="Сотрудники"
              value={metrics.usersCount}
              hint={`активных: ${metrics.activeUsersCount}`}
            />
            <MetricTile
              icon={Package}
              label="Товары · активность"
              value={metrics.productsCount}
              hint={
                metrics.lastActivityAt ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatDistanceToNow(parseISO(metrics.lastActivityAt), { addSuffix: true, locale: ru })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Activity className="h-3 w-3" aria-hidden="true" />
                    нет активности
                  </span>
                )
              }
            />
          </dl>
        )}
      </div>
    </Card>
  );
}

/** Плитка показателя активности клиента: подпись с иконкой, значение, подсказка. */
function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <dt className="mb-1 flex items-center gap-1.5 text-xs text-ink-3">
        <Icon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
        {label}
      </dt>
      <dd>
        <p className="text-lg font-semibold tabular-nums tracking-tight text-ink">{value}</p>
        {hint && <p className="text-xs tabular-nums text-ink-3">{hint}</p>}
      </dd>
    </div>
  );
}
