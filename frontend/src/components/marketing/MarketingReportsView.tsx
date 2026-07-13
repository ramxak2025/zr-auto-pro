import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, parseISO, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CalendarDays,
  UserPlus,
  Repeat,
  PhoneCall,
  Star,
  BarChart3,
  Loader2,
  TrendingUp,
  Gift,
  Wallet,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { reportsApi } from '../../api/services';
import { formatMoney } from '../../../../shared/utils/formatters';
import type { MarketingReport, MarketingTrendPoint } from '../../types';

// ─── Period presets ─────────────────────────────────────────────────
const PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
] as const;

type PresetKey = (typeof PRESETS)[number]['key'];
type Range = { from: string; to: string };

function rangeFor(preset: PresetKey): Range {
  const now = new Date();
  const to = format(now, 'yyyy-MM-dd');
  switch (preset) {
    case 'today':
      return { from: to, to };
    case 'week':
      return { from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to };
    case 'month':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to };
    case 'quarter':
      return { from: format(startOfQuarter(now), 'yyyy-MM-dd'), to };
    case 'year':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to };
  }
}

// ─── Number / text helpers ──────────────────────────────────────────
const formatInt = (n: number): string => Math.round(n).toLocaleString('ru-RU');
const formatPct = (n: number): string => `${Math.round(n)}%`;
const formatPct1 = (n: number): string => `${n.toFixed(1)}%`;
/** Compact ruble amount for chart tooltips / axis: 12 300 → 12,3 тыс. */
function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`;
  if (abs >= 10_000) return `${Math.round(n / 1000).toLocaleString('ru-RU')} тыс. ₽`;
  return formatMoney(n);
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

/** '2026-06-15' → 'июн' / 'июн 26' — used on the trend x-axis. */
function bucketLabel(iso: string, grain: 'weekly' | 'monthly'): string {
  try {
    const d = parseISO(iso);
    if (grain === 'monthly') return format(d, 'LLL', { locale: ru });
    return format(d, 'd MMM', { locale: ru });
  } catch {
    return iso;
  }
}
function bucketLabelLong(iso: string, grain: 'weekly' | 'monthly'): string {
  try {
    const d = parseISO(iso);
    if (grain === 'monthly') return format(d, 'LLLL yyyy', { locale: ru });
    return `неделя с ${format(d, 'd MMMM', { locale: ru })}`;
  } catch {
    return iso;
  }
}

// ─── Presentational primitives ──────────────────────────────────────
function Section({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  right,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <header className="flex items-center gap-2.5 px-4 sm:px-5 pt-4 pb-3">
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-xs text-gray-400 truncate" title={subtitle}>
              {subtitle}
            </p>
          )}
        </div>
        {right && <div className="ml-auto flex-shrink-0">{right}</div>}
      </header>
      <div className="px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
    </section>
  );
}

function StatBox({
  label,
  value,
  sub,
  valueClass = 'text-gray-900',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 px-3.5 py-3">
      <p className="text-[11px] font-medium text-gray-500 leading-tight">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums leading-tight ${valueClass}`}>{value}</p>
      {sub != null && <p className="mt-0.5 text-[11px] text-gray-400 tabular-nums leading-tight">{sub}</p>}
    </div>
  );
}

/** Decreasing horizontal bars for a conversion funnel. */
function FunnelBars({ stages, barClass }: { stages: { label: string; value: number }[]; barClass: string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="space-y-2">
      {stages.map((s) => {
        const w = (s.value / max) * 100;
        return (
          <div key={s.label} className="flex items-center gap-2.5 sm:gap-3">
            <span className="w-28 sm:w-44 flex-shrink-0 truncate text-xs text-gray-600">{s.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                style={{ width: `${Math.max(w, 4)}%` }}
              />
            </div>
            <span className="w-11 text-right text-sm font-semibold tabular-nums text-gray-900">
              {formatInt(s.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Generic ranked horizontal-bar list (by-source, by-master, cohort…). Each row
 * shows a label, a proportional bar, and a right-aligned primary metric with an
 * optional secondary. Sorted by the primary metric, descending.
 */
function BarList({
  rows,
  barClass,
  emptyLabel,
}: {
  rows: { key: string; label: string; primary: number; primaryText: string; secondaryText?: string }[];
  barClass: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) return <p className="text-xs text-gray-400">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.map((r) => r.primary));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm text-gray-700">{r.label}</span>
            <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900">
              {r.primaryText}
              {r.secondaryText && <span className="font-normal text-gray-400"> · {r.secondaryText}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${Math.max((r.primary / max) * 100, 4)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Trend chart (hand-rolled SVG — same idiom as MrrTrendChart) ────
const C_W = 640;
const C_H = 176;
const C_PAD = 18;
const C_TOP = 14;
const C_BASE = 14;
const PAD_RATIO = C_PAD / C_W;

type MetricKey = 'revenue' | 'newClients' | 'returningRate' | 'calls' | 'reviews';
const METRICS: {
  key: MetricKey;
  label: string;
  stroke: string;
  fillFrom: string;
  chip: string;
  format: (n: number) => string;
}[] = [
  {
    key: 'revenue',
    label: 'Выручка',
    stroke: 'rgb(16,185,129)',
    fillFrom: 'rgba(16,185,129,0.24)',
    chip: 'bg-emerald-600',
    format: formatMoneyShort,
  },
  {
    key: 'newClients',
    label: 'Новые',
    stroke: 'rgb(37,99,235)',
    fillFrom: 'rgba(37,99,235,0.22)',
    chip: 'bg-blue-600',
    format: (n) => `${formatInt(n)} нов.`,
  },
  {
    key: 'returningRate',
    label: 'Возвращаемость',
    stroke: 'rgb(99,102,241)',
    fillFrom: 'rgba(99,102,241,0.20)',
    chip: 'bg-indigo-600',
    format: formatPct1,
  },
  {
    key: 'calls',
    label: 'Звонки',
    stroke: 'rgb(2,132,199)',
    fillFrom: 'rgba(2,132,199,0.20)',
    chip: 'bg-sky-600',
    format: (n) => `${formatInt(n)} зв.`,
  },
  {
    key: 'reviews',
    label: 'Отзывы',
    stroke: 'rgb(217,119,6)',
    fillFrom: 'rgba(217,119,6,0.20)',
    chip: 'bg-amber-600',
    format: (n) => `${formatInt(n)} отз.`,
  },
];

function coords(values: number[], max: number) {
  const stepX = (C_W - C_PAD * 2) / Math.max(values.length - 1, 1);
  return values.map((v, i) => ({
    x: C_PAD + i * stepX,
    y: C_H - (v / max) * (C_H - C_TOP - C_BASE) - C_BASE,
  }));
}
function wavePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} L ${C_W - C_PAD} ${pts[0].y}`;
  let path = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return path;
}

function TrendChart({ points, grain }: { points: MarketingTrendPoint[]; grain: 'weekly' | 'monthly' }) {
  const [metricKey, setMetricKey] = useState<MetricKey>('revenue');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  const values = useMemo(() => points.map((p) => p[metric.key]), [points, metric.key]);
  const max = useMemo(() => Math.max(1, ...values), [values]);
  const pts = useMemo(() => coords(values, max), [values, max]);

  const total = useMemo(
    () => (metric.key === 'returningRate' ? 0 : values.reduce((s, v) => s + v, 0)),
    [values, metric.key],
  );

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Недостаточно данных для графика за период.</p>;
  }

  const areaD = pts.length > 0 ? `${wavePath(pts)} L ${pts[pts.length - 1].x} ${C_H} L ${pts[0].x} ${C_H} Z` : '';
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const denom = Math.max(points.length - 1, 1);
  const hoverLeftPct = hoverIdx !== null ? (PAD_RATIO + (hoverIdx / denom) * (1 - 2 * PAD_RATIO)) * 100 : 50;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const padPx = rect.width * PAD_RATIO;
    const innerW = Math.max(rect.width - padPx * 2, 1);
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - padPx) / innerW));
    setHoverIdx(Math.round(ratio * denom));
  };

  return (
    <div>
      {/* Metric selector */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetricKey(m.key)}
            className={`h-7 rounded-full px-3 text-xs font-semibold transition-colors ${
              m.key === metricKey ? `${m.chip} text-white shadow-sm` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {m.label}
          </button>
        ))}
        {metric.key !== 'returningRate' && (
          <span className="ml-auto self-center text-xs text-gray-400 tabular-nums">
            Итого: <span className="font-semibold text-gray-600">{metric.format(total)}</span>
          </span>
        )}
      </div>

      <div
        className="relative"
        style={{ height: `${C_H + 22}px` }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${C_W} ${C_H}`} className="w-full" style={{ height: `${C_H}px` }} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`trendGrad-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metric.fillFrom} />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((p) => (
            <line
              key={p}
              x1={C_PAD}
              y1={C_H * (1 - p)}
              x2={C_W - C_PAD}
              y2={C_H * (1 - p)}
              stroke="rgba(15,23,42,0.06)"
              strokeWidth="1"
            />
          ))}

          <path d={areaD} fill={`url(#trendGrad-${metric.key})`} />
          <path
            d={wavePath(pts)}
            fill="none"
            stroke={metric.stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {hoverIdx !== null && pts[hoverIdx] && (
            <>
              <line
                x1={pts[hoverIdx].x}
                y1={0}
                x2={pts[hoverIdx].x}
                y2={C_H}
                stroke={metric.stroke}
                strokeOpacity="0.3"
                strokeWidth="1"
              />
              <circle cx={pts[hoverIdx].x} cy={pts[hoverIdx].y} r="4" fill={metric.stroke} />
            </>
          )}
        </svg>

        {/* x-axis labels (thinned to avoid crowding) */}
        <div className="relative mt-1 h-4">
          {points.map((p, idx) => {
            const step = Math.ceil(points.length / 8);
            if (idx % step !== 0 && idx !== points.length - 1) return null;
            const xPct = (PAD_RATIO + (idx / denom) * (1 - 2 * PAD_RATIO)) * 100;
            return (
              <span
                key={p.periodStart}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] capitalize text-gray-400"
                style={{ left: `${xPct}%` }}
              >
                {bucketLabel(p.periodStart, grain)}
              </span>
            );
          })}
        </div>

        {hovered && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-left shadow-lg"
            style={{ left: `${Math.min(Math.max(hoverLeftPct, 12), 88)}%` }}
          >
            <p className="text-[10px] font-medium capitalize text-gray-400">
              {bucketLabelLong(hovered.periodStart, grain)}
            </p>
            <p className="text-sm font-bold text-white tabular-nums">{metric.format(hovered[metric.key])}</p>
            <p className="mt-0.5 text-[10px] text-gray-300 tabular-nums">
              {formatMoneyShort(hovered.revenue)} · {hovered.newClients} нов. · {hovered.calls} зв.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Period selector ────────────────────────────────────────────────
function PeriodBar({
  range,
  preset,
  today,
  onPreset,
  onFrom,
  onTo,
}: {
  range: Range;
  preset: PresetKey | 'custom';
  today: string;
  onPreset: (p: PresetKey) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="hidden h-4 w-4 flex-shrink-0 text-gray-400 sm:block" />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPreset(p.key)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                preset === p.key
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 sm:ml-auto">
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => onFrom(e.target.value)}
            aria-label="Дата начала"
            className={`h-8 rounded-lg border bg-white px-2 text-xs text-gray-700 transition-colors focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400/30 ${
              preset === 'custom' ? 'border-primary-300' : 'border-gray-200'
            }`}
          />
          <span className="text-gray-300">—</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(e) => onTo(e.target.value)}
            aria-label="Дата конца"
            className={`h-8 rounded-lg border bg-white px-2 text-xs text-gray-700 transition-colors focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400/30 ${
              preset === 'custom' ? 'border-primary-300' : 'border-gray-200'
            }`}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Report body ────────────────────────────────────────────────────
function ReportBody({ data }: { data: MarketingReport }) {
  const { acquisition: acq, retention: ret, calls: c, reviews: rv, loyalty: loy, revenue: rev, trends } = data;

  const [grain, setGrain] = useState<'weekly' | 'monthly'>('monthly');
  const trendPoints = grain === 'monthly' ? trends.monthly : trends.weekly;

  const totalRev = acq.newRevenue + acq.returningRevenue;
  const newRevPct = totalRev > 0 ? (acq.newRevenue / totalRev) * 100 : 0;
  const sources = [...acq.bySource].sort((a, b) => b.count - a.count);
  const cohort = [...acq.firstVisitCohort].sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  const repeatDist = [...ret.repeatPurchaseDistribution];
  const repeatTotal = repeatDist.reduce((s, b) => s + b.clients, 0);
  const repeatMax = Math.max(1, ...repeatDist.map((b) => b.clients));

  const sentiment = rv.positive + rv.negative;
  const posShare = sentiment > 0 ? (rv.positive / sentiment) * 100 : 0;

  const revBySource = [...rev.bySource].sort((a, b) => b.revenue - a.revenue);
  const revByMaster = [...rev.byMaster].sort((a, b) => b.revenue - a.revenue);
  const revTotalSource = revBySource.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="space-y-4">
      {/* ── Тренды (hero) ── */}
      <Section
        icon={TrendingUp}
        iconClass="bg-primary-50 text-primary-600"
        title="Тренды"
        subtitle="Динамика ключевых метрик за период"
        right={
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {(['weekly', 'monthly'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrain(g)}
                className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                  grain === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {g === 'weekly' ? 'Недели' : 'Месяцы'}
              </button>
            ))}
          </div>
        }
      >
        <TrendChart points={trendPoints} grain={grain} />
      </Section>

      {/* ── Привлечение ── */}
      <Section
        icon={UserPlus}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Привлечение"
        subtitle="Считаем по дате заведения клиента в базу"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <StatBox
            label="Новые (добавлены в базу за период)"
            value={formatInt(acq.newClients)}
            sub={formatMoney(acq.newRevenue)}
            valueClass="text-emerald-600"
          />
          <StatBox
            label="Существующие (уже были в базе)"
            value={formatInt(acq.returningClients)}
            sub={formatMoney(acq.returningRevenue)}
            valueClass="text-blue-600"
          />
        </div>

        {totalRev > 0 && (
          <div className="mt-3">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${newRevPct}%` }} />
              <div className="bg-blue-500 transition-all duration-500" style={{ width: `${100 - newRevPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500 tabular-nums">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                Новые {formatMoney(acq.newRevenue)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                Существующие {formatMoney(acq.returningRevenue)}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">Новые по источникам</p>
            <BarList
              barClass="bg-primary-500"
              emptyLabel="Источники не указаны"
              rows={sources.map((s) => ({
                key: s.source || 'none',
                label: s.source || 'Без источника',
                primary: s.count,
                primaryText: formatInt(s.count),
                secondaryText: formatMoney(s.revenue),
              }))}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">Когорты первого визита</p>
            <BarList
              barClass="bg-emerald-500"
              emptyLabel="Новых клиентов за период нет"
              rows={cohort.map((wk) => ({
                key: wk.periodStart,
                label: bucketLabelLong(wk.periodStart, 'weekly'),
                primary: wk.newClients,
                primaryText: formatInt(wk.newClients),
                secondaryText: formatMoney(wk.revenue),
              }))}
            />
          </div>
        </div>
      </Section>

      {/* ── Удержание ── */}
      <Section
        icon={Repeat}
        iconClass="bg-indigo-50 text-indigo-600"
        title="Удержание"
        subtitle="За всё время по клиентам периода"
      >
        <div className="grid grid-cols-3 gap-2.5">
          <StatBox label="Возвращаемость" value={formatPct(ret.returningRate)} valueClass="text-indigo-600" />
          <StatBox label="Средний LTV" value={formatMoney(ret.avgLtv)} />
          <StatBox
            label="Между визитами"
            value={
              <>
                {formatInt(ret.avgDaysBetweenVisits)}
                <span className="ml-1 text-sm font-medium text-gray-400">
                  {plural(Math.round(ret.avgDaysBetweenVisits), ['день', 'дня', 'дней'])}
                </span>
              </>
            }
          />
        </div>

        {repeatTotal > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-gray-500">Частота визитов (за всё время)</p>
            <div className="flex items-end justify-between gap-2 sm:gap-3">
              {repeatDist.map((b) => {
                const h = (b.clients / repeatMax) * 100;
                const share = repeatTotal > 0 ? (b.clients / repeatTotal) * 100 : 0;
                return (
                  <div key={b.visits} className="flex flex-1 flex-col items-center">
                    <span className="mb-1 text-[11px] font-semibold tabular-nums text-gray-700">
                      {formatInt(b.clients)}
                    </span>
                    <div className="flex h-24 w-full items-end justify-center">
                      <div
                        className="w-full max-w-[44px] rounded-t-md bg-indigo-400 transition-all duration-500"
                        style={{ height: `${Math.max(h, 3)}%` }}
                        title={`${formatPct(share)} клиентов`}
                      />
                    </div>
                    <span className="mt-1.5 text-[11px] text-gray-500">
                      {b.visits === '1' ? '1 визит' : b.visits === '5+' ? '5+ визитов' : `${b.visits} виз.`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* ── Звонки — воронка ── */}
      <Section
        icon={PhoneCall}
        iconClass="bg-sky-50 text-sky-600"
        title="Звонки — воронка"
        subtitle="Телефония и путь обращения в заказ-наряд"
        right={
          c.total > 0 ? <span className="badge-info tabular-nums">{formatPct(c.answerRate)} ответов</span> : undefined
        }
      >
        {c.total === 0 ? (
          <p className="text-sm text-gray-400">
            Нет данных о звонках за период. Подключите телефонию «Мои Звонки» в разделе «Интеграции».
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
              <StatBox label="Всего" value={formatInt(c.total)} />
              <StatBox label="Входящие" value={formatInt(c.incoming)} />
              <StatBox label="Исходящие" value={formatInt(c.outgoing)} />
              <StatBox
                label="Пропущено"
                value={formatInt(c.missed)}
                valueClass={c.missed > 0 ? 'text-amber-600' : 'text-gray-900'}
              />
              <StatBox
                label="Не перезвонили"
                value={formatInt(c.notCalledBack)}
                valueClass={c.notCalledBack > 0 ? 'text-red-600' : 'text-gray-900'}
              />
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-gray-500">Воронка обращений</p>
              <FunnelBars
                barClass="bg-sky-500"
                stages={[
                  { label: 'Уникальные звонившие', value: c.funnel.uniqueCallers },
                  { label: 'Доехали до сервиса', value: c.funnel.arrivedClients },
                  { label: 'Оформлено заказ-нарядов', value: c.funnel.createdChecks },
                ]}
              />
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <StatBox label="Конверсия" value={formatPct(c.funnel.conversionRate)} valueClass="text-sky-600" />
                <StatBox label="Повторные" value={formatInt(c.funnel.repeatClients)} />
                <StatBox label="Выручка" value={formatMoney(c.funnel.revenue)} valueClass="text-emerald-600" />
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ── Отзывы ── */}
      <Section icon={Star} iconClass="bg-amber-50 text-amber-600" title="Отзывы" subtitle="Оценки и запросы за период">
        {rv.total === 0 && rv.tokensSent === 0 ? (
          <p className="text-sm text-gray-400">Отзывов и запросов за период нет.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-gray-50 px-3.5 py-3">
                <p className="text-[11px] font-medium text-gray-500 leading-tight">Средняя оценка</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-lg font-bold tabular-nums leading-tight text-gray-900">
                  {rv.avgRating.toFixed(1)}
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400 tabular-nums leading-tight">
                  {formatInt(rv.total)} {plural(rv.total, ['отзыв', 'отзыва', 'отзывов'])}
                </p>
              </div>

              <div className="rounded-xl bg-gray-50 px-3.5 py-3">
                <p className="text-[11px] font-medium text-gray-500 leading-tight">Тональность</p>
                {sentiment > 0 ? (
                  <>
                    <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                      <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${posShare}%` }} />
                      <div className="bg-red-400 transition-all duration-500" style={{ width: `${100 - posShare}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums">
                      <span className="flex items-center gap-1 text-emerald-600">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {formatInt(rv.positive)}
                      </span>
                      <span className="flex items-center gap-1 text-red-500">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
                        {formatInt(rv.negative)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-1.5 text-[11px] text-gray-400">Пока без оценок</p>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatBox label="Отвечаемость" value={formatPct(rv.responseRate)} valueClass="text-amber-600" />
              <StatBox label="Конверсия" value={formatPct(rv.conversionRate)} />
              <StatBox label="Отправлено" value={formatInt(rv.tokensSent)} />
              <StatBox label="Ответили" value={formatInt(rv.tokensResponded)} />
            </div>
          </>
        )}
      </Section>

      {/* ── Лояльность ── */}
      <Section
        icon={Gift}
        iconClass="bg-fuchsia-50 text-fuchsia-600"
        title="Лояльность"
        subtitle="Бонусная программа за период"
        right={
          loy.enabled ? (
            <span className="badge-success tabular-nums">{formatPct1(loy.accrualPercent)} кешбэк</span>
          ) : (
            <span className="badge-gray">выключена</span>
          )
        }
      >
        {!loy.enabled && loy.accrualCount === 0 && loy.redemptionCount === 0 && loy.outstandingBalance === 0 ? (
          <p className="text-sm text-gray-400">
            Бонусная программа не используется. Включите её в разделе «Лояльность», чтобы начислять клиентам кешбэк.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatBox label="Участники" value={formatInt(loy.participants)} valueClass="text-fuchsia-600" />
              <StatBox
                label="Начислено"
                value={formatMoney(loy.pointsAccrued)}
                sub={`${formatInt(loy.accrualCount)} ${plural(loy.accrualCount, ['операция', 'операции', 'операций'])}`}
                valueClass="text-emerald-600"
              />
              <StatBox
                label="Списано"
                value={formatMoney(loy.pointsRedeemed)}
                sub={`${formatInt(loy.redemptionCount)} ${plural(loy.redemptionCount, ['операция', 'операции', 'операций'])}`}
                valueClass="text-blue-600"
              />
              <StatBox label="Остаток бонусов" value={formatMoney(loy.outstandingBalance)} />
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-gray-400">
              «Остаток бонусов» — текущая суммарная задолженность программы перед клиентами за всё время, а не только за
              период.
            </p>
          </>
        )}
      </Section>

      {/* ── Выручка ── */}
      <Section
        icon={Wallet}
        iconClass="bg-green-50 text-green-600"
        title="Выручка"
        subtitle="По источникам клиентов и мастерам (без гарантийных)"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
              По источникам
            </p>
            <BarList
              barClass="bg-green-500"
              emptyLabel="Выручки за период нет"
              rows={revBySource.map((r) => ({
                key: r.source || 'none',
                label: r.source || 'Без источника',
                primary: r.revenue,
                primaryText: formatMoney(r.revenue),
                secondaryText: `${formatInt(r.checks)} ${plural(r.checks, ['чек', 'чека', 'чеков'])}`,
              }))}
            />
            {revTotalSource > 0 && (
              <p className="mt-2 text-[11px] text-gray-400 tabular-nums">Всего: {formatMoney(revTotalSource)}</p>
            )}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <Users className="h-3.5 w-3.5 text-gray-400" />
              По мастерам
            </p>
            <BarList
              barClass="bg-teal-500"
              emptyLabel="Выручки за период нет"
              rows={revByMaster.map((r) => ({
                key: r.masterId ?? 'none',
                label: r.masterName,
                primary: r.revenue,
                primaryText: formatMoney(r.revenue),
                secondaryText: `${formatInt(r.checks)} ${plural(r.checks, ['чек', 'чека', 'чеков'])}`,
              }))}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────
export default function MarketingReportsView() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range, setRange] = useState<Range>(() => rangeFor('month'));
  const [preset, setPreset] = useState<PresetKey | 'custom'>('month');

  const applyPreset = (p: PresetKey) => {
    setPreset(p);
    setRange(rangeFor(p));
  };
  const setFrom = (from: string) => {
    setPreset('custom');
    setRange((r) => ({ ...r, from }));
  };
  const setTo = (to: string) => {
    setPreset('custom');
    setRange((r) => ({ ...r, to }));
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['marketing-report', range.from, range.to],
    queryFn: () => reportsApi.getMarketingReport({ from: range.from, to: range.to }),
    select: (res) => res.data as MarketingReport,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: Boolean(range.from && range.to),
  });

  const isEmpty =
    data != null &&
    data.acquisition.newClients === 0 &&
    data.acquisition.returningClients === 0 &&
    data.calls.total === 0 &&
    data.reviews.total === 0 &&
    data.reviews.tokensSent === 0 &&
    data.loyalty.accrualCount === 0 &&
    data.loyalty.redemptionCount === 0 &&
    data.revenue.bySource.length === 0;

  return (
    <div className="space-y-4">
      <PeriodBar range={range} preset={preset} today={today} onPreset={applyPreset} onFrom={setFrom} onTo={setTo} />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
        </div>
      ) : isError ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
          <p className="text-sm text-gray-500">Не удалось загрузить отчёт.</p>
          <button type="button" onClick={() => refetch()} className="btn-secondary btn-sm mt-3">
            Повторить
          </button>
        </div>
      ) : !data || isEmpty ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-gray-200" />
          <p className="mt-3 text-sm font-medium text-gray-500">За период данных нет</p>
          <p className="mt-1 text-xs text-gray-400">Выберите другой период или дождитесь активности клиентов</p>
        </div>
      ) : (
        <div
          className={`transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}
          aria-busy={isFetching}
        >
          <ReportBody data={data} />
        </div>
      )}
    </div>
  );
}
