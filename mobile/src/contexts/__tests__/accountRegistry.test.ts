import {
  ACCOUNT_REGISTRY_KEY,
  accountId,
  activeAccount,
  createAccountRegistry,
  type AccountKeyValueStorage,
} from '../accountRegistry';
import { AUTH_SESSION_ENVELOPE_KEY } from '../authSessionStorage';

interface Profile {
  id: string;
  tenantId?: string;
  fullName: string;
  role: string;
  currentPointId?: string;
}
const profile = (id: string, tenantId: string | undefined = 'tenant-' + id): Profile => ({
  id,
  tenantId,
  fullName: id,
  role: tenantId ? 'master' : 'manager',
});
const jwt = (user: Profile, by?: string) =>
  'header.' + btoa(JSON.stringify({ sub: user.id, tenantId: user.tenantId, impersonatedBy: by })) + '.fixture';
const session = (user: Profile, by?: string) => ({ token: jwt(user, by), user, impersonating: !!by });
const memory = () => {
  const values = new Map<string, string>();
  const store: AccountKeyValueStorage = {
    getItem: jest.fn(async (key) => values.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { values, store };
};
const setup = () => {
  const secure = memory(),
    legacy = memory();
  const make = () =>
    createAccountRegistry<Profile>(
      secure.store,
      legacy.store,
      (v): v is Profile => !!v && typeof v === 'object' && typeof (v as Profile).id === 'string',
    );
  return { secure, legacy, make, registry: make() };
};
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

it('migrates legacy credential only after encrypted write and exact readback; restarts with same account', async () => {
  const f = setup(),
    a = session(profile('a'));
  f.legacy.values.set('token', a.token);
  f.legacy.values.set('user', JSON.stringify(a.user));
  const events: string[] = [];
  const get = f.secure.store.getItem;
  f.secure.store.getItem = async (key) => {
    const value = await get(key);
    events.push(value ? 'verified' : 'absent');
    return value;
  };
  const remove = f.legacy.store.removeItem;
  f.legacy.store.removeItem = async (key) => {
    events.push('remove');
    return remove(key);
  };
  const state = await f.registry.read();
  expect(activeAccount(state)?.session).toEqual(a);
  expect(events.indexOf('verified')).toBeLessThan(events.indexOf('remove'));
  expect(f.legacy.store.setItem).not.toHaveBeenCalled();
  expect(f.legacy.values.size).toBe(0);
  expect(activeAccount(await f.make().read())?.session).toEqual(a);
});

it('secure failure never deletes the sole legacy credential or falls back to plaintext new writes', async () => {
  const f = setup(),
    a = session(profile('a'));
  f.legacy.values.set('token', a.token);
  f.secure.store.setItem = jest.fn(async () => {
    throw Error('storage unavailable');
  });
  await expect(f.registry.read()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(f.legacy.values.get('token')).toBe(a.token);
  expect(f.legacy.store.removeItem).not.toHaveBeenCalled();
  expect(f.legacy.store.setItem).not.toHaveBeenCalled();
});

it('a crash after secure commit/readback retains the cleanup proof and restarts safely', async () => {
  const f = setup(),
    a = session(profile('a'));
  const raw = JSON.stringify({ v: 1, generation: 9, ...a });
  f.legacy.values.set(AUTH_SESSION_ENVELOPE_KEY, raw);
  f.legacy.values.set('token', a.token);
  const remove = f.legacy.store.removeItem;
  f.legacy.store.removeItem = async () => {
    throw Error('process interrupted');
  };
  await f.registry.read();
  expect(JSON.parse(f.secure.values.get(ACCOUNT_REGISTRY_KEY)!).legacyCleanup.length).toBe(2);
  f.legacy.store.removeItem = remove;
  expect(activeAccount(await f.make().read())?.session).toEqual(a);
  expect(f.legacy.values.size).toBe(0);
  expect(JSON.parse(f.secure.values.get(ACCOUNT_REGISTRY_KEY)!).legacyCleanup).toBeUndefined();
});

it('conditional migration cleanup preserves a newer old-build token', async () => {
  const f = setup(),
    a = session(profile('a')),
    b = session(profile('b'));
  f.legacy.values.set('token', a.token);
  const set = f.secure.store.setItem;
  f.secure.store.setItem = async (key, raw) => {
    await set(key, raw);
    f.legacy.values.set('token', b.token);
  };
  expect(activeAccount(await f.registry.read())?.session?.token).toBe(a.token);
  expect(f.legacy.values.get('token')).toBe(b.token);
});

it('authoritative logout tombstone beats legacy mirrors and a corrupt secure value is never overwritten', async () => {
  const f = setup();
  f.legacy.values.set(
    AUTH_SESSION_ENVELOPE_KEY,
    JSON.stringify({ v: 1, generation: 4, token: null, user: null, impersonating: false }),
  );
  f.legacy.values.set('token', jwt(profile('a')));
  expect((await f.registry.read()).accounts).toEqual([]);
  f.secure.values.set(ACCOUNT_REGISTRY_KEY, '{broken');
  await expect(f.make().read()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  expect(f.secure.values.get(ACCOUNT_REGISTRY_KEY)).toBe('{broken');
});

it('max three, duplicate login replacement and account mismatch preserve current active registry on failure', async () => {
  const f = setup();
  let r = await f.registry.read();
  for (const id of ['a', 'b', 'c']) r = (await f.registry.install(session(profile(id)), r.generation)).registry;
  const before = f.secure.values.get(ACCOUNT_REGISTRY_KEY);
  await expect(f.registry.install(session(profile('d')), r.generation)).rejects.toMatchObject({
    code: 'ACCOUNT_LIMIT',
  });
  expect(f.secure.values.get(ACCOUNT_REGISTRY_KEY)).toBe(before);
  r = (await f.registry.install(session({ ...profile('b'), fullName: 'Fresh B' }), r.generation)).registry;
  expect(r.accounts).toHaveLength(3);
  expect(activeAccount(r)?.displayName).toBe('Fresh B');
  await expect(
    f.registry.install(session(profile('c')), r.generation, {
      reauthAccountId: accountId({ userId: 'b', tenantId: 'tenant-b' }),
    }),
  ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
  expect(activeAccount(await f.registry.read())?.identity.userId).toBe('b');
});

it('tenantless manager, point switches and impersonation keep original slot, hard end marks only it for reauth', async () => {
  const f = setup(),
    manager = profile('platform', undefined);
  manager.tenantId = undefined;
  manager.role = 'manager';
  let r = await f.registry.read();
  r = (await f.registry.install(session(manager), r.generation)).registry;
  const original = r.activeId!;
  r = (await f.registry.install(session(profile('a')), r.generation)).registry;
  const a = r.activeId!;
  r = (
    await f.registry.install(session({ ...profile('a'), currentPointId: 'point-2' }), r.generation, {
      originalAccountId: a,
    })
  ).registry;
  expect(r.activeId).toBe(a);
  expect(r.accounts).toHaveLength(2);
  r = (await f.registry.activate(original, r.generation)).registry;
  const impersonated = { ...profile('director'), role: 'director' };
  r = (await f.registry.install(session(impersonated, manager.id), r.generation, { originalAccountId: original }))
    .registry;
  expect(r.activeId).toBe(original);
  expect(r.accounts).toHaveLength(2);
  expect(activeAccount(r)?.identity).toEqual({ userId: 'platform', tenantId: null });
  expect(activeAccount(await f.make().read())?.session?.user?.id).toBe('director');
  r = (await f.registry.expire(r.generation)).registry;
  expect(r.activeId).toBeNull();
  expect(r.accounts.find((x) => x.id === original)).toMatchObject({
    needsReauth: true,
    session: null,
    identity: { userId: 'platform', tenantId: null },
  });
  expect(r.accounts.find((x) => x.id === a)?.session?.user?.id).toBe('a');
});

it('A→B→A with same JWT gets distinct generations and rejects an old A write or removal', async () => {
  const f = setup();
  let r = await f.registry.read();
  r = (await f.registry.install(session(profile('a')), r.generation)).registry;
  const a = r.activeId!,
    old = r.generation;
  r = (await f.registry.install(session(profile('b')), r.generation)).registry;
  r = (await f.registry.activate(a, r.generation)).registry;
  expect(r.generation).toBeGreaterThan(old);
  await expect(f.registry.update(session({ ...profile('a'), fullName: 'stale' }), old)).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  });
  await expect(f.registry.remove(a, old)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(activeAccount(await f.registry.read())?.displayName).toBe('a');
});

it('writes are physically serial even when first native call is delayed; canceled owner never writes', async () => {
  const f = setup();
  const r = await f.registry.read(),
    gate = deferred(),
    entered = deferred();
  let writes = 0;
  const set = f.secure.store.setItem;
  f.secure.store.setItem = async (key, raw) => {
    writes++;
    if (writes === 1) {
      entered.resolve();
      await gate.promise;
    }
    await set(key, raw);
  };
  const first = f.registry.install(session(profile('a')), r.generation);
  await entered.promise;
  const second = f.registry.install(session(profile('b')), r.generation);
  await Promise.resolve();
  expect(writes).toBe(1);
  gate.resolve();
  await first;
  await expect(second).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  const latest = await f.registry.read();
  await expect(
    f.registry.install(session(profile('b')), latest.generation, { isCurrent: () => false }),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(writes).toBe(1);
});

it('restart after lost native acknowledgement observes one complete committed version and never loses either account', async () => {
  const f = setup();
  let r = await f.registry.read();
  r = (await f.registry.install(session(profile('a')), r.generation)).registry;
  const set = f.secure.store.setItem;
  f.secure.store.setItem = async (key, raw) => {
    await set(key, raw);
    throw Error('ack lost');
  };
  await expect(f.registry.install(session(profile('b')), r.generation)).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
  f.secure.store.setItem = set;
  const restored = await f.make().read();
  expect(restored.accounts.map((x) => x.identity.userId)).toEqual(['a', 'b']);
  expect(activeAccount(restored)?.identity.userId).toBe('b');
});

it('removing active selects first usable saved account, reauth slots and others are preserved', async () => {
  const f = setup();
  let r = await f.registry.read();
  for (const id of ['a', 'b', 'c']) r = (await f.registry.install(session(profile(id)), r.generation)).registry;
  const c = r.activeId!;
  r = (await f.registry.expire(r.generation)).registry;
  const b = r.accounts[1].id;
  r = (await f.registry.activate(b, r.generation)).registry;
  r = (await f.registry.remove(b, r.generation)).registry;
  expect(activeAccount(r)?.identity.userId).toBe('a');
  expect(r.accounts.find((x) => x.id === c)?.needsReauth).toBe(true);
});

it('logout overtakes an in-flight native Add without erasing new B credential or reviving UI', async () => {
  const f = setup();
  const a = session(profile('a')),
    b = session(profile('b'));
  let state = await f.registry.read();
  state = (await f.registry.install(a, state.generation)).registry;
  const gate = deferred<void>();
  const entered = deferred<void>();
  const nativeSet = f.secure.store.setItem;
  let current = true;
  f.secure.store.setItem = async (key, value) => {
    entered.resolve();
    await gate.promise;
    return nativeSet(key, value);
  };
  const installing = f.registry.install(b, state.generation, { isCurrent: () => current });
  await entered.promise;
  current = false;
  const logout = f.registry.deactivate(accountId({ tenantId: 'tenant-a', userId: 'a' }), () => true);
  gate.resolve();
  await installing;
  await logout;
  const restored = await f.make().read();
  expect(restored.activeId).toBe(null);
  expect(restored.accounts.find((x) => x.identity.userId === 'a')?.needsReauth).toBe(true);
  expect(restored.accounts.find((x) => x.identity.userId === 'b')?.session?.token).toBe(b.token);
});
it('stores effective point history without consuming slots and rejects stale profile during an Add commit', async () => {
  const f = setup();
  let state = await f.registry.read();
  const a = session({ ...profile('a'), currentPointId: 'p1' });
  state = (await f.registry.install(a, state.generation)).registry;
  const oldGen = state.generation;
  state = (
    await f.registry.install({ ...a, user: { ...a.user, currentPointId: 'p2' } }, state.generation, {
      originalAccountId: state.activeId!,
    })
  ).registry;
  expect(state.accounts).toHaveLength(1);
  expect(state.accounts[0].scopes.map((x) => x.pointId)).toEqual(['p1', 'p2']);
  await expect(f.registry.update(a, oldGen)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
});

it('known expired saved B is marked for reauthentication without switching or clearing active A', async () => {
  const f = setup(),
    a = session(profile('a')),
    b = session(profile('b'));
  b.token = 'x.' + btoa(JSON.stringify({ sub: 'b', tenantId: 'tenant-b', exp: 1 })) + '.x';
  let state = await f.registry.read();
  state = (await f.registry.install(b, state.generation)).registry;
  const bId = state.activeId!;
  state = (await f.registry.install(a, state.generation)).registry;
  const aId = state.activeId;
  const result = await f.registry.activate(bId, state.generation);
  expect(result.result).toBe(false);
  expect(result.registry.activeId).toBe(aId);
  expect(result.registry.accounts.find((x) => x.id === bId)).toMatchObject({ session: null, needsReauth: true });
  expect(activeAccount(result.registry)?.session?.token).toBe(a.token);
});

it('removing active skips a known expired saved slot and deterministically activates the next usable one', async () => {
  const f = setup();
  let state = await f.registry.read();
  const expired = session(profile('expired'));
  expired.token = 'x.' + btoa(JSON.stringify({ sub: 'expired', tenantId: 'tenant-expired', exp: 1 })) + '.x';
  for (const next of [expired, session(profile('b')), session(profile('a'))])
    state = (await f.registry.install(next, state.generation)).registry;
  state = (await f.registry.remove(state.activeId!, state.generation)).registry;
  expect(activeAccount(state)?.identity.userId).toBe('b');
  expect(state.accounts[0]).toMatchObject({ session: null, needsReauth: true });
});

it('an explicit JWT point cannot be paired with a stale cached profile from another point', async () => {
  const f = setup();
  const state = await f.registry.read();
  const a = session({ ...profile('a'), currentPointId: 'wrong' });
  a.token = 'x.' + btoa(JSON.stringify({ sub: 'a', tenantId: 'tenant-a', pointId: 'correct' })) + '.x';
  await expect(f.registry.install(a, state.generation)).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
  expect((await f.registry.read()).accounts).toHaveLength(0);
});
