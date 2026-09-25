import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Filter, PhoneOff } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { reportsApi } from '../../api/services';
import type { CallFunnel } from '../../types';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { formatMoney } from '../../../../shared/utils/formatters';
import { Card, CardHeader } from '../../ui/Card';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { buttonClasses } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { ErrorRow, MiniStat, dayKeyToDate } from './shared';

type Period = 'week' | 'month';

const periodOptions: { value: Period; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
];

interface Stage {
  key: string;
  label: string;
  value: number;
  tone: 'accent' | 'ok';
  /** Доля от предыдущей ступени. */
  note?: string;
}

function share(part: number, whole: number): string | undefined {
  if (!whole) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}

function has(n: number | undefined | null): n is number {
  return typeof n === 'number';
}

/**
 * «Воронка звонков» (docs/specs/2026-09-25-CALL_FUNNEL.md): звонки → уникальные
 * номера → приехали → чеки, плюс качество обработки (дозвонились / пропущено /
 * не перезвонили) и деньги. Состояния: старый бэкенд без `telephony` — данные
 * как есть; `connected:false` — «Подключите телефонию» со ссылкой в
 * интеграции; `telephony.error` — текст ошибки провайдера + «Повторить».
 * Показывается только держателям права calls_view (гейт — в DashboardPage).
 */
export default function CallFunnelWidget() {
  // Границы периода — по календарю АВТОСЕРВИСА (157): сервер режет сутки его поясом.
  const { today, weekStart, monthStart } = useTenantCalendar();
  const [period, setPeriod] = useState<Period>('month');
  const dateFrom = period === 'week' ? weekStart : monthStart;
  const dateTo = today;

  const { data, isLoading, isError, refetch, isFetching } = useQuery<CallFunnel>({
    queryKey: ['call-funnel', dateFrom, dateTo],
    queryFn: async () => (await reportsApi.callFunnel({ dateFrom, dateTo })).data,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });

  const periodLabel = `${format(dayKeyToDate(dateFrom), 'd MMM', { locale: ru })} – ${format(dayKeyToDate(dateTo), 'd MMM', { locale: ru })}`;

  let body: ReactNode;
  if (isLoading && !data) {
    body = (
      <div className="space-y-3 p-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton variant="text" className="w-28" />
            <Skeleton className="h-2 flex-1" />
            <Skeleton variant="text" className="w-8" />
          </div>
        ))}
      </div>
    );
  } else if (isError && !data) {
    body = (
      <div className="p-4">
        <ErrorRow message="Не удалось загрузить воронку звонков" onRetry={() => refetch()} loading={isFetching} />
      </div>
    );
  } else if (data && data.telephony && !data.telephony.connected) {
    body = (
      <div className="flex flex-col items-center px-5 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
          <PhoneOff className="h-5 w-5 text-ink-4" aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">Подключите телефонию</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">
          Когда звонки начнут поступать в Autexa, здесь появится воронка: сколько позвонили, сколько доехали и сколько
          принесли.
        </p>
        <Link to="/integrations" className={cn(buttonClasses({ variant: 'secondary', size: 'sm' }), 'mt-4')}>
          Перейти в интеграции
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  } else if (data) {
    body = <FunnelBody data={data} onRetry={() => refetch()} retrying={isFetching} />;
  } else {
    body = null;
  }

  return (
    <Card padding="none">
      <CardHeader
        dense
        icon={Filter}
        title="Воронка звонков"
        subtitle={periodLabel}
        actions={
          <SegmentedControl
            size="sm"
            aria-label="Период воронки"
            value={period}
            onChange={setPeriod}
            options={periodOptions}
          />
        }
      />
      {body}
    </Card>
  );
}

function FunnelBody({ data, onRetry, retrying }: { data: CallFunnel; onRetry: () => void; retrying: boolean }) {
  const stages: Stage[] = [
    { key: 'calls', label: 'Звонков', value: data.totalCalls, tone: 'accent' },
    {
      key: 'unique',
      label: 'Уникальных номеров',
      value: data.uniqueCallers,
      tone: 'accent',
      note: share(data.uniqueCallers, data.totalCalls),
    },
    {
      key: 'arrived',
      label: 'Приехали',
      value: data.arrivedClients,
      tone: 'ok',
      note: share(data.arrivedClients, data.uniqueCallers),
    },
    { key: 'checks', label: 'Чеков', value: data.createdChecks, tone: 'ok' },
  ];
  const max = Math.max(data.totalCalls, data.uniqueCallers, data.arrivedClients, data.createdChecks, 1);
  const quality = [
    has(data.answeredCalls) ? { label: 'Дозвонились', value: data.answeredCalls, tone: 'neutral' as const } : null,
    has(data.missedCalls)
      ? {
          label: 'Пропущено',
          value: data.missedCalls,
          tone: data.missedCalls > 0 ? ('warn' as const) : ('neutral' as const),
        }
      : null,
    has(data.notCalledBack)
      ? {
          label: 'Не перезвонили',
          value: data.notCalledBack,
          tone: data.notCalledBack > 0 ? ('warn' as const) : ('neutral' as const),
        }
      : null,
    has(data.newCallers) ? { label: 'Новых номеров', value: data.newCallers, tone: 'neutral' as const } : null,
    has(data.knownCallers) ? { label: 'Из базы клиентов', value: data.knownCallers, tone: 'neutral' as const } : null,
    has(data.outgoingCalls) ? { label: 'Исходящих', value: data.outgoingCalls, tone: 'neutral' as const } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <>
      {data.telephony?.error && (
        <div className="px-4 pt-4">
          <ErrorRow
            message={`Не удалось получить звонки: ${data.telephony.error}`}
            onRetry={onRetry}
            loading={retrying}
          />
        </div>
      )}

      <ol className="space-y-2.5 px-4 pt-4" aria-label="Ступени воронки">
        {stages.map((s) => (
          <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-ink-2">{s.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-300 ease-out',
                  s.tone === 'ok' ? 'bg-ok' : 'bg-accent',
                )}
                style={{ width: `${Math.max(s.value > 0 ? 2 : 0, Math.min(100, (s.value / max) * 100))}%` }}
              />
            </div>
            <span className="min-w-[4.5rem] text-right tabular-nums">
              <span className="font-semibold text-ink">{s.value}</span>
              {s.note && <span className="ml-1.5 text-xs text-ink-3">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      {quality.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-line px-4 pt-3">
          {quality.map((q) => (
            <MiniStat key={q.label} size="sm" label={q.label} value={q.value} tone={q.tone} />
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-x-4 border-t border-line bg-surface-2 px-4 py-3">
        <MiniStat size="sm" label="Выручка" value={formatMoney(data.totalRevenue)} />
        <MiniStat size="sm" label="Средний чек" value={formatMoney(data.avgCheckValue)} />
        <MiniStat
          size="sm"
          label="Конверсия"
          value={`${Math.round(data.conversionRate)}%`}
          hint={data.repeatClients ? `Повторных: ${data.repeatClients}` : undefined}
        />
      </div>

      <div className="flex items-center justify-between rounded-b-xl border-t border-line px-4 py-2">
        <span className="text-2xs text-ink-3">Доехавшие — клиенты с чеком после первого звонка в периоде</span>
        <Link
          to="/calls"
          className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-accent-text hover:underline"
        >
          Все звонки
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}
