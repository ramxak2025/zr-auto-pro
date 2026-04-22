import * as Haptics from 'expo-haptics';

/** Light tap — tab switches, minor selections */
export const tapLight = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** Medium tap — button press, card press */
export const tapMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

/** Heavy tap — destructive actions, important confirmations */
export const tapHeavy = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

/** Success — operation completed */
export const notifySuccess = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

/** Error — something failed */
export const notifyError = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

/** Warning — attention needed */
export const notifyWarning = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

/** Selection change — scroll to new index, picker value changed */
export const selectionChanged = () => Haptics.selectionAsync();
