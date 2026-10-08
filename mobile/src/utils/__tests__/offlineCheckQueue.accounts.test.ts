import {
  createOfflineCheckQueueCore,
  parseStoredQueue,
  serializeQueue,
  scopedQueueKey,
  OFFLINE_CHECK_QUEUE_STORAGE_KEY,
  type QueueOwner,
  type QueuedCheck,
} from '../offlineCheckQueue';
const A = { userId: 'a', tenantId: 'tA', pointId: 'pA' };
const B = { userId: 'b', tenantId: 'tB', pointId: 'pB' };
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const row = (digit: string, pointId?: string | null): QueuedCheck => ({
  clientRequestId: id(digit),
  payload: { clientRequestId: id(digit), ...(pointId === undefined ? {} : { pointId }) },
  createdAt: 1,
  attempts: 0,
  status: 'pending',
});
function fixture(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const sends: { owner: QueueOwner; point: unknown; id: string }[] = [];
  const storage = {
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      map.set(k, v);
    }),
  };
  const core = createOfflineCheckQueueCore({
    storage,
    scopedStorage: true,
    captureSender: (owner) => async (body) => {
      sends.push({ owner, point: body.pointId, id: body.clientRequestId });
      return {};
    },
  });
  core.setSender(async () => {
    throw new Error('Unbound sender must never run');
  });
  return { map, sends, storage, core };
}
it('retains A through B and only sends when original tenant/user/point is active', async () => {
  const f = fixture();
  await f.core.adoptSession(A);
  await f.core.enqueue(row('1').payload);
  await f.core.adoptSession(B);
  await f.core.enqueue(row('2').payload);
  await f.core.flush();
  expect(f.sends).toEqual([{ owner: B, point: B.pointId, id: id('2') }]);
  expect(parseStoredQueue(f.map.get(scopedQueueKey(A))!)).toHaveLength(1);
  await f.core.adoptSession({ ...A, pointId: 'other' });
  await f.core.flush();
  expect(f.sends).toHaveLength(1);
  await f.core.adoptSession(A);
  await f.core.flush();
  expect(f.sends[1]).toEqual({ owner: A, point: A.pointId, id: id('1') });
});
it.each([undefined, null])('never adopts ownerless legacy entries with point=%s', async (point) => {
  const raw = serializeQueue([row('1', point)]);
  const f = fixture({ [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: raw });
  await f.core.adoptSession(A);
  await f.core.flush();
  expect(f.sends).toHaveLength(0);
  expect(f.map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY)).toBe(raw);
});
it('copies only proved explicit point entries, null-point requires original proof, never reimports after completion', async () => {
  const raw = serializeQueue([row('1', 'pA'), row('2'), row('3', null)], A);
  const f = fixture({ [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: raw });
  await f.core.adoptSession(A);
  expect(f.core.pendingCount()).toBe(1);
  await f.core.flush();
  await f.core.adoptSession(B);
  await f.core.adoptSession(A);
  expect(f.core.pendingCount()).toBe(0);
  await f.core.adoptSession({ ...A, pointId: null });
  expect(f.core.pendingCount()).toBe(0);
  expect(f.map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY)).toBe(raw);
  const g = fixture({ [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: serializeQueue([row('3', null)], { ...A, pointId: null }) });
  await g.core.adoptSession({ ...A, pointId: null });
  expect(g.core.pendingCount()).toBe(1);
});
it('storage read failure cannot overwrite A ledger with empty state or send it as B', async () => {
  const f = fixture({ [scopedQueueKey(A)]: serializeQueue([row('1', 'pA')], A) });
  f.storage.getItem.mockRejectedValueOnce(new Error('bridge'));
  await expect(f.core.adoptSession(A)).rejects.toThrow('bridge');
  expect(f.storage.setItem).not.toHaveBeenCalled();
  await f.core.adoptSession(B);
  await f.core.flush();
  expect(f.sends).toHaveLength(0);
  expect(parseStoredQueue(f.map.get(scopedQueueKey(A))!)).toHaveLength(1);
});
it('unproved/corrupt scoped records are retained verbatim and never replaced by an empty queue', async () => {
  const raw = serializeQueue([row('1', 'wrong-point')], A);
  const f = fixture({ [scopedQueueKey(A)]: raw });
  await expect(f.core.adoptSession(A)).rejects.toThrow('исходного владельца');
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.map.get(scopedQueueKey(A))).toBe(raw);
  await f.core.flush();
  expect(f.sends).toHaveLength(0);
});
