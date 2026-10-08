export function createNfcNativeOperationQueue(cancelNative: () => Promise<unknown>) {
  let queue: Promise<void> = Promise.resolve();
  let activeOperationId: number | null = null;
  let activeCancellation: { operationId: number; promise: Promise<void> } | null = null;

  const cancel = async (operationId: number): Promise<void> => {
    if (activeOperationId !== operationId) return;
    if (activeCancellation?.operationId === operationId) return activeCancellation.promise;
    const promise = cancelNative()
      .catch(() => undefined)
      .then(() => {
        if (activeCancellation?.operationId === operationId) activeCancellation = null;
      });
    activeCancellation = { operationId, promise };
    await promise;
  };

  const run = async <T>(operationId: number, isCurrent: () => boolean, task: () => Promise<T>): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (!isCurrent()) throw new Error('NFC operation is no longer current');
      activeOperationId = operationId;
      return await task();
    } finally {
      if (activeOperationId === operationId) {
        await cancel(operationId);
        activeOperationId = null;
      }
      release();
    }
  };

  return { run, cancel };
}
