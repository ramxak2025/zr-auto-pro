import {
  AUTH_SESSION_ENVELOPE_KEY,
  LEGACY_IMPERSONATING_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_USER_KEY,
  createAuthSessionStorage,
  parseAuthSessionEnvelope,
} from '../authSessionStorage';

interface TestUser {
  id: string;
  name: string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

const isUser = (value: unknown): value is TestUser =>
  !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';

describe('versioned auth-session storage', () => {
  it('strictly parses the shared versioned envelope schema', () => {
    expect(
      parseAuthSessionEnvelope(
        JSON.stringify({ v: 1, generation: 3, token: null, user: null, impersonating: false }),
      ),
    ).toEqual({ v: 1, generation: 3, token: null, user: null, impersonating: false });
    expect(parseAuthSessionEnvelope(JSON.stringify({ v: 1, token: 'A', impersonating: false }))).toBeNull();
    expect(
      parseAuthSessionEnvelope(JSON.stringify({ v: 1, generation: -1, token: 'A', impersonating: false })),
    ).toBeNull();
    expect(
      parseAuthSessionEnvelope(JSON.stringify({ v: 1, generation: 2, token: 42, impersonating: false })),
    ).toBeNull();
  });

  it('repairs B after an older physical A write completes last', async () => {
    const values = new Map<string, string>();
    const envelopeWrites: Array<{ value: string; done: ReturnType<typeof deferred> }> = [];
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key !== AUTH_SESSION_ENVELOPE_KEY) {
          values.set(key, value);
          return Promise.resolve();
        }
        const done = deferred();
        envelopeWrites.push({ value, done });
        return done.promise.then(() => {
          values.set(key, value);
        });
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const sessions = createAuthSessionStorage<TestUser>(storage, { isUser, writeWaitMs: 5_000 });

    const writeA = sessions.write({ token: 'token-A', user: { id: 'A', name: 'A' }, impersonating: false });
    const writeB = sessions.write({ token: 'token-B', user: { id: 'B', name: 'B' }, impersonating: false });
    expect(envelopeWrites).toHaveLength(2);

    envelopeWrites[1].done.resolve();
    await flush();
    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-B');

    // Stale legacy-key completions from A may already have requested a B
    // repair. Let every such repair land before the deliberately late A
    // envelope, so the test proves that A's own completion causes a fresh
    // repair instead of merely benefiting from an earlier queued write.
    const repairsBeforeLateA = envelopeWrites.length;
    for (let i = 2; i < repairsBeforeLateA; i += 1) {
      expect(JSON.parse(envelopeWrites[i].value).token).toBe('token-B');
      envelopeWrites[i].done.resolve();
    }
    await flush();

    // A lands physically after B and temporarily overwrites it.
    envelopeWrites[0].done.resolve();
    await flush();
    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-A');
    expect(envelopeWrites.length).toBeGreaterThan(repairsBeforeLateA);

    // A stale physical completion must enqueue only current-generation data.
    // Resolve all coalesced repairs; the list is intentionally treated as
    // dynamic because independent legacy-key completions can request one too.
    for (let i = repairsBeforeLateA; i < envelopeWrites.length; i += 1) {
      expect(JSON.parse(envelopeWrites[i].value).token).toBe('token-B');
      envelopeWrites[i].done.resolve();
      await flush();
    }
    await Promise.all([writeA, writeB]);
    await flush();

    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-B');
    expect(values.get(LEGACY_TOKEN_KEY)).toBe('token-B');
    expect(JSON.parse(values.get(LEGACY_USER_KEY)!).id).toBe('B');
  });

  it('retries a failed current B repair after late A and converges to B', async () => {
    jest.useFakeTimers();
    try {
      const values = new Map<string, string>();
      const envelopeWrites: Array<{ value: string; done: ReturnType<typeof deferred> }> = [];
      const storage = {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key !== AUTH_SESSION_ENVELOPE_KEY) {
            values.set(key, value);
            return Promise.resolve();
          }
          const done = deferred();
          envelopeWrites.push({ value, done });
          return done.promise.then(() => {
            values.set(key, value);
          });
        },
        removeItem: async (key: string) => {
          values.delete(key);
        },
      };
      const sessions = createAuthSessionStorage<TestUser>(storage, {
        isUser,
        writeWaitMs: 5_000,
        repairAttemptTimeoutMs: 1_000,
        repairRetryDelaysMs: [25, 100],
      });

      const writeA = sessions.write({ token: 'token-A', user: { id: 'A', name: 'A' }, impersonating: false });
      const writeB = sessions.write({ token: 'token-B', user: { id: 'B', name: 'B' }, impersonating: false });
      envelopeWrites[1].done.resolve();
      await flush();

      // Drain any B repair requested by A's already-settled legacy mirrors.
      const repairsBeforeLateA = envelopeWrites.length;
      for (let i = 2; i < repairsBeforeLateA; i += 1) envelopeWrites[i].done.resolve();
      await flush();

      envelopeWrites[0].done.resolve(); // physical A overwrite
      await flush();
      expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-A');

      const failedRepairIndex = envelopeWrites.length - 1;
      expect(JSON.parse(envelopeWrites[failedRepairIndex].value).token).toBe('token-B');
      envelopeWrites[failedRepairIndex].done.reject(new Error('transient native write failure'));
      await flush();

      await jest.advanceTimersByTimeAsync(25);
      const retryIndex = envelopeWrites.length - 1;
      expect(retryIndex).toBeGreaterThan(failedRepairIndex);
      expect(JSON.parse(envelopeWrites[retryIndex].value).token).toBe('token-B');
      envelopeWrites[retryIndex].done.resolve();
      await flush();
      await Promise.all([writeA, writeB]);

      expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-B');
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps current-generation repair retries and leaves no recurring timer', async () => {
    jest.useFakeTimers();
    try {
      const values = new Map<string, string>([
        [
          AUTH_SESSION_ENVELOPE_KEY,
          JSON.stringify({ v: 1, generation: 1, token: 'token-A', user: { id: 'A' }, impersonating: false }),
        ],
      ]);
      let envelopeAttempts = 0;
      const storage = {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === AUTH_SESSION_ENVELOPE_KEY) {
            envelopeAttempts += 1;
            return Promise.reject(new Error('disk unavailable'));
          }
          values.set(key, value);
          return Promise.resolve();
        },
        removeItem: async (key: string) => {
          values.delete(key);
        },
      };
      const sessions = createAuthSessionStorage<TestUser>(storage, {
        isUser,
        writeWaitMs: 1_000,
        repairAttemptTimeoutMs: 500,
        repairRetryDelaysMs: [10, 20],
      });

      await sessions.write({ token: 'token-B', user: { id: 'B', name: 'B' }, impersonating: false });
      await flush();
      expect(envelopeAttempts).toBe(1);

      await jest.advanceTimersByTimeAsync(10);
      expect(envelopeAttempts).toBe(2);
      await jest.advanceTimersByTimeAsync(20);
      expect(envelopeAttempts).toBe(3);
      await jest.advanceTimersByTimeAsync(5_000);

      expect(envelopeAttempts).toBe(3);
      expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-A');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('authoritative logout tombstone wins over stale legacy keys', async () => {
    const values = new Map<string, string>([
      [AUTH_SESSION_ENVELOPE_KEY, JSON.stringify({ v: 1, generation: 7, token: null, user: null, impersonating: false })],
      [LEGACY_TOKEN_KEY, 'stale-token-A'],
      [LEGACY_USER_KEY, JSON.stringify({ id: 'A', name: 'A' })],
      [LEGACY_IMPERSONATING_KEY, '1'],
    ]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const sessions = createAuthSessionStorage<TestUser>(storage, { isUser });

    await expect(sessions.read()).resolves.toEqual({ token: null, user: null, impersonating: false });
    await flush();
    expect(values.has(LEGACY_TOKEN_KEY)).toBe(false);
    expect(values.has(LEGACY_USER_KEY)).toBe(false);
    expect(values.has(LEGACY_IMPERSONATING_KEY)).toBe(false);
  });

  it('reads and migrates legacy cold-start keys when no envelope exists', async () => {
    const values = new Map<string, string>([
      [LEGACY_TOKEN_KEY, 'legacy-token'],
      [LEGACY_USER_KEY, JSON.stringify({ id: 'legacy', name: 'Legacy' })],
      [LEGACY_IMPERSONATING_KEY, '1'],
    ]);
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const sessions = createAuthSessionStorage<TestUser>(storage, { isUser });

    await expect(sessions.read()).resolves.toEqual({
      token: 'legacy-token',
      user: { id: 'legacy', name: 'Legacy' },
      impersonating: true,
    });
    await flush();
    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('legacy-token');
  });

  it('delayed envelope read A has no side effects after write B starts', async () => {
    const delayedEnvelope = deferred();
    const staleA = JSON.stringify({
      v: 1,
      generation: 4,
      token: 'token-A',
      user: { id: 'A', name: 'A' },
      impersonating: false,
    });
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) =>
        key === AUTH_SESSION_ENVELOPE_KEY
          ? delayedEnvelope.promise.then(() => staleA)
          : Promise.resolve(values.get(key) ?? null),
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const sessions = createAuthSessionStorage<TestUser>(storage, { isUser });

    const oldRead = sessions.read();
    await sessions.write({ token: 'token-B', user: { id: 'B', name: 'B' }, impersonating: false });
    delayedEnvelope.resolve();
    await oldRead;
    await flush();

    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-B');
    expect(values.get(LEGACY_TOKEN_KEY)).toBe('token-B');
  });

  it('delayed legacy migration A cannot overwrite write B', async () => {
    const legacyToken = deferred();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string): Promise<string | null> => {
        if (key === AUTH_SESSION_ENVELOPE_KEY) return Promise.resolve(null);
        if (key === LEGACY_TOKEN_KEY) return legacyToken.promise.then(() => 'token-A');
        if (key === LEGACY_USER_KEY) return Promise.resolve(JSON.stringify({ id: 'A', name: 'A' }));
        return Promise.resolve(null);
      },
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: async (key: string) => {
        values.delete(key);
      },
    };
    const sessions = createAuthSessionStorage<TestUser>(storage, { isUser });

    const oldRead = sessions.read();
    await flush();
    await sessions.write({ token: 'token-B', user: { id: 'B', name: 'B' }, impersonating: false });
    legacyToken.resolve();
    await oldRead;
    await flush();

    expect(JSON.parse(values.get(AUTH_SESSION_ENVELOPE_KEY)!).token).toBe('token-B');
    expect(values.get(LEGACY_TOKEN_KEY)).toBe('token-B');
  });
});
