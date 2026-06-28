import { Platform } from 'react-native';
import {
  startLiveActivity as nativeStart,
  updateLiveActivity as nativeUpdate,
  endLiveActivity as nativeEnd,
  endAllLiveActivities as nativeEndAll,
  liveActivitiesSupported,
} from '../../modules/autexa-liquid-glass/src/index';

/**
 * Live Activity / Dynamic Island bridge (iOS 16.1+).
 *
 * An "active context" — заказ-наряд в работе or открытая кассовая смена —
 * is surfaced live on the Lock Screen and in the Dynamic Island. The
 * native side (AutexaLiveActivityModule.swift) talks to ActivityKit; the
 * widget extension (AutexaLiveActivity.swift) renders it.
 *
 * Every function is a safe no-op on Android and on iOS < 16.1 (or when the
 * user has disabled Live Activities). Failures never throw to the caller —
 * a Live Activity is a non-critical enhancement.
 *
 * Shapes here are byte-compatible with the Swift `AutexaActivityAttributes`
 * (kind/orderId) and `ContentState` (title/status/subtitle/amount/
 * itemsCount/startedAt). Keep them in sync.
 */

export type AutexaActivityKind = 'order' | 'shift';

export interface LiveActivityAttributes {
  /** 'order' — активный заказ-наряд; 'shift' — открытая кассовая смена. */
  kind: AutexaActivityKind;
  /** Backing id (опционально), для трассировки. */
  orderId?: string;
}

export interface LiveActivityState {
  /** Главная строка — госномер / «Заказ-наряд №…» / «Кассовая смена». */
  title: string;
  /** Статус — «В работе», «Ожидает оплаты», «Касса открыта». */
  status: string;
  /** Вторая строка — мастер / клиент. */
  subtitle?: string;
  /** Текущая сумма, ₽. */
  amount?: number;
  /** Позиций в заказе. */
  itemsCount?: number;
  /**
   * ISO-8601 момент старта — управляет «живым» таймером в Dynamic Island.
   * Если не задан, подставляется текущее время.
   */
  startedAt?: string;
}

function withDefaults(state: LiveActivityState): LiveActivityState {
  return { startedAt: new Date().toISOString(), ...state };
}

/** Поддерживаются ли Live Activities на этом устройстве и включены ли. */
export function liveActivitiesAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return liveActivitiesSupported();
  } catch {
    return false;
  }
}

/**
 * Запустить Live Activity. Возвращает id запущенной активности (нужен для
 * update/end) или null, если недоступно / отключено / ошибка.
 */
export async function startLiveActivity(
  attributes: LiveActivityAttributes,
  state: LiveActivityState,
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  return nativeStart(JSON.stringify(attributes), JSON.stringify(withDefaults(state)));
}

/** Обновить запущенную активность по id. */
export async function updateLiveActivity(id: string, state: LiveActivityState): Promise<void> {
  if (Platform.OS !== 'ios' || !id) return;
  await nativeUpdate(id, JSON.stringify(withDefaults(state)));
}

/** Завершить активность по id (опционально с финальным состоянием). */
export async function endLiveActivity(
  id: string,
  finalState?: LiveActivityState,
  dismissImmediately = false,
): Promise<void> {
  if (Platform.OS !== 'ios' || !id) return;
  await nativeEnd(id, finalState ? JSON.stringify(withDefaults(finalState)) : null, dismissImmediately);
}

/** Завершить все активности Autexa (например, при выходе из аккаунта). */
export async function endAllLiveActivities(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await nativeEndAll();
}
