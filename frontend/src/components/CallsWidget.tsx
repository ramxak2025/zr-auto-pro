import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, ChevronRight,
} from 'lucide-react';
import { callsApi } from '../api/services';

/**
 * CallsWidget — compact dashboard preview of today's calls.
 *
 * Hits /calls?date=today and renders:
 *  - 4 small KPI tiles (всего / входящие / исходящие / пропущено)
 *  - Up to 5 newest calls with direction icon, phone, contact name
 *  - "Все звонки" link to the full /calls page
 *
 * If telephony hasn't reported anything today, the widget is hidden so
 * non-telephony tenants don't see an empty box.
 */
interface CallRow {
  id: string;
  phone?: string;
  contactName?: string;
  contact_name?: string;
  direction?: 'incoming' | 'outgoing';
  status?: string;
  startTime?: string;
  start_time?: string;
  durationSec?: number;
  duration_sec?: number;
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function isMissed(c: CallRow): boolean {
  if (c.status === 'missed' || c.status === 'no_answer') return true;
  if ((c.direction || 'incoming') === 'incoming') {
    const dur = c.durationSec ?? c.duration_sec ?? 0;
    if (dur === 0) return true;
  }
  return false;
}

export default function CallsWidget() {
  const { data, isLoading } = useQuery<{ calls: CallRow[]; summary: { total: number; incoming: number; outgoing: number; missed: number; notCalledBack: number } }>({
    queryKey: ['calls-today'],
    queryFn: async () => { const res = await callsApi.getCalls({ date: todayISODate() }); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const recent = useMemo(() => {
    const all = data?.calls ?? [];
    return all.slice(0, 5);
  }, [data]);

  // Hide entirely on tenants that don't have telephony wired up — total === 0
  // is the marker we use across the app for "this module is dormant".
  if (!isLoading && (!data || data.summary.total === 0)) {
    return null;
  }

  const summary = data?.summary;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden"
    >
      <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <Phone className="h-5 w-5 text-blue-600" />
          </div>
          <h3 className="text-base font-bold text-gray-900">Звонки сегодня</h3>
        </div>
        <Link
          to="/calls"
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
        >
          Все
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
          <Tile label="Всего" value={summary.total} tone="default" />
          <Tile label="Входящих" value={summary.incoming} tone="green" />
          <Tile label="Исходящих" value={summary.outgoing} tone="blue" />
          <Tile label="Пропущено" value={summary.missed} tone="red" />
        </div>
      )}

      {/* Recent rows */}
      <ul className="divide-y divide-gray-50">
        {isLoading ? (
          <li className="px-5 py-6 text-center text-sm text-gray-400">Загрузка…</li>
        ) : recent.length === 0 ? (
          <li className="px-5 py-6 text-center text-sm text-gray-400">Звонков пока нет</li>
        ) : (
          recent.map((c) => {
            const dir = c.direction || 'incoming';
            const missed = isMissed(c);
            const Icon = missed ? PhoneMissed : dir === 'outgoing' ? PhoneOutgoing : PhoneIncoming;
            const tone = missed
              ? 'bg-red-50 text-red-500'
              : dir === 'outgoing'
                ? 'bg-blue-50 text-blue-600'
                : 'bg-green-50 text-green-600';
            const name = c.contactName ?? c.contact_name ?? '';
            const start = c.startTime ?? c.start_time;
            return (
              <li key={c.id}>
                <Link
                  to="/calls"
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors no-underline"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full ${tone} flex-shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {name || c.phone || '—'}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {c.phone && name ? `${c.phone}` : ''}
                      {c.phone && name && start ? ' · ' : ''}
                      {start ? formatTime(start) : ''}
                      {missed ? <span className="text-red-500"> · пропущен</span> : null}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </motion.section>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'default' | 'green' | 'blue' | 'red' }) {
  const color =
    tone === 'green' ? 'text-green-600'
      : tone === 'blue' ? 'text-blue-600'
        : tone === 'red' ? 'text-red-500'
          : 'text-gray-900';
  return (
    <div className="px-3 py-3 text-center">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color} mt-0.5`}>{value}</p>
    </div>
  );
}
