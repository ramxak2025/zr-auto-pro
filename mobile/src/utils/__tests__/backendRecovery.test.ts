// Hermetic unit: mock the only runtime import so the controller is tested in
// isolation under the node jest env (no react-query / react-native runtime).
jest.mock('@tanstack/react-query', () => ({ onlineManager: { isOnline: () => true } }));

import {
  createRecoveryController,
  isRecoverableErrored,
  PROBE_BACKOFF_MS,
  type RecoveryDeps,
} from '../backendRecovery';

interface HarnessState {
  errored: boolean;
  online: boolean;
  time: number;
  healthy: boolean;
  refetchCount: number;
  probeHook?: () => void;
}

function makeHarness(init: Partial<HarnessState> = {}) {
  const state: HarnessState = {
    errored: true,
    online: true,
    time: 0,
    healthy: false,
    refetchCount: 0,
    ...init,
  };
  const scheduled: Array<{ id: number; fn: () => void; ms: number }> = [];
  let nextId = 1;

  const deps: RecoveryDeps = {
    hasErroredQueries: () => state.errored,
    isOnline: () => state.online,
    now: () => state.time,
    refetchErrored: () => {
      state.refetchCount += 1;
    },
    probeHealth: async () => {
      state.probeHook?.();
      return state.healthy;
    },
    scheduleTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.push({ id, fn: fn as () => void, ms });
      return id;
    },
    clearScheduled: (h) => {
      const i = scheduled.findIndex((s) => s.id === h);
      if (i >= 0) scheduled.splice(i, 1);
    },
  };

  const controller = createRecoveryController(deps);

  // Pop and run the single pending scheduled callback (FIFO), awaiting the
  // async tick + a microtask flush so any reschedule lands before we assert.
  async function runPending(): Promise<number | null> {
    const next = scheduled.shift();
    if (!next) return null;
    await next.fn();
    await Promise.resolve();
    return next.ms;
  }

  return { state, scheduled, controller, runPending };
}

describe('isRecoverableErrored', () => {
  const net = new Error('Нет соединения с сервером'); // no .response → transient
  const e502 = { response: { status: 502 } };
  const e500 = { response: { status: 500 } };
  const e403 = { response: { status: 403 } };
  const e404 = { response: { status: 404 } };

  it('recovers an active, transiently-errored query (network / 5xx)', () => {
    expect(isRecoverableErrored('error', true, net)).toBe(true);
    expect(isRecoverableErrored('error', true, e502)).toBe(true);
    expect(isRecoverableErrored('error', true, e500)).toBe(true);
  });

  it('does NOT recover a deterministic 4xx (403/404) even when active', () => {
    expect(isRecoverableErrored('error', true, e403)).toBe(false);
    expect(isRecoverableErrored('error', true, e404)).toBe(false);
  });

  it('does NOT recover an inactive (disabled/unmounted) query', () => {
    expect(isRecoverableErrored('error', false, e502)).toBe(false);
  });

  it('does NOT recover a non-error query', () => {
    expect(isRecoverableErrored('success', true, undefined)).toBe(false);
    expect(isRecoverableErrored('pending', true, undefined)).toBe(false);
  });
});

describe('createRecoveryController', () => {
  it('probes on first backoff and refetches on a healthy backend, then stops', async () => {
    const h = makeHarness({ healthy: true });
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(PROBE_BACKOFF_MS[0]);

    await h.runPending();
    expect(h.state.refetchCount).toBe(1);
    expect(h.scheduled).toHaveLength(0); // stopped — relies on re-trigger
  });

  it('does NOT probe when offline', () => {
    const h = makeHarness({ online: false });
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(0);
  });

  it('does NOT probe when nothing is errored', () => {
    const h = makeHarness({ errored: false });
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(0);
  });

  it('backs off 2s → 4s → 8s → 8s while the backend stays down', async () => {
    const h = makeHarness({ healthy: false });
    h.controller.trigger();
    expect(h.scheduled[0].ms).toBe(2_000);

    await h.runPending();
    expect(h.scheduled[0].ms).toBe(4_000);
    await h.runPending();
    expect(h.scheduled[0].ms).toBe(8_000);
    await h.runPending();
    expect(h.scheduled[0].ms).toBe(8_000); // capped
    expect(h.state.refetchCount).toBe(0);
  });

  it('stops without refetch if the error clears before the probe', async () => {
    const h = makeHarness({ healthy: true });
    h.controller.trigger();
    h.state.errored = false; // healed elsewhere (e.g. the 30s poll)
    await h.runPending();
    expect(h.state.refetchCount).toBe(0);
    expect(h.scheduled).toHaveLength(0);
  });

  it('aborts the refetch if the device goes offline mid-probe', async () => {
    const h = makeHarness({ healthy: true });
    h.state.probeHook = () => {
      h.state.online = false; // lost connectivity during the /health call
    };
    h.controller.trigger();
    await h.runPending();
    expect(h.state.refetchCount).toBe(0);
    expect(h.scheduled).toHaveLength(0);
  });

  it('ignores re-triggers while already probing (single loop)', () => {
    const h = makeHarness({ healthy: false });
    h.controller.trigger();
    h.controller.trigger();
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
  });

  it('applies a cooldown after a recovery refetch, then re-arms', async () => {
    const h = makeHarness({ healthy: true });
    h.controller.trigger();
    await h.runPending();
    expect(h.state.refetchCount).toBe(1);

    // Still erroring (refetch in flight); a re-trigger inside the cooldown is
    // ignored so we don't hammer a backend we just confirmed healthy.
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(0);

    // Once the cooldown elapses, a fresh error event re-arms the loop.
    h.state.time = 4_000;
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
  });

  it('stop() cancels a pending probe', () => {
    const h = makeHarness({ healthy: false });
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
    h.controller.stop();
    expect(h.scheduled).toHaveLength(0);
  });
});
