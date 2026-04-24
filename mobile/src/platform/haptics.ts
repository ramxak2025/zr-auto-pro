/**
 * Platform-adaptive haptic feedback.
 *
 * iOS feels "premium" when every meaningful tap pairs with a light tactile.
 * Android Taptic engines are rarer and weaker; we still fire but at a more
 * restrained intensity. Wrapped in try/catch so absence of the device
 * vibrator never takes down a render.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticIntent =
  | 'tap'          // light — menu tap, toggle
  | 'select'       // medium — segmented control, tab switch
  | 'impact'       // heavy — big CTA press
  | 'success'      // success notification
  | 'warning'      // warning notification
  | 'error';       // error notification

export function haptic(intent: HapticIntent): void {
  // Android gets the softer variant of each — less intrusive.
  const android = Platform.OS === 'android';
  try {
    switch (intent) {
      case 'tap':
        Haptics.impactAsync(android ? Haptics.ImpactFeedbackStyle.Soft : Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'select':
        Haptics.selectionAsync();
        break;
      case 'impact':
        Haptics.impactAsync(android ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    // Silent — haptics are never load-bearing.
  }
}
