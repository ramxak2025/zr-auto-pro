import type { AccountDataScope, SavedAccount } from './accountRegistry';
import {
  parseStoredQueue,
  parseStoredQueueOwner,
  OFFLINE_CHECK_QUEUE_STORAGE_KEY,
  scopedQueueKey,
} from '../utils/offlineCheckQueue';
import { PROCUREMENT_PREFIX } from '../../../shared/utils/durableProcurement';

export interface AccountRemovalInspection {
  canRemove: boolean;
  offlineChecks: number;
  financialIntents: number;
  nfcScans: number;
  /** Unattributed legacy records remain on device, never assigned to this account. */
  legacyQuarantined: number;
}
interface Storage {
  getItem(key: string): Promise<string | null>;
  getAllKeys(): Promise<readonly string[]>;
}
const sourcePrefix = (scope: AccountDataScope) => `${scope.tenantId}/${scope.userId}/${scope.pointId ?? 'none'}`;

/** Read-only inventory. Removal never deletes request ledgers, including
 * unknown/corrupt entries; a storage failure blocks removal with an error. */
export async function inspectSavedAccountRemoval(
  storage: Storage,
  account: Pick<SavedAccount<unknown>, 'scopes'>,
): Promise<AccountRemovalInspection> {
  const keys = await storage.getAllKeys();
  let offlineChecks = 0;
  let financialIntents = 0;
  let nfcScans = 0;
  for (const scope of account.scopes) {
    const raw = await storage.getItem(scopedQueueKey(scope));
    if (raw) {
      const count = parseStoredQueue(raw).length;
      // An unreadable nonempty ledger must not be silently treated as empty.
      const parsed = JSON.parse(raw) as { entries?: unknown[] };
      offlineChecks += count || (Array.isArray(parsed.entries) && parsed.entries.length === 0 ? 0 : 1);
    }
    const prefix = sourcePrefix(scope);
    financialIntents += keys.filter((key) => key.startsWith(`${PROCUREMENT_PREFIX}${prefix}/`)).length;
    nfcScans += keys.filter((key) => key === `autexa:nfc:v1:${prefix}`).length;
  }
  const legacy = await storage.getItem(OFFLINE_CHECK_QUEUE_STORAGE_KEY);
  const legacyOwner = parseStoredQueueOwner(legacy);
  const rows = parseStoredQueue(legacy);
  // Explicitly owned legacy records are still protected when no scoped import
  // exists yet. Unknowns are counted globally, never claimed by this account.
  let legacyQuarantined = 0;
  for (const row of rows) {
    const matched =
      legacyOwner &&
      account.scopes.find(
        (scope) =>
          scope.tenantId === legacyOwner.tenantId &&
          scope.userId === legacyOwner.userId &&
          row.payload.pointId === scope.pointId &&
          (scope.pointId !== null || legacyOwner.pointId === null),
      );
    if (matched) {
      if ((await storage.getItem(scopedQueueKey(matched))) === null) offlineChecks += 1;
    } else if (
      !legacyOwner ||
      row.payload.pointId === undefined ||
      (row.payload.pointId === null && legacyOwner.pointId !== null)
    )
      legacyQuarantined += 1;
  }
  return {
    canRemove: offlineChecks + financialIntents + nfcScans === 0,
    offlineChecks,
    financialIntents,
    nfcScans,
    legacyQuarantined,
  };
}
