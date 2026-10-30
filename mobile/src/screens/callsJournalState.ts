import type { Call } from '../components/calls/CallRow';

export type CallsFilter = 'all' | 'incoming' | 'outgoing' | 'missed' | 'pending';

export interface CallsEntryParams {
  focusToday: true;
  filter: CallsFilter;
  entryRequestId: string;
}

export interface CallsSummary {
  total: number;
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
}

interface FilterableCall {
  direction?: unknown;
  status?: unknown;
  duration?: unknown;
  calledBack?: unknown;
}

export const CALLS_TABS: ReadonlyArray<{ key: CallsFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'pending', label: 'Без перезвона' },
  { key: 'incoming', label: 'Принятые' },
  { key: 'missed', label: 'Пропущенные' },
  { key: 'outgoing', label: 'Исходящие' },
];

/** Canonical status wins over duration: a connected call can last zero seconds. */
export function isMissedCall(call: FilterableCall): boolean {
  return call.direction === 'incoming' && call.status === 'missed';
}

export function isPendingCall(call: FilterableCall): boolean {
  return isMissedCall(call) && call.calledBack !== true;
}

export function filterCalls<T extends FilterableCall>(calls: readonly T[], filter: CallsFilter): T[] {
  return calls.filter((call) => {
    if (filter === 'incoming') return call.direction === 'incoming' && call.status === 'answered';
    if (filter === 'outgoing') return call.direction === 'outgoing';
    if (filter === 'missed') return isMissedCall(call);
    if (filter === 'pending') return isPendingCall(call);
    return true;
  });
}

export function callsFilterCount(summary: CallsSummary, filter: CallsFilter): number {
  if (filter === 'incoming') return summary.incoming - summary.missed;
  if (filter === 'outgoing') return summary.outgoing;
  if (filter === 'missed') return summary.missed;
  if (filter === 'pending') return summary.notCalledBack;
  return summary.total;
}

/** Reject missing or inconsistent totals rather than turning them into reassuring zeros. */
export function callsSummary(value: unknown): CallsSummary | null {
  if (!value || typeof value !== 'object') return null;
  const summary = value as CallsSummary;
  const fields = [summary.total, summary.incoming, summary.outgoing, summary.missed, summary.notCalledBack];
  if (fields.some((count) => !Number.isSafeInteger(count) || count < 0)) return null;
  if (
    summary.total !== summary.incoming + summary.outgoing ||
    summary.missed > summary.incoming ||
    summary.notCalledBack > summary.missed
  )
    return null;
  return {
    total: summary.total,
    incoming: summary.incoming,
    outgoing: summary.outgoing,
    missed: summary.missed,
    notCalledBack: summary.notCalledBack,
  };
}

/** Only the server's exact no-provider response means the integration is absent. */
export function telephonyDisconnected(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  return (
    response?.status === 400 &&
    response.data?.message === 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.'
  );
}

export function callsEntry(params: unknown): CallsEntryParams | null {
  if (!params || typeof params !== 'object') return null;
  const value = params as Partial<CallsEntryParams>;
  if (
    value.focusToday !== true ||
    typeof value.entryRequestId !== 'string' ||
    !value.entryRequestId.trim() ||
    !CALLS_TABS.some((tab) => tab.key === value.filter)
  )
    return null;
  return value as CallsEntryParams;
}

let entrySequence = 0;
export function newCallsEntry(filter: CallsFilter): CallsEntryParams {
  return { focusToday: true, filter, entryRequestId: `calls-${Date.now()}-${++entrySequence}` };
}
export type CallsJournalSnapshot =
  | { kind: 'connected'; calls: Call[]; summary: CallsSummary }
  | { kind: 'disconnected' };

/** Malformed responses are unavailable; an omitted list is never an empty day. */
export function callsJournalSnapshot(value: unknown): CallsJournalSnapshot {
  const data = value as { calls?: unknown; summary?: unknown } | null;
  const summary = callsSummary(data?.summary);
  const rows = data?.calls;
  if (
    !summary ||
    !Array.isArray(rows) ||
    rows.some(
      (call) =>
        !call ||
        (typeof call.id !== 'string' && typeof call.id !== 'number') ||
        !Number.isFinite(Date.parse(call.date)) ||
        !['incoming', 'outgoing'].includes(call.direction) ||
        !['answered', 'missed'].includes(call.status) ||
        typeof call.from !== 'string' ||
        typeof call.to !== 'string' ||
        !Number.isFinite(call.duration) ||
        call.duration < 0,
    ) ||
    CALLS_TABS.some((tab) => filterCalls(rows, tab.key).length !== callsFilterCount(summary, tab.key))
  )
    throw new Error('Не удалось прочитать журнал звонков');
  return { kind: 'connected', calls: rows, summary };
}
