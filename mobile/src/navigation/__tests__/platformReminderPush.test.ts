import { createPlatformReminderPushHandler, platformReminderTarget } from '../platformReminderPush';

const operatorId = 'aa180000-0000-4000-8000-000000000001';
const tenantId = 'aa180000-0000-4000-8000-000000000002';
const payload = { type: 'platform_reminder', operatorUserId: operatorId, tenantId, kind: 'subscription_expiry' };

function harness(role = 'manager') {
  let current = true;
  const canOpenTenant = jest.fn(async () => true);
  const openTenant = jest.fn();
  const unavailable = jest.fn();
  const consumed = jest.fn();
  const handled = new Set<string>();
  const handle = createPlatformReminderPushHandler({
    user: { id: operatorId, role },
    isCurrent: () => current,
    canOpenTenant,
    openTenant,
    unavailable,
    handled,
    consumed,
  });
  return {
    handle,
    canOpenTenant,
    openTenant,
    unavailable,
    handled,
    consumed,
    leaveSession: () => {
      current = false;
    },
  };
}

describe('platform reminder notification scope', () => {
  it.each(['manager', 'superadmin'])('opens the freshly verified tenant for %s', async (role) => {
    const h = harness(role);
    await h.handle('notice', payload);
    expect(h.canOpenTenant).toHaveBeenCalledWith(tenantId);
    expect(h.openTenant).toHaveBeenCalledWith(tenantId);
    expect(h.unavailable).not.toHaveBeenCalled();
  });

  it.each(['director', 'admin', 'master', 'cashier'])('does not query platform APIs for %s', async (role) => {
    const h = harness(role);
    await h.handle('notice', payload);
    expect(h.canOpenTenant).not.toHaveBeenCalled();
    expect(h.openTenant).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...payload, operatorUserId: 'aa180000-0000-4000-8000-000000000003' },
    { ...payload, operatorUserId: undefined },
    { ...payload, tenantId: '../users' },
    { ...payload, kind: 'reset-password' },
    { ...payload, type: 'superadmin_broadcast' },
  ])('ignores another recipient or invalid data: %j', async (data) => {
    const h = harness();
    await h.handle('notice', data);
    expect(h.canOpenTenant).not.toHaveBeenCalled();
    expect(h.openTenant).not.toHaveBeenCalled();
  });

  it('accepts a follow-up without treating it as a subscription status', () => {
    expect(platformReminderTarget({ ...payload, kind: 'follow_up' }, { id: operatorId, role: 'manager' })).toEqual({
      operatorUserId: operatorId,
      tenantId,
      kind: 'follow_up',
    });
  });

  it('coalesces the live and cold-start copies, including while access verification is pending', async () => {
    const h = harness();
    let release!: (value: boolean) => void;
    h.canOpenTenant.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const first = h.handle('notice', payload);
    await h.handle('notice', payload);
    expect(h.canOpenTenant).toHaveBeenCalledTimes(1);
    expect(h.consumed).not.toHaveBeenCalled();
    release(true);
    await first;
    await h.handle('notice', payload);
    expect(h.openTenant).toHaveBeenCalledTimes(1);
    expect(h.canOpenTenant).toHaveBeenCalledTimes(1);
    expect(h.consumed).toHaveBeenCalledTimes(1);
    expect(h.consumed).toHaveBeenCalledWith('notice');
  });

  it('does not open or toast into another account after a pending request completes', async () => {
    const h = harness();
    let release!: (value: boolean) => void;
    h.canOpenTenant.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const first = h.handle('notice', payload);
    h.leaveSession();
    release(true);
    await first;
    expect(h.openTenant).not.toHaveBeenCalled();
    expect(h.unavailable).not.toHaveBeenCalled();
    expect(h.consumed).not.toHaveBeenCalled();
  });

  it('ignores a delayed notification before making a request when its lease has expired', async () => {
    const h = harness();
    h.leaveSession();
    await h.handle('notice', payload);
    expect(h.canOpenTenant).not.toHaveBeenCalled();
  });

  it('does not open a tenant that was transferred away after delivery', async () => {
    const h = harness();
    h.canOpenTenant.mockResolvedValue(false);
    await h.handle('notice', payload);
    expect(h.openTenant).not.toHaveBeenCalled();
    expect(h.unavailable).toHaveBeenCalledTimes(1);
  });

  it('allows a user retry after a transient access-check failure', async () => {
    const h = harness();
    h.canOpenTenant.mockRejectedValueOnce(new Error('network'));
    await h.handle('notice', payload);
    expect(h.openTenant).not.toHaveBeenCalled();
    await h.handle('notice', payload);
    expect(h.openTenant).toHaveBeenCalledTimes(1);
  });
});
