/**
 * CallsWidget — premium KPI-only preview of today's calls.
 *
 * Owner asked: numbers from /calls, no individual call list, modern look.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ● Звонки сегодня                  10 мая →   │
 *   │                                              │
 *   │  Всего · Входящие · Исходящие · Пропущено    │
 *   │   24       12          8          4 (-1)     │
 *   │                                              │
 *   │  ⚠ Не перезвонили: 2                         │
 *   └──────────────────────────────────────────────┘
 *
 * Whole card is a clickable surface that takes the user to /calls.
 * Hidden when the tenant has no calls today (zero-state for non-telephony
 * tenants — clean dashboard, no empty box).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Phone,
  PhoneMissed,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { callsApi } from '../api/services';
import { useTenantCalendar } from '../hooks/useTenantTimezone';

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
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(
    shifted.getDate(),
  ).padStart(2, '0')}`;
}

function dayLabel(dayKey: string): string {
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [, m, d] = dayKey.split('-').map(Number);
  return `${d} ${months[(m || 1) - 1]}`;
}

export default function CallsWidget() {
  /**
   * «Сегодня» и «вчера» — по календарю АВТОСЕРВИСА (157), как на странице
   * звонков (pages/CallsPage) и как сервер отбирает звонки за дату. По часам
   * браузера виджет на главной и сама страница звонков показывали РАЗНЫЕ сутки
   * у любого, кто открыл админку из другого региона.
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

  // Yesterday — used to show day-over-day delta on the "total" tile so the
  // owner sees the trend at a glance (the actual heroic stat). Not blocking
  // — if it fails or empty we just hide the delta chip.
  const { data: yesterday } = useQuery<{ summary: CallsSummary }>({
    queryKey: ['calls-yesterday', yesterdayKey],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: yesterdayKey });
      return res.data as unknown as { summary: CallsSummary };
    },
    staleTime: 5 * 60_000,
  });

  // Hide entirely on tenants without telephony / nothing today + nothing yesterday.
  if (!isLoading && (!data || data.summary.total === 0) && (!yesterday || yesterday.summary.total === 0)) {
    return null;
  }

  const summary = data?.summary;
  const yesterTotal = yesterday?.summary.total ?? 0;
  const totalDelta = summary ? summary.total - yesterTotal : 0;
  const showDelta = !!summary && yesterTotal > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="rounded-3xl overflow-hidden bg-gradient-to-br from-blue-950 via-slate-900 to-blue-950 shadow-xl ring-1 ring-white/5 transition-shadow hover:shadow-2xl"
    >
      <Link to="/calls" className="block no-underline">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15">
              <Phone className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.18em]">Звонки</p>
              <p className="text-base font-bold text-white">{dayLabel(today)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white transition-colors">
            Открыть
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* Hero: total + delta */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-baseline gap-3">
            <p className="text-5xl font-bold text-white tabular-nums tracking-tight">
              {isLoading ? '—' : (summary?.total ?? 0)}
            </p>
            {showDelta && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  totalDelta > 0
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : totalDelta < 0
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-white/5 text-slate-400'
                }`}
              >
                {totalDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {totalDelta > 0 ? '+' : ''}
                {totalDelta} к вчера
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">всего звонков сегодня</p>
        </div>

        {/* KPI strip — frosted tiles, white-on-glass.
            3 tiles: incoming / outgoing / missed. notCalledBack lives in
            its own pinned banner below because it's the one number that
            actually demands action. */}
        <div className="px-3 pb-3">
          <div className="grid grid-cols-3 gap-2">
            <Tile
              icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
              label="Входящие"
              value={summary?.incoming ?? 0}
              tone="green"
            />
            <Tile
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              label="Исходящие"
              value={summary?.outgoing ?? 0}
              tone="blue"
            />
            <Tile
              icon={<PhoneMissed className="h-3.5 w-3.5" />}
              label="Пропущено"
              value={summary?.missed ?? 0}
              tone="red"
            />
          </div>
        </div>

        {/* Action banner — visible only when there are unreturned missed calls.
            Grabs attention without polluting the dashboard for tenants on
            top of their telephony. */}
        {summary && summary.notCalledBack > 0 && (
          <div className="mx-3 mb-3 px-4 py-3 rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-300 flex-shrink-0" />
            <p className="text-xs text-amber-100 flex-1">
              Не перезвонили: <span className="font-bold tabular-nums">{summary.notCalledBack}</span>
            </p>
            <span className="text-[11px] font-semibold text-amber-200">обработать →</span>
          </div>
        )}
      </Link>
    </motion.section>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'green' | 'blue' | 'red';
}) {
  const tones: Record<string, { iconBg: string; iconFg: string; valFg: string }> = {
    green: { iconBg: 'bg-emerald-500/15', iconFg: 'text-emerald-300', valFg: 'text-emerald-200' },
    blue: { iconBg: 'bg-sky-500/15', iconFg: 'text-sky-300', valFg: 'text-sky-200' },
    red: { iconBg: 'bg-rose-500/15', iconFg: 'text-rose-300', valFg: 'text-rose-200' },
  };
  const t = tones[tone];
  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 backdrop-blur px-3 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${t.iconBg} ${t.iconFg}`}>{icon}</span>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums mt-1.5 ${t.valFg}`}>{value}</p>
    </div>
  );
}
