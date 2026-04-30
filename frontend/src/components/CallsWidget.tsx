/**
 * CallsWidget — compact dashboard preview of today's calls.
 *
 * Reuses the same /calls?date=YYYY-MM-DD endpoint and field shapes as the
 * full /calls page (Call.from / to / direction / status / duration / client),
 * so what the owner sees here matches the full page exactly — no shape
 * drift, no missing names.
 *
 *   - 4 KPI tiles: Всего / Входящие / Исходящие / Пропущено (matches the
 *     summary returned by the API).
 *   - 5 most recent calls, formatted phone, client name (when matched),
 *     direction icon (incoming green / outgoing blue / missed red / missed
 *     answered-back green forwarded).
 *   - Whole widget click-targets /calls so the owner lands on the full
 *     page after a tap.
 *
 * Hidden when the tenant has zero calls today (clean state for tenants
 * without telephony integration).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft, ArrowUpRight, ChevronRight, Phone, PhoneForwarded, PhoneMissed,
} from 'lucide-react';
import { callsApi } from '../api/services';

// Mirror of the Call shape used on /calls — kept here so the widget compiles
// independently. If the page contract changes, these two should be updated
// together.
interface Call {
  id: string;
  date: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string;
  duration: number;
  status: 'answered' | 'missed';
  recordingUrl: string | null;
  clientPhone: string;
  calledBack?: boolean;
  client: {
    id: string;
    fullName: string;
    cars: { plateNumber: string; makeModel: string }[];
  } | null;
}

interface CallsSummary {
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
  total: number;
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned[0] === '8') {
    cleaned = '7' + cleaned.slice(1);
  }
  if (cleaned.length === 11) {
    return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
  }
  return phone;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function CallsWidget() {
  const { data, isLoading } = useQuery<{ calls: Call[]; summary: CallsSummary }>({
    queryKey: ['calls-today'],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: todayISODate() });
      return res.data as unknown as { calls: Call[]; summary: CallsSummary };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Hide entirely on tenants without telephony / empty days.
  if (!isLoading && (!data || data.summary.total === 0)) {
    return null;
  }

  const summary = data?.summary;
  // /calls page sorts newest-first. The endpoint already returns sorted, but
  // be defensive in case the API order changes.
  const recent = (data?.calls ?? [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden"
    >
      {/* Header — whole header click-targets /calls. Matches the user's
          request: tap anywhere on the widget → full page. */}
      <Link
        to="/calls"
        className="flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50/60 transition-colors no-underline"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <Phone className="h-5 w-5 text-blue-600" />
          </div>
          <h3 className="text-base font-bold text-gray-900">Звонки сегодня</h3>
        </div>
        <span className="text-xs font-semibold text-blue-600 flex items-center gap-0.5">
          Все
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </Link>

      {/* KPI strip — same numbers /calls shows in its summary tiles. */}
      {summary && (
        <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
          <KpiTile label="Всего" value={summary.total} tone="default" />
          <KpiTile label="Вх." value={summary.incoming} tone="green" />
          <KpiTile label="Исх." value={summary.outgoing} tone="blue" />
          <KpiTile label="Пропущ." value={summary.missed} tone="red" />
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
            const isIncoming = c.direction === 'incoming';
            const isMissed = isIncoming && (c.status === 'missed' || c.duration === 0);
            const displayPhone = isIncoming ? c.from : c.to;

            // Pick icon + tone matching CallsPage's row exactly.
            const tone = isMissed && c.calledBack
              ? 'bg-green-50 text-green-600'
              : isMissed
                ? 'bg-red-50 text-red-500'
                : isIncoming
                  ? 'bg-green-50 text-green-600'
                  : 'bg-blue-50 text-blue-600';
            const Icon = isMissed && c.calledBack
              ? PhoneForwarded
              : isMissed
                ? PhoneMissed
                : isIncoming
                  ? ArrowDownLeft
                  : ArrowUpRight;

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
                    {c.client?.fullName ? (
                      <>
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.client.fullName}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {formatPhone(displayPhone)}
                          <span className="mx-1.5 text-gray-300">·</span>
                          {formatTime(c.date)}
                          {isMissed && !c.calledBack && (
                            <span className="text-red-500"> · пропущен</span>
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className={`text-sm font-semibold truncate ${isMissed && !c.calledBack ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatPhone(displayPhone) || '—'}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {formatTime(c.date)}
                          {isMissed && !c.calledBack && (
                            <span className="text-red-500"> · пропущен</span>
                          )}
                        </p>
                      </>
                    )}
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

function KpiTile({ label, value, tone }: { label: string; value: number; tone: 'default' | 'green' | 'blue' | 'red' }) {
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
