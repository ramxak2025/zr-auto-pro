import { ProcurementRecoveryError } from './durableProcurement';

/** Opaque in-memory ownership, never a bearer or persisted account credential.
 * MutationObserver can replace callbacks while a request is pending, so every
 * result AND error must carry its original lease, not rely on callback closure. */
const owners = new WeakMap<object, object>();
export function ownsProcurementOutcome(value: unknown, lease: object, isCurrent: () => boolean): boolean {
  return isCurrent() && value !== null && typeof value === 'object' && owners.get(value) === lease;
}
function ownedError(error: unknown, lease: object): Error {
  const source = error as { message?: string; code?: unknown; response?: unknown } | null;
  const wrapped = Object.assign(new Error(source?.message || 'Операция не подтверждена'), {
    code: source?.code,
    response: source?.response,
  });
  owners.set(wrapped, lease);
  return wrapped;
}
export async function runOwnedProcurement<T extends object>(options: {
  lease: object;
  isCurrent: () => boolean;
  dispatch: () => Promise<T>;
  refresh: () => Promise<void>;
}): Promise<T> {
  try {
    let result: T;
    try {
      result = await options.dispatch();
    } finally {
      await options.refresh();
    }
    if (!options.isCurrent())
      throw new ProcurementRecoveryError(
        'SESSION_CHANGED',
        'Сессия изменилась. Результат относится к прежнему аккаунту.',
      );
    const owned = { ...result };
    owners.set(owned, options.lease);
    return owned;
  } catch (error) {
    throw ownedError(error, options.lease);
  }
}
