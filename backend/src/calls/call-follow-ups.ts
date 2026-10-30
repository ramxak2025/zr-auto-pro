interface FollowUpCall {
  date: string | Date;
  direction: string;
  status: string;
  duration: number;
  from?: string | null;
  to?: string | null;
  calledBack?: boolean;
}

const phoneKey = (phone?: string | null) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};
const timestamp = (call: FollowUpCall) => (call.date instanceof Date ? call.date.getTime() : Date.parse(call.date));

/** A successful contact resolves only earlier missed calls, never later ones. */
export function markCallFollowUps<T extends FollowUpCall>(calls: T[]): T[] {
  const latestContact = new Map<string, number>();
  for (const call of calls) {
    const answered =
      (call.direction === 'outgoing' && Number.isFinite(call.duration) && call.duration > 0) ||
      (call.direction === 'incoming' && call.status === 'answered');
    if (!answered) continue;
    const phone = phoneKey(call.direction === 'outgoing' ? call.to : call.from);
    const at = timestamp(call);
    if (phone && Number.isFinite(at)) latestContact.set(phone, Math.max(latestContact.get(phone) ?? -Infinity, at));
  }
  const unresolved: T[] = [];
  for (const call of calls) {
    if (call.direction !== 'incoming' || call.status !== 'missed') continue;
    const phone = phoneKey(call.from);
    const at = timestamp(call);
    call.calledBack = !!phone && Number.isFinite(at) && (latestContact.get(phone) ?? -Infinity) > at;
    if (!call.calledBack) unresolved.push(call);
  }
  return unresolved;
}
