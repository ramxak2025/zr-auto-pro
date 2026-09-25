import { useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { addDays, addMonths, addWeeks, addYears, format, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import { checksApi } from '../../api/services';
import type { DashboardChartResponse } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { formatMoney } from '../../../../shared/utils/formatters';
import { Card, CardHeader } from '../../ui/Card';
import { IconButton } from '../../ui/IconButton';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { ErrorRow, MiniStat, compactMoney, dayKeyToDate } from './shared';

type ChartPeriod = 'today' | 'week' | 'month' | 'year';

const periodOptions: { value: ChartPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

/**
 * Подпись выбранного окна графика.
 *
 * `todayKey` — сегодняшний день АВТОСЕРВИСА ('YYYY-MM-DD', useTenantCalendar):
 * окно считает сервер поясом тенанта (checks.getDashboardChart), и подпись,
 * посчитанная часами браузера, называла соседний день/неделю/месяц — цифры под
 * ней при этом были правильные, что читается как «график врёт».
 */
function getOffsetLabel(period: ChartPeriod, offset: number, todayKey: string): string {
  const now = dayKeyToDate(todayKey);
  switch (period) {
    case 'today':
      return format(addDays(now, offset), 'd MMMM yyyy', { locale: ru });
    case 'week': {
      const wStart = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), offset);
      const wEnd = addDays(wStart, 6);
      return `${format(wStart, 'd MMM', { locale: ru })} — ${format(wEnd, 'd MMM', { locale: ru })}`;
    }
    case 'month':
      return format(addMonths(startOfMonth(now), offset), 'LLLL yyyy', { locale: ru });
    case 'year':
      return format(addYears(startOfYear(now), offset), 'yyyy');
    default:
      return '';
  }
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function tickLabel(dateStr: string, period: ChartPeriod): string {
  if (period === 'today') return '';
  if (period === 'year') {
    const m = parseInt(dateStr.split('-')[1] ?? '', 10);
    return MONTHS_SHORT[m - 1] ?? '';
  }
  const d = dayKeyToDate(dateStr.slice(0, 10));
  if (period === 'week') return DAYS_SHORT[d.getDay()];
  return `${d.getDate()}`;
}

function pointTitle(dateStr: string, period: ChartPeriod): string {
  if (period === 'year') {
    const [y, m] = dateStr.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return format(d, 'LLLL yyyy', { locale: ru });
  }
  if (period === 'today')
    return dateStr.length > 10 ? dateStr.slice(11, 16) : format(dayKeyToDate(dateStr), 'd MMMM', { locale: ru });
  return format(dayKeyToDate(dateStr.slice(0, 10)), 'd MMMM, EEEEEE', { locale: ru });
}

// Геометрия SVG: viewBox 600×180, preserveAspectRatio="none" растягивает по
// ширине карточки; толщина линий фиксируется vector-effect, подписи и точки
// рисуются HTML-слоем в процентах, чтобы не искажаться.
const W = 600;
const H = 180;
const PAD_X = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;

function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return PAD_X + (i * (W - 2 * PAD_X)) / (n - 1);
}
function yAt(v: number, max: number): number {
  const usable = H - PAD_TOP - PAD_BOTTOM;
  return H - PAD_BOTTOM - (Math.max(v, 0) / max) * usable;
}

function linePath(values: number[], max: number): string {
  if (values.length === 0) return '';
  const n = values.length;
  const pts = values.map((v, i) => ({ x: xAt(i, n), y: yAt(v, max) }));
  if (pts.length === 1) return `M ${pts[0].x - 4} ${pts[0].y} L ${pts[0].x + 4} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const cx = (p.x + c.x) / 2;
    d += ` C ${cx} ${p.y}, ${cx} ${c.y}, ${c.x} ${c.y}`;
  }
  return d;
}

function areaPath(values: number[], max: number): string {
  const line = linePath(values, max);
  if (!line) return '';
  const n = values.length;
  return `${line} L ${xAt(n - 1, n)} ${H - PAD_BOTTOM} L ${xAt(0, n)} ${H - PAD_BOTTOM} Z`;
}

type ChartPoint = DashboardChartResponse['points'][number];

export default function RevenueChart() {
  const { today: tenantToday } = useTenantCalendar();
  const [period, setPeriod] = useState<ChartPeriod>('week');
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  // Прибыль — только держателю profit_view (R7): сервер зануляет profit в
  // dashboard-chart без права, поэтому линию/ячейку прячем, а не рисуем нули.
  const { hasPermission } = useAuth();
  const canSeeProfit = hasPermission('profit_view');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-chart', period, offset],
    queryFn: async () => {
      const res = await checksApi.getDashboardChart(period, offset);
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const points: ChartPoint[] = useMemo(() => data?.points ?? [], [data]);
  const revenueValues = useMemo(() => points.map((p) => p.revenue), [points]);
  const profitValues = useMemo(() => points.map((p) => p.profit), [points]);
  const maxRaw = useMemo(
    () => Math.max(0, ...revenueValues, ...(canSeeProfit ? profitValues : [])),
    [revenueValues, profitValues, canSeeProfit],
  );
  const maxValue = Math.max(maxRaw, 1);
  // Сервер отдаёт точки даже за пустой период (все нули) — не рисуем ось «1 ₽ / 0,5 ₽».
  const isEmptyPeriod = points.length === 0 || maxRaw === 0;

  const handlePeriodChange = (p: ChartPeriod) => {
    setPeriod(p);
    setOffset(0);
    setHover(null);
  };

  // Индекс точки под курсором — из доли ширины; чтение rect только в обработчике.
  const locate = (clientX: number) => {
    const el = plotRef.current;
    if (!el || points.length === 0) return;
    const rect = el.getBoundingClientRect();
    const padPx = (PAD_X / W) * rect.width;
    const usable = Math.max(rect.width - 2 * padPx, 1);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - padPx) / usable));
    setHover(Math.round(ratio * (points.length - 1)));
  };
  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => locate(e.clientX);
  const onTouch = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (t) locate(t.clientX);
  };

  // Дельта периода считается сервером (`previous`) в поясе автосервиса и
  // приходит с готовой подписью («к 9 августа»). Старый бэкенд поля не шлёт.
  const compare = data?.previous ?? null;
  const compareBase = compare?.totalRevenue ?? 0;
  const revChange =
    compare && compareBase > 0 ? Math.round((((data?.totalRevenue ?? 0) - compareBase) / compareBase) * 100) : null;

  const hovered = hover !== null ? points[hover] : null;
  const hoverXPct = hover !== null && points.length > 0 ? (xAt(hover, points.length) / W) * 100 : 0;
  const hoverYPct = hovered ? (yAt(hovered.revenue, maxValue) / H) * 100 : 0;
  const denseTicks = points.length > 16;

  return (
    <Card padding="none">
      <CardHeader
        icon={TrendingUp}
        title="Выручка"
        subtitle={
          <span className="inline-flex items-center gap-1">
            <IconButton
              label="Предыдущий период"
              icon={ChevronLeft}
              size="sm"
              onClick={() => {
                setOffset((o) => o - 1);
                setHover(null);
              }}
              className="-ml-2 h-6 w-6"
            />
            <span className="capitalize tabular-nums">{getOffsetLabel(period, offset, tenantToday)}</span>
            <IconButton
              label="Следующий период"
              icon={ChevronRight}
              size="sm"
              disabled={offset >= 0}
              onClick={() => {
                setOffset((o) => (o < 0 ? o + 1 : 0));
                setHover(null);
              }}
              className="h-6 w-6"
            />
          </span>
        }
        actions={
          <SegmentedControl
            size="sm"
            aria-label="Период графика"
            value={period}
            onChange={handlePeriodChange}
            options={periodOptions}
          />
        }
      />

      <div className="px-4 pt-4">
        {isLoading && !data ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-[180px] w-full" />
            <div className="flex gap-6">
              <Skeleton variant="text" className="w-24" />
              <Skeleton variant="text" className="w-24" />
              <Skeleton variant="text" className="w-16" />
            </div>
          </div>
        ) : isError && !data ? (
          <ErrorRow
            message="Не удалось загрузить график выручки"
            onRetry={() => refetch()}
            loading={isFetching}
            className="mb-4"
          />
        ) : isEmptyPeriod ? (
          <p className="py-14 text-center text-sm text-ink-3">За этот период чеков нет</p>
        ) : (
          <div className="flex gap-2">
            {/* Ось Y */}
            <div
              className="relative w-14 flex-shrink-0 text-right text-2xs tabular-nums text-ink-3"
              style={{ height: H }}
              aria-hidden="true"
            >
              {[1, 0.5, 0].map((pct) => (
                <span
                  key={pct}
                  className="absolute right-0 -translate-y-1/2 pr-1"
                  style={{ top: `${(yAt(maxValue * pct, maxValue) / H) * 100}%` }}
                >
                  {pct === 0 ? '0' : compactMoney(maxValue * pct)}
                </span>
              ))}
            </div>

            {/* Полотно */}
            <div className="min-w-0 flex-1">
              <div
                ref={plotRef}
                className="relative cursor-crosshair select-none"
                style={{ height: H }}
                onMouseMove={onMouseMove}
                onMouseLeave={() => setHover(null)}
                onTouchStart={onTouch}
                onTouchMove={onTouch}
                onTouchEnd={() => setHover(null)}
              >
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="h-full w-full"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="График выручки"
                >
                  <defs>
                    <linearGradient id="rev-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(37 99 235)" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="rgb(37 99 235)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[1, 0.5, 0].map((pct) => (
                    <line
                      key={pct}
                      x1={PAD_X}
                      x2={W - PAD_X}
                      y1={yAt(maxValue * pct, maxValue)}
                      y2={yAt(maxValue * pct, maxValue)}
                      stroke="rgb(226 232 240)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <path d={areaPath(revenueValues, maxValue)} fill="url(#rev-area)" />
                  {canSeeProfit && (
                    <path
                      d={linePath(profitValues, maxValue)}
                      fill="none"
                      stroke="rgb(13 148 136)"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path
                    d={linePath(revenueValues, maxValue)}
                    fill="none"
                    stroke="rgb(37 99 235)"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {hover !== null && (
                    <line
                      x1={xAt(hover, points.length)}
                      x2={xAt(hover, points.length)}
                      y1={PAD_TOP - 6}
                      y2={H - PAD_BOTTOM}
                      stroke="rgb(148 163 184)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>

                {hovered && (
                  <>
                    <span
                      className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-sm"
                      style={{ left: `${hoverXPct}%`, top: `${hoverYPct}%` }}
                      aria-hidden="true"
                    />
                    <div
                      role="status"
                      className={cn(
                        'pointer-events-none absolute top-0 z-10 min-w-[9rem] rounded-md bg-ink px-2.5 py-2 text-xs text-white shadow-pop',
                        hoverXPct > 70 ? '-translate-x-full' : hoverXPct < 30 ? 'translate-x-0' : '-translate-x-1/2',
                      )}
                      style={{ left: `${hoverXPct}%` }}
                    >
                      <p className="font-semibold capitalize">{pointTitle(hovered.date, period)}</p>
                      <p className="mt-1 flex justify-between gap-3 tabular-nums">
                        <span className="text-white/70">Оборот</span>
                        <span>{formatMoney(hovered.revenue)}</span>
                      </p>
                      {canSeeProfit && (
                        <p className="flex justify-between gap-3 tabular-nums">
                          <span className="text-white/70">Прибыль</span>
                          <span>{formatMoney(hovered.profit)}</span>
                        </p>
                      )}
                      <p className="flex justify-between gap-3 tabular-nums">
                        <span className="text-white/70">Чеков</span>
                        <span>{hovered.checkCount}</span>
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Ось X — подписи в процентах под точками */}
              {period !== 'today' && (
                <div className="relative mt-1.5 h-4" aria-hidden="true">
                  {points.map((p, idx) => {
                    const label = tickLabel(p.date, period);
                    if (!label) return null;
                    const dayNum = Number(label);
                    const secondary = denseTicks && Number.isFinite(dayNum) && dayNum % 5 !== 0 && dayNum !== 1;
                    return (
                      <span
                        key={p.date + idx}
                        className={cn(
                          'absolute -translate-x-1/2 text-2xs tabular-nums',
                          hover === idx ? 'font-semibold text-ink' : 'text-ink-3',
                          secondary && 'hidden lg:inline',
                        )}
                        style={{ left: `${(xAt(idx, points.length) / W) * 100}%` }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2 border-t border-line px-5 py-3">
          <div className="flex items-end gap-2">
            <MiniStat
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  Оборот
                </span>
              }
              value={formatMoney(data.totalRevenue)}
            />
            {revChange !== null && revChange !== 0 && compare && (
              <span
                className={cn(
                  'mb-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                  revChange > 0 ? 'bg-ok-soft text-ok-text' : 'bg-bad-soft text-bad-text',
                )}
                title={compare.label}
              >
                {revChange > 0 ? '+' : ''}
                {revChange}% {compare.label}
              </span>
            )}
          </div>
          {canSeeProfit && (
            <MiniStat
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[rgb(13,148,136)]" aria-hidden="true" />
                  Прибыль
                </span>
              }
              value={formatMoney(data.totalProfit)}
            />
          )}
          <MiniStat label="Чеков" value={data.totalChecks || '—'} />
        </div>
      )}
    </Card>
  );
}
