import { useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, TrendingUp } from 'lucide-react';

import { adminApi } from '../api/services';
import type { MrrTrendPoint } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';
import { Card, CardHeader } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import { ErrorRow, MiniStat, compactRub, longMonth, shortMonth } from './admin/adminUi';

// Геометрия SVG — та же, что у RevenueChart на Главной: viewBox 600×180,
// preserveAspectRatio="none" растягивает по ширине карточки, толщина линий
// фиксируется vector-effect, подписи и точки рисуются HTML-слоем в процентах.
const W = 600;
const H = 180;
const PAD_X = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;

const CALC_HINT =
  'MRR восстановлен из текущего состояния подписок: исторических снимков платформа не хранит, поэтому ' +
  'тенант учитывается в месяце, если он уже существовал к концу месяца и его подписка тогда была ' +
  'действительна. Активность берётся по текущему is_active.';

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

/** «Динамика MRR» — помесячно за год; вторая линия — активные клиенты (своя шкала). */
export default function MrrTrendChart() {
  const months = 12;
  const {
    data: points,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin-mrr-trends', months],
    queryFn: () => adminApi.getMrrTrends(months),
    select: (res) => res.data as MrrTrendPoint[],
    staleTime: 5 * 60_000,
  });

  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const mrrValues = useMemo(() => points?.map((p) => p.mrr) ?? [], [points]);
  const activeValues = useMemo(() => points?.map((p) => p.activeTenants) ?? [], [points]);
  const maxMrr = useMemo(() => Math.max(1, ...mrrValues), [mrrValues]);
  const maxActive = useMemo(() => Math.max(1, ...activeValues), [activeValues]);

  const latest = points && points.length > 0 ? points[points.length - 1] : null;
  const newTotal = useMemo(() => (points ?? []).reduce((sum, p) => sum + p.newTenants, 0), [points]);

  // Изменение к прошлому месяцу.
  const mrrChange = useMemo(() => {
    if (mrrValues.length < 2) return null;
    const prev = mrrValues[mrrValues.length - 2];
    const last = mrrValues[mrrValues.length - 1];
    if (prev <= 0) return null;
    return Math.round(((last - prev) / prev) * 100);
  }, [mrrValues]);

  // Индекс точки под курсором — из доли ширины; чтение rect только в обработчике.
  const locate = (clientX: number) => {
    const el = plotRef.current;
    if (!el || !points || points.length === 0) return;
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

  const n = points?.length ?? 0;
  const hovered = hover !== null && points ? points[hover] : null;
  const hoverXPct = hover !== null && n > 0 ? (xAt(hover, n) / W) * 100 : 0;
  const hoverYPct = hovered ? (yAt(hovered.mrr, maxMrr) / H) * 100 : 0;
  const isEmpty = n === 0 || mrrValues.every((v) => v === 0);
  const denseTicks = n > 8;

  return (
    <Card padding="none">
      <CardHeader
        icon={TrendingUp}
        title="Динамика MRR"
        subtitle="Помесячно за последний год"
        actions={
          <Tooltip content={CALC_HINT} side="left">
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-3 hover:text-ink',
                focusRing,
              )}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              как считается
            </button>
          </Tooltip>
        }
      />

      <div className="px-4 pt-4">
        {isLoading ? (
          <div className="space-y-3 pb-5" aria-busy="true">
            <Skeleton className="h-[180px] w-full" />
            <div className="flex gap-6">
              <Skeleton variant="text" className="w-24" />
              <Skeleton variant="text" className="w-24" />
              <Skeleton variant="text" className="w-16" />
            </div>
          </div>
        ) : isError ? (
          <ErrorRow
            message="Не удалось загрузить динамику MRR"
            onRetry={() => refetch()}
            loading={isFetching}
            className="mb-4"
          />
        ) : isEmpty ? (
          <p className="py-12 text-center text-sm text-ink-3">Пока нет данных для графика.</p>
        ) : (
          <>
            {/* Легенда */}
            <ul className="mb-2 flex flex-wrap items-center gap-4 px-1 text-xs text-ink-3" aria-label="Легенда">
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded bg-accent" aria-hidden="true" />
                MRR, ₽
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-3 rounded border-t-2 border-dashed border-[#0d9488]"
                  aria-hidden="true"
                />
                Активные клиенты
              </li>
            </ul>

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
                    style={{ top: `${(yAt(maxMrr * pct, maxMrr) / H) * 100}%` }}
                  >
                    {pct === 0 ? '0' : compactRub(maxMrr * pct)}
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
                    aria-label="График MRR по месяцам"
                  >
                    <defs>
                      <linearGradient id="mrr-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(37 99 235)" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="rgb(37 99 235)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[1, 0.5, 0].map((pct) => (
                      <line
                        key={pct}
                        x1={PAD_X}
                        x2={W - PAD_X}
                        y1={yAt(maxMrr * pct, maxMrr)}
                        y2={yAt(maxMrr * pct, maxMrr)}
                        stroke="rgb(226 232 240)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <path d={areaPath(mrrValues, maxMrr)} fill="url(#mrr-area)" />
                    <path
                      d={linePath(activeValues, maxActive)}
                      fill="none"
                      stroke="rgb(13 148 136)"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={linePath(mrrValues, maxMrr)}
                      fill="none"
                      stroke="rgb(37 99 235)"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {hover !== null && (
                      <line
                        x1={xAt(hover, n)}
                        x2={xAt(hover, n)}
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
                        role="tooltip"
                        className={cn(
                          'pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs text-white shadow-pop',
                          hoverXPct > 70 ? '-translate-x-full' : hoverXPct < 30 ? '' : '-translate-x-1/2',
                        )}
                        style={{ left: `${hoverXPct}%` }}
                      >
                        <p className="capitalize text-white/70">{longMonth(hovered.month)}</p>
                        <p className="font-semibold tabular-nums">{formatMoney(hovered.mrr)}</p>
                        <p className="tabular-nums text-white/70">
                          Активных: {hovered.activeTenants} · новых: {hovered.newTenants}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Подписи месяцев под точками */}
                <div className="relative mt-1.5 h-4" aria-hidden="true">
                  {points!.map((p, idx) => {
                    if (denseTicks && idx % 2 === 1 && idx !== n - 1) return null;
                    const xPct = (xAt(idx, n) / W) * 100;
                    return (
                      <span
                        key={p.month}
                        className={cn(
                          'absolute -translate-x-1/2 text-2xs capitalize tabular-nums',
                          hover === idx ? 'font-medium text-ink' : 'text-ink-3',
                        )}
                        style={{ left: `${xPct}%` }}
                      >
                        {shortMonth(p.month)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Сводка */}
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line py-4">
              <MiniStat
                label="Текущий MRR"
                value={formatMoney(latest?.mrr ?? 0)}
                hint={
                  mrrChange !== null && mrrChange !== 0 ? (
                    <span className={mrrChange > 0 ? 'text-ok-text' : 'text-bad-text'}>
                      {mrrChange > 0 ? '+' : '−'}
                      {Math.abs(mrrChange)}% за месяц
                    </span>
                  ) : undefined
                }
              />
              <MiniStat label="Активных сейчас" value={latest?.activeTenants ?? 0} />
              <MiniStat label="Новых за период" value={newTotal} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
