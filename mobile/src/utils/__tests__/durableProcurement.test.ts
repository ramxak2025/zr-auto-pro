import {
  createDurableProcurement,
  createProcurementMutex,
  type ProcurementOwner,
  type ProcurementStorage,
} from '../../../../shared/utils/durableProcurement';

const owner: ProcurementOwner = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  pointId: '33333333-3333-4333-8333-333333333333',
};
const sourceId = '44444444-4444-4444-8444-444444444444';
const target = { operation: 'po-receive' as const, sourceId };
const makeId = () => `55555555-5555-4555-8555-${String(++sequence).padStart(12, '0')}`;
let sequence = 0;
function fixture() {
  const disk = new Map<string, string>();
  const storage: ProcurementStorage = {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => {
      disk.set(key, value);
    },
    removeItem: async (key) => {
      disk.delete(key);
    },
    keys: async () => [...disk.keys()],
    exclusive: createProcurementMutex(),
  };
  return { disk, storage, store: () => createDurableProcurement(storage, makeId) };
}
const body = {
  paymentMode: 'paid',
  receivedAt: '2026-10-08',
  items: [{ itemId: sourceId, receivedQuantity: 3, purchasePrice: 10, sellPrice: 0 }],
};
const result = { status: 200, data: { id: sourceId, status: 'ordered', items: [] } };
const rejected = (status: number) => ({ response: { status } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('durable procurement recovery', () => {
  it('commit + lost response, remount, changed date/refetch and full outstanding zero replay the exact saved request', async () => {
    const f = fixture(),
      ledger = new Map<string, typeof result>();
    let stock = 0;
    let first = true;
    const sent: string[] = [];
    const send = async (_path: string, serialized: string) => {
      sent.push(serialized);
      const dto = JSON.parse(serialized);
      if (!ledger.has(dto.requestId)) {
        stock += dto.items[0].receivedQuantity;
        ledger.set(dto.requestId, result);
      }
      if (first) {
        first = false;
        throw new Error('lost response');
      }
      return ledger.get(dto.requestId)!;
    };
    await expect(f.store().execute({ owner, target, payload: body, isCurrent: () => true, send })).rejects.toThrow(
      'lost response',
    );
    expect(stock).toBe(3);
    const remount = f.store(),
      pending = await remount.list(owner, () => true);
    expect(pending).toHaveLength(1);
    await expect(
      remount.execute({
        owner,
        target,
        payload: { ...body, receivedAt: '2026-10-09', items: [] },
        isCurrent: () => true,
        send,
      }),
    ).rejects.toMatchObject({ code: 'PENDING_REQUEST' });
    expect(sent).toHaveLength(1);
    expect(await remount.execute({ owner, target, isCurrent: () => true, send })).toEqual(result);
    expect(sent[1]).toBe(sent[0]);
    expect(stock).toBe(3);
    expect(f.disk.size).toBe(0);
  });
  it('old service worker synthetic 202/queued cannot clear the intent', async () => {
    const f = fixture();
    const firstSend = jest.fn(async () => ({ status: 202, data: { queued: true } }));
    await expect(
      f.store().execute({ owner, target, payload: body, isCurrent: () => true, send: firstSend }),
    ).rejects.toMatchObject({ code: 'RESPONSE_UNCONFIRMED' });
    const original = [...f.disk.values()][0];
    const saved = JSON.parse(original);
    const send = jest.fn(async () => result);
    await f.store().execute({ owner, target, isCurrent: () => true, send });
    expect(send.mock.calls).toHaveLength(1);
    expect(f.disk.size).toBe(0);
    expect((send.mock.calls[0] as unknown[])[1]).toBe(saved.body);
  });
  it('failed persistence/readback dispatches zero requests, including corrupt data', async () => {
    for (const failure of ['throw', 'silent', 'corrupt']) {
      const f = fixture(),
        send = jest.fn(async () => result);
      if (failure === 'throw')
        f.storage.setItem = async () => {
          throw new Error('disk full');
        };
      if (failure === 'silent') f.storage.setItem = async () => {};
      if (failure === 'corrupt') {
        await f
          .store()
          .execute({
            owner,
            target,
            payload: body,
            isCurrent: () => true,
            send: async () => {
              throw new Error('lost');
            },
          })
          .catch(() => {});
        f.disk.set([...f.disk.keys()][0], 'broken');
      }
      await expect(
        f.store().execute({ owner, target, payload: body, isCurrent: () => true, send }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      expect(send).not.toHaveBeenCalled();
    }
  });
  it('A changes to B during disk write: no dispatch under B; later A resumes its own intent', async () => {
    const f = fixture(),
      gate = deferred<void>(),
      writing = deferred<void>();
    let current = true;
    const write = f.storage.setItem;
    f.storage.setItem = async (key, value) => {
      writing.resolve();
      await gate.promise;
      await write(key, value);
    };
    const send = jest.fn(async () => result);
    const first = f.store().execute({ owner, target, payload: body, isCurrent: () => current, send });
    await writing.promise;
    current = false;
    gate.resolve();
    await expect(first).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(send).not.toHaveBeenCalled();
    const other = { ...owner, userId: '66666666-6666-4666-8666-666666666666' };
    expect(await f.store().list(other, () => true)).toEqual([]);
    current = true;
    await f.store().execute({ owner, target, isCurrent: () => current, send });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('late committed response under A cannot become a UI success under B', async () => {
    const f = fixture(),
      gate = deferred<typeof result>();
    let current = true;
    const called = deferred<void>();
    const run = f.store().execute({
      owner,
      target,
      payload: body,
      isCurrent: () => current,
      send: async () => {
        called.resolve();
        return gate.promise;
      },
    });
    await called.promise;
    current = false;
    gate.resolve(result);
    await expect(run).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(f.disk.size).toBe(0);
  });
  it('duplicate in-flight calls share one dispatch; rejected promise releases the slot for recovery', async () => {
    const f = fixture(),
      store = f.store(),
      gate = deferred<typeof result>();
    const send = jest.fn(async () => gate.promise);
    const args = { owner, target, payload: body, isCurrent: () => true, send };
    const a = store.execute(args),
      b = store.execute(args);
    gate.resolve(result);
    expect(await a).toEqual(await b);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      store.execute({
        ...args,
        send: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow();
    await expect(store.execute({ owner, target, isCurrent: () => true, send: async () => result })).resolves.toEqual(
      result,
    );
  });
  it('two browser contexts cannot let an old response erase a newly submitted intent', async () => {
    const f = fixture(),
      aCalled = deferred<void>(),
      bCalled = deferred<void>(),
      cCalled = deferred<void>();
    const aResult = deferred<typeof result>(),
      bResult = deferred<typeof result>(),
      cResult = deferred<typeof result>();
    const a = f.store().execute({
      owner,
      target,
      payload: body,
      isCurrent: () => true,
      send: async () => {
        aCalled.resolve();
        return aResult.promise;
      },
    });
    await aCalled.promise;
    const b = f.store().execute({
      owner,
      target,
      isCurrent: () => true,
      send: async () => {
        bCalled.resolve();
        return bResult.promise;
      },
    });
    await bCalled.promise;
    aResult.resolve(result);
    await a;
    const c = f.store().execute({
      owner,
      target,
      payload: { ...body, items: [{ ...body.items[0], receivedQuantity: 1 }] },
      isCurrent: () => true,
      send: async () => {
        cCalled.resolve();
        return cResult.promise;
      },
    });
    await cCalled.promise;
    const newRecord = [...f.disk.values()][0];
    bResult.resolve(result);
    await b;
    expect([...f.disk.values()][0]).toBe(newRecord);
    cResult.resolve(result);
    await c;
    expect(f.disk.size).toBe(0);
  });
  it('changed in-flight payload is refused instead of sharing a mismatched result', async () => {
    const f = fixture(),
      store = f.store(),
      gate = deferred<typeof result>();
    const a = store.execute({ owner, target, payload: body, isCurrent: () => true, send: async () => gate.promise });
    await expect(
      store.execute({
        owner,
        target,
        payload: { ...body, paymentMode: 'debt' },
        isCurrent: () => true,
        send: async () => result,
      }),
    ).rejects.toMatchObject({ code: 'PENDING_REQUEST' });
    gate.resolve(result);
    await a;
  });
  it('missing or replaced dispatch claim aborts zero POST and preserves the newer intent', async () => {
    const f = fixture(),
      aCalled = deferred<void>(),
      aResult = deferred<typeof result>();
    const a = f.store().execute({
      owner,
      target,
      payload: body,
      isCurrent: () => true,
      send: async () => {
        aCalled.resolve();
        return aResult.promise;
      },
    });
    await aCalled.promise;
    const bClaim = deferred<void>(),
      releaseClaim = deferred<void>();
    let locks = 0;
    const bStorage = {
      ...f.storage,
      exclusive: <T>(key: string, run: () => Promise<T>) => {
        locks += 1;
        if (locks === 2)
          return (async () => {
            bClaim.resolve();
            await releaseClaim.promise;
            return f.storage.exclusive(key, run);
          })();
        return f.storage.exclusive(key, run);
      },
    };
    const bSend = jest.fn(async () => result),
      b = createDurableProcurement(bStorage, makeId).execute({ owner, target, isCurrent: () => true, send: bSend });
    await bClaim.promise;
    // First sender receives an authoritative rollback before B claimed dispatch.
    const rejectedA = expect(a).rejects.toEqual(rejected(400));
    // Resolve with a rejecting thenable to control the in-flight first response.
    aResult.resolve(Promise.reject(rejected(400)) as unknown as typeof result);
    await rejectedA;
    expect(f.disk.size).toBe(0);
    const cCalled = deferred<void>(),
      cResult = deferred<typeof result>();
    const c = f.store().execute({
      owner,
      target,
      payload: { ...body, paymentMode: 'debt' },
      isCurrent: () => true,
      send: async () => {
        cCalled.resolve();
        return cResult.promise;
      },
    });
    await cCalled.promise;
    const current = [...f.disk.values()][0];
    releaseClaim.resolve();
    await expect(b).rejects.toMatchObject({ code: 'PENDING_REQUEST' });
    expect(bSend).not.toHaveBeenCalled();
    expect([...f.disk.values()][0]).toBe(current);
    cResult.resolve(result);
    await c;
  });
  it('restored prepared-but-never-submitted intent clears a first authoritative rollback and permits correction', async () => {
    const f = fixture(),
      writing = deferred<void>(),
      releaseWrite = deferred<void>();
    let current = true;
    const set = f.storage.setItem;
    f.storage.setItem = async (key, value) => {
      await set(key, value);
      writing.resolve();
      await releaseWrite.promise;
    };
    const old = f.store().execute({ owner, target, payload: body, isCurrent: () => current, send: async () => result });
    await writing.promise;
    current = false;
    releaseWrite.resolve();
    await expect(old).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(JSON.parse([...f.disk.values()][0])).toMatchObject({ submitted: false, dispatches: 0 });
    const restored = f.store();
    await expect(
      restored.execute({
        owner,
        target,
        isCurrent: () => true,
        send: async () => {
          throw rejected(400);
        },
      }),
    ).rejects.toEqual(rejected(400));
    expect(f.disk.size).toBe(0);
    await expect(
      restored.execute({
        owner,
        target,
        payload: { ...body, paymentMode: 'debt' },
        isCurrent: () => true,
        send: async () => result,
      }),
    ).resolves.toEqual(result);
  });
  it('initial known rollback clears; restored ambiguous 400/422 and every 409 remain pending', async () => {
    for (const status of [400, 422]) {
      const f = fixture();
      await expect(
        f.store().execute({
          owner,
          target,
          payload: body,
          isCurrent: () => true,
          send: async () => {
            throw rejected(status);
          },
        }),
      ).rejects.toEqual(rejected(status));
      expect(f.disk.size).toBe(0);
      await f
        .store()
        .execute({
          owner,
          target,
          payload: body,
          isCurrent: () => true,
          send: async () => {
            throw new Error('lost');
          },
        })
        .catch(() => {});
      await f
        .store()
        .execute({
          owner,
          target,
          isCurrent: () => true,
          send: async () => {
            throw rejected(status);
          },
        })
        .catch(() => {});
      expect(f.disk.size).toBe(1);
    }
    const f = fixture();
    await f
      .store()
      .execute({
        owner,
        target,
        payload: body,
        isCurrent: () => true,
        send: async () => {
          throw rejected(409);
        },
      })
      .catch(() => {});
    expect(f.disk.size).toBe(1);
  });
  it('storage key isolates tenant, user, point, operation and source; credentials are refused', async () => {
    const f = fixture();
    await f
      .store()
      .execute({
        owner,
        target,
        payload: body,
        isCurrent: () => true,
        send: async () => {
          throw new Error('lost');
        },
      })
      .catch(() => {});
    for (const field of ['tenantId', 'userId', 'pointId'])
      expect(await f.store().list({ ...owner, [field]: '77777777-7777-4777-8777-777777777777' }, () => true)).toEqual(
        [],
      );
    const send = jest.fn(async () => result);
    await expect(
      f.store().execute({
        owner,
        target: { ...target, sourceId: '88888888-8888-4888-8888-888888888888' },
        payload: { ...body, token: 'not-saved' },
        isCurrent: () => true,
        send,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
    expect([...f.disk.values()].join('')).not.toContain('not-saved');
  });
});
