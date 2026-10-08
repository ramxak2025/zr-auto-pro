import { inspectSavedAccountRemoval } from '../accountRemoval';
import { serializeQueue, scopedQueueKey, OFFLINE_CHECK_QUEUE_STORAGE_KEY } from '../../utils/offlineCheckQueue';
const A = { tenantId: 'tenant-a', userId: 'user-a', pointId: 'point-a' },
  B = { tenantId: 'tenant-b', userId: 'user-b', pointId: 'point-b' };
const id = '11111111-1111-4111-8111-111111111111';
const row = {
  clientRequestId: id,
  payload: { clientRequestId: id },
  createdAt: 1,
  attempts: 0,
  status: 'pending' as const,
};
function fixture(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    storage: { getItem: async (k: string) => map.get(k) ?? null, getAllKeys: async () => [...map.keys()] },
  };
}
it('blocks only own pending financial/NFC/check intents and never deletes a ledger', async () => {
  const f = fixture({
    [scopedQueueKey(A)]: serializeQueue([{ ...row, payload: { ...row.payload, pointId: A.pointId } }], A),
    [`autexa:procurement:v1:${A.tenantId}/${A.userId}/${A.pointId}/delivery-return/source`]: 'pending',
    [`autexa:nfc:v1:${A.tenantId}/${A.userId}/${A.pointId}`]: 'pending',
    [`autexa:nfc:v1:${B.tenantId}/${B.userId}/${B.pointId}`]: 'foreign',
  });
  const result = await inspectSavedAccountRemoval(f.storage, { scopes: [A] });
  expect(result).toMatchObject({ canRemove: false, offlineChecks: 1, financialIntents: 1, nfcScans: 1 });
  expect(f.map.size).toBe(4);
});
it('unattributed legacy remains quarantine rather than being adopted/deleted on removal', async () => {
  const raw = serializeQueue([row]);
  const f = fixture({ [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: raw });
  const result = await inspectSavedAccountRemoval(f.storage, { scopes: [A] });
  expect(result).toMatchObject({ canRemove: true, offlineChecks: 0, legacyQuarantined: 1 });
  expect(f.map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY)).toBe(raw);
});
it('protects proved legacy before first import, but keeps the completion marker authoritative', async () => {
  const raw = serializeQueue([{ ...row, payload: { ...row.payload, pointId: A.pointId } }], A);
  const f = fixture({ [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: raw });
  expect((await inspectSavedAccountRemoval(f.storage, { scopes: [A] })).canRemove).toBe(false);
  f.map.set(scopedQueueKey(A), serializeQueue([], A));
  expect((await inspectSavedAccountRemoval(f.storage, { scopes: [A] })).canRemove).toBe(true);
  expect(f.map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY)).toBe(raw);
});
it('storage failure or malformed own ledger never authorizes destructive cleanup', async () => {
  const f = fixture({ [scopedQueueKey(A)]: 'broken' });
  await expect(inspectSavedAccountRemoval(f.storage, { scopes: [A] })).rejects.toThrow();
  f.storage.getAllKeys = async () => {
    throw new Error('locked');
  };
  await expect(inspectSavedAccountRemoval(f.storage, { scopes: [A] })).rejects.toThrow('locked');
  expect(f.map.size).toBe(1);
});
