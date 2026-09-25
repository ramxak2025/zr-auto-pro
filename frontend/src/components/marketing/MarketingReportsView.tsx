import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, parseISO, startOfQuarter, startOfYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  UserPlus,
  Repeat,
  PhoneCall,
  Star,
  BarChart3,
  TrendingUp,
  Gift,
  Wallet,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { reportsApi } from '../../api/services';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { formatMoney } from '../../../../shared/utils/formatters';
import type { MarketingReport, MarketingTrendPoint } from '../../types';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { toneText, type Tone } from '../../ui/tokens';
import { EmptyState, SectionCard, SectionError, plural } from './marketingKit';

// ─── Period presets ─────────────────────────────────────────────────
const PRESETS = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
] as const;

type PresetKey = (typeof PRESETS)[number]['value'];
type Range = { from: string; to: string };
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → локальная Date без сдвига пояса (только календарная арифметика). */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

// ─── Number / text helpers ──────────────────────────────────────────
const pct1Fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const formatInt = (n: number): string => Math.round(n).toLocaleString('ru-RU');
const formatPct = (n: number): string => `${Math.round(n)}%`;
const formatPct1 = (n: number): string => `${pct1Fmt.format(n)}%`;
const compactFmt = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
/** Compact ruble amount for chart tooltips / axis: 12 300 → 12,3 тыс. ₽ */
function formatMoneyShort(n: number): string {
  return Math.abs(n) >= 10_000 ? `${compactFmt.format(n)} ₽` : formatMoney(n);
}

/** '2026-06-15' → 'июн' / '15 июн' — used on the trend x-axis. */
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
function StatBox({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3.5 py-3">
      <p className="truncate text-xs leading-tight text-ink-3">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-lg font-semibold leading-tight tabular-nums',
          tone === 'neutral' ? 'text-ink' : toneText[tone],
        )}
      >
        {value}
      </p>
      {sub != null && <p className="mt-0.5 truncate text-2xs leading-tight tabular-nums text-ink-3">{sub}</p>}
    </div>
  );
}

function SubTitle({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-3">
      {Icon && <Icon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />}
      {children}
    </p>
  );
}

/** Decreasing horizontal bars for a conversion funnel. */
function FunnelBars({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="space-y-2">
      {stages.map((s) => {
        const w = (s.value / max) * 100;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-28 flex-shrink-0 truncate text-xs text-ink-2 sm:w-44">{s.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(w, 3)}%` }} />
            </div>
            <span className="w-12 text-right text-sm font-semibold tabular-nums text-ink">{formatInt(s.value)}</span>
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
  emptyLabel,
}: {
  rows: { key: string; label: string; primary: number; primaryText: string; secondaryText?: string }[];
  emptyLabel: string;
}) {
  if (rows.length === 0) return <p className="text-xs text-ink-3">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.map((r) => r.primary));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm text-ink-2">{r.label}</span>
            <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-ink">
              {r.primaryText}
              {r.secondaryText && <span className="font-normal text-ink-3"> · {r.secondaryText}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max((r.primary / max) * 100, 3)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
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
const METRICS: { key: MetricKey; label: string; format: (n: number) => string }[] = [
  { key: 'revenue', label: 'Выручка', format: formatMoneyShort },
  { key: 'newClients', label: 'Новые', format: (n) => `${formatInt(n)} нов.` },
  { key: 'returningRate', label: 'Возвращаемость', format: formatPct1 },
  { key: 'calls', label: 'Звонки', format: (n) => `${formatInt(n)} зв.` },
  { key: 'reviews', label: 'Отзывы', format: (n) => `${formatInt(n)} отз.` },
];
const ACCENT = 'rgb(37 99 235)';

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

  const denom = Math.max(points.length - 1, 1);
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverLeftPct = hoverIdx !== null ? (PAD_RATIO + (hoverIdx / denom) * (1 - 2 * PAD_RATIO)) * 100 : 50;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const padPx = rect.width * PAD_RATIO;
    const innerW = Math.max(rect.width - padPx * 2, 1);
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - padPx) / innerW));
    setHoverIdx(Math.round(ratio * denom));
  };

  const areaD = pts.length > 0 ? `${wavePath(pts)} L ${pts[pts.length - 1].x} ${C_H} L ${pts[0].x} ${C_H} Z` : '';

  return (
    <div>
      {/* Metric selector — одна серия за раз, поэтому и цвет один (акцент) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Метрика графика"
          size="sm"
          value={metricKey}
          onChange={setMetricKey}
          options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
        />
        {metric.key !== 'returningRate' && points.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-ink-3">
            Итого: <span className="font-semibold text-ink">{metric.format(total)}</span>
          </span>
        )}
      </div>

      {points.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-3">Недостаточно данных для графика за период.</p>
      ) : (
        <div
          className="relative"
          style={{ height: `${C_H + 22}px` }}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <svg
            viewBox={`0 0 ${C_W} ${C_H}`}
            className="w-full"
            style={{ height: `${C_H}px` }}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Динамика: ${metric.label}`}
          >
            <defs>
              <linearGradient id="marketingTrendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(37 99 235 / 0.22)" />
                <stop offset="100%" stopColor="rgb(37 99 235 / 0)" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75].map((p) => (
              <line
                key={p}
                x1={C_PAD}
                y1={C_H * (1 - p)}
                x2={C_W - C_PAD}
                y2={C_H * (1 - p)}
                stroke="rgb(15 23 42 / 0.06)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            <path d={areaD} fill="url(#marketingTrendGrad)" />
            <path
              d={wavePath(pts)}
              fill="none"
              stroke={ACCENT}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {hoverIdx !== null && pts[hoverIdx] && (
              <>
                <line
                  x1={pts[hoverIdx].x}
                  y1={0}
                  x2={pts[hoverIdx].x}
                  y2={C_H}
                  stroke={ACCENT}
                  strokeOpacity="0.3"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={pts[hoverIdx].x} cy={pts[hoverIdx].y} r="4" fill={ACCENT} />
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
                  className="absolute -translate-x-1/2 whitespace-nowrap text-2xs capitalize text-ink-3"
                  style={{ left: `${xPct}%` }}
                >
                  {bucketLabel(p.periodStart, grain)}
                </span>
              );
            })}
          </div>

          {hovered && (
            <div
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-left shadow-pop"
              style={{ left: `${Math.min(Math.max(hoverLeftPct, 12), 88)}%` }}
              role="status"
            >
              <p className="text-2xs font-medium capitalize text-white/70">
                {bucketLabelLong(hovered.periodStart, grain)}
              </p>
              <p className="text-sm font-semibold tabular-nums text-white">{metric.format(hovered[metric.key])}</p>
              <p className="mt-0.5 text-2xs tabular-nums text-white/80">
                {formatMoneyShort(hovered.revenue)} · {hovered.newClients} нов. · {hovered.calls} зв.
              </p>
            </div>
          )}
        </div>
      )}
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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
      {/* ── Тренды (hero, на всю ширину) ── */}
      <SectionCard
        icon={TrendingUp}
        iconTone="accent"
        title="Тренды"
        subtitle="Динамика ключевых метрик за период"
        className="xl:col-span-2"
        right={
          <SegmentedControl
            aria-label="Шаг графика"
            size="sm"
            value={grain}
            onChange={setGrain}
            options={[
              { value: 'weekly', label: 'Недели' },
              { value: 'monthly', label: 'Месяцы' },
            ]}
          />
        }
      >
        <TrendChart points={trendPoints} grain={grain} />
      </SectionCard>

      {/* ── Привлечение ── */}
      <SectionCard icon={UserPlus} title="Привлечение" subtitle="Считаем по дате заведения клиента в базу">
        <div className="grid grid-cols-2 gap-3">
          <StatBox
            label="Новые (добавлены за период)"
            value={formatInt(acq.newClients)}
            sub={formatMoney(acq.newRevenue)}
            tone="accent"
          />
          <StatBox
            label="Существующие (уже были в базе)"
            value={formatInt(acq.returningClients)}
            sub={formatMoney(acq.returningRevenue)}
          />
        </div>

        {totalRev > 0 && (
          <div className="mt-3">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div className="bg-accent" style={{ width: `${newRevPct}%` }} />
              <div className="bg-ink-4" style={{ width: `${100 - newRevPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-2xs tabular-nums text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                Новые {formatMoney(acq.newRevenue)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-ink-4" aria-hidden="true" />
                Существующие {formatMoney(acq.returningRevenue)}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <SubTitle>Новые по источникам</SubTitle>
            <BarList
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
            <SubTitle>Когорты первого визита</SubTitle>
            <BarList
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
      </SectionCard>

      {/* ── Удержание ── */}
      <SectionCard icon={Repeat} title="Удержание" subtitle="За всё время по клиентам периода">
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="Возвращаемость" value={formatPct(ret.returningRate)} tone="accent" />
          <StatBox label="Средний LTV" value={formatMoney(ret.avgLtv)} />
          <StatBox
            label="Между визитами"
            value={
              <>
                {formatInt(ret.avgDaysBetweenVisits)}
                <span className="ml-1 text-sm font-medium text-ink-3">
                  {plural(Math.round(ret.avgDaysBetweenVisits), ['день', 'дня', 'дней'])}
                </span>
              </>
            }
          />
        </div>

        {repeatTotal > 0 && (
          <div className="mt-4">
            <SubTitle>Частота визитов (за всё время)</SubTitle>
            <div className="flex items-end justify-between gap-2 sm:gap-3">
              {repeatDist.map((b) => {
                const h = (b.clients / repeatMax) * 100;
                const share = repeatTotal > 0 ? (b.clients / repeatTotal) * 100 : 0;
                return (
                  <div key={b.visits} className="flex flex-1 flex-col items-center">
                    <span className="mb-1 text-2xs font-semibold tabular-nums text-ink-2">{formatInt(b.clients)}</span>
                    <div className="flex h-24 w-full items-end justify-center">
                      <div
                        className="w-full max-w-[44px] rounded-t-md bg-accent/80"
                        style={{ height: `${Math.max(h, 3)}%` }}
                        title={`${formatPct(share)} клиентов`}
                      />
                    </div>
                    <span className="mt-1.5 text-2xs text-ink-3">
                      {b.visits === '1' ? '1 визит' : b.visits === '5+' ? '5+ визитов' : `${b.visits} виз.`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Звонки — воронка ── */}
      <SectionCard
        icon={PhoneCall}
        title="Звонки — воронка"
        subtitle="Телефония и путь обращения в заказ-наряд"
        right={
          c.total > 0 ? (
            <Badge tone="accent" className="tabular-nums">
              {formatPct(c.answerRate)} ответов
            </Badge>
          ) : undefined
        }
      >
        {c.total === 0 ? (
          <p className="text-sm text-ink-3">
            Нет данных о звонках за период. Подключите телефонию «Мои Звонки» в разделе «Интеграции».
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              <StatBox label="Всего" value={formatInt(c.total)} />
              <StatBox label="Входящие" value={formatInt(c.incoming)} />
              <StatBox label="Исходящие" value={formatInt(c.outgoing)} />
              <StatBox label="Пропущено" value={formatInt(c.missed)} tone={c.missed > 0 ? 'warn' : 'neutral'} />
              <StatBox
                label="Не перезвонили"
                value={formatInt(c.notCalledBack)}
                tone={c.notCalledBack > 0 ? 'bad' : 'neutral'}
              />
            </div>

            <div className="mt-4">
              <SubTitle>Воронка обращений</SubTitle>
              <FunnelBars
                stages={[
                  { label: 'Уникальные звонившие', value: c.funnel.uniqueCallers },
                  { label: 'Доехали до сервиса', value: c.funnel.arrivedClients },
                  { label: 'Оформлено заказ-нарядов', value: c.funnel.createdChecks },
                ]}
              />
              <div className="mt-3 grid grid-cols-3 gap-3">
                <StatBox label="Конверсия" value={formatPct(c.funnel.conversionRate)} tone="accent" />
                <StatBox label="Повторные" value={formatInt(c.funnel.repeatClients)} />
                <StatBox label="Выручка" value={formatMoney(c.funnel.revenue)} />
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* ── Отзывы ── */}
      <SectionCard icon={Star} title="Отзывы" subtitle="Оценки и запросы за период">
        {rv.total === 0 && rv.tokensSent === 0 ? (
          <p className="text-sm text-ink-3">Отзывов и запросов за период нет.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatBox
                label="Средняя оценка"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {pct1Fmt.format(rv.avgRating)}
                    <Star className="h-4 w-4 fill-warn text-warn" aria-hidden="true" />
                  </span>
                }
                sub={`${formatInt(rv.total)} ${plural(rv.total, ['отзыв', 'отзыва', 'отзывов'])}`}
              />

              <div className="min-w-0 rounded-lg bg-surface-2 px-3.5 py-3">
                <p className="text-xs leading-tight text-ink-3">Тональность</p>
                {sentiment > 0 ? (
                  <>
                    <div
                      className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-surface-3"
                      aria-hidden="true"
                    >
                      <div className="bg-ok" style={{ width: `${posShare}%` }} />
                      <div className="bg-bad" style={{ width: `${100 - posShare}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-2xs tabular-nums">
                      <span className="flex items-center gap-1 text-ok-text">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
                        {formatInt(rv.positive)} положит.
                      </span>
                      <span className="flex items-center gap-1 text-bad-text">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-bad" aria-hidden="true" />
                        {formatInt(rv.negative)} негатив.
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-1.5 text-2xs text-ink-3">Пока без оценок</p>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="Отвечаемость" value={formatPct(rv.responseRate)} tone="accent" />
              <StatBox label="Конверсия" value={formatPct(rv.conversionRate)} />
              <StatBox label="Отправлено" value={formatInt(rv.tokensSent)} />
              <StatBox label="Ответили" value={formatInt(rv.tokensResponded)} />
            </div>
          </>
        )}
      </SectionCard>

      {/* ── Лояльность ── */}
      <SectionCard
        icon={Gift}
        title="Лояльность"
        subtitle="Бонусная программа за период"
        right={
          loy.enabled ? (
            <Badge tone="accent" className="tabular-nums">
              {formatPct1(loy.accrualPercent)} кешбэк
            </Badge>
          ) : (
            <Badge outline>выключена</Badge>
          )
        }
      >
        {!loy.enabled && loy.accrualCount === 0 && loy.redemptionCount === 0 && loy.outstandingBalance === 0 ? (
          <p className="text-sm text-ink-3">
            Бонусная программа не используется. Включите её в разделе «Лояльность», чтобы начислять клиентам кешбэк.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="Участники" value={formatInt(loy.participants)} tone="accent" />
              <StatBox
                label="Начислено"
                value={formatMoney(loy.pointsAccrued)}
                sub={`${formatInt(loy.accrualCount)} ${plural(loy.accrualCount, ['операция', 'операции', 'операций'])}`}
              />
              <StatBox
                label="Списано"
                value={formatMoney(loy.pointsRedeemed)}
                sub={`${formatInt(loy.redemptionCount)} ${plural(loy.redemptionCount, ['операция', 'операции', 'операций'])}`}
              />
              <StatBox label="Остаток бонусов" value={formatMoney(loy.outstandingBalance)} />
            </div>
            <p className="mt-2.5 text-2xs leading-snug text-ink-3">
              «Остаток бонусов» — текущая суммарная задолженность программы перед клиентами за всё время, а не только за
              период.
            </p>
          </>
        )}
      </SectionCard>

      {/* ── Выручка ── */}
      <SectionCard
        icon={Wallet}
        title="Выручка"
        subtitle="По источникам клиентов и мастерам (без гарантийных)"
        className="xl:col-span-2"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <SubTitle icon={BarChart3}>По источникам</SubTitle>
            <BarList
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
              <p className="mt-2 text-2xs tabular-nums text-ink-3">Всего: {formatMoney(revTotalSource)}</p>
            )}
          </div>
          <div>
            <SubTitle icon={Users}>По мастерам</SubTitle>
            <BarList
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
      </SectionCard>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" role="status" aria-label="Загрузка отчёта">
      <Card padding="md" className="xl:col-span-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-44" />
      </Card>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} padding="md">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────
export default function MarketingReportsView() {
  // «Сегодня / неделя / месяц» — по календарю АВТОСЕРВИСА (157), как везде.
  const { today, weekStart, monthStart } = useTenantCalendar();
  const rangeFor = (preset: PresetKey): Range => {
    switch (preset) {
      case 'today':
        return { from: today, to: today };
      case 'week':
        return { from: weekStart, to: today };
      case 'month':
        return { from: monthStart, to: today };
      case 'quarter':
        return { from: format(startOfQuarter(parseDayKey(today)), 'yyyy-MM-dd'), to: today };
      case 'year':
        return { from: format(startOfYear(parseDayKey(today)), 'yyyy-MM-dd'), to: today };
    }
  };

  // Период — в URL (?from=&to=): «отчёт за июль» можно переслать.
  const [params, setParams] = useSearchParams();
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const range: Range =
    rawFrom && rawTo && DAY_KEY_RE.test(rawFrom) && DAY_KEY_RE.test(rawTo) && rawFrom <= rawTo
      ? { from: rawFrom, to: rawTo }
      : rangeFor('month');
  const preset: PresetKey | 'custom' =
    PRESETS.find((p) => {
      const r = rangeFor(p.value);
      return r.from === range.from && r.to === range.to;
    })?.value ?? 'custom';

  const setRange = (next: Range) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const def = rangeFor('month');
        if (next.from === def.from && next.to === def.to) {
          p.delete('from');
          p.delete('to');
        } else {
          p.set('from', next.from);
          p.set('to', next.to);
        }
        return p;
      },
      { replace: true },
    );

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
    <div className="space-y-5">
      <Toolbar>
        <SegmentedControl
          aria-label="Период отчёта"
          value={preset === 'custom' ? '' : preset}
          onChange={(p) => setRange(rangeFor(p as PresetKey))}
          options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        />
        <ToolbarSeparator />
        <ToolbarGroup>
          <label htmlFor="mreport-from" className="text-xs font-medium text-ink-3">
            с
          </label>
          <Input
            id="mreport-from"
            type="date"
            size="sm"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
            className="!w-[8.75rem]"
          />
          <label htmlFor="mreport-to" className="text-xs font-medium text-ink-3">
            по
          </label>
          <Input
            id="mreport-to"
            type="date"
            size="sm"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
            className="!w-[8.75rem]"
          />
        </ToolbarGroup>
      </Toolbar>

      {isLoading ? (
        <ReportSkeleton />
      ) : isError ? (
        <SectionError message="Не удалось загрузить отчёт" onRetry={() => refetch()} loading={isFetching} />
      ) : !data || isEmpty ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="За период данных нет"
            hint="Выберите другой период или дождитесь активности клиентов"
          />
        </Card>
      ) : (
        <div
          className={cn('transition-opacity duration-150', isFetching ? 'opacity-60' : 'opacity-100')}
          aria-busy={isFetching}
        >
          <ReportBody data={data} />
        </div>
      )}
    </div>
  );
}
