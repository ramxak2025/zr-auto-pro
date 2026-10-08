import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  liveActivitiesAvailable,
  endAllLiveActivities,
  type LiveActivityAttributes,
  type LiveActivityState,
} from './liveActivity';

import { captureDataSession } from '../contexts/dataSession';

const STORE_PREFIX = 'autexa_live_activity_ids_v2:';
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

type ActivityMap = Record<string, ActivityEntry>;
type Lease = ReturnType<typeof captureDataSession>;
let tail: Promise<void> = Promise.resolve();
function serial(work: () => Promise<void>): Promise<void> {
  const next = tail.catch(() => {}).then(work);
  tail = next.catch(() => {});
  return tail;
}
async function loadMap(key: string): Promise<ActivityMap> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as ActivityMap) : {};
}
async function saveMap(key: string, next: ActivityMap): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

/** Runs before new-session activity writes in the same serial native queue.
 * Also clears unowned legacy ActivityKit presentations on cold restoration. */
export function resetLiveActivitySession(): Promise<void> {
  return serial(async () => {
    await endAllLiveActivities();
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(STORE_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  }).catch(() => {});
}

export function startTrackedActivity(
  slot: string,
  attributes: LiveActivityAttributes,
  state: LiveActivityState,
  lease: Lease = captureDataSession(),
): Promise<void> {
  return serial(async () => {
    if (!lease.key || !lease.isCurrent() || !liveActivitiesAvailable()) return;
    const key = STORE_PREFIX + lease.key;
    const map = await loadMap(key);
    if (!lease.isCurrent()) return;
    const existing = map[slot];
    if (existing) {
      await updateLiveActivity(existing.id, { ...state, startedAt: existing.startedAt });
      return;
    }
    const startedAt = state.startedAt ?? new Date().toISOString();
    const id = await startLiveActivity(attributes, { ...state, startedAt });
    if (!id) return;
    if (!lease.isCurrent()) {
      await endLiveActivity(id, undefined, true);
      return;
    }
    await saveMap(key, { ...map, [slot]: { id, startedAt } });
  }).catch(() => {});
}
export function updateTrackedActivity(
  slot: string,
  state: LiveActivityState,
  lease: Lease = captureDataSession(),
): Promise<void> {
  return serial(async () => {
    if (!lease.key || !lease.isCurrent() || !liveActivitiesAvailable()) return;
    const map = await loadMap(STORE_PREFIX + lease.key);
    if (!lease.isCurrent()) return;
    const entry = map[slot];
    if (entry) await updateLiveActivity(entry.id, { ...state, startedAt: entry.startedAt });
  }).catch(() => {});
}
export function endTrackedActivity(
  slot: string,
  finalState?: LiveActivityState,
  lease: Lease = captureDataSession(),
): Promise<void> {
  return serial(async () => {
    if (!lease.key || !lease.isCurrent()) return;
    const key = STORE_PREFIX + lease.key;
    const map = await loadMap(key);
    if (!lease.isCurrent()) return;
    const entry = map[slot];
    if (!entry) return;
    await endLiveActivity(entry.id, finalState ? { ...finalState, startedAt: entry.startedAt } : undefined);
    const next = { ...map };
    delete next[slot];
    await saveMap(key, next);
  }).catch(() => {});
}
