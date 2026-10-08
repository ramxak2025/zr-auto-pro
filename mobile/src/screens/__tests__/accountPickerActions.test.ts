import { cancelPendingAccountLogin, runAccountSwitchAction, type PendingAccountLogin } from '../accountPickerActions';
import { captureDataSession, setDataSession } from '../../contexts/dataSession';

it('does not let an old switch completion clear state or close after a newer account action starts', async () => {
  let resolveSwitch!: () => void;
  const sequence = { current: 0 };
  const ownerA = { tenantId: 'tenant-a', userId: 'user-a', pointId: 'point-a' };
  setDataSession(ownerA);
  const sessionLease = captureDataSession();
  const setBusy = jest.fn();
  const setError = jest.fn();
  const onSuccess = jest.fn();
  const action = runAccountSwitchAction({
    accountId: 'account-a',
    sequence,
    isSessionCurrent: sessionLease.isCurrent,
    isMounted: () => true,
    switchAccount: () =>
      new Promise<void>((resolve) => {
        resolveSwitch = resolve;
      }),
    setBusy,
    setError,
    onSuccess,
  });

  expect(setBusy).toHaveBeenCalledWith('switch:account-a');
  sequence.current += 1;
  setDataSession({ tenantId: 'tenant-b', userId: 'user-b', pointId: 'point-b' });
  setDataSession(ownerA);
  resolveSwitch();
  await action;

  expect(onSuccess).not.toHaveBeenCalled();
  expect(setBusy).toHaveBeenCalledTimes(1);
  expect(setError).toHaveBeenCalledWith(null);
});

it('runs normal success cleanup only while the captured session is still current', async () => {
  const sequence = { current: 0 };
  const setBusy = jest.fn();
  const onSuccess = jest.fn();
  await runAccountSwitchAction({
    accountId: 'account-b',
    sequence,
    isSessionCurrent: () => true,
    isMounted: () => true,
    switchAccount: async () => {},
    setBusy,
    setError: jest.fn(),
    onSuccess,
  });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(setBusy).toHaveBeenLastCalledWith(null);
});

it('cancels and clears the opaque point-login handle when the sheet is hidden or unmounted', () => {
  const operation = Object.freeze({ id: 11 });
  const pending = {
    current: { operation, points: [], defaultPointId: 'p', expiresAt: Date.now() + 1000 } as PendingAccountLogin,
  };
  const cancel = jest.fn();
  cancelPendingAccountLogin(pending, cancel);
  expect(cancel).toHaveBeenCalledWith(operation);
  expect(pending.current).toBeNull();
  cancelPendingAccountLogin(pending, cancel);
  expect(cancel).toHaveBeenCalledTimes(1);
});
