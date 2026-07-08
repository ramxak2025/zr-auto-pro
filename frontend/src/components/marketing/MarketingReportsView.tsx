import { useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { CalendarDays, UserPlus, Repeat, PhoneCall, Star, BarChart3, Loader2, type LucideIcon } from 'lucide-react';

import { reportsApi } from '../../api/services';
import { formatMoney } from '../../../../shared/utils/formatters';
import type { MarketingReport } from '../../types';

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

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
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
          {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
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
  const { acquisition: acq, retention: ret, calls: c, reviews: rv } = data;

  const totalRev = acq.newRevenue + acq.returningRevenue;
  const newRevPct = totalRev > 0 ? (acq.newRevenue / totalRev) * 100 : 0;
  const sources = [...acq.bySource].sort((a, b) => b.count - a.count);
  const maxSourceCount = Math.max(1, ...sources.map((s) => s.count));

  const sentiment = rv.positive + rv.negative;
  const posShare = sentiment > 0 ? (rv.positive / sentiment) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Привлечение ── */}
      <Section
        icon={UserPlus}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Привлечение"
        subtitle="Новые и вернувшиеся клиенты за период"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <StatBox
            label="Новые клиенты"
            value={formatInt(acq.newClients)}
            sub={formatMoney(acq.newRevenue)}
            valueClass="text-emerald-600"
          />
          <StatBox
            label="Вернувшиеся"
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
                Вернувшиеся {formatMoney(acq.returningRevenue)}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-gray-500">По источникам</p>
          {sources.length === 0 ? (
            <p className="text-xs text-gray-400">Источники не указаны</p>
          ) : (
            <div className="space-y-2.5">
              {sources.map((s) => (
                <div key={s.source || 'none'}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-gray-700">{s.source || 'Без источника'}</span>
                    <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                      {formatInt(s.count)} <span className="font-normal text-gray-400">· {formatMoney(s.revenue)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all duration-500"
                      style={{ width: `${Math.max((s.count / maxSourceCount) * 100, 4)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
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
      </Section>

      {/* ── Звонки ── */}
      <Section
        icon={PhoneCall}
        iconClass="bg-sky-50 text-sky-600"
        title="Звонки"
        subtitle="Телефония и воронка обращений"
        right={
          c.total > 0 ? <span className="badge-info tabular-nums">{formatPct(c.answerRate)} ответов</span> : undefined
        }
      >
        {c.total === 0 ? (
          <p className="text-sm text-gray-400">
            Нет данных о звонках за период. Подключите телефонию в разделе «Каналы».
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
    data.reviews.tokensSent === 0;

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
