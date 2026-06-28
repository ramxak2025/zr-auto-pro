import { Platform } from 'react-native';
import { consumePendingAppIntent as nativeConsume } from '../../modules/autexa-liquid-glass/src/index';

/**
 * Siri / App Intents → app deep-link bridge (iOS 16+).
 *
 * The App Shortcuts «Создать заказ-наряд» / «Открыть кассу»
 * (ios-app-intents/AutexaAppIntents.swift) open the app and queue an
 * action into the shared App Group. Call `consumePendingAppIntent()` once
 * on app launch / foreground; it read-and-clears the action so it fires
 * exactly once, then route to the Касса screen.
 *
 * Wiring (one line, for the screen/navigation owner — NOT done here to
 * respect file ownership):
 *
 *   useEffect(() => {
 *     const p = consumePendingAppIntent();
 *     if (p?.action === 'create_order' || p?.action === 'open_cash') {
 *       navigation.navigate('NewCheck');
 *     }
 *   }, []);
 *
 * No-op (null) on Android and on iOS < 16.
 */
export type PendingIntentAction = 'create_order' | 'open_cash';

export interface PendingAppIntent {
  action: PendingIntentAction;
  /** ISO-8601 момент, когда пользователь вызвал интент. */
  at: string;
}

export function consumePendingAppIntent(): PendingAppIntent | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const raw = nativeConsume();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { action?: unknown; at?: unknown };
    if (parsed?.action === 'create_order' || parsed?.action === 'open_cash') {
      return {
        action: parsed.action,
        at: typeof parsed.at === 'string' ? parsed.at : '',
      };
    }
  } catch {
    // malformed / empty — treat as no pending action
  }
  return null;
}
