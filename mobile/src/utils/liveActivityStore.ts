import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  liveActivitiesAvailable,
  type LiveActivityAttributes,
  type LiveActivityState,
} from './liveActivity';

/**
 * Persistent slot → Live Activity id store.
 *
 * A Live Activity id is needed to update / end a running activity, but the
 * screens that start them (WorkBoard, CashShift) unmount as soon as the user
 * navigates away — and an order can stay «в работе» or a cash shift open for
 * hours, across app restarts. So we mirror `slot → { id, startedAt }` into
 * AsyncStorage (with an in-memory cache for hot reads) so the id outlives both
 * the screen and the process.
 *
 * `startedAt` is kept so status updates can re-send the ORIGINAL start moment —
 * otherwise liveActivity.ts's `withDefaults` would stamp `now` on every update
 * and the Dynamic Island's live timer would reset on each status change.
 *
 * Everything here is fire-and-forget and a safe no-op off iOS / iOS < 16.1
 * (the bridge already guards platform + ActivityKit support). Slots:
 *   • orderActivitySlot(checkId) — заказ-наряд на доске
 *   • CASH_SHIFT_ACTIVITY_SLOT   — открытая кассовая смена (singleton)
 */

const STORE_KEY = 'autexa_live_activity_ids_v1';

/** Slot key for the open cash shift (only one open shift at a time per device). */
export const CASH_SHIFT_ACTIVITY_SLOT = 'cash-shift';

/** Slot key for a board work-order Live Activity, keyed by the check id. */
export function orderActivitySlot(orderId: string): string {
  return `order:${orderId}`;
}

interface ActivityEntry {
  id: string;
  /** ISO start moment — re-sent on every update so the live timer stays anchored. */
  startedAt: string;
}

// In-memory mirror of the persisted map. Hydrated lazily on first access and
// kept in sync on every write so repeated reads avoid an AsyncStorage round-trip.
let memo: Record<string, ActivityEntry> | null = null;

async function loadMap(): Promise<Record<string, ActivityEntry>> {
  if (memo) return memo;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    memo = raw ? (JSON.parse(raw) as Record<string, ActivityEntry>) : {};
  } catch {
    memo = {};
  }
  return memo;
}

async function saveMap(next: Record<string, ActivityEntry>): Promise<void> {
  memo = next;
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // non-critical — worst case the id→activity link is lost across a restart.
  }
}

/**
 * Start the activity for `slot`. If one is already tracked there, update it
 * instead (re-entry safe). Persists the returned id. No-op when Live
 * Activities are unavailable.
 */
export async function startTrackedActivity(
  slot: string,
  attributes: LiveActivityAttributes,
  state: LiveActivityState,
): Promise<void> {
  if (!liveActivitiesAvailable()) return;
  const map = await loadMap();
  const existing = map[slot];
  if (existing) {
    await updateLiveActivity(existing.id, { ...state, startedAt: existing.startedAt });
    return;
  }
  const startedAt = state.startedAt ?? new Date().toISOString();
  const id = await startLiveActivity(attributes, { ...state, startedAt });
  if (id) await saveMap({ ...map, [slot]: { id, startedAt } });
}

/** Update the tracked activity for `slot`, preserving its original startedAt. */
export async function updateTrackedActivity(slot: string, state: LiveActivityState): Promise<void> {
  if (!liveActivitiesAvailable()) return;
  const map = await loadMap();
  const entry = map[slot];
  if (entry) await updateLiveActivity(entry.id, { ...state, startedAt: entry.startedAt });
}

/** End + forget the tracked activity for `slot`. */
export async function endTrackedActivity(slot: string, finalState?: LiveActivityState): Promise<void> {
  const map = await loadMap();
  const entry = map[slot];
  if (!entry) return;
  await endLiveActivity(entry.id, finalState ? { ...finalState, startedAt: entry.startedAt } : undefined);
  const next = { ...map };
  delete next[slot];
  await saveMap(next);
}
