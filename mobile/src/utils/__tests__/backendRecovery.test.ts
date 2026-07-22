// Hermetic unit: mock the only runtime import so the controller is tested in
// isolation under the node jest env (no react-query / react-native runtime).
jest.mock('@tanstack/react-query', () => ({ onlineManager: { isOnline: () => true } }));
jest.mock('../../api/axios', () => ({ reselectApiHost: jest.fn() }));

import { reselectApiHost } from '../../api/axios';

import {
  createApiRouteRecoveryController,
  createRecoveryController,
  getNetworkRouteSignature,
  isRecoverableErrored,
  probeApiRing,
  PROBE_BACKOFF_MS,
  type RecoveryDeps,
} from '../backendRecovery';

const mockReselectApiHost = reselectApiHost as jest.MockedFunction<typeof reselectApiHost>;

interface HarnessState {
  errored: boolean;
  online: boolean;
  time: number;
  healthy: boolean;
  refetchCount: number;
  refetchHook?: () => void;
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
      state.refetchHook?.();
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

describe('getNetworkRouteSignature', () => {
  const wifi = {
    isConnected: true,
    type: 'wifi',
    isInternetReachable: true,
    details: {
      isConnectionExpensive: false,
      ssid: 'ZR-AUTO',
      bssid: 'aa:bb:cc:dd:ee:ff',
      ipAddress: '192.168.1.20',
      subnet: '255.255.255.0',
      strength: 80,
      linkSpeed: 433,
    },
  };

  it('ignores noisy reachability/radio telemetry when the route is unchanged', () => {
    const noisyUpdate = {
      ...wifi,
      isInternetReachable: false,
      details: { ...wifi.details, strength: 25, linkSpeed: 72 },
    };
    expect(getNetworkRouteSignature(noisyUpdate)).toBe(getNetworkRouteSignature(wifi));
  });

  it.each([
    ['connectivity', { ...wifi, isConnected: false, details: null }],
    ['network type', { ...wifi, type: 'vpn' }],
    ['Wi-Fi identity', { ...wifi, details: { ...wifi.details, ssid: 'Mobile hotspot' } }],
    ['local route', { ...wifi, details: { ...wifi.details, ipAddress: '10.0.0.7' } }],
    [
      'carrier route',
      {
        ...wifi,
        type: 'cellular',
        details: { isConnectionExpensive: true, carrier: 'Megafon', cellularGeneration: '5g' },
      },
    ],
  ])('changes for a meaningful %s change', (_label, next) => {
    expect(getNetworkRouteSignature(next)).not.toBe(getNetworkRouteSignature(wifi));
  });
});

describe('createApiRouteRecoveryController', () => {
  const wifi = {
    isConnected: true,
    type: 'wifi',
    details: {
      isConnectionExpensive: false,
      ssid: 'ZR-AUTO',
      bssid: 'aa:bb:cc:dd:ee:ff',
      ipAddress: '192.168.1.20',
      subnet: '255.255.255.0',
      strength: 80,
    },
  };

  it('reselects only for meaningful NetInfo route changes and reconnect', () => {
    const reselect = jest
      .fn<Promise<string | null>, [forceFreshRoute?: boolean]>()
      .mockResolvedValue('https://autexa.pw/api');
    const controller = createApiRouteRecoveryController({ initialAppState: 'active', reselect });

    controller.onNetworkState(wifi); // initial listener snapshot = baseline
    controller.onNetworkState({ ...wifi, details: { ...wifi.details, strength: 20 } });
    expect(reselect).not.toHaveBeenCalled();

    controller.onNetworkState({ ...wifi, details: { ...wifi.details, ssid: 'Mobile hotspot' } });
    expect(reselect).toHaveBeenCalledTimes(1);
    expect(reselect).toHaveBeenLastCalledWith(true);

    controller.onNetworkState({ isConnected: false, type: 'none', details: null });
    expect(reselect).toHaveBeenCalledTimes(1); // no pointless probe offline
    controller.onNetworkState({
      isConnected: true,
      type: 'cellular',
      details: { isConnectionExpensive: true, carrier: 'Megafon', cellularGeneration: '5g' },
    });
    expect(reselect).toHaveBeenCalledTimes(2);
    expect(reselect).toHaveBeenLastCalledWith(true);
  });

  it('reselects softly on foreground and on every final network failure', () => {
    const reselect = jest
      .fn<Promise<string | null>, [forceFreshRoute?: boolean]>()
      .mockResolvedValue('https://autexa.pw/api');
    const controller = createApiRouteRecoveryController({ initialAppState: 'active', reselect });

    controller.onAppState('active');
    controller.onAppState('background');
    expect(reselect).not.toHaveBeenCalled();
    // Foreground сам по себе НЕ доказывает смену маршрута — мягкий reselect
    // (без primary-first / сброса circuit'ов и гистерезиса).
    controller.onAppState('active');
    expect(reselect).toHaveBeenCalledTimes(1);
    expect(reselect).toHaveBeenLastCalledWith(false);

    controller.onNetworkFailure();
    controller.onNetworkFailure();
    expect(reselect).toHaveBeenCalledTimes(3);
    expect(reselect).toHaveBeenLastCalledWith(false);
  });

  it('foreground форсит reselect(true) ТОЛЬКО когда network-signature сменилась в фоне', () => {
    const reselect = jest
      .fn<Promise<string | null>, [forceFreshRoute?: boolean]>()
      .mockResolvedValue('https://autexa.pw/api');
    const controller = createApiRouteRecoveryController({ initialAppState: 'active', reselect });
    controller.onNetworkState(wifi); // baseline

    // Фон → foreground при НЕизменной сети: под операторским троттлингом
    // каждый вход в приложение НЕ должен дёргать сессию на полуживой primary.
    controller.onAppState('background');
    controller.onAppState('active');
    expect(reselect).toHaveBeenCalledTimes(1);
    expect(reselect).toHaveBeenLastCalledWith(false);

    // Сеть реально сменилась, пока приложение было в фоне: NetInfo-снапшот
    // доехал в фоне (сам форсит — существующий путь)…
    controller.onAppState('background');
    controller.onNetworkState({
      isConnected: true,
      type: 'cellular',
      details: { isConnectionExpensive: true, carrier: 'Megafon', cellularGeneration: '5g' },
    });
    expect(reselect).toHaveBeenCalledTimes(2);
    expect(reselect).toHaveBeenLastCalledWith(true);
    // …и foreground сравнивает снимок ухода с актуальной signature → форс.
    controller.onAppState('active');
    expect(reselect).toHaveBeenCalledTimes(3);
    expect(reselect).toHaveBeenLastCalledWith(true);

    // Следующий цикл фон→foreground на уже стабильной новой сети — снова мягко.
    controller.onAppState('background');
    controller.onAppState('active');
    expect(reselect).toHaveBeenCalledTimes(4);
    expect(reselect).toHaveBeenLastCalledWith(false);
  });

  it('iOS-хоп active→inactive→active (шторка/звонок) не форсит перезапуск кольца', () => {
    const reselect = jest
      .fn<Promise<string | null>, [forceFreshRoute?: boolean]>()
      .mockResolvedValue('https://autexa.pw/api');
    const controller = createApiRouteRecoveryController({ initialAppState: 'active', reselect });
    controller.onNetworkState(wifi);

    controller.onAppState('inactive');
    expect(reselect).not.toHaveBeenCalled();
    controller.onAppState('active');
    expect(reselect).toHaveBeenCalledTimes(1);
    expect(reselect).toHaveBeenLastCalledWith(false);
  });

  it('contains synchronous and asynchronous selector failures', async () => {
    const asyncFailure = createApiRouteRecoveryController({
      initialAppState: 'active',
      reselect: () => Promise.reject(new Error('async failure')),
    });
    expect(() => asyncFailure.onNetworkFailure()).not.toThrow();
    await Promise.resolve();

    const syncFailure = createApiRouteRecoveryController({
      initialAppState: 'active',
      reselect: (() => {
        throw new Error('sync failure');
      }) as (forceFreshRoute?: boolean) => Promise<string | null>,
    });
    expect(() => syncFailure.onNetworkFailure()).not.toThrow();
  });
});

describe('probeApiRing', () => {
  beforeEach(() => mockReselectApiHost.mockReset());

  it('is healthy only after the whole-ring selector adopts a reachable host', async () => {
    mockReselectApiHost.mockResolvedValueOnce('https://autexa-cloud.ru/api');
    await expect(probeApiRing()).resolves.toBe(true);
    expect(mockReselectApiHost).toHaveBeenCalledTimes(1);
  });

  it('reports unhealthy when every ring host fails', async () => {
    mockReselectApiHost.mockResolvedValueOnce(null);
    await expect(probeApiRing()).resolves.toBe(false);
  });

  it('contains an unexpected selector error', async () => {
    mockReselectApiHost.mockRejectedValueOnce(new Error('probe crashed'));
    await expect(probeApiRing()).resolves.toBe(false);
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

  it('queues a trigger received during cooldown and re-arms at its expiry', async () => {
    const h = makeHarness({ healthy: true });
    h.controller.trigger();
    await h.runPending();
    expect(h.state.refetchCount).toBe(1);

    // Still erroring (refetch in flight); retain one wake-up instead of
    // dropping the only event a fast failed refetch may emit.
    h.controller.trigger();
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(4_000);

    // No fresh external event is needed: expiry starts the normal 2s backoff.
    h.state.time = 4_000;
    expect(await h.runPending()).toBe(4_000);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(PROBE_BACKOFF_MS[0]);
  });

  it('does not lose a synchronous fast-failure notification from refetch', async () => {
    const h = makeHarness({ healthy: true });
    h.state.refetchHook = () => h.controller.trigger();

    h.controller.trigger();
    await h.runPending();

    expect(h.state.refetchCount).toBe(1);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(4_000);
  });

  it('drops the cooldown wake-up if the query heals before expiry', async () => {
    const h = makeHarness({ healthy: true });
    h.controller.trigger();
    await h.runPending();
    h.controller.trigger();
    h.state.errored = false;
    h.state.time = 4_000;

    await h.runPending();
    expect(h.scheduled).toHaveLength(0);
    expect(h.state.refetchCount).toBe(1);
  });

  it('stop() cancels a pending probe', () => {
    const h = makeHarness({ healthy: false });
    h.controller.trigger();
    expect(h.scheduled).toHaveLength(1);
    h.controller.stop();
    expect(h.scheduled).toHaveLength(0);
  });
});
