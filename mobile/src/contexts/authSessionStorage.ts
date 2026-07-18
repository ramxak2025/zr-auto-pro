export const AUTH_SESSION_ENVELOPE_KEY = 'auth_session_v1';
export const LEGACY_TOKEN_KEY = 'token';
export const LEGACY_USER_KEY = 'user';
export const LEGACY_IMPERSONATING_KEY = 'impersonating';

export interface StoredAuthSession<TUser> {
  token: string | null;
  user: TUser | null;
  impersonating: boolean;
}

interface SessionEnvelope<TUser> extends StoredAuthSession<TUser> {
  v: 1;
  generation: number;
}

export interface ParsedAuthSessionEnvelope {
  v: 1;
  generation: number;
  token: string | null;
  user: unknown;
  impersonating: boolean;
}

/** Shared strict v1 parser used by AuthContext and the axios cold token read. */
export function parseAuthSessionEnvelope(raw: string | null): ParsedAuthSessionEnvelope | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ParsedAuthSessionEnvelope>;
    if (value.v !== 1 || !Number.isSafeInteger(value.generation) || (value.generation ?? -1) < 0) return null;
    if (value.token !== null && typeof value.token !== 'string') return null;
    if (typeof value.impersonating !== 'boolean') return null;
    return {
      v: 1,
      generation: value.generation as number,
      token: value.token,
      user: value.user,
      impersonating: value.impersonating,
    };
  } catch {
    return null;
  }
}

interface AsyncKeyValueStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
  removeItem: (key: string) => Promise<unknown>;
}

interface AuthSessionStorageOptions<TUser> {
  isUser: (value: unknown) => value is TUser;
  writeWaitMs?: number;
  /** Backoff for transient native failures; finite by design. */
  repairRetryDelaysMs?: readonly number[];
  /** A hung current-generation write is treated as retryable after this. */
  repairAttemptTimeoutMs?: number;
}

export interface AuthSessionStorage<TUser> {
  read: () => Promise<StoredAuthSession<TUser>>;
  write: (session: StoredAuthSession<TUser>) => Promise<void>;
}

const LOGGED_OUT = { token: null, user: null, impersonating: false } as const;
const DEFAULT_WRITE_WAIT_MS = 750;
const DEFAULT_REPAIR_ATTEMPT_TIMEOUT_MS = 750;
const DEFAULT_REPAIR_RETRY_DELAYS_MS: readonly number[] = [50, 250, 1_000];

function boundedWait(work: Promise<unknown>, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    void work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * A single authoritative versioned envelope plus legacy mirrors. Writes may
 * overlap because the RN bridge can hang. Every stale physical completion
 * schedules a repair with the newest desired envelope, so A finishing after B
 * can only be a temporary disk state and never the final one.
 */
export function createAuthSessionStorage<TUser>(
  storage: AsyncKeyValueStorage,
  options: AuthSessionStorageOptions<TUser>,
): AuthSessionStorage<TUser> {
  let generation = 0;
  let mutationRevision = 0;
  let desired: SessionEnvelope<TUser> | null = null;
  let immediateRepairScheduled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryGeneration = -1;
  let retriesLaunched = 0;
  const waitMs = options.writeWaitMs ?? DEFAULT_WRITE_WAIT_MS;
  const repairAttemptTimeoutMs = options.repairAttemptTimeoutMs ?? DEFAULT_REPAIR_ATTEMPT_TIMEOUT_MS;
  const repairRetryDelaysMs = options.repairRetryDelaysMs ?? DEFAULT_REPAIR_RETRY_DELAYS_MS;

  const parseEnvelope = (raw: string | null): SessionEnvelope<TUser> | null => {
    const value = parseAuthSessionEnvelope(raw);
    if (!value) return null;
    const user = options.isUser(value.user) ? value.user : null;
    return {
      v: 1,
      generation: value.generation,
      token: value.token,
      user: value.token ? user : null,
      impersonating: value.token ? value.impersonating : false,
    };
  };

  const rawOperation = (key: string, value: string | null, ownerGeneration: number): Promise<unknown> => {
    let operation: Promise<unknown>;
    try {
      operation = value === null ? storage.removeItem(key) : storage.setItem(key, value);
    } catch (error) {
      operation = Promise.reject(error);
    }
    void operation.then(
      () => {
        if (desired && desired.generation !== ownerGeneration) scheduleImmediateRepair();
      },
      () => {
        if (!desired) return;
        if (desired.generation !== ownerGeneration) scheduleImmediateRepair();
        else scheduleCurrentRetry(ownerGeneration);
      },
    );
    return operation;
  };

  const launchWrite = (snapshot: SessionEnvelope<TUser>): Promise<void> => {
    const userJson = snapshot.user ? JSON.stringify(snapshot.user) : null;
    const operations = [
      rawOperation(AUTH_SESSION_ENVELOPE_KEY, JSON.stringify(snapshot), snapshot.generation),
      rawOperation(LEGACY_TOKEN_KEY, snapshot.token, snapshot.generation),
      rawOperation(LEGACY_USER_KEY, userJson, snapshot.generation),
      rawOperation(LEGACY_IMPERSONATING_KEY, snapshot.impersonating ? '1' : null, snapshot.generation),
    ];
    const settled = Promise.allSettled(operations);
    const deadline = setTimeout(() => {
      if (desired?.generation === snapshot.generation) scheduleCurrentRetry(snapshot.generation);
    }, Math.max(1, repairAttemptTimeoutMs));
    void settled.then((results) => {
      clearTimeout(deadline);
      if (desired?.generation !== snapshot.generation) return;
      if (results.every((result) => result.status === 'fulfilled')) {
        retriesLaunched = 0;
        retryGeneration = snapshot.generation;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
      } else {
        scheduleCurrentRetry(snapshot.generation);
      }
    });
    return settled.then(() => undefined);
  };

  function scheduleImmediateRepair(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (immediateRepairScheduled) return;
    immediateRepairScheduled = true;
    queueMicrotask(() => {
      immediateRepairScheduled = false;
      if (desired) void launchWrite(desired);
    });
  }

  function scheduleCurrentRetry(ownerGeneration: number): void {
    if (desired?.generation !== ownerGeneration || immediateRepairScheduled) return;
    if (retryGeneration !== ownerGeneration) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryGeneration = ownerGeneration;
      retriesLaunched = 0;
    }
    if (retryTimer || retriesLaunched >= repairRetryDelaysMs.length) return;
    const delay = Math.max(0, repairRetryDelaysMs[retriesLaunched] ?? 0);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (desired?.generation !== ownerGeneration) return;
      retriesLaunched += 1;
      void launchWrite(desired);
    }, delay);
  }

  const write = (session: StoredAuthSession<TUser>): Promise<void> => {
    mutationRevision += 1;
    generation += 1;
    const snapshot: SessionEnvelope<TUser> = {
      v: 1,
      generation,
      token: session.token,
      user: session.token ? session.user : null,
      impersonating: !!session.token && session.impersonating,
    };
    desired = snapshot;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryGeneration = snapshot.generation;
    retriesLaunched = 0;
    return boundedWait(launchWrite(snapshot), waitMs);
  };

  const read = async (): Promise<StoredAuthSession<TUser>> => {
    const readRevision = mutationRevision;
    const envelope = parseEnvelope(await storage.getItem(AUTH_SESSION_ENVELOPE_KEY).catch(() => null));
    if (envelope) {
      if (readRevision !== mutationRevision) {
        return { token: envelope.token, user: envelope.user, impersonating: envelope.impersonating };
      }
      generation = Math.max(generation, envelope.generation);
      desired = envelope;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryGeneration = envelope.generation;
      retriesLaunched = 0;
      // Repair legacy mirrors for old OTA/native builds without delaying boot.
      void launchWrite(envelope);
      return { token: envelope.token, user: envelope.user, impersonating: envelope.impersonating };
    }

    // Upgrade path for builds that only wrote token/user/impersonating.
    const [token, rawUser, impersonating] = await Promise.all([
      storage.getItem(LEGACY_TOKEN_KEY).catch(() => null),
      storage.getItem(LEGACY_USER_KEY).catch(() => null),
      storage.getItem(LEGACY_IMPERSONATING_KEY).catch(() => null),
    ]);
    let user: TUser | null = null;
    try {
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (options.isUser(parsed)) user = parsed;
    } catch {
      user = null;
    }
    const legacy = token
      ? { token, user, impersonating: impersonating === '1' }
      : { ...LOGGED_OUT };
    // A login/logout that started while this native read was pending owns the
    // newer desired state. Return the stale read to its epoch-guarded caller,
    // but perform absolutely no migration/repair side effects.
    if (readRevision !== mutationRevision) return legacy;
    // Non-blocking migration. The envelope is authoritative on the next boot.
    void write(legacy);
    return legacy;
  };

  return { read, write };
}
