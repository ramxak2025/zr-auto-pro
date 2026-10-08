import { QueryClient, MutationObserver, MutationCache, onlineManager } from '@tanstack/react-query';
import { attachSessionMutationBoundary } from '../sessionQueryBoundary';
import { captureDataSession, setDataSession } from '../dataSession';
const A = { userId: 'a', tenantId: 'a', pointId: 'p' };
const B = { userId: 'b', tenantId: 'b', pointId: 'q' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
it.each(['success', 'error'])(
  'drops old actual MutationObserver %s callbacks, including global toast, after A→B→A',
  async (kind) => {
    const globalError = jest.fn();
    const qc = new QueryClient({ mutationCache: new MutationCache({ onError: globalError }) });
    const detach = attachSessionMutationBoundary(qc);
    setDataSession(A);
    const gate = deferred<number>();
    let started = false;
    const run = () => {
      started = true;
      return gate.promise;
    };
    const success = jest.fn();
    const error = jest.fn();
    const settled = jest.fn();
    const observer = new MutationObserver(qc, {
      mutationFn: run,
      onSuccess: success,
      onError: error,
      onSettled: settled,
    });
    const unsubscribe = observer.subscribe(() => {});
    const result = observer.mutate(undefined).catch(() => undefined);
    while (!started) await Promise.resolve();
    setDataSession(B);
    setDataSession(A);
    observer.setOptions({ mutationFn: run, onSuccess: success, onError: error, onSettled: settled });
    if (kind === 'success') gate.resolve(42);
    else gate.reject(new Error('old failure'));
    await result;
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(globalError).not.toHaveBeenCalled();
    unsubscribe();
    detach();
    qc.clear();
  },
);
it('paused A mutation cannot POST after a new account becomes active', async () => {
  const qc = new QueryClient();
  const detach = attachSessionMutationBoundary(qc);
  setDataSession(A);
  onlineManager.setOnline(false);
  const post = jest.fn(async () => 1);
  const observer = new MutationObserver(qc, { mutationFn: post });
  const unsub = observer.subscribe(() => {});
  const result = observer.mutate(undefined).catch((e) => e.code);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  setDataSession(B);
  onlineManager.setOnline(true);
  await qc.resumePausedMutations();
  expect(await result).toBe('ERR_CANCELED');
  expect(post).not.toHaveBeenCalled();
  unsub();
  detach();
  qc.clear();
});
it('synchronous data lease stays invalid even if React never rendered intermediate B', () => {
  setDataSession(A);
  const lease = captureDataSession();
  setDataSession(B);
  setDataSession(A);
  expect(lease.isCurrent()).toBe(false);
});
