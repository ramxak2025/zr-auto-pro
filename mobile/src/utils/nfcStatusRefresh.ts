import type { NfcSession } from '../../../shared/utils/pendingNfc';

/** Refresh both session-scoped status sources; never writes a scan or attendance mutation. */
export async function refreshNfcStatusForCurrentSession(
  session: NfcSession,
  isCurrent: () => boolean,
  onRefreshed: () => void,
  onError: () => void,
): Promise<void> {
  try {
    await session.refreshCurrent();
    if (isCurrent()) onRefreshed();
  } catch {
    if (isCurrent()) onError();
  }
}
