export type NfcNativeCompletion = { status: 'success' | 'cancelled' } | { status: 'error'; error: unknown };

export function createNfcNativeOperationQueue(finishNative: (outcome: NfcNativeCompletion) => Promise<unknown>) {
  let queue: Promise<void> = Promise.resolve();
  let activeOperationId: number | null = null;
  let activeCancellation: Promise<void> | null = null;

  const finish = async (operationId: number, outcome: NfcNativeCompletion): Promise<void> => {
    if (activeOperationId !== operationId) return;
    // Retain even a settled cancellation until this operation leaves the queue:
    // its finally must not invalidate a session twice or overtake the next scan.
    activeCancellation ??= finishNative(outcome).then(
      () => undefined,
      () => undefined, // The OS may already have invalidated a cancelled/lost session.
    );
    await activeCancellation;
  };

  const cancel = (operationId: number) => finish(operationId, { status: 'cancelled' });

  const run = async <T>(operationId: number, isCurrent: () => boolean, task: () => Promise<T>): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    let outcome: NfcNativeCompletion = { status: 'cancelled' };
    try {
      await previous;
      if (!isCurrent()) throw new Error('NFC operation is no longer current');
      activeOperationId = operationId;
      activeCancellation = null;
      const result = await task();
      outcome = { status: isCurrent() ? 'success' : 'cancelled' };
      return result;
    } catch (error) {
      outcome = isCurrent() ? { status: 'error', error } : { status: 'cancelled' };
      throw error;
    } finally {
      if (activeOperationId === operationId) {
        await finish(operationId, outcome);
        activeOperationId = null;
        activeCancellation = null;
      }
      release();
    }
  };

  return { run, cancel };
}
