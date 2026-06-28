import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { TrendingUp, Loader2, Info, Activity, UserPlus } from 'lucide-react';

import { adminApi } from '../api/services';
import type { MrrTrendPoint } from '../types';

// Plot geometry (SVG user units). Same hand-rolled wave approach the owner
// dashboard's RevenueChart uses — no charting lib in this project.
const CHART_W = 600;
const CHART_H = 180;
const PADDING = 16; // horizontal inset so the first/last points aren't clipped
const TOP_PAD = 16;
const BASE_PAD = 14;
const PAD_RATIO = PADDING / CHART_W;

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

/** 'YYYY-MM' → 'июн' (short month). */
function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLL', { locale: ru });
}

/** 'YYYY-MM' → 'июнь 2026' (tooltip). */
function longMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale: ru });
}

function pointCoords(values: number[], max: number) {
  const stepX = (CHART_W - PADDING * 2) / Math.max(values.length - 1, 1);
  return values.map((v, i) => ({
    x: PADDING + i * stepX,
    y: CHART_H - (v / max) * (CHART_H - TOP_PAD - BASE_PAD) - BASE_PAD,
  }));
}

/** Smooth cubic wave through the points. */
function buildWavePath(values: number[], max: number): string {
  const pts = pointCoords(values, max);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x} ${pts[0].y}`;
  let path = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return path;
}

function buildAreaPath(values: number[], max: number): string {
  const wave = buildWavePath(values, max);
  if (!wave) return '';
  const stepX = (CHART_W - PADDING * 2) / Math.max(values.length - 1, 1);
  const lastX = PADDING + (values.length - 1) * stepX;
  return `${wave} L ${lastX} ${CHART_H} L ${PADDING} ${CHART_H} Z`;
}

export default function MrrTrendChart() {
  const months = 12;
  const {
    data: points,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-mrr-trends', months],
    queryFn: () => adminApi.getMrrTrends(months),
    select: (res) => res.data as MrrTrendPoint[],
    staleTime: 5 * 60_000,
  });

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const mrrValues = useMemo(() => points?.map((p) => p.mrr) ?? [], [points]);
  const activeValues = useMemo(() => points?.map((p) => p.activeTenants) ?? [], [points]);

  const maxMrr = useMemo(() => Math.max(1, ...mrrValues), [mrrValues]);
  const maxActive = useMemo(() => Math.max(1, ...activeValues), [activeValues]);

  const latest = points && points.length > 0 ? points[points.length - 1] : null;
  const newTotal = useMemo(() => (points ?? []).reduce((sum, p) => sum + p.newTenants, 0), [points]);

  // Headline change vs the previous month.
  const mrrChange = useMemo(() => {
    if (mrrValues.length < 2) return 0;
    const prev = mrrValues[mrrValues.length - 2];
    const last = mrrValues[mrrValues.length - 1];
    if (prev <= 0) return 0;
    return Math.round(((last - prev) / prev) * 100);
  }, [mrrValues]);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!points || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const padPx = rect.width * PAD_RATIO;
    const innerW = Math.max(rect.width - padPx * 2, 1);
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - padPx) / innerW));
    setHoverIdx(Math.round(ratio * (points.length - 1)));
  };

  const hovered = hoverIdx !== null && points ? points[hoverIdx] : null;
  const mrrPts = pointCoords(mrrValues, maxMrr);
  const hoverLeftPct =
    hoverIdx !== null && points && points.length > 1
      ? (PAD_RATIO + (hoverIdx / (points.length - 1)) * (1 - 2 * PAD_RATIO)) * 100
      : 50;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 leading-tight">Динамика MRR</h2>
              <p className="text-xs text-gray-500">Помесячно за последний год</p>
            </div>
          </div>
        </div>
        <span
          className="flex items-center gap-1 text-xs text-gray-400 cursor-help"
          title="MRR восстановлен из текущего состояния подписок: исторических снимков платформа не хранит, поэтому тенант учитывается в месяце, если он уже существовал к концу месяца и его подписка тогда была действительна. Активность берётся по текущему is_active."
        >
          <Info className="w-3.5 h-3.5" />
          как считается
        </span>
      </div>

      {/* Legend */}
      <div className="px-5 pb-2 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-emerald-500" />
          MRR (₽)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-indigo-400" />
          Активные клиенты
        </span>
      </div>

      {/* Plot */}
      <div className="px-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
          </div>
        ) : isError ? (
          <div className="text-center py-14">
            <p className="text-sm text-gray-500">Не удалось загрузить динамику MRR.</p>
            <button type="button" onClick={() => refetch()} className="btn-secondary btn-sm mt-3">
              Повторить
            </button>
          </div>
        ) : !points || points.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">Пока нет данных для графика.</div>
        ) : (
          <div>
            <div
              className="relative"
              style={{ height: `${CHART_H + 20}px` }}
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                className="w-full"
                style={{ height: `${CHART_H}px` }}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Gridlines */}
                {[0.25, 0.5, 0.75].map((pct) => (
                  <line
                    key={pct}
                    x1={PADDING}
                    y1={CHART_H * (1 - pct)}
                    x2={CHART_W - PADDING}
                    y2={CHART_H * (1 - pct)}
                    stroke="rgba(15,23,42,0.06)"
                    strokeWidth="1"
                  />
                ))}

                {/* Active tenants — faint secondary line (own scale) */}
                <path
                  d={buildWavePath(activeValues, maxActive)}
                  fill="none"
                  stroke="rgb(129,140,248)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                />

                {/* MRR — headline area + line */}
                <path d={buildAreaPath(mrrValues, maxMrr)} fill="url(#mrrGrad)" />
                <path
                  d={buildWavePath(mrrValues, maxMrr)}
                  fill="none"
                  stroke="rgb(16,185,129)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Hover marker */}
                {hoverIdx !== null && mrrPts[hoverIdx] && (
                  <>
                    <line
                      x1={mrrPts[hoverIdx].x}
                      y1={TOP_PAD - 8}
                      x2={mrrPts[hoverIdx].x}
                      y2={CHART_H}
                      stroke="rgba(16,185,129,0.35)"
                      strokeWidth="1"
                    />
                    <circle cx={mrrPts[hoverIdx].x} cy={mrrPts[hoverIdx].y} r="4" fill="rgb(16,185,129)" />
                  </>
                )}
              </svg>

              {/* Month labels aligned under their data points */}
              <div className="relative mt-1 h-4">
                {points.map((p, idx) => {
                  const denom = Math.max(points.length - 1, 1);
                  const xPct = (PAD_RATIO + (idx / denom) * (1 - 2 * PAD_RATIO)) * 100;
                  return (
                    <span
                      key={p.month}
                      className="absolute -translate-x-1/2 text-[9px] text-gray-400 capitalize"
                      style={{ left: `${xPct}%` }}
                    >
                      {shortMonth(p.month)}
                    </span>
                  );
                })}
              </div>

              {/* Hover tooltip */}
              {hovered && (
                <div
                  className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-left shadow-lg"
                  style={{ left: `${hoverLeftPct}%` }}
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 capitalize">
                    {longMonth(hovered.month)}
                  </p>
                  <p className="text-sm font-bold text-emerald-300">{formatRub(hovered.mrr)}</p>
                  <p className="mt-0.5 text-[10px] text-gray-300">
                    Активных: {hovered.activeTenants} · новых: {hovered.newTenants}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Summary row */}
      {!isLoading && !isError && points && points.length > 0 && (
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 mt-2">
          <div className="px-4 py-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Текущий MRR</p>
            <p className="mt-0.5 text-base font-bold text-gray-900">{formatRub(latest?.mrr ?? 0)}</p>
            {mrrChange !== 0 && (
              <p className={`text-[11px] font-medium ${mrrChange > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {mrrChange > 0 ? '+' : ''}
                {mrrChange}% за месяц
              </p>
            )}
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Активных сейчас</p>
            <p className="mt-0.5 flex items-center justify-center gap-1 text-base font-bold text-gray-900">
              <Activity className="w-3.5 h-3.5 text-indigo-500" />
              {latest?.activeTenants ?? 0}
            </p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Новых за период</p>
            <p className="mt-0.5 flex items-center justify-center gap-1 text-base font-bold text-gray-900">
              <UserPlus className="w-3.5 h-3.5 text-teal-500" />
              {newTotal}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
