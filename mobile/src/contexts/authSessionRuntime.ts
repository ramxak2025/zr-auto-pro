/**
 * Serialises authenticated-session commits without serialising their network
 * requests. Every login/logout/impersonation start advances an epoch
 * immediately; a response from an older epoch is then unable to commit.
 */
export interface SessionEpochRuntime {
  capture: () => number;
  begin: () => number;
  isCurrent: (epoch: number) => boolean;
  trackAbort: (epoch: number, controller: AbortController) => () => void;
  commit: (
    epoch: number,
    operation: (isCurrent: () => boolean) => void | Promise<void>,
  ) => Promise<boolean>;
}

export interface AuthenticatedSessionCommitPlan {
  /**
   * Must revoke tenant-scoped in-memory work synchronously, then resolve only
   * after the previous tenant's durable queue/cache state has been cleared.
   */
  clearPreviousTenant: () => void | Promise<void>;
  /** Critical bearer/user React state; must not await native persistence. */
  applyInMemory: () => void;
  /** Best-effort token/user persistence after the durable tenant clear. */
  persist: (isCurrent: () => boolean) => void | Promise<void>;
}

export interface SessionRecoveryBackoff {
  remainingMs: () => number;
  recordFailure: () => number;
  reset: () => void;
}

export interface SessionRecoveryAttemptPlan<T> {
  forceFreshRoute: boolean;
  reselectRoute: (forceFreshRoute: boolean) => Promise<unknown>;
  isCurrent: () => boolean;
  loadUser: () => Promise<T>;
}

/**
 * Manual recovery first invalidates the route learned on the previous native
 * network. Automatic recovery is already triggered by positive route/request
 * evidence, so it deliberately skips reselection (avoids route-ready loops).
 */
export async function runSessionRecoveryAttempt<T>(plan: SessionRecoveryAttemptPlan<T>): Promise<T | null> {
  if (plan.forceFreshRoute) {
    try {
      await plan.reselectRoute(true);
    } catch {
      // The normal request still owns full ring traversal and may recover.
    }
  }
  if (!plan.isCurrent()) return null;
  return plan.loadUser();
}

export function createSessionRecoveryBackoff(
  delaysMs: readonly number[],
  now: () => number = Date.now,
): SessionRecoveryBackoff {
  let failures = 0;
  let notBefore = 0;
  return {
    remainingMs: () => Math.max(0, notBefore - now()),
    recordFailure: () => {
      const index = Math.min(failures, Math.max(0, delaysMs.length - 1));
      const delay = delaysMs[index] ?? 0;
      failures += 1;
      notBefore = now() + delay;
      return delay;
    },
    reset: () => {
      failures = 0;
      notBefore = 0;
    },
  };
}

interface SessionEpochRuntimeOptions {
  /** Releases the queue even if a native persistence operation never settles. */
  commitTimeoutMs?: number;
}

const DEFAULT_COMMIT_TIMEOUT_MS = 3_000;

export function createSessionEpochRuntime(options: SessionEpochRuntimeOptions = {}): SessionEpochRuntime {
  const commitTimeoutMs = options.commitTimeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS;
  let epoch = 0;
  let commitTail: Promise<void> = Promise.resolve();
  const aborts = new Map<AbortController, number>();

  const isCurrent = (candidate: number) => candidate === epoch;

  const begin = () => {
    epoch += 1;
    for (const [controller, ownerEpoch] of aborts) {
      if (ownerEpoch !== epoch) {
        controller.abort();
        aborts.delete(controller);
      }
    }
    return epoch;
  };

  const trackAbort = (ownerEpoch: number, controller: AbortController) => {
    if (!isCurrent(ownerEpoch)) {
      controller.abort();
      return () => {};
    }
    aborts.set(controller, ownerEpoch);
    return () => {
      aborts.delete(controller);
    };
  };

  const commit: SessionEpochRuntime['commit'] = (ownerEpoch, operation) => {
    let committed = false;
    let operationError: unknown;
    const unboundedRun = commitTail
      .catch(() => {})
      .then(async () => {
        if (!isCurrent(ownerEpoch)) return;
        await operation(() => isCurrent(ownerEpoch));
        committed = isCurrent(ownerEpoch);
      })
      .catch((error) => {
        operationError = error;
      });
    const run = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, commitTimeoutMs);
      void unboundedRun.finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Timeout or failure releases the tail: a wedged AsyncStorage bridge in
    // token A must never hold login/logout token B forever. The old operation
    // may eventually resume, so callers still re-check isCurrent after every
    // await before touching state.
    commitTail = run;
    return run.then(() => {
      if (operationError !== undefined) throw operationError;
      return committed;
    });
  };

  return {
    capture: () => epoch,
    begin,
    isCurrent,
    trackAbort,
    commit,
  };
}

/**
 * Shared login/impersonation commit ordering. Tenant memory is revoked before
 * applying the new bearer, so no old queued work can use it. The new session
 * reaches durable auth storage only after the old tenant's durable queue/cache
 * clear resolves; a process kill can therefore never leave token B beside
 * tenant A's persisted data.
 */
export async function commitAuthenticatedSession(
  runtime: SessionEpochRuntime,
  epoch: number,
  plan: AuthenticatedSessionCommitPlan,
): Promise<boolean> {
  let applied = false;
  await runtime.commit(epoch, async (isCurrent) => {
    if (!isCurrent()) return;
    let tenantClear: Promise<boolean>;
    try {
      tenantClear = Promise.resolve(plan.clearPreviousTenant()).then(
        () => true,
        () => false,
      );
    } catch {
      tenantClear = Promise.resolve(false);
    }
    if (!isCurrent()) return;
    plan.applyInMemory();
    applied = true;

    // Do not advance durable auth state unless every previous-tenant durable
    // clear completed. A failed clear leaves the old disk session intact and
    // consistent; the newly applied in-memory session remains usable.
    const tenantCleared = await tenantClear;
    if (!tenantCleared || !isCurrent()) return;
    try {
      await plan.persist(isCurrent);
    } catch {
      // Persistence is best-effort; the in-memory session is already valid.
    }
  });
  return applied && runtime.isCurrent(epoch);
}
