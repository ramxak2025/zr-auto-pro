import { createPushSessionLifecycle, PUSH_CLAIM_KEY } from '../pushSessionLifecycle';
const bearer = (sub: string, nonce = '') => `x.${btoa(JSON.stringify({ sub, tenantId: 't', nonce }))}.x`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  const map = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      map.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      map.delete(k);
    }),
  };
  const transport = {
    register: jest.fn(async (_c: { bearer: string }) => ({ registered: true })),
    unregister: jest.fn(async (_c: { bearer: string }) => {}),
    logout: jest.fn(async (_bearer: string) => {}),
  };
  return { map, storage, transport, core: createPushSessionLifecycle(storage, transport) };
}
it('serializes late A registration → exact A removal → B, including A→B→A epochs', async () => {
  const f = fixture();
  const gate = deferred();
  let generation = 1;
  f.transport.register.mockImplementationOnce(async () => {
    await gate.promise;
    return { registered: true };
  });
  const old = f.core.register(bearer('a'), 'device', 'ios', () => generation === 1);
  while (!f.transport.register.mock.calls.length) await Promise.resolve();
  generation = 2;
  const detach = f.core.detach();
  const b = f.core.register(bearer('b'), 'device', 'ios', () => generation === 2);
  expect(f.transport.unregister).not.toHaveBeenCalled();
  gate.resolve();
  await Promise.all([old, detach, b]);
  expect(f.transport.unregister.mock.calls[0][0].bearer).toBe(bearer('a'));
  expect(JSON.parse(f.map.get(PUSH_CLAIM_KEY)!).bearer).toBe(bearer('b'));
  generation = 3;
  await f.core.register(bearer('a'), 'device', 'ios', () => generation === 1);
  expect(f.transport.register).toHaveBeenCalledTimes(2);
});
it('retains ambiguous A across process recreation and blocks B until cleanup succeeds', async () => {
  const f = fixture();
  f.transport.register.mockRejectedValueOnce(new Error('lost ACK'));
  await expect(f.core.register(bearer('a'), 'device', 'ios', () => true)).rejects.toThrow('lost ACK');
  const restored = createPushSessionLifecycle(f.storage, f.transport);
  f.transport.unregister.mockRejectedValueOnce(new Error('offline'));
  await expect(restored.register(bearer('b'), 'device', 'ios', () => true)).rejects.toThrow('offline');
  expect(f.transport.register).toHaveBeenCalledTimes(1);
  expect(JSON.parse(f.map.get(PUSH_CLAIM_KEY)!).bearer).toBe(bearer('a'));
  await restored.register(bearer('b'), 'device', 'ios', () => true);
  expect(f.transport.register).toHaveBeenCalledTimes(2);
});
it('refuses network when secure write/readback fails or operation loses ownership', async () => {
  const f = fixture();
  f.storage.setItem.mockRejectedValueOnce(new Error('locked'));
  await expect(f.core.register(bearer('a'), 'device', 'ios', () => true)).rejects.toThrow('locked');
  await f.core.register(bearer('a'), 'device', 'ios', () => false);
  expect(f.transport.register).not.toHaveBeenCalled();
});
it('removing an inactive original account cannot clear B claim even for same effective actor', async () => {
  const f = fixture();
  const a = bearer('owner', 'impersonated-A');
  const b = bearer('owner', 'direct-B');
  await f.core.register(b, 'device', 'ios', () => true);
  await f.core.logout(a);
  expect(f.transport.unregister).not.toHaveBeenCalled();
  expect(f.transport.logout).toHaveBeenCalledWith(a);
  expect(JSON.parse(f.map.get(PUSH_CLAIM_KEY)!).bearer).toBe(b);
});
it('uses refreshed current bearer for owned cleanup, never revokes before removal confirmation', async () => {
  const f = fixture();
  const a = bearer('a', 'old');
  const refreshed = bearer('a', 'new');
  await f.core.register(a, 'device', 'ios', () => true);
  f.transport.unregister.mockRejectedValueOnce(new Error('offline'));
  await expect(f.core.logout(refreshed, true)).rejects.toThrow('offline');
  expect(f.transport.logout).not.toHaveBeenCalled();
  await f.core.logout(refreshed, true);
  expect(f.transport.unregister.mock.calls[1][0].bearer).toBe(refreshed);
  expect(f.map.has(PUSH_CLAIM_KEY)).toBe(false);
});
