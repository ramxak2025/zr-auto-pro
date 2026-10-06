import { createForegroundProfileRefreshController } from '../foregroundProfileRefresh';

describe('foreground profile recovery', () => {
  it('retries a cached authenticated profile after foreground and throttles duplicate returns', () => {
    let epoch = 1;
    let authenticated = true;
    let now = 100_000;
    const refresh = jest.fn(async () => {});
    const controller = createForegroundProfileRefreshController({
      getEpoch: () => epoch,
      canRefresh: () => authenticated,
      refresh,
      now: () => now,
    });

    controller.onAppState('background');
    controller.onAppState('active');
    controller.onAppState('background');
    now += 1_000;
    controller.onAppState('active');
    expect(refresh).toHaveBeenCalledTimes(1);

    // A foreground during logout has no user/token and does not clear state.
    authenticated = false;
    controller.onAppState('background');
    controller.onAppState('active');
    expect(refresh).toHaveBeenCalledTimes(1);

    // A new login/session gets its own throttle window immediately.
    authenticated = true;
    epoch += 1;
    controller.onAppState('background');
    controller.onAppState('active');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not let a pending request from an older session block current-session recovery', async () => {
    let epoch = 1;
    let resolveOld!: () => void;
    const refresh = jest
      .fn<Promise<void>, []>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce();
    const controller = createForegroundProfileRefreshController({
      getEpoch: () => epoch,
      canRefresh: () => true,
      refresh,
      now: () => 100_000,
    });

    controller.onAppState('background');
    controller.onAppState('active');
    epoch = 2;
    controller.onAppState('background');
    controller.onAppState('active');
    expect(refresh).toHaveBeenCalledTimes(2);
    resolveOld();
  });
});
