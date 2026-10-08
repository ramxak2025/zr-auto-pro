import { createNfcNativeOperationQueue } from '../nfcNativeOperationQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('serialized native NFC cancellation', () => {
  it('coalesces cleanup and finally cancellation and waits before starting the next scan', async () => {
    const nativeCancel = deferred();
    const taskGate = deferred();
    const entered = deferred();
    const cancelNative = jest.fn(() => nativeCancel.promise);
    const queue = createNfcNativeOperationQueue(cancelNative);
    let secondStarted = false;
    const first = queue.run(
      1,
      () => true,
      async () => {
        entered.resolve();
        await taskGate.promise;
      },
    );
    await entered.promise;

    const cleanupCancellation = queue.cancel(1);
    const second = queue.run(
      2,
      () => true,
      async () => {
        secondStarted = true;
      },
    );
    taskGate.resolve();
    await Promise.resolve();

    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(secondStarted).toBe(false);
    nativeCancel.resolve();
    await Promise.all([cleanupCancellation, first, second]);

    expect(cancelNative).toHaveBeenCalledTimes(2);
    expect(secondStarted).toBe(true);
  });
});
