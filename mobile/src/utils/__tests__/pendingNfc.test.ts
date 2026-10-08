import { createHash, randomUUID } from 'crypto';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import {
  createPendingNfc,
  ownsNfcOutcome,
  type NfcSession,
  type NfcPendingStorage,
  type NfcRecoveryOutcome,
} from '../../../../shared/utils/pendingNfc';
import { createProcurementMutex } from '../../../../shared/utils/durableProcurement';
import type { AttendanceNfcScanResult } from '../../../../shared/types';

const token = 'a'.repeat(43),
  otherToken = 'b'.repeat(43);
const sha256 = async (value: string) => createHash('sha256').update(value).digest('hex');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const session = (): NfcSession => ({
  owner: { tenantId: randomUUID(), userId: randomUUID(), pointId: randomUUID() },
  lease: {},
  isCurrent: () => true,
  refreshCurrent: jest.fn(async () => {}),
});
const fixture = () => {
  const disk = new Map<string, string>();
  const storage: NfcPendingStorage = {
    getItem: jest.fn(async (key) => disk.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      disk.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      disk.delete(key);
    }),
    exclusive: createProcurementMutex(),
  };
  return { disk, storage, create: () => createPendingNfc(storage, randomUUID, sha256) };
};
const snapshot = (s: NfcSession, action: AttendanceNfcScanResult['action'] = 'closed'): AttendanceNfcScanResult => ({
  action,
  reason: null,
  serverAt: '2026-10-08T06:30:00.000Z',
  firstNfcAt: '2026-10-08T06:00:00.000Z',
  closeAfter: '2026-10-08T06:10:00.000Z',
  reopenAfter: '2026-10-08T06:30:10.000Z',
  shift: {
    id: randomUUID(),
    tenantId: s.owner.tenantId,
    userId: s.owner.userId,
    pointId: s.owner.pointId,
    date: '2026-10-08',
    openedAt: '2026-10-08T06:00:00.000Z',
    closedAt: '2026-10-08T06:30:00.000Z',
    isAutoClosed: false,
    note: null,
    firstNfcAt: '2026-10-08T06:00:00.000Z',
  },
});
const ok = (result: AttendanceNfcScanResult) => ({ status: 200, data: result });

describe('NFC durable scan UUID/hash lifecycle', () => {
  it('does not dispatch after the active-screen lease expires during durable storage', async () => {
    const f = fixture(),
      s = session(),
      entered = deferred<void>(),
      continueStorage = deferred<void>();
    let current = true;
    s.isCurrent = () => current;
    const setItem = f.storage.setItem;
    f.storage.setItem = async (recordKey, value) => {
      entered.resolve();
      await continueStorage.promise;
      await setItem(recordKey, value);
    };
    const send = jest.fn(async () => ok(snapshot(s)));
    const operation = f.create().scan({ ...s, token, send });

    await entered.promise;
    current = false;
    continueStorage.resolve();

    await expect(operation).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(send).not.toHaveBeenCalled();
    expect(f.disk.size).toBe(1);
  });

  it('committed close + lost response + remount next day recovers original snapshot by GET, clears only own pending and refetches current shifts', async () => {
    const f = fixture(),
      s = session(),
      closed = snapshot(s),
      sent: string[] = [];
    await expect(
      f.create().scan({
        ...s,
        token,
        send: async (body) => {
          sent.push(body.requestId);
          throw Error('connection lost after commit');
        },
      }),
    ).rejects.toThrow();
    const raw = [...f.disk.values()][0];
    expect(raw).not.toContain(token);
    expect(raw).not.toContain('"token":');
    const remount = f.create(),
      lookups: string[] = [];
    const result = await remount.recover({
      ...s,
      lookup: async (id) => {
        lookups.push(id);
        return { status: 200, data: { status: 'completed', result: closed } };
      },
    });
    expect(result).toEqual({ status: 'completed', result: closed });
    expect(lookups).toEqual(sent);
    expect(f.disk.size).toBe(0);
    expect(s.refreshCurrent).toHaveBeenCalledTimes(1);
    expect(ownsNfcOutcome(result, s.lease, s.isCurrent)).toBe(true);
  });
  it('unknown while original POST is delayed never resets UUID; only same-hash rescan may retry, with exact original key', async () => {
    const f = fixture(),
      s = session(),
      sent: string[] = [];
    await expect(
      f.create().scan({
        ...s,
        token,
        send: async (body) => {
          sent.push(body.requestId);
          throw Error('transport ambiguous');
        },
      }),
    ).rejects.toThrow();
    const remount = f.create();
    const recovery = await remount.recover({
      ...s,
      lookup: async () => ({ status: 200, data: { status: 'unknown' } }),
    });
    expect(recovery.status).toBe('needs_tag');
    expect(f.disk.size).toBe(1);
    expect(s.refreshCurrent).not.toHaveBeenCalled();
    const wrongSend = jest.fn();
    await expect(remount.scan({ ...s, token: otherToken, send: wrongSend })).rejects.toMatchObject({
      code: 'PENDING_SCAN',
    });
    expect(wrongSend).not.toHaveBeenCalled();
    await remount.scan({
      ...s,
      token,
      send: async (body) => {
        sent.push(body.requestId);
        return ok(snapshot(s));
      },
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(f.disk.size).toBe(0);
  });
  it.each([400, 403, 404, 422])(
    'first known %s rejection permits a fresh valid tag; the rejected UUID is not reused',
    async (status) => {
      const f = fixture(),
        s = session(),
        core = f.create(),
        ids: string[] = [];
      await expect(
        core.scan({
          ...s,
          token,
          send: async (body) => {
            ids.push(body.requestId);
            throw Object.assign(Error('Rejected before mutation'), { response: { status } });
          },
        }),
      ).rejects.toMatchObject({ response: { status } });
      expect(await core.pending(s)).toBeNull();
      const result = await f.create().scan({
        ...s,
        token: otherToken,
        send: async (body) => {
          ids.push(body.requestId);
          return ok(snapshot(s));
        },
      });
      expect(result.status).toBe('completed');
      expect(ids[1]).not.toBe(ids[0]);
    },
  );
  it('ambiguous send followed by 403 and GET unknown retains the same UUID and forbids another tag', async () => {
    const f = fixture(),
      s = session(),
      ids: string[] = [];
    await expect(
      f.create().scan({
        ...s,
        token,
        send: async (body) => {
          ids.push(body.requestId);
          throw Error('response lost');
        },
      }),
    ).rejects.toThrow();
    const remount = f.create();
    await expect(
      remount.scan({
        ...s,
        token,
        send: async (body) => {
          ids.push(body.requestId);
          throw Object.assign(Error('Now revoked'), { response: { status: 403 } });
        },
      }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    expect(ids[1]).toBe(ids[0]);
    expect((await remount.pending(s))?.requestId).toBe(ids[0]);
    expect(
      (await remount.recover({ ...s, lookup: async () => ({ status: 200, data: { status: 'unknown' } }) })).status,
    ).toBe('needs_tag');
    const send = jest.fn();
    await expect(remount.scan({ ...s, token: otherToken, send })).rejects.toMatchObject({ code: 'PENDING_SCAN' });
    expect(send).not.toHaveBeenCalled();
  });
  it('old synthetic queued 202 remains pending and same UUID replays a genuine server result', async () => {
    const f = fixture(),
      s = session(),
      sent: string[] = [];
    await expect(
      f.create().scan({
        ...s,
        token,
        send: async (body) => {
          sent.push(body.requestId);
          return { status: 202, data: snapshot(s) };
        },
      }),
    ).rejects.toMatchObject({ code: 'UNCONFIRMED' });
    await f.create().scan({
      ...s,
      token,
      send: async (body) => {
        sent.push(body.requestId);
        return ok(snapshot(s));
      },
    });
    expect(sent[1]).toBe(sent[0]);
  });
  it('storage failure or account switch during persistence performs zero POSTs; owner B cannot recover A intent', async () => {
    const f = fixture(),
      a = session(),
      b = session(),
      send = jest.fn();
    f.storage.setItem = jest.fn(async () => {
      throw Error('disk unavailable');
    });
    await expect(f.create().scan({ ...a, token, send })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(send).not.toHaveBeenCalled();
    let current = true;
    a.isCurrent = () => current;
    f.storage.setItem = async (key, raw) => {
      f.disk.set(key, raw);
      current = false;
    };
    await expect(f.create().scan({ ...a, token, send })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(send).not.toHaveBeenCalled();
    const lookup = jest.fn();
    expect((await f.create().recover({ ...b, lookup })).status).toBe('idle');
    expect(lookup).not.toHaveBeenCalled();
    expect(f.disk.size).toBe(1);
    // The record was saved but never claimed/dispatched before unmount. Its
    // first actual rejection after remount is still a proved first attempt.
    current = true;
    f.storage.setItem = async (key, raw) => {
      f.disk.set(key, raw);
    };
    await expect(
      f.create().scan({
        ...a,
        token,
        send: async () => {
          throw Object.assign(Error('Wrong tag'), { response: { status: 403 } });
        },
      }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    expect(f.disk.size).toBe(0);
  });
  it('delayed independent-store claim after first rejection cannot POST removed intent or erase the replacement', async () => {
    const f = fixture(),
      s = session(),
      aEntered = deferred<void>(),
      rejectA = deferred<void>();
    const a = f.create().scan({
      ...s,
      token,
      send: async () => {
        aEntered.resolve();
        await rejectA.promise;
        throw Object.assign(Error('Rejected'), { response: { status: 403 } });
      },
    });
    const aRejected = expect(a).rejects.toMatchObject({ response: { status: 403 } });
    await aEntered.promise;
    const bClaim = deferred<void>(),
      allowB = deferred<void>();
    let locks = 0;
    const bStorage = {
      ...f.storage,
      exclusive: async <T>(recordKey: string, run: () => Promise<T>): Promise<T> => {
        if (++locks === 2) {
          bClaim.resolve();
          await allowB.promise;
        }
        return f.storage.exclusive(recordKey, run);
      },
    };
    const sendB = jest.fn(),
      b = createPendingNfc(bStorage, randomUUID, sha256).scan({ ...s, token, send: sendB });
    const bRejected = expect(b).rejects.toMatchObject({ code: 'PENDING_SCAN' });
    await bClaim.promise;
    rejectA.resolve();
    await aRejected;
    const cEntered = deferred<void>(),
      finishC = deferred<void>();
    let replacement = '';
    const c = f.create().scan({
      ...s,
      token: otherToken,
      send: async (body) => {
        replacement = body.requestId;
        cEntered.resolve();
        await finishC.promise;
        return ok(snapshot(s));
      },
    });
    await cEntered.promise;
    allowB.resolve();
    await bRejected;
    expect(sendB).not.toHaveBeenCalled();
    expect((await f.create().pending(s))?.requestId).toBe(replacement);
    finishC.resolve();
    await c;
  });
  it('concurrent duplicate scanner callbacks share one POST; failure releases flight lock for a deliberate recovery', async () => {
    const f = fixture(),
      s = session(),
      core = f.create(),
      gate = deferred<void>(),
      entered = deferred<void>();
    let sends = 0;
    const send = async () => {
      sends++;
      entered.resolve();
      await gate.promise;
      return ok(snapshot(s));
    };
    const a = core.scan({ ...s, token, send });
    await entered.promise;
    const b = core.scan({ ...s, token, send });
    gate.resolve();
    const [one, two] = await Promise.all([a, b]);
    expect(sends).toBe(1);
    expect(one).toEqual(two);
    await expect(
      core.scan({
        ...s,
        token,
        send: async () => {
          throw Error('offline');
        },
      }),
    ).rejects.toThrow();
    expect(
      (await core.recover({ ...s, lookup: async () => ({ status: 200, data: { status: 'unknown' } }) })).status,
    ).toBe('needs_tag');
  });
  it('an older acknowledgement cannot erase a newer pending record', async () => {
    const f = fixture(),
      s = session(),
      core = f.create(),
      gate = deferred<void>(),
      entered = deferred<void>();
    const running = core.scan({
      ...s,
      token,
      send: async () => {
        entered.resolve();
        await gate.promise;
        return ok(snapshot(s));
      },
    });
    await entered.promise;
    const [key, raw] = [...f.disk][0],
      replacement = { ...JSON.parse(raw), requestId: randomUUID() };
    f.disk.set(key, JSON.stringify(replacement));
    gate.resolve();
    await running;
    expect(JSON.parse(f.disk.get(key)!).requestId).toBe(replacement.requestId);
  });
  it('current-shifts refresh failure keeps the proved completed outcome distinct from a retryable mutation failure', async () => {
    const f = fixture(),
      s = session();
    s.refreshCurrent = async () => {
      throw Error('current list unavailable');
    };
    const result = await f.create().scan({ ...s, token, send: async () => ok(snapshot(s)) });
    expect(result.status).toBe('completed');
    expect(result).toMatchObject({ currentRefreshFailed: true });
    expect(f.disk.size).toBe(0);
  });
  it('late completed GET after refresh cannot update the new session via installed MutationObserver success/error/settled callbacks', async () => {
    const f = fixture(),
      a = session(),
      b = session(),
      core = f.create();
    await expect(
      core.scan({
        ...a,
        token,
        send: async () => {
          throw Error('lost');
        },
      }),
    ).rejects.toThrow();
    const entered = deferred<void>(),
      finishRefresh = deferred<void>();
    let active = a;
    a.isCurrent = () => active === a;
    b.isCurrent = () => active === b;
    a.refreshCurrent = async () => {
      entered.resolve();
      await finishRefresh.promise;
    };
    const effects: string[] = [],
      qc = new QueryClient();
    const options = (s: NfcSession) => ({
      mutationFn: () =>
        core.recover({
          ...a,
          lookup: async () => ({ status: 200, data: { status: 'completed', result: snapshot(a) } }),
        }),
      onSuccess: (value: NfcRecoveryOutcome) => {
        if (ownsNfcOutcome(value, s.lease, s.isCurrent)) effects.push('success/cache/navigation');
      },
      onError: (error: Error) => {
        if (ownsNfcOutcome(error, s.lease, s.isCurrent)) effects.push('error');
      },
      onSettled: (value: NfcRecoveryOutcome | undefined, error: Error | null) => {
        if (ownsNfcOutcome(value ?? error, s.lease, s.isCurrent)) effects.push('settled');
      },
    });
    const observer = new MutationObserver(qc, options(a)),
      unsubscribe = observer.subscribe(() => {}),
      running = observer.mutate();
    const rejected = expect(running).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await entered.promise;
    active = b;
    observer.setOptions(options(b));
    finishRefresh.resolve();
    await rejected;
    expect(effects).toEqual([]);
    expect(b.refreshCurrent).not.toHaveBeenCalled();
    unsubscribe();
    qc.clear();
  });
});
