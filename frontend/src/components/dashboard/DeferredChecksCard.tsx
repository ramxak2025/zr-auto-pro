import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { checksApi } from '../../api/services';
import type { DeferredCheckReminder } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow } from './shared';

/**
 * Отложенные чеки: владелец видит все по автосервису, сотрудник — свои
 * (скоуп на сервере). Скрывается, когда пусто; при ошибке — честная строка.
 */
export default function DeferredChecksCard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DeferredCheckReminder[]>({
    queryKey: ['deferred-reminders'],
    queryFn: async () => (await checksApi.deferredReminders()).data,
    staleTime: 30_000,
  });

  if (isError && !data)
    return <ErrorRow message="Не удалось загрузить отложенные чеки" onRetry={() => refetch()} loading={isFetching} />;
  const items = data ?? [];
  if (isLoading || items.length === 0) return null;

  return (
    <Card padding="none">
      <CardHeader
        icon={Clock}
        iconTone="warn"
        title="Отложенные чеки"
        subtitle="Ждут завершения или оплаты"
        actions={
          <Badge tone="warn" className="tabular-nums">
            {items.length}
          </Badge>
        }
      />
      <ul className={cn('divide-y divide-line', items.length > 6 && 'max-h-80 overflow-y-auto')}>
        {items.map((c) => (
          <li key={c.id}>
            <Link
              to={`/checks/${c.id}`}
              className={cn('flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2', focusRing)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-ink">№{c.number}</span>
                  {c.plate && (
                    <Badge outline size="sm" className="font-mono tracking-wide">
                      {c.plate}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-3">
                  {c.clientName || 'Без клиента'}
                  {' · '}
                  {format(new Date(c.date), 'd MMM', { locale: ru })}
                  {c.masterName ? ` · ${c.masterName}` : ''}
                </p>
              </div>
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink">
                {formatMoney(c.total)}
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
