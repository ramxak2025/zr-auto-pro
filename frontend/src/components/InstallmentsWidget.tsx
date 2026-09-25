import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, AlertTriangle, ChevronRight, CreditCard } from 'lucide-react';
import { installmentsApi } from '../api/services';
import type { InstallmentWidget } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';
import { Card, CardHeader } from '../ui/Card';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

/** «YYYY-MM-DD» → «дд.мм». */
function shortDate(d?: string | null): string {
  if (!d) return '—';
  const parts = d.slice(0, 10).split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}.${parts[1]}`;
}

/** Human relative label for a plan's next-payment date. */
export function dueLabel(dueInDays?: number | null): { text: string; tone: 'red' | 'amber' | 'gray' } {
  if (dueInDays == null) return { text: 'без даты', tone: 'gray' };
  if (dueInDays < 0) return { text: `просрочено на ${Math.abs(dueInDays)} дн.`, tone: 'red' };
  if (dueInDays === 0) return { text: 'сегодня', tone: 'amber' };
  if (dueInDays === 1) return { text: 'завтра', tone: 'amber' };
  if (dueInDays <= 7) return { text: `через ${dueInDays} дн.`, tone: 'amber' };
  return { text: `через ${dueInDays} дн.`, tone: 'gray' };
}

const DAYS = 7;

const dueToneCls = { red: 'text-bad-text', amber: 'text-warn-text', gray: 'text-ink-3' } as const;

/**
 * Dashboard card surfacing installment plans due in the next {@link DAYS} days
 * plus everything overdue. Owner/admin only — the caller is responsible for the
 * role gate; this just renders the data.
 */
export default function InstallmentsWidget() {
  const { data, isLoading } = useQuery<InstallmentWidget>({
    queryKey: ['installments', 'widget', DAYS],
    queryFn: async () => {
      const res = await installmentsApi.widget(DAYS);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  // Hide the card entirely while loading the first time — keeps the dashboard
  // calm. Once loaded, always show it so owners can discover «Рассрочка».
  if (isLoading && !data) return null;

  const overdueCount = data?.overdueCount ?? 0;
  const dueSoonCount = data?.dueSoonCount ?? 0;
  const totalRemaining = data?.totalRemaining ?? 0;

  return (
    <Card padding="none">
      <Link to="/installments" className={cn('block rounded-t-xl transition-colors hover:bg-surface-2', focusRing)}>
        <CardHeader
          dense
          icon={CreditCard}
          title="Рассрочка"
          subtitle="Ближайшие и просроченные платежи"
          divider={false}
          actions={<ChevronRight className="h-4 w-4 text-ink-4" aria-hidden="true" />}
        />
      </Link>

      {/* Summary strip */}
      <div className="grid grid-cols-3 divide-x divide-line border-y border-line bg-surface-2">
        <div className="px-3 py-2 text-center">
          <p className={cn('text-base font-semibold tabular-nums', overdueCount > 0 ? 'text-bad-text' : 'text-ink')}>
            {overdueCount}
          </p>
          <p className="text-2xs text-ink-3">Просрочено</p>
        </div>
        <div className="px-3 py-2 text-center">
          <p className={cn('text-base font-semibold tabular-nums', dueSoonCount > 0 ? 'text-warn-text' : 'text-ink')}>
            {dueSoonCount}
          </p>
          <p className="text-2xs text-ink-3">Скоро</p>
        </div>
        <div className="px-3 py-2 text-center">
          <p className="text-base font-semibold tabular-nums text-ink">{formatMoney(totalRemaining)}</p>
          <p className="text-2xs text-ink-3">Остаток</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-ink-3">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Нет ближайших платежей
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, 6).map((it) => {
            const due = dueLabel(it.dueInDays);
            return (
              <li key={it.planId}>
                <Link
                  to="/installments"
                  className={cn('flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2', focusRing)}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                      it.overdue ? 'bg-bad-soft text-bad' : 'bg-surface-3 text-ink-3',
                    )}
                  >
                    {it.overdue ? (
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{it.clientName || 'Клиент'}</p>
                    <p className={cn('text-xs tabular-nums', dueToneCls[due.tone])}>
                      {shortDate(it.nextPaymentDate)} · {due.text}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-ink">
                    {formatMoney(it.remaining)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 6 && (
        <Link
          to="/installments"
          className={cn(
            'block rounded-b-xl border-t border-line px-4 py-2.5 text-center text-sm font-medium text-accent-text transition-colors hover:bg-surface-2',
            focusRing,
          )}
        >
          Все рассрочки →
        </Link>
      )}
    </Card>
  );
}
