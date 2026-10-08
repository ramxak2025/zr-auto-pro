import type { QueryClient } from '@tanstack/react-query';
import { captureDataSession } from './dataSession';

/** React Query mutations keep their options after their observer unmounts.
 * Clearing the cache alone therefore cannot suppress an old onError/onSuccess.
 * Capture ownership at creation, preserve it across observer option changes,
 * and reject a paused mutation before it can dispatch under a new bearer. */
export function attachSessionMutationBoundary(client: QueryClient): () => void {
  const leases = new WeakMap<object, ReturnType<typeof captureDataSession>>();
  const wrapped = new WeakSet<object>();
  const cache = client.getMutationCache();
  const originalError = cache.config.onError;
  const guardedError: typeof originalError = (...args) => {
    if (leases.get(args[3])?.isCurrent() === false) return;
    return originalError?.(...args);
  };
  cache.config.onError = guardedError;
  const unsubscribe = cache.subscribe((event) => {
    const mutation = event.mutation;
    if (!mutation || (event.type !== 'added' && event.type !== 'observerOptionsUpdated')) return;
    let lease = leases.get(mutation);
    if (!lease) {
      lease = captureDataSession();
      leases.set(mutation, lease);
    }
    const owned = lease;
    const targets =
      event.type === 'observerOptionsUpdated' ? [mutation.options, event.observer.options] : [mutation.options];
    for (const options of targets)
      for (const key of ['mutationFn', 'onMutate', 'onSuccess', 'onError', 'onSettled'] as const) {
        const original = options[key];
        if (!original || wrapped.has(original)) continue;
        const guarded = (...args: unknown[]) => {
          if (!owned.isCurrent()) {
            if (key === 'mutationFn') throw Object.assign(new Error('Сессия изменилась.'), { code: 'ERR_CANCELED' });
            return undefined;
          }
          // Preserve TanStack's varied callback signatures without changing its
          // result or state machine. All callbacks are installed in one place.
          return Reflect.apply(original, undefined, args);
        };
        wrapped.add(guarded);
        Object.assign(options, { [key]: guarded });
      }
  });
  return () => {
    unsubscribe();
    if (cache.config.onError === guardedError) cache.config.onError = originalError;
  };
}
