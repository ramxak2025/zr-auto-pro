import { dataOwnerKey, type DataOwner } from './dataSession';

const frozen = new Set<string>();
const writes = new Map<string, Set<Promise<void>>>();
const blocked = () =>
  Object.assign(new Error('Сохранение операций аккаунта ещё не завершено. Повторите действие.'), {
    code: 'UNRESOLVED_INTENTS',
  });

/** Only these persisted intent families have proved account/point ownership.
 * Unknown legacy storage is neither adopted nor cleared by this barrier. */
export function intentOwnerForKey(key: string): DataOwner | null {
  for (const prefix of ['offline_check_queue_v2:', 'autexa:pending-check-photos:v1:']) {
    if (!key.startsWith(prefix)) continue;
    try {
      const encoded = key.slice(prefix.length).split(':')[0];
      const tuple: unknown = JSON.parse(decodeURIComponent(encoded));
      if (!Array.isArray(tuple) || tuple.length !== 3) return null;
      const [tenantId, userId, pointId] = tuple;
      if (
        (tenantId !== null && typeof tenantId !== 'string') ||
        typeof userId !== 'string' ||
        !userId ||
        (pointId !== null && typeof pointId !== 'string')
      )
        return null;
      return { tenantId, userId, pointId };
    } catch {
      return null;
    }
  }
  for (const prefix of ['autexa:procurement:v1:', 'autexa:nfc:v1:']) {
    if (!key.startsWith(prefix)) continue;
    const [tenantId, userId, pointId] = key.slice(prefix.length).split('/');
    if (tenantId && userId && pointId) return { tenantId, userId, pointId: pointId === 'none' ? null : pointId };
  }
  return null;
}

/** Reserve synchronously, including a native write queued behind other writes.
 * A removal freezes before its first await, drains reservations, then inventories
 * disk and commits registry removal without allowing a new intent in between. */
export function withIntentWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const owner = intentOwnerForKey(key);
  if (!owner) return work();
  const id = dataOwnerKey(owner);
  if (frozen.has(id)) return Promise.reject(blocked());
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = writes.get(id) ?? new Set<Promise<void>>();
  writes.set(id, pending);
  pending.add(done);
  return Promise.resolve()
    .then(work)
    .finally(() => {
      pending.delete(done);
      if (pending.size === 0) writes.delete(id);
      release();
    });
}

export async function withFrozenIntentOwners<T>(owners: readonly DataOwner[], work: () => Promise<T>): Promise<T> {
  const ids = [...new Set(owners.map(dataOwnerKey))];
  if (ids.some((id) => frozen.has(id))) throw blocked();
  ids.forEach((id) => frozen.add(id));
  try {
    await Promise.all(ids.flatMap((id) => [...(writes.get(id) ?? [])]));
    return await work();
  } finally {
    ids.forEach((id) => frozen.delete(id));
  }
}
