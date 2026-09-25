/**
 * CallsWidget — KPI звонков за сегодня (владелец просил цифры из /calls без
 * списка вызовов). Вся карточка — ссылка в раздел «Звонки». Скрывается у
 * тенантов без телефонии (сегодня и вчера ноль звонков) — чистая главная без
 * пустой коробки. Запросы и ключи кеша не менялись.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowDownLeft, ArrowUpRight, ChevronRight, Phone, PhoneMissed } from 'lucide-react';
import { callsApi } from '../../api/services';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { Card, CardHeader } from '../../ui/Card';
import { cn } from '../../ui/cn';
import { focusRing, toneChip, type Tone } from '../../ui/tokens';

interface CallsSummary {
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
  total: number;
}

/** Соседний день от ключа 'YYYY-MM-DD' — чистая календарная арифметика. */
function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const shifted = new Date(y || 1970, (m || 1) - 1, (d || 1) + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

function dayLabel(dayKey: string): string {
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [, m, d] = dayKey.split('-').map(Number);
  return `${d} ${months[(m || 1) - 1]}`;
}

export default function CallsWidget() {
  /**
   * «Сегодня» и «вчера» — по календарю АВТОСЕРВИСА (157), как на странице
   * звонков (pages/CallsPage) и как сервер отбирает звонки за дату.
   */
  const { today } = useTenantCalendar();
  const yesterdayKey = shiftDayKey(today, -1);

  const { data, isLoading } = useQuery<{ calls: unknown[]; summary: CallsSummary }>({
    queryKey: ['calls-today', today],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: today });
      return res.data as unknown as { calls: unknown[]; summary: CallsSummary };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Вчера — для дельты на главной цифре. Не блокирует: нет данных → нет чипа.
  const { data: yesterday } = useQuery<{ summary: CallsSummary }>({
    queryKey: ['calls-yesterday', yesterdayKey],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: yesterdayKey });
      return res.data as unknown as { summary: CallsSummary };
    },
    staleTime: 5 * 60_000,
  });

  // Без телефонии / нет звонков ни сегодня, ни вчера — не показываем вовсе.
  if (!isLoading && (!data || data.summary.total === 0) && (!yesterday || yesterday.summary.total === 0)) {
    return null;
  }

  const summary = data?.summary;
  const yesterTotal = yesterday?.summary.total ?? 0;
  const totalDelta = summary ? summary.total - yesterTotal : 0;
  const showDelta = !!summary && yesterTotal > 0;

  return (
    <Card padding="none" interactive>
      <Link to="/calls" className={cn('block rounded-xl', focusRing)}>
        <CardHeader
          dense
          icon={Phone}
          title="Звонки сегодня"
          subtitle={dayLabel(today)}
          divider={false}
          actions={
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-3">
              Открыть
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          }
        />

        <div className="px-4 pb-3">
          <div className="flex items-baseline gap-3">
            <p className="text-4xl font-semibold tabular-nums tracking-tight text-ink">
              {isLoading ? '—' : (summary?.total ?? 0)}
            </p>
            {showDelta && (
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                  totalDelta > 0
                    ? 'bg-ok-soft text-ok-text'
                    : totalDelta < 0
                      ? 'bg-bad-soft text-bad-text'
                      : 'bg-surface-3 text-ink-3',
                )}
              >
                {totalDelta > 0 ? '+' : ''}
                {totalDelta} к вчера
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">всего звонков сегодня</p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
          <Tile icon={ArrowDownLeft} label="Входящие" value={summary?.incoming ?? 0} tone="ok" />
          <Tile icon={ArrowUpRight} label="Исходящие" value={summary?.outgoing ?? 0} tone="info" />
          <Tile
            icon={PhoneMissed}
            label="Пропущено"
            value={summary?.missed ?? 0}
            tone={(summary?.missed ?? 0) > 0 ? 'bad' : 'neutral'}
          />
        </div>

        {summary && summary.notCalledBack > 0 && (
          <div className="flex items-center gap-2.5 rounded-b-xl border-t border-warn/30 bg-warn-soft px-4 py-2.5">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
            <p className="flex-1 text-xs text-warn-text">
              Не перезвонили: <span className="font-semibold tabular-nums">{summary.notCalledBack}</span>
            </p>
            <span className="text-2xs font-semibold text-warn-text">обработать →</span>
          </div>
        )}
      </Link>
    </Card>
  );
}

function Tile({ icon: Icon, label, value, tone }: { icon: typeof Phone; label: string; value: number; tone: Tone }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded', toneChip[tone])}>
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
        <span className="truncate text-2xs font-medium text-ink-3">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
