import { callsSummary, isMissedCall, type CallsSummary } from '../../callsJournalState';

export interface OwnerPendingCall {
  id: string;
  phone: string;
  name: string | null;
  date: string;
  attempts: number;
}

export type OwnerCallsSnapshot =
  | { kind: 'connected'; summary: CallsSummary; pending: OwnerPendingCall[] }
  | { kind: 'disconnected' };

/** Accept phone punctuation only; never retain arbitrary provider text or a tel URI. */
export function ownerCallPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10 && !value.trim().startsWith('+')) digits = `7${digits}`;
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

export function ownerCallPhoneLabel(phone: string): string {
  const digits = phone.slice(1);
  return digits.length === 11 && digits[0] === '7'
    ? `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    : phone;
}

/** Keep at most three caller summaries. Full rows, client objects and recordings never enter this cache. */
export function ownerPendingCalls(value: unknown): OwnerPendingCall[] {
  if (!Array.isArray(value)) return [];
  const callers = new Map<string, OwnerPendingCall>();
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !isMissedCall(item) || item.calledBack !== false) continue;
    const phone = ownerCallPhone(item.from);
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
    const timestamp = typeof item.date === 'string' ? Date.parse(item.date) : NaN;
    if (!phone || !id || id.length > 120 || !Number.isFinite(timestamp)) continue;
    const date = new Date(timestamp).toISOString();
    const eventKey = JSON.stringify([id, phone, date]);
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const name =
      typeof item.client?.fullName === 'string'
        ? item.client.fullName
            .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
            .trim()
            .slice(0, 80) || null
        : null;
    const previous = callers.get(phone);
    const latest = !previous || date > previous.date ? { id, phone, name, date } : previous;
    callers.set(phone, { ...latest, attempts: (previous?.attempts ?? 0) + 1 });
  }
  return [...callers.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
}

export function ownerCallsSnapshot(value: unknown): OwnerCallsSnapshot {
  const data = value as { summary?: unknown; calls?: unknown } | null;
  const summary = callsSummary(data?.summary);
  if (!summary) throw new Error('Не удалось прочитать сводку звонков');
  return {
    kind: 'connected',
    summary,
    pending: summary.notCalledBack > 0 ? ownerPendingCalls(data?.calls).slice(0, summary.notCalledBack) : [],
  };
}
