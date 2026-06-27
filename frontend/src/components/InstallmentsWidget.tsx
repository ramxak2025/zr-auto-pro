import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, AlertTriangle, ChevronRight, CreditCard } from 'lucide-react';
import { installmentsApi } from '../api/services';
import type { InstallmentWidget } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';

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

/**
 * Dashboard card surfacing installment plans due in the next {@link DAYS} days
 * plus everything overdue. Owner/admin only — the caller is responsible for the
 * role gate; this just renders the data.
 */
export default function InstallmentsWidget() {
  const navigate = useNavigate();

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
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => navigate('/installments')}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
            <CreditCard className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Рассрочка</h2>
            <p className="text-xs text-gray-500">Ближайшие и просроченные платежи</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
      </button>

      {/* Summary strip */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 border-y border-gray-100 bg-gray-50/50">
        <div className="px-3 py-2.5 text-center">
          <p className="text-base font-bold text-red-600">{overdueCount}</p>
          <p className="text-[11px] text-gray-500">Просрочено</p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-base font-bold text-amber-600">{dueSoonCount}</p>
          <p className="text-[11px] text-gray-500">Скоро</p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-base font-bold text-gray-900">{formatMoney(totalRemaining)}</p>
          <p className="text-[11px] text-gray-500">Остаток</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-5 py-5 text-sm text-gray-400">
          <CalendarClock className="h-4 w-4" />
          Нет ближайших платежей
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.slice(0, 6).map((it) => {
            const due = dueLabel(it.dueInDays);
            return (
              <li key={it.planId}>
                <button
                  type="button"
                  onClick={() => navigate('/installments')}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50"
                >
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                      it.overdue ? 'bg-red-50' : 'bg-gray-100'
                    }`}
                  >
                    {it.overdue ? (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    ) : (
                      <CalendarClock className="h-4 w-4 text-gray-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{it.clientName || 'Клиент'}</p>
                    <p
                      className={`text-xs ${
                        due.tone === 'red' ? 'text-red-500' : due.tone === 'amber' ? 'text-amber-600' : 'text-gray-400'
                      }`}
                    >
                      {shortDate(it.nextPaymentDate)} · {due.text}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-sm font-bold text-gray-900">{formatMoney(it.remaining)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 6 && (
        <button
          type="button"
          onClick={() => navigate('/installments')}
          className="w-full border-t border-gray-100 px-5 py-3 text-center text-sm font-medium text-primary-600 transition-colors hover:bg-gray-50"
        >
          Все рассрочки →
        </button>
      )}
    </section>
  );
}
