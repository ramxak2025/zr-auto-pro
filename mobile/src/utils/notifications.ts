import type * as ExpoNotifications from 'expo-notifications';
import { inventoryInternal } from './runtimeEnvironment';

export type { NotificationResponse, ExpoPushToken } from 'expo-notifications';

type NotificationMethods = Pick<
  typeof ExpoNotifications,
  | 'setNotificationHandler'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
  | 'getExpoPushTokenAsync'
  | 'setNotificationChannelAsync'
  | 'scheduleNotificationAsync'
  | 'addNotificationReceivedListener'
  | 'addNotificationResponseReceivedListener'
  | 'getLastNotificationResponseAsync'
  | 'clearLastNotificationResponseAsync'
>;
type Notifications = NotificationMethods & {
  IosAuthorizationStatus: Pick<typeof ExpoNotifications.IosAuthorizationStatus, 'PROVISIONAL'>;
  AndroidImportance: Pick<typeof ExpoNotifications.AndroidImportance, 'MAX'>;
};

async function unavailable(): Promise<never> {
  throw Object.assign(new Error('Уведомления недоступны во внутренней сборке склада.'), {
    code: 'ERR_INVENTORY_INTERNAL_NOTIFICATIONS_DISABLED',
  });
}

// Do not load the SDK internally: even importing its barrel reads the shared
// production keychain registration and starts DevicePushTokenAutoRegistration.fx.
// Never disable auto-registration or unregister: that would erase public state.
const notifications: Notifications = inventoryInternal
  ? {
      setNotificationHandler: () => {},
      getPermissionsAsync: unavailable,
      requestPermissionsAsync: unavailable,
      getExpoPushTokenAsync: unavailable,
      setNotificationChannelAsync: unavailable,
      scheduleNotificationAsync: unavailable,
      addNotificationReceivedListener: () => ({ remove() {} }),
      addNotificationResponseReceivedListener: () => ({ remove() {} }),
      getLastNotificationResponseAsync: async () => null,
      clearLastNotificationResponseAsync: async () => {},
      // Pure constants from installed expo-notifications 0.32.17. Keep these
      // narrow so adding SDK APIs requires an explicit isolation decision.
      IosAuthorizationStatus: { PROVISIONAL: 3 },
      AndroidImportance: { MAX: 7 },
    }
  : require('expo-notifications');

// Preserve the ordinary SDK's exact function and constant object references,
// synchronous behavior, return values, errors and subscription disposal.
export const {
  setNotificationHandler,
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  setNotificationChannelAsync,
  scheduleNotificationAsync,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
  clearLastNotificationResponseAsync,
  IosAuthorizationStatus,
  AndroidImportance,
} = notifications;
