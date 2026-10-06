/** Coalesces own-profile recovery after an authenticated app foregrounds. */
export function createForegroundProfileRefreshController(deps: {
  getEpoch: () => number;
  canRefresh: () => boolean;
  refresh: () => Promise<void>;
  now?: () => number;
}) {
  let previousState = 'active';
  let throttleEpoch: number | null = null;
  let lastRefreshAt = 0;
  const inFlight = new Map<number, Promise<void>>();
  const now = deps.now ?? Date.now;

  const onAppState = (nextState: string) => {
    const foregrounded = nextState === 'active' && previousState !== 'active';
    previousState = nextState;
    if (!foregrounded || !deps.canRefresh()) return;

    const epoch = deps.getEpoch();
    if (throttleEpoch === epoch && now() - lastRefreshAt < 30_000) return;
    throttleEpoch = epoch;
    lastRefreshAt = now();

    if (inFlight.has(epoch)) return;
    const work = deps.refresh().finally(() => {
      if (inFlight.get(epoch) === work) inFlight.delete(epoch);
    });
    inFlight.set(epoch, work);
    void work.catch(() => {});
  };

  return { onAppState };
}
