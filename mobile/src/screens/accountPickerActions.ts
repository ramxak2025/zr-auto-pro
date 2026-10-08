import type { AccountLoginHandle } from '../contexts/AuthContext';
import type { LoginPointOption } from '../../../shared/api/types';

/** Applies async switch results only while the captured data-session epoch and
 * this particular UI action are still current. */
export async function runAccountSwitchAction(args: {
  accountId: string;
  sequence: { current: number };
  isSessionCurrent: () => boolean;
  isMounted: () => boolean;
  switchAccount: (accountId: string) => Promise<void>;
  setBusy: (value: string | null) => void;
  setError: (error: unknown) => void;
  onSuccess: () => void;
}): Promise<void> {
  const { accountId, sequence } = args;
  const actionId = ++sequence.current;
  const current = () => args.isMounted() && args.isSessionCurrent() && sequence.current === actionId;
  args.setBusy(`switch:${accountId}`);
  args.setError(null);
  try {
    await args.switchAccount(accountId);
    if (current()) args.onSuccess();
  } catch (error) {
    if (current()) args.setError(error);
  } finally {
    if (current()) args.setBusy(null);
  }
}

export interface PendingAccountLogin {
  operation: AccountLoginHandle;
  points: LoginPointOption[];
  defaultPointId: string;
  expiresAt: number;
}

export function cancelPendingAccountLogin(
  pending: { current: PendingAccountLogin | null },
  cancel: (operation: AccountLoginHandle) => void,
): void {
  const attempt = pending.current;
  pending.current = null;
  if (attempt) cancel(attempt.operation);
}
