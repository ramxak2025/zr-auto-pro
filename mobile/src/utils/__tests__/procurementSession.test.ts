import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { ownsProcurementOutcome, runOwnedProcurement } from '../../../../shared/utils/procurementSession';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const result = { status: 200, data: { id: 'order-A' } };

describe('procurement hook completion ownership across installed MutationObserver callbacks', () => {
  it('reproduces the old post-refresh gap: latest B callbacks see a successful A response', async () => {
    const entered = deferred<void>(),
      storageKeys = deferred<void>(),
      qc = new QueryClient();
    let current = 'A';
    const effects: string[] = [];
    const oldHookExecute = async () => {
      try {
        return await Promise.resolve(result);
      } finally {
        entered.resolve();
        await storageKeys.promise;
      }
    };
    const options = (account: string) => ({
      mutationFn: oldHookExecute,
      onSuccess: () => {
        if (current === account) effects.push(account);
      },
    });
    const observer = new MutationObserver(qc, options('A'));
    const unsubscribe = observer.subscribe(() => {});
    const running = observer.mutate();
    await entered.promise;
    current = 'B';
    observer.setOptions(options('B'));
    storageKeys.resolve();
    await running;
    expect(effects).toEqual(['B']);
    unsubscribe();
    qc.clear();
  });
  for (const fail of [false, true])
    it(`late ${fail ? 'error' : 'success'} after gated storage refresh cannot update B cache, navigation, form or notifications`, async () => {
      const entered = deferred<void>(),
        storageKeys = deferred<void>(),
        qc = new QueryClient();
      let current = 'A';
      const leaseA = {},
        leaseB = {};
      const effects: string[] = [],
        visits: string[] = [];
      const execute = () =>
        runOwnedProcurement({
          lease: leaseA,
          isCurrent: () => current === 'A',
          dispatch: async () => {
            if (fail) throw Object.assign(new Error('A business error'), { response: { status: 400 } });
            return result;
          },
          refresh: async () => {
            entered.resolve();
            await storageKeys.promise;
          },
        });
      const options = (account: string, lease: object) => ({
        mutationFn: execute,
        onSuccess: (response: typeof result) => {
          visits.push(account + ':success');
          if (ownsProcurementOutcome(response, lease, () => current === account)) {
            effects.push('cache/navigation/form/success');
            qc.setQueryData(['purchase-order'], response.data);
          }
        },
        onError: (error: Error) => {
          visits.push(account + ':error');
          if (ownsProcurementOutcome(error, lease, () => current === account)) effects.push('error');
        },
        onSettled: (response: typeof result | undefined, error: Error | null) => {
          visits.push(account + ':settled');
          if (ownsProcurementOutcome(response ?? error, lease, () => current === account)) effects.push('settled');
        },
      });
      const observer = new MutationObserver(qc, options('A', leaseA));
      const unsubscribe = observer.subscribe(() => {});
      const running = observer.mutate();
      const rejected = expect(running).rejects.toBeInstanceOf(Error);
      await entered.promise;
      current = 'B';
      observer.setOptions(options('B', leaseB));
      storageKeys.resolve();
      await rejected;
      expect(visits).toEqual(['B:error', 'B:settled']);
      expect(effects).toEqual([]);
      expect(qc.getQueryData(['purchase-order'])).toBeUndefined();
      unsubscribe();
      qc.clear();
    });
  it('same live lease receives its own success and useful error', async () => {
    const lease = {};
    const value = await runOwnedProcurement({
      lease,
      isCurrent: () => true,
      dispatch: async () => result,
      refresh: async () => {},
    });
    expect(ownsProcurementOutcome(value, lease, () => true)).toBe(true);
    try {
      await runOwnedProcurement({
        lease,
        isCurrent: () => true,
        dispatch: async () => {
          throw Object.assign(new Error('Bad quantity'), { response: { status: 400 } });
        },
        refresh: async () => {},
      });
    } catch (error) {
      expect(ownsProcurementOutcome(error, lease, () => true)).toBe(true);
      expect(error).toMatchObject({ response: { status: 400 } });
    }
  });
});
