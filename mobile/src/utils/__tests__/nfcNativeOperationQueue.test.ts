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

it('does not end a cancelled operation a second time when cancellation settled before the task', async () => {
  const started = deferred();
  const gate = deferred();
  const finish = jest.fn(async () => undefined);
  const queue = createNfcNativeOperationQueue(finish);
  const work = queue.run(
    1,
    () => true,
    async () => {
      started.resolve();
      await gate.promise;
    },
  );
  await started.promise;
  await queue.cancel(1);
  gate.resolve();
  await work;
  expect(finish).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledWith({ status: 'cancelled' });
});

it('waits for failed-session teardown before starting the next operation', async () => {
  const teardown = deferred();
  const started = deferred();
  const error = new Error('read failed');
  const finish = jest.fn(async (outcome) => {
    if (outcome.status === 'error') {
      started.resolve();
      await teardown.promise;
    }
  });
  const queue = createNfcNativeOperationQueue(finish);
  const first = queue.run(
    1,
    () => true,
    async () => {
      throw error;
    },
  );
  const rejected = expect(first).rejects.toBe(error);
  await started.promise;
  const next = jest.fn(async () => undefined);
  const second = queue.run(2, () => true, next);
  const cancelled = queue.cancel(1);
  expect(next).not.toHaveBeenCalled();
  teardown.resolve();
  await Promise.all([cancelled, rejected, second]);
  expect(finish.mock.calls.map(([outcome]) => outcome.status)).toEqual(['error', 'success']);
});
