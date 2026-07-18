import {
  commitAuthenticatedSession,
  createSessionEpochRuntime,
  createSessionRecoveryBackoff,
  runSessionRecoveryAttempt,
} from '../authSessionRuntime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('SessionEpochRuntime — behavioural session races', () => {
  it('late login A cannot overwrite a newer login B', async () => {
    const runtime = createSessionEpochRuntime();
    const loginAResponse = deferred<string>();
    const loginBResponse = deferred<string>();
    let committedUser: string | null = null;

    const login = async (response: Promise<string>) => {
      const epoch = runtime.begin();
      const user = await response; // network is deliberately outside commit
      await runtime.commit(epoch, (isCurrent) => {
        if (isCurrent()) committedUser = user;
      });
    };

    const loginA = login(loginAResponse.promise);
    const loginB = login(loginBResponse.promise);
    loginBResponse.resolve('user-B');
    await loginB;
    expect(committedUser).toBe('user-B');

    loginAResponse.resolve('user-A');
    await loginA;
    expect(committedUser).toBe('user-B');
  });

  it('logout started after login A makes A late response a no-op', async () => {
    const runtime = createSessionEpochRuntime();
    const loginResponse = deferred<string>();
    let committedUser: string | null = 'old-user';

    const loginEpoch = runtime.begin();
    const lateLogin = loginResponse.promise.then((nextUser) =>
      runtime.commit(loginEpoch, (isCurrent) => {
        if (isCurrent()) committedUser = nextUser;
      }),
    );

    const logoutEpoch = runtime.begin();
    await runtime.commit(logoutEpoch, (isCurrent) => {
      if (isCurrent()) committedUser = null;
    });
    loginResponse.resolve('late-user-A');
    await lateLogin;

    expect(committedUser).toBeNull();
  });

  it('impersonation commit interrupted by login B cannot publish impersonated user', async () => {
    const runtime = createSessionEpochRuntime();
    const impersonationStorage = deferred<void>();
    let committedUser = 'superadmin';

    const impersonationEpoch = runtime.begin();
    const impersonation = runtime.commit(impersonationEpoch, async (isCurrent) => {
      await impersonationStorage.promise;
      if (isCurrent()) committedUser = 'impersonated-A';
    });
    await flushMicrotasks();

    const loginBEpoch = runtime.begin();
    const loginB = runtime.commit(loginBEpoch, (isCurrent) => {
      if (isCurrent()) committedUser = 'user-B';
    });
    impersonationStorage.resolve();
    await Promise.all([impersonation, loginB]);

    expect(committedUser).toBe('user-B');
  });

  it('401 cleanup pending on native storage is serialised before login B commit', async () => {
    const runtime = createSessionEpochRuntime();
    const tokenRemoval = deferred<void>();
    const writes: string[] = [];
    let committedUser: string | null = 'user-A';

    const expiredEpoch = runtime.begin();
    const cleanup = runtime.commit(expiredEpoch, async (isCurrent) => {
      if (!isCurrent()) return;
      committedUser = null;
      await tokenRemoval.promise; // model AsyncStorage.removeItem crossing native bridge
      writes.push('remove-A');
      if (!isCurrent()) return;
      writes.push('clear-A-cache');
    });
    await flushMicrotasks();

    const loginBEpoch = runtime.begin();
    const loginB = runtime.commit(loginBEpoch, (isCurrent) => {
      if (!isCurrent()) return;
      writes.push('write-B');
      committedUser = 'user-B';
    });
    tokenRemoval.resolve();
    await Promise.all([cleanup, loginB]);

    expect(writes).toEqual(['remove-A', 'write-B']);
    expect(committedUser).toBe('user-B');
  });

  it('new session aborts tracked bootstrap/recovery reads and rejects their commit', async () => {
    const runtime = createSessionEpochRuntime();
    const oldEpoch = runtime.capture();
    const controller = new AbortController();
    runtime.trackAbort(oldEpoch, controller);

    runtime.begin();

    expect(controller.signal.aborted).toBe(true);
    await expect(runtime.commit(oldEpoch, () => undefined)).resolves.toBe(false);
  });

  it('applies the new session in memory immediately but persists it only after tenant disk clears', async () => {
    const runtime = createSessionEpochRuntime();
    const diskClear = deferred<void>();
    const order: string[] = [];
    const epoch = runtime.begin();

    const commit = commitAuthenticatedSession(runtime, epoch, {
      clearPreviousTenant: () => {
        order.push('clear-tenant-memory');
        return diskClear.promise;
      },
      applyInMemory: () => {
        order.push('apply-new-session');
      },
      persist: () => {
        order.push('persist-new-session');
      },
    });
    await flushMicrotasks();

    expect(order).toEqual(['clear-tenant-memory', 'apply-new-session']);
    diskClear.resolve();
    await expect(commit).resolves.toBe(true);
    expect(order).toEqual(['clear-tenant-memory', 'apply-new-session', 'persist-new-session']);
  });

  it('does not persist an obsolete session if another transition starts during tenant disk clear', async () => {
    const runtime = createSessionEpochRuntime();
    const diskClear = deferred<void>();
    const order: string[] = [];
    const epoch = runtime.begin();

    const obsoleteCommit = commitAuthenticatedSession(runtime, epoch, {
      clearPreviousTenant: () => {
        order.push('clear-A-memory');
        return diskClear.promise;
      },
      applyInMemory: () => {
        order.push('apply-A-memory');
      },
      persist: () => {
        order.push('persist-A-disk');
      },
    });
    await flushMicrotasks();

    runtime.begin();
    diskClear.resolve();
    await expect(obsoleteCommit).resolves.toBe(false);
    expect(order).toEqual(['clear-A-memory', 'apply-A-memory']);
  });

  it('keeps durable auth unchanged when previous-tenant disk clear fails', async () => {
    const runtime = createSessionEpochRuntime();
    const order: string[] = [];
    const epoch = runtime.begin();

    const commit = commitAuthenticatedSession(runtime, epoch, {
      clearPreviousTenant: () => {
        order.push('clear-tenant-memory');
        return Promise.reject(new Error('native storage failure'));
      },
      applyInMemory: () => {
        order.push('apply-new-session');
      },
      persist: () => {
        order.push('persist-new-session');
      },
    });

    await expect(commit).resolves.toBe(true);
    expect(order).toEqual(['clear-tenant-memory', 'apply-new-session']);
  });

  it('a never-resolving stale persistence commit cannot deadlock newer login', async () => {
    jest.useFakeTimers();
    const runtime = createSessionEpochRuntime({ commitTimeoutMs: 50 });
    const never = new Promise<void>(() => {});
    let committedUser: string | null = null;

    const staleEpoch = runtime.begin();
    const staleCommit = runtime.commit(staleEpoch, async () => never);
    await flushMicrotasks();

    const loginBEpoch = runtime.begin();
    const loginBCommit = runtime.commit(loginBEpoch, (isCurrent) => {
      if (isCurrent()) committedUser = 'user-B';
    });
    await jest.advanceTimersByTimeAsync(50);
    await loginBCommit;

    expect(committedUser).toBe('user-B');
    await expect(staleCommit).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('recovery failures use capped exponential cooldown and success resets it', () => {
    let now = 1_000;
    const backoff = createSessionRecoveryBackoff([2_000, 5_000, 15_000], () => now);

    expect(backoff.recordFailure()).toBe(2_000);
    expect(backoff.remainingMs()).toBe(2_000);
    now += 2_000;
    expect(backoff.remainingMs()).toBe(0);
    expect(backoff.recordFailure()).toBe(5_000);
    now += 5_000;
    expect(backoff.recordFailure()).toBe(15_000);
    now += 15_000;
    expect(backoff.recordFailure()).toBe(15_000); // capped

    backoff.reset();
    expect(backoff.remainingMs()).toBe(0);
    expect(backoff.recordFailure()).toBe(2_000);
  });

  it('manual recovery reselects a dead active route before loading /me from reserve', async () => {
    let activeRoute = 'dead-primary';
    const order: string[] = [];

    const recovered = await runSessionRecoveryAttempt({
      forceFreshRoute: true,
      reselectRoute: async (forceFreshRoute) => {
        order.push(`reselect:${String(forceFreshRoute)}`);
        activeRoute = 'healthy-reserve';
      },
      isCurrent: () => true,
      loadUser: async () => {
        order.push(`me:${activeRoute}`);
        if (activeRoute === 'dead-primary') throw new Error('dead route');
        return 'user-B';
      },
    });

    expect(recovered).toBe('user-B');
    expect(order).toEqual(['reselect:true', 'me:healthy-reserve']);
  });

  it('automatic recovery consumes route-ready evidence without self-reselecting', async () => {
    const reselectRoute = jest.fn(async () => 'unused');

    await expect(
      runSessionRecoveryAttempt({
        forceFreshRoute: false,
        reselectRoute,
        isCurrent: () => true,
        loadUser: async () => 'user-B',
      }),
    ).resolves.toBe('user-B');
    expect(reselectRoute).not.toHaveBeenCalled();
  });
});
